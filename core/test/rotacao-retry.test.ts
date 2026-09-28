/**
 * I-33 (T6, D5 e D11c): rotacao de perfil pelo caminho REAL do despacho. O stub do `claude`
 * responde por conta: `auth status` so aprova com o marcador de login da conta, o `--bg` recusa
 * com a frase gravada na conta (cota ou login) e `agents` so lista a sessao da conta que a
 * despachou. A prova e o que o ledger, o store e a fila registram, nunca relato.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ligarRotacaoPorCota, projetoTemporario } from './apoio';
import { registrarGateBloqueado } from '../src/gates';
import { lerLedger, registrar } from '../src/ledger';
import { hashDoPrompt, rodarFase } from '../src/phase';
import { enfileirar, lerFilaDeRetomada, marcarContaDaFalha, PedidoComPerfil, prazoDaConta } from '../src/ratelimit';
import { alvosDeFallback, executarRetry, producaoNoIntervalo, proximoAlvo } from '../src/retry';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';

/** D5 com a troca por cota ligada no manifesto (D14): os testes deste arquivo exercitam a rotacao da D5. */
const ROTACAO_D5 = { mesmoRuntimePorCota: true, mesmoRuntimePorAuth: true };
/** D16: o operador desligou a troca por cota no manifesto. */
const SEM_TROCA_POR_COTA = { mesmoRuntimePorCota: false, mesmoRuntimePorAuth: true };
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { anexarJsonl } from '../src/util';

const SCRIPT_CLAUDE = `#!/bin/sh
DIR="$ORK_PERFIL_STUB_DIR"
echo "$1 $CLAUDE_CONFIG_DIR" >> "$DIR/envs"
if [ "$1" = "auth" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-logado" ]; then L=true; else L=false; fi
  printf '{"loggedIn":%s,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$L" "$CLAUDE_CONFIG_DIR"
  [ "$L" = true ] && exit 0 || exit 1
fi
if [ "$1" = "agents" ]; then
  if [ -f "$DIR/conta" ] && [ "$(cat "$DIR/conta")" = "$CLAUDE_CONFIG_DIR" ]; then
    printf '[{"id":"%s","sessionId":"%s","name":"x","cwd":"%s","kind":"background","state":"working","pid":%s}]\\n' \\
      "$(cut -c1-8 "$DIR/sessao")" "$(cat "$DIR/sessao")" "$(cat "$DIR/cwd")" "$PPID"
  else echo '[]'; fi
  exit 0
fi
if [ -f "$CLAUDE_CONFIG_DIR/.stub-falha" ]; then cat "$CLAUDE_CONFIG_DIR/.stub-falha" >&2; exit 1; fi
N=$(cat "$DIR/n" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$DIR/n"
SESSAO=$(printf '77777777-0000-4000-8000-%012d' "$N")
printf '%s' "$SESSAO" > "$DIR/sessao"
printf '%s' "$CLAUDE_CONFIG_DIR" > "$DIR/conta"
pwd > "$DIR/cwd"
echo "Background agent started: $SESSAO"
exit 0
`;

interface Cenario {
  p: ReturnType<typeof projetoTemporario>;
  conta: (id: string, opcoes?: { logado?: boolean; falha?: string }) => string;
  envs: () => string[];
  limpar: () => void;
}

function cenario(nome: string): Cenario {
  const p = projetoTemporario(nome);
  const bin = path.join(p.dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_PERFIL_STUB_DIR, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.ORK_PERFIL_STUB_DIR = bin;
  process.env.CLAUDE_CONFIG_DIR = path.join(p.dir, 'conta-processo');
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return {
    p,
    conta: (id, opcoes = {}) => {
      const dir = path.join(p.dir, 'contas', id);
      fs.mkdirSync(dir, { recursive: true });
      if (opcoes.logado !== false) fs.writeFileSync(path.join(dir, '.stub-logado'), '');
      if (opcoes.falha) fs.writeFileSync(path.join(dir, '.stub-falha'), opcoes.falha);
      adicionarPerfil(p.dir, { id, runtime: 'claude-bg', dir });
      return dir;
    },
    envs: () => fs.existsSync(path.join(bin, 'envs')) ? fs.readFileSync(path.join(bin, 'envs'), 'utf8').trim().split('\n') : [],
    limpar: () => { p.limpar(); volta('PATH', anterior.PATH); volta('ORK_PERFIL_STUB_DIR', anterior.STUB); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); },
  };
}

const perfilDe = (e: Record<string, unknown> | undefined) => (e?.perfil as { id?: string } | undefined)?.id;

test('cota esgotada no despacho: perfil sai do rodizio e o retry redespacha o MESMO prompt no proximo perfil', () => {
  const c = cenario('rotacao-cota');
  try {
    ligarRotacaoPorCota(c.p);
    c.conta('a', { falha: 'Error: Your workspace is out of credits' });
    c.conta('b');
    const t = novaThread(c.p.carregado, { nome: 'rotacao', modo: 'auto' }).thread;
    const r = rodarFase(c.p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    const a = lerPerfis(c.p.dir).perfis.find(p => p.id === 'a');
    assert.equal(a?.estado, 'esgotado');
    assert.ok(a?.esgotadoAte && Date.parse(a.esgotadoAte) > Date.now(), 'sem hora na saida: janela padrao declarada');
    const dir = dirThread(c.p.dir, t.id);
    const gate = lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.motivo, 'runtime.quota-exhausted');
    assert.equal(perfilDe(gate), 'a');

    const retry = executarRetry(c.p.carregado, t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const eventos = lerLedger(dir);
    const rotacao = eventos.filter(e => e.tipo === 'runtime_profile_rotated').at(-1);
    assert.deepEqual(rotacao?.de, { runtime: 'claude-bg', perfil: 'a' });
    assert.deepEqual(rotacao?.para, { runtime: 'claude-bg', perfil: 'b' });
    assert.ok(typeof rotacao?.autorizadoPor === 'string' && typeof rotacao?.razao === 'string' && typeof rotacao?.evidencia === 'string');
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal(perfilDe(despacho), 'b');
    assert.equal(despacho?.promptSha256, r.promptSha256, 'mesmo prompt, mesmo sha256');
    assert.equal(eventos.filter(e => e.tipo === 'retry_attempt').at(-1)?.ok, true);
  } finally { c.limpar(); }
});

test('preflight de auth: perfil sem login nunca recebe despacho e a troca vai ao ledger', () => {
  const c = cenario('rotacao-preflight');
  try {
    const contaA = c.conta('a', { logado: false });
    const contaB = c.conta('b');
    const t = novaThread(c.p.carregado, { nome: 'preflight', modo: 'auto' }).thread;
    const r = rodarFase(c.p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(r.verificada, true);
    assert.equal(c.envs().some(l => l === `--bg ${contaA}`), false, 'a conta sem login nao despachou');
    assert.ok(c.envs().includes(`auth ${contaA}`) && c.envs().includes(`--bg ${contaB}`));
    assert.equal(lerPerfis(c.p.dir).perfis.find(p => p.id === 'a')?.estado, 'sem-auth');
    const rotacao = lerLedger(dirThread(c.p.dir, t.id)).find(e => e.tipo === 'runtime_profile_rotated');
    assert.equal(rotacao?.origem, 'phase.run.preflight');
    assert.deepEqual(rotacao?.para, { runtime: 'claude-bg', perfil: 'b' });
  } finally { c.limpar(); }
});

test('sem perfil ativo em nenhum runtime: fila duravel ate o menor esgotadoAte, com runtime e motivo no pedido', () => {
  const c = cenario('rotacao-fila');
  try {
    ligarRotacaoPorCota(c.p);
    c.conta('a', { falha: 'out of credits; try again in 2 hours' });
    c.conta('b', { falha: 'usage_limit_exceeded' });
    const t = novaThread(c.p.carregado, { nome: 'fila', modo: 'auto' }).thread;
    rodarFase(c.p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    const retry = executarRetry(c.p.carregado, t.id);
    assert.equal(retry.fila.length, 1, retry.detalhe);
    const pedido = retry.fila[0] as PedidoComPerfil;
    const perfis = lerPerfis(c.p.dir).perfis;
    const menor = perfis.map(p => p.esgotadoAte as string).sort()[0];
    assert.equal(pedido.liberaEm, menor);
    assert.equal(pedido.runtime, 'claude-bg');
    assert.equal(pedido.motivo, 'runtime.quota-exhausted');
    assert.ok(perfis.every(p => p.estado === 'esgotado'));
    const eventos = lerLedger(dirThread(c.p.dir, t.id));
    assert.equal(eventos.filter(e => e.tipo === 'runtime_profile_rotated').at(-1)?.para, null);
    assert.ok(eventos.some(e => e.tipo === 'rate_limit_queued' && e.pedido === pedido.id));
  } finally { c.limpar(); }
});

test('so auth ausente e nenhum prazo: escala ao humano em vez de fila eterna', () => {
  const c = cenario('rotacao-auth');
  try {
    c.conta('a', { falha: 'Not logged in · Please run /login' });
    c.conta('b', { falha: 'OAuth token has expired' });
    const t = novaThread(c.p.carregado, { nome: 'auth', modo: 'auto' }).thread;
    const r = rodarFase(c.p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.motivo, 'runtime.auth-missing');
    const retry = executarRetry(c.p.carregado, t.id);
    assert.equal(retry.fila.length, 0);
    const eventos = lerLedger(dirThread(c.p.dir, t.id));
    const gate = eventos.filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.motivo, 'human.pending');
    assert.equal(gate?.pausaQualquerModo, true);
    assert.ok(eventos.some(e => e.tipo === 'retry_escalated'));
    assert.equal(lerFilaDeRetomada(c.p.dir).length, 0);
    assert.ok(lerPerfis(c.p.dir).perfis.every(p => p.estado === 'sem-auth'));
  } finally { c.limpar(); }
});

/** Sessao claude-bg da conta A que o observador classificou como morta por cota (gate com sessionId). */
function sessaoMortaPorCota(c: Cenario, fase: 'GO' | 'GOAL') {
  const contaA = c.conta('a');
  c.conta('b');
  marcarFalhaDePerfil(c.p.dir, 'a', { estado: 'esgotado', esgotadoAte: '2099-01-01T00:00:00.000Z', motivo: 'runtime.quota-exhausted',
    detalhe: 'out of credits' });
  const t = novaThread(c.p.carregado, { nome: 'observada', modo: 'auto' }).thread;
  const dir = dirThread(c.p.dir, t.id);
  const prompt = 'fase observada';
  const promptPath = path.join(dir, 'prompts', 'observada.md');
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, prompt);
  const sessionId = '88888888-0000-4000-8000-000000000001';
  const despachadaEm = new Date(Date.now() - 2000).toISOString();
  t.sessoes.push({ sessionId, slug: t.slug, fase, bloco: fase, runtime: 'claude-bg', despachadaEm, promptPath: path.relative(c.p.dir, promptPath),
    promptSha256: hashDoPrompt(prompt), verificada: true });
  gravarThread(c.p.dir, t);
  const perfil = { id: 'a', runtime: 'claude-bg', configDir: contaA };
  registrar(dir, t.id, 'phase_dispatch', { fase, sessionId, slug: t.slug, runtime: 'claude-bg', cwd: c.p.dir, model: 'opus', effort: 'high',
    promptPath: path.relative(c.p.dir, promptPath), promptSha256: hashDoPrompt(prompt), perfil });
  const gate = () => registrarGateBloqueado(dir, t.id, { gate: 'phase.dispatch', motivo: 'runtime.quota-exhausted', modo: t.modo,
    detalhe: 'terminal nativo failed sem Stop correlacionado; runtime.quota-exhausted na transcricao do perfil', fase, sessionId,
    despachoEm: despachadaEm, perfil, falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario',
      trecho: 'API Error: Your workspace is out of credits' }, origem: 'sessions.watch' });
  return { t, dir, sessionId, despachadaEm, gate };
}

test('D11c: morte por cota depois de commit no intervalo vira human.pending, sem rotacao nem redespacho', () => {
  const c = cenario('rotacao-producao-parcial');
  try {
    const s = sessaoMortaPorCota(c, 'GO');
    registrar(s.dir, s.t.id, 'mcp_git_committed', { fase: 'GO', commit: 'a'.repeat(40) });
    s.gate();
    const antes = lerLedger(s.dir).filter(e => e.tipo === 'phase_dispatch').length;
    const retry = executarRetry(c.p.carregado, s.t.id);
    assert.equal(retry.executada, false);
    assert.match(retry.detalhe, /producao parcial sob cota esgotada: 1 commit\(s\) registrado\(s\)/);
    const eventos = lerLedger(s.dir);
    assert.equal(eventos.filter(e => e.tipo === 'phase_dispatch').length, antes, 'nenhum redespacho');
    assert.equal(eventos.some(e => e.tipo === 'runtime_profile_rotated'), false);
    const gate = eventos.filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.motivo, 'human.pending');
    assert.match(String(gate?.diagnostico), /producao parcial/);
    assert.equal(c.envs().filter(l => l.startsWith('--bg')).length, 0);
  } finally { c.limpar(); }
});

test('D11c: morte por cota sem producao no intervalo rotaciona para o proximo perfil', () => {
  const c = cenario('rotacao-sem-producao');
  try {
    ligarRotacaoPorCota(c.p);
    const s = sessaoMortaPorCota(c, 'GOAL');
    s.gate();
    const eventosAntes = lerLedger(s.dir);
    assert.equal(producaoNoIntervalo(c.p.dir, s.t, { sessionId: s.sessionId, fase: 'GOAL', despachadaEm: s.despachadaEm }, eventosAntes).produziu, false);
    const retry = executarRetry(c.p.carregado, s.t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const eventos = lerLedger(s.dir);
    assert.deepEqual(eventos.filter(e => e.tipo === 'runtime_profile_rotated').at(-1)?.para, { runtime: 'claude-bg', perfil: 'b' });
    assert.equal(perfilDe(eventos.filter(e => e.tipo === 'phase_dispatch').at(-1)), 'b');
    // Com o artefato gravado no intervalo, a mesma sessao teria produzido.
    fs.mkdirSync(path.join(s.dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(s.dir, 'docs', 'goal.md'), '# objetivo\n');
    assert.equal(producaoNoIntervalo(c.p.dir, s.t, { sessionId: s.sessionId, fase: 'GOAL', despachadaEm: s.despachadaEm }, eventosAntes).produziu, true);
  } finally { c.limpar(); }
});

test('ordem de fallback: runtime:modelo do bloco, proximo perfil primeiro, depois o outro runtime', () => {
  const c = cenario('rotacao-fallback');
  try {
    assert.deepEqual(alvosDeFallback({ fallback: ['codex:gpt-5.5:high', 'claude-bg:opus', 'gemini:x', 'codex:outro', 'codex', 7] }, 'claude-bg'),
      [{ runtime: 'codex', model: 'gpt-5.5', effort: 'high' }]);
    assert.deepEqual(alvosDeFallback({ runtime: 'claude-bg' }, 'claude-bg'), []);
    const contaA = c.conta('a');
    const fallback = [{ runtime: 'codex', model: 'gpt-5.5' }];
    const atual = { runtime: 'claude-bg', perfil: { id: 'a', runtime: 'claude-bg' as const, configDir: contaA } };
    assert.deepEqual(proximoAlvo(c.p.dir, atual, fallback, { perfis: [], runtimesImplicitos: [] }, ROTACAO_D5),
      { runtime: 'codex', perfil: null, model: 'gpt-5.5', effort: null }, 'codex sem perfil: ambiente do processo');
    assert.equal(proximoAlvo(c.p.dir, atual, fallback, { perfis: [], runtimesImplicitos: ['codex'] }, ROTACAO_D5), null);
    adicionarPerfil(c.p.dir, { id: 'x', runtime: 'codex', dir: path.join(c.p.dir, 'contas', 'codex-x') });
    assert.equal(proximoAlvo(c.p.dir, atual, fallback, { perfis: [], runtimesImplicitos: [] }, ROTACAO_D5)?.perfil?.id, 'x');
    c.conta('b');
    assert.equal(proximoAlvo(c.p.dir, atual, fallback, { perfis: [], runtimesImplicitos: [] }, ROTACAO_D5)?.perfil?.id, 'b', 'mesmo runtime primeiro');
    // D14: com a troca por cota desligada pelo operador, o perfil que falhou segura o runtime e o fallback vem direto.
    assert.equal(proximoAlvo(c.p.dir, atual, fallback, { perfis: [], runtimesImplicitos: [] }, SEM_TROCA_POR_COTA)?.perfil?.id, 'x');
  } finally { c.limpar(); }
});

test('R3: fila com pedido antigo sem perfil continua legivel e o prazo da conta segue a D5', () => {
  const c = cenario('rotacao-r3');
  try {
    const antigo = { id: 'R1', thread: 't', fase: 'GO', slug: 's', promptPath: 'p.md', promptSha256: '0'.repeat(64), cwd: c.p.dir,
      model: null, effort: null, sinal: { resetEm: null, fonte: 'sem-horario', trecho: 'rate limit' }, liberaEm: '2026-09-19T00:00:00.000Z',
      janelaEstimada: true, tentativas: 0, estado: 'aguardando', criadoEm: '2026-09-18T00:00:00.000Z', atualizadoEm: '2026-09-18T00:00:00.000Z', detalhe: '' };
    anexarJsonl(path.join(c.p.dir, '.orkastery', 'retry', 'fila.jsonl'), antigo);
    const novo = enfileirar(c.p.carregado, { thread: 't', fase: 'GO', slug: 's', promptPath: 'p.md', promptSha256: '0'.repeat(64), cwd: c.p.dir,
      model: null, effort: null, sinal: { resetEm: '2026-09-20T00:00:00.000Z', fonte: 'iso', trecho: 'x' }, detalhe: '',
      runtime: 'codex', perfil: null, motivo: 'runtime.quota-exhausted' }) as PedidoComPerfil;
    const fila = lerFilaDeRetomada(c.p.dir) as PedidoComPerfil[];
    assert.equal(fila.length, 2);
    assert.equal(fila[0].runtime, undefined);
    assert.equal(novo.runtime, 'codex');
    const agora = Date.parse('2026-09-19T12:00:00Z');
    assert.equal(prazoDaConta(c.p.carregado.manifesto, { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: '' }, agora), null);
    assert.equal(prazoDaConta(c.p.carregado.manifesto, { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario', trecho: '' }, agora),
      new Date(agora + c.p.carregado.manifesto.retry.janela_padrao_min * 60000).toISOString());
    assert.equal(marcarContaDaFalha(c.p.carregado, null, { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario', trecho: '' }), null);
  } finally { c.limpar(); }
});
