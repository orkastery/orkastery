/**
 * RM-058, fatia N5 (D2, D3, D6, D7, D8 e D11 da ork-rm058n5): as provas da entrega no SHA exato.
 *
 * A página da RM-058 diz que uma fatia só chega à `main` com revisão independente, claims executadas, verify contra a
 * baseline, CI obrigatório verde no SHA fonte exato e prova de integração com a base vigente; que segredo e mutante relevante
 * sobrevivente impedem; e que um verde antigo não sobrevive a ajuste de conflito, código, teste ou documentação. Aqui cada uma
 * dessas exigências vira uma prova tipada sobre fatos que o núcleo lê do disco, do git e da forja:
 *
 * - `lerFatosDaEntrega` lê a thread, o ledger, as claims, a fonte (a ref da branch), a base no remoto (`ls-remote`), a cadeia
 *   de primeiro pai da fonte com cada commit classificado, o diff de três pontos da base até a fonte e o check do CI;
 * - `avaliarProvas` é pura sobre esses fatos: devolve as provas, o `ok` e o sha256 canônico delas (o `provas` do candidato
 *   da N3), com as reprovações anteriores do verify no mesmo SHA preservadas (`falhasRegistradas`).
 *
 * A neutralidade (D3) é por recomputação: um commit que só mexe em `.ork-ci/` é bundle; um merge cujo segundo pai está na base
 * é mecânico quando o `git merge-tree` diff3 dos pais, com a regra de `noctum-changelog.ts`, reproduz a árvore dele byte a
 * byte. O verify sobrevive só a commits de bundle; a revisão, a bundle e a merge mecânico limpo ou só com o CHANGELOG em
 * conflito; o CI, a nada. A revisão independente (D2) é a sessão de CHECK que o núcleo despachou, verificou e viu concluir,
 * com o veredito do parecer e o verify do intervalo, cujo id nativo não é de nenhum autor.
 *
 * Nada aqui grava, despacha nem empurra: quem age é `noctum-entrega.ts`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { comandosDoBundle, consultarCi, consultarCiDoRepositorio, ExecutorCi, ResultadoCi } from './ci';
import { lerClaims } from './claims';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { ARQUIVO_DO_CHANGELOG, conferirChangelog, ConferenciaDoChangelog, entradasDaThread, pedeLinha, posicionarEntradas,
  resolverConflitosAditivos } from './noctum-changelog';
import { canonico } from './noctum-envelope';
import { procurarSegredos } from './policies';
import { estadoDoArtefato, eventosDoIntervalo, fonteRegistrada, provaDoOrk } from './session-watcher-claude';
import { conferirBundle, manifestoDaBranch } from './ship-publicar';
import { dirThread, lerThread } from './thread';
import { EventoLedger, FASES, Thread } from './types';
import { comandosDoManifesto } from './verify';
import { branchDaWorktree } from './worktree';

export const CONTRATO_DAS_PROVAS = 'ork.noctum-provas/v1' as const;

/** D2, D3, D4, D6 a D11: as recusas da entrega, num tipo fechado próprio (fora de `MotivoGate` e das recusas do envelope). */
export const MOTIVOS_DA_ENTREGA = [
  'noctum.entrega.fonte-ausente', 'noctum.entrega.base-sem-leitura', 'noctum.entrega.base-mudou',
  'noctum.entrega.revisao-ausente', 'noctum.entrega.revisao-em-curso', 'noctum.entrega.revisao-sem-vinculo',
  'noctum.entrega.revisor-autor', 'noctum.entrega.revisao-antiga', 'noctum.entrega.revisao-reprovada',
  'noctum.entrega.revisao-sem-sha', 'noctum.entrega.revisao-esgotada',
  'noctum.entrega.verify-ausente', 'noctum.entrega.verify-reprovado', 'noctum.entrega.verify-falha-consistente',
  'noctum.entrega.verify-esgotado', 'noctum.entrega.verify-sem-comandos', 'noctum.entrega.baseline-ausente',
  'noctum.entrega.ci-vermelho', 'noctum.entrega.ci-pendente', 'noctum.entrega.ci-sem-leitura', 'noctum.entrega.ci-ausente',
  'noctum.entrega.segredo', 'noctum.entrega.mutante-sobrevivente', 'noctum.entrega.mutantes-ausentes',
  'noctum.entrega.mutante-nao-executado', 'noctum.entrega.changelog', 'noctum.entrega.bundle-velho',
  'noctum.entrega.conflito-nao-aditivo', 'noctum.entrega.worktree-suja', 'noctum.entrega.fora-do-destino',
  'noctum.entrega.exige-vez-da-n3', 'noctum.entrega.integracao-ocupada', 'noctum.entrega.fonte-mudou',
  'noctum.entrega.push-incerto', 'noctum.entrega.docs-vermelhos', 'noctum.entrega.nao-provada', 'noctum.entrega.ocupada',
  // GO-FIX da rodada 1 do CHECK: a leitura do git que falhou (lacuna, nunca "nada mudou"), a thread sem produto, o push
  // recusado com a base parada, a thread que não é trabalho do envelope e as esperas do despacho do CHECK, que antes
  // voltavam como texto solto (A8).
  'noctum.entrega.git-sem-leitura', 'noctum.entrega.sem-produto', 'noctum.entrega.push-recusado', 'noctum.entrega.fora-do-envelope',
  'noctum.entrega.agendado', 'noctum.entrega.sem-trava-do-kernel', 'noctum.entrega.despacho-em-curso', 'noctum.entrega.pedido-ausente',
  'noctum.entrega.despacho-recusado', 'noctum.entrega.despacho-incerto',
  // GO-FIX da rodada 2 do CHECK: a supervisão da N4 (o trabalho isolado, o arco parado, o log que não se leu), e o git que
  // falha sem conflito nem recusa do remoto (a trava do índice, a rede do push), que espera a cadência (R2-B1, R2-A2, R2-A3).
  'noctum.entrega.isolado', 'noctum.entrega.arco-parado', 'noctum.entrega.supervisao-sem-leitura', 'noctum.entrega.git-falhou',
] as const;
export type MotivoDaEntrega = typeof MOTIVOS_DA_ENTREGA[number];

export class RecusaDaEntrega extends Error {
  constructor(readonly motivo: MotivoDaEntrega, detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDaEntrega';
  }
}

/** D8: duas reprovações do verify no mesmo SHA são falha consistente; três rodadas no SHA sem verde esgotam o passo. */
export const REPROVACOES_QUE_BLOQUEIAM = 2;
export const RODADAS_POR_SHA = 3;
/** Os motivos do verify que são reprovação de fato; o prazo estourado e a rodada sem veredito não contam como falha. */
const MOTIVOS_DE_REPROVACAO: readonly string[] = ['claims.failed', 'verify.regression', 'verify.failed'];
/** D6: a claim de mutante. A alegação começa por "Mutante" (ou "Mutantes"), em qualquer caixa, e ela tem comando. */
export const ALEGACAO_DE_MUTANTE = /^\s*mutantes?\b/i;
/** O máximo de commits da cadeia de primeiro pai que a prova lê: a thread nunca chega perto disso. */
const MAXIMO_DA_CADEIA = 300;

/** `sem-leitura`: o git não respondeu sobre o commit; a prova que passa por ele é lacuna, e não "nada mudou". */
export type TipoDeCommit = 'produto' | 'bundle' | 'merge-mecanico' | 'merge-de-codigo' | 'merge-com-ajuste' | 'merge-de-fora' | 'sem-leitura';
/** D3: o que cada prova aceita entre o SHA dela e a fonte. */
const NEUTROS_DO_VERIFY: readonly TipoDeCommit[] = ['bundle'];
const NEUTROS_DA_REVISAO: readonly TipoDeCommit[] = ['bundle', 'merge-mecanico'];

export interface CommitDaCadeia { sha: string; tipo: TipoDeCommit; conflitos: string[]; detalhe: string }

export interface RevisaoLida {
  sessionId: string;
  runtime: string;
  despachadaEm: string;
  /** `null` quando o núcleo prova o vínculo (sessão, despacho, verificação e prompt); senão, o que faltou. */
  semVinculo: string | null;
  resultado: 'concluida' | 'bloqueada' | 'morta' | 'em-curso';
  /** A prova do CHECK do núcleo: o parecer gravado no intervalo com exatamente um veredito. */
  prova: { ok: boolean; fonte: string; veredito: string | null };
  /** O commit do último `verify_run` do intervalo do CHECK: o SHA que o revisor verificou. */
  revisado: string | null;
  /** O parecer em disco não é mais o que o observador viu no resultado do CHECK. */
  parecerMudou: boolean;
}

export interface VerifyLido {
  eventId: string;
  ts: string;
  commit: string;
  ok: boolean;
  motivos: string[];
  comBaseline: boolean;
  comComandos: boolean;
  claims: Array<{ id: string; verificado: boolean; motivo: string | null }>;
}

export interface FatosDaEntrega {
  thread: string;
  branch: string;
  fonte: string | null;
  base: { nome: string; sha: string | null; erro: string | null };
  /** A base é ancestral da fonte; `null` quando não se sabe. */
  integrada: boolean | null;
  cadeia: CommitDaCadeia[];
  /** A cadeia de primeiro pai saiu inteira, cada commit classificado; sem ela, revisão e verify são lacuna. */
  cadeiaLida: boolean;
  autores: string[];
  ultimoDespachoDeAutor: string | null;
  revisoes: RevisaoLida[];
  verifies: VerifyLido[];
  comandosEsperados: number;
  claims: Array<{ id: string; mutante: boolean }>;
  ciExigido: boolean;
  ci: ResultadoCi | null;
  arquivos: string[];
  /**
   * O diff de três pontos (os arquivos) e a história da base até a fonte (as linhas de cada commit e as mensagens) saíram
   * inteiros; sem eles, segredo, mutantes e CHANGELOG não se provam.
   */
  diffLido: boolean;
  segredos: AchadoDeSegredo[];
  /** Os commits da base até a fonte que a varredura de segredo leu (R2-B2 da rodada 2). */
  commitsVarridos: number;
  /** R3-B1 da rodada 3: os merges com mais de dois pais na história, que a varredura não lê por commit. */
  polvos: string[];
  /** `null` quando o CHANGELOG da fonte ou do ancestral comum não se leu (lacuna). */
  changelog: ConferenciaDoChangelog | null;
  /** `lido: false` quando o bundle da fonte existe e o git não o leu (lacuna, e não bundle velho). */
  bundle: { ok: boolean; texto: string; lido?: boolean };
}

export type IdDaProva = 'integracao' | 'segredo' | 'mutantes' | 'changelog' | 'bundle' | 'revisao' | 'verify' | 'ci';

export interface ProvaDaEntrega {
  id: IdDaProva;
  ok: boolean;
  motivo: MotivoDaEntrega | null;
  detalhe: string;
  evidencia: Record<string, unknown>;
}

export interface ProvasDaEntrega {
  contrato: typeof CONTRATO_DAS_PROVAS;
  thread: string;
  branch: string;
  fonte: string | null;
  base: { nome: string; sha: string | null };
  ok: boolean;
  provas: ProvaDaEntrega[];
  /** As reprovações do verify no SHA (ou num equivalente) antes do verde: ficam na prova e no `ship_done` (D8). */
  falhasRegistradas: Array<{ eventId: string; commit: string; motivos: string[]; ts: string }>;
  /** sha256 do conteúdo canônico das provas: o `provas` do candidato que a N3 recebe. */
  sha256: string;
}

const SHA = /^[0-9a-f]{40}$/;
const curto = (s: string | null | undefined): string => (s ? s.slice(0, 12) : '-');
const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const primeira = (s: string): string => s.trim().split('\n')[0].slice(0, 200);
/** A leitura do git que falhou: a prova que dependia dela é lacuna, e a entrega espera (nunca "nada mudou"). */
const LACUNA: MotivoDaEntrega = 'noctum.entrega.git-sem-leitura';

// ---------------------------------------------------------------------------
// A avaliação, pura sobre os fatos.
// ---------------------------------------------------------------------------

/** O SHA `x` vale para a fonte se a cadeia de primeiro pai chega nele passando só por commits dos tipos aceitos. */
export function equivalente(cadeia: readonly CommitDaCadeia[], x: string | null, aceitos: readonly TipoDeCommit[]):
  { ok: boolean; entre: CommitDaCadeia[] } {
  if (!x) return { ok: false, entre: [] };
  const i = cadeia.findIndex(c => c.sha === x);
  if (i < 0) return { ok: false, entre: [] };
  const entre = cadeia.slice(0, i);
  return { ok: entre.every(c => aceitos.includes(c.tipo)), entre };
}

const prova = (id: IdDaProva, motivo: MotivoDaEntrega | null, detalhe: string, evidencia: Record<string, unknown> = {}): ProvaDaEntrega =>
  ({ id, ok: motivo === null, motivo, detalhe, evidencia });

function provaDaIntegracao(f: FatosDaEntrega): ProvaDaEntrega {
  if (!f.fonte) return prova('integracao', 'noctum.entrega.fonte-ausente', `a branch ${f.branch} não existe nesta cópia`);
  if (!f.base.sha) {
    return prova('integracao', 'noctum.entrega.base-sem-leitura', `a base ${f.base.nome} não se leu no remoto: ${f.base.erro ?? 'sem resposta'}`);
  }
  if (f.integrada === null) return prova('integracao', 'noctum.entrega.base-sem-leitura', 'o git não respondeu se a base está na fonte');
  if (!f.integrada) {
    return prova('integracao', 'noctum.entrega.base-mudou',
      `a base ${f.base.nome} está em ${curto(f.base.sha)}, que a fonte ${curto(f.fonte)} não contém: o candidato precisa ser atualizado`,
      { base: f.base.sha, fonte: f.fonte });
  }
  return prova('integracao', null, `a fonte ${curto(f.fonte)} contém a base ${f.base.nome} em ${curto(f.base.sha)}`,
    { base: f.base.sha, fonte: f.fonte });
}

function provaDoSegredo(f: FatosDaEntrega): ProvaDaEntrega {
  if (!f.diffLido) return prova('segredo', LACUNA, 'a história da base até a fonte não saiu inteira: nada se prova sobre ela');
  // R3-B1 da rodada 3: o merge polvo não tem o remerge; sem segredo achado, a prova não o dá por lido.
  if (!f.segredos.length && f.polvos.length) {
    return prova('segredo', 'noctum.entrega.nao-provada', `merge com mais de dois pais na história da thread (${f.polvos.join(', ')}): ` +
      'a varredura não lê o que ele acrescenta, e o arco não o entrega', { polvos: f.polvos });
  }
  if (!f.segredos.length) {
    return prova('segredo', null, `nenhum padrão de segredo nas linhas que os ${f.commitsVarridos} commit(s) da thread acrescentam nem ` +
      `nas mensagens deles (${f.arquivos.length} arquivo(s) no diff final)`);
  }
  const lista = f.segredos.slice(0, 10).map(s => `${s.nome} em ${s.arquivo}:${s.linha}${s.commit ? ` (commit ${s.commit})` : ''}`);
  // Só o nome do padrão, o arquivo, a linha e o commit: a prova que imprime o segredo vaza de novo.
  return prova('segredo', 'noctum.entrega.segredo', `segredo na história que a thread empurraria: ${lista.join('; ')}`,
    { achados: f.segredos.slice(0, 50) });
}

function provaDoChangelog(f: FatosDaEntrega): ProvaDaEntrega {
  if (!f.diffLido) return prova('changelog', LACUNA, 'sem o diff, não se sabe se a fonte pede linha no CHANGELOG');
  if (!f.changelog) return prova('changelog', LACUNA, 'o CHANGELOG da fonte ou do ancestral comum não se leu');
  if (!f.changelog.ok) return prova('changelog', 'noctum.entrega.changelog', `${f.changelog.motivo}: ${f.changelog.detalhe}`);
  return prova('changelog', null, f.changelog.detalhe, { linhas: f.changelog.linhas.slice(0, 10) });
}

function provaDoBundle(f: FatosDaEntrega): ProvaDaEntrega {
  if (f.bundle.lido === false) return prova('bundle', LACUNA, f.bundle.texto);
  return f.bundle.ok ? prova('bundle', null, f.bundle.texto) : prova('bundle', 'noctum.entrega.bundle-velho', f.bundle.texto);
}

/** A lacuna da cadeia de primeiro pai: sem ela inteira, nada se diz sobre o que veio depois do SHA de uma prova. */
function lacunaDaCadeia(f: FatosDaEntrega): string | null {
  if (!f.cadeiaLida) return `a cadeia de primeiro pai da fonte ${curto(f.fonte)} até a base não se leu`;
  const c = f.cadeia.find(x => x.tipo === 'sem-leitura');
  return c ? `o commit ${curto(c.sha)} da cadeia não se classificou: ${c.detalhe}` : null;
}

/** Os `verify_run` que valem para a fonte (D3: no SHA, ou num ancestral seguido só de commits de bundle), na ordem do ledger. */
function verifiesDaFonte(f: FatosDaEntrega): VerifyLido[] {
  return f.verifies.filter(v => equivalente(f.cadeia, v.commit, NEUTROS_DO_VERIFY).ok);
}

const reprovado = (v: VerifyLido): boolean => !v.ok && v.motivos.some(m => MOTIVOS_DE_REPROVACAO.includes(m));

interface VerifyDaFonte { prova: ProvaDaEntrega; falhas: ProvasDaEntrega['falhasRegistradas']; ultimo: VerifyLido | null; rodadas: number }

function provaDoVerify(f: FatosDaEntrega): VerifyDaFonte {
  const lacuna = lacunaDaCadeia(f);
  if (lacuna) return { prova: prova('verify', LACUNA, lacuna), falhas: [], ultimo: null, rodadas: 0 };
  const daFonte = verifiesDaFonte(f);
  const ultimo = daFonte.at(-1) ?? null;
  const falhas = daFonte.filter(v => !v.ok).map(v => ({ eventId: v.eventId, commit: v.commit, motivos: v.motivos, ts: v.ts }));
  const evidencia = { rodadas: daFonte.length, ultimo: ultimo?.eventId ?? null, commit: ultimo?.commit ?? null, falhas: falhas.map(x => x.eventId) };
  const fim = (p: ProvaDaEntrega): VerifyDaFonte => ({ prova: p, falhas, ultimo, rodadas: daFonte.length });
  // A2 da rodada 1: o teto de rodadas por SHA vale para toda prova que pede outro verify, e não só para a reprovada.
  const repetir = (motivo: MotivoDaEntrega, detalhe: string, extra: Record<string, unknown> = {}): VerifyDaFonte => fim(daFonte.length >= RODADAS_POR_SHA
    ? prova('verify', 'noctum.entrega.verify-esgotado', `${daFonte.length} rodadas do verify no SHA, e a prova ainda pede outra: ${detalhe}`, { ...evidencia, ...extra })
    : prova('verify', motivo, detalhe, { ...evidencia, ...extra }));
  if (!ultimo) return fim(prova('verify', 'noctum.entrega.verify-ausente', `nenhum verify na fonte ${curto(f.fonte)}`, evidencia));
  if (!ultimo.comBaseline) {
    return fim(prova('verify', 'noctum.entrega.baseline-ausente',
      `o verify ${ultimo.eventId} rodou sem baseline: grave a baseline antes do GO (ork verify <thread> --baseline)`, evidencia));
  }
  if (ultimo.ok) {
    if (f.comandosEsperados > 0 && !ultimo.comComandos) {
      return repetir('noctum.entrega.verify-sem-comandos', `o verify ${ultimo.eventId} rodou só as claims; o manifesto pede ${f.comandosEsperados} comando(s)`);
    }
    // Claims executadas: a claim cadastrada depois do verify não rodou nele, e o verify se repete.
    const rodaram = new Set(ultimo.claims.map(c => c.id));
    const semExecucao = f.claims.map(c => c.id).filter(id => !rodaram.has(id));
    if (semExecucao.length) {
      return repetir('noctum.entrega.verify-ausente', `claim(s) ativa(s) que o verify ${ultimo.eventId} não executou: ${semExecucao.slice(0, 10).join(', ')}`,
        { semExecucao });
    }
    return fim(prova('verify', null, `verify verde em ${curto(ultimo.commit)} (${ultimo.eventId})` +
      (falhas.length ? `, com ${falhas.length} reprovação(ões) anterior(es) no mesmo SHA registrada(s)` : ''), evidencia));
  }
  const reprovacoes = daFonte.filter(reprovado).length;
  if (reprovacoes >= REPROVACOES_QUE_BLOQUEIAM) {
    return fim(prova('verify', 'noctum.entrega.verify-falha-consistente',
      `${reprovacoes} reprovações do verify no mesmo SHA: falha consistente, que não se repete sozinha`, evidencia));
  }
  return repetir('noctum.entrega.verify-reprovado',
    `o último verify (${ultimo.eventId}) reprovou: ${ultimo.motivos.join(', ') || 'sem motivo'}; repete isolado na fila pesada`);
}

function provaDosMutantes(f: FatosDaEntrega, ultimo: VerifyLido | null): ProvaDaEntrega {
  if (!f.diffLido) return prova('mutantes', LACUNA, 'sem o diff, não se sabe se a fonte muda código');
  const lacuna = lacunaDaCadeia(f);
  if (lacuna) return prova('mutantes', LACUNA, `sem a cadeia, não se sabe qual verify vale para a fonte: ${lacuna}`);
  const mutantes = f.claims.filter(c => c.mutante).map(c => c.id);
  const codigo = f.arquivos.filter(pedeLinha);
  if (!mutantes.length) {
    if (codigo.length) {
      return prova('mutantes', 'noctum.entrega.mutantes-ausentes',
        `a fonte muda ${codigo.length} arquivo(s) de código (${codigo.slice(0, 3).join(', ')}) e nenhuma claim de mutante prova as guardas`,
        { codigo: codigo.slice(0, 20) });
    }
    return prova('mutantes', null, 'sem código do produto no diff: o mutante não se aplica', { arquivos: f.arquivos.slice(0, 20) });
  }
  const noVerify = new Map((ultimo?.claims ?? []).map(c => [c.id, c]));
  // Sobrevivente é a claim reprovada; a que estourou o prazo ou ficou sem veredito não rodou até o fim, e roda de novo.
  const sobreviventes = mutantes.filter(id => noVerify.get(id)?.verificado === false && noVerify.get(id)?.motivo === 'claims.failed');
  if (sobreviventes.length) {
    // O verify só guarda a reprovação da claim: o mutante que sobreviveu (saída 1) e a especificação que não se aplica
    // (saída 2) caem juntos aqui, e os dois deixam a guarda sem prova.
    return prova('mutantes', 'noctum.entrega.mutante-sobrevivente',
      `mutante(s) que não morreram no verify ${ultimo?.eventId ?? '-'} (sobreviveram, ou a especificação não se aplica): ${sobreviventes.join(', ')}`,
      { sobreviventes });
  }
  const faltam = mutantes.filter(id => noVerify.get(id)?.verificado !== true);
  if (faltam.length) {
    return prova('mutantes', 'noctum.entrega.mutante-nao-executado',
      `mutante(s) que o verify da fonte não executou: ${faltam.join(', ')}`, { faltam });
  }
  return prova('mutantes', null, `${mutantes.length} mutante(s) mortos no verify ${ultimo?.eventId ?? '-'}`, { mutantes });
}

function provaDaRevisao(f: FatosDaEntrega): ProvaDaEntrega {
  const r = f.revisoes.at(-1);
  if (!r) return prova('revisao', 'noctum.entrega.revisao-ausente', 'nenhuma sessão de CHECK despachada pelo núcleo nesta thread');
  const ev = { sessionId: r.sessionId, runtime: r.runtime, despachadaEm: r.despachadaEm, revisado: r.revisado, veredito: r.prova.veredito };
  if (r.semVinculo) return prova('revisao', 'noctum.entrega.revisao-sem-vinculo', `a sessão ${r.sessionId.slice(0, 8)} não tem vínculo provado: ${r.semVinculo}`, ev);
  if (f.autores.includes(r.sessionId)) {
    return prova('revisao', 'noctum.entrega.revisor-autor', `a sessão ${r.sessionId.slice(0, 8)} também é autora do candidato: não é revisão independente`, ev);
  }
  if (f.ultimoDespachoDeAutor && !(Date.parse(r.despachadaEm) > Date.parse(f.ultimoDespachoDeAutor))) {
    return prova('revisao', 'noctum.entrega.revisao-antiga', 'o CHECK foi despachado antes do último despacho de quem escreveu o candidato', ev);
  }
  if (r.resultado === 'em-curso') return prova('revisao', 'noctum.entrega.revisao-em-curso', `a sessão de CHECK ${r.sessionId.slice(0, 8)} ainda não tem resultado`, ev);
  if (r.prova.veredito && r.prova.veredito !== 'PASSOU') {
    return prova('revisao', 'noctum.entrega.revisao-reprovada', `o CHECK independente concluiu ${r.prova.veredito}`, ev);
  }
  if (r.resultado !== 'concluida') {
    return prova('revisao', 'noctum.entrega.revisao-ausente', `a sessão de CHECK ${r.sessionId.slice(0, 8)} terminou sem concluir (${r.resultado})`, ev);
  }
  if (!r.prova.ok) return prova('revisao', 'noctum.entrega.revisao-sem-vinculo', `o CHECK concluiu sem a prova do núcleo: ${r.prova.fonte}`, ev);
  if (r.parecerMudou) return prova('revisao', 'noctum.entrega.revisao-antiga', 'o parecer do CHECK mudou depois do resultado que o observador gravou', ev);
  if (!r.revisado) return prova('revisao', 'noctum.entrega.revisao-sem-sha', 'o CHECK não rodou verify no intervalo: o SHA revisado é desconhecido', ev);
  const lacuna = lacunaDaCadeia(f);
  if (lacuna) return prova('revisao', LACUNA, lacuna, ev);
  const eq = equivalente(f.cadeia, r.revisado, NEUTROS_DA_REVISAO);
  if (!eq.ok) {
    const depois = eq.entre.filter(c => !NEUTROS_DA_REVISAO.includes(c.tipo)).map(c => `${curto(c.sha)} (${c.tipo})`);
    return prova('revisao', 'noctum.entrega.revisao-antiga', depois.length
      ? `depois do SHA revisado ${curto(r.revisado)} vieram commits que não são neutros: ${depois.slice(0, 5).join(', ')}`
      : `o SHA revisado ${curto(r.revisado)} não está na cadeia da fonte ${curto(f.fonte)}`, ev);
  }
  return prova('revisao', null, `CHECK independente ${r.sessionId.slice(0, 8)} (${r.runtime}) com PASSOU em ${curto(r.revisado)}`, ev);
}

function provaDoCi(f: FatosDaEntrega): ProvaDaEntrega {
  if (!f.ciExigido) return prova('ci', 'noctum.entrega.ci-ausente', 'o manifesto não exige CI (ci.required_for_ship): o arco não integra sem CI obrigatório');
  if (!f.ci) return prova('ci', 'noctum.entrega.ci-sem-leitura', 'o check do CI não foi lido');
  const ev = { sha: f.ci.sha, context: f.ci.context, state: f.ci.state, url: f.ci.url };
  if (f.ci.sha !== f.fonte) return prova('ci', 'noctum.entrega.ci-pendente', `o check lido é de outro SHA (${curto(f.ci.sha)})`, ev);
  switch (f.ci.state) {
    case 'success': return prova('ci', null, `${f.ci.context} verde em ${curto(f.ci.sha)}`, ev);
    case 'failure': return prova('ci', 'noctum.entrega.ci-vermelho', `${f.ci.context} vermelho em ${curto(f.ci.sha)}`, ev);
    case 'pending': case 'missing': return prova('ci', 'noctum.entrega.ci-pendente', `${f.ci.context} ainda sem verde em ${curto(f.ci.sha)} (${f.ci.state})`, ev);
    case 'disabled': return prova('ci', 'noctum.entrega.ci-ausente', 'o CI não é exigido neste projeto', ev);
    default: return prova('ci', 'noctum.entrega.ci-sem-leitura', `a consulta do CI falhou: ${f.ci.detail.slice(0, 200)}`, ev);
  }
}

/** As provas da entrega sobre os fatos, sem disco nem rede. */
export function avaliarProvas(f: FatosDaEntrega): ProvasDaEntrega {
  const verify = provaDoVerify(f);
  const mutantes = provaDosMutantes(f, verify.ultimo);
  // A2 da rodada 1: o mutante sem veredito também pede outro verify, e o teto de rodadas por SHA vale para ele.
  const doVerify = verify.prova.ok && mutantes.motivo === 'noctum.entrega.mutante-nao-executado' && verify.rodadas >= RODADAS_POR_SHA
    ? prova('verify', 'noctum.entrega.verify-esgotado', `${verify.rodadas} rodadas do verify no SHA sem o veredito dos mutantes: ${mutantes.detalhe}`,
      verify.prova.evidencia)
    : verify.prova;
  const provas = [provaDaIntegracao(f), provaDoSegredo(f), mutantes, provaDoChangelog(f), provaDoBundle(f), provaDaRevisao(f), doVerify, provaDoCi(f)];
  const base = { nome: f.base.nome, sha: f.base.sha };
  const sha256 = createHash('sha256').update(canonico({ contrato: CONTRATO_DAS_PROVAS, thread: f.thread, branch: f.branch, fonte: f.fonte,
    base: base.sha, provas: provas.map(p => ({ id: p.id, ok: p.ok, motivo: p.motivo, evidencia: p.evidencia })) })).digest('hex');
  return { contrato: CONTRATO_DAS_PROVAS, thread: f.thread, branch: f.branch, fonte: f.fonte, base, ok: provas.every(p => p.ok), provas,
    falhasRegistradas: verify.falhas, sha256 };
}

// ---------------------------------------------------------------------------
// A leitura dos fatos.
// ---------------------------------------------------------------------------

/**
 * Git local sem rede escondida nem pergunta de credencial, com buffer de 256 MiB (B1 da rodada 1 do CHECK): o diff de uma
 * fatia grande passa de 1 MiB, o teto do `spawnSync`, e a saída cortada esconderia o resto. `ok` só com saída 0 e sem erro.
 */
export function gitDaEntrega(raiz: string, args: string[], prazoMs = 120000): { ok: boolean; code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', timeout: prazoMs, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0 && !r.error, code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr || (r.error ? r.error.message : '') };
}
const git = gitDaEntrega;

/** O mesmo git, com a saída em bytes: o blob como está no repositório, sem decodificar. */
function gitEmBytes(raiz: string, args: string[], prazoMs = 120000): { ok: boolean; stdout: Buffer; stderr: string } {
  const r = spawnSync('git', args, { cwd: raiz, timeout: prazoMs, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0 && !r.error, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr?.toString('utf8') || (r.error ? r.error.message : '') };
}

/**
 * Um arquivo numa árvore ou commit, em bytes: `null` quando ele não existe nela (ou não é arquivo), e a lacuna quando o git
 * não respondeu. O `ls-tree` separa "não existe" de "não se leu", que o `cat-file` sozinho confunde.
 */
export function blobLido(raiz: string, arvore: string, arquivo: string): { ok: true; bytes: Buffer | null } | { ok: false; erro: string } {
  const ls = git(raiz, ['ls-tree', '-z', '--full-tree', arvore, '--', arquivo]);
  if (!ls.ok) return { ok: false, erro: `o git ls-tree de ${arquivo} em ${curto(arvore)} falhou: ${primeira(ls.stderr) || `código ${ls.code}`}` };
  const m = /^\d+ blob ([0-9a-f]{40,64})\t/.exec(ls.stdout);
  if (!m) return { ok: true, bytes: null };
  const c = gitEmBytes(raiz, ['cat-file', 'blob', m[1]]);
  return c.ok ? { ok: true, bytes: c.stdout } : { ok: false, erro: `o git cat-file de ${arquivo} em ${curto(arvore)} falhou: ${primeira(c.stderr)}` };
}

/** O texto de um arquivo numa árvore ou commit, ou `null` quando ele não existe nela; a leitura que falha é lacuna tipada. */
export function blobEm(raiz: string, arvore: string, arquivo: string): string | null {
  const b = blobLido(raiz, arvore, arquivo);
  if (!b.ok) throw new RecusaDaEntrega(LACUNA, b.erro);
  return b.bytes === null ? null : b.bytes.toString('utf8');
}

/**
 * O texto que a regra do núcleo pode reescrever: UTF-8 que volta aos mesmos bytes e sem byte nulo (B3 da rodada 1). Arquivo
 * binário ou noutra codificação devolve `null`, e o conflito nele não é só aditivo.
 */
export function textoDe(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  const t = bytes.toString('utf8');
  return Buffer.from(t, 'utf8').equals(bytes) ? t : null;
}

/** A ponta da base no remoto pelo `ls-remote`, só a linha da ref exata. */
export function pontaDaBaseNoRemoto(raiz: string, remoto: string, base: string): { sha: string | null; erro: string | null } {
  const r = git(raiz, ['ls-remote', '--', remoto, `refs/heads/${base}`], 60000);
  if (!r.ok) return { sha: null, erro: (r.stderr || r.stdout || `código ${r.code}`).trim().split('\n')[0].slice(0, 200) };
  const linha = r.stdout.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] === `refs/heads/${base}`);
  return linha && SHA.test(linha[0]) ? { sha: linha[0], erro: null } : { sha: null, erro: `a branch ${base} não existe no remoto ${remoto}` };
}

/** Garante os objetos da base nesta cópia (busca a branch do remoto quando falta o commit). */
export function garantirObjetos(raiz: string, remoto: string, base: string, sha: string): boolean {
  if (git(raiz, ['cat-file', '-e', `${sha}^{commit}`]).ok) return true;
  git(raiz, ['fetch', '--quiet', '--', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], 180000);
  return git(raiz, ['cat-file', '-e', `${sha}^{commit}`]).ok;
}

/**
 * D3: o que um commit da cadeia de primeiro pai é. Com um pai: bundle (só `.ork-ci/`) ou produto. Com dois: o segundo pai fora
 * da base é merge de fora; dentro, o `git merge-tree` diff3 dos pais com a regra do núcleo (união só aditiva e a entrada da
 * thread em "Não publicado") precisa reproduzir a árvore do merge byte a byte: mecânico quando só o CHANGELOG conflitou,
 * de código quando outro arquivo conflitou, e com ajuste quando a árvore não é a recomputada.
 */
export function classificarCommit(raiz: string, sha: string, base: string): CommitDaCadeia {
  // A leitura que falha é lacuna (`sem-leitura`), e não um tipo: nem "nada diferente", nem uma revisão nova pedida à toa.
  const semLeitura = (detalhe: string, conflitos: string[] = []): CommitDaCadeia => ({ sha, tipo: 'sem-leitura', conflitos, detalhe });
  const lidos = git(raiz, ['rev-list', '--parents', '-n', '1', sha]);
  if (!lidos.ok) return semLeitura('os pais do commit não se leram');
  const pais = lidos.stdout.trim().split(/\s+/).slice(1);
  if (pais.length <= 1) {
    const mudou = git(raiz, ['diff-tree', '--no-commit-id', '--name-only', '-z', '-r', '--root', sha]);
    if (!mudou.ok) return semLeitura('os arquivos do commit não se leram');
    const arquivos = mudou.stdout.split('\0').filter(Boolean);
    return arquivos.every(a => a.startsWith('.ork-ci/'))
      ? { sha, tipo: 'bundle', conflitos: [], detalhe: 'só o bundle de CI' }
      : { sha, tipo: 'produto', conflitos: [], detalhe: `${arquivos.length} arquivo(s)` };
  }
  if (pais.length > 2) return { sha, tipo: 'merge-com-ajuste', conflitos: [], detalhe: `merge com ${pais.length} pais` };
  const [p1, p2] = pais;
  const naBase = git(raiz, ['merge-base', '--is-ancestor', p2, base]);
  if (naBase.code === 1) return { sha, tipo: 'merge-de-fora', conflitos: [], detalhe: `o segundo pai ${curto(p2)} não está na base` };
  if (naBase.code !== 0) return semLeitura('não se leu se o segundo pai está na base');
  const mt = git(raiz, ['-c', 'merge.conflictStyle=diff3', 'merge-tree', '--write-tree', p1, p2], 120000);
  if (mt.code !== 0 && mt.code !== 1) return semLeitura('o git merge-tree --write-tree não respondeu (pede git 2.38 ou mais novo)');
  const [arvore, ...resto] = mt.stdout.split('\n');
  const estagios = new Map<string, Set<string>>();
  for (const l of resto) {
    if (!l.trim()) break;
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/.exec(l);
    if (!m || m[2].startsWith('"')) return { sha, tipo: 'merge-com-ajuste', conflitos: [], detalhe: 'conflito fora do formato do merge-tree' };
    estagios.set(m[2], (estagios.get(m[2]) ?? new Set()).add(m[1]));
  }
  const conflitos = [...estagios.keys()];
  // Só o conflito de conteúdo (ancestral, thread e base, os três estágios) tem a regra do núcleo; o resto é escolha de alguém.
  const semConteudo = conflitos.find(a => estagios.get(a)!.size !== 3);
  if (semConteudo) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${semConteudo}: conflito que não é de conteúdo` };
  const ancestral = git(raiz, ['merge-base', p1, p2]);
  if (!ancestral.ok) return semLeitura('o ancestral comum dos pais não se leu', conflitos);
  const changelogs = [ancestral.stdout.trim(), p1, p2].map(rev => blobLido(raiz, rev, ARQUIVO_DO_CHANGELOG));
  const falhou = changelogs.find(b => !b.ok);
  if (falhou && !falhou.ok) return semLeitura(falhou.erro, conflitos);
  const [noAncestral, naThread, naBaseDoMerge] = changelogs.map(b => (b.ok && b.bytes ? b.bytes.toString('utf8') : ''));
  const entradas = entradasDaThread(noAncestral, naThread);
  // S1 da rodada 1: a comparação que falha nunca vira "nada diferente".
  const diff = git(raiz, ['diff-tree', '-r', '-z', '--name-only', arvore.trim(), `${sha}^{tree}`]);
  if (!diff.ok) return semLeitura('a árvore do merge não se comparou com a recomputada', conflitos);
  const diferentes = diff.stdout.split('\0').filter(Boolean);
  for (const arquivo of new Set([...conflitos, ...diferentes])) {
    if (!conflitos.includes(arquivo) && arquivo !== ARQUIVO_DO_CHANGELOG) {
      return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} difere do merge recomputado sem ter conflitado` };
    }
    const comMarcas = blobLido(raiz, arvore.trim(), arquivo);
    if (!comMarcas.ok) return semLeitura(comMarcas.erro, conflitos);
    if (comMarcas.bytes === null) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} some no merge recomputado` };
    // B3 da rodada 1: binário ou fora de UTF-8 não tem a regra do núcleo; o texto decodificado esconderia a troca de bytes.
    const textoComMarcas = textoDe(comMarcas.bytes);
    if (textoComMarcas === null) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo}: não é texto UTF-8 (binário)` };
    const resolvido = resolverConflitosAditivos(textoComMarcas);
    if (!resolvido.ok) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo}: ${resolvido.recusa}` };
    // O conflito sem marcador é de arquivo que o git não mesclou como texto (deixou um dos lados inteiro).
    if (conflitos.includes(arquivo) && resolvido.conflitos === 0) {
      return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo}: conflito sem marcador de texto` };
    }
    const esperado = arquivo === ARQUIVO_DO_CHANGELOG ? posicionarEntradas(resolvido.texto, entradas, naBaseDoMerge).texto : resolvido.texto;
    const noMerge = blobLido(raiz, sha, arquivo);
    if (!noMerge.ok) return semLeitura(noMerge.erro, conflitos);
    // Byte a byte: a árvore do merge precisa ser a que a regra produz.
    if (noMerge.bytes === null || !noMerge.bytes.equals(Buffer.from(esperado, 'utf8'))) {
      return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} não é o que a regra do núcleo produz` };
    }
  }
  const deCodigo = conflitos.filter(a => a !== ARQUIVO_DO_CHANGELOG);
  return deCodigo.length
    ? { sha, tipo: 'merge-de-codigo', conflitos, detalhe: `conflito de código resolvido pela regra: ${deCodigo.slice(0, 3).join(', ')}` }
    : { sha, tipo: 'merge-mecanico', conflitos, detalhe: conflitos.length ? 'só o CHANGELOG conflitou' : 'merge limpo da base' };
}

/**
 * A9 da rodada 1: a classificação de um commit sobre uma base não muda (o commit, os pais, os blobs e o merge recomputado
 * são imutáveis), então cada passo não recomputa a cadeia inteira. A lacuna (`sem-leitura`) nunca fica guardada.
 */
const classificados = new Map<string, CommitDaCadeia>();
const LIMITE_DA_MEMORIA = 2000;

function classificarComMemoria(raiz: string, sha: string, base: string): CommitDaCadeia {
  const chave = `${raiz}\0${sha}\0${base}`;
  const guardado = classificados.get(chave);
  if (guardado) return { ...guardado, conflitos: [...guardado.conflitos] };
  const c = classificarCommit(raiz, sha, base);
  if (c.tipo !== 'sem-leitura') {
    if (classificados.size >= LIMITE_DA_MEMORIA) classificados.clear();
    classificados.set(chave, { ...c, conflitos: [...c.conflitos] });
  }
  return c;
}

/**
 * A cadeia de primeiro pai da fonte até a base (exclusive), cada commit classificado; a mais nova primeiro. `null` quando o
 * git não a listou: a lacuna não vira cadeia vazia.
 */
export function cadeiaDaFonte(raiz: string, fonte: string, base: string): CommitDaCadeia[] | null {
  const r = git(raiz, ['rev-list', '--first-parent', `--max-count=${MAXIMO_DA_CADEIA}`, fonte, '--not', base]);
  if (!r.ok) return null;
  return r.stdout.split('\n').map(l => l.trim()).filter(l => SHA.test(l)).map(sha => classificarComMemoria(raiz, sha, base));
}

/** Um padrão de segredo achado: o nome do padrão, o arquivo (ou a mensagem do commit), a linha e o commit; nunca o trecho. */
export interface AchadoDeSegredo { nome: string; arquivo: string; linha: number; commit?: string }

/** Uma linha acrescentada com padrão de segredo, antes de virar achado: o texto só serve para comparar, nunca sai daqui. */
interface LinhaComSegredo { nome: string; arquivo: string; linha: number; texto: string; commit: string; pais: string[] }

/**
 * As linhas acrescentadas de uma saída de `git diff` ou `git log -p` com `--unified=0`, com o arquivo, o número da linha
 * nova e os padrões de segredo de cada uma. No `git log`, a linha do formato (`\0<sha> <pais>`) abre cada commit; devolve
 * os merges com mais de dois pais, que o git não refaz pelo `--diff-merges=remerge`.
 */
function segredosDaSaida(saida: string, achar: (s: LinhaComSegredo) => void): string[] {
  const polvos: string[] = [];
  let commit = '', pais: string[] = [], arquivo = '', nova = 0, cabecalho = false;
  for (const l of saida.split('\n')) {
    // A linha do formato abre cada commit; dentro do diff, toda linha começa por espaço, "+", "-" ou "\".
    if (l.startsWith('\0')) {
      const [sha, ...resto] = l.slice(1).split(' ');
      commit = sha.slice(0, 12);
      pais = resto.filter(Boolean);
      if (pais.length > 2) polvos.push(commit);
      cabecalho = false; arquivo = '';
      continue;
    }
    if (l.startsWith('diff --git ')) { cabecalho = true; arquivo = ''; continue; }
    // O `+++` só é o nome do arquivo no cabeçalho; dentro do hunk, é uma linha acrescentada que começa por "++".
    if (cabecalho && l.startsWith('+++ ')) { arquivo = l.slice(4).replace(/^b\//, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { nova = Number(h[1]); cabecalho = false; continue; }
    if (!cabecalho && l.startsWith('+') && arquivo) {
      for (const a of procurarSegredos(l.slice(1))) achar({ nome: a.nome, arquivo, linha: nova, texto: l.slice(1), commit, pais });
      nova += 1;
    }
  }
  return polvos;
}

/**
 * R2-B2 da rodada 2: os padrões de segredo na história que a thread empurraria. O push da branch e o merge levam todos os
 * commits de `base..fonte`, e a chave posta num commit e tirada no seguinte some do diff final, mas não do remoto. Por isso
 * a varredura lê as linhas que cada commit acrescenta (no merge, só as que a resolução trouxe: `--diff-merges=remerge`) e
 * as mensagens dos commits. O arquivo que o git acha binário entra como texto (`--text`, A6 da rodada 1): um byte nulo não
 * esconde a chave. `lido` é falso quando a história não saiu inteira, e então a prova não diz "nenhum segredo".
 *
 * R3-B1 da rodada 3: o diff de três pontos entra também, em união com a história, porque o git não refaz o merge polvo
 * (mais de dois pais), e o que a árvore final da thread acrescenta está sempre nele; o merge polvo volta em `polvos`, e a
 * prova não o dá por lido. R3-A2: no merge, a linha que já está no arquivo de um dos pais não é da thread (o remerge mostra
 * assim a linha da base que a regra do núcleo pôs antes da thread).
 */
export function segredosDaHistoria(raiz: string, base: string, fonte: string):
  { lido: boolean; commits: number; polvos: string[]; achados: AchadoDeSegredo[] } {
  const r = git(raiz, ['-c', 'core.quotePath=false', 'log', '--format=%x00%H %P', '-p', '--text', '--no-color', '--no-ext-diff', '--unified=0',
    '--no-renames', '--diff-merges=remerge', `${base}..${fonte}`], 300000);
  const final = git(raiz, ['-c', 'core.quotePath=false', 'diff', '--text', '--no-color', '--no-ext-diff', '--unified=0', '--no-renames',
    `${base}...${fonte}`], 300000);
  const mensagens = git(raiz, ['log', '--format=%x00%H%n%B', `${base}..${fonte}`]);
  const achados: AchadoDeSegredo[] = [];
  if (!r.ok || !final.ok || !mensagens.ok) return { lido: false, commits: 0, polvos: [], achados };
  const doPai = new Map<string, string[] | null>();
  const linhasDoPai = (pai: string, arquivo: string): string[] | null => {
    const chave = `${pai}:${arquivo}`;
    if (!doPai.has(chave)) doPai.set(chave, blobEm(raiz, pai, arquivo)?.split('\n') ?? null);
    return doPai.get(chave)!;
  };
  const vistos = new Set<string>();
  const guardar = (s: LinhaComSegredo): void => {
    if (s.pais.length === 2 && s.pais.some(pai => linhasDoPai(pai, s.arquivo)?.includes(s.texto))) return;
    const chave = `${s.nome}\0${s.arquivo}\0${s.texto}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    achados.push({ nome: s.nome, arquivo: s.arquivo, linha: s.linha, ...(s.commit ? { commit: s.commit } : {}) });
  };
  const polvos = segredosDaSaida(r.stdout, guardar);
  segredosDaSaida(final.stdout, guardar);
  const blocos = mensagens.stdout.split('\0').filter(Boolean);
  for (const bloco of blocos) {
    const [sha, ...linhas] = bloco.split('\n');
    linhas.forEach((linha, i) => {
      for (const a of procurarSegredos(linha)) achados.push({ nome: a.nome, arquivo: 'mensagem do commit', linha: i + 1, commit: sha.slice(0, 12) });
    });
  }
  return { lido: true, commits: blocos.length, polvos, achados };
}

/** Os autores do candidato: as sessões de GO, as que começaram antes do GO num bloco com GO, e as que commitaram. */
function autoresDaThread(t: Thread, eventos: readonly EventoLedger[]): { autores: string[]; ultimoDespacho: string | null } {
  const autores = new Set<string>();
  let ultimo: string | null = null;
  const marcar = (id: string, em?: string) => {
    autores.add(id);
    if (em && (!ultimo || Date.parse(em) > Date.parse(ultimo))) ultimo = em;
  };
  for (const s of t.sessoes ?? []) {
    const fases = (s.bloco ?? '').split('-');
    const antesDoGo = fases.includes('GO') && FASES.indexOf(s.fase) <= FASES.indexOf('GO');
    if (s.fase === 'GO' || antesDoGo) marcar(s.sessionId, s.despachadaEm);
  }
  for (const e of eventos) {
    if ((e.tipo === 'mcp_git_committed' || e.tipo === 'commit') && typeof e.sessionId === 'string' && e.sessionId) {
      const s = (t.sessoes ?? []).find(x => x.sessionId === e.sessionId);
      marcar(e.sessionId, s?.despachadaEm);
    }
  }
  return { autores: [...autores], ultimoDespacho: ultimo };
}

/** O vínculo da sessão de CHECK provado pelo núcleo, como o Maestro confere (`maestro-authority.ts`), ou o que faltou. */
function vinculoDaSessao(raiz: string, t: Thread, s: Thread['sessoes'][number], eventos: readonly EventoLedger[]): string | null {
  if (s.origem === 'adocao' || !s.despachadaEm || !s.promptPath || !s.promptSha256) return 'sessão adotada ou sem despacho registrado';
  if (!s.verificada) return 'o runtime não confirmou a sessão depois do despacho';
  const despacho = eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.sessionId === s.sessionId).at(-1);
  if (!despacho || typeof despacho.eventId !== 'string' || despacho.fase !== 'CHECK' || despacho.runtime !== s.runtime ||
      despacho.promptSha256 !== s.promptSha256) return 'sem o phase_dispatch do CHECK desta sessão';
  const verificada = eventos.find(e => e.tipo === TIPOS_DE_EVENTO.despachoVerificado && e.sessionId === s.sessionId && e.encontrada === true &&
    typeof e.eventId === 'string');
  if (!verificada) return 'sem o phase_dispatch_verified desta sessão';
  try {
    const escopo = fs.realpathSync(dirThread(raiz, t.id)) + path.sep;
    const prompt = fs.realpathSync(path.resolve(raiz, s.promptPath));
    if (!prompt.startsWith(escopo)) return 'o prompt do despacho fica fora da pasta da thread';
    if (createHash('sha256').update(fs.readFileSync(prompt)).digest('hex') !== s.promptSha256) return 'o prompt mudou depois do despacho';
  } catch { return 'o prompt do despacho não se lê'; }
  return null;
}

/** As sessões de CHECK da thread, da mais velha para a mais nova, com o que o núcleo prova de cada uma. */
function revisoesDaThread(raiz: string, t: Thread, eventos: readonly EventoLedger[]): RevisaoLida[] {
  const posicao = new Map(eventos.map((e, i) => [e, i] as const));
  const checks = (t.sessoes ?? []).filter(s => s.fase === 'CHECK' && s.origem !== 'adocao' && !!s.despachadaEm)
    .sort((a, b) => Date.parse(a.despachadaEm!) - Date.parse(b.despachadaEm!));
  return checks.map(s => {
    const sessao = { sessionId: s.sessionId, fase: 'CHECK' as const, despachadaEm: s.despachadaEm! };
    const resultado = eventos.filter(e => e.tipo === 'phase_result' && e.sessionId === s.sessionId && e.fase === 'CHECK' &&
      e.despachoEm === s.despachadaEm && e.origem === 'sessions.watch' && typeof e.sensorResultId === 'string' && e.sensorResultId).at(-1);
    const morta = eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === s.sessionId);
    const estado: RevisaoLida['resultado'] = resultado
      ? (resultado.classificacao === 'fase_concluida' && resultado.ok === true ? 'concluida' : 'bloqueada') : morta ? 'morta' : 'em-curso';
    const intervalo = eventosDoIntervalo(eventos, sessao);
    // O SHA revisado e o veredito são os do fim do turno do revisor: a prova que o observador gravou no resultado (o claude-bg
    // grava `provaOrk` e o sha do parecer) ou, sem ela, o parecer de agora e o último verify até o resultado. Um verify que
    // outro roda depois (o do próprio arco, por exemplo) nunca vira o SHA da revisão.
    const gravada = resultado?.provaOrk as { ok?: unknown; fonte?: unknown; veredito?: unknown; verify?: { commit?: unknown } | null } | undefined;
    let prova: RevisaoLida['prova'];
    let revisado: string | null;
    if (gravada && typeof gravada.ok === 'boolean') {
      prova = { ok: gravada.ok, fonte: texto(gravada.fonte) ?? 'a prova do núcleo gravada no resultado do CHECK', veredito: texto(gravada.veredito) };
      revisado = texto(gravada.verify?.commit);
    } else {
      const p = provaDoOrk(raiz, t.id, sessao, eventos, fonteRegistrada(eventos, sessao));
      prova = { ok: p.ok, fonte: p.fonte, veredito: p.veredito ?? null };
      // Pela posição no ledger, e não pela hora: dois eventos no mesmo milissegundo não trocam de lado.
      const ate = resultado ? posicao.get(resultado) ?? eventos.length : eventos.length;
      revisado = texto(intervalo.filter(e => e.tipo === TIPOS_DE_EVENTO.verificacao && (posicao.get(e) ?? eventos.length) < ate).at(-1)?.commit);
    }
    // O parecer do resultado: o sha que o observador viu; sem ele (o observador do codex não grava), a data do arquivo, que
    // não pode ser depois do resultado (A5 da rodada 1). O `ts` do ledger é de milissegundo; a data do arquivo, mais fina.
    const viu = texto((resultado?.artefato as { sha256Atual?: unknown } | undefined)?.sha256Atual);
    const parecer = estadoDoArtefato(raiz, t.id, 'docs/check.md');
    const parecerMudou = viu ? parecer.sha256 !== viu
      : !!resultado && parecer.mtimeMs !== null && Math.floor(parecer.mtimeMs) > Date.parse(resultado.ts);
    return { sessionId: s.sessionId, runtime: s.runtime, despachadaEm: s.despachadaEm!, semVinculo: vinculoDaSessao(raiz, t, s, eventos),
      resultado: estado, prova, revisado: revisado && SHA.test(revisado) ? revisado : null, parecerMudou };
  });
}

function verifiesDoLedger(eventos: readonly EventoLedger[]): VerifyLido[] {
  return eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.verificacao && typeof e.commit === 'string' && SHA.test(e.commit)).map(e => ({
    eventId: texto(e.eventId) ?? '-', ts: e.ts, commit: e.commit as string, ok: e.veredito === 'verdade sustentada',
    motivos: Array.isArray(e.motivos) ? e.motivos.map(String) : [],
    comBaseline: !!e.baseline && typeof e.baseline === 'object',
    comComandos: Array.isArray(e.comandos) && e.comandos.length > 0,
    claims: Array.isArray(e.claims) ? (e.claims as Array<Record<string, unknown>>).filter(c => typeof c?.id === 'string')
      .map(c => ({ id: c.id as string, verificado: c.verificado === true, motivo: texto(c.motivo) })) : [],
  }));
}

export interface OpcoesDasProvas {
  /** O remoto do projeto; padrão `origin`. */
  remoto?: string;
  /** A base de destino (a do envelope); padrão a `worktree.base_branch` do manifesto. */
  base?: string;
  /** O GitHub do remoto; os testes o fixam, porque o remoto deles é um bare local. */
  forja?: { host: string; repositorio: string };
  executorCi?: ExecutorCi;
  /** A ponta da base já lida (a integração relê sob a trava); sem ela, o `ls-remote` agora. */
  pontaDaBase?: { sha: string | null; erro: string | null };
}

/** Os fatos da entrega de uma thread, lidos agora do disco, do git e da forja. Não grava nada. */
export function lerFatosDaEntrega(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDasProvas = {}): FatosDaEntrega {
  const { raiz, manifesto } = carregado;
  const t = lerThread(raiz, threadId);
  const eventos = lerLedger(dirThread(raiz, threadId));
  const branch = branchDaWorktree(t);
  const remoto = opcoes.remoto ?? 'origin';
  const nomeDaBase = opcoes.base ?? manifesto.worktree.base_branch;
  const ref = git(raiz, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  const fonte = ref.ok && SHA.test(ref.stdout.trim()) ? ref.stdout.trim() : null;
  const lida = opcoes.pontaDaBase ?? pontaDaBaseNoRemoto(raiz, remoto, nomeDaBase);
  const base = { nome: nomeDaBase, sha: lida.sha, erro: lida.erro };
  if (base.sha && !garantirObjetos(raiz, remoto, nomeDaBase, base.sha)) {
    base.erro = `o commit ${curto(base.sha)} da base não chegou a esta cópia`;
    base.sha = null;
  }
  const { autores, ultimoDespacho } = autoresDaThread(t, eventos);
  const claimsAtivas = (() => { try { return lerClaims(raiz, threadId).filter(c => c.estado !== 'retirada'); } catch { return []; } })();
  const daBranch = manifestoDaBranch(carregado, fonte);
  const fatos: FatosDaEntrega = {
    thread: t.id, branch, fonte, base, integrada: null, cadeia: [], cadeiaLida: false, autores, ultimoDespachoDeAutor: ultimoDespacho,
    revisoes: revisoesDaThread(raiz, t, eventos), verifies: verifiesDoLedger(eventos),
    comandosEsperados: comandosDoManifesto(daBranch.manifesto).length,
    // A2 da rodada 1: a claim de mutante sem comando não executa nada e nunca prova a guarda; ela não conta como mutante.
    claims: claimsAtivas.map(c => ({ id: c.id, mutante: ALEGACAO_DE_MUTANTE.test(c.alegacao) && c.verificar.length > 0 })),
    ciExigido: manifesto.ci.required_for_ship === true, ci: null, arquivos: [], diffLido: false, segredos: [], commitsVarridos: 0, polvos: [], changelog: null,
    bundle: { ok: false, texto: 'a fonte não se lê' },
  };
  if (!fonte) return fatos;
  // O bundle que existe e não se leu é lacuna; o `conferirBundle` sozinho o daria por ausente, e a entrega o regravaria.
  const arquivoDoBundle = `.ork-ci/${t.id}.json`;
  const doBundle = blobLido(raiz, fonte, arquivoDoBundle);
  if (!doBundle.ok) fatos.bundle = { ok: false, lido: false, texto: `o bundle ${arquivoDoBundle} da fonte não se leu: ${doBundle.erro}` };
  else {
    const b = conferirBundle(raiz, t, branch, fonte, comandosDoBundle(daBranch));
    fatos.bundle = { ok: b.estado === 'feita', texto: b.texto };
  }
  if (fatos.ciExigido) {
    const contexto = manifesto.ci.context || 'ork-verify';
    fatos.ci = opcoes.forja ? consultarCiDoRepositorio(opcoes.forja.repositorio, fonte, contexto, opcoes.executorCi)
      : consultarCi(carregado, fonte, remoto, opcoes.executorCi);
  }
  if (!base.sha) return fatos;
  const integrada = git(raiz, ['merge-base', '--is-ancestor', base.sha, fonte]);
  fatos.integrada = integrada.code === 0 ? true : integrada.code === 1 ? false : null;
  const cadeia = cadeiaDaFonte(raiz, fonte, base.sha);
  fatos.cadeia = cadeia ?? [];
  fatos.cadeiaLida = cadeia !== null;
  const mudados = git(raiz, ['diff', '--name-only', '-z', '--no-renames', `${base.sha}...${fonte}`]);
  fatos.arquivos = mudados.ok ? mudados.stdout.split('\0').filter(Boolean) : [];
  const varridos = segredosDaHistoria(raiz, base.sha, fonte);
  fatos.segredos = varridos.achados;
  fatos.commitsVarridos = varridos.commits;
  fatos.polvos = varridos.polvos;
  fatos.diffLido = mudados.ok && varridos.lido;
  // O CHANGELOG do ancestral comum e o da fonte; a leitura que falha deixa `changelog` nulo, e a prova dele é lacuna.
  const ancestral = git(raiz, ['merge-base', base.sha, fonte]);
  if (!ancestral.ok || !SHA.test(ancestral.stdout.trim())) return fatos;
  const antes = blobLido(raiz, ancestral.stdout.trim(), ARQUIVO_DO_CHANGELOG);
  const depois = blobLido(raiz, fonte, ARQUIVO_DO_CHANGELOG);
  if (!antes.ok || !depois.ok) return fatos;
  const textoAntes = antes.bytes?.toString('utf8') ?? '';
  fatos.changelog = depois.bytes === null && !fatos.arquivos.some(pedeLinha)
    ? { ok: true, detalhe: 'sem CHANGELOG e sem código do produto', linhas: [] }
    : conferirChangelog(textoAntes, depois.bytes?.toString('utf8') ?? '', fatos.arquivos);
  return fatos;
}

/** As provas da entrega de uma thread agora. */
export function provasDaEntrega(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDasProvas = {}): ProvasDaEntrega {
  return avaliarProvas(lerFatosDaEntrega(carregado, threadId, opcoes));
}
