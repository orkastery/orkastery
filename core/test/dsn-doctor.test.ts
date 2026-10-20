/**
 * RM-068 (ork-dsnforadoamb, T4): o `ork doctor` diz a fonte da DSN da memória e acusa a DSN no ambiente, pelo NOME
 * da variável e nunca pelo valor.
 *
 * Os casos `DD` chamam os checks com o ambiente injetado e rodam o CLI com ambiente montado do zero (`HOME`
 * temporário, `PATH` mínimo); toda DSN é inventada e nenhum caso lê, compara ou imprime o ambiente de quem roda a suíte.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checarChaveDeEmbedding, checarDsnNoAmbiente, checarFonteDaDsn } from '../src/doctor';
import { CAUSAS_DA_DSN, textoDaCausa } from '../src/dsn-da-memoria';
import { ativarLocale, msg, nomeDoCheck } from '../src/locale';
import { ManifestoCarregado } from '../src/manifest';
import { Check, Manifesto } from '../src/types';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { cenario, CLI, linhasEmPortugues, ork, PT } from './locale-apoio';

const DSN = 'postgres://usuario:senha-de-teste-inventada@localhost/teste';
const SENHA_INVENTADA = 'senha-de-teste-inventada';
const ARQUIVO = '~/.orkastery/segredos/teste.dsn';

interface PastaDoUsuario { dir: string; env: NodeJS.ProcessEnv; segredos: string; limpar: () => void }

function pastaDoUsuario(nome: string): PastaDoUsuario {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-dsn-doctor-${nome}-`)));
  const segredos = path.join(dir, 'segredos');
  fs.mkdirSync(segredos, { mode: 0o700 });
  return { dir, env: { ORK_USUARIO_DIR: dir }, segredos,
    limpar: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

function gravar(segredos: string, conteudo: string, modo = 0o600): void {
  const arquivo = path.join(segredos, 'teste.dsn');
  fs.writeFileSync(arquivo, conteudo);
  fs.chmodSync(arquivo, modo);
}

function carregadoCom(projeto: ProjetoDeTeste, memoria: Partial<Manifesto['memory']>): ManifestoCarregado {
  return { ...projeto.carregado, manifesto: { ...projeto.carregado.manifesto,
    memory: { ...projeto.carregado.manifesto.memory, mode: 'orkmind', database_url_env: '', ...memoria } } };
}

function texto(c: Check | null): string {
  return c ? `${c.nome}\n${c.detalhe}\n${c.correcao ?? ''}` : '';
}

function semSegredo(saida: string, rotulo: string, extras: readonly string[] = []): void {
  for (const proibido of [DSN, SENHA_INVENTADA, ...extras]) assert.ok(!saida.includes(proibido), `vazou em ${rotulo}`);
}

function emIngles<T>(fn: () => T): T {
  ativarLocale('en');
  try { return fn(); } finally { ativarLocale(undefined); }
}

test('DD1: fonte da DSN pelo ambiente presente diz o nome da variável e nunca o valor', () => {
  const projeto = projetoTemporario('dsn-dd1');
  try {
    const c = checarFonteDaDsn(carregadoCom(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN' }), { ORKASTERY_TESTE_DSN: DSN });
    assert.deepEqual(c, { nome: 'fonte da DSN', nivel: 'ok',
      detalhe: 'variável de ambiente ORKASTERY_TESTE_DSN, presente (valor nunca impresso)' });
    semSegredo(texto(c), 'fonte pelo ambiente');
  } finally { projeto.limpar(); }
});

test('DD2: fonte da DSN pelo ambiente ausente é aviso, com a correção que cita memory.database_url_file', () => {
  const projeto = projetoTemporario('dsn-dd2');
  try {
    const c = checarFonteDaDsn(carregadoCom(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN' }), {});
    assert.equal(c?.nivel, 'warn');
    assert.equal(c?.detalhe, 'variável de ambiente ORKASTERY_TESTE_DSN ausente: a memória cai para files');
    assert.match(c?.correcao ?? '', /memory\.database_url_file \(arquivo 0600 em ~\/\.orkastery\/segredos\/\)$/);
  } finally { projeto.limpar(); }
});

test('DD3: fonte da DSN pelo arquivo válido diz o rótulo, o dono e a permissão, sem o valor', () => {
  const projeto = projetoTemporario('dsn-dd3');
  const p = pastaDoUsuario('dd3');
  try {
    gravar(p.segredos, DSN);
    const c = checarFonteDaDsn(carregadoCom(projeto, { database_url_file: ARQUIVO }), p.env);
    assert.deepEqual(c, { nome: 'fonte da DSN', nivel: 'ok',
      detalhe: 'arquivo ORK_USUARIO_DIR/segredos/teste.dsn, do usuário que roda o ork, permissão 0600, uma linha (valor nunca impresso)' });
    semSegredo(texto(c), 'fonte pelo arquivo', [p.dir]);
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD4: arquivo com falha é aviso com o motivo, a causa e a correção do motivo, sem caminho real nem valor', () => {
  const projeto = projetoTemporario('dsn-dd4');
  const p = pastaDoUsuario('dd4');
  try {
    const casos: Array<[() => void, RegExp, RegExp]> = [
      [() => gravar(p.segredos, DSN, 0o644),
        /^arquivo ORK_USUARIO_DIR\/segredos\/teste\.dsn recusado \(dsn\.arquivo-inseguro\): permissão 0644 mais aberta que 0600; /,
        /chmod 600 ORK_USUARIO_DIR\/segredos\/teste\.dsn$/],
      [() => fs.rmSync(path.join(p.segredos, 'teste.dsn')),
        /recusado \(dsn\.arquivo-ausente\): não existe; a memória cai para files, sem outra fonte$/,
        /\(umask 077; cat > ORK_USUARIO_DIR\/segredos\/teste\.dsn\)$/],
      [() => gravar(p.segredos, `ORKMIND_DATABASE_URL=${DSN}`),
        /recusado \(dsn\.arquivo-invalido\): formato NOME=valor de arquivo de ambiente; grave só a DSN; /,
        /sem NOME= na frente$/],
    ];
    for (const [preparar, detalhe, correcao] of casos) {
      preparar();
      const c = checarFonteDaDsn(carregadoCom(projeto, { database_url_file: ARQUIVO }), p.env);
      assert.equal(c?.nivel, 'warn', String(detalhe));
      assert.match(c?.detalhe ?? '', detalhe);
      assert.match(c?.correcao ?? '', correcao);
      semSegredo(texto(c), String(detalhe), [p.dir]);
    }
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD5: sem fonte declarada, com modo files ou com a fonte de ambiente fora do despacho, os checks novos não aparecem', () => {
  const projeto = projetoTemporario('dsn-dd5');
  const p = pastaDoUsuario('dd5');
  try {
    gravar(p.segredos, DSN);
    assert.equal(checarFonteDaDsn(carregadoCom(projeto, {}), p.env), null);
    assert.equal(checarFonteDaDsn(carregadoCom(projeto, { mode: 'files', database_url_file: ARQUIVO }), p.env), null);
    assert.equal(checarDsnNoAmbiente(carregadoCom(projeto, {}), { ...p.env, QUALQUER: DSN }), null);
    assert.equal(checarDsnNoAmbiente(carregadoCom(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN' }),
      { ORKASTERY_TESTE_DSN: DSN }), null);
    // Fonte de arquivo que falha fora do despacho: nada a comparar (o check da fonte já avisa).
    gravar(p.segredos, DSN, 0o644);
    assert.equal(checarDsnNoAmbiente(carregadoCom(projeto, { database_url_file: ARQUIVO }), { ...p.env, QUALQUER: DSN }), null);
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD6: na sessão despachada, a DSN do projeto e as URLs com senha saem pelo nome, em ordem, como aviso', () => {
  const projeto = projetoTemporario('dsn-dd6');
  try {
    const env: NodeJS.ProcessEnv = { ORK_DISPATCH_THREAD: 'ork-teste', ORKASTERY_TESTE_DSN: DSN,
      Z_CACHE: 'redis://:outra-senha-inventada-longa@localhost:6379/0', A_SERVICO: 'https://usuario:token-inventado@localhost/api',
      SEM_SENHA: 'https://localhost/caminho' };
    const c = checarDsnNoAmbiente(carregadoCom(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN' }), env);
    assert.equal(c?.nivel, 'warn');
    assert.equal(c?.detalhe, 'no ambiente desta sessão despachada, o agente lê com env: ORKASTERY_TESTE_DSN (DSN do projeto), ' +
      'A_SERVICO (URL com senha), Z_CACHE (URL com senha) (valor nunca impresso)');
    assert.match(c?.correcao ?? '', /^tire essas variáveis do ambiente que o host repassa aos agentes/);
    semSegredo(texto(c), 'sessão despachada', ['outra-senha-inventada-longa', 'token-inventado']);
    // Sem fonte declarada, o detector de URL com senha segue valendo na sessão despachada (G6).
    const semFonte = checarDsnNoAmbiente(carregadoCom(projeto, {}), { ORK_DISPATCH_ID: 'id-inventado', OUTRA_BASE: DSN });
    assert.equal(semFonte?.detalhe, 'no ambiente desta sessão despachada, o agente lê com env: OUTRA_BASE (URL com senha) (valor nunca impresso)');
  } finally { projeto.limpar(); }
});

test('DD7: na sessão despachada sem DSN nem URL com senha, o check diz ok', () => {
  const projeto = projetoTemporario('dsn-dd7');
  const p = pastaDoUsuario('dd7');
  try {
    gravar(p.segredos, DSN);
    const c = checarDsnNoAmbiente(carregadoCom(projeto, { database_url_file: ARQUIVO }),
      { ...p.env, ORK_DISPATCH_THREAD: 'ork-teste', PATH: '/usr/bin:/bin' });
    assert.deepEqual(c, { nome: 'DSN no ambiente', nivel: 'ok', detalhe: 'nenhuma DSN nem URL com senha no ambiente desta sessão despachada' });
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD8: fora do despacho, com a fonte de arquivo, a DSN do arquivo repetida no ambiente é aviso; limpa, ok', () => {
  const projeto = projetoTemporario('dsn-dd8');
  const p = pastaDoUsuario('dd8');
  try {
    gravar(p.segredos, DSN);
    const carregado = carregadoCom(projeto, { database_url_file: ARQUIVO });
    const repetida = checarDsnNoAmbiente(carregado, { ...p.env, VELHA_DSN: DSN, SO_A_SENHA: SENHA_INVENTADA, OUTRA_URL: 'redis://:x-y@h/0' });
    assert.equal(repetida?.nivel, 'warn');
    assert.equal(repetida?.detalhe, 'a DSN do arquivo também está no ambiente deste processo, em SO_A_SENHA, VELHA_DSN: ' +
      'quem herda este ambiente a vê (valor nunca impresso)');
    semSegredo(texto(repetida), 'processo');
    const limpa = checarDsnNoAmbiente(carregado, { ...p.env, OUTRA_URL: 'redis://:x-y@h/0' });
    assert.deepEqual(limpa, { nome: 'DSN no ambiente', nivel: 'ok', detalhe: 'a DSN do arquivo não está no ambiente deste processo' });
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD9: a chave de embedding é comparada com a DSN do arquivo quando ele é a fonte', () => {
  const projeto = projetoTemporario('dsn-dd9');
  const p = pastaDoUsuario('dd9');
  try {
    gravar(p.segredos, DSN);
    const embedding = { provider: 'openrouter', model: 'openai/text-embedding-3-small', api_key_env: 'ORKASTERY_EMBEDDING_API_KEY' };
    const env = { ...p.env, ORKASTERY_EMBEDDING_API_KEY: SENHA_INVENTADA };
    const comArquivo = checarChaveDeEmbedding(carregadoCom(projeto, { database_url_file: ARQUIVO, embedding: embedding as never }), env);
    assert.equal(comArquivo.nivel, 'fail', 'a senha da DSN do arquivo nunca vai ao provider');
    const semFonte = checarChaveDeEmbedding(carregadoCom(projeto, { embedding: embedding as never }), env);
    assert.equal(semFonte.nivel, 'ok', 'controle: sem a DSN, a mesma chave passa');
    semSegredo(`${texto(comArquivo)}\n${texto(semFonte)}`, 'chave de embedding');
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD10: em inglês, os checks novos saem sem pt-BR e com os nomes traduzidos', () => {
  const projeto = projetoTemporario('dsn-dd10');
  const p = pastaDoUsuario('dd10');
  try {
    assert.equal(nomeDoCheck('fonte da DSN', 'en'), 'DSN source');
    assert.equal(nomeDoCheck('DSN no ambiente', 'en'), 'DSN in environment');
    const arquivo = carregadoCom(projeto, { database_url_file: ARQUIVO });
    const ambiente = carregadoCom(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN' });
    const textos: string[] = [];
    gravar(p.segredos, DSN);
    textos.push(...emIngles(() => [checarFonteDaDsn(arquivo, p.env), checarFonteDaDsn(ambiente, { ORKASTERY_TESTE_DSN: DSN }),
      checarFonteDaDsn(ambiente, {}),
      checarDsnNoAmbiente(arquivo, { ...p.env, ORK_DISPATCH_THREAD: 't', VELHA: DSN, CACHE: 'redis://:x-y@h/0' }),
      checarDsnNoAmbiente(arquivo, { ...p.env, ORK_DISPATCH_THREAD: 't' }), checarDsnNoAmbiente(arquivo, { ...p.env, VELHA: DSN }),
      checarDsnNoAmbiente(arquivo, p.env)].map(texto)));
    for (const modo of [0o644]) {
      gravar(p.segredos, DSN, modo);
      textos.push(emIngles(() => texto(checarFonteDaDsn(arquivo, p.env))));
    }
    fs.rmSync(path.join(p.segredos, 'teste.dsn'));
    textos.push(emIngles(() => texto(checarFonteDaDsn(arquivo, p.env))));
    gravar(p.segredos, `${DSN}\n${DSN}`);
    textos.push(emIngles(() => texto(checarFonteDaDsn(arquivo, p.env))));
    // O nome do check (`nome`) é a chave interna em pt-BR; quem traduz é o relatório.
    const corpo = textos.map((t) => t.split('\n').slice(1).join('\n')).join('\n');
    assert.deepEqual(linhasEmPortugues(corpo), []);
    semSegredo(corpo, 'inglês');
  } finally { p.limpar(); projeto.limpar(); }
});

test('DD11: o texto pt-BR de cada causa no catálogo do doctor é o do resolvedor, e o inglês é outro', () => {
  for (const causa of CAUSAS_DA_DSN) {
    assert.equal(msg().doctor.dsnCausa(causa, '0644'), textoDaCausa(causa, '0644'), causa);
    const ingles = emIngles(() => msg().doctor.dsnCausa(causa, '0644'));
    assert.notEqual(ingles, textoDaCausa(causa, '0644'), causa);
    assert.notEqual(ingles, causa, `${causa} sem texto em inglês`);
  }
});

/** O `ork doctor` do CLI com ambiente montado do zero e os extras pedidos. */
function doctorDoCli(dir: string, casa: string, bin: string, extras: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, TZ: 'America/New_York', LANG: 'pt_BR.UTF-8', PATH: bin, ...extras },
  });
  return { status: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
}

test('DD12: o ork doctor do CLI, numa sessão despachada com a fonte de arquivo, mostra os nomes e não a DSN', () => {
  const c = cenario('dsn-dd12');
  try {
    const manifesto = path.join(c.dir, 'orkastery.yaml');
    fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace(/^ {2}mode: files$/m, '  mode: orkmind')
      .replace(/^ {2}database_url_env: ""$/m, `  database_url_file: "${ARQUIVO}"`));
    const segredos = path.join(c.casa, '.orkastery', 'segredos');
    fs.mkdirSync(segredos, { recursive: true, mode: 0o700 });
    gravar(segredos, DSN);
    const extras = { ORK_DISPATCH_THREAD: 'ork-teste-dsn', VAR_DSN_INVENTADA: DSN };
    const r = doctorDoCli(c.dir, c.casa, c.bin, extras);
    assert.match(r.stdout, /\[ok\] +fonte da DSN +arquivo ~\/\.orkastery\/segredos\/teste\.dsn, do usuário que roda o ork, permissão 0600, uma linha \(valor nunca impresso\)\n/);
    assert.match(r.stdout, /\[warn\] +DSN no ambiente +no ambiente desta sessão despachada, o agente lê com env: VAR_DSN_INVENTADA \(DSN do projeto\) \(valor nunca impresso\)\n/);
    semSegredo(r.saida, 'doctor em texto', [segredos]);
    const json = doctorDoCli(c.dir, c.casa, c.bin, extras, '--json');
    const checks = (JSON.parse(json.stdout) as { checks: Check[] }).checks;
    assert.equal(checks.find((x) => x.nome === 'fonte da DSN')?.nivel, 'ok');
    assert.equal(checks.find((x) => x.nome === 'DSN no ambiente')?.nivel, 'warn');
    semSegredo(json.saida, 'doctor --json', [segredos]);
  } finally { c.limpar(); }
});

test('DD13: o ork doctor do CLI sem fonte declarada e fora do despacho não tem os checks novos', () => {
  const c = cenario('dsn-dd13');
  try {
    const r = ork(c, PT, false, 'doctor');
    assert.ok(r.stdout.includes('regime de memoria'), 'o doctor rodou até a memória');
    assert.ok(!r.stdout.includes('fonte da DSN') && !r.stdout.includes('DSN no ambiente'), r.stdout);
  } finally { c.limpar(); }
});
