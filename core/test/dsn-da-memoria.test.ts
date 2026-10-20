/**
 * RM-068 (ork-dsnforadoamb): a DSN da memória fora do ambiente dos agentes.
 *
 * Os casos `DM` provam o resolvedor (`core/src/dsn-da-memoria.ts`) e a chave `memory.database_url_file` do manifesto
 * (T2); os casos `DR`, os consumidores pelo resolvedor e a degradação tipada (T3). Toda DSN é inventada, a pasta do
 * usuário do `ork` é temporária (`ORK_USUARIO_DIR` no ambiente injetado, ou no do processo, restaurado no `finally`) e
 * nenhum caso lê, compara ou imprime o ambiente de quem roda a suíte.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  arquivoDaDsnValido, DsnDaMemoria, fragmentosDaDsn, LIMITE_DO_ARQUIVO_DA_DSN, resolverDsn, rotuloDoArquivoDaDsn,
  variaveisComDsn, variaveisComUrlComSenha,
} from '../src/dsn-da-memoria';
import { carregarManifesto } from '../src/manifest';
import { configDoManifesto, DriverCliOrkMind, DriverEmMemoria, resolverRegime } from '../src/orkmind';
import { abrirMemoria, textoDoEstado } from '../src/memoria';
import { BRAIN_API, brainClient, BrainRequest } from '../src/company-brain-client';
import { brainAdmin } from '../src/company-brain-migration';
import { CONTRACT_HASH } from '../src/company-brain-contract';
import { EntradaNova, Manifesto } from '../src/types';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { createHash } from 'node:crypto';

/** DSN inventada; a senha tem mais de 12 caracteres, então também é fragmento proibido (D6). */
const DSN = 'postgres://usuario:senha-de-teste-inventada@localhost/teste';
const SENHA_INVENTADA = 'senha-de-teste-inventada';
const ARQUIVO = '~/.orkastery/segredos/teste.dsn';

interface PastaDoUsuario { dir: string; env: NodeJS.ProcessEnv; segredos: string; limpar: () => void }

/** Pasta do usuário temporária com a pasta de segredos já criada (0700). */
function pastaDoUsuario(nome: string): PastaDoUsuario {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-dsn-${nome}-`)));
  const segredos = path.join(dir, 'segredos');
  fs.mkdirSync(segredos, { mode: 0o700 });
  return { dir, env: { ORK_USUARIO_DIR: dir }, segredos,
    limpar: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Grava o arquivo da DSN com o modo pedido (o `chmod` depois do `write` não depende da umask). */
function gravar(p: PastaDoUsuario, conteudo: string | Buffer, modo = 0o600, nome = 'teste.dsn'): string {
  const arquivo = path.join(p.segredos, nome);
  fs.writeFileSync(arquivo, conteudo);
  fs.chmodSync(arquivo, modo);
  return arquivo;
}

function semValor(r: DsnDaMemoria): void {
  const texto = JSON.stringify({ ...r, dsn: '' });
  for (const proibido of [DSN, SENHA_INVENTADA]) assert.ok(!texto.includes(proibido), `vazou no resultado: ${r.falha}`);
}

function comArquivo(memory: { database_url_file?: string; database_url_env?: string } = { database_url_file: ARQUIVO }) {
  return { database_url_env: '', ...memory };
}

/** Reescreve o bloco `memory` do manifesto do projeto de teste e o carrega de novo. */
function manifestoCom(projeto: ProjetoDeTeste, linhas: string, modo: 'files' | 'orkmind' = 'orkmind') {
  const caminho = path.join(projeto.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(caminho, 'utf8');
  assert.match(bruto, /^ {2}database_url_env: ""$/m);
  fs.writeFileSync(caminho, bruto.replace(/^ {2}mode: files$/m, `  mode: ${modo}`)
    .replace(/^ {2}database_url_env: ""$/m, linhas), 'utf8');
  const carregado = carregarManifesto(projeto.dir);
  assert.ok(carregado);
  return carregado;
}

test('DM1: memory.database_url_file aceita só ~/.orkastery/segredos/<nome>', () => {
  for (const bom of ['~/.orkastery/segredos/teste.dsn', '~/.orkastery/segredos/orkastery-brain.dsn', '~/.orkastery/segredos/a_b.1']) {
    assert.equal(arquivoDaDsnValido(bom), true, bom);
  }
  for (const ruim of ['postgres://u:p@localhost/x', '/etc/orkastery/teste.dsn', 'segredos/teste.dsn', './teste.dsn',
    '~/.orkastery/segredos/../teste.dsn', '~/.orkastery/segredos/sub/teste.dsn', '~/.ssh/id_ed25519',
    '~fulano/.orkastery/segredos/teste.dsn', '~/.orkastery/segredos/', '~/.orkastery/segredos/.oculto', '~/.orkastery/teste.dsn']) {
    assert.equal(arquivoDaDsnValido(ruim), false, ruim);
  }
  const projeto = projetoTemporario('dsn-dm1');
  const outro = projetoTemporario('dsn-dm1b');
  try {
    const bom = manifestoCom(projeto, `  database_url_env: ""\n  database_url_file: "${ARQUIVO}"`);
    assert.deepEqual(bom.erros, []);
    assert.equal(bom.manifesto.memory.database_url_file, ARQUIVO);
    const ruim = manifestoCom(outro, '  database_url_file: "~/.ssh/id_ed25519"');
    assert.ok(ruim.erros.some((e) => e.startsWith('memory.database_url_file invalido (valor omitido)')), ruim.erros.join('\n'));
  } finally { projeto.limpar(); outro.limpar(); }
});

test('DM2: as duas fontes juntas reprovam o manifesto (G2)', () => {
  const projeto = projetoTemporario('dsn-dm2');
  try {
    const carregado = manifestoCom(projeto, `  database_url_env: "ORKASTERY_TESTE_DSN"\n  database_url_file: "${ARQUIVO}"`);
    assert.ok(carregado.erros.some((e) => e.includes('memory.database_url_env e memory.database_url_file sao exclusivos')),
      carregado.erros.join('\n'));
  } finally { projeto.limpar(); }
});

test('DM3: nenhum erro do manifesto repete o valor das duas chaves (D3)', () => {
  const casos = [
    '  database_url_env: "host=localhost password=senha-de-teste-inventada"',
    `  database_url_env: ""\n  database_url_file: "${DSN}"`,
    '  database_url_env: ""\n  database_url_file: "host=localhost password=senha-de-teste-inventada"',
    '  database_url_env: ""\n  database_url_file: "/etc/orkastery/senha-de-teste-inventada"',
  ];
  for (const [i, linhas] of casos.entries()) {
    const projeto = projetoTemporario(`dsn-dm3-${i}`);
    try {
      const carregado = manifestoCom(projeto, linhas);
      assert.ok(carregado.erros.length > 0, linhas);
      const texto = carregado.erros.join('\n') + carregado.avisos.join('\n');
      assert.ok(!texto.includes(SENHA_INVENTADA) && !texto.includes(DSN), `caso ${i} repetiu o valor`);
    } finally { projeto.limpar(); }
  }
});

test('DM4: orkmind sem fonte avisa citando as duas chaves; com a fonte de arquivo, não avisa', () => {
  const projeto = projetoTemporario('dsn-dm4');
  const outro = projetoTemporario('dsn-dm4b');
  try {
    const semFonte = manifestoCom(projeto, '  database_url_env: ""');
    assert.ok(semFonte.avisos.some((a) => a.includes('memory.database_url_file nem memory.database_url_env')), semFonte.avisos.join('\n'));
    const fonteDeArquivo = manifestoCom(outro, `  database_url_env: ""\n  database_url_file: "${ARQUIVO}"`);
    assert.ok(!fonteDeArquivo.avisos.some((a) => a.includes('database_url')), fonteDeArquivo.avisos.join('\n'));
  } finally { projeto.limpar(); outro.limpar(); }
});

test('DM5: arquivo 0600 do usuário dá a DSN, com o rótulo da pasta e a permissão', () => {
  const p = pastaDoUsuario('dm5');
  try {
    gravar(p, `${DSN}\n`);
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.deepEqual(r, { fonte: 'arquivo', rotulo: 'ORK_USUARIO_DIR/segredos/teste.dsn', dsn: DSN, falha: null, detalhe: '',
      permissao: '0600' });
  } finally { p.limpar(); }
});

test('DM6: arquivo 0400 também passa (G4: só o mais aberto que 0600 é recusado)', () => {
  const p = pastaDoUsuario('dm6');
  try {
    gravar(p, DSN, 0o400);
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(r.falha, null);
    assert.equal(r.dsn, DSN);
    assert.equal(r.permissao, '0400');
  } finally { p.limpar(); }
});

test('DM7: 0640, 0644 e 0700 são inseguros e dizem a permissão', () => {
  const p = pastaDoUsuario('dm7');
  try {
    for (const modo of [0o640, 0o644, 0o700, 0o604]) {
      gravar(p, DSN, modo);
      const r = resolverDsn(comArquivo(), { env: p.env });
      const texto = modo.toString(8).padStart(4, '0');
      assert.equal(r.falha, 'dsn.arquivo-inseguro', texto);
      assert.equal(r.dsn, '');
      assert.equal(r.detalhe, `ORK_USUARIO_DIR/segredos/teste.dsn: permissão ${texto} mais aberta que 0600`);
      semValor(r);
    }
  } finally { p.limpar(); }
});

test('DM8: arquivo de outro dono é inseguro, e sem conferência de dono também', () => {
  const p = pastaDoUsuario('dm8');
  try {
    gravar(p, DSN);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const outro = resolverDsn(comArquivo(), { env: p.env, uid: uid + 1 });
    assert.equal(outro.falha, 'dsn.arquivo-inseguro');
    assert.match(outro.detalhe, /o dono não é o usuário que roda o ork$/);
    const semPlataforma = resolverDsn(comArquivo(), { env: p.env, uid: null });
    assert.equal(semPlataforma.falha, 'dsn.arquivo-inseguro');
    assert.match(semPlataforma.detalhe, /esta plataforma não confere dono nem permissão$/);
    for (const r of [outro, semPlataforma]) { assert.equal(r.dsn, ''); semValor(r); }
  } finally { p.limpar(); }
});

test('DM9: link simbólico é recusado, mesmo para arquivo 0600 do usuário', () => {
  const p = pastaDoUsuario('dm9');
  try {
    const alvo = path.join(p.dir, 'fora.dsn');
    fs.writeFileSync(alvo, DSN);
    fs.chmodSync(alvo, 0o600);
    fs.symlinkSync(alvo, path.join(p.segredos, 'teste.dsn'));
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(r.falha, 'dsn.arquivo-invalido');
    assert.match(r.detalhe, /link simbólico não é aceito$/);
    assert.equal(r.dsn, '');
    semValor(r);
  } finally { p.limpar(); }
});

test('DM10: pasta no lugar do arquivo é inválida', () => {
  const p = pastaDoUsuario('dm10');
  try {
    fs.mkdirSync(path.join(p.segredos, 'teste.dsn'));
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(r.falha, 'dsn.arquivo-invalido');
    assert.match(r.detalhe, /não é arquivo comum$/);
  } finally { p.limpar(); }
});

test('DM11: arquivo ou pasta de segredos ausente dá dsn.arquivo-ausente', () => {
  const p = pastaDoUsuario('dm11');
  try {
    const semArquivo = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(semArquivo.falha, 'dsn.arquivo-ausente');
    assert.equal(semArquivo.detalhe, 'ORK_USUARIO_DIR/segredos/teste.dsn: não existe');
    fs.rmSync(p.segredos, { recursive: true });
    const semPasta = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(semPasta.falha, 'dsn.arquivo-ausente');
    assert.equal(semPasta.fonte, 'arquivo');
  } finally { p.limpar(); }
});

test('DM12: vazio, só espaço, duas linhas, mais de 4 KiB e caractere de controle são inválidos', () => {
  const p = pastaDoUsuario('dm12');
  try {
    const casos: Array<[string | Buffer, RegExp]> = [
      ['', /: vazio$/],
      ['   \n\n', /: vazio$/],
      [`${DSN}\n${DSN}\n`, /: mais de uma linha$/],
      [`${DSN}${' '.repeat(LIMITE_DO_ARQUIVO_DA_DSN)}x`, /: maior que 4 KiB$/],
      [`postgres://usuario:${SENHA_INVENTADA}\u0001@localhost/teste`, /: caractere de controle$/],
    ];
    for (const [conteudo, esperado] of casos) {
      gravar(p, conteudo);
      const r = resolverDsn(comArquivo(), { env: p.env });
      assert.equal(r.falha, 'dsn.arquivo-invalido', String(esperado));
      assert.match(r.detalhe, esperado);
      assert.equal(r.dsn, '');
      semValor(r);
    }
  } finally { p.limpar(); }
});

test('DM13: a forma NOME=valor de arquivo de ambiente é recusada sem repetir o valor', () => {
  const p = pastaDoUsuario('dm13');
  try {
    gravar(p, `ORKMIND_DATABASE_URL=${DSN}\n`);
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(r.falha, 'dsn.arquivo-invalido');
    assert.match(r.detalhe, /formato NOME=valor de arquivo de ambiente; grave só a DSN$/);
    semValor(r);
  } finally { p.limpar(); }
});

test('DM14: com o arquivo declarado, a variável nunca é lida (sem fallback entre fontes)', () => {
  const p = pastaDoUsuario('dm14');
  try {
    const env = { ...p.env, ORKASTERY_TESTE_DSN: DSN };
    const r = resolverDsn({ database_url_env: 'ORKASTERY_TESTE_DSN', database_url_file: ARQUIVO }, { env });
    assert.equal(r.fonte, 'arquivo');
    assert.equal(r.falha, 'dsn.arquivo-ausente');
    assert.equal(r.dsn, '');
  } finally { p.limpar(); }
});

test('DM15: a fonte de ambiente segue como hoje, e sem fonte dá dsn.nao-declarado', () => {
  const presente = resolverDsn({ database_url_env: 'ORKASTERY_TESTE_DSN' }, { env: { ORKASTERY_TESTE_DSN: DSN } });
  assert.deepEqual(presente, { fonte: 'ambiente', rotulo: 'ORKASTERY_TESTE_DSN', dsn: DSN, falha: null, detalhe: '' });
  for (const env of [{}, { ORKASTERY_TESTE_DSN: '   ' }]) {
    const ausente = resolverDsn({ database_url_env: 'ORKASTERY_TESTE_DSN' }, { env });
    assert.equal(ausente.falha, 'dsn.env-ausente');
    assert.equal(ausente.dsn, '');
  }
  const nenhuma = resolverDsn({ database_url_env: '' }, { env: { ORKASTERY_TESTE_DSN: DSN } });
  assert.equal(nenhuma.fonte, 'nenhuma');
  assert.equal(nenhuma.falha, 'dsn.nao-declarado');
  assert.equal(nenhuma.dsn, '');
});

test('DM16: o rótulo segue a pasta do usuário e nunca é caminho absoluto (D2)', () => {
  assert.equal(rotuloDoArquivoDaDsn('teste.dsn', {}), '~/.orkastery/segredos/teste.dsn');
  assert.equal(rotuloDoArquivoDaDsn('teste.dsn', { ORKASTERY_HOME: '/tmp/x' }), 'ORKASTERY_HOME/segredos/teste.dsn');
  assert.equal(rotuloDoArquivoDaDsn('teste.dsn', { ORKASTERY_HOME: '/tmp/x', ORK_USUARIO_DIR: '/tmp/y' }),
    'ORK_USUARIO_DIR/segredos/teste.dsn');
  const p = pastaDoUsuario('dm16');
  try {
    for (const modo of [0o600, 0o644]) {
      gravar(p, DSN, modo);
      const r = resolverDsn(comArquivo(), { env: p.env });
      assert.ok(!JSON.stringify(r).includes(p.dir), 'o caminho real não sai');
    }
    const forma = resolverDsn(comArquivo({ database_url_file: '/etc/orkastery/teste.dsn' }), { env: p.env });
    assert.equal(forma.falha, 'dsn.arquivo-invalido');
    assert.ok(!forma.detalhe.includes('/etc/orkastery'), 'a forma inválida não repete o caminho');
  } finally { p.limpar(); }
});

test('DM17: os fragmentos da DSN são ela inteira e a senha longa, crua e decodificada (D6)', () => {
  assert.deepEqual(fragmentosDaDsn(DSN), [DSN, SENHA_INVENTADA]);
  const codificada = 'postgres://usuario:senha%40de-teste-inventada@localhost/teste';
  assert.deepEqual(fragmentosDaDsn(codificada), [codificada, 'senha%40de-teste-inventada', 'senha@de-teste-inventada']);
  assert.deepEqual(fragmentosDaDsn('postgres://usuario:curta@localhost/teste'), ['postgres://usuario:curta@localhost/teste']);
  assert.deepEqual(fragmentosDaDsn('host=localhost dbname=teste'), ['host=localhost dbname=teste']);
  assert.deepEqual(fragmentosDaDsn(''), []);
});

test('DM18: o detector de URL com senha devolve os nomes em ordem, nunca o valor (D7)', () => {
  const env: NodeJS.ProcessEnv = {
    Z_BANCO: DSN,
    A_CACHE: 'redis://:senha-de-teste-inventada@localhost:6379/0',
    M_LISTA: `outra coisa ${DSN} no meio`,
    SEM_SENHA: 'https://usuario@localhost/caminho',
    SO_HOST: 'postgres://localhost/teste',
    CAMINHO: '/usr/bin:/bin',
  };
  assert.deepEqual(variaveisComUrlComSenha(env), ['A_CACHE', 'M_LISTA', 'Z_BANCO']);
  assert.deepEqual(variaveisComDsn(env, DSN), ['A_CACHE', 'M_LISTA', 'Z_BANCO']);
  assert.deepEqual(variaveisComDsn({ SO_SENHA: SENHA_INVENTADA, OUTRA: 'nada' }, DSN), ['SO_SENHA']);
  assert.deepEqual(variaveisComDsn(env, ''), []);
});

test('DM19: fim de linha \\r\\n e espaço em volta são aparados', () => {
  const p = pastaDoUsuario('dm19');
  try {
    gravar(p, `  ${DSN}  \r\n`);
    const r = resolverDsn(comArquivo(), { env: p.env });
    assert.equal(r.falha, null);
    assert.equal(r.dsn, DSN);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// T3: os consumidores pelo resolvedor e a degradação tipada (casos DR)

/** Roda `fn` com a pasta do usuário do `ork` no ambiente do processo (os consumidores leem `process.env`). */
function comPastaDoUsuario<T>(p: PastaDoUsuario, fn: () => T): T {
  const antes = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = p.dir;
  try { return fn(); } finally { if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes; }
}

/** O manifesto do projeto de teste com `orkmind` e a fonte de arquivo (ou o que `memoria` pedir). */
function comMemoria(projeto: ProjetoDeTeste, memoria: Partial<Manifesto['memory']> = {}): Manifesto {
  return { ...projeto.carregado.manifesto, memory: { ...projeto.carregado.manifesto.memory, mode: 'orkmind',
    tenant: 'orkastery', database_url_env: '', database_url_file: ARQUIVO, ...memoria } };
}

function semSegredo(texto: string, rotulo: string): void {
  for (const proibido of [DSN, SENHA_INVENTADA]) assert.ok(!texto.includes(proibido), `vazou em ${rotulo}`);
}

const LICAO: EntradaNova = { source: 'agent', collection: 'learning', content: 'licao inventada do teste',
  tags: { project: ['orkastery'] }, priority: 'medium', metadata: {} };

/** CLI falso do OrkMind no formato que o driver aceita: o `orkmind` aponta, pelo shebang, para um Node com o corpo dado. */
function orkmindFalso(corpo: string): { cli: string; dir: string; limpar: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-dsn-cli-')));
  const runner = path.join(dir, 'python');
  fs.writeFileSync(runner, `#!${process.execPath}\n${corpo}`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return { cli, dir, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DR1: com o arquivo válido, o regime liga e o estado diz a fonte pelo rótulo, sem o valor', () => {
  const projeto = projetoTemporario('dsn-dr1');
  const p = pastaDoUsuario('dr1');
  try {
    gravar(p, DSN);
    const { estado, driver } = comPastaDoUsuario(p, () => resolverRegime(comMemoria(projeto), new DriverEmMemoria()));
    assert.ok(driver);
    assert.equal(estado.efetivo, 'orkmind');
    assert.equal(estado.motivo, null);
    assert.equal(estado.fonteDaDsn, 'arquivo');
    assert.equal(estado.arquivoDaDsn, 'ORK_USUARIO_DIR/segredos/teste.dsn');
    assert.equal(estado.variavel, '');
    assert.equal(estado.dsnPresente, true);
    assert.match(estado.detalhe, /ativo na base declarada por ORK_USUARIO_DIR\/segredos\/teste\.dsn: /);
    semSegredo(JSON.stringify(estado), 'estado');
  } finally { p.limpar(); projeto.limpar(); }
});

test('DR2: arquivo inseguro, ausente ou inválido degrada com o motivo e a correção, sem cair para a variável', () => {
  const projeto = projetoTemporario('dsn-dr2');
  const p = pastaDoUsuario('dr2');
  const antes = process.env.ORKASTERY_TESTE_DSN_DR2;
  process.env.ORKASTERY_TESTE_DSN_DR2 = DSN;
  try {
    const casos: Array<[() => void, string, RegExp]> = [
      [() => gravar(p, DSN, 0o644), 'dsn.arquivo-inseguro', /chmod 600/],
      [() => fs.rmSync(path.join(p.segredos, 'teste.dsn'), { force: true }), 'dsn.arquivo-ausente', /^grave a DSN da base propria do tenant em ORK_USUARIO_DIR\/segredos\/teste\.dsn/],
      [() => gravar(p, `ORKMIND_DATABASE_URL=${DSN}`), 'dsn.arquivo-invalido', /sem NOME= na frente/],
    ];
    for (const [preparar, motivo, correcao] of casos) {
      preparar();
      // As duas fontes no mesmo objeto (o parser do manifesto recusaria): o resolvedor só lê o arquivo.
      const manifesto = comMemoria(projeto, { database_url_env: 'ORKASTERY_TESTE_DSN_DR2' });
      const { estado, driver } = comPastaDoUsuario(p, () => resolverRegime(manifesto, null));
      assert.equal(driver, null);
      assert.equal(estado.efetivo, 'files', motivo);
      assert.equal(estado.motivo, motivo);
      assert.equal(estado.dsnPresente, false);
      assert.match(estado.detalhe, /^ORK_USUARIO_DIR\/segredos\/teste\.dsn: .*: o ork nao cai para outra fonte \(precedente memory-orkmind\)$/);
      assert.match(estado.correcao, correcao);
      semSegredo(JSON.stringify(estado), motivo);
    }
  } finally {
    if (antes === undefined) delete process.env.ORKASTERY_TESTE_DSN_DR2; else process.env.ORKASTERY_TESTE_DSN_DR2 = antes;
    p.limpar(); projeto.limpar();
  }
});

test('DR3: com o arquivo válido e sem driver injetado, a DSN é achada e o motivo não é de DSN', () => {
  const projeto = projetoTemporario('dsn-dr3');
  const p = pastaDoUsuario('dr3');
  try {
    gravar(p, DSN);
    const manifesto = comMemoria(projeto, { cli: path.join(p.dir, 'nao-existe', 'orkmind') });
    const { estado } = comPastaDoUsuario(p, () => resolverRegime(manifesto, null));
    assert.equal(estado.efetivo, 'files');
    assert.ok(estado.motivo && !estado.motivo.startsWith('dsn.'), String(estado.motivo));
    assert.equal(estado.dsnPresente, true);
    semSegredo(JSON.stringify(estado), 'estado');
  } finally { p.limpar(); projeto.limpar(); }
});

test('DR4: o ork memory status em texto mostra o arquivo com a fonte de arquivo e as linhas de hoje com ambiente', () => {
  const projeto = projetoTemporario('dsn-dr4');
  const p = pastaDoUsuario('dr4');
  try {
    gravar(p, DSN);
    const arquivo = textoDoEstado(comPastaDoUsuario(p, () => resolverRegime(comMemoria(projeto), new DriverEmMemoria())).estado);
    assert.ok(arquivo.includes('  arquivo da base       ORK_USUARIO_DIR/segredos/teste.dsn\n'), arquivo);
    assert.ok(arquivo.includes('  DSN no arquivo        sim (valor nunca impresso)\n'), arquivo);
    assert.ok(!arquivo.includes('variavel da base'));
    semSegredo(arquivo, 'texto com arquivo');
    const ambiente = textoDoEstado(resolverRegime(comMemoria(projeto,
      { database_url_file: undefined, database_url_env: 'ORKASTERY_TESTE_DSN_DR4_AUSENTE' }), null).estado);
    assert.ok(ambiente.includes('  variavel da base      ORKASTERY_TESTE_DSN_DR4_AUSENTE\n'), ambiente);
    assert.ok(ambiente.includes('  DSN no ambiente       nao\n'), ambiente);
    assert.ok(!ambiente.includes('arquivo da base'));
  } finally { p.limpar(); projeto.limpar(); }
});

test('DR5: o driver do OrkMind leva a DSN do arquivo só ao ambiente do filho e recusa pedido com a senha', () => {
  const projeto = projetoTemporario('dsn-dr5');
  const p = pastaDoUsuario('dr5');
  const f = orkmindFalso(`const fs=require('fs'),assert=require('assert/strict');
    const q=JSON.parse(fs.readFileSync(0,'utf8'));
    assert.equal(process.env.ORKMIND_DATABASE_URL, ${JSON.stringify(DSN)});
    assert.ok(!process.argv.join(' ').includes(${JSON.stringify(SENHA_INVENTADA)}));
    console.log(JSON.stringify({ok:true,id:'id-dr5',duplicada:false,collection:q.entrada.collection,detalhe:'created'}));`);
  try {
    gravar(p, DSN);
    const driver = new DriverCliOrkMind(comPastaDoUsuario(p, () => configDoManifesto(comMemoria(projeto, { cli: f.cli }))));
    assert.equal(driver.adicionar(LICAO).id, 'id-dr5');
    const recusado = driver.adicionar({ ...LICAO, content: `licao com ${SENHA_INVENTADA}` });
    assert.equal(recusado.ok, false);
    assert.equal(recusado.detalhe, 'memory.transport.secret: conteudo recusado');
  } finally { f.limpar(); p.limpar(); projeto.limpar(); }
});

test('DR6: sem DSN do arquivo, o driver recusa com o motivo da fonte e o filho não roda', () => {
  const projeto = projetoTemporario('dsn-dr6');
  const p = pastaDoUsuario('dr6');
  const marca = path.join(p.dir, 'rodou');
  const f = orkmindFalso(`require('fs').writeFileSync(${JSON.stringify(marca)}, 'x'); console.log('{}');`);
  try {
    gravar(p, DSN, 0o644);
    const config = comPastaDoUsuario(p, () => configDoManifesto(comMemoria(projeto, { cli: f.cli })));
    assert.equal(config.dsn, '');
    assert.equal(config.falhaDaDsn, 'dsn.arquivo-inseguro');
    const saude = new DriverCliOrkMind(config).disponivel();
    assert.deepEqual(saude, { ok: false, detalhe: 'dsn.arquivo-inseguro' });
    assert.equal(fs.existsSync(marca), false, 'o filho não pode rodar sem DSN');
  } finally { f.limpar(); p.limpar(); projeto.limpar(); }
});

test('DR7: o cliente do Company Brain leva a DSN do arquivo só em ORKMIND_DATABASE_URL; arquivo inseguro não chama o filho', () => {
  const projeto = projetoTemporario('dsn-dr7');
  const p = pastaDoUsuario('dr7');
  try {
    gravar(p, DSN);
    projeto.carregado.manifesto = comMemoria(projeto);
    const chamadas: Array<{ args: string[]; env: Record<string, string> }> = [];
    const run: any = (_bin: string, args: string[], opts: { env: Record<string, string> }) => {
      chamadas.push({ args, env: opts.env });
      return { status: 0, stdout: JSON.stringify({ schema: BRAIN_API, state: 'ok', contract_hash: CONTRACT_HASH }) };
    };
    const pedido: BrainRequest = { schema: BRAIN_API, operation: 'get', payload: { tenant_id: 'orkastery', id: 'proj-aaa' } };
    assert.equal(comPastaDoUsuario(p, () => brainClient(projeto.carregado, run)(pedido)).state, 'ok');
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0].args, ['brain', 'request']);
    assert.equal(chamadas[0].env.ORKMIND_DATABASE_URL, DSN);
    assert.deepEqual(Object.keys(chamadas[0].env).sort(), ['ORKMIND_BRAIN_TENANT', 'ORKMIND_DATABASE_URL', 'PATH', 'PYTHONDONTWRITEBYTECODE']);
    gravar(p, DSN, 0o644);
    assert.deepEqual(comPastaDoUsuario(p, () => brainClient(projeto.carregado, run)(pedido)),
      { schema: BRAIN_API, state: 'unavailable', error: 'brain.configuration.missing' });
    assert.equal(chamadas.length, 1, 'arquivo inseguro não chama o filho');
  } finally { p.limpar(); projeto.limpar(); }
});

test('DR8: a migração do Brain leva a DSN do arquivo ao filho só pelo ambiente; arquivo inseguro recusa antes', () => {
  const projeto = projetoTemporario('dsn-dr8');
  const p = pastaDoUsuario('dr8');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-dsn-admin-')));
  try {
    const cli = path.join(dir, 'orkmind');
    fs.writeFileSync(cli, `#!${process.execPath}
const crypto=require('crypto');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const sha=crypto.createHash('sha256').update(process.env.ORKMIND_DATABASE_URL||'').digest('hex');
  console.log(JSON.stringify({state:'ok',result:{sha,args:process.argv.slice(2),operacao:JSON.parse(s).operation}}));});
`, { mode: 0o755 });
    gravar(p, DSN);
    projeto.carregado.manifesto = comMemoria(projeto, { cli });
    const r = comPastaDoUsuario(p, () => brainAdmin(projeto.carregado)('plan', { batch_id: 'b1' }));
    assert.deepEqual(r, { sha: createHash('sha256').update(DSN).digest('hex'), args: ['brain', 'migration'], operacao: 'plan' });
    gravar(p, DSN, 0o644);
    assert.throws(() => comPastaDoUsuario(p, () => brainAdmin(projeto.carregado)('plan', {})), /brain\.configuration\.missing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); p.limpar(); projeto.limpar(); }
});

test('DR9: o estado da memória em JSON não traz a DSN nem a senha, com o arquivo valendo ou falhando', () => {
  const projeto = projetoTemporario('dsn-dr9');
  const p = pastaDoUsuario('dr9');
  try {
    projeto.carregado.manifesto = comMemoria(projeto);
    for (const modo of [0o600, 0o644]) {
      gravar(p, DSN, modo);
      const memoria = comPastaDoUsuario(p, () => abrirMemoria(projeto.carregado, { driver: new DriverEmMemoria() }));
      assert.equal(memoria.estado.fonteDaDsn, 'arquivo');
      semSegredo(JSON.stringify(memoria.estado), `estado ${modo.toString(8)}`);
      semSegredo(textoDoEstado(memoria.estado), `texto ${modo.toString(8)}`);
    }
  } finally { p.limpar(); projeto.limpar(); }
});
