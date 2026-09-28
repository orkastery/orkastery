import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { dirTemporario } from './apoio';
import { identidadeDoProcesso, IdentidadeProcesso } from '../src/adapters/codex-controller';
import { registrarFonteController, lerSnapshotController, LIMITE_METADADO_BYTES } from '../src/adapters/codex-controller-sensor';

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INSTANCIA = '11111111-2222-3333-4444-555555555555';
const CRIADO = '2026-09-01T00:00:00.000Z';
const DESPACHO = '2026-09-01T00:00:01.000Z';
const AGORA = Date.parse('2026-09-01T00:10:00.000Z');

/**
 * Processo proprio do teste, nascido no cwd que a fonte tera de provar. Identidade e
 * capturada uma vez, como no spawn real, e reconferida antes de qualquer sinal de cleanup.
 */
function processoProprio(cwd: string): { identidade: IdentidadeProcesso; encerrar: () => void } {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], { cwd, stdio: 'ignore' });
  if (!filho.pid) throw new Error('fixture sem pid do processo proprio');
  const identidade = identidadeDoProcesso(filho.pid);
  return { identidade, encerrar: () => {
    try { if (JSON.stringify(identidadeDoProcesso(identidade.pid)) !== JSON.stringify(identidade)) return; }
    catch { return; }
    filho.kill('SIGKILL');
  } };
}

function fixture(mudancas: { launch?: any; estado?: any; processo?: any } = {}) {
  const base = dirTemporario('controller-sensor');
  const dirSessoes = path.join(base, 'sessoes');
  fs.mkdirSync(dirSessoes, { mode: 0o700 });
  const dir = path.join(dirSessoes, 'controller-' + INSTANCIA);
  fs.mkdirSync(dir, { mode: 0o700 });
  const cwd = path.join(base, 'trabalho');
  fs.mkdirSync(cwd);
  const rollout = path.join(base, 'rollout.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: { id: SID, cwd } }) + '\n', { mode: 0o600 });
  const vinculo = { thread: 'ork-sensor', fase: 'GO', promptSha256: 'f'.repeat(64) };
  // Controller nasce no diretorio de IPC; runtime, no cwd do despacho.
  const proprioControlador = processoProprio(dir), proprioRuntime = processoProprio(cwd);
  const identidade = proprioControlador.identidade, runtime = proprioRuntime.identidade;
  const fixacao = path.join(base, 'fonte-controller.json');
  const escrever = (nome: string, valor: unknown) => fs.writeFileSync(path.join(dir, nome), JSON.stringify(valor), { mode: 0o600 });
  const launch = { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA, vinculo, cwd, criadoEm: CRIADO, ...mudancas.launch };
  const estado = { instancia: INSTANCIA, vinculo, cwd, sessionId: SID, pid: identidade.pid,
    processoController: identidade, processoRuntime: runtime,
    rollout, estado: 'working', turno: 'turn-1', ...mudancas.estado };
  const processo = { instancia: INSTANCIA, pid: identidade.pid, processoController: identidade, ...mudancas.processo };
  escrever('launch.json', launch);
  escrever('state.json', estado);
  escrever('process-launch.json', processo);
  const esperado = { dirSessoes, vinculo, sessionId: SID, cwd, despachoEm: DESPACHO, agoraMs: AGORA };
  return { base, dir, dirSessoes, cwd, rollout, vinculo, identidade, runtime, escrever, esperado, fixacao,
    limpar: () => { proprioControlador.encerrar(); proprioRuntime.encerrar();
      fs.rmSync(base, { recursive: true, force: true }); } };
}

test('snapshot permitido conserva close e identidades; sem close o exit fica null e unavailable', () => {
  const f = fixture();
  try {
    const fonte = registrarFonteController(f.dir, f.esperado);
    assert.equal(fonte.sessionId, SID);
    assert.equal(fonte.instancia, INSTANCIA);
    assert.equal(fonte.rollout, f.rollout);
    assert.equal(fonte.processoController?.pid, f.identidade.pid);

    // Sem `processoEncerrado` nenhum zero é fabricado, nem por turn/completed com status completed.
    f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
      processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'completed', turno: 'turn-1',
      terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' } });
    const aberto = lerSnapshotController(fonte, { agoraMs: AGORA });
    assert.equal(aberto.exitCode, null);
    assert.equal(aberto.exitCodeFonte, 'unavailable');
    assert.equal(aberto.fechamento, null);
    assert.equal(aberto.terminalNativo?.status, 'completed');
    assert.equal(aberto.estadoRuntime, 'vivo');

    // Close real do ChildProcess dono do stdin: única origem de exit.
    f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
      processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'completed', turno: 'turn-1',
      terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' },
      processoEncerrado: { em: '2026-09-01T00:00:03.000Z', code: 0, signal: null } });
    const fechado = lerSnapshotController(fonte, { agoraMs: AGORA });
    assert.equal(fechado.exitCode, 0);
    assert.equal(fechado.exitCodeFonte, 'controller.close');
    assert.equal(fechado.fechamento?.fonte, 'controller.close');
    assert.equal(fechado.fechamento?.duracaoMs, 3000);
    assert.equal(fechado.estadoRuntime, 'ausente');
    assert.equal(fechado.esperaHumana, false);

    // Espera humana autenticada e viva não é terminal.
    f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
      processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'blocked', turno: 'turn-1',
      bloqueio: JSON.stringify(['turn-1', 0, 'item-0', 'a'.repeat(64)]), perguntaNativa: { sha256: 'a'.repeat(64) } });
    const bloqueado = lerSnapshotController(fonte, { agoraMs: AGORA + 600000 });
    assert.equal(bloqueado.esperaHumana, true);
    assert.equal(bloqueado.exitCode, null);
    console.log(JSON.stringify({ exitCodeSemClose: aberto.exitCode, fonteSemClose: aberto.exitCodeFonte,
      exitCodeComClose: fechado.exitCode, fonteComClose: fechado.exitCodeFonte, esperaHumana: bloqueado.esperaHumana }));
  } finally { f.limpar(); }
});

test('cada divergência recusa a fonte antes de qualquer efeito', () => {
  const casos: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ['diretorio', f => { fs.mkdirSync(path.join(f.base, 'fora'), { mode: 0o700 }); (f as any).dir = path.join(f.base, 'fora'); },
      /fora do diretório canônico de sessões/],
    ['ancestral', f => fs.chmodSync(f.dirSessoes, 0o777), /permissão alheia/],
    ['modo', f => fs.chmodSync(f.dir, 0o750), /permissão alheia/],
    ['modo-metadado', f => fs.chmodSync(path.join(f.dir, 'state.json'), 0o644), /não é privado 0600/],
    ['symlink', f => { const alvo = path.join(f.base, 'copia.json');
      fs.copyFileSync(path.join(f.dir, 'state.json'), alvo); fs.chmodSync(alvo, 0o600);
      fs.unlinkSync(path.join(f.dir, 'state.json')); fs.symlinkSync(alvo, path.join(f.dir, 'state.json')); },
      /não é arquivo regular/],
    ['contrato', f => f.escrever('launch.json', { contrato: 'outro/v1', instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, criadoEm: CRIADO }),
      /contrato de launch do controller divergente/],
    ['instancia', f => f.escrever('state.json', { instancia: '99999999-2222-3333-4444-555555555555', vinculo: f.vinculo,
      cwd: f.cwd, sessionId: SID, pid: f.identidade.pid, processoController: f.identidade, rollout: f.rollout, estado: 'working' }),
      /instância do controller divergente/],
    ['launch', f => f.escrever('process-launch.json', { instancia: '99999999-2222-3333-4444-555555555555', pid: f.identidade.pid }),
      /instância do process-launch divergente/],
    ['vinculo', f => f.escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA,
      vinculo: { ...f.vinculo, fase: 'CHECK' }, cwd: f.cwd, criadoEm: CRIADO }), /vínculo thread\/fase\/prompt do launch divergente/],
    ['cwd', f => f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: '/outro', sessionId: SID,
      pid: f.identidade.pid, processoController: f.identidade, rollout: f.rollout, estado: 'working' }), /cwd do controller divergente/],
    ['sessao', f => f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd,
      sessionId: '00000000-0000-0000-0000-000000000000', pid: f.identidade.pid, processoController: f.identidade,
      rollout: f.rollout, estado: 'working' }), /sessão do controller divergente/],
    ['rollout', f => f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID,
      pid: f.identidade.pid, processoController: f.identidade, processoRuntime: f.runtime,
      rollout: 'relativo.jsonl', estado: 'working' }), /rollout do controller não confirmado/],
    ['identidade', f => f.escrever('process-launch.json', { instancia: INSTANCIA, pid: f.identidade.pid,
      processoController: { ...f.identidade, inicio: '999999999' } }), /identidade do controller divergente do spawn/],
    ['timestamp', f => f.escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA,
      vinculo: f.vinculo, cwd: f.cwd, criadoEm: '2026-09-01T00:00:02.000Z' }), /fora da janela do despacho/],
  ];
  for (const [nome, quebrar, esperado] of casos) {
    const f = fixture();
    try {
      quebrar(f);
      assert.throws(() => registrarFonteController(f.dir, f.esperado), esperado, nome);
    } finally { fs.chmodSync(f.dirSessoes, 0o700); f.limpar(); }
  }
  // PID sozinho não autentica: o mesmo pid com starttime de outro processo é recusado.
  const g = fixture();
  try {
    g.escrever('state.json', { instancia: INSTANCIA, vinculo: g.vinculo, cwd: g.cwd, sessionId: SID, pid: g.identidade.pid,
      processoController: { ...g.identidade, bootId: 'outro-boot' }, processoRuntime: g.runtime, rollout: g.rollout, estado: 'working' });
    assert.throws(() => registrarFonteController(g.dir, g.esperado), /identidade do controller divergente do spawn/);
  } finally { g.limpar(); }
  // uid autenticado: a conferência existe e recusa dono diferente do esperado.
  const h = fixture();
  try {
    assert.throws(() => registrarFonteController(h.dir, { ...h.esperado, uid: (process.getuid?.() ?? 0) + 1 }),
      /de outro uid|não é diretório próprio/);
  } finally { h.limpar(); }
  console.log(JSON.stringify({ negativasDeFonte: casos.length + 2 }));
});

test('JSON inválido ou excessivo é recusado sem vazar conteúdo do metadado', () => {
  const f = fixture();
  try {
    const segredo = 'SEGREDO-DE-METADADO-NAO-DEVE-VAZAR';
    fs.writeFileSync(path.join(f.dir, 'state.json'), '{ "vinculo": "' + segredo + '" ', { mode: 0o600 });
    assert.throws(() => registrarFonteController(f.dir, f.esperado), (e: Error) => {
      assert.match(e.message, /metadado state.json de controller inválido/);
      assert.equal(e.message.includes(segredo), false);
      return true;
    });
    fs.writeFileSync(path.join(f.dir, 'state.json'), JSON.stringify({ ruido: segredo.repeat(4000) }), { mode: 0o600 });
    assert.ok(fs.statSync(path.join(f.dir, 'state.json')).size > LIMITE_METADADO_BYTES);
    assert.throws(() => registrarFonteController(f.dir, f.esperado), (e: Error) => {
      assert.match(e.message, /metadado state.json de controller excessivo/);
      assert.equal(e.message.includes(segredo), false);
      return true;
    });
  } finally { f.limpar(); }
});

test('close fora da janela e terminal nativo de outra sessão são recusados na releitura', () => {
  const f = fixture();
  try {
    const fonte = registrarFonteController(f.dir, f.esperado);
    const estadoBase = { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
      processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'completed', turno: 'turn-1' };
    f.escrever('state.json', { ...estadoBase, processoEncerrado: { em: '2026-09-01T09:00:00.000Z', code: 0, signal: null } });
    assert.throws(() => lerSnapshotController(fonte, { agoraMs: AGORA }), /close do controller fora da janela do despacho/);
    f.escrever('state.json', { ...estadoBase, processoEncerrado: { em: '2026-09-01T00:00:03.000Z', code: -1, signal: null } });
    assert.throws(() => lerSnapshotController(fonte, { agoraMs: AGORA }), /code do close do controller inválido/);
    f.escrever('state.json', { ...estadoBase, terminal: { metodo: 'turn/completed', threadId: 'outra', turnId: 't', status: 'completed' } });
    assert.throws(() => lerSnapshotController(fonte, { agoraMs: AGORA }), /terminal nativo do controller divergente/);
    f.escrever('state.json', { ...estadoBase, processoRuntime: { ...f.runtime, pid: f.runtime.pid + 1 } });
    assert.throws(() => lerSnapshotController(fonte, { agoraMs: AGORA }), /identidade do runtime divergente da registrada/);
  } finally { f.limpar(); }
});

test('fonte fixada persiste entre polls e restart e dispensa qualquer redescoberta', () => {
  const f = fixture();
  try {
    const esperado = { ...f.esperado, fixacao: f.fixacao };
    const fonte = registrarFonteController(f.dir, esperado);
    assert.equal(fs.statSync(f.fixacao).mode & 0o777, 0o600);
    assert.equal(fonte.rolloutIno, fs.statSync(f.rollout).ino);
    // Poll seguinte devolve exatamente a fonte fixada, sem revalidar launch nem processo.
    assert.deepEqual(registrarFonteController(f.dir, esperado), fonte);
    // Restart do observador com a captura do spawn já removida: sem fixação não há fonte,
    // com fixação a identidade capturada continua valendo e nada é redescoberto por PID.
    fs.unlinkSync(path.join(f.dir, 'process-launch.json'));
    assert.throws(() => registrarFonteController(f.dir, f.esperado), /metadado process-launch.json de controller ausente/);
    const reiniciado = registrarFonteController(f.dir, esperado);
    assert.equal(reiniciado.rollout, f.rollout);
    assert.equal(reiniciado.rolloutIno, fonte.rolloutIno);
    assert.deepEqual(reiniciado.processoController, fonte.processoController);
    assert.deepEqual(reiniciado.processoRuntime, fonte.processoRuntime);
    f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
      processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'completed', turno: 'turn-1',
      terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' },
      processoEncerrado: { em: '2026-09-01T00:00:03.000Z', code: 0, signal: null } });
    const snapshot = lerSnapshotController(reiniciado, { agoraMs: AGORA });
    assert.equal(snapshot.exitCode, 0);
    assert.equal(snapshot.exitCodeFonte, 'controller.close');
    assert.equal(snapshot.terminalNativo?.turnId, 'turn-1');
    console.log(JSON.stringify({ fixacao: 'persistida', rolloutIno: fonte.rolloutIno === reiniciado.rolloutIno,
      exitAposRestart: snapshot.exitCode }));
  } finally { f.limpar(); }
});

test('registro recusa identidade, cwd, launch e rollout que a fonte não prova', () => {
  const casos: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ['process-launch ausente', f => fs.unlinkSync(path.join(f.dir, 'process-launch.json')),
      /metadado process-launch.json de controller ausente/],
    ['identidade capturada ausente', f => f.escrever('process-launch.json', { instancia: INSTANCIA, pid: f.identidade.pid }),
      /identidade capturada no spawn ausente no process-launch/],
    ['runtime ausente', f => f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID,
      pid: f.identidade.pid, processoController: f.identidade, rollout: f.rollout, estado: 'working' }),
      /identidade do runtime ausente na fonte/],
    ['cwd do controller', f => { f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID,
      pid: f.runtime.pid, processoController: f.runtime, processoRuntime: f.runtime, rollout: f.rollout, estado: 'working' });
      f.escrever('process-launch.json', { instancia: INSTANCIA, pid: f.runtime.pid, processoController: f.runtime }); },
      /cwd do controller divergente do IPC/],
    ['cwd do runtime', f => f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID,
      pid: f.identidade.pid, processoController: f.identidade, processoRuntime: f.identidade, rollout: f.rollout, estado: 'working' }),
      /cwd do runtime divergente do despacho/],
    ['executável real', f => { const falso = { ...f.identidade, executavel: '/usr/bin/false' };
      f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
        processoController: falso, processoRuntime: f.runtime, rollout: f.rollout, estado: 'working' });
      f.escrever('process-launch.json', { instancia: INSTANCIA, pid: f.identidade.pid, processoController: falso }); },
      /executável real do controller divergente do capturado/],
    ['rollout sem session_meta', f => fs.writeFileSync(f.rollout, '', { mode: 0o600 }),
      /sem session_meta conferível/],
    ['session_meta de outra sessão', f => fs.writeFileSync(f.rollout,
      JSON.stringify({ type: 'session_meta', payload: { id: '00000000-0000-0000-0000-000000000000', cwd: f.cwd } }) + '\n', { mode: 0o600 }),
      /session_meta do rollout de outra sessão/],
    ['session_meta com outro cwd', f => fs.writeFileSync(f.rollout,
      JSON.stringify({ type: 'session_meta', payload: { id: SID, cwd: '/outro' } }) + '\n', { mode: 0o600 }),
      /cwd divergente do despacho/],
    ['rollout com escrita alheia', f => fs.chmodSync(f.rollout, 0o666), /permissão de escrita alheia/],
    ['rollout por ancestral link', f => { const real = path.join(f.base, 'real');
      fs.mkdirSync(real, { mode: 0o700 }); fs.renameSync(f.rollout, path.join(real, 'rollout.jsonl'));
      fs.symlinkSync(real, path.join(f.base, 'link'));
      f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
        processoController: f.identidade, processoRuntime: f.runtime, estado: 'working',
        rollout: path.join(f.base, 'link', 'rollout.jsonl') }); }, /acessado por ancestral link/],
  ];
  for (const [nome, quebrar, esperado] of casos) {
    const f = fixture();
    try {
      quebrar(f);
      assert.throws(() => registrarFonteController(f.dir, { ...f.esperado, fixacao: f.fixacao }), esperado, nome);
      // Recusa antes de qualquer efeito: nenhuma fixação é escrita.
      assert.equal(fs.existsSync(f.fixacao), false, nome);
    } finally { f.limpar(); }
  }
  console.log(JSON.stringify({ negativasDeRegistro: casos.length }));
});

test('substituição, rotação e sumiço da fonte fixada invalidam o terminal em cache', () => {
  const casos: [string, (f: ReturnType<typeof fixture>, base: Record<string, unknown>) => void, RegExp][] = [
    ['outro rollout', (f, base) => { const outro = path.join(f.base, 'outro.jsonl');
      fs.writeFileSync(outro, JSON.stringify({ type: 'session_meta', payload: { id: SID, cwd: f.cwd } }) + '\n', { mode: 0o600 });
      f.escrever('state.json', { ...base, rollout: outro }); }, /rollout do controller divergente do registrado/],
    // A rotacao nasce em outro caminho e ASSUME o lugar, como o logrotate faz. Apagar e
    // recriar no mesmo caminho pode reusar o inode em ext4, e a recusa (que compara ino/dev)
    // passava a depender de sorte: era a divida A7 do GO, e virava reprovacao sob carga.
    ['rotação no mesmo caminho', f => { const novo = f.rollout + '.rotacionado';
      fs.writeFileSync(novo, JSON.stringify({ type: 'session_meta', payload: { id: SID, cwd: f.cwd } }) + '\n', { mode: 0o600 });
      fs.renameSync(novo, f.rollout); },
      /rotacionado sem vínculo provado com a fonte fixada/],
    ['deleção da fonte', f => fs.unlinkSync(f.rollout), /rollout do controller ausente/],
    ['outra instância', (f, base) => f.escrever('state.json', { ...base, instancia: '99999999-2222-3333-4444-555555555555' }),
      /instância do controller divergente/],
  ];
  for (const [nome, quebrar, esperado] of casos) {
    const f = fixture();
    try {
      const fonte = registrarFonteController(f.dir, { ...f.esperado, fixacao: f.fixacao });
      const base = { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
        processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'completed', turno: 'turn-1',
        terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' },
        processoEncerrado: { em: '2026-09-01T00:00:03.000Z', code: 0, signal: null } };
      f.escrever('state.json', base);
      // O terminal em cache existe antes da troca e deixa de valer depois dela.
      assert.equal(lerSnapshotController(fonte, { agoraMs: AGORA }).terminalNativo?.status, 'completed');
      quebrar(f, base);
      assert.throws(() => lerSnapshotController(fonte, { agoraMs: AGORA }), esperado, nome);
    } finally { f.limpar(); }
  }
  console.log(JSON.stringify({ trocasRecusadasNaReleitura: casos.length }));
});

test('espera HITL exige o tuple nativo completo, com requestId 0 aceito', () => {
  const f = fixture();
  try {
    const fonte = registrarFonteController(f.dir, { ...f.esperado, fixacao: f.fixacao });
    const hash = 'a'.repeat(64);
    const bloqueado = (bloqueio: unknown, pergunta: unknown = { sha256: hash }) => {
      f.escrever('state.json', { instancia: INSTANCIA, vinculo: f.vinculo, cwd: f.cwd, sessionId: SID, pid: f.identidade.pid,
        processoController: f.identidade, processoRuntime: f.runtime, rollout: f.rollout, estado: 'blocked', turno: 'turn-1',
        bloqueio: typeof bloqueio === 'string' ? bloqueio : JSON.stringify(bloqueio), perguntaNativa: pergunta });
      return lerSnapshotController(fonte, { agoraMs: AGORA + 600000 }).esperaHumana;
    };
    assert.equal(bloqueado(['turn-1', 0, 'item-0', hash]), true);
    assert.equal(bloqueado(['turn-1', 7, 'item-9', hash]), true);
    const negativos: [string, unknown, unknown][] = [
      ['tuple curto', ['turn-1', 0, hash], { sha256: hash }],
      ['turno alheio', ['turn-9', 0, 'item-0', hash], { sha256: hash }],
      ['requestId ausente', ['turn-1', null, 'item-0', hash], { sha256: hash }],
      ['requestId de texto', ['turn-1', '0', 'item-0', hash], { sha256: hash }],
      ['item ausente', ['turn-1', 0, '', hash], { sha256: hash }],
      ['hash divergente', ['turn-1', 0, 'item-0', 'b'.repeat(64)], { sha256: hash }],
      ['pergunta ausente', ['turn-1', 0, 'item-0', hash], null],
      ['bloqueio livre', 'aguardando humano', { sha256: hash }],
    ];
    for (const [nome, bloqueio, pergunta] of negativos) assert.equal(bloqueado(bloqueio, pergunta), false, nome);
    console.log(JSON.stringify({ hitlAceitos: 2, hitlRecusados: negativos.length }));
  } finally { f.limpar(); }
});
