/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 3: dois testes que caíam na suíte inteira com outras sessões
 * na máquina e passavam isolados.
 *
 * `prova-ativacao-roteiro` ("roteiro codex (B11)..."): o roteiro fotografava o registro de projetos da pasta do usuário de
 * quem roda a suíte, que outras sessões regravam no meio da prova (`ork thread new`, `ork init`), e a conferência
 * `global.intocado` reprovava. `projeto-alvo-cli` ("nome desconhecido e host sem cwd..."): o CLI que o teste chama lia o
 * runtime da conta de quem roda a suíte (`claude agents` e um `claude logs` por sessão parada), e a chamada passava do
 * prazo de 60 s do `spawnSync`. Aqui a condição adversa é forçada (outra sessão escrevendo; o `claude` da máquina), e a
 * versão de antes reprova.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { codexFalso } from './prova-ativacao-apoio';

const ROTEIRO = path.resolve(__dirname, '../../scripts/prova-ativacao.cjs');
const RAIZ_DO_CORE = path.resolve(__dirname, '../..');

/** O env de quem roda, sem a casa e a pasta do usuário dele e sem o contexto do runner pai do `node --test`. */
function envDaMaquina(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ORK_USUARIO_DIR; delete env.ORKASTERY_HOME; delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
}

/** Roda `node args` e, enquanto ele vive, regrava cada arquivo a cada 20 ms, como outra sessão da máquina. */
function rodarComEscritor(args: string[], env: NodeJS.ProcessEnv, arquivos: string[],
  sincronizar?: { sinal: string; ack: string }):
    Promise<{ status: number | null; stdout: string; stderr: string; regravacoes: number }> {
  for (const a of arquivos) fs.mkdirSync(path.dirname(a), { recursive: true });
  if (sincronizar) { fs.rmSync(sincronizar.sinal, { force: true }); fs.rmSync(sincronizar.ack, { force: true }); }
  let regravacoes = 0;
  const escrever = () => {
    regravacoes++;
    for (const a of arquivos) {
      fs.writeFileSync(a, `${JSON.stringify({ contrato: 'ork.projetos/v1', atualizadoEm: new Date().toISOString(), projetos: [], n: regravacoes })}\n`);
    }
  };
  escrever();
  let sincronizado = false;
  const regravar = () => {
    if (sincronizar && !sincronizado) {
      if (!fs.existsSync(sincronizar.sinal)) return;
      escrever();
      fs.writeFileSync(sincronizar.ack, 'reescrito\n');
      sincronizado = true;
      return;
    }
    escrever();
  };
  const relogio = setInterval(regravar, 20);
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, args, { cwd: RAIZ_DO_CORE, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    filho.stdout.on('data', (d) => { stdout += d; });
    filho.stderr.on('data', (d) => { stderr += d; });
    const prazo = setTimeout(() => filho.kill('SIGKILL'), 300000);
    const fim = () => { clearInterval(relogio); clearTimeout(prazo); };
    filho.on('error', (e) => { fim(); reject(e); });
    filho.on('close', (status) => { fim(); resolve({ status, stdout, stderr, regravacoes }); });
  });
}

const apagar = (...dirs: string[]) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };

test('defeito 3 (19 e 20/10/2026): o roteiro mede o registro da casa do ork da prova; outra sessao regravando o de ~/.orkastery nao o reprova', async () => {
  const f = codexFalso();
  const home = dirTemporario('rm037d2010-roteiro-home');
  const casa = dirTemporario('rm037d2010-roteiro-casa');
  try {
    // Como no `npm test`: a casa do ork em ORKASTERY_HOME e o HOME de quem roda, onde a outra sessao escreve.
    const sincronizar = { sinal: f.env.CODEX_FALSO_ARGS!, ack: path.join(f.dir, 'writer.ack') };
    const env: NodeJS.ProcessEnv = { ...f.env, HOME: home, ORKASTERY_HOME: casa, ORK_TEST_WRITER_ACK: sincronizar.ack };
    delete env.ORK_USUARIO_DIR; delete env.NODE_TEST_CONTEXT;
    const fora = await rodarComEscritor([ROTEIRO, 'codex'], env, [path.join(home, '.orkastery', 'projetos.json')], sincronizar);
    assert.equal(fora.status, 0, `${fora.stderr}\n${fora.stdout.slice(0, 3000)}`);
    assert.equal(JSON.parse(fora.stdout).estado, 'aprovada');
    assert.ok(fora.regravacoes > 1, 'o escritor regravou durante a prova');
    // O mesmo escritor no registro que a prova mede de fato reprova: a conferencia continua valendo.
    const dentro = await rodarComEscritor([ROTEIRO, 'codex'], env, [path.join(casa, 'projetos.json')], sincronizar);
    const recibo = JSON.parse(dentro.stdout) as { estado: string; conferencias: { id: string; ok: boolean }[] };
    assert.equal(recibo.estado, 'reprovada');
    assert.deepEqual(recibo.conferencias.filter((c) => !c.ok).map((c) => c.id), ['global.intocado']);
  } finally { f.limpar(); apagar(home, casa); }
});

test('defeito 3: o teste do roteiro roda com HOME e casa proprios; o escritor no HOME de quem roda a suite nao o reprova', async () => {
  const home = dirTemporario('rm037d2010-roteiro-teste-home');
  try {
    const r = await rodarComEscritor(['--test', '--test-reporter=tap', '--test-name-pattern=11 de 11',
      path.join(__dirname, 'prova-ativacao-roteiro.test.js')], envDaMaquina({ HOME: home }),
    [path.join(home, '.orkastery', 'projetos.json'), path.join(home, '.codex', 'history.jsonl')]);
    assert.equal(r.status, 0, r.stdout.slice(-3000));
    // O Node 20 lista os casos fora do padrao como `ok N - ... # SKIP` e o 22 os omite: o numero muda, o veredito nao.
    assert.match(r.stdout, /^ok \d+ - roteiro codex \(B11\): sessao efemera(?!.*# SKIP)/m);
    assert.match(r.stdout, /^# fail 0$/m);
  } finally { apagar(home); }
});

test('defeito 3: o teste projeto-alvo-cli nao chama o claude da maquina de quem roda a suite', async () => {
  const maquina = dirTemporario('rm037d2010-claude-da-maquina');
  const casa = dirTemporario('rm037d2010-cli-casa');
  try {
    const chamadas = path.join(maquina, 'chamadas.log');
    fs.writeFileSync(path.join(maquina, 'claude'), `#!/bin/sh\necho "$*" >> "${chamadas}"\n` +
      'if [ "$1" = "agents" ]; then echo \'[]\'; exit 0; fi\nexit 1\n', { mode: 0o755 });
    const r = await rodarComEscritor(['--test', '--test-reporter=tap', path.join(__dirname, 'projeto-alvo-cli.test.js')],
      envDaMaquina({ PATH: `${maquina}${path.delimiter}${process.env.PATH ?? ''}`, ORKASTERY_HOME: casa }), []);
    assert.equal(r.status, 0, r.stdout.slice(-3000));
    assert.match(r.stdout, /^# pass 3$/m);
    assert.equal(fs.existsSync(chamadas) ? fs.readFileSync(chamadas, 'utf8') : '', '', 'nenhuma chamada ao claude da maquina');
  } finally { apagar(maquina, casa); }
});
