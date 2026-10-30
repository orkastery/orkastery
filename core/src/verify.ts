/**
 * `ork verify` e `ork verify --baseline` (bloco B1).
 *
 * Duas verdades diferentes, ambas reexecutadas no HEAD REAL, nunca lidas de relatorio:
 *
 *   1. CLAIMS: cada alegacao registrada tem o seu comando reexecutado agora. Passou =
 *      `verificado: sim`. Falhou = `claims.failed`. Alegacao negativa sem comando
 *      tambem reprova: e o caso EvoJ6, em que a frase absoluta falsa passou batido.
 *   2. BASELINE: os comandos de `verify:` do manifesto rodam antes do GO e ficam
 *      gravados. No CHECK eles rodam de novo, e a diferenca separa REGRESSAO (passava e
 *      agora falha) de DIVIDA PRE-EXISTENTE (ja falhava). Sem baseline, a falha e
 *      declarada como `verify.failed`, e nao como regressao que nao da para provar.
 */

import { lerClaims, carimbarEstado, registrarCriteriosDePronto } from './claims';
import { registrarGateBloqueado } from './gates';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { dirThread, gravarThread, lerThread, prepararDependenciasPendentes } from './thread';
import { raizDoEstado } from './estado-thread';
import { PRAZO_DAS_DEPENDENCIAS_MS, ultimaLinhaDoPreparo } from './dependencias-da-worktree';
import {
  Baseline,
  CanalDeConducao,
  CausaDoComando,
  Manifesto,
  MotivoGate,
  OperacaoDeConducao,
  ResultadoDeClaim,
  ResultadoDeComando,
  Thread,
} from './types';
import * as fs from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { agora, COMMIT_DESCONHECIDO, exec, shaCurto } from './util';
import { formatarDataHoraRotulada } from './horario';
import { ErroDoCatalogo, msg, remontar, textoDoCatalogo } from './locale';
import { falhasDeTeste, redigirSaida, testesQueCairam } from './redacao-saida';
import { abrirJanela, FONTE_STEAL, LeitorProcStat, LIMIAR_STEAL_PCT, lerProcStat, reprovacaoSoDeRelogio, stealAlto,
  TestesDeRelogio } from './steal';
import { lerRegistroDeInstabilidade, RegistroLido, testesDeRelogioVigentes } from './instabilidade';
import { comRecursoPesado, OcupanteDaFila, UsoDaFilaPesada } from './fila-pesada';
import { redigirCredenciaisUrl } from './redacao-url';
import { canalDoProcesso, comConducao, ConducaoTomada, identidadeDoAmbiente, prazoDaVerificacao } from './conducao';
import { diretorioDaThread } from './procedencia';
import { BarreiraDaThread, barreiraDaThread, resumoNoLedger } from './dado-privado';
import { avisos as avisosDePolicy, bloqueantes as bloqueantesDePolicy } from './policies';
import { ENV_MODO_DO_CHECK, ENV_RELATORIO_DO_CHECK, ENV_VARREDURA_PARALELA_DO_CHECK, ModoDoCheck, ModoResolvido, NOME_DO_MODO,
  resolverModo } from './check-modo';
import { comandosNoAgile, ComandosDoAgile, executorDaClaimNoAgile, ExecutorDeGrupo, GuardaDoProduto, listasDasLanes,
  MAXIMO_DE_PREPAROS_REFEITOS, PecaDoAgile, paralelismoDaVarreduraNoGrupo, PECA_SEM_RELATORIO, pecasDoRelatorio,
  porQueDasLanes, prepararNoAgile, PreparoVigente, refazerPreparo, RefazerPreparo, RelatorioDoCheck } from './check-agil';
import { esperaDoGrupo, rodarEmParalelo } from './check-paralelo';
import { ENV_CPUS_DA_LANE, ENV_CPUS_DOCKER, MedicaoCpuDoGrupo } from './agendador-cpu';
import { checarChangelog } from './changelog-check';

/** Teto de tempo de um comando de verificacao (build e suite completa cabem). */
export const TIMEOUT_VERIFY_MS = 10 * 60 * 1000;

/** Ultimas linhas da saida real, o suficiente para servir de evidencia no ledger. */
function resumirSaida(stdout: string, stderr: string): string {
  const bruto = (stdout + (stderr ? '\n' + stderr : '')).trim();
  const linhas = bruto.split('\n').filter((l) => l.trim() !== '');
  return linhas.slice(-10).join('\n').slice(-800);
}

/** `timeout(1)` (GNU coreutils ou uutils): no estouro sinaliza o GRUPO de processos
 * inteiro, nao so o filho direto. Os dois se poem no proprio grupo e devolvem 124. */
const TIMEOUT_BIN = '/usr/bin/timeout';

/**
 * I-37 (D5, D6, D7): o comando de verificacao nunca herda a autoridade HITL.
 *
 * Um comando que prova uma alegacao nao pode agir como o dono: com a chave de ingresso e os
 * ids do canal no ambiente, ele conseguiria responder um gate. Sai todo `ORK_HITL_*` (as seis
 * variaveis do PLAN mais as do OpenClaw, que vieram depois), so no executor de verify, e sem
 * valvula de escape: comando que precise delas vira escalacao para humano.
 */
export const PREFIXO_BLOQUEADO_NO_VERIFY = 'ORK_HITL_';

/**
 * RM-072 (S-b do CHECK 2): as variaveis de uma rodada do Agile. Cada rodada poe as suas onde precisa; herdadas de outra
 * rodada (o verify que roda dentro de um comando de outro verify), elas levariam pecas ao relatorio errado.
 */
const VARIAVEIS_DA_RODADA: ReadonlySet<string> = new Set([
  ENV_RELATORIO_DO_CHECK, ENV_VARREDURA_PARALELA_DO_CHECK, ENV_CPUS_DA_LANE, ENV_CPUS_DOCKER,
]);

export function ambienteDoVerify(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([chave]) => !chave.startsWith(PREFIXO_BLOQUEADO_NO_VERIFY)
    && !VARIAVEIS_DA_RODADA.has(chave)));
}

/** I-37 (D2): o prazo de um comando, resolvido uma vez por rodada (D3). */
export function prazoDoComando(manifesto: Manifesto, nome: string): number {
  const porComando = manifesto.verify.timeout_ms_por_comando as Record<string, number | undefined> | undefined;
  return porComando?.[nome] ?? manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS;
}

/** Teto da margem que o `security_scan` reserva, dentro do proprio prazo, para os passos que ele nao limita. */
export const MARGEM_MAX_DO_SCAN_MS = 300_000;

/**
 * O prazo interno da rodada do scan (`ORK_SECURITY_SCAN_DEADLINE_MS`): o prazo do comando menos a margem
 * `min(300 s, prazo/4)`, que cobre worktree add, sondas e `docker rm`. Assim a rodada termina, com `failed/timeout`
 * declarado, antes de o `timeout(1)` do verify matar o comando sem relatorio.
 */
export function prazoInternoDoScan(prazoMs: number): number {
  return prazoMs - Math.min(MARGEM_MAX_DO_SCAN_MS, Math.floor(prazoMs / 4));
}

/**
 * O comando roda o `security_scan`: pelo nome (verify, bundle do CI) ou por ser, na claim, o mesmo comando declarado em
 * `verify.security_scan`. Sem a chave, nada e scan.
 */
export function ehComandoDoScan(manifesto: Manifesto, nome: string, comando: string): boolean {
  if (nome === 'security_scan') return true;
  const scan = manifesto.verify.security_scan?.trim();
  return !!scan && comando.trim() === scan;
}

/**
 * O prazo de um comando do manifesto ou de uma claim: a claim que roda o scan ganha o prazo do `security_scan`. RM-072
 * (D4): a lane do Agile (`test:<lane>`) tem o prazo do `test` que ela substitui.
 */
export function prazoDaExecucao(manifesto: Manifesto, nome: string, comando: string): number {
  return prazoDoComando(manifesto, ehComandoDoScan(manifesto, nome, comando) ? 'security_scan' : nome.startsWith('test:') ? 'test' : nome);
}

/**
 * O executor resolvido pelo manifesto: prazo de cada comando e, no scan, o prazo interno no ambiente. RM-072 (D2):
 * `ambienteDaRodada` e o que a rodada passa a todo comando dela (o modo do CHECK); o CI hospedado nao passa nada.
 */
export function executorDoManifesto(manifesto: Manifesto, ambienteDaRodada?: Record<string, string>): ExecutorVerify {
  return (nome, comando, cwd) => {
    const prazo = prazoDaExecucao(manifesto, nome, comando);
    const extra = ehComandoDoScan(manifesto, nome, comando)
      ? { ORK_SECURITY_SCAN_DEADLINE_MS: String(prazoInternoDoScan(prazo)) }
      : undefined;
    return executar(nome, comando, cwd, prazo, ambienteDaRodada || extra ? { ...ambienteDaRodada, ...extra } : undefined);
  };
}

/**
 * Executa um comando de verificacao pelo shell, no diretorio de trabalho da thread.
 *
 * O `exec` sozinho mata so o `bash` quando estoura o teto: npm, tsc e node --test
 * ficavam orfaos, rodando sem dono. Em 21/09/2026 isso acumulou ate 38 builds de teste
 * presos e travou a VPS. Com o `timeout` na frente, o estouro leva a arvore inteira; e se
 * o proprio `ork` morrer no meio, o `timeout` segue de pe e encerra o grupo no prazo.
 * O estouro continua saindo como `code: -1`, o contrato de antes.
 */
export function executar(nome: string, comando: string, cwd: string,
  tetoMs = TIMEOUT_VERIFY_MS, ambienteExtra?: Record<string, string>): ResultadoDeComando {
  const comGrupo = existsSync(TIMEOUT_BIN);
  const inicio = Date.now();
  const ambiente = { ...ambienteDoVerify(), ...ambienteExtra };
  const r = comGrupo
    ? exec(TIMEOUT_BIN, ['--kill-after=15', `${Math.ceil(tetoMs / 1000)}`, 'bash', '-c', comando],
      cwd, tetoMs + 30_000, ambiente)
    : exec('bash', ['-c', comando], cwd, tetoMs, ambiente);
  return resultadoDoProcesso(nome, comando, r, comGrupo, Date.now() - inicio, tetoMs);
}

/**
 * RM-072 (D6): o resultado de um comando a partir do que o processo devolveu, o mesmo para o `executar` e para o grupo
 * paralelo do Agile (`check-paralelo.ts`), para os dois julgarem estouro, sinal e saida da mesma forma.
 */
export function resultadoDoProcesso(nome: string, comando: string,
  r: { ok: boolean; code: number; stdout: string; stderr: string; signal?: string | null; error?: string },
  comGrupo: boolean, duracaoMs: number, tetoMs: number): ResultadoDeComando {
  const causa = causaDoEncerramento({ code: r.code, signal: r.signal ?? null, error: r.error, comGrupo, duracaoMs, tetoMs });
  const estourou = causa === 'timeout';
  const resultado: ResultadoDeComando = {
    nome,
    comando,
    ok: r.ok,
    code: estourou ? -1 : r.code,
    resumo: resumirSaida(r.stdout, r.stderr),
    causa,
    prazoMs: tetoMs,
    duracaoMs,
    // I-54 (D11): so nao rodou o que o sistema recusou lancar; estouro e sinal rodaram e acabaram.
    // `spawnSync` pode devolver um erro tardio do sandbox junto de um status real (por exemplo EPERM com status 0):
    // nesse caso o processo existiu e o codigo observado e o veredito. So status ausente (`code: -1`) prova que nao lancou.
    executado: !(r.code === -1 && r.error && NAO_LANCADO.has(r.error)),
  };
  if (!r.ok) {
    const saida = r.stdout + (r.stderr ? '\n' + r.stderr : '');
    const testes = testesQueCairam(saida);
    if (testes.length > 0) resultado.testeQueCaiu = testes;
    const falhas = falhasDeTeste(saida);
    if (falhas.length > 0) resultado.falhasDeTeste = falhas;
    resultado.trecho = redigirSaida(saida);
  }
  return resultado;
}

/**
 * RM-037 (fatia 6): o comando nao tem veredito. Estouro de prazo, ou reprovacao so de teste com relogio
 * sob steal acima de 40%: a maquina, e nao o codigo, decidiu o resultado.
 */
export function semVereditoPorTempo(c: ResultadoDeComando): boolean {
  return c.causa === 'timeout' || (c.relogioSobSteal?.length ?? 0) > 0;
}

/**
 * RM-037 (fatia 6): mede o steal na janela de cada comando e marca a reprovacao que foi so de teste com
 * relogio sob steal alto. Os testes de relogio sao os da assinatura de prazo do runner e os do registro
 * de instabilidade vigente. Comando que passou, estourou ou nem rodou so ganha a medida.
 */
export function executorComSteal(base: ExecutorVerify, leitor: LeitorProcStat = lerProcStat,
  registro: TestesDeRelogio = new Set()): ExecutorVerify {
  return (nome, comando, cwd) => {
    const janela = abrirJanela(leitor);
    const r = base(nome, comando, cwd);
    const stealPct = janela.fechar();
    const resultado: ResultadoDeComando = { ...r, stealPct };
    if (!r.ok && r.causa !== 'timeout' && r.executado !== false && stealAlto(stealPct)) {
      const testes = reprovacaoSoDeRelogio(r.falhasDeTeste, registro);
      if (testes) resultado.relogioSobSteal = testes;
    }
    return resultado;
  };
}

/** I-54 (D11): erros de spawn em que o processo nem chegou a existir. */
const NAO_LANCADO: ReadonlySet<string> = new Set(['ENOENT', 'EACCES', 'EAGAIN', 'ENOMEM', 'EPERM', 'EMFILE']);

/**
 * I-54 (RM-037, D11): a identidade do produto que a rodada verifica. HEAD, o diff contra ele e o
 * conteudo dos arquivos nao rastreados (o que o `.gitignore` exclui, como `dist/`, fica fora). O
 * mtime nao entra: `touch` o engana, e identidade e conteudo. O `.orkastery/` fica fora sempre: e
 * o estado do proprio `ork` (ledger, claims), que a rodada escreve enquanto verifica.
 */
const FORA_DO_PRODUTO = [':(exclude).orkastery'];
export function identidadeDoProduto(cwd: string): string {
  const h = createHash('sha256');
  h.update(exec('git', ['rev-parse', 'HEAD'], cwd).stdout);
  h.update(exec('git', ['diff', 'HEAD', '--no-ext-diff', '--binary', '--', '.', ...FORA_DO_PRODUTO], cwd).stdout);
  const soltos = exec('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...FORA_DO_PRODUTO], cwd).stdout
    .split('\0').filter(Boolean).sort();
  for (const arquivo of soltos) {
    h.update(arquivo + '\0');
    try { h.update(readFileSync(join(cwd, arquivo))); } catch { h.update('<ilegivel>'); }
  }
  return h.digest('hex');
}

/**
 * I-37 (T3): por que o comando terminou, a partir do que o processo devolveu.
 *
 * Pelo `timeout(1)`, 124 e o estouro e 137 o SIGKILL do `--kill-after`, e so contam como
 * estouro quando o tempo corrido chegou ao prazo. Sem ele, o proprio spawnSync mata por prazo e
 * devolve `ETIMEDOUT`. Comando que o shell nao achou sai 127. Morte por sinal aparece no
 * `signal` do processo ou, no GNU `timeout`, como 128 + sinal (o uutils devolve so o numero,
 * que fica indistinguivel de um `exit` e e tratado como tal).
 */
export function causaDoEncerramento(r: { code: number; signal: string | null; error?: string; comGrupo: boolean;
  duracaoMs: number; tetoMs: number }): CausaDoComando {
  const estourou = (r.comGrupo && (r.code === 124 || r.code === 137) && r.duracaoMs >= r.tetoMs - 1000)
    || (!r.comGrupo && r.error === 'ETIMEDOUT');
  if (estourou) return 'timeout';
  if (r.error === 'ENOENT' || r.code === 127) return 'nao-encontrado';
  if (r.signal || (r.comGrupo && r.code > 128 && r.code < 160)) return 'sinal';
  return 'exit';
}

/** I-37 (D8): o que o ledger grava de um comando. Sucesso e o codigo 0; falha leva a evidencia. */
export function comandoNoLedger(c: ResultadoDeComando): Record<string, unknown> {
  // RM-072 (D2): a duracao vai tambem no comando que passa, para a meta do CHECK ser medida pelo ledger. RM-072 (D4, D5):
  // no Agile, o uso do preparo e as lanes; o Classic nao tem esses campos.
  const doAgile = { ...(c.preparo ? { preparo: c.preparo } : {}),
    ...(c.lanes ? { lanes: c.lanes.map((l) => ({ ...l, comando: redigirCredenciaisUrl(l.comando) })) } : {}),
    ...(c.comandoExecutado ? { comandoExecutado: redigirCredenciaisUrl(c.comandoExecutado) } : {}) };
  if (c.ok) return { nome: c.nome, ok: true, code: c.code, ...(c.duracaoMs !== undefined ? { duracaoMs: c.duracaoMs } : {}), ...doAgile };
  return {
    nome: c.nome, comando: redigirCredenciaisUrl(c.comando), ok: false, code: c.code, ...doAgile,
    ...(c.causa ? { causa: c.causa } : {}),
    ...(c.prazoMs !== undefined ? { prazoMs: c.prazoMs } : {}),
    ...(c.duracaoMs !== undefined ? { duracaoMs: c.duracaoMs } : {}),
    ...(c.testeQueCaiu?.length ? { testeQueCaiu: c.testeQueCaiu } : {}),
    ...(c.trecho !== undefined ? { trecho: c.trecho } : {}),
    ...(c.stealPct !== undefined ? { stealPct: c.stealPct } : {}),
    ...(c.relogioSobSteal?.length ? { relogioSobSteal: c.relogioSobSteal } : {}),
  };
}

/** Comandos declarados em `verify:` no manifesto, na ordem canonica. */
export function comandosDoManifesto(manifesto: Manifesto): { nome: string; comando: string }[] {
  const lista: { nome: string; comando: string }[] = [];
  for (const nome of ['typecheck', 'build', 'test', 'security_scan'] as const) {
    const comando = manifesto.verify[nome];
    if (comando && comando.trim() !== '') lista.push({ nome, comando });
  }
  return lista;
}

/** A regra estrutural do CHANGELOG entra no mesmo veredito e na mesma baseline dos comandos do manifesto. */
function verificarChangelog(cwd: string, base: string, baseCarimbada?: string | null): ResultadoDeComando {
  const inicio = Date.now();
  const comando = `node core/scripts/checar-changelog.cjs --base "${base}"`;
  const r = checarChangelog(cwd, { base, head: 'HEAD', baseCarimbada });
  return {
    nome: 'changelog', comando, ok: r.ok, code: r.ok ? 0 : r.motivo === 'changelog.base-indisponivel' ? 2 : 1,
    resumo: r.ok ? r.detalhe : `${r.motivo}: ${r.detalhe}\ncorrecao: ${r.correcao ?? 'corrija o CHANGELOG'}`,
    causa: 'exit', prazoMs: 0, duracaoMs: Date.now() - inicio, executado: true,
  };
}

/**
 * Diretorio onde a verificacao roda: a worktree da thread, ou a raiz do projeto. RM-047 (P2): a worktree
 * do `thread.json` so vale registrada no `git worktree list` e com o estado local (`estado.rastreado`,
 * `estado.worktree-nao-registrada`).
 */
export function cwdDaThread(raiz: string, thread: Thread): string {
  return diretorioDaThread(raiz, thread);
}

/** HEAD real do diretorio de trabalho, carimbado em toda verificacao. */
export function commitReal(cwd: string): string {
  const r = exec('git', ['rev-parse', 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : COMMIT_DESCONHECIDO;
}

/**
 * I-36 (T4): quem executa na worktree precisa da conducao da thread. A identidade de despacho do
 * ambiente faz a sessao que ja conduz reentrar (D4); o canal sai da borda (D6).
 */
export interface ConducaoDoVerify {
  canal?: CanalDeConducao;
  correlacao?: string | null;
  identidade?: string | null;
  /** `--esperar`: espera a vez ate este prazo em vez de recusar na hora (D2). */
  esperarMs?: number;
  /**
   * RM-058 N2 (D10 da ork-rm058n2): a espera pela fila de recursos pesados. Sem ela, `esperarMs` e depois
   * `ESPERA_PADRAO_DA_FILA_PESADA_MS`: quem verifica por dentro de outro comando (ship, fix, retry, a baseline do
   * despacho) nunca espera em silencio por muito tempo. O `ork verify` do CLI pede `ESPERA_DA_FILA_PESADA_MS` e avisa.
   */
  filaPesada?: { esperarMs?: number; aoEsperar?: (ocupantes: OcupanteDaFila[]) => void; comandoDeEsperar?: string };
}

/** RM-058 N2 (D10): quanto o `ork verify` do CLI espera a vez na fila pesada sem `--esperar`. */
export const ESPERA_DA_FILA_PESADA_MS = 60 * 60 * 1000;
/** RM-058 N2 (GO-FIX 1, B1 e A9 do CHECK): a espera de quem verifica por dentro de outro comando e nao disse prazo. */
export const ESPERA_PADRAO_DA_FILA_PESADA_MS = 30_000;

/**
 * RM-058 N2 (D9 e D10 da ork-rm058n2): a rodada inteira na fila de recursos pesados, depois da conducao. O
 * artefato e o diretorio de trabalho da thread; as vagas sao `concurrency.max_parallel_heavy` (0 desliga). Sem a
 * vez no prazo, `ErroDaFilaPesada` sai antes de qualquer comando rodar e de qualquer evento ir ao ledger.
 */
function naFilaPesada<T>(carregado: ManifestoCarregado, threadId: string, operacao: 'verify' | 'baseline',
  conducao: ConducaoDoVerify, executar: (uso: UsoDaFilaPesada) => T): T {
  const cwd = cwdDaThread(carregado.raiz, lerThread(carregado.raiz, threadId));
  const espera = conducao.filaPesada?.esperarMs ?? conducao.esperarMs ?? ESPERA_PADRAO_DA_FILA_PESADA_MS;
  return comRecursoPesado(carregado.raiz, { artefato: cwd, operacao, thread: threadId,
    slots: carregado.manifesto.concurrency.max_parallel_heavy, esperarMs: espera, aoEsperar: conducao.filaPesada?.aoEsperar,
    comandoDeEsperar: conducao.filaPesada?.comandoDeEsperar }, executar);
}

/** O pedido de conducao de uma verificacao, com o prazo derivado dos comandos que ela vai rodar (D3). */
function pedidoDoVerify(carregado: ManifestoCarregado, threadId: string, operacao: OperacaoDeConducao, comandos: number,
  conducao: ConducaoDoVerify) {
  return {
    canal: conducao.canal ?? canalDoProcesso(),
    correlacao: conducao.correlacao ?? null,
    operacao,
    identidade: conducao.identidade ?? identidadeDoAmbiente(threadId, process.env, carregado.raiz),
    prazoMs: prazoDaVerificacao(carregado.manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS, comandos),
    esperarMs: conducao.esperarMs,
  };
}

/** O executor que renova o prazo da conducao antes de cada comando (D3). */
function executorSobConducao(base: ExecutorVerify, manifesto: Manifesto, conducao: ConducaoTomada): ExecutorVerify {
  return (nome, comando, cwd) => {
    conducao.renovar(prazoDaExecucao(manifesto, nome, comando));
    return base(nome, comando, cwd);
  };
}

/**
 * Quem pediu a baseline. RM-037 (rm037defeito, defeito 1): alem do `ork verify --baseline` (cli), o
 * `ork phase run` grava a baseline do bloco com GO no codex, cujo sandbox nao grava o ledger. A funcao e
 * a execucao sao as mesmas; so o registro diz de onde veio.
 */
export type OrigemDaBaseline = 'cli' | 'phase.run';

/**
 * RM-037 (defeitos de 19 e 20/10/2026, defeito 1): o executor de uma rodada, o mesmo no verify e na baseline. O prazo
 * de cada comando sai do manifesto (`executorDoManifesto`, que tambem da ao scan o prazo interno), e o steal e medido na
 * janela de cada um, com os testes de relogio do registro de instabilidade da arvore verificada. A baseline rodava pelo
 * `executar` com o teto padrao de 600 s: em 20/10 a suite desta VPS passou disso, e o `test` foi gravado como "ja
 * falhava" com o manifesto dando 2400 s.
 */
export function executorDaRodada(manifesto: Manifesto, instabilidade: RegistroLido, base?: ExecutorVerify,
  leitor: LeitorProcStat = lerProcStat, ambienteDaRodada?: Record<string, string>): ExecutorVerify {
  return executorComSteal(base ?? executorDoManifesto(manifesto, ambienteDaRodada), leitor, testesDeRelogioVigentes(instabilidade));
}

/** RM-072 (D2): o que a rodada passa a todo comando dela, nos dois modos: o modo do CHECK. */
export function ambienteDoModo(check: ModoResolvido): Record<string, string> {
  return { [ENV_MODO_DO_CHECK]: check.modo };
}

/** RM-072 (D1, D2): o modo da rodada, como vai ao ledger. */
function checkNoLedger(check: ModoResolvido): Record<string, unknown> {
  return { modo: check.modo, origem: check.origem, nome: check.nome };
}

/** RM-072 (D5): a guarda do produto no fim do preparo; sem preparo, ou com ele reprovado, nada e reaproveitado. */
function guardaDoPreparo(manifesto: Manifesto, cwd: string, preparo: ResultadoDeComando | null): GuardaDoProduto {
  return new GuardaDoProduto(cwd, manifesto.check?.agile?.produto, identidadeDoProduto,
    preparo ? (preparo.ok ? null : 'preparo-falhou') : 'sem-preparo');
}

/**
 * RM-072 (S-b do CHECK 2, N5 do CHECK 3): no Agile, so quem escreve no relatorio da rodada o recebe, a varredura e as
 * lanes; o `build`, o `typecheck` e o `verify.test` (em serie ou no grupo) recebem so o modo, como as claims. O teste que
 * roda a varredura dentro do `verify.test` gravaria pecas de fixture no relatorio da rodada.
 */
function recebeORelatorio(nome: string): boolean {
  return nome === 'security_scan' || nome.startsWith('test:');
}

function soAVarreduraEAsLanesComRelatorio(comRelatorio: ExecutorVerify, semRelatorio: ExecutorVerify): ExecutorVerify {
  return (nome, comando, cwd) => (recebeORelatorio(nome) ? comRelatorio : semRelatorio)(nome, comando, cwd);
}

/**
 * RM-072 (D6): o executor do grupo do Agile. Sem executor injetado, o processo auxiliar roda os comandos ao mesmo tempo,
 * cada um com o prazo e o ambiente que o `executorDoManifesto` daria a ele (o do scan com o prazo interno), o steal medido
 * na janela do grupo e a conducao renovada com o maior prazo. Com executor injetado (MCP, testes), um por vez, por ele.
 */
function executorDoGrupo(manifesto: Manifesto, ambienteDaRodada: Record<string, string>, instabilidade: RegistroLido,
  leitor: LeitorProcStat, conducao: ConducaoTomada, injetado?: ExecutorVerify,
  medicaoCpu?: MedicaoCpuDoGrupo): ExecutorDeGrupo {
  if (injetado) return (itens, cwd) => itens.map((i) => injetado(i.nome, i.comando, cwd));
  const relogio = testesDeRelogioVigentes(instabilidade);
  // N5 do CHECK 3: no grupo, como em serie, so a varredura e as lanes recebem o relatorio da rodada.
  const { [ENV_RELATORIO_DO_CHECK]: _relatorio, ...semRelatorio } = ambienteDaRodada;
  const executar = ((itens, cwd) => {
    const prazos = itens.map((i) => prazoDaExecucao(manifesto, i.nome, i.comando));
    const paraOAuxiliar = itens.map((i, k) => ({ nome: i.nome, comando: i.comando, cwd, prazoMs: prazos[k],
      ...(i.nice ? { nice: i.nice } : {}), ...(i.apos?.length ? { apos: i.apos } : {}), ...(i.papelCpu ? { papelCpu: i.papelCpu } : {}),
      ambiente: { ...(recebeORelatorio(i.nome) ? ambienteDaRodada : semRelatorio), ...(ehComandoDoScan(manifesto, i.nome, i.comando)
        // RM-072: ao lado das lanes, a varredura roda poucas ferramentas por vez, para o grupo nao passar da CPU.
        ? { ORK_SECURITY_SCAN_DEADLINE_MS: String(prazoInternoDoScan(prazos[k])),
          ...(itens.length > 1 ? { [ENV_VARREDURA_PARALELA_DO_CHECK]: String(paralelismoDaVarreduraNoGrupo()) } : {}) } : {}) } }));
    // A conducao cobre o grupo inteiro: com a lane encadeada, a varredura e a lane somam.
    conducao.renovar(esperaDoGrupo(paraOAuxiliar));
    const janela = abrirJanela(leitor);
    const processos = rodarEmParalelo(paraOAuxiliar, ambienteDoVerify(), medicaoCpu ? { medicaoCpu } : {});
    if (processos.agendamentoCpu) {
      const p = processos.agendamentoCpu;
      executar.pecas = [{ peca: 'agendador-cpu', estado: p.saturado ? 'fallback' : 'agile',
        motivo: p.saturado
          ? `${p.motivo}; hermetica com ${p.cpusHermetica}/${p.cpus} CPUs, varredura e integracao depois dela`
          : `${p.cpusHermetica}/${p.cpus} CPUs na hermetica e ${p.cpusDaFatia} reservadas; conteineres com ${p.cpusPorContainer} CPU`,
        ...(p.saturado ? { fallback: 'ordem do Classic para hermetica, varredura e integracao' } : {}) }];
    }
    const stealPct = janela.fechar();
    return processos.map((p, k) => {
      const r: ResultadoDeComando = { ...resultadoDoProcesso(itens[k].nome, itens[k].comando, p, p.comGrupo, p.duracaoMs, prazos[k]), stealPct };
      // S1 do CHECK: o auxiliar que morreu sem gravar o resultado deixa o comando sem veredito, nunca uma regressao.
      if (p.semResultado) r.executado = false;
      if (!r.ok && r.causa !== 'timeout' && r.executado !== false && stealAlto(stealPct)) {
        const testes = reprovacaoSoDeRelogio(r.falhasDeTeste, relogio);
        if (testes) r.relogioSobSteal = testes;
      }
      return r;
    });
  }) as ExecutorDeGrupo;
  executar.pecas = [];
  return executar;
}

/** RM-072 (D8): o que o Agile grava no `verify_run`, alem dos comandos. */
export interface ResumoDoAgile {
  pecas: PecaDoAgile[];
  grupo: { paralelo: boolean; lanes: string[] };
  /** O hash curto do produto no fim do preparo (`null` sem guarda). */
  produto: string | null;
  claims: { reaproveitadas: number; inteiras: number };
  lanes: Array<{ lane: string; arquivos: number; sha256: string }>;
  /** O arquivo com a lista inteira de cada lane, relativo a raiz. */
  evidencia?: string;
  orcamento: Array<Record<string, unknown>>;
}

/**
 * RM-072 (D8): le o relatorio das pecas da rodada, grava a lista inteira de cada lane em
 * `.orkastery/threads/<id>/check/<commit>-lanes.json` e devolve o resumo do Agile para o `verify_run`.
 */
function agileNoLedger(raiz: string, threadId: string, commit: string, pecasDoVerify: PecaDoAgile[], doAgile: ComandosDoAgile | null,
  guarda: GuardaDoProduto, relatorio: RelatorioDoCheck, claims: ResultadoDeClaim[]): ResumoDoAgile {
  const linhas = relatorio.ler();
  relatorio.fechar();
  const doRelatorio = pecasDoRelatorio(linhas);
  const listas = listasDasLanes(linhas);
  const usos = claims.flatMap((c) => c.execucoes.map((e) => e.preparo).filter((u): u is NonNullable<typeof u> => !!u));
  const resumo: ResumoDoAgile = {
    pecas: [...pecasDoVerify, ...doRelatorio],
    grupo: { paralelo: doAgile?.paralelo ?? false, lanes: doAgile?.lanes ?? [] },
    produto: guarda.hashCurto(),
    claims: { reaproveitadas: usos.filter((u) => u.reaproveitado).length, inteiras: usos.filter((u) => !u.reaproveitado).length },
    lanes: listas.map((l) => ({ lane: l.lane, arquivos: l.arquivos.length, sha256: l.sha256 })),
    orcamento: linhas.filter((l) => l.tipo === 'duracoes').map(({ tipo: _tipo, ...resto }) => resto),
  };
  if (listas.length > 0) {
    // S10 do CHECK: o caminho vai relativo a raiz do estado (`.orkastery/threads/...`), nao a worktree de onde rodou.
    const arquivo = path.join(dirThread(raiz, threadId), 'check', `${commit.slice(0, 12)}-lanes.json`);
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
      fs.writeFileSync(arquivo, JSON.stringify({ commit, lanes: listas.map((l) => ({ lane: l.lane, arquivos: l.arquivos })) },
        null, 1) + '\n', { mode: 0o600 });
      resumo.evidencia = path.relative(raizDoEstado(raiz), arquivo);
    } catch { /* sem o arquivo, o ledger ainda guarda a contagem e o sha256 de cada lane */ }
  }
  return resumo;
}

/** O que um comando da baseline prova sobre o codigo do HEAD em que ela foi gravada. */
export type VereditoDaBaseline = 'passava' | 'ja-falhava' | 'sem-veredito';

/**
 * RM-037 (defeito 1 de 19 e 20/10/2026): so a falha com veredito vale como "ja falhava". Estouro do prazo, reprovacao
 * so de teste com relogio sob steal, morte por sinal e comando que nem rodou dizem que a maquina decidiu, e nao o
 * codigo; uma falha atual desse comando nao pode passar por divida anterior.
 */
export function vereditoDaBaseline(c: ResultadoDeComando): VereditoDaBaseline {
  if (c.ok) return 'passava';
  if (semVereditoPorTempo(c) || c.executado === false) return 'sem-veredito';
  return terminoNormal(c) ? 'ja-falhava' : 'sem-veredito';
}

/**
 * Achado 1 do CHECK da RM-037 (20/10/2026): o maior codigo de saida que e do proprio comando. De 124 em diante, quem fala
 * e quem nao deixou o comando terminar: 124 e o prazo do `timeout(1)` de dentro do comando (o de fora so o conta como
 * estouro quando o tempo dele chegou), 125 e 126 sao o `timeout(1)` ou o shell que nao rodaram o comando, 127 o comando
 * que nao existe, e de 128 em diante vem a morte por sinal (128 + sinal, do shell e do GNU `timeout`).
 */
const MAIOR_CODIGO_DO_COMANDO = 123;

/**
 * O comando terminou sozinho e disse o codigo: `causa: exit` (ou nenhuma, na baseline de antes da I-37, em que o estouro
 * saia como `code: -1`) com codigo de 1 a 123. Sinal, falta do codigo de saida e os codigos de quem nao deixou o
 * comando terminar nao provam nada do codigo do HEAD. O `timeout(1)` do uutils devolve so o numero do sinal que ele
 * trata (15 no SIGTERM), igual a uma saida do comando: esse fica de fora, como na `causaDoEncerramento`.
 */
function terminoNormal(c: ResultadoDeComando): boolean {
  return (c.causa === undefined || c.causa === 'exit') && Number.isInteger(c.code) && c.code >= 1
    && c.code <= MAIOR_CODIGO_DO_COMANDO;
}

/**
 * RM-037 (CHECK 3 da ork-rm037defeit2): a baseline e o verify nunca rodam sobre a worktree cujo preparo a criacao adiou
 * (o passo do arco abre a thread sob a trava de despacho) e que ainda nao deu certo. O preparo pendente roda aqui, com a
 * vez na fila pesada que a operacao ja segura, a conducao renovada pelo prazo dele e o executor da operacao quando ela
 * traz um (o do sandbox do `ork_verify` do MCP, com o prazo dele). A falha recusa a operacao inteira antes do primeiro
 * comando, porque sem as dependencias a baseline chamaria de "ja falhava" a falta de pacote, e o verify, de regressao.
 */
function exigirDependenciasDaWorktree(carregado: ManifestoCarregado, threadId: string, cwd: string,
  operacao: 'baseline' | 'verify', conducao: ConducaoTomada, executor: ExecutorVerify | undefined): void {
  const preparo = prepararDependenciasPendentes(carregado, threadId, cwd,
    { antes: () => conducao.renovar(PRAZO_DAS_DEPENDENCIAS_MS), executor });
  if (!preparo || preparo.ok) return;
  throw new ErroDoCatalogo((m) => m.verify.dependenciasPendentesFalharam(operacao, redigirCredenciaisUrl(preparo.comando),
    preparo.code, preparo.causa === 'timeout', cwd, ultimaLinhaDoPreparo(preparo)));
}

/** `ork verify --baseline`: grava o estado do mundo ANTES do GO. Sem `executor`, o da rodada (`executorDaRodada`). */
export function gravarBaseline(carregado: ManifestoCarregado, threadId: string, executor?: ExecutorVerify,
  conducao: ConducaoDoVerify = {}, origem: OrigemDaBaseline = 'cli', leitor: LeitorProcStat = lerProcStat,
  modo?: ModoDoCheck): Baseline {
  const pedido = pedidoDoVerify(carregado, threadId, 'baseline', comandosDoManifesto(carregado.manifesto).length + 1, conducao);
  return comConducao(carregado.raiz, threadId, pedido, (tomada) => naFilaPesada(carregado, threadId, 'baseline', conducao,
    () => gravarBaselineSobConducao(carregado, threadId, executor, tomada, origem, leitor, modo)));
}

function gravarBaselineSobConducao(carregado: ManifestoCarregado, threadId: string, base: ExecutorVerify | undefined,
  tomada: ConducaoTomada, origem: OrigemDaBaseline, leitor: LeitorProcStat, modo: ModoDoCheck | undefined): Baseline {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const cwd = cwdDaThread(raiz, thread);
  exigirDependenciasDaWorktree(carregado, threadId, cwd, 'baseline', tomada, base);
  // RM-072 (D1, D2): a baseline roda e grava no modo da rodada, como o verify.
  const check = resolverModo(manifesto.check?.mode, modo);
  const relatorio = check.modo === 'agile' ? new RelatorioDoCheck() : null;
  const ambienteDaRodada = { ...ambienteDoModo(check), ...relatorio?.ambiente() };
  const instabilidade = lerRegistroDeInstabilidade(cwd);
  const executor = executorSobConducao(executorDaRodada(manifesto, instabilidade, base, leitor, ambienteDaRodada), manifesto, tomada);
  // RM-072 (S-b do CHECK 2): fora do preparo, so a varredura e as lanes recebem o relatorio.
  const executorDosComandos = relatorio
    ? soAVarreduraEAsLanesComRelatorio(executor,
      executorSobConducao(executorDaRodada(manifesto, instabilidade, base, leitor, ambienteDoModo(check)), manifesto, tomada))
    : executor;
  // RM-072 (D4): no Agile com o produto declarado, o preparo, a guarda e o mesmo grupo do verify; sem o produto, nada
  // seria reaproveitado e os comandos rodam como no Classic.
  // RM-072 (A6 do CHECK): as pecas do preparo, do grupo e do relatorio vao ao `baseline_recorded`, como no `verify_run`.
  const pecasDaBaseline: PecaDoAgile[] = [];
  const comandosDoManifestoExecutados = relatorio && manifesto.check?.agile?.produto?.length
    ? (() => {
      const p = prepararNoAgile(manifesto, cwd, executor);
      pecasDaBaseline.push(...p.pecas);
      const r = comandosNoAgile(manifesto, cwd, comandosDoManifesto(manifesto), executorDosComandos,
        executorDoGrupo(manifesto, ambienteDaRodada, instabilidade, leitor, tomada, base ? executor : undefined),
        guardaDoPreparo(manifesto, cwd, p.resultado), p.resultado);
      pecasDaBaseline.push(...r.pecas);
      return r.comandos;
    })()
    : comandosDoManifesto(manifesto).map((c) => executorDosComandos(c.nome, c.comando, cwd));
  const comandos = [...comandosDoManifestoExecutados,
    verificarChangelog(cwd, manifesto.worktree.base_branch, thread.base?.commit)];
  if (relatorio) {
    if (base) pecasDaBaseline.push(PECA_SEM_RELATORIO);
    pecasDaBaseline.push(...pecasDoRelatorio(relatorio.ler()));
    relatorio.fechar();
  }
  // N1 do CHECK 2: a lane que saiu com 127 tambem e dependencia ausente, como o comando so do Classic.
  const naoEncontrado = comandos.find((c) => c.causa === 'nao-encontrado')
    ?? comandos.flatMap((c) => (c.lanes ?? []).filter((l) => l.causa === 'nao-encontrado')
      .map((l) => ({ nome: `${c.nome}:${l.lane}`, code: l.code, comando: l.comando })))[0];
  if (naoEncontrado) {
    // Uma dependencia ausente nao e divida do codigo: o comando nem chegou a existir. Gravar isso
    // como "ja falhava" faria todo verify futuro aceitar a falta da ferramenta como baseline.
    throw new ErroDoCatalogo((m) => m.verify.baselineDependenciaAusente(
      naoEncontrado.nome, naoEncontrado.code, redigirCredenciaisUrl(naoEncontrado.comando), manifesto.worktree.dependencias ?? null));
  }
  const baseline: Baseline = { commit: commitReal(cwd), gravadaEm: agora(), comandos, check: { modo: check.modo, origem: check.origem } };

  thread.baseline = baseline;
  gravarThread(raiz, thread);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.baselineGravada, {
    commit: baseline.commit,
    cwd,
    comandos: comandos.map((c) => ({ nome: c.nome, comando: c.comando, ok: c.ok, code: c.code, prazoMs: c.prazoMs ?? null,
      ...(c.duracaoMs !== undefined ? { duracaoMs: c.duracaoMs } : {}), ...(c.ok ? {} : { causa: c.causa ?? null }) })),
    check: checkNoLedger(check),
    ...(pecasDaBaseline.length ? { agile: { pecas: pecasDaBaseline } } : {}),
    // RM-037 (defeito 1 de 19 e 20/10/2026): o que a baseline nao provou fica dito no proprio evento.
    semVeredito: comandos.filter((c) => vereditoDaBaseline(c) === 'sem-veredito').map((c) => c.nome),
    fonte: 'execucao real no HEAD, nao relatorio de fase',
    origem,
  });
  return baseline;
}

export interface ResultadoVerify {
  thread: string;
  commit: string;
  cwd: string;
  claims: ResultadoDeClaim[];
  comandos: ResultadoDeComando[];
  baseline: Baseline | null;
  /** Passava na baseline e falha agora. */
  regressoes: ResultadoDeComando[];
  /** Ja falhava na baseline: divida pre-existente, nao regressao desta thread. */
  preExistentes: ResultadoDeComando[];
  /** Falhou sem baseline para comparar: declarado como tal, nao chamado de regressao. */
  falhasSemBaseline: ResultadoDeComando[];
  /** I-37 (D1): estourou o prazo sem terminar. Nem regressao nem falha: nao ha veredito. */
  estouros: ResultadoDeComando[];
  /** I-54 (D10): o preparo unico da rodada, quando o manifesto declara `verify.preparo`. */
  preparo: { resultado: ResultadoDeComando; identidade: string; identidadeFinal: string; produtoAlterado: boolean } | null;
  /** RM-037 (fatia 6): o steal medido na rodada, gravado no `verify_run`. */
  steal: MedidaDeSteal;
  /** RM-037 (fatia 6): o registro de instabilidade lido na arvore verificada. */
  instabilidade: RegistroLido;
  /** RM-058 N2: a vez na fila de recursos pesados que a rodada segurou. */
  filaPesada: UsoDaFilaPesada;
  /** RM-062 (F2): a barreira de dado privado do diff da thread; `null` sem a policy `dado_privado` no manifesto. */
  dadoPrivado?: BarreiraDaThread | null;
  /** RM-072 (D1): o modo do CHECK da rodada e de onde ele veio. */
  check: ModoResolvido;
  /** RM-072 (D2): a parede da rodada, do inicio sob a conducao ao `verify_run`. */
  duracaoMs: number;
  /** RM-072 (D8): o resumo do Agile; `null` no Classic. */
  agile: ResumoDoAgile | null;
  motivos: MotivoGate[];
  /** True quando nenhum motivo BLOQUEANTE apareceu. */
  ok: boolean;
}

/** RM-037 (fatia 6): o steal da rodada inteira e de cada comando, como vai ao `verify_run`. */
export interface MedidaDeSteal {
  fonte: typeof FONTE_STEAL;
  /** Houve medida da rodada (Linux com `/proc/stat`). Sem ela, nada e atenuado. */
  medido: boolean;
  /** Steal da rodada inteira, do preparo ao ultimo comando, em %. */
  rodadaPct: number | null;
  limiarPct: number;
  /** Steal na janela de cada comando (`build`, `test`, `C3.1`...), em %. */
  porComando: Record<string, number | null>;
  /** Comandos cuja reprovacao foi so de teste com relogio sob steal acima do limiar. */
  relogioSobSteal: string[];
}

/** Dependência interna; nunca desserializada de argumentos CLI/MCP. */
export type ExecutorVerify = (nome: string, comando: string, cwd: string) => ResultadoDeComando;

export interface OpcoesVerify {
  executor?: ExecutorVerify;
  /** Nao roda os comandos do manifesto, so as claims (usado em verificacao rapida). */
  soClaims?: boolean;
  /** I-36: canal, identidade e espera da conducao desta verificacao. */
  conducao?: ConducaoDoVerify;
  /** I-36: quem pede a verificacao (default `verify`); o MCP declara `mcp.verify`. */
  operacao?: OperacaoDeConducao;
  /** RM-037 (fatia 6): de onde vem o `/proc/stat` (dependencia interna, os testes injetam a VPS sob steal). */
  lerProcStat?: LeitorProcStat;
  /** RM-037 (fatia 6): o relogio da vigencia do registro de instabilidade. */
  agoraMs?: number;
  /** RM-072 (D1): o modo pedido pela opcao `--check`; vence o `check.mode` do manifesto. */
  check?: ModoDoCheck;
  /** Dependencia interna dos testes do agendador; em producao o auxiliar mede `/proc`. */
  medicaoCpuAgendador?: MedicaoCpuDoGrupo;
}

/**
 * Reexecuta a claim no HEAD real e devolve o veredito com o motivo tipado.
 *
 * Exportada para o bloco B5: as claims dos ACHADOS de auditoria passam por este mesmo
 * julgamento, sem uma segunda regra paralela que pudesse ser mais frouxa.
 */
export function verificarClaim(claim: ResultadoDeClaim['claim'], cwd: string, executor: ExecutorVerify = executar): ResultadoDeClaim {
  if (claim.verificar.length === 0) {
    const negativa = claim.negativa;
    return {
      claim,
      verificado: false,
      // Alegacao negativa sem comando e reprovacao (caso EvoJ6); positiva e aviso.
      motivo: negativa ? 'claims.failed' : 'claims.unverifiable',
      detalhe: textoDoCatalogo((m) => negativa ? m.verify.claimNegativaSemComando : m.verify.claimSemComando),
      execucoes: [],
    };
  }
  const execucoes = claim.verificar.map((c, i) => executor(`${claim.id}.${i + 1}`, c, cwd));
  // I-54 (D11): comando que nao rodou nao tem veredito, e lista vazia de execucao nunca aprova.
  const naoRodou = execucoes.find((e) => e.executado === false);
  if (naoRodou) {
    return {
      claim,
      verificado: false,
      motivo: 'verify.sem-veredito',
      detalhe: textoDoCatalogo((m) => m.verify.claimNaoExecutada(redigirCredenciaisUrl(naoRodou.comando), naoRodou.resumo)),
      execucoes,
    };
  }
  const falhou = execucoes.find((e) => !e.ok);
  // I-37 (D1): estouro de prazo nao desmente a alegacao; a prova so nao chegou ao fim. RM-037 (fatia 6):
  // nem a reprovacao so de teste com relogio sob steal acima de 40%.
  const estourou = !!falhou && semVereditoPorTempo(falhou);
  return {
    claim,
    verificado: !falhou,
    motivo: falhou ? (estourou ? 'verify.timeout' : 'claims.failed') : null,
    detalhe: textoDoCatalogo((m) => falhou
      ? estourou
        ? falhou.causa === 'timeout'
          ? m.verify.claimEstourou(falhou.comando, Math.round((falhou.prazoMs ?? 0) / 1000))
          : m.verify.claimRelogio(redigirCredenciaisUrl(falhou.comando), falhou.stealPct, LIMIAR_STEAL_PCT,
            falhou.relogioSobSteal!.join(', '))
        : m.verify.claimSaiu(redigirCredenciaisUrl(falhou.comando), falhou.code)
      : m.verify.claimOk(execucoes.length)),
    execucoes,
  };
}

/**
 * `ork verify`: reexecuta claims e comandos do manifesto e classifica cada falha.
 * Nao decide pausa, decide VERDADE: quem pausa e o gate do modo de conducao.
 */
export function verificar(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesVerify = {}
): ResultadoVerify {
  // I-36 (T4): sem a conducao da thread, nenhum comando roda; a recusa sai tipada, com quem conduz.
  const planejados = lerClaims(carregado.raiz, threadId).filter((c) => c.estado !== 'retirada')
    .reduce((n, c) => n + c.verificar.length, 0) + (opcoes.soClaims ? 0 : comandosDoManifesto(carregado.manifesto).length) + 1;
  const pedido = pedidoDoVerify(carregado, threadId, opcoes.operacao ?? 'verify', planejados, opcoes.conducao ?? {});
  return comConducao(carregado.raiz, threadId, pedido, (tomada) => naFilaPesada(carregado, threadId, 'verify', opcoes.conducao ?? {},
    (uso) => verificarSobConducao(carregado, threadId, opcoes, tomada, pedido.canal, uso)));
}

function verificarSobConducao(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesVerify,
  conducao: ConducaoTomada,
  canal: CanalDeConducao,
  filaPesada: UsoDaFilaPesada
): ResultadoVerify {
  const { raiz, manifesto } = carregado;
  const inicioDaRodada = Date.now();
  const thread = lerThread(raiz, threadId);
  const cwd = cwdDaThread(raiz, thread);
  exigirDependenciasDaWorktree(carregado, threadId, cwd, 'verify', conducao, opcoes.executor);
  const commit = commitReal(cwd);
  const dir = dirThread(raiz, threadId);
  // RM-072 (D1): o modo da rodada; a opcao vence o manifesto, que vence o padrao.
  const check = resolverModo(manifesto.check?.mode, opcoes.check);

  // I-43 (D4, viga b): os criterios de pronto da thread viram claims do nucleo ANTES
  // da reexecucao, para entrarem no MESMO veredito das demais alegacoes. Idempotente:
  // `ork verify` roda em toda fase, e uma claim por criterio por rodada viraria
  // acumulador em vez de verificacao.
  registrarCriteriosDePronto(raiz, threadId);

  // RM-037 (fatia 6): o registro de instabilidade da arvore verificada e a janela de steal da rodada.
  const instabilidade = lerRegistroDeInstabilidade(cwd, opcoes.agoraMs);
  const leitor = opcoes.lerProcStat ?? lerProcStat;
  const janelaDaRodada = abrirJanela(leitor);

  // RM-072 (D8): no Agile, as pecas contam o que rodaram num relatorio da rodada, lido no fim.
  const agil = check.modo === 'agile';
  const relatorio = agil ? new RelatorioDoCheck() : null;
  const ambienteDaRodada = { ...ambienteDoModo(check), ...relatorio?.ambiente() };

  // I-37 (D2, D3): o prazo de cada comando sai do manifesto carregado no inicio da rodada;
  // editar o manifesto no meio dela nao muda o teto de quem ainda vai rodar.
  const executor: ExecutorVerify = executorSobConducao(executorDaRodada(manifesto, instabilidade, opcoes.executor, leitor,
    ambienteDaRodada), manifesto, conducao);
  // RM-072 (A3 do CHECK): as claims recebem o modo, nunca o relatorio da rodada; o teste que roda a varredura dentro de uma
  // claim gravaria pecas de fixture no relatorio do verify. O relatorio fica com o preparo e o grupo.
  const executorDasClaims: ExecutorVerify = relatorio
    ? executorSobConducao(executorDaRodada(manifesto, instabilidade, opcoes.executor, leitor, ambienteDoModo(check)), manifesto, conducao)
    : executor;
  // RM-072 (S-b do CHECK 2): fora do preparo, so a varredura e as lanes recebem o relatorio.
  const executorDosComandos = relatorio ? soAVarreduraEAsLanesComRelatorio(executor, executorDasClaims) : executor;

  // I-54 (D10): o preparo roda UMA vez, antes das claims. Ele nunca e condicao para uma claim
  // passar (cada uma roda o proprio comando inteiro); ele so deixa pronta a compilacao. A
  // identidade do produto e tomada logo depois dele e conferida no fim da rodada.
  // RM-072 (D4): no Agile, o preparo do Agile primeiro, com o `verify.preparo` de fallback.
  const pecas: PecaDoAgile[] = [];
  const preparo = agil
    ? (() => {
      const p = prepararNoAgile(manifesto, cwd, executor);
      pecas.push(...p.pecas);
      return p.resultado ? { resultado: p.resultado, identidade: identidadeDoProduto(cwd) } : null;
    })()
    : manifesto.verify.preparo ? (() => {
      const resultado = executor('preparo', manifesto.verify.preparo!, cwd);
      return { resultado, identidade: identidadeDoProduto(cwd) };
    })() : null;
  // RM-072 (A6 do CHECK): com executor injetado (MCP, testes), o ambiente da rodada nao chega aos comandos; o ledger diz.
  if (agil && opcoes.executor) pecas.push(PECA_SEM_RELATORIO);
  // RM-072 (D5): a guarda do produto, tomada no fim do preparo.
  const vigente: PreparoVigente | null = agil
    ? { guarda: guardaDoPreparo(manifesto, cwd, preparo?.resultado ?? null), preparo: preparo?.resultado ?? null }
    : null;
  // RM-072 (A1, S-a, S-d e S-h do CHECK): a claim que compilou de novo (o build no meio da cadeia) muda o produto sem mudar
  // a arvore; o preparo roda de novo antes da claim seguinte que o reaproveitaria, ate MAXIMO_DE_PREPAROS_REFEITOS vezes,
  // e uma vez antes do grupo, e a peca diz o que aconteceu.
  const refazer = (quando: string): void => {
    pecas.push(...refazerPreparo(manifesto, cwd, executor, vigente!, (p) => guardaDoPreparo(manifesto, cwd, p), quando));
  };
  let preparosRefeitos = 0;
  const refazerAntesDaClaim: RefazerPreparo = (nome) => {
    if (!vigente || preparosRefeitos >= MAXIMO_DE_PREPAROS_REFEITOS) return false;
    preparosRefeitos++;
    refazer(`antes da claim ${nome}`);
    return true;
  };

  // Claim retirada sai do gate: o historico guarda a alegacao e o motivo da retirada.
  const executorDaClaim = vigente ? executorDaClaimNoAgile(manifesto, executorDasClaims, vigente, refazerAntesDaClaim) : executorDasClaims;
  const claims = lerClaims(raiz, threadId)
    .filter((c) => c.estado !== 'retirada')
    .map((c) => verificarClaim(c, cwd, executorDaClaim));
  for (const r of claims) {
    // Estouro de prazo e comando que nao rodou nao julgam a alegacao: o estado anterior vale.
    if (r.motivo === 'verify.timeout' || r.motivo === 'verify.sem-veredito') continue;
    const estado = r.verificado
      ? 'verificado'
      : r.motivo === 'claims.unverifiable'
        ? 'nao-verificavel'
        : 'reprovado';
    if (r.claim.estado !== estado) carimbarEstado(raiz, r.claim, estado);
  }

  // RM-072 (A1 do CHECK): o produto que mudou durante as claims tem o preparo refeito antes do grupo, que segue em paralelo.
  // S-h do CHECK 3: o grupo tem a vaga dele, fora do teto das claims.
  if (vigente && !opcoes.soClaims && vigente.guarda.conferir() === 'produto-mudou') refazer('antes do grupo');

  // RM-072 (D4, D6): no Agile, build do preparo e o resto no grupo paralelo, com a guarda valendo.
  let doAgile: ComandosDoAgile | null = null;
  const comandosDoManifestoExecutados = opcoes.soClaims
    ? []
    : vigente
      ? (doAgile = comandosNoAgile(manifesto, cwd, comandosDoManifesto(manifesto), executorDosComandos,
        executorDoGrupo(manifesto, ambienteDaRodada, instabilidade, leitor, conducao, opcoes.executor ? executor : undefined,
          opcoes.medicaoCpuAgendador),
        vigente.guarda, vigente.preparo)).comandos
      : comandosDoManifesto(manifesto).map((c) => executor(c.nome, c.comando, cwd));
  const comandos = opcoes.soClaims ? []
    : [...comandosDoManifestoExecutados,
      verificarChangelog(cwd, manifesto.worktree.base_branch, thread.base?.commit)];
  if (doAgile) pecas.push(...doAgile.pecas);
  const resumoDoAgile = vigente ? agileNoLedger(raiz, threadId, commit, pecas, doAgile, vigente.guarda, relatorio!, claims) : null;

  // RM-062 (F2): a barreira de dado privado no diff da thread, so com a policy `dado_privado` no manifesto.
  const dadoPrivado = barreiraDaThread(carregado, thread, cwd, 'verify');
  const dadoPrivadoBloqueia = bloqueantesDePolicy(dadoPrivado?.violacoes ?? []);

  const baseline = thread.baseline ?? null;
  const regressoes: ResultadoDeComando[] = [];
  const preExistentes: ResultadoDeComando[] = [];
  const falhasSemBaseline: ResultadoDeComando[] = [];
  const estouros: ResultadoDeComando[] = [];
  // RM-037 (defeito 1 de 19 e 20/10/2026): o comando sem veredito na baseline nao separa regressao de divida.
  const baselineSemVeredito = (baseline?.comandos ?? []).filter((c) => vereditoDaBaseline(c) === 'sem-veredito').map((c) => c.nome);
  for (const atual of comandos) {
    if (atual.ok) continue;
    if (semVereditoPorTempo(atual)) {
      estouros.push(atual);
      continue;
    }
    const antes = baseline?.comandos.find((c) => c.nome === atual.nome);
    if (!antes || vereditoDaBaseline(antes) === 'sem-veredito') falhasSemBaseline.push(atual);
    else if (antes.ok) regressoes.push(atual);
    else preExistentes.push(atual);
  }

  // I-54 (D11): o produto mudou entre o preparo e o fim da rodada? Entao nenhum veredito vale.
  const identidadeFinal = preparo ? identidadeDoProduto(cwd) : null;
  const produtoAlterado = !!preparo && identidadeFinal !== preparo.identidade;
  const naoExecutados = comandos.filter((c) => c.executado === false);

  const rodadaPct = janelaDaRodada.fechar();
  const todos = [...(preparo ? [preparo.resultado] : []), ...claims.flatMap((c) => c.execucoes), ...comandos];
  const steal: MedidaDeSteal = {
    fonte: FONTE_STEAL,
    medido: rodadaPct !== null,
    rodadaPct,
    limiarPct: LIMIAR_STEAL_PCT,
    porComando: Object.fromEntries(todos.map((c) => [c.nome, c.stealPct ?? null])),
    relogioSobSteal: todos.filter((c) => c.relogioSobSteal?.length).map((c) => c.nome),
  };

  const motivos: MotivoGate[] = [];
  if (claims.some((c) => c.motivo === 'claims.failed')) motivos.push('claims.failed');
  if (claims.some((c) => c.motivo === 'claims.unverifiable')) motivos.push('claims.unverifiable');
  if (regressoes.length > 0) motivos.push('verify.regression');
  if (falhasSemBaseline.length > 0) motivos.push('verify.failed');
  if (estouros.length > 0 || claims.some((c) => c.motivo === 'verify.timeout')) motivos.push('verify.timeout');
  if (produtoAlterado || naoExecutados.length > 0 || claims.some((c) => c.motivo === 'verify.sem-veredito')) {
    motivos.push('verify.sem-veredito');
  }
  if (dadoPrivadoBloqueia.length > 0) motivos.push('policy.violation');

  const bloqueantes = motivos.filter((m) => m !== 'claims.unverifiable');
  const ok = bloqueantes.length === 0;
  const duracaoMs = Date.now() - inicioDaRodada;

  registrar(dir, threadId, TIPOS_DE_EVENTO.verificacao, {
    commit,
    cwd,
    claims: claims.map((c) => {
      const falhou = c.execucoes.find((e) => !e.ok);
      return {
        id: c.claim.id,
        verificado: c.verificado,
        motivo: c.motivo,
        detalhe: c.detalhe,
        // RM-072 (D2): a soma da parede dos comandos da claim.
        duracaoMs: c.execucoes.reduce((t, e) => t + (e.duracaoMs ?? 0), 0),
        // RM-072 (D5): no Agile, o que a guarda fez com cada comando da claim.
        ...(c.execucoes.some((e) => e.preparo) ? { preparo: c.execucoes.map((e) => e.preparo ?? null) } : {}),
        ...(falhou ? { execucao: comandoNoLedger(falhou) } : {}),
      };
    }),
    comandos: comandos.map(comandoNoLedger),
    baseline: baseline ? { commit: baseline.commit, gravadaEm: baseline.gravadaEm } : null,
    regressoes: regressoes.map((r) => r.nome),
    preExistentes: preExistentes.map((r) => r.nome),
    falhasSemBaseline: falhasSemBaseline.map((r) => r.nome),
    ...(baselineSemVeredito.length > 0 ? { baselineSemVeredito } : {}),
    estouros: estouros.map((r) => r.nome),
    prazoMs: manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS,
    steal,
    ...(instabilidade.presente ? { instabilidade: { contrato: 'ork.instabilidade/v1', arquivo: instabilidade.arquivo,
      vigentes: instabilidade.vigentes.map((e) => e.teste), vencidas: instabilidade.vencidas.map((e) => e.teste),
      erros: instabilidade.erros } } : {}),
    ...(preparo ? { preparo: { ...comandoNoLedger(preparo.resultado), duracaoMs: preparo.resultado.duracaoMs,
      identidade: preparo.identidade.slice(0, 16), identidadeFinal: identidadeFinal!.slice(0, 16), produtoAlterado } } : {}),
    motivos,
    veredito: ok ? 'verdade sustentada' : 'reprovado',
    // RM-072 (D1, D2): o modo do CHECK e de onde ele veio, e a parede da rodada inteira.
    check: checkNoLedger(check),
    duracaoMs,
    // RM-072 (D8): no Agile, as pecas, o grupo, o reaproveitamento e as listas das lanes.
    ...(resumoDoAgile ? { agile: resumoDoAgile } : {}),
    // I-36: por qual canal a verificacao chegou; a reentrada da sessao que conduz aparece aqui.
    canal,
    conducao: { identidade: conducao.identidade, reentrada: conducao.reentrada },
    // RM-058 N2: se a rodada esperou a vez na fila pesada, e quanto.
    filaPesada,
    // RM-062 (F2): contagens, padroes e onde; nunca o valor casado nem o termo da lista local.
    ...(dadoPrivado ? { dadoPrivado: resumoNoLedger(dadoPrivado) } : {}),
  });

  // RM-062 (F2): em `warn`, a barreira registra e segue, como toda policy de aviso.
  for (const v of avisosDePolicy(dadoPrivado?.violacoes ?? [])) {
    registrar(dir, threadId, TIPOS_DE_EVENTO.politicaAviso, { gate: 'verify', policy: v.policy, motivo: v.motivo,
      detalhe: v.detalhe, correcao: v.correcao, modo: thread.modo });
  }

  for (const motivo of bloqueantes) {
    registrarGateBloqueado(dir, threadId, {
      gate: 'verify',
      motivo,
      modo: thread.modo,
      detalhe:
        motivo === 'claims.failed'
          ? claims
              .filter((c) => c.motivo === 'claims.failed')
              .map((c) => `${c.claim.id}: ${c.detalhe}`)
              .join('; ')
          : motivo === 'verify.regression'
            ? `regressao em: ${regressoes.map((r) => r.nome).join(', ')}`
            : motivo === 'verify.timeout'
              ? `sem veredito por tempo (prazo estourado, ou teste com relogio sob steal acima de ${LIMIAR_STEAL_PCT}%): ${[
                ...estouros.map((r) => porQueDasLanes(r) ? `${r.nome} (${porQueDasLanes(r)})` : r.nome),
                ...claims.filter((c) => c.motivo === 'verify.timeout').map((c) => c.claim.id)].join(', ')}`
              : motivo === 'verify.sem-veredito'
                ? [produtoAlterado ? 'o produto mudou entre o preparo e o fim da rodada' : '',
                  // RM-074 (F4): no Agile, o `test` diz qual lane ficou sem veredito e por que.
                  ...naoExecutados.map((c) => porQueDasLanes(c) ? `${c.nome} sem veredito (${porQueDasLanes(c)})` : `${c.nome} nao foi executado`),
                  ...claims.filter((c) => c.motivo === 'verify.sem-veredito').map((c) => `${c.claim.id}: ${c.detalhe}`)]
                  .filter(Boolean).join('; ')
                : motivo === 'policy.violation'
                  ? dadoPrivadoBloqueia.map((v) => `policy ${v.policy}: ${v.detalhe}`).join('; ')
                  : `falha sem baseline em: ${falhasSemBaseline.map((r) => r.nome).join(', ')}` + (falhasSemBaseline
                    .some((r) => baselineSemVeredito.includes(r.nome))
                    ? `; a baseline nao teve veredito de ${falhasSemBaseline.filter((r) => baselineSemVeredito.includes(r.nome))
                      .map((r) => r.nome).join(', ')} (estouro do prazo, sinal, relogio sob steal, comando que nao rodou ou sem ` +
                      'codigo de saida do proprio comando)' : ''),
      evidencia: `reexecucao no HEAD ${commit} em ${cwd}`,
      correcao:
        motivo === 'claims.failed'
          ? 'corrija o artefato ou a alegacao e rode `ork verify` de novo'
          : motivo === 'verify.timeout'
            ? 'rode `ork verify` de novo; se estourar sempre, suba verify.timeout_ms no manifesto ou divida o comando'
            : motivo === 'verify.sem-veredito'
              ? 'rode `ork verify` de novo, sem editar a worktree durante a rodada'
              : motivo === 'policy.violation'
                ? dadoPrivadoBloqueia.map((v) => v.correcao).join('; ')
                : 'corrija a regressao, ou grave a baseline antes do GO com `ork verify <thread> --baseline`',
    });
  }

  // RM-072 (D17): o ultimo modo do CHECK fica na thread, para o status mostrar.
  registrarModoNaThread(raiz, threadId, check, commit);

  return {
    thread: threadId,
    commit,
    cwd,
    claims,
    comandos,
    baseline,
    regressoes,
    preExistentes,
    falhasSemBaseline,
    estouros,
    preparo: preparo ? { ...preparo, identidadeFinal: identidadeFinal!, produtoAlterado } : null,
    steal,
    instabilidade,
    filaPesada,
    dadoPrivado,
    check,
    duracaoMs,
    agile: resumoDoAgile,
    motivos,
    ok,
  };
}

/**
 * RM-072 (D17): grava o modo do ultimo `verify_run` no `thread.json`. A thread e relida na hora, para nao devolver ao
 * disco uma copia lida no comeco da rodada; o status mostra a linha so quando o campo existe.
 */
function registrarModoNaThread(raiz: string, threadId: string, check: ModoResolvido, commit: string): void {
  const atual = lerThread(raiz, threadId);
  atual.check = { modo: check.modo, origem: check.origem, commit, em: agora() };
  gravarThread(raiz, atual);
}

/** `FALHOU (codigo 1)`, ou `ESTOUROU O PRAZO (600 s, rodou 612 s)`: a causa e dita pelo nome. */
function situacaoDoComando(c: ResultadoDeComando): string {
  const m = msg().verify;
  const s = (ms?: number) => `${Math.round((ms ?? 0) / 1000)} s`;
  if (c.causa === 'timeout') return m.estourou(s(c.prazoMs), s(c.duracaoMs));
  if (c.relogioSobSteal?.length) return m.relogioSobSteal(c.stealPct, LIMIAR_STEAL_PCT);
  if (c.causa === 'nao-encontrado') return m.naoExecutou(c.code);
  if (c.causa === 'sinal') return m.mortoPorSinal(c.code);
  return m.falhou(c.code);
}

/**
 * RM-037 (defeito 1 de 19 e 20/10/2026): as linhas de cada comando de `ork verify --baseline`, com o veredito dele, e a
 * linha que diz o que a baseline nao provou e como regravar.
 */
export function linhasDaBaseline(b: Baseline, id: string): string[] {
  const m = msg().verify;
  const linhas = b.comandos.map((c) => m.baselineComando(c.nome, vereditoDaBaseline(c), c.code, c.comando, situacaoDoComando(c)));
  // RM-072 (D1): o modo que gravou a baseline (a baseline anterior a RM-072 nao tem o campo).
  if (b.check) linhas.unshift(m.baselineCheck(NOME_DO_MODO[b.check.modo], b.check.modo, b.check.origem));
  const semVeredito = b.comandos.filter((c) => vereditoDaBaseline(c) === 'sem-veredito').map((c) => c.nome);
  if (semVeredito.length > 0) linhas.push(m.baselineSemVeredito(semVeredito.join(', '), id));
  return linhas;
}

/** Texto de `ork verify`. O detalhe da claim veio do catalogo em pt-BR e sai remontado no locale ativo. */
export function textoDoVerify(r: ResultadoVerify): string {
  const m = msg().verify;
  const linhas: string[] = [];
  linhas.push(m.titulo(r.thread));
  linhas.push(m.head(r.commit));
  linhas.push(m.diretorio(r.cwd));
  linhas.push(m.check(r.check.nome, r.check.modo, r.check.origem));
  // RM-072 (D8): no Agile, o reaproveitamento, o grupo e as pecas em fallback, quando ha o que dizer.
  const a = r.agile;
  if (a && (a.claims.reaproveitadas + a.claims.inteiras > 0 || a.grupo.paralelo)) {
    linhas.push(m.agile(a.claims.reaproveitadas, a.claims.inteiras, a.grupo.paralelo, a.grupo.lanes));
  }
  for (const p of a?.pecas.filter((x) => x.estado === 'fallback') ?? []) linhas.push(m.agileFallback(p.peca, p.motivo ?? '', p.fallback ?? ''));
  linhas.push(r.baseline ? m.baseline(shaCurto(r.baseline.commit), formatarDataHoraRotulada(r.baseline.gravadaEm)) : m.semBaseline);
  if (r.preparo) {
    const p = r.preparo;
    linhas.push(m.preparo(p.resultado.ok ? m.comandoOk : situacaoDoComando(p.resultado),
      Math.round((p.resultado.duracaoMs ?? 0) / 1000), p.produtoAlterado));
  }
  linhas.push(r.steal.medido ? m.stealMedido(r.steal.rodadaPct, r.steal.fonte, r.steal.limiarPct) : m.stealNaoMedido(r.steal.fonte));
  if (r.instabilidade.erros.length > 0) {
    linhas.push(m.instabilidadeForaDoContrato(r.instabilidade.arquivo, r.instabilidade.erros.join('; ')));
  } else if (r.instabilidade.vencidas.length > 0) {
    linhas.push(m.instabilidadeVencidas(r.instabilidade.vencidas.length, r.instabilidade.vencidas.map((e) => e.teste).join(', ')));
  }
  linhas.push('');
  linhas.push(m.claimsReexecutadas);
  if (r.claims.length === 0) {
    linhas.push(m.nenhumaClaim);
  }
  for (const c of r.claims) {
    linhas.push(m.claim(c.claim.id, c.verificado, c.claim.alegacao));
    linhas.push(m.arquivo(c.claim.arquivo));
    linhas.push(c.claim.verificar.length > 0 ? m.comandos(c.claim.verificar.join(' && ')) : m.semComando);
    if (!c.verificado) linhas.push(m.motivoTipado(String(c.motivo), remontar(c.detalhe)));
  }
  if (r.comandos.length > 0) {
    linhas.push('');
    linhas.push(m.comandosDoManifesto);
    for (const c of r.comandos) {
      linhas.push(m.comando(c.nome, c.ok ? m.comandoOk : situacaoDoComando(c), c.comando));
      if (!c.ok && c.testeQueCaiu?.length) linhas.push(m.testesQueCairam(c.testeQueCaiu.join('; ')));
    }
  }
  if (r.estouros.length > 0) {
    linhas.push('');
    linhas.push(m.semVeredito(r.estouros.map((c) => c.nome).join(', ')));
  }
  if (r.regressoes.length > 0 || r.preExistentes.length > 0 || r.falhasSemBaseline.length > 0) {
    linhas.push('');
    linhas.push(m.classificacao(r.regressoes.length, r.preExistentes.length, r.falhasSemBaseline.length));
    for (const c of r.regressoes) linhas.push(m.regressao(c.nome, c.comando));
    for (const c of r.preExistentes) linhas.push(m.preExistente(c.nome, c.comando));
    // RM-037 (defeito 1 de 19 e 20/10/2026): a baseline existe, mas nao teve veredito deste comando.
    const semVeredito = new Set((r.baseline?.comandos ?? []).filter((c) => vereditoDaBaseline(c) === 'sem-veredito').map((c) => c.nome));
    for (const c of r.falhasSemBaseline) {
      linhas.push(semVeredito.has(c.nome) ? m.falhaComBaselineSemVeredito(c.nome, c.comando) : m.falhaSemBaseline(c.nome, c.comando));
    }
  }
  if (r.dadoPrivado) linhas.push('', ...textoDaBarreira(r.dadoPrivado));
  linhas.push('');
  linhas.push(r.ok ? m.verdade : m.reprovado(r.motivos.join(', ')));
  return linhas.join('\n');
}

/** RM-062 (F2): a secao da barreira de dado privado, sem valor casado nem termo; ate 20 achados. */
function textoDaBarreira(b: BarreiraDaThread): string[] {
  const m = msg().verify;
  const v = b.varredura;
  const escopo = v.escopo.map((e) => e.tipo === 'diff' ? m.dadoPrivadoEscopoDiff(e.base.slice(0, 12), e.ref)
    : e.tipo === 'arvore' ? m.dadoPrivadoEscopoArvore : m.dadoPrivadoEscopoTexto(e.nome)).join(' + ');
  const linhas = [m.dadoPrivadoTitulo(b.severidade), m.dadoPrivadoEscopo(escopo, v.arquivos, v.linhas, v.nomes),
    v.listaLocal.presente ? m.dadoPrivadoListaPresente(v.listaLocal.termos, v.listaLocal.lidos.join(', '))
      : m.dadoPrivadoListaAusente(v.listaLocal.procurada.join(', '))];
  if (v.erro) return [...linhas, m.dadoPrivadoErro(v.erro)];
  linhas.push(m.dadoPrivadoAchados(v.achados.length));
  for (const a of v.achados.slice(0, 20)) linhas.push(m.dadoPrivadoAchado(a.arquivo, a.linha, a.coluna, a.padrao, a.termo));
  if (v.achados.length > 20) linhas.push(m.dadoPrivadoMais(v.achados.length - 20));
  return linhas;
}
