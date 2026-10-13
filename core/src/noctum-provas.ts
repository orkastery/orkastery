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
import { comandosDoBundle, consultarCi, consultarCiDoRepositorio, ExecutorCi, ResultadoCi } from './ci';
import { lerClaims } from './claims';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { ARQUIVO_DO_CHANGELOG, conferirChangelog, ConferenciaDoChangelog, entradasDaThread, pedeLinha, posicionarEntradas,
  resolverConflitosAditivos } from './noctum-changelog';
import { canonico } from './noctum-envelope';
import { procurarSegredos } from './policies';
import { eventosDoIntervalo, fonteRegistrada, provaDoOrk } from './session-watcher-claude';
import { conferirBundle, manifestoDaBranch } from './ship-publicar';
import { dirThread, lerThread } from './thread';
import { EventoLedger, FASES, Thread } from './types';
import { exec } from './util';
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
  'noctum.entrega.push-incerto', 'noctum.entrega.docs-vermelhos', 'noctum.entrega.nao-provada',
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
/** D6: a claim de mutante. A alegação começa por "Mutante", em qualquer caixa. */
export const ALEGACAO_DE_MUTANTE = /^\s*mutante\b/i;
/** O máximo de commits da cadeia de primeiro pai que a prova lê: a thread nunca chega perto disso. */
const MAXIMO_DA_CADEIA = 300;

export type TipoDeCommit = 'produto' | 'bundle' | 'merge-mecanico' | 'merge-de-codigo' | 'merge-com-ajuste' | 'merge-de-fora';
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
  /** Commits de produto que a própria sessão de revisão registrou no intervalo dela. */
  commitsDoRevisor: number;
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
  autores: string[];
  ultimoDespachoDeAutor: string | null;
  revisoes: RevisaoLida[];
  verifies: VerifyLido[];
  comandosEsperados: number;
  claims: Array<{ id: string; mutante: boolean }>;
  ciExigido: boolean;
  ci: ResultadoCi | null;
  arquivos: string[];
  segredos: Array<{ nome: string; arquivo: string; linha: number }>;
  changelog: ConferenciaDoChangelog | null;
  bundle: { ok: boolean; texto: string };
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
  if (!f.segredos.length) return prova('segredo', null, `nenhum padrão de segredo nas linhas acrescentadas (${f.arquivos.length} arquivo(s))`);
  const lista = f.segredos.slice(0, 10).map(s => `${s.nome} em ${s.arquivo}:${s.linha}`);
  // Só o nome do padrão, o arquivo e a linha: a prova que imprime o segredo vaza de novo.
  return prova('segredo', 'noctum.entrega.segredo', `segredo nas linhas que a thread acrescenta: ${lista.join('; ')}`,
    { achados: f.segredos.slice(0, 50) });
}

function provaDoChangelog(f: FatosDaEntrega): ProvaDaEntrega {
  if (!f.changelog) return prova('changelog', 'noctum.entrega.changelog', 'o CHANGELOG da fonte e do ancestral comum não se leram');
  if (!f.changelog.ok) return prova('changelog', 'noctum.entrega.changelog', `${f.changelog.motivo}: ${f.changelog.detalhe}`);
  return prova('changelog', null, f.changelog.detalhe, { linhas: f.changelog.linhas.slice(0, 10) });
}

function provaDoBundle(f: FatosDaEntrega): ProvaDaEntrega {
  return f.bundle.ok ? prova('bundle', null, f.bundle.texto) : prova('bundle', 'noctum.entrega.bundle-velho', f.bundle.texto);
}

/** Os `verify_run` que valem para a fonte (D3: no SHA, ou num ancestral seguido só de commits de bundle), na ordem do ledger. */
function verifiesDaFonte(f: FatosDaEntrega): VerifyLido[] {
  return f.verifies.filter(v => equivalente(f.cadeia, v.commit, NEUTROS_DO_VERIFY).ok);
}

const reprovado = (v: VerifyLido): boolean => !v.ok && v.motivos.some(m => MOTIVOS_DE_REPROVACAO.includes(m));

function provaDoVerify(f: FatosDaEntrega): { prova: ProvaDaEntrega; falhas: ProvasDaEntrega['falhasRegistradas']; ultimo: VerifyLido | null } {
  const daFonte = verifiesDaFonte(f);
  const ultimo = daFonte.at(-1) ?? null;
  const falhas = daFonte.filter(v => !v.ok).map(v => ({ eventId: v.eventId, commit: v.commit, motivos: v.motivos, ts: v.ts }));
  const evidencia = { rodadas: daFonte.length, ultimo: ultimo?.eventId ?? null, commit: ultimo?.commit ?? null, falhas: falhas.map(x => x.eventId) };
  if (!ultimo) return { prova: prova('verify', 'noctum.entrega.verify-ausente', `nenhum verify na fonte ${curto(f.fonte)}`, evidencia), falhas, ultimo };
  if (!ultimo.comBaseline) {
    return { prova: prova('verify', 'noctum.entrega.baseline-ausente',
      `o verify ${ultimo.eventId} rodou sem baseline: grave a baseline antes do GO (ork verify <thread> --baseline)`, evidencia), falhas, ultimo };
  }
  if (ultimo.ok) {
    if (f.comandosEsperados > 0 && !ultimo.comComandos) {
      return { prova: prova('verify', 'noctum.entrega.verify-sem-comandos',
        `o verify ${ultimo.eventId} rodou só as claims; o manifesto pede ${f.comandosEsperados} comando(s)`, evidencia), falhas, ultimo };
    }
    // Claims executadas: a claim cadastrada depois do verify não rodou nele, e o verify se repete.
    const rodaram = new Set(ultimo.claims.map(c => c.id));
    const semExecucao = f.claims.map(c => c.id).filter(id => !rodaram.has(id));
    if (semExecucao.length) {
      return { prova: prova('verify', 'noctum.entrega.verify-ausente',
        `claim(s) ativa(s) que o verify ${ultimo.eventId} não executou: ${semExecucao.slice(0, 10).join(', ')}`, { ...evidencia, semExecucao }),
        falhas, ultimo };
    }
    return { prova: prova('verify', null, `verify verde em ${curto(ultimo.commit)} (${ultimo.eventId})` +
      (falhas.length ? `, com ${falhas.length} reprovação(ões) anterior(es) no mesmo SHA registrada(s)` : ''), evidencia), falhas, ultimo };
  }
  const reprovacoes = daFonte.filter(reprovado).length;
  if (reprovacoes >= REPROVACOES_QUE_BLOQUEIAM) {
    return { prova: prova('verify', 'noctum.entrega.verify-falha-consistente',
      `${reprovacoes} reprovações do verify no mesmo SHA: falha consistente, que não se repete sozinha`, evidencia), falhas, ultimo };
  }
  if (daFonte.length >= RODADAS_POR_SHA) {
    return { prova: prova('verify', 'noctum.entrega.verify-esgotado', `${daFonte.length} rodadas do verify no SHA sem verde`, evidencia), falhas, ultimo };
  }
  return { prova: prova('verify', 'noctum.entrega.verify-reprovado',
    `o último verify (${ultimo.eventId}) reprovou: ${ultimo.motivos.join(', ') || 'sem motivo'}; repete isolado na fila pesada`, evidencia), falhas, ultimo };
}

function provaDosMutantes(f: FatosDaEntrega, ultimo: VerifyLido | null): ProvaDaEntrega {
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
    return prova('mutantes', 'noctum.entrega.mutante-sobrevivente',
      `mutante(s) que sobreviveram no verify ${ultimo?.eventId ?? '-'}: ${sobreviventes.join(', ')}`, { sobreviventes });
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
  if (r.commitsDoRevisor > 0) {
    return prova('revisao', 'noctum.entrega.revisor-autor', `a sessão de CHECK ${r.sessionId.slice(0, 8)} commitou produto no próprio intervalo`, ev);
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
  if (!r.revisado) return prova('revisao', 'noctum.entrega.revisao-sem-sha', 'o CHECK não rodou verify no intervalo: o SHA revisado é desconhecido', ev);
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
  const provas = [provaDaIntegracao(f), provaDoSegredo(f), provaDosMutantes(f, verify.ultimo), provaDoChangelog(f), provaDoBundle(f),
    provaDaRevisao(f), verify.prova, provaDoCi(f)];
  const base = { nome: f.base.nome, sha: f.base.sha };
  const sha256 = createHash('sha256').update(canonico({ contrato: CONTRATO_DAS_PROVAS, thread: f.thread, branch: f.branch, fonte: f.fonte,
    base: base.sha, provas: provas.map(p => ({ id: p.id, ok: p.ok, motivo: p.motivo, evidencia: p.evidencia })) })).digest('hex');
  return { contrato: CONTRATO_DAS_PROVAS, thread: f.thread, branch: f.branch, fonte: f.fonte, base, ok: provas.every(p => p.ok), provas,
    falhasRegistradas: verify.falhas, sha256 };
}

// ---------------------------------------------------------------------------
// A leitura dos fatos.
// ---------------------------------------------------------------------------

/** Git local sem rede escondida nem pergunta de credencial. */
function git(raiz: string, args: string[], prazoMs = 60000) {
  return exec('git', args, raiz, prazoMs, { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
}

/** O conteúdo de um arquivo numa árvore ou commit, ou `null` quando ele não existe nela. */
export function blobEm(raiz: string, arvore: string, arquivo: string): string | null {
  const r = git(raiz, ['cat-file', 'blob', `${arvore}:${arquivo}`]);
  return r.ok ? r.stdout : null;
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
  const pais = git(raiz, ['rev-list', '--parents', '-n', '1', sha]).stdout.trim().split(/\s+/).slice(1);
  if (pais.length <= 1) {
    const mudou = git(raiz, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha]);
    const arquivos = mudou.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    return mudou.ok && arquivos.every(a => a.startsWith('.ork-ci/'))
      ? { sha, tipo: 'bundle', conflitos: [], detalhe: 'só o bundle de CI' }
      : { sha, tipo: 'produto', conflitos: [], detalhe: `${arquivos.length} arquivo(s)` };
  }
  if (pais.length > 2) return { sha, tipo: 'merge-com-ajuste', conflitos: [], detalhe: `merge com ${pais.length} pais` };
  const [p1, p2] = pais;
  if (!git(raiz, ['merge-base', '--is-ancestor', p2, base]).ok) {
    return { sha, tipo: 'merge-de-fora', conflitos: [], detalhe: `o segundo pai ${curto(p2)} não está na base` };
  }
  const mt = git(raiz, ['-c', 'merge.conflictStyle=diff3', 'merge-tree', '--write-tree', p1, p2], 120000);
  if (mt.code !== 0 && mt.code !== 1) return { sha, tipo: 'merge-com-ajuste', conflitos: [], detalhe: 'o merge-tree não respondeu' };
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
  const ancestral = git(raiz, ['merge-base', p1, p2]).stdout.trim();
  const entradas = entradasDaThread(ancestral ? blobEm(raiz, ancestral, ARQUIVO_DO_CHANGELOG) ?? '' : '', blobEm(raiz, p1, ARQUIVO_DO_CHANGELOG) ?? '');
  const daBase = blobEm(raiz, p2, ARQUIVO_DO_CHANGELOG) ?? '';
  const diferentes = git(raiz, ['diff-tree', '-r', '--name-only', arvore.trim(), `${sha}^{tree}`]).stdout.split('\n').map(l => l.trim()).filter(Boolean);
  for (const arquivo of new Set([...conflitos, ...diferentes])) {
    if (!conflitos.includes(arquivo) && arquivo !== ARQUIVO_DO_CHANGELOG) {
      return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} difere do merge recomputado sem ter conflitado` };
    }
    const comMarcas = blobEm(raiz, arvore.trim(), arquivo);
    if (comMarcas === null) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} some no merge recomputado` };
    const resolvido = resolverConflitosAditivos(comMarcas);
    if (!resolvido.ok) return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo}: ${resolvido.recusa}` };
    const esperado = arquivo === ARQUIVO_DO_CHANGELOG ? posicionarEntradas(resolvido.texto, entradas, daBase).texto : resolvido.texto;
    if (blobEm(raiz, sha, arquivo) !== esperado) {
      return { sha, tipo: 'merge-com-ajuste', conflitos, detalhe: `${arquivo} não é o que a regra do núcleo produz` };
    }
  }
  const deCodigo = conflitos.filter(a => a !== ARQUIVO_DO_CHANGELOG);
  return deCodigo.length
    ? { sha, tipo: 'merge-de-codigo', conflitos, detalhe: `conflito de código resolvido pela regra: ${deCodigo.slice(0, 3).join(', ')}` }
    : { sha, tipo: 'merge-mecanico', conflitos, detalhe: conflitos.length ? 'só o CHANGELOG conflitou' : 'merge limpo da base' };
}

/** A cadeia de primeiro pai da fonte até a base (exclusive), cada commit classificado; a mais nova primeiro. */
export function cadeiaDaFonte(raiz: string, fonte: string, base: string): CommitDaCadeia[] {
  const r = git(raiz, ['rev-list', '--first-parent', `--max-count=${MAXIMO_DA_CADEIA}`, fonte, '--not', base]);
  if (!r.ok) return [];
  return r.stdout.split('\n').map(l => l.trim()).filter(l => SHA.test(l)).map(sha => classificarCommit(raiz, sha, base));
}

/** As linhas acrescentadas do diff de três pontos, com o arquivo e o número da linha nova, e os padrões de segredo nelas. */
export function segredosDoDiff(raiz: string, base: string, fonte: string): Array<{ nome: string; arquivo: string; linha: number }> {
  const r = git(raiz, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--unified=0', '--no-renames', `${base}...${fonte}`], 120000);
  const achados: Array<{ nome: string; arquivo: string; linha: number }> = [];
  let arquivo = '', nova = 0, cabecalho = false;
  for (const l of r.stdout.split('\n')) {
    if (l.startsWith('diff --git ')) { cabecalho = true; arquivo = ''; continue; }
    // O `+++` só é o nome do arquivo no cabeçalho; dentro do hunk, é uma linha acrescentada que começa por "++".
    if (cabecalho && l.startsWith('+++ ')) { arquivo = l.slice(4).replace(/^b\//, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { nova = Number(h[1]); cabecalho = false; continue; }
    if (!cabecalho && l.startsWith('+') && arquivo) {
      for (const a of procurarSegredos(l.slice(1))) achados.push({ nome: a.nome, arquivo, linha: nova });
      nova += 1;
    }
  }
  return achados;
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
  const checks = (t.sessoes ?? []).filter(s => s.fase === 'CHECK' && s.origem !== 'adocao' && !!s.despachadaEm)
    .sort((a, b) => Date.parse(a.despachadaEm!) - Date.parse(b.despachadaEm!));
  return checks.map(s => {
    const sessao = { sessionId: s.sessionId, fase: 'CHECK' as const, despachadaEm: s.despachadaEm! };
    const resultado = eventos.filter(e => e.tipo === 'phase_result' && e.sessionId === s.sessionId && e.fase === 'CHECK' &&
      e.despachoEm === s.despachadaEm && e.origem === 'sessions.watch' && typeof e.sensorResultId === 'string' && e.sensorResultId).at(-1);
    const morta = eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === s.sessionId);
    const estado: RevisaoLida['resultado'] = resultado
      ? (resultado.classificacao === 'fase_concluida' && resultado.ok === true ? 'concluida' : 'bloqueada') : morta ? 'morta' : 'em-curso';
    const p = provaDoOrk(raiz, t.id, sessao, eventos, fonteRegistrada(eventos, sessao));
    const intervalo = eventosDoIntervalo(eventos, sessao);
    const commitsDoRevisor = intervalo.filter(e => (e.tipo === 'mcp_git_committed' || e.tipo === 'commit') && e.sessionId === s.sessionId).length;
    return { sessionId: s.sessionId, runtime: s.runtime, despachadaEm: s.despachadaEm!, semVinculo: vinculoDaSessao(raiz, t, s, eventos),
      resultado: estado, prova: { ok: p.ok, fonte: p.fonte, veredito: p.veredito ?? null }, revisado: p.verify?.commit ?? null, commitsDoRevisor };
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
    thread: t.id, branch, fonte, base, integrada: null, cadeia: [], autores, ultimoDespachoDeAutor: ultimoDespacho,
    revisoes: revisoesDaThread(raiz, t, eventos), verifies: verifiesDoLedger(eventos),
    comandosEsperados: comandosDoManifesto(daBranch.manifesto).length,
    claims: claimsAtivas.map(c => ({ id: c.id, mutante: ALEGACAO_DE_MUTANTE.test(c.alegacao) })),
    ciExigido: manifesto.ci.required_for_ship === true, ci: null, arquivos: [], segredos: [], changelog: null,
    bundle: { ok: false, texto: 'a fonte não se lê' },
  };
  if (!fonte) return fatos;
  const b = conferirBundle(raiz, t, branch, fonte, comandosDoBundle(daBranch));
  fatos.bundle = { ok: b.estado === 'feita', texto: b.texto };
  if (fatos.ciExigido) {
    const contexto = manifesto.ci.context || 'ork-verify';
    fatos.ci = opcoes.forja ? consultarCiDoRepositorio(opcoes.forja.repositorio, fonte, contexto, opcoes.executorCi)
      : consultarCi(carregado, fonte, remoto, opcoes.executorCi);
  }
  if (!base.sha) return fatos;
  const integrada = git(raiz, ['merge-base', '--is-ancestor', base.sha, fonte]);
  fatos.integrada = integrada.code === 0 ? true : integrada.code === 1 ? false : null;
  fatos.cadeia = cadeiaDaFonte(raiz, fonte, base.sha);
  const mudados = git(raiz, ['diff', '--name-only', '-z', '--no-renames', `${base.sha}...${fonte}`]);
  fatos.arquivos = mudados.ok ? mudados.stdout.split('\0').filter(Boolean) : [];
  fatos.segredos = segredosDoDiff(raiz, base.sha, fonte);
  const ancestral = git(raiz, ['merge-base', base.sha, fonte]).stdout.trim();
  const antes = ancestral ? blobEm(raiz, ancestral, ARQUIVO_DO_CHANGELOG) ?? '' : '';
  const depois = blobEm(raiz, fonte, ARQUIVO_DO_CHANGELOG);
  fatos.changelog = depois === null && !fatos.arquivos.some(pedeLinha)
    ? { ok: true, detalhe: 'sem CHANGELOG e sem código do produto', linhas: [] }
    : conferirChangelog(antes, depois ?? '', fatos.arquivos);
  return fatos;
}

/** As provas da entrega de uma thread agora. */
export function provasDaEntrega(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDasProvas = {}): ProvasDaEntrega {
  return avaliarProvas(lerFatosDaEntrega(carregado, threadId, opcoes));
}
