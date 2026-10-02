/**
 * RM-055: impedimento que so o dono resolve vira HITL.
 *
 * Em 29/09/2026 tres despachos `claude --bg` morreram com "Workspace not trusted. Run `claude` in
 * <worktree> once and accept the trust prompt". O ledger guardou so `phase_dispatch_failed`, as threads
 * ficaram `aberta` e o board, a fabrica e o pulse disseram "espera voce: -". O dono descobriu horas
 * depois, perguntando.
 *
 * Aqui a saida do runtime vira motivo tipado. O motivo que so o dono resolve (aceitar a confianca do
 * diretorio, aceitar termos novos do CLI) abre a pausa do dono com o que trava, o comando exato que ele
 * roda e o que o `ork` faz depois: `ork retry run <thread>` re-despacha a MESMA fase com o MESMO prompt
 * gravado, sem o dono reescrever o pedido. Login ausente e cota esgotada continuam na rotacao de conta
 * (I-33): la quem resolve primeiro e o orquestrador, trocando de perfil. Motivo desconhecido continua
 * generico (`runtime.unavailable`).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registrarGateBloqueado } from './gates';
import { montarPedidoCurto, PedidoCurto } from './hitl-curto';
import { PerfilDeDespacho } from './runtime-profiles';
import { Fase, MotivoGate, Thread } from './types';

/** Os motivos de despacho que so o dono resolve. Ficam em "espera voce", nunca em "Conosco". */
export type MotivoDoDono = 'runtime.workspace-untrusted' | 'runtime.consent-pending';

export const MOTIVOS_DE_IMPEDIMENTO_DO_DONO: readonly MotivoDoDono[] = Object.freeze([
  'runtime.workspace-untrusted', 'runtime.consent-pending',
]);

export function ehImpedimentoDoDono(motivo: unknown): motivo is MotivoDoDono {
  return typeof motivo === 'string' && (MOTIVOS_DE_IMPEDIMENTO_DO_DONO as readonly string[]).includes(motivo);
}

/**
 * Um evento do ledger que espera o dono: a escalada `human.pending` ou o impedimento tipado do despacho.
 * E a mesma regra para o monitor, a ocupacao de vaga, a fabrica e o pulse.
 */
export function ehEsperaDoDono(e: { tipo: string; motivo?: unknown }, tipoGateBloqueado = 'gate_blocked'): boolean {
  return e.tipo === tipoGateBloqueado && (e.motivo === 'human.pending' || ehImpedimentoDoDono(e.motivo));
}

export interface ContextoDoImpedimento {
  thread: string;
  fase: string;
  runtime: string;
  cwd: string;
}

export interface ImpedimentoDoDono {
  motivo: MotivoDoDono;
  /** O que trava, em uma frase. */
  trava: string;
  /** O comando exato que o dono roda no terminal. */
  comando: string;
  /** O que o ork faz depois, com o comando que dispara. */
  depois: string;
  /** O trecho da saida do runtime que provou o motivo. */
  trecho: string;
}

/** Aspas de shell so quando o caminho precisa. */
function citar(caminho: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(caminho) ? caminho : `'${caminho.replace(/'/g, `'\\''`)}'`;
}

const FRASES_DE_CONFIANCA: readonly RegExp[] = [
  /workspace not trusted/i,
  /accept the trust (?:prompt|dialog)/i,
  /not inside a trusted directory/i,
  /(?:folder|directory|workspace) (?:is )?not trusted/i,
];

const FRASES_DE_CONSENTIMENTO: readonly RegExp[] = [
  /accept (?:the )?(?:updated |new )?(?:terms|consumer terms|privacy policy|usage policy)/i,
  /(?:terms|policy) (?:have|has) (?:been )?updated[^\n]*accept/i,
  /consent (?:is )?required/i,
];

function trechoDa(texto: string, regra: RegExp): string {
  const linha = texto.split(/\r?\n/).find(l => regra.test(l)) ?? texto;
  return linha.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function binarioDo(runtime: string): string {
  return runtime === 'codex' ? 'codex' : 'claude';
}

/**
 * Le a saida do runtime (stderr e o erro do adapter) e devolve o impedimento do dono, ou null.
 * Null quer dizer "nao e do dono": o despacho segue no caminho de antes.
 */
export function classificarImpedimento(saida: string, ctx: ContextoDoImpedimento): ImpedimentoDoDono | null {
  const texto = saida ?? '';
  const bin = binarioDo(ctx.runtime);
  const depois = `depois, \`ork retry run ${ctx.thread}\` re-despacha ${ctx.fase} com o mesmo prompt gravado`;
  const confianca = FRASES_DE_CONFIANCA.find(r => r.test(texto));
  if (confianca) {
    return {
      motivo: 'runtime.workspace-untrusted',
      trava: `o ${bin} não confia no diretório da worktree e recusou o despacho de ${ctx.fase}`,
      comando: `cd ${citar(ctx.cwd)} && ${bin}`,
      depois: `aceite a confiança no diretório e saia; ${depois}`,
      trecho: trechoDa(texto, confianca),
    };
  }
  const consentimento = FRASES_DE_CONSENTIMENTO.find(r => r.test(texto));
  if (consentimento) {
    return {
      motivo: 'runtime.consent-pending',
      trava: `o ${bin} espera você aceitar termos novos e recusou o despacho de ${ctx.fase}`,
      comando: bin,
      depois: `aceite os termos e saia; ${depois}`,
      trecho: trechoDa(texto, consentimento),
    };
  }
  return null;
}

/**
 * O impedimento ja foi resolvido? So o de confianca do diretorio tem prova local: o `claude` grava
 * `hasTrustDialogAccepted` por projeto no `.claude.json` da conta (o do perfil, com `CLAUDE_CONFIG_DIR`),
 * e a confianca de um diretorio vale para os de baixo. `null` e "nao sei": o retry despacha e o runtime
 * decide; se recusar de novo, a mesma pausa volta.
 */
export function impedimentoResolvido(motivo: MotivoGate, ctx: { cwd: string; runtime: string; configDir?: string | null;
  home?: string }): boolean | null {
  if (motivo !== 'runtime.workspace-untrusted' || ctx.runtime !== 'claude-bg') return null;
  // A conta do processo segue o `CLAUDE_CONFIG_DIR` do ambiente, como o proprio `claude`.
  const configDir = ctx.configDir ?? (ctx.home ? null : process.env.CLAUDE_CONFIG_DIR) ?? null;
  const arquivo = configDir ? path.join(configDir, '.claude.json') : path.join(ctx.home ?? os.homedir(), '.claude.json');
  let projetos: Record<string, { hasTrustDialogAccepted?: unknown }>;
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { projects?: unknown };
    if (!dados || typeof dados.projects !== 'object' || dados.projects === null) return null;
    projetos = dados.projects as typeof projetos;
  } catch { return null; }
  for (let dir = path.resolve(ctx.cwd); ; dir = path.dirname(dir)) {
    if (projetos[dir]?.hasTrustDialogAccepted === true) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** A frase de correcao que vai ao gate e ao monitor: o comando e o que vem depois. */
export function correcaoDoImpedimento(i: Pick<ImpedimentoDoDono, 'comando' | 'depois'>): string {
  return `rode \`${i.comando}\`; ${i.depois}`;
}

/**
 * RM-055: classifica a saida de um despacho recusado e, quando so o dono resolve, grava o `gate_blocked`
 * tipado que o monitor, a fabrica, o board e o pulse leem como espera do dono. Devolve null quando o
 * motivo nao e do dono (o chamador segue no caminho de antes). Tambem usado pelo redespacho do retry.
 */
export function registrarImpedimentoDoDono(dir: string, thread: Thread, d: { fase: Fase; slug: string; runtime: string;
  cwd: string; origem: string; promptPath: string; promptSha256: string; perfil?: PerfilDeDespacho | null; saida: string }):
  ImpedimentoDoDono | null {
  const impedimento = classificarImpedimento(d.saida, { thread: thread.id, fase: d.fase, runtime: d.runtime, cwd: d.cwd });
  if (!impedimento) return null;
  registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: impedimento.motivo, modo: thread.modo,
    detalhe: impedimento.trava, correcao: correcaoDoImpedimento(impedimento), fase: d.fase, slug: d.slug,
    runtime: d.runtime, cwd: d.cwd, origem: d.origem, promptPath: d.promptPath, promptSha256: d.promptSha256,
    impedimento: { motivo: impedimento.motivo, comando: impedimento.comando, depois: impedimento.depois, trecho: impedimento.trecho },
    ...(d.perfil ? { perfil: d.perfil } : {}), pausaQualquerModo: true,
    evidencia: 'stderr real do runtime adapter no despacho, nao relato do agente' });
  return impedimento;
}

/** O impedimento gravado no `gate_blocked`, lido de volta com tipos; null quando o evento nao o traz. */
export function impedimentoDoEvento(e: { [campo: string]: unknown }): { comando: string; depois: string; trecho: string } | null {
  const i = e.impedimento as { comando?: unknown; depois?: unknown; trecho?: unknown } | undefined;
  if (!i || typeof i.comando !== 'string' || typeof i.depois !== 'string') return null;
  return { comando: i.comando, depois: i.depois, trecho: typeof i.trecho === 'string' ? i.trecho : '' };
}

/**
 * RM-055 (b): o pedido do impedimento no contrato curto da RM-048 (`ork.hitl-curto/v1`): o que trava,
 * desde quando, o comando exato que o dono roda e o que o ork faz depois. A recomendada e o re-despacho
 * do mesmo prompt; as outras dizem o custo de nao fazer nada e de trocar o runtime do bloco.
 */
export function pedidoCurtoDoImpedimento(d: { thread: string; fase: string | null; motivo: string; detalhe: string;
  desdeEm: string | null; impedimento: { comando: string; depois: string } }, quando: string): PedidoCurto {
  const retry = `ork retry run ${d.thread}`;
  return montarPedidoCurto({
    thread: d.thread, fase: d.fase, desde: d.desdeEm,
    pergunta: `Você roda \`${d.impedimento.comando}\` no terminal para destravar o despacho?`,
    corpo: [`${d.motivo}: ${d.detalhe}`, `Depois: ${d.impedimento.depois}.`],
    alternativas: [
      { chave: 'a', texto: 'Rodei o comando', consequencia: `\`${retry}\` re-despacha ${d.fase ?? 'a fase'} com o mesmo prompt gravado`,
        recomendada: { porque: 'nada rodou ainda; o pedido volta igual, sem você reescrever nada' } },
      { chave: 'b', texto: 'Trocar o runtime do bloco', consequencia: 'ork setup <modo> --bloco N --runtime <outro>, e depois o mesmo retry' },
      { chave: 'c', texto: 'Deixar parada', consequencia: 'nada é despachado; a thread segue esperando você' },
    ],
  }, { quando, responder: { tipo: 'terminal', comando: retry } });
}
