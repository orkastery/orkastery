/**
 * RM-062 (F1): a varredura de dado privado. Todo valor daqui é inventado: usuário, máquina, domínio e termo da lista
 * local. O arquivo entra nas exceções versionadas por caminho, só para os padrões genéricos.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { exec } from '../src/util';
import {
  ARQUIVO_DAS_EXCECOES, baseDaThread, contextoDaVarredura, ContextoDaVarredura, lerListaLocal, linhaDoAchado,
  relatorioDoDadoPrivado, Varredura, varrerArvore, varrerDiff, varrerTexto,
} from '../src/dado-privado';

// Valores inventados, um por padrão.
const HOME_FICTICIA = '/home/fulana-de-teste';
const EMAIL_FICTICIO = 'contato@empresa-ficticia.com.br';
const MAQUINA_FICTICIA = 'fulana-laptop';
const TERMO_FICTICIO = 'tralala-quarenta-e-dois';

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Um repositório de teste com os arquivos dados, commitados. */
function repo(nome: string, arquivos: Record<string, string>): string {
  const dir = dirTemporario(`dado-privado-${nome}`);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'teste@orkastery.local');
  git(dir, 'config', 'user.name', 'Teste Orkastery');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, arquivos);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'inicial');
  return dir;
}

function escrever(dir: string, arquivos: Record<string, string>): void {
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, nome)), { recursive: true });
    fs.writeFileSync(path.join(dir, nome), conteudo);
  }
}

/** Uma lista local num arquivo fora do repositório. */
function lista(...termos: string[]): string {
  const arquivo = path.join(dirTemporario('dado-privado-lista'), 'termos-privados.txt');
  fs.writeFileSync(arquivo, termos.join('\n') + '\n', { mode: 0o600 });
  return arquivo;
}

/** O contexto com a lista local de `arquivoDaLista` (ou nenhuma: a variável aponta para um arquivo que não existe). */
function contexto(raiz: string, arquivoDaLista: string | null = null): ContextoDaVarredura {
  const env = { ...process.env, ORK_TERMOS_PRIVADOS: arquivoDaLista ?? path.join(raiz, '.nao-existe', 'termos-privados.txt') };
  const c = contextoDaVarredura(raiz, null, env);
  assert.ok(c.ok, c.ok ? '' : c.erro);
  return c.valor;
}

function padroes(v: Varredura): string[] {
  return v.achados.map((a) => a.padrao);
}

/** Texto e JSON de uma varredura, para conferir que nenhum valor casado sai. */
function saidas(v: Varredura): string {
  return relatorioDoDadoPrivado(v).join('\n') + '\n' + JSON.stringify(v);
}

test('DP1: cada padrão genérico num arquivo versionado reprova, um achado por padrão, com arquivo, linha e coluna', () => {
  const dir = repo('padroes', {
    'docs/a.md': `# notas\ncaminho ${HOME_FICTICIA}/projeto\nfale com ${EMAIL_FICTICIO}\nrodou em ${MAQUINA_FICTICIA} ontem\n`,
  });
  const v = varrerArvore(contexto(dir));
  assert.equal(v.erro, null);
  assert.deepEqual(v.achados.map(linhaDoAchado), ['docs/a.md:2:9  home', 'docs/a.md:3:10  email', 'docs/a.md:4:10  hostname']);
  assert.deepEqual(padroes(v), ['home', 'email', 'hostname']);
});

test('DP2: o relatório, em texto e em JSON, não traz nenhum valor casado nem o termo da lista local', () => {
  const arquivoDaLista = lista(TERMO_FICTICIO);
  const dir = repo('relatorio', {
    'x.txt': `${HOME_FICTICIA} ${EMAIL_FICTICIO} ${MAQUINA_FICTICIA} ${TERMO_FICTICIO.toUpperCase()}\n`,
    [`evidencia/${TERMO_FICTICIO}-2026.json`]: '{}\n',
  });
  const v = varrerArvore(contexto(dir, arquivoDaLista));
  assert.deepEqual(padroes(v).sort(), ['email', 'home', 'hostname', 'lista-local', 'lista-local']);
  const tudo = saidas(v).toLowerCase();
  for (const valor of [HOME_FICTICIA, 'fulana-de-teste', EMAIL_FICTICIO, MAQUINA_FICTICIA, TERMO_FICTICIO, 'empresa-ficticia']) {
    assert.equal(tudo.includes(valor.toLowerCase()), false, `o relatório repetiu ${valor.slice(0, 3)}...`);
  }
});

test('DP3: nome de arquivo com termo da lista local é achado de nome, e o caminho sai mascarado em todo lugar', () => {
  const arquivoDaLista = lista(TERMO_FICTICIO);
  const dir = repo('nome', { [`evidencia/RM-0/${TERMO_FICTICIO}-2026-10-03.json`]: `{"maquina": "${TERMO_FICTICIO}"}\n` });
  const v = varrerArvore(contexto(dir, arquivoDaLista));
  assert.deepEqual(v.achados.map(linhaDoAchado), [
    'evidencia/RM-0/[omitido]-2026-10-03.json  nome do arquivo: lista-local (termo 1)',
    'evidencia/RM-0/[omitido]-2026-10-03.json:1:14  lista-local (termo 1)',
  ]);
  assert.equal(v.nomes, 1);
});

test('DP4: sem a lista local, os padrões genéricos seguem e a saída diz que ela está ausente e onde foi procurada', () => {
  const dir = repo('sem-lista', { 'a.txt': `${EMAIL_FICTICIO}\n` });
  const antes = process.env.ORK_USUARIO_DIR;
  // Uma pasta que não existe dentro da pasta pessoal: nada é escrito nela, e o caminho sai com `~`.
  process.env.ORK_USUARIO_DIR = path.join(os.homedir(), `.ork-teste-inexistente-${process.pid}`);
  try {
    const env = { ...process.env };
    delete env.ORK_TERMOS_PRIVADOS;
    const c = contextoDaVarredura(dir, dir, env);
    assert.ok(c.ok);
    const v = varrerArvore(c.valor);
    assert.deepEqual(padroes(v), ['email']);
    assert.equal(v.listaLocal.presente, false);
    assert.deepEqual(v.listaLocal.procurada, ['~/.orkastery/termos-privados.txt', '.orkastery/termos-privados.txt']);
    const texto = relatorioDoDadoPrivado(v).join('\n');
    assert.match(texto, /lista local {2}ausente \(procurada em ~\/\.orkastery\/termos-privados\.txt e \.orkastery\/termos-privados\.txt\); só os padrões genéricos \(home, email, hostname\)/);
  } finally {
    if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes;
  }
});

test('DP5: a lista local: a variável troca os caminhos, termo curto é ignorado e contado, # comenta, sem caixa, e a lista versionada é recusada', () => {
  const pasta = dirTemporario('dado-privado-lista-pasta');
  const arquivo = path.join(pasta, 'meus-termos.txt');
  fs.writeFileSync(arquivo, `# comentário com ${TERMO_FICTICIO}\nab\n\n  Orion-Ficticio  \norion-ficticio\nxyzzy\n`, { mode: 0o600 });
  const l = lerListaLocal(null, null, { ORK_TERMOS_PRIVADOS: arquivo });
  assert.deepEqual(l.termos, ['orion-ficticio', 'xyzzy']);
  assert.equal(l.ignorados, 1);
  assert.equal(l.presente, true);
  assert.equal(l.procurada.length, 1);
  assert.deepEqual(l.procurada, ['arquivo indicado por ORK_TERMOS_PRIVADOS']);
  const dir = repo('lista-caixa', { 'a.txt': 'servidor ORION-FICTICIO na sala\n' });
  assert.deepEqual(varrerArvore(contexto(dir, arquivo)).achados.map(linhaDoAchado), ['a.txt:1:10  lista-local (termo 1)']);
  // A lista dentro do repositório e versionada: a varredura recusa, sem varrer.
  const versionada = repo('lista-versionada', { 'config/termos-privados.txt': 'xyzzy\n' });
  fs.chmodSync(path.join(versionada, 'config/termos-privados.txt'), 0o600);
  const c = contextoDaVarredura(versionada, null, { ORK_TERMOS_PRIVADOS: path.join(versionada, 'config/termos-privados.txt') });
  assert.equal(c.ok, false);
  assert.match(c.ok ? '' : c.erro, /lista local de termos privados está versionada \(1 arquivo\(s\)\)/);
});

test('DP6: e-mail: prefixos de campo e caminho são achados; domínio de exemplo, credencial de URL, remoto SSH e escape não são', () => {
  const dir = repo('email', {
    'a.txt': [
      'exemplo: pessoa@example.com, outra@sub.example.org, alguem@empresa.invalid, x@maquina.test, y@host.localhost',
      'clone https://usuario:senha123@forja.empresa-ficticia.com.br/grupo/repo.git e https://token@forja.empresa-ficticia.com.br',
      'remoto git@forja.empresa-ficticia.com.br:grupo/repo.git e deploy@forja.empresa-ficticia.com.br:grupo/repo.git',
      'url ssh://-oProxyCommand=x@forja.empresa-ficticia.com.br/g e git+ssh://u:1#tok@forja.empresa-ficticia.com.br/g',
      '"codigo": "def f():\\n@app.get(\'/\')"',
      'escreva para <mailto:dono@empresa-ficticia.com.br>',
      'robo: noreply@ferramenta-ficticia.com e suporte@ferramenta-ficticia.com',
      'consulta https://site-ficticio.com.br/?email=pessoa@empresa-ficticia.com.br na URL',
      'campo:contato@empresa-ficticia.com.br e pasta/contato@empresa-ficticia.com.br',
    ].join('\n') + '\n',
    [ARQUIVO_DAS_EXCECOES]: JSON.stringify({ contrato: 'ork.privado/v1',
      emailsPermitidos: [{ valor: 'noreply@ferramenta-ficticia.com', motivo: 'endereço inventado do robô' }] }),
  });
  const v = varrerArvore(contexto(dir));
  assert.deepEqual(v.achados.map(linhaDoAchado), ['a.txt:6:22  email', 'a.txt:7:41  email', 'a.txt:8:46  email',
    'a.txt:9:7  email', 'a.txt:9:47  email']);
});

test('DP7: home: as formas escapadas, /Users e C:\\Users são achado; usuário de sistema, marcador e URL não', () => {
  const dir = repo('home', {
    'a.txt': [
      `regex: /\\/home\\/fulana-de-teste/`,
      `json: "\\\\/home\\\\/fulana-de-teste"`,
      'mac: /Users/fulana-de-teste/repo',
      'win: C:\\Users\\fulana-de-teste\\repo',
      'acento: /home/joão-ficticio/x',
      'sistema: /home/runner/work /home/ubuntu /home/user /home/usuario /home/<usuario>/x /home/.cache',
      'url: https://site-ficticio.com.br/home/pagina, ./home/relativo, app/home/page.tsx e /tmp/ensaio/home/falsa',
      'silverblue: /var/home/fulana-de-teste/repo e file:///home/fulana-de-teste/x',
    ].join('\n') + '\n',
  });
  const v = varrerArvore(contexto(dir));
  assert.deepEqual(v.achados.map(linhaDoAchado), ['a.txt:1:8  home', 'a.txt:2:8  home', 'a.txt:3:6  home', 'a.txt:4:6  home',
    'a.txt:5:9  home', 'a.txt:8:17  home', 'a.txt:8:51  home']);
});

test('DP8: hostname: cada formato de máquina é achado; maquina-a e palavras comuns não', () => {
  const linhas = ['fulana-pc', 'Fulanas-MacBook-Pro', 'sala-2-desktop', 'DESKTOP-AB12CD3', 'WIN-ABCDEFGH123', 'ip-10-0-1-23',
    'vps-1a2b3c4d', 'srv123456', 'vmi654321', 'ubuntu-s-1vcpu-1gb-nyc1-01', 'srvxyz42'];
  const dir = repo('hostname', { 'a.txt': linhas.map((l) => `maquina ${l} fim`).join('\n') + '\nmaquina-a e maquina-b; o desktop e o notebook; servidor srv; ip-10\n' });
  const v = varrerArvore(contexto(dir));
  assert.deepEqual(v.achados.map(linhaDoAchado), linhas.map((_, i) => `a.txt:${i + 1}:9  hostname`));
});

test('DP9: exceção por caminho, por padrão e por valor silencia só o que diz, nunca a lista local; o arquivo de exceções só pela lista', () => {
  const arquivoDaLista = lista(TERMO_FICTICIO);
  const dir = repo('excecoes', {
    'core/test/fixture.ts': `${HOME_FICTICIA} ${EMAIL_FICTICIO} ${TERMO_FICTICIO}\n`,
    'docs/guia.md': `${HOME_FICTICIA} /home/outra-ficticia ${MAQUINA_FICTICIA}\n`,
    [ARQUIVO_DAS_EXCECOES]: JSON.stringify({
      contrato: 'ork.privado/v1',
      excecoes: [
        { padrao: 'home', caminho: 'core/test/**', valor: HOME_FICTICIA, motivo: 'home inventada da fixture' },
        { padrao: 'email', caminho: 'core/test/**', valor: EMAIL_FICTICIO, motivo: 'e-mail inventado da fixture' },
        { padrao: 'home', valor: HOME_FICTICIA, motivo: 'exemplo de documentação' },
        { padrao: 'hostname', caminho: 'docs/*.md', valor: 'fulana-*', motivo: 'máquina inventada do guia' },
        { padrao: 'email', valor: `${TERMO_FICTICIO}@x.com.br`, motivo: 'o arquivo de exceções só passa pela lista local' },
      ],
    }, null, 2),
  });
  const v = varrerArvore(contexto(dir, arquivoDaLista));
  assert.deepEqual(v.achados.map(linhaDoAchado), [
    'core/test/fixture.ts:1:55  lista-local (termo 1)',
    'docs/guia.md:1:23  home',
    `${ARQUIVO_DAS_EXCECOES}:29:17  lista-local (termo 1)`,
  ]);
});

test('DP10: arquivo de exceções fora do contrato recusa a varredura com o motivo', () => {
  const casos: [unknown, RegExp][] = [
    [{ contrato: 'ork.privado/v9' }, /"contrato" tem de ser "ork\.privado\/v1"/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: 'home', valor: '/home/x' }] }, /excecoes\[0\] sem motivo/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: 'telefone', valor: 'x', motivo: 'm' }] }, /excecoes\[0\]\.padrao tem de ser/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: '*', valor: '/home/x', motivo: 'm' }] }, /excecoes\[0\]\.padrao tem de ser/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: 'home', motivo: 'm' }] }, /excecoes\[0\] sem valor\/trecho/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: 'home', valor: '*', motivo: 'm' }] }, /valor não pode ser curinga global/],
    [{ contrato: 'ork.privado/v1', excecoes: [{ padrao: 'home', caminho: '**', valor: '/home/x', motivo: 'm' }] }, /caminho não pode ser curinga global/],
    [{ contrato: 'ork.privado/v1', extra: 1 }, /chave desconhecida: extra/],
    [{ contrato: 'ork.privado/v1', emailsPermitidos: ['antigo@example.com'] }, /emailsPermitidos\[0\] não é um objeto/],
    [{ contrato: 'ork.privado/v1', emailsPermitidos: [{ valor: '*@empresa.test', motivo: 'amplo' }] }, /endereço exato, sem curinga/],
    [{ contrato: 'ork.privado/v1', emailsPermitidos: [{ valor: 'robo@empresa.test' }] }, /emailsPermitidos\[0\] sem motivo/],
  ];
  for (const [conteudo, motivo] of casos) {
    const dir = repo('excecoes-invalidas', { [ARQUIVO_DAS_EXCECOES]: JSON.stringify(conteudo) });
    const c = contextoDaVarredura(dir, null, { ORK_TERMOS_PRIVADOS: path.join(dir, 'nao-existe.txt') });
    assert.equal(c.ok, false, JSON.stringify(conteudo));
    assert.match(c.ok ? '' : c.erro, motivo);
  }
  const quebrado = repo('excecoes-quebradas', { [ARQUIVO_DAS_EXCECOES]: '{ nao e json' });
  const c = contextoDaVarredura(quebrado, null, { ORK_TERMOS_PRIVADOS: path.join(quebrado, 'nao-existe.txt') });
  assert.match(c.ok ? '' : c.erro, /orkastery\.privado\.json fora do contrato ork\.privado\/v1: não é JSON/);
});

test('DP11: exceção sem uso aparece só pelo índice e padrão, sem serializar valor, caminho ou e-mail', () => {
  const dir = repo('sem-uso', {
    'a.txt': `${HOME_FICTICIA}\n`,
    [ARQUIVO_DAS_EXCECOES]: JSON.stringify({ contrato: 'ork.privado/v1',
      emailsPermitidos: [{ valor: 'arquivo-sensivel@antiga-ficticia.test', motivo: 'endereço inventado que saiu' }], excecoes: [
      { padrao: 'home', valor: HOME_FICTICIA, motivo: 'exemplo' },
      { padrao: 'hostname', valor: 'velha-pc', motivo: 'exemplo que saiu' },
    ] }),
  });
  const v = varrerArvore(contexto(dir));
  assert.deepEqual(v.achados, []);
  assert.deepEqual(v.excecoes.semUso, ['excecoes[1] hostname', 'emailsPermitidos[0] email']);
  const texto = relatorioDoDadoPrivado(v).join('\n');
  assert.match(texto, /aviso {8}exceção sem uso, revise no PR: excecoes\[1\] hostname/);
  for (const privado of ['velha-pc', 'arquivo-sensivel@antiga-ficticia.test']) {
    assert.equal((texto + JSON.stringify(v)).includes(privado), false);
  }
  const base = git(dir, 'rev-parse', 'HEAD');
  assert.equal(relatorioDoDadoPrivado(varrerDiff(contexto(dir), { sha: base, ref: 'main' })).join('\n').includes('sem uso'), false);
});

test('DP12: o diff: só as linhas acrescentadas contra a base, os não rastreados inteiros e os nomes acrescentados', () => {
  const arquivoDaLista = lista(TERMO_FICTICIO);
  const dir = repo('diff', {
    'velho.txt': `linha da base com ${EMAIL_FICTICIO}\nsegunda\n`,
    [`ja-na-base-${TERMO_FICTICIO}.txt`]: 'nada\n',
  });
  const base = git(dir, 'rev-parse', 'HEAD');
  // Commitado na thread: uma linha nova no arquivo velho e um arquivo novo com o termo no nome.
  escrever(dir, { 'velho.txt': `linha da base com ${EMAIL_FICTICIO}\nsegunda\nnova ${HOME_FICTICIA}\n`,
    [`novo-${TERMO_FICTICIO}.md`]: 'limpo\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'thread');
  // Ainda não commitado: uma linha num arquivo rastreado e um arquivo solto.
  fs.appendFileSync(path.join(dir, 'velho.txt'), `rodou em ${MAQUINA_FICTICIA}\n`);
  escrever(dir, { 'solto/notas.txt': `um\n${EMAIL_FICTICIO}\n` });
  const v = varrerDiff(contexto(dir, arquivoDaLista), { sha: base, ref: 'main' });
  assert.deepEqual(v.achados.map(linhaDoAchado), [
    'novo-[omitido].md  nome do arquivo: lista-local (termo 1)',
    'velho.txt:3:6  home',
    'velho.txt:4:10  hostname',
    'solto/notas.txt:2:1  email',
  ]);
  assert.deepEqual(v.escopo, [{ tipo: 'diff', base, ref: 'main' }]);
  assert.equal(v.linhas, 2 + 3);
});

test('DP13: a base da thread: merge-base com origin/<base>, senão a base local, senão o commit carimbado; sem nenhuma, null', () => {
  const dir = repo('base', { 'a.txt': 'a\n' });
  const primeiro = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'ork/thread-ficticia');
  escrever(dir, { 'b.txt': 'b\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'thread');
  assert.deepEqual(baseDaThread(dir, 'main'), { sha: primeiro, ref: 'main' });
  // A ponta do remoto andou na main: a merge-base com origin/main vale antes da base local.
  git(dir, 'checkout', '-q', 'main');
  escrever(dir, { 'c.txt': 'c\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main andou');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', 'ork/thread-ficticia');
  git(dir, 'merge', '-q', '--no-edit', 'origin/main');
  const ponta = git(dir, 'rev-parse', 'origin/main');
  assert.deepEqual(baseDaThread(dir, 'main'), { sha: ponta, ref: 'origin/main' });
  // Sem nenhuma das duas, o commit carimbado ancestral; sem ele, null.
  assert.deepEqual(baseDaThread(dir, 'base-que-nao-existe', primeiro), { sha: primeiro, ref: null });
  assert.equal(baseDaThread(dir, 'base-que-nao-existe', 'f'.repeat(40)), null);
  assert.equal(baseDaThread(dir, 'base-que-nao-existe'), null);
});

test('DP14: texto avulso e conteúdo binário são varridos; link simbólico é lido pelo alvo, sem segui-lo', () => {
  const arquivoDaLista = lista(TERMO_FICTICIO);
  const dir = repo('texto', {});
  const c = contexto(dir, arquivoDaLista);
  const bundle = JSON.stringify({ claims: [{ alegacao: `roda em ${TERMO_FICTICIO}` }] }, null, 2);
  assert.deepEqual(varrerTexto(c, '.ork-ci/ork-ficticia.json', bundle).achados.map(linhaDoAchado),
    ['.ork-ci/ork-ficticia.json:4:28  lista-local (termo 1)']);
  fs.writeFileSync(path.join(dir, `binario-${TERMO_FICTICIO}.bin`), Buffer.from([0, 1, 2, ...Buffer.from(TERMO_FICTICIO)]));
  fs.writeFileSync(path.join(dir, 'alvo-fora.txt'), `${EMAIL_FICTICIO}\n`);
  fs.symlinkSync(`${HOME_FICTICIA}/segredo.txt`, path.join(dir, 'atalho'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'binario e link');
  const v = varrerArvore(contexto(dir, arquivoDaLista));
  assert.deepEqual(v.achados.map(linhaDoAchado), [
    'alvo-fora.txt:1:1  email',
    'atalho:1:1  home',
    'binario-[omitido].bin  nome do arquivo: lista-local (termo 1)',
    'binario-[omitido].bin:1:4  lista-local (termo 1)',
  ]);
});

test('DP15: exceção por caminho e padrão cobre só o trecho dito e não esconde outro vazamento no arquivo', () => {
  const dir = repo('excecao-granular', {
    'core/test/fixture.ts': `${EMAIL_FICTICIO}\nvazamento@empresa-ficticia.com.br\n`,
    [ARQUIVO_DAS_EXCECOES]: JSON.stringify({ contrato: 'ork.privado/v1', excecoes: [
      { padrao: 'email', caminho: 'core/test/*.ts', valor: EMAIL_FICTICIO, motivo: 'endereço inventado da fixture' },
    ] }),
  });
  assert.deepEqual(varrerArvore(contexto(dir)).achados.map(linhaDoAchado), ['core/test/fixture.ts:2:1  email']);
});

test('DP16: a lista local exige arquivo comum do usuário com 0600 e nunca expõe o caminho indicado nem seu conteúdo', () => {
  const pasta = dirTemporario('dado-privado-lista-segura');
  const termo = 'marcador-privado-ficticio';
  const arquivo = path.join(pasta, `${termo}.txt`);
  fs.writeFileSync(arquivo, `${termo}\n`, { mode: 0o600 });
  const limpa = repo('lista-segura', { 'a.txt': 'limpo\n' });
  const aceita = contextoDaVarredura(limpa, null, { ORK_TERMOS_PRIVADOS: arquivo });
  assert.ok(aceita.ok);
  const serializado = JSON.stringify(varrerArvore(aceita.valor)) + relatorioDoDadoPrivado(varrerArvore(aceita.valor)).join('\n');
  assert.equal(serializado.includes(termo), false);
  assert.match(serializado, /ORK_TERMOS_PRIVADOS/);

  fs.chmodSync(arquivo, 0o644);
  const permissao = contextoDaVarredura(limpa, null, { ORK_TERMOS_PRIVADOS: arquivo });
  assert.equal(permissao.ok, false);
  assert.match(permissao.ok ? '' : permissao.erro, /permissão tem de ser 0600/);
  assert.equal(JSON.stringify(permissao).includes(termo), false);

  fs.chmodSync(arquivo, 0o600);
  const link = path.join(pasta, 'atalho.txt');
  fs.symlinkSync(arquivo, link);
  const simbolico = contextoDaVarredura(limpa, null, { ORK_TERMOS_PRIVADOS: link });
  assert.equal(simbolico.ok, false);
  assert.match(simbolico.ok ? '' : simbolico.erro, /link simbólico não é aceito/);

  const getuid = process.getuid;
  const uidAtual = typeof getuid === 'function' ? getuid() : 1000;
  Object.defineProperty(process, 'getuid', { configurable: true, value: () => uidAtual + 1 });
  try {
    const outroDono = lerListaLocal(null, null, { ORK_TERMOS_PRIVADOS: arquivo });
    assert.match(outroDono.recusada ?? '', /dono não é o usuário atual/);
    assert.equal(outroDono.presente, false);
  } finally {
    Object.defineProperty(process, 'getuid', { configurable: true, value: getuid });
  }
});
