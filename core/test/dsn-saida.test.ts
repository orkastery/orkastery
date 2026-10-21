/**
 * RM-069, GO-FIX 1 da ork-dsnforadoamb (achado 2 do CHECK independente): a barreira de saída. Nenhuma resposta, erro ou
 * saída dos consumidores da DSN (o cliente e a migração do Company Brain, o driver do OrkMind, o `ork memory status` e o
 * `ork doctor`) repete a DSN ou a senha dela, inclusive a senha curta (D20, D21).
 *
 * Os processos filhos falsos devolvem o que receberam em `ORKMIND_DATABASE_URL` (a DSN inteira, ou só a senha) e o
 * escrevem também no stderr. Toda DSN é inventada, a pasta do usuário do `ork` é temporária e nenhum caso lê, compara ou
 * imprime o ambiente de quem roda a suíte. Os mutantes de `core/test/mutantes/dsn-da-memoria.json` desfazem cada correção.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BRAIN_API, brainClient, BrainRequest } from '../src/company-brain-client';
import { brainAdmin } from '../src/company-brain-migration';
import { configDoManifesto, DriverCliOrkMind } from '../src/orkmind';
import { Manifesto } from '../src/types';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { Cenario, cenario, CLI } from './locale-apoio';

/** Senha curta inventada: a barreira de antes só via a senha com 12 caracteres ou mais. */
const SENHA_CURTA = 'curta9';
const DSN = `postgres://usuario:${SENHA_CURTA}@localhost/teste`;
const ARQUIVO = '~/.orkastery/segredos/teste.dsn';

interface PastaDoUsuario { casa: string; dir: string; segredos: string; limpar: () => void }

/** A casa do usuário temporária com a pasta do usuário do `ork` dentro e o arquivo da DSN válido na de segredos. */
function pastaDoUsuario(nome: string): PastaDoUsuario {
  const casa = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-dsn-saida-${nome}-`)));
  const dir = path.join(casa, 'ork');
  const segredos = path.join(dir, 'segredos');
  fs.mkdirSync(segredos, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(segredos, 'teste.dsn'), `${DSN}\n`);
  fs.chmodSync(path.join(segredos, 'teste.dsn'), 0o600);
  return { casa, dir, segredos, limpar: () => fs.rmSync(casa, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Roda `fn` com a casa e a pasta do usuário do `ork` no ambiente do processo (os consumidores leem `process.env`). */
function comPastaDoUsuario<T>(p: PastaDoUsuario, fn: () => T): T {
  const antes = { HOME: process.env.HOME, ORK_USUARIO_DIR: process.env.ORK_USUARIO_DIR };
  process.env.HOME = p.casa;
  process.env.ORK_USUARIO_DIR = p.dir;
  try { return fn(); } finally {
    for (const [nome, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    }
  }
}

function comMemoria(projeto: ProjetoDeTeste, memoria: Partial<Manifesto['memory']> = {}): Manifesto {
  return { ...projeto.carregado.manifesto, memory: { ...projeto.carregado.manifesto.memory, mode: 'orkmind',
    tenant: 'orkastery', database_url_env: '', database_url_file: ARQUIVO, ...memoria } };
}

function semSegredo(texto: string, rotulo: string): void {
  for (const proibido of [DSN, SENHA_CURTA]) assert.ok(!texto.includes(proibido), `vazou em ${rotulo}`);
}

const PEDIDO: BrainRequest = { schema: BRAIN_API, operation: 'get', payload: { tenant_id: 'orkastery', id: 'proj-aaa' } };

/** As formas de devolver o segredo que o filho recebeu: num campo, numa frase, como chave, numa lista, no código de erro. */
const ECOS: Array<[string, (dsn: string) => Record<string, unknown>]> = [
  ['a DSN num campo', (dsn) => ({ detail: dsn })],
  ['a senha numa frase', (dsn) => ({ detail: `autenticacao recusada para ${new URL(dsn).password}` })],
  ['a DSN como chave aninhada', (dsn) => ({ records: [{ meta: { [dsn]: true } }] })],
  ['a senha numa lista', (dsn) => ({ ids: ['proj-aaa', new URL(dsn).password] })],
  ['a senha no código de erro', (dsn) => ({ state: 'unavailable', error: `brain.${new URL(dsn).password}` })],
];

test('DS1: o cliente do Company Brain recusa a resposta do filho que repete a DSN ou a senha, nas duas fontes', () => {
  const projeto = projetoTemporario('dsn-ds1');
  const p = pastaDoUsuario('ds1');
  const antes = process.env.ORKASTERY_TESTE_DSN_DS1;
  try {
    process.env.ORKASTERY_TESTE_DSN_DS1 = DSN;
    const fontes: Array<Partial<Manifesto['memory']>> = [{}, { database_url_file: undefined, database_url_env: 'ORKASTERY_TESTE_DSN_DS1' }];
    for (const fonte of fontes) {
      projeto.carregado.manifesto = comMemoria(projeto, fonte);
      const rotuloDaFonte = fonte.database_url_env ? 'ambiente' : 'arquivo';
      for (const [rotulo, eco] of ECOS) {
        const run: any = (_bin: string, _args: string[], opts: { env: Record<string, string> }) =>
          ({ status: 0, stdout: JSON.stringify({ schema: BRAIN_API, state: 'ok', ...eco(opts.env.ORKMIND_DATABASE_URL) }) });
        const r = comPastaDoUsuario(p, () => brainClient(projeto.carregado, run)(PEDIDO));
        assert.deepEqual(r, { schema: BRAIN_API, state: 'unavailable', error: 'brain.transport.secret' }, `${rotuloDaFonte}: ${rotulo}`);
        semSegredo(JSON.stringify(r), `${rotuloDaFonte}: ${rotulo}`);
      }
      // Controle: a mesma resposta sem o segredo sai inteira.
      const limpo: any = () => ({ status: 0, stdout: JSON.stringify({ schema: BRAIN_API, state: 'ok', detail: 'nada' }) });
      assert.deepEqual(comPastaDoUsuario(p, () => brainClient(projeto.carregado, limpo)(PEDIDO)),
        { schema: BRAIN_API, state: 'ok', detail: 'nada' }, rotuloDaFonte);
    }
  } finally {
    if (antes === undefined) delete process.env.ORKASTERY_TESTE_DSN_DS1; else process.env.ORKASTERY_TESTE_DSN_DS1 = antes;
    p.limpar(); projeto.limpar();
  }
});

/** Executável falso do Company Brain: devolve, no `result` (ou no erro, com `estado: falha`), o eco pedido no payload. */
function brainFalso(): { cli: string; limpar: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-dsn-saida-brain-')));
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${process.execPath}
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const q=JSON.parse(s),dsn=process.env.ORKMIND_DATABASE_URL||'';
  const eco={dsn,senha:dsn?new URL(dsn).password:'',nada:'nada'}[q.payload.eco];
  process.stderr.write('stderr com '+dsn+'\\n');
  console.log(JSON.stringify(q.payload.estado==='falha'?{state:'failed',error:eco}:{state:'ok',result:{detalhe:eco}}));});
`, { mode: 0o755 });
  return { cli, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DS2: a migração do Brain recusa a resposta do filho que repete a DSN ou a senha, sem o valor no erro', () => {
  const projeto = projetoTemporario('dsn-ds2');
  const p = pastaDoUsuario('ds2');
  const f = brainFalso();
  try {
    projeto.carregado.manifesto = comMemoria(projeto, { cli: f.cli });
    for (const payload of [{ eco: 'dsn' }, { eco: 'senha' }, { eco: 'senha', estado: 'falha' }]) {
      const rotulo = JSON.stringify(payload);
      let erro: unknown = null;
      let resultado: unknown = null;
      try { resultado = comPastaDoUsuario(p, () => brainAdmin(projeto.carregado)('plan', payload)); } catch (e) { erro = e; }
      semSegredo(JSON.stringify(resultado ?? null), rotulo);
      assert.ok(erro instanceof Error, `${rotulo}: a resposta com o segredo não pode sair como resultado`);
      assert.equal(erro.message, 'brain.migration.secret', rotulo);
      semSegredo(String(erro.stack), rotulo);
    }
    // Controle: sem o segredo, o resultado sai.
    assert.deepEqual(comPastaDoUsuario(p, () => brainAdmin(projeto.carregado)('plan', { eco: 'nada' })), { detalhe: 'nada' });
  } finally { f.limpar(); p.limpar(); projeto.limpar(); }
});

/**
 * CLI falso do OrkMind no formato que o driver aceita: o `orkmind` aponta, pelo shebang, para um Node que responde à sonda
 * `health` com o eco do arquivo `eco` ao lado (a DSN, a senha ou `nada`) no campo `orkmind` e o escreve no stderr.
 */
function orkmindFalso(): { cli: string; eco: (modo: 'dsn' | 'senha' | 'nada') => void; limpar: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-dsn-saida-cli-')));
  const arquivoDoEco = path.join(dir, 'eco');
  fs.writeFileSync(arquivoDoEco, 'nada');
  const runner = path.join(dir, 'python');
  fs.writeFileSync(runner, `#!${process.execPath}
const fs=require('fs');const q=JSON.parse(fs.readFileSync(0,'utf8'));const dsn=process.env.ORKMIND_DATABASE_URL||'';
const modo=fs.readFileSync(${JSON.stringify(arquivoDoEco)},'utf8');
const eco=modo==='dsn'?dsn:modo==='senha'?new URL(dsn).password:'nada';
process.stderr.write('stderr com '+dsn+'\\n');
console.log(JSON.stringify(q.op==='health'?{contagens:{learning:1},orkmind:eco,fallback:{dependencias:false}}:{}));
`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return { cli, eco: (modo) => fs.writeFileSync(arquivoDoEco, modo), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DS3: o driver do OrkMind recusa a resposta do filho que repete a DSN ou a senha curta, sem o valor no detalhe', () => {
  const projeto = projetoTemporario('dsn-ds3');
  const p = pastaDoUsuario('ds3');
  const f = orkmindFalso();
  try {
    const config = comPastaDoUsuario(p, () => configDoManifesto(comMemoria(projeto, { cli: f.cli })));
    for (const eco of ['dsn', 'senha'] as const) {
      f.eco(eco);
      const saude = new DriverCliOrkMind(config).disponivel();
      assert.deepEqual(saude, { ok: false, detalhe: 'memory.transport.secret: resposta recusada' }, eco);
    }
    // Controle: sem o segredo, o que o filho disse chega ao detalhe (a barreira é o que tira o valor).
    f.eco('nada');
    const limpo = new DriverCliOrkMind(config).disponivel();
    assert.equal(limpo.ok, true);
    assert.match(limpo.detalhe, /\(orkmind nada, 1 entrada\(s\) em 1 colecao\(oes\)\)$/);
  } finally { f.limpar(); p.limpar(); projeto.limpar(); }
});

/** O cenário do CLI com `memory.mode: orkmind`, a fonte de arquivo, o `memory.cli` falso e o arquivo da DSN na casa. */
function cenarioComOrkmind(nome: string, cli: string): Cenario {
  const c = cenario(nome);
  const manifesto = path.join(c.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(manifesto, 'utf8');
  const novo = bruto.replace(/^ {2}mode: files$/m, '  mode: orkmind')
    .replace(/^ {2}database_url_env: ""$/m, `  database_url_file: "${ARQUIVO}"`)
    .replace(/^ {2}cli: orkmind$/m, `  cli: ${cli}`);
  assert.notEqual(novo, bruto);
  fs.writeFileSync(manifesto, novo);
  const segredos = path.join(c.casa, '.orkastery', 'segredos');
  fs.mkdirSync(segredos, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(segredos, 'teste.dsn'), `${DSN}\n`);
  fs.chmodSync(path.join(segredos, 'teste.dsn'), 0o600);
  return c;
}

/** O `ork` do CLI no cenário, com ambiente montado do zero; a saída junta stdout e stderr. */
function orkNoCenario(c: Cenario, ...args: string[]): { status: number | null; saida: string; stdout: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: c.dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: c.casa, TZ: 'America/New_York', LANG: 'pt_BR.UTF-8', PATH: c.bin },
  });
  return { status: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
}

test('DS4: o ork memory status, em texto e em JSON, não repete a DSN nem a senha que o filho devolve', () => {
  const f = orkmindFalso();
  const c = cenarioComOrkmind('dsn-ds4', f.cli);
  try {
    for (const eco of ['dsn', 'senha'] as const) {
      f.eco(eco);
      for (const args of [['memory', 'status'], ['memory', 'status', '--json']]) {
        const r = orkNoCenario(c, ...args);
        const rotulo = `${args.join(' ')} com o eco de ${eco}`;
        assert.equal(r.status, 0, rotulo);
        semSegredo(r.saida, rotulo);
        assert.ok(r.stdout.includes('memory.transport.secret'), `${rotulo}: a recusa sai pelo código`);
      }
    }
    // Controle: sem o segredo, o que o filho disse chega ao status (a barreira é o que tira o valor).
    f.eco('nada');
    assert.match(orkNoCenario(c, 'memory', 'status').stdout, /orkmind nada/);
  } finally { c.limpar(); f.limpar(); }
});

test('DS5: o ork doctor, em texto e em JSON, não repete a DSN nem a senha que o filho devolve', () => {
  const f = orkmindFalso();
  const c = cenarioComOrkmind('dsn-ds5', f.cli);
  try {
    for (const eco of ['dsn', 'senha', 'nada'] as const) {
      f.eco(eco);
      for (const args of [['doctor'], ['doctor', '--json']]) {
        const r = orkNoCenario(c, ...args);
        const rotulo = `${args.join(' ')} com o eco de ${eco}`;
        assert.ok(r.stdout.includes('regime de memoria'), `${rotulo}: o doctor chegou à memória`);
        semSegredo(r.saida, rotulo);
      }
    }
  } finally { c.limpar(); f.limpar(); }
});
