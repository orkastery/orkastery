/**
 * I-55 (RM-008): o loop de aprendizado.
 *
 * Havia dezenas de POSTMORTEMs e nenhuma licao voltando no ciclo seguinte: a licao so existia na
 * colecao `learning` do OrkMind, e so no GOAL. Aqui ela sai direto dos arquivos que o MASTER ja
 * grava (`POSTMORTEM.json` e `master-log.json`), em qualquer regime de memoria, e volta no GOAL e
 * no PLAN da thread seguinte do mesmo produto. So conta thread fechada pelo MASTER: licao de
 * thread aberta seria auto-relato.
 *
 * Quando a mesma falha se repete, o loop nao cria regra sozinho: ele PROPOE a policy, com as
 * threads que a sustentam, e a proposta fica no ledger do projeto e em `ork licoes`. Transformar
 * proposta em policy (`policies:` no manifesto) muda o que bloqueia a fabrica, e isso e do dono.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ClasseDeFalha, MasterLog, Postmortem } from './types';
import { POLICIES_CONHECIDAS } from './policies';

/** A licao de UMA thread fechada. */
export interface LicaoDaThread {
  thread: string;
  score: number | null;
  justificativa: string;
  classes: ClasseDeFalha[];
  motivos: string[];
  bloqueios: number;
  fechadaEm: string;
}

export interface RecorrenciaDeLicao {
  chave: string;
  tipo: 'motivo' | 'classe';
  nome: string;
  threads: string[];
  vezes: number;
  dica: string | null;
}

export interface ResumoDasLicoes {
  threads: number;
  motivos: RecorrenciaDeLicao[];
  classes: RecorrenciaDeLicao[];
  /** As licoes mais recentes com nota de 1 a 3 (ate 3), com a justificativa do MASTER. */
  recentes: LicaoDaThread[];
}

export interface PropostaDePolicy {
  chave: string;
  tipo: 'motivo' | 'classe';
  nome: string;
  threads: string[];
  janelaDias: number;
  sugestao: string;
}

/** O que evita cada bloqueio, na forma de comando. Sem dica, a licao so conta a recorrencia. */
const DICA_DO_MOTIVO: Record<string, string> = {
  'claims.failed': 'rode o comando da claim antes de registra-la; claim sem prova local volta como GO-FIX',
  'verify.regression': 'grave a baseline antes do GO (`ork verify <thread> --baseline`) e rode os testes focados antes do CHECK',
  'verify.failed': 'grave a baseline antes do GO, para a falha ter com que ser comparada',
  'verify.timeout': 'divida o comando lento ou suba `verify.timeout_ms` no manifesto',
  'runtime.unavailable': 'declare a ordem de fallback do bloco (`ork setup <modo> --bloco N --fallback runtime:modelo`)',
  'runtime.quota-exhausted': 'tenha um segundo perfil da conta (`ork accounts add`) ou fallback no bloco',
  'runtime.profile-invalid': 'confira os perfis do runtime em `ork accounts list` antes de pedir `--perfil`',
  'tree.blocked': 'sincronize a worktree com a base antes do SHIP (`ork worktree sync <thread>`)',
  'ci.failed': 'rode a suite hermetica (`npm --prefix core run test:ci`) antes do push',
  'artifact.missing': 'grave o artefato da fase exatamente no caminho que o prompt pede',
};

const DICA_DA_CLASSE: Partial<Record<ClasseDeFalha, string>> = {
  'erro-de-spec': 'declare criterios de pronto executaveis na criacao (`ork thread new ... --done`)',
  'base-avancou': 'sincronize com a base antes do CHECK, nao so antes do SHIP',
  'conflito': 'reserve o item do roadmap antes de comecar (`ork roadmap pegar`)',
  'rate-limit': 'use o fallback do bloco em vez de esperar a janela',
  'processo': 'siga o ciclo do modo: GOAL e PLAN antes do GO, e toda afirmacao com claim e comando',
  'scope-creep': 'corte o pedido em fatias com item proprio no roadmap',
};

/** Classes que nao ensinam nada por si: nao entram na recorrencia. */
const CLASSES_SEM_LICAO: ReadonlySet<ClasseDeFalha> = new Set(['sem-falha', 'outra']);

function lerJson<T>(arquivo: string): T | null {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as T; } catch { return null; }
}

/** As licoes das threads fechadas pelo MASTER no estado deste projeto. */
export function lerLicoes(raiz: string): LicaoDaThread[] {
  const dir = path.join(raizDoEstado(raiz), '.orkastery', 'threads');
  if (!fs.existsSync(dir)) return [];
  const licoes: LicaoDaThread[] = [];
  for (const id of fs.readdirSync(dir)) {
    const pm = lerJson<Postmortem>(path.join(dir, id, 'POSTMORTEM.json'));
    const master = lerJson<MasterLog>(path.join(dir, id, 'master-log.json'));
    if (!pm || !master || pm.thread !== id) continue;
    licoes.push({
      thread: id,
      score: typeof master.score === 'number' ? master.score : null,
      justificativa: String(master.justificativa ?? '').replace(/\s+/g, ' ').trim(),
      classes: (pm.classesDeFalha ?? []).filter((c) => typeof c === 'string'),
      motivos: [...new Set((pm.gatesBloqueados ?? []).map((g) => g.motivo).filter((m) => typeof m === 'string'))],
      bloqueios: (pm.gatesBloqueados ?? []).length,
      fechadaEm: master.avaliadoEm ?? pm.geradoEm ?? '',
    });
  }
  return licoes.sort((a, b) => b.fechadaEm.localeCompare(a.fechadaEm));
}

function recorrencias(licoes: readonly LicaoDaThread[]): { motivos: RecorrenciaDeLicao[]; classes: RecorrenciaDeLicao[] } {
  const motivos = new Map<string, RecorrenciaDeLicao>();
  const classes = new Map<string, RecorrenciaDeLicao>();
  for (const l of licoes) {
    for (const m of l.motivos) {
      const r = motivos.get(m) ?? { chave: `motivo:${m}`, tipo: 'motivo' as const, nome: m, threads: [], vezes: 0, dica: DICA_DO_MOTIVO[m] ?? null };
      r.threads.push(l.thread);
      motivos.set(m, r);
    }
    for (const c of l.classes) {
      if (CLASSES_SEM_LICAO.has(c)) continue;
      const r = classes.get(c) ?? { chave: `classe:${c}`, tipo: 'classe' as const, nome: c, threads: [], vezes: 0, dica: DICA_DA_CLASSE[c] ?? null };
      r.threads.push(l.thread);
      classes.set(c, r);
    }
  }
  const ordenar = (a: RecorrenciaDeLicao, b: RecorrenciaDeLicao) => b.threads.length - a.threads.length || a.nome.localeCompare(b.nome);
  for (const r of motivos.values()) r.vezes = r.threads.length;
  for (const r of classes.values()) r.vezes = r.threads.length;
  return { motivos: [...motivos.values()].sort(ordenar), classes: [...classes.values()].sort(ordenar) };
}

/** O resumo que volta no GOAL e no PLAN: a thread corrente nunca aprende consigo mesma. */
export function resumoDasLicoes(raiz: string, threadCorrente: string | null): ResumoDasLicoes {
  const licoes = lerLicoes(raiz).filter((l) => l.thread !== threadCorrente);
  const { motivos, classes } = recorrencias(licoes);
  return {
    threads: licoes.length,
    motivos: motivos.slice(0, 3),
    classes: classes.slice(0, 2),
    // Nota 0 e, na pratica, encerramento de thread orfa sem entrega: nao ensina nada ao proximo ciclo.
    recentes: licoes.filter((l) => l.score !== null && l.score >= 1 && l.score <= 3 && l.justificativa).slice(0, 3),
  };
}

const curto = (t: string, teto: number) => (t.length > teto ? `${t.slice(0, teto - 3)}...` : t);

/** O texto da licao para o prompt. Vazio quando nao ha thread fechada para ensinar. */
export function textoDasLicoes(r: ResumoDasLicoes): string {
  if (r.threads === 0 || (r.motivos.length === 0 && r.classes.length === 0 && r.recentes.length === 0)) return '';
  const linhas = [`Das ${r.threads} threads ja fechadas pelo MASTER neste produto:`];
  for (const m of r.motivos) {
    linhas.push(`- o bloqueio ${m.nome} apareceu em ${m.threads.length} ${m.threads.length === 1 ? 'thread' : 'threads'}` +
      (m.dica ? `; o que evita: ${m.dica}` : ''));
  }
  for (const c of r.classes) {
    linhas.push(`- a classe de falha ${c.nome} fechou ${c.threads.length} ${c.threads.length === 1 ? 'thread' : 'threads'}` +
      (c.dica ? `; o que evita: ${c.dica}` : ''));
  }
  for (const l of r.recentes) linhas.push(`- ${l.thread} fechou com ${l.score}/5: ${curto(l.justificativa, 160)}`);
  return linhas.join('\n');
}

/** Janela e piso da recorrencia que vira proposta de policy. */
export const JANELA_DA_PROPOSTA_DIAS = 30;
export const PISO_DA_PROPOSTA = 3;

/**
 * A mesma falha em pelo menos 3 threads fechadas nos ultimos 30 dias vira PROPOSTA de policy.
 * So proposta: a policy muda o que bloqueia a fabrica, e isso e do dono.
 */
export function propostasDePolicy(raiz: string, agoraIso: string = new Date().toISOString()): PropostaDePolicy[] {
  const limite = Date.parse(agoraIso) - JANELA_DA_PROPOSTA_DIAS * 86_400_000;
  const recentes = lerLicoes(raiz).filter((l) => Date.parse(l.fechadaEm) >= limite);
  const { motivos, classes } = recorrencias(recentes);
  return [...motivos, ...classes].filter((r) => r.threads.length >= PISO_DA_PROPOSTA).map((r) => {
    const policy = r.nome.replace(/[^a-z0-9]+/gi, '_');
    const dica = r.dica ?? 'revisar a causa comum antes da proxima thread';
    // RM-008 (fatia 3): com avaliador no nucleo, a proposta ja diz como vira policy de verdade.
    const sugestao = policy in POLICIES_CONHECIDAS
      ? `policy \`${policy}\` executavel: declare \`${policy}: warn\` em policies: do orkastery.yaml; o que evita: ${dica}`
      : `policy \`${policy}\` em warn: ${dica}`;
    return { chave: r.chave, tipo: r.tipo, nome: r.nome, threads: [...r.threads], janelaDias: JANELA_DA_PROPOSTA_DIAS, sugestao };
  });
}

/**
 * Grava no ledger do projeto a proposta que ainda nao foi registrada nesta janela. Idempotente:
 * rodar de novo nao duplica. Devolve so as novas.
 */
export function registrarPropostasNovas(raiz: string, agoraIso: string = new Date().toISOString()): PropostaDePolicy[] {
  const dirProjeto = path.join(raizDoEstado(raiz), '.orkastery');
  const limite = Date.parse(agoraIso) - JANELA_DA_PROPOSTA_DIAS * 86_400_000;
  const jaFeitas = new Set(lerLedger(dirProjeto)
    .filter((e) => e.tipo === TIPOS_DE_EVENTO.politicaProposta && Date.parse(e.ts) >= limite)
    .map((e) => String(e.chave)));
  const novas = propostasDePolicy(raiz, agoraIso).filter((p) => !jaFeitas.has(p.chave));
  for (const p of novas) {
    // `categoria`, nao `tipo`: o `registrar` espalha os dados por cima do tipo do evento.
    registrar(dirProjeto, 'projeto', TIPOS_DE_EVENTO.politicaProposta, { chave: p.chave, categoria: p.tipo, nome: p.nome,
      threads: p.threads, janelaDias: p.janelaDias, sugestao: p.sugestao });
  }
  return novas;
}

/** `ork licoes`: o que volta no proximo GOAL e PLAN, e as propostas de policy. */
export function textoDeLicoes(raiz: string, agoraIso: string = new Date().toISOString()): string {
  const resumo = resumoDasLicoes(raiz, null);
  const linhas = ['Licoes que voltam no GOAL e no PLAN da proxima thread', ''];
  linhas.push(textoDasLicoes(resumo) || 'Nenhuma thread fechada pelo MASTER ainda: nada a ensinar.');
  const propostas = propostasDePolicy(raiz, agoraIso);
  linhas.push('');
  linhas.push(`Propostas de policy (a mesma falha em ${PISO_DA_PROPOSTA}+ threads nos ultimos ${JANELA_DA_PROPOSTA_DIAS} dias):`);
  if (propostas.length === 0) linhas.push('  nenhuma');
  for (const p of propostas) linhas.push(`  ${p.chave} em ${p.threads.length} threads (${p.threads.slice(0, 5).join(', ')})`, `    ${p.sugestao}`);
  linhas.push('', 'Proposta nao bloqueia nada: vira policy so quando o dono a declara em `policies:` no orkastery.yaml.');
  return linhas.join('\n');
}
