/**
 * RM-037 (fatia 5, item 2): o rodizio quando a conta bate o limite de gasto.
 *
 * Na madrugada de 02/10/2026 as sessoes claude-bg de uma conta pararam as 06:00Z com "You've hit your individual
 * spend limit · ... · your session limit resets 4:40am (America/Sao_Paulo)". O processo ficou vivo por mais uma
 * hora, sem Stop; o `ork` so classificou `runtime.quota-exhausted` as 07:15Z, quando o processo morreu, e o
 * redespacho das 06:14:40Z caiu de novo na mesma conta e parou 3 s depois, sem tentar o outro perfil ativo.
 *
 * A fixture traz as linhas reais da transcricao da sessao longa (o turno, o erro de API com `quotaLimits`, o
 * `turn_duration` e o `cost-state`), com sessao, ids, request e cwd simulados. Os perfis, as contas e o `claude`
 * sao SIMULADOS (`runtimePorConta`); a sessao e registrada sem watcher destacado, e a observacao roda aqui, com o
 * relogio do incidente.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { desligarRotacaoPorCota, projetoTemporario, runtimePorConta } from './apoio';
import { definirFusoDoDono, formatarDataHora, FUSO_DE_BRASILIA, partesLocais } from '../src/horario';
import { lerLedger, registrar } from '../src/ledger';
import { escolherPerfil, rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { lerPerfis, lerPerfisComContas, linhasDePerfis, politicaDeRotacao } from '../src/runtime-profiles';
import { observarSessao } from '../src/session-watcher';
import { dirThread, gravarThread, novaThread } from '../src/thread';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/transcricao-limite-de-gasto-2026-10-02.jsonl');
const CLI = path.resolve(__dirname, '../../dist/index.js');
const LINHAS = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n');
const ERRO = JSON.parse(LINHAS[2]) as { timestamp: string; quotaLimits: { resetsAt: number }; message: { content: { text: string }[] } };
/** O despacho da sessao longa, o erro, a volta seguinte do observador (5 s) e o redespacho, nos instantes reais. */
const DESPACHO = '2026-10-02T02:46:19.491Z';
const ERRO_EM = Date.parse(ERRO.timestamp);
const VOLTA = ERRO_EM + 5000;
const REDESPACHO = Date.parse('2026-10-02T06:14:40.942Z');
const RESET = '2026-10-02T07:40:00.000Z';
/** Fora da sequencia decimal do stub (`99999999-0000-4000-8000-%012d`): o despacho real nunca repete este id. */
const SESSAO = '99999999-0000-4000-8000-00000000fa05';
const QUOTA = 'runtime_quota_detected';

interface Cenario { p: ReturnType<typeof projetoTemporario>; claude: ReturnType<typeof runtimePorConta>; contaA: string; contaB: string; limpar: () => void }

function cenario(nome: string): Cenario {
  const p = projetoTemporario(nome);
  const claude = runtimePorConta(nome);
  const contaA = claude.conta(p.dir, 'a'), contaB = claude.conta(p.dir, 'b');
  return { p, claude, contaA, contaB, limpar: () => { definirFusoDoDono(undefined); p.limpar(); claude.restaurar(); } };
}

/** A sessao do perfil `a`, registrada sem watcher destacado e viva no estado pedido (o pid e o deste processo). */
function sessaoViva(c: Cenario, estado: string, despachadaEm = DESPACHO) {
  const t = novaThread(c.p.carregado, { nome: `cota ao vivo ${estado}`, modo: 'auto' }).thread;
  t.sessoes.push({ sessionId: SESSAO, slug: t.slug, fase: 'GOAL', bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', runtime: 'claude-bg',
    despachadaEm, promptPath: '', promptSha256: '', verificada: true });
  gravarThread(c.p.dir, t);
  const dir = dirThread(c.p.dir, t.id);
  // O prompt gravado (que o retry redespacharia) nao existe no disco: o retry para no redespacho, sem abrir sessao.
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GOAL', sessionId: SESSAO, runtime: 'claude-bg', cwd: c.p.dir,
    promptPath: `.orkastery/threads/${t.id}/prompts/simulado-goal.md`, promptSha256: 'f'.repeat(64),
    perfil: { id: 'a', runtime: 'claude-bg', configDir: c.contaA } });
  fs.writeFileSync(path.join(c.claude.dir, 'sessao'), SESSAO);
  fs.writeFileSync(path.join(c.claude.dir, 'conta'), c.contaA);
  fs.writeFileSync(path.join(c.claude.dir, 'cwd'), c.p.dir + '\n');
  c.claude.estadoDaSessao(estado);
  return { t, dir };
}

/** A transcricao que o Claude Code grava no diretorio do perfil, linha a linha (a fixture ou uma variante dela). */
function transcricao(c: Cenario, linhas: readonly string[]): void {
  const pasta = path.join(c.contaA, 'projects', c.p.dir.replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${SESSAO}.jsonl`), linhas.join('\n') + '\n');
}

/** O caminho da transcricao da sessao no diretorio do perfil `a`. */
const arquivoDaTranscricao = (c: Cenario) => path.join(c.contaA, 'projects', c.p.dir.replace(/[^a-zA-Z0-9-]/g, '-'), `${SESSAO}.jsonl`);

/** A linha do erro da fixture com outro texto, outro instante (`null` tira) ou outro uuid. */
function erroCom(mudar: { texto?: string; timestamp?: string | null; uuid?: string }): string {
  const e = JSON.parse(LINHAS[2]);
  if (mudar.texto !== undefined) e.message.content[0].text = mudar.texto;
  if (mudar.uuid !== undefined) e.uuid = mudar.uuid;
  if (mudar.timestamp === null) delete e.timestamp;
  else if (mudar.timestamp !== undefined) e.timestamp = mudar.timestamp;
  return JSON.stringify(e);
}

const perfil = (c: Cenario, id: string) => lerPerfis(c.p.dir).perfis.find((x) => x.id === id)!;
const cotas = (dir: string) => lerLedger(dir).filter((e) => e.tipo === QUOTA);

for (const estado of ['blocked', 'working']) {
  test(`com a sessao viva (${estado}), a cota da transcricao real tira o perfil do rodizio na volta seguinte, ate as 04:40 do fuso dito`, () => {
    const c = cenario(`fatia5-cota-${estado}`);
    try {
      const { dir } = sessaoViva(c, estado);
      transcricao(c, LINHAS);
      const r = observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA });
      assert.equal(r.concluido, false, 'a fase nao fecha: a sessao continua viva');
      const [vista, ...resto] = cotas(dir);
      assert.equal(resto.length, 0);
      assert.deepEqual([vista?.motivo, vista?.erroEm, vista?.resetEm, vista?.fonteDoPrazo, vista?.esgotadoAte, vista?.perfilMarcado],
        ['runtime.quota-exhausted', ERRO.timestamp, RESET, 'relogio', RESET, true]);
      assert.deepEqual(vista?.perfil, { id: 'a', runtime: 'claude-bg' }, 'o evento diz o perfil pelo id, sem o diretorio da conta');
      assert.equal(Date.parse(String(vista?.esgotadoAte)), ERRO.quotaLimits.resetsAt * 1000, 'o prazo bate com o resetsAt da linha real');
      assert.ok(!lerLedger(dir).some((e) => e.tipo === 'phase_result' || e.tipo === 'gate_blocked'), 'nenhum resultado de fase');
      const a = perfil(c, 'a');
      assert.deepEqual([a.estado, a.esgotadoAte, a.ultimaFalha?.motivo], ['esgotado', RESET, 'runtime.quota-exhausted']);
      assert.equal(perfil(c, 'b').estado, 'ativo');
      // A volta seguinte, com a transcricao do mesmo tamanho, nao relê: o erro com outro uuid e o mesmo tamanho, que
      // seria outro evento, nao aparece (sugestao da rodada 1 do CHECK).
      const outroUuid = erroCom({ uuid: randomUUID() });
      assert.equal(outroUuid.length, LINHAS[2].length);
      transcricao(c, [...LINHAS.slice(0, 2), outroUuid, ...LINHAS.slice(3)]);
      observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA + 5000 });
      assert.equal(cotas(dir).length, 1);
    } finally { c.limpar(); }
  });
}

test('o redespacho das 06:14:40 pula o perfil esgotado e sai pelo outro; com a troca desligada, recusa pela cota', () => {
  const c = cenario('fatia5-cota-redespacho');
  try {
    sessaoViva(c, 'blocked');
    transcricao(c, LINHAS);
    // Sem a marca (o codigo de antes), o redespacho escolhia o mesmo perfil `a`.
    assert.equal(escolherPerfil(c.p.dir, 'claude-bg', { agoraMs: REDESPACHO }).perfil?.id, 'a');
    observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA });
    assert.equal(escolherPerfil(c.p.dir, 'claude-bg', { agoraMs: REDESPACHO }).perfil?.id, 'b');
    desligarRotacaoPorCota(c.p);
    const semTroca = escolherPerfil(c.p.dir, 'claude-bg', { agoraMs: REDESPACHO, politica: politicaDeRotacao(c.p.carregado.manifesto) });
    assert.deepEqual([semTroca.perfil, semTroca.motivo], [null, 'runtime.quota-exhausted']);
    // Depois das 04:40 o perfil volta sozinho, pela regra de sempre.
    assert.equal(escolherPerfil(c.p.dir, 'claude-bg', { agoraMs: Date.parse(RESET) + 60000 }).perfil?.id, 'a');
  } finally { c.limpar(); }
});

test('ork accounts list mostra o perfil esgotado com o prazo no fuso do dono', () => {
  const c = cenario('fatia5-cota-lista');
  try {
    sessaoViva(c, 'blocked');
    transcricao(c, LINHAS);
    observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA });
    definirFusoDoDono(FUSO_DE_BRASILIA);
    const linha = linhasDePerfis(lerPerfisComContas(c.p.dir, VOLTA)).find((l) => l[0] === 'a')!;
    assert.equal(linha[3], 'esgotado');
    assert.match(linha[4], /^02\/10(?:\/2026)? 04:40$/, 'ESGOTADO ATE: 04:40 de Brasilia');
    assert.match(linha[6], /^runtime\.quota-exhausted em 02\/10(?:\/2026)? 03:00$/);
  } finally { c.limpar(); }
});

test('contraprovas: 429 transitorio, erro de antes do despacho, linha sem instante e prazo ja vencido nao marcam', () => {
  const casos: { nome: string; linhas: string[]; despachadaEm?: string; agoraMs?: number }[] = [
    { nome: '429 transitorio', linhas: [...LINHAS.slice(0, 2), erroCom({ texto: 'API Error: Request rejected (429)' }), ...LINHAS.slice(3)] },
    { nome: 'erro de antes do despacho (sessao retomada)', linhas: LINHAS, despachadaEm: '2026-10-02T06:10:00.000Z' },
    { nome: 'linha sem instante', linhas: [...LINHAS.slice(0, 2), erroCom({ timestamp: null }), ...LINHAS.slice(3)] },
    { nome: 'prazo ja vencido (lido as 07:45Z)', linhas: LINHAS, agoraMs: Date.parse('2026-10-02T07:45:00.000Z') },
  ];
  for (const caso of casos) {
    const c = cenario(`fatia5-cota-contra-${casos.indexOf(caso)}`);
    try {
      const { dir } = sessaoViva(c, 'blocked', caso.despachadaEm);
      transcricao(c, caso.linhas);
      observarSessao(c.p.carregado, SESSAO, { agoraMs: caso.agoraMs ?? VOLTA });
      assert.equal(cotas(dir).length, 0, caso.nome);
      assert.equal(perfil(c, 'a').estado, 'ativo', caso.nome);
    } finally { c.limpar(); }
  }
});

test('sem hora na mensagem, o perfil sai por 1 h contada da mensagem, nao do relogio de quem le', () => {
  const c = cenario('fatia5-cota-sem-hora');
  try {
    const { dir } = sessaoViva(c, 'blocked');
    const semHora = "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit";
    transcricao(c, [...LINHAS.slice(0, 2), erroCom({ texto: semHora }), ...LINHAS.slice(3)]);
    observarSessao(c.p.carregado, SESSAO, { agoraMs: ERRO_EM + 10 * 60000 });
    const prazo = new Date(ERRO_EM + 60 * 60000).toISOString();
    assert.deepEqual([cotas(dir)[0]?.resetEm, cotas(dir)[0]?.esgotadoAte, perfil(c, 'a').esgotadoAte], [null, prazo, prazo]);
  } finally { c.limpar(); }
});

test('no fecho e no retry, o erro que a cota ao vivo ja marcou nao marca de novo, nem depois do prazo dito', () => {
  const c = cenario('fatia5-cota-fecho');
  try {
    const { dir } = sessaoViva(c, 'blocked');
    transcricao(c, LINHAS);
    observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA });
    // O processo morre depois das 04:40 (antes, o fecho marcava de novo pela janela padrao: 09:00Z).
    c.claude.estadoDaSessao('failed');
    const fim = Date.parse('2026-10-02T08:00:00.000Z');
    const r = observarSessao(c.p.carregado, SESSAO, { agoraMs: fim });
    assert.equal(r.concluido, true);
    assert.equal(lerLedger(dir).find((e) => e.tipo === 'phase_result')?.motivo, 'runtime.quota-exhausted', 'o fecho classifica como antes');
    assert.equal(perfil(c, 'a').esgotadoAte, RESET, 'o prazo continua o da mensagem');
    assert.equal(cotas(dir).length, 1);
    // O passo recomendado da cota e o `ork retry run`: ele tambem nao marca de novo (aviso da rodada 1 do CHECK; antes,
    // a janela padrao contada de agora tirava do rodizio a conta que ja tinha voltado).
    const retry = executarRetry(c.p.carregado, lerLedger(dir)[0].thread as string);
    assert.equal(perfil(c, 'a').esgotadoAte, RESET, `o retry nao marca de novo: ${retry.detalhe}`);
  } finally { c.limpar(); }
});

test('FIFO no lugar da transcricao nao trava o observador, nem com a sessao viva nem no fecho', { timeout: 20000 }, () => {
  const c = cenario('fatia5-cota-fifo');
  try {
    const { dir } = sessaoViva(c, 'blocked');
    fs.mkdirSync(path.dirname(arquivoDaTranscricao(c)), { recursive: true });
    execFileSync('mkfifo', [arquivoDaTranscricao(c)]);
    assert.equal(observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA }).concluido, false);
    c.claude.estadoDaSessao('failed');
    assert.equal(observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA + 10000 }).concluido, true);
    assert.equal(lerLedger(dir).find((e) => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable', 'sem transcricao legivel, sem cota');
    assert.equal(cotas(dir).length, 0);
  } finally { c.limpar(); }
});

test('o trecho do evento sai sem caractere de controle', () => {
  const c = cenario('fatia5-cota-controle');
  try {
    const { dir } = sessaoViva(c, 'blocked');
    const comControle = ERRO.message.content[0].text.replace('individual', `individual${String.fromCharCode(27)}[31m`);
    transcricao(c, [...LINHAS.slice(0, 2), erroCom({ texto: comControle }), ...LINHAS.slice(3)]);
    observarSessao(c.p.carregado, SESSAO, { agoraMs: VOLTA });
    const trecho = String(cotas(dir)[0]?.trecho);
    assert.ok(trecho.includes('spend limit'), trecho);
    assert.ok(!/\p{Cc}/u.test(trecho), JSON.stringify(trecho));
  } finally { c.limpar(); }
});

test('despacho real: depois da cota vista, o rodarFase seguinte sai pelo outro perfil, e o CLI lista o prazo', () => {
  const c = cenario('fatia5-cota-despacho');
  try {
    sessaoViva(c, 'blocked');
    // A linha real, com o instante de agora e a hora de volta trocada para daqui a 2 h no mesmo fuso.
    const agora = Date.now();
    const volta = partesLocais(agora + 2 * 3600e3, FUSO_DE_BRASILIA);
    const h = Number(volta.hora), relogio = `${h % 12 === 0 ? 12 : h % 12}:${volta.minuto}${h < 12 ? 'am' : 'pm'}`;
    const texto = ERRO.message.content[0].text.replace('4:40am', relogio);
    transcricao(c, [...LINHAS.slice(0, 2), erroCom({ texto, timestamp: new Date(agora - 1000).toISOString() }), ...LINHAS.slice(3)]);
    observarSessao(c.p.carregado, SESSAO, { agoraMs: agora });
    const esgotadoAte = perfil(c, 'a').esgotadoAte!;
    assert.ok(Date.parse(esgotadoAte) > agora + 3600e3, esgotadoAte);
    const t2 = novaThread(c.p.carregado, { nome: 'redespacho', modo: 'auto' }).thread;
    const r = rodarFase(c.p.carregado, t2.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    const despacho = lerLedger(dirThread(c.p.dir, t2.id)).find((e) => e.tipo === 'phase_dispatch');
    assert.equal((despacho?.perfil as { id: string }).id, 'b');
    const saida = execFileSync(process.execPath, [CLI, 'accounts', 'list'], { cwd: c.p.dir, encoding: 'utf8',
      env: { ...process.env, TZ: FUSO_DE_BRASILIA } });
    const linhaA = saida.split('\n').find((l) => /^\s*a\s/.test(l)) ?? '';
    assert.match(linhaA, /\besgotado\b/, saida);
    assert.ok(linhaA.includes(formatarDataHora(esgotadoAte, { fuso: FUSO_DE_BRASILIA })), saida);
  } finally { c.limpar(); }
});
