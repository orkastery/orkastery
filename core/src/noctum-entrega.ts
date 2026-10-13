/**
 * RM-058, fatia N5 (D1, D2, D4, D7 a D11 da ork-rm058n5): a entrega dentro do arco #Noctum, numa máquina.
 *
 * A N2 deixa "aguardando entrega" a thread cujo passo é SHIP ou MASTER. Aqui o arco entrega sozinho: `passoDaEntrega` relê
 * a fila e, para cada trabalho na entrega, decide pela ordem de `decidirEntrega` e executa no máximo um efeito por chamada:
 *
 * - `atualizar`: a base andou (ou o bundle ficou velho): merge da base na worktree da thread sob a condução do verify, conflito
 *   só aditivo resolvido pela regra do núcleo, a entrada da thread posta em "Não publicado", o bundle de CI regravado e o
 *   verify logo depois, na mesma condução; o conflito que não é só aditivo aborta o merge e bloqueia sem repetir a mesma base;
 * - `revisar`: falta a revisão independente: o CHECK sai numa sessão nova pela reserva do arco (`revisao: true`), pelos slots
 *   de revisão e pela trava de despacho, até `LIMITE_DE_REVISOES` vezes por trabalho;
 * - `verificar`: o verify no SHA, na fila pesada, até três rodadas por SHA;
 * - `publicar`: push e PR pelo `publicarEntrega`, com o envelope conferido imediatamente antes de cada um;
 * - `integrar`: sob a trava do kernel do destino, as provas relidas do zero, a conferência da N1 com `merge`, o merge da
 *   fonte sobre a base conferida, a página do item com o estado derivado (quando ela deixaria a `main` vermelha), o push sem
 *   força para a base (a base que andou recusa) e a prova pelo `ls-remote`; o `ship_done` leva a evidência das provas;
 * - `reconciliar`: a fonte já está na base (o push que ficou incerto chegou): o `ship_done` sai sem integrar de novo;
 * - `master`: o MASTER por omissão da thread entregue, com o índice derivado do ledger.
 *
 * Só o envelope `v2` integra por aqui; com outro contrato, a integração é da vez entre máquinas da N3, e `integradorDaEntrega`
 * dá a função de merge no formato que ela recebe. Nada aqui liga o modo: ninguém chama o passo ainda (o vigia é da N4).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { vagaDoDespacho } from './board';
import { ExecutorCi, prepararBundleCi, repositorioGitHub } from './ci';
import { canalDoProcesso, comConducao, ErroDeConducao } from './conducao';
import { docsPendentesDoMerge, sincronizarDocs, verificarDocs } from './docs';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { ErroDaFilaPesada, kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { aceitarPorOmissao, masterRatificado } from './master';
import { tagDoModo } from './modos';
import { concluirDespacho, conferirAntesDoEfeito, EstadoDoArco, lerArco, reservarDespacho } from './noctum-arco';
import { admitir, escolherConta, fatosDeCapacidade, LeituraDeSessoes } from './noctum-capacidade';
import { ARQUIVO_DO_CHANGELOG, entradasDaThread, linhasDaBasePerdidas, posicionarEntradas, resolverConflitosAditivos } from './noctum-changelog';
import { CONTRATO_ENVELOPE_V2, Destino, envelopeComTrabalhos, RecusaDoArco } from './noctum-envelope';
import { fatosDaFila, LeitorDeReservas, montarFila, TrabalhoNaFila } from './noctum-fila';
import { blobEm, garantirObjetos, MotivoDaEntrega, OpcoesDasProvas, pontaDaBaseNoRemoto, ProvasDaEntrega, provasDaEntrega,
  RecusaDaEntrega } from './noctum-provas';
import { ExecutorDoGh } from './parado-no-condutor';
import { OpcoesRun, resolverDespacho, ResultadoRun, rodarFase } from './phase';
import { lerPerfis, perfilDisponivel } from './runtime-profiles';
import { configDoBloco, lerSetup } from './setup';
import { commitQueIncorporou } from './ship';
import { Forja, manifestoDaBranch, Publicacao, publicarEntrega } from './ship-publicar';
import { dirThread, gravarThread, lerThread, pedidoDaThread } from './thread';
import { Fase, Thread } from './types';
import { exec } from './util';
import { ConducaoDoVerify, verificar } from './verify';
import { branchDaWorktree } from './worktree';

export const CONTRATO_DA_ENTREGA = 'ork.noctum-entrega/v1' as const;
/** D2: quantas vezes o arco despacha o CHECK independente de um trabalho antes de bloquear. */
export const LIMITE_DE_REVISOES = 4;
/** D7: a espera pelo CI pendente, a cadência do vigia. */
export const ESPERA_DO_CI_MS = 5 * 60_000;
/** O evento do ledger da thread que guarda a atualização recusada por conflito, com a ponta da base. */
export const EVENTO_DA_ATUALIZACAO_RECUSADA = 'noctum_atualizacao_recusada';
/** O evento do ledger da thread que guarda o push para a base de resultado incerto. */
export const EVENTO_DO_PUSH_INCERTO = 'noctum_push_incerto';

const SHA = /^[0-9a-f]{40}$/;
const curto = (s: string | null | undefined): string => (s ? s.slice(0, 12) : '-');
const mensagem = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);

function git(raiz: string, args: string[], prazoMs = 120000) {
  return exec('git', args, raiz, prazoMs, { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
}

// ---------------------------------------------------------------------------
// A decisão, pura.
// ---------------------------------------------------------------------------

export type AcaoDaEntrega = 'master' | 'reconciliar' | 'atualizar' | 'revisar' | 'verificar' | 'publicar' | 'integrar';

export type DecisaoDaEntrega =
  | { acao: AcaoDaEntrega; porque: string }
  | { acao: 'aguardar'; motivo: string; porque: string }
  | { acao: 'bloqueado'; motivo: string; porque: string }
  | { acao: 'nada'; porque: string };

/** O que a decisão de um trabalho precisa saber. */
export interface EntradaDaDecisao {
  /** Já tem `ship_done`. */
  entregue: boolean;
  masterPendente: boolean;
  /** A fonte já está na base remota, sem `ship_done`: a integração aconteceu e falta o registro. */
  incorporada: boolean;
  /** O destino do envelope para o repositório da thread, ou o motivo de não haver um. */
  destino: { ok: true; podeMerge: boolean } | { ok: false; motivo: MotivoDaEntrega; detalhe: string };
  provas: ProvasDaEntrega | null;
  /** A atualização da base atual já foi recusada (conflito que não é só aditivo). */
  atualizacaoRecusada: boolean;
  revisoesDespachadas: number;
  /** A publicação como o `publicarEntrega` em ensaio a vê: `ja-publicada`, `publicaria` ou a recusa dele. */
  publicacao: { acao: Publicacao['acao']; detalhe: string } | null;
}

const motivoDe = (p: ProvasDaEntrega, id: string) => p.provas.find(x => x.id === id) ?? null;

/**
 * A ordem do plano da N5: entregue (MASTER), destino, integração com a base, provas estáticas, falhas que não se repetem,
 * revisão, verify, CI com a publicação e, por fim, a integração.
 */
export function decidirEntrega(e: EntradaDaDecisao): DecisaoDaEntrega {
  if (e.entregue) return e.masterPendente ? { acao: 'master', porque: 'entregue: falta o MASTER' } : { acao: 'nada', porque: 'entregue e com MASTER' };
  if (!e.destino.ok) return { acao: 'bloqueado', motivo: e.destino.motivo, porque: e.destino.detalhe };
  if (e.incorporada) return { acao: 'reconciliar', porque: 'a fonte já está na base remota e falta o ship_done' };
  if (!e.provas) return { acao: 'bloqueado', motivo: 'noctum.entrega.fonte-ausente', porque: 'as provas não se leram' };
  const p = e.provas;
  const integracao = motivoDe(p, 'integracao')!;
  if (integracao.motivo === 'noctum.entrega.fonte-ausente') return { acao: 'bloqueado', motivo: integracao.motivo, porque: integracao.detalhe };
  if (integracao.motivo === 'noctum.entrega.base-sem-leitura') return { acao: 'aguardar', motivo: integracao.motivo, porque: integracao.detalhe };
  if (integracao.motivo === 'noctum.entrega.base-mudou') {
    return e.atualizacaoRecusada
      ? { acao: 'bloqueado', motivo: 'noctum.entrega.conflito-nao-aditivo', porque: 'a atualização sobre esta base já foi recusada por conflito que não é só aditivo' }
      : { acao: 'atualizar', porque: integracao.detalhe };
  }
  for (const id of ['segredo', 'mutantes', 'changelog'] as const) {
    const x = motivoDe(p, id)!;
    if (x.motivo && x.motivo !== 'noctum.entrega.mutante-nao-executado') return { acao: 'bloqueado', motivo: x.motivo, porque: x.detalhe };
  }
  const bundle = motivoDe(p, 'bundle')!;
  if (bundle.motivo) return { acao: 'atualizar', porque: bundle.detalhe };
  const verify = motivoDe(p, 'verify')!;
  if (verify.motivo && ['noctum.entrega.verify-falha-consistente', 'noctum.entrega.verify-esgotado', 'noctum.entrega.baseline-ausente']
    .includes(verify.motivo)) return { acao: 'bloqueado', motivo: verify.motivo, porque: verify.detalhe };
  const revisao = motivoDe(p, 'revisao')!;
  if (revisao.motivo === 'noctum.entrega.revisao-em-curso') return { acao: 'aguardar', motivo: revisao.motivo, porque: revisao.detalhe };
  if (revisao.motivo === 'noctum.entrega.revisao-reprovada') return { acao: 'bloqueado', motivo: revisao.motivo, porque: revisao.detalhe };
  if (revisao.motivo) {
    return e.revisoesDespachadas >= LIMITE_DE_REVISOES
      ? { acao: 'bloqueado', motivo: 'noctum.entrega.revisao-esgotada', porque: `${e.revisoesDespachadas} CHECKs despachados sem revisão válida: ${revisao.detalhe}` }
      : { acao: 'revisar', porque: revisao.detalhe };
  }
  const mutantes = motivoDe(p, 'mutantes')!;
  if (verify.motivo || mutantes.motivo) return { acao: 'verificar', porque: verify.motivo ? verify.detalhe : mutantes.detalhe };
  const ci = motivoDe(p, 'ci')!;
  if (ci.motivo === 'noctum.entrega.ci-vermelho' || ci.motivo === 'noctum.entrega.ci-ausente') return { acao: 'bloqueado', motivo: ci.motivo, porque: ci.detalhe };
  if (ci.motivo === 'noctum.entrega.ci-sem-leitura') return { acao: 'aguardar', motivo: ci.motivo, porque: ci.detalhe };
  if (ci.motivo) {
    // CI pendente: sem a branch no SHA ou sem o PR, o check nem começa; com os dois, é esperar.
    if (e.publicacao?.acao === 'publicaria') return { acao: 'publicar', porque: `${ci.detalhe}; a branch ou o PR ainda não estão no remoto` };
    if (e.publicacao?.acao === 'recusada') return { acao: 'aguardar', motivo: 'noctum.entrega.ci-pendente', porque: `a publicação recusou: ${e.publicacao.detalhe}` };
    return { acao: 'aguardar', motivo: ci.motivo, porque: ci.detalhe };
  }
  if (!e.destino.podeMerge) return { acao: 'bloqueado', motivo: 'noctum.entrega.fora-do-destino', porque: 'o envelope não autoriza merge neste destino' };
  return { acao: 'integrar', porque: 'todas as provas valem no SHA fonte e na base vigente' };
}

// ---------------------------------------------------------------------------
// O passo.
// ---------------------------------------------------------------------------

export interface OpcoesDaEntrega {
  quando?: string;
  maquina?: string;
  /** O remoto do projeto; padrão `origin`. */
  remoto?: string;
  /** O GitHub do remoto (os testes o fixam, porque o remoto deles é um bare local). */
  forja?: Forja;
  executorGh?: ExecutorDoGh;
  executorCi?: ExecutorCi;
  lerReservas?: LeitorDeReservas;
  /** O despacho do CHECK; em produção, `rodarFase`. */
  despachar?: (carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesRun) => ResultadoRun;
  consultarSessoes?: () => LeituraDeSessoes;
  perfis?: () => Array<{ id: string; runtime: string }>;
  /** O verify do SHA; em produção, `verificar` com a fila pesada. */
  verificar?: (carregado: ManifestoCarregado, threadId: string, conducao: ConducaoDoVerify) => { ok: boolean };
  /** A espera pela vez na fila pesada e pela trava de despacho. */
  esperarMs?: number;
}

export type ResultadoDaEntrega =
  | { acao: 'atualizou'; trabalho: string; thread: string; de: string; para: string; conflitos: string[]; bundle: boolean; verify: boolean | null }
  | { acao: 'revisao-pedida'; trabalho: string; thread: string; sessionId: string | null; reserva: number; conta: string; runtime: string }
  | { acao: 'verificou'; trabalho: string; thread: string; commit: string; ok: boolean }
  | { acao: 'publicou'; trabalho: string; thread: string; pr: number | null; head: string | null }
  | { acao: 'integrou'; trabalho: string; thread: string; mergeSha: string; pontaDaBase: string; docs: string | null; provas: string }
  | { acao: 'reconciliou'; trabalho: string; thread: string; mergeSha: string; pontaDaBase: string }
  | { acao: 'master'; trabalho: string; thread: string; indice: number }
  | { acao: 'aguardar'; trabalho: string | null; thread: string | null; motivo: string; detalhe: string; ate: string }
  | { acao: 'bloqueado'; trabalho: string; thread: string; motivo: string; detalhe: string; outros: Array<{ trabalho: string; motivo: string }> }
  | { acao: 'nada'; motivo: 'sem-entrega' | 'arco-encerrado' | 'sem-autorizacao' | 'sem-trabalhos'; detalhe: string };

const depoisDe = (quando: string, ms: number): string => new Date(Date.parse(quando) + ms).toISOString();

/** O destino do envelope para o repositório da thread: o mesmo repositório, a base do manifesto, `push` e `pr`. */
function destinoDoTrabalho(carregado: ManifestoCarregado, destinos: readonly Destino[], remoto: string, forja?: Forja):
  { ok: true; destino: Destino; podeMerge: boolean } | { ok: false; motivo: MotivoDaEntrega; detalhe: string } {
  const url = git(carregado.raiz, ['remote', 'get-url', '--', remoto]);
  const repositorio = forja?.repositorio ?? (url.ok ? repositorioGitHub(url.stdout.trim()) : null);
  if (!repositorio) return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o remoto ${remoto} não é um repositório do GitHub` };
  const destino = destinos.find(d => d.repositorio.toLowerCase() === repositorio.toLowerCase());
  if (!destino) return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o repositório ${repositorio} não está no envelope` };
  const base = carregado.manifesto.worktree.base_branch;
  if (destino.base !== base) {
    return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `a base do envelope (${destino.base}) não é a do projeto (${base})` };
  }
  if (!destino.permissoes.includes('push') || !destino.permissoes.includes('pr')) {
    return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o envelope não autoriza push e PR em ${destino.repositorio}` };
  }
  return { ok: true, destino, podeMerge: destino.permissoes.includes('merge') };
}

/** O que o passo lê de um trabalho na entrega, agora. */
function entradaDoTrabalho(carregado: ManifestoCarregado, estado: EstadoDoArco, trabalho: TrabalhoNaFila, opcoes: OpcoesDaEntrega,
  remoto: string): { t: Thread; entrada: EntradaDaDecisao; destino: Destino | null; base: string | null } {
  const { raiz } = carregado;
  const t = lerThread(raiz, trabalho.thread!);
  const eventos = lerLedger(dirThread(raiz, t.id));
  const entregue = eventos.some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
  const masterPendente = entregue && t.status !== 'fechada' && !masterRatificado(raiz, t.id);
  const revisoesDespachadas = estado.despachos.filter(d => d.trabalho === trabalho.id && d.fase === 'CHECK' && d.revisao && d.desfecho !== 'recusado').length;
  const d = destinoDoTrabalho(carregado, estado.conteudo!.destinos, remoto, opcoes.forja);
  const vazia: EntradaDaDecisao = { entregue, masterPendente, incorporada: false, destino: d.ok ? { ok: true, podeMerge: d.podeMerge } : d,
    provas: null, atualizacaoRecusada: false, revisoesDespachadas, publicacao: null };
  if (entregue || !d.ok) return { t, entrada: vazia, destino: d.ok ? d.destino : null, base: null };
  const ponta = pontaDaBaseNoRemoto(raiz, remoto, d.destino.base);
  if (ponta.sha) garantirObjetos(raiz, remoto, d.destino.base, ponta.sha);
  const ref = git(raiz, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchDaWorktree(t)}^{commit}`]);
  const fonte = ref.ok ? ref.stdout.trim() : null;
  const incorporada = !!ponta.sha && !!fonte && SHA.test(fonte) && git(raiz, ['merge-base', '--is-ancestor', fonte, ponta.sha]).ok;
  if (incorporada) return { t, entrada: { ...vazia, incorporada }, destino: d.destino, base: ponta.sha };
  const opcoesDasProvas: OpcoesDasProvas = { remoto, base: d.destino.base, forja: opcoes.forja, executorCi: opcoes.executorCi, pontaDaBase: ponta };
  const provas = provasDaEntrega(carregado, t.id, opcoesDasProvas);
  const atualizacaoRecusada = !!ponta.sha && eventos.some(e => e.tipo === EVENTO_DA_ATUALIZACAO_RECUSADA && e.base === ponta.sha);
  // A publicação só importa com o CI pendente: o ensaio do `publicarEntrega` lê o remoto e a forja sem efeito nenhum.
  const ciPendente = provas.provas.find(x => x.id === 'ci')?.motivo === 'noctum.entrega.ci-pendente';
  const publicacao = ciPendente ? (() => {
    const r = publicarEntrega(carregado, t.id, { remoto, forja: opcoes.forja, executorGh: opcoes.executorGh, dryRun: true, quando: opcoes.quando });
    return { acao: r.acao, detalhe: r.detalhe };
  })() : null;
  return { t, entrada: { ...vazia, provas, atualizacaoRecusada, publicacao }, destino: d.destino, base: ponta.sha };
}

/**
 * Um passo da entrega do arco: no máximo um efeito, nos trabalhos que a fila da N2 mostra na entrega (`aguardando-entrega`)
 * ou entregues sem MASTER, na ordem da fila. Lança só o erro que não é recusa (disco, git); toda recusa volta como resultado.
 */
export function passoDaEntrega(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaEntrega = {}): ResultadoDaEntrega {
  const quando = opcoes.quando ?? new Date().toISOString();
  const remoto = opcoes.remoto ?? 'origin';
  let estado: EstadoDoArco | null;
  try { estado = lerArco(carregado.raiz, arco, quando); }
  catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    return { acao: 'aguardar', trabalho: null, thread: null, motivo: e.motivo, detalhe: e.message, ate: depoisDe(quando, ESPERA_DO_CI_MS) };
  }
  if (!estado || !estado.conteudo || estado.situacao === 'proposto') return { acao: 'nada', motivo: 'sem-autorizacao', detalhe: 'o arco não tem envelope autorizado' };
  if (estado.situacao === 'agendado') {
    return { acao: 'aguardar', trabalho: null, thread: null, motivo: 'agendado', detalhe: 'a janela do arco ainda não começou', ate: estado.conteudo.janela.inicio };
  }
  if (estado.situacao !== 'vigente') return { acao: 'nada', motivo: 'arco-encerrado', detalhe: `o arco está ${estado.situacao}: nenhum efeito novo` };
  const conteudo = estado.conteudo;
  if (!envelopeComTrabalhos(conteudo)) return { acao: 'nada', motivo: 'sem-trabalhos', detalhe: 'o envelope vigente não tem lista de trabalhos' };
  const fila = montarFila(fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas }));
  const naEntrega = fila.trabalhos.filter(t => t.thread && (t.estado === 'aguardando-entrega' || t.estado === 'entregue'))
    .sort((a, b) => a.prioridade - b.prioridade || a.posicao - b.posicao);
  if (!naEntrega.length) return { acao: 'nada', motivo: 'sem-entrega', detalhe: 'nenhum trabalho do arco está na entrega' };
  let espera: Extract<ResultadoDaEntrega, { acao: 'aguardar' }> | null = null;
  const bloqueios: Array<{ trabalho: string; thread: string; motivo: string; detalhe: string }> = [];
  for (const trabalho of naEntrega) {
    // D9: com outro contrato (a v3 da N3), a integração é da vez entre máquinas; aqui nada se decide por ela.
    if (conteudo.contrato !== CONTRATO_ENVELOPE_V2) {
      bloqueios.push({ trabalho: trabalho.id, thread: trabalho.thread!, motivo: 'noctum.entrega.exige-vez-da-n3',
        detalhe: `o envelope ${conteudo.contrato} integra pela vez entre máquinas (integrarComVez da N3), com integradorDaEntrega` });
      continue;
    }
    const lido = entradaDoTrabalho(carregado, estado, trabalho, opcoes, remoto);
    const decisao = decidirEntrega(lido.entrada);
    const base = { trabalho: trabalho.id, thread: lido.t.id };
    if (decisao.acao === 'nada') continue;
    if (decisao.acao === 'aguardar') {
      espera ??= { acao: 'aguardar', ...base, motivo: decisao.motivo, detalhe: decisao.porque, ate: depoisDe(quando, ESPERA_DO_CI_MS) };
      continue;
    }
    if (decisao.acao === 'bloqueado') { bloqueios.push({ ...base, motivo: decisao.motivo, detalhe: decisao.porque }); continue; }
    const r = executar(carregado, arco, estado, trabalho, lido, decisao.acao, opcoes, remoto, quando);
    // Um efeito por chamada: depois de tentar, o passo volta, qualquer que seja o desfecho. Só a recusa da publicação e da
    // atualização deixa seguir para o próximo trabalho: a primeira vem antes do efeito (a do envelope depois do push para o
    // arco inteiro), e a segunda é local e desfeita (o merge abortado).
    const seguir = decisao.acao === 'publicar' || decisao.acao === 'atualizar';
    if (seguir && r.acao === 'aguardar') { espera ??= r; continue; }
    if (seguir && r.acao === 'bloqueado') { bloqueios.push({ trabalho: r.trabalho, thread: r.thread, motivo: r.motivo, detalhe: r.detalhe }); continue; }
    return r;
  }
  if (espera) return espera;
  if (bloqueios.length) {
    const [primeiro, ...outros] = bloqueios;
    return { acao: 'bloqueado', ...primeiro, outros: outros.map(o => ({ trabalho: o.trabalho, motivo: o.motivo })) };
  }
  return { acao: 'nada', motivo: 'sem-entrega', detalhe: 'os trabalhos na entrega já estão entregues e com MASTER' };
}

type Lido = ReturnType<typeof entradaDoTrabalho>;

function executar(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, trabalho: TrabalhoNaFila, lido: Lido, acao: AcaoDaEntrega,
  opcoes: OpcoesDaEntrega, remoto: string, quando: string): ResultadoDaEntrega {
  const ids = { trabalho: trabalho.id, thread: lido.t.id };
  const recusa = (motivo: string, detalhe: string, aguardar = false): ResultadoDaEntrega => aguardar
    ? { acao: 'aguardar', ...ids, motivo, detalhe, ate: depoisDe(quando, ESPERA_DO_CI_MS) }
    : { acao: 'bloqueado', ...ids, motivo, detalhe, outros: [] };
  try {
    switch (acao) {
      case 'master': {
        const a = aceitarPorOmissao(carregado.raiz, lido.t.id);
        return { acao: 'master', ...ids, indice: a.indice.valor };
      }
      case 'reconciliar': {
        const r = reconciliarEntrega(carregado, arco, estado, lido.t.id, remoto, lido.destino!, lido.base!);
        return { acao: 'reconciliou', ...ids, mergeSha: r.mergeSha, pontaDaBase: r.pontaDaBase };
      }
      case 'atualizar': return atualizarCandidato(carregado, arco, trabalho, lido.t, lido.base!, opcoes);
      case 'revisar': return despacharRevisao(carregado, arco, estado, trabalho, lido.t, opcoes, quando);
      case 'verificar': {
        const r = verificarAFonte(carregado, arco, lido.t.id, opcoes);
        return { acao: 'verificou', ...ids, commit: lido.entrada.provas?.fonte ?? '', ok: r.ok };
      }
      case 'publicar': return publicar(carregado, arco, estado, trabalho, lido, opcoes, remoto);
      case 'integrar': {
        const r = integrarNoDestino(carregado, arco, lido.t.id, { ...opcoes, remoto, quando });
        return { acao: 'integrou', ...ids, mergeSha: r.mergeSha, pontaDaBase: r.pontaDaBase, docs: r.docs.commit, provas: r.provas };
      }
    }
  } catch (e) {
    if (e instanceof RecusaDaEntrega) {
      const esperar = ['noctum.entrega.integracao-ocupada', 'noctum.entrega.base-sem-leitura', 'noctum.entrega.push-incerto'].includes(e.motivo);
      return recusa(e.motivo, e.message, esperar);
    }
    if (e instanceof RecusaDoArco) return recusa(e.motivo, e.message);
    if (e instanceof ErroDeConducao || e instanceof ErroDaFilaPesada) return recusa('noctum.entrega.ocupada', mensagem(e), true);
    if (e instanceof Error && /^HITL ocupado/.test(e.message)) return recusa('noctum.entrega.ocupada', mensagem(e), true);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Os efeitos.
// ---------------------------------------------------------------------------

/** D4: as entradas do índice com conflito e os estágios de cada uma (`git ls-files -u`). */
function conflitosDoIndice(wt: string): Map<string, Set<string>> {
  const r = git(wt, ['ls-files', '-u', '-z']);
  const mapa = new Map<string, Set<string>>();
  for (const entrada of r.stdout.split('\0').filter(Boolean)) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(entrada);
    if (m) mapa.set(m[2], (mapa.get(m[2]) ?? new Set()).add(m[1]));
  }
  return mapa;
}

/**
 * D4: atualiza o candidato contra a base lida no remoto, na worktree limpa da thread e sob a condução do verify: merge
 * diff3, conflito só aditivo pela regra do núcleo, a entrada da thread em "Não publicado", nenhuma linha da base perdida, o
 * bundle regravado e o verify logo depois. A recusa aborta o merge, grava a base recusada e bloqueia.
 */
function atualizarCandidato(carregado: ManifestoCarregado, arco: string, trabalho: TrabalhoNaFila, t: Thread, base: string,
  opcoes: OpcoesDaEntrega): ResultadoDaEntrega {
  const ids = { trabalho: trabalho.id, thread: t.id };
  const wt = t.worktree;
  if (!wt || !fs.existsSync(wt)) throw new RecusaDaEntrega('noctum.entrega.fonte-ausente', `a thread ${t.id} não tem a worktree dela`);
  const conducao: ConducaoDoVerify = { canal: canalDoProcesso(), correlacao: `noctum:${arco}`, filaPesada: { esperarMs: opcoes.esperarMs } };
  const pedido = { canal: conducao.canal!, correlacao: conducao.correlacao, operacao: 'verify' as const, prazoMs: 30 * 60_000 };
  return comConducao(carregado.raiz, t.id, pedido, () => {
    const branch = branchDaWorktree(t);
    if (git(wt, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim() !== branch) {
      throw new RecusaDaEntrega('noctum.entrega.worktree-suja', `a worktree da thread não está na branch ${branch}`);
    }
    if (git(wt, ['status', '--porcelain']).stdout.trim()) {
      throw new RecusaDaEntrega('noctum.entrega.worktree-suja', 'a worktree da thread tem mudança que não foi commitada');
    }
    const antes = git(wt, ['rev-parse', 'HEAD']).stdout.trim();
    let conflitos: string[] = [];
    if (!git(wt, ['merge-base', '--is-ancestor', base, antes]).ok) conflitos = mesclarABase(carregado, t, wt, branch, antes, base, arco);
    const daBranch = manifestoDaBranch(carregado, git(wt, ['rev-parse', 'HEAD']).stdout.trim());
    const arquivo = prepararBundleCi(daBranch, t.id);
    const relativo = path.relative(wt, arquivo);
    const bundleMudou = git(wt, ['status', '--porcelain', '--', relativo]).stdout.trim() !== '';
    if (bundleMudou) {
      git(wt, ['add', '--', relativo]);
      const c = git(wt, ['commit', '-q', '-m', `ci(${t.id}): bundle regravado na atualização do arco ${arco}`]);
      if (!c.ok) throw new Error(`o commit do bundle falhou: ${c.stderr.trim().slice(0, 300)}`);
    }
    const depois = git(wt, ['rev-parse', 'HEAD']).stdout.trim();
    const v = (opcoes.verificar ?? ((k, id, c) => verificar(k, id, { conducao: c })))(carregado, t.id, conducao);
    return { acao: 'atualizou', ...ids, de: antes, para: depois, conflitos, bundle: bundleMudou, verify: v.ok };
  });
}

/** O merge da base na branch, com a regra do núcleo; devolve os arquivos que conflitaram. Recusa aborta e grava a base. */
function mesclarABase(carregado: ManifestoCarregado, t: Thread, wt: string, branch: string, antes: string, base: string, arco: string): string[] {
  const msg = `Merge da base (${curto(base)}) na ${branch}: atualização do arco ${arco}`;
  const m = git(wt, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', '-m', msg, base], 300000);
  const recusar = (detalhe: string, arquivos: string[]): never => {
    git(wt, ['merge', '--abort']);
    registrar(dirThread(carregado.raiz, t.id), t.id, EVENTO_DA_ATUALIZACAO_RECUSADA, { arco, base, de: antes, arquivos: arquivos.slice(0, 50),
      motivo: detalhe.slice(0, 300) });
    throw new RecusaDaEntrega('noctum.entrega.conflito-nao-aditivo', detalhe);
  };
  const estagios = conflitosDoIndice(wt);
  const conflitos = [...estagios.keys()];
  if (!m.ok && !conflitos.length) recusar(`o merge da base falhou sem conflito de conteúdo: ${(m.stderr || m.stdout).trim().split('\n')[0]}`, []);
  const semConteudo = conflitos.find(a => estagios.get(a)!.size !== 3);
  if (semConteudo) recusar(`${semConteudo}: conflito que não é de conteúdo (apagado, renomeado ou criado dos dois lados)`, conflitos);
  for (const arquivo of conflitos) {
    const resolvido = resolverConflitosAditivos(fs.readFileSync(path.join(wt, arquivo), 'utf8'));
    if (!resolvido.ok) recusar(`${arquivo}: ${resolvido.recusa}`, conflitos);
    else fs.writeFileSync(path.join(wt, arquivo), resolvido.texto);
  }
  // D5: a entrada da thread em "Não publicado", com ou sem conflito no CHANGELOG.
  const caminho = path.join(wt, ARQUIVO_DO_CHANGELOG);
  if (fs.existsSync(caminho)) {
    const ancestral = git(carregado.raiz, ['merge-base', antes, base]).stdout.trim();
    const entradas = entradasDaThread(ancestral ? blobEm(carregado.raiz, ancestral, ARQUIVO_DO_CHANGELOG) ?? '' : '',
      blobEm(carregado.raiz, antes, ARQUIVO_DO_CHANGELOG) ?? '');
    const daBase = blobEm(carregado.raiz, base, ARQUIVO_DO_CHANGELOG) ?? '';
    const atual = fs.readFileSync(caminho, 'utf8');
    const pos = posicionarEntradas(atual, entradas, daBase);
    if (pos.perdidas) recusar(`${pos.perdidas} entrada(s) da thread sumiram do CHANGELOG no merge`, conflitos);
    const perdidas = linhasDaBasePerdidas(daBase, pos.texto);
    if (perdidas.length) recusar(`${perdidas.length} linha(s) do CHANGELOG da base sumiriam no merge`, conflitos);
    if (pos.texto !== atual) fs.writeFileSync(caminho, pos.texto);
  }
  const aAdicionar = [...new Set([...conflitos, ...(fs.existsSync(caminho) ? [ARQUIVO_DO_CHANGELOG] : [])])];
  if (aAdicionar.length) git(wt, ['add', '--', ...aAdicionar]);
  const c = git(wt, ['commit', '-q', '--no-edit']);
  if (!c.ok) recusar(`o commit do merge falhou: ${c.stderr.trim().split('\n')[0]}`, conflitos);
  return conflitos;
}

/** O verify da fonte, na fila pesada e sob a condução da thread. */
function verificarAFonte(carregado: ManifestoCarregado, arco: string, threadId: string, opcoes: OpcoesDaEntrega): { ok: boolean } {
  const conducao: ConducaoDoVerify = { canal: canalDoProcesso(), correlacao: `noctum:${arco}`, filaPesada: { esperarMs: opcoes.esperarMs } };
  return (opcoes.verificar ?? ((k, id, c) => verificar(k, id, { conducao: c })))(carregado, threadId, conducao);
}

/** A conferência da N1 de um efeito, na forma que o `publicarEntrega` recebe; guarda o motivo da recusa do envelope. */
function conferirParaPublicar(raiz: string, arco: string, estado: EstadoDoArco, destino: Destino, branch: string, quando?: string) {
  const recusado: { motivo: string | null } = { motivo: null };
  const conferir = (efeito: 'push' | 'pr') => {
    try {
      conferirAntesDoEfeito(raiz, { arco, envelopeSha256: estado.envelopeSha256 ?? '', acao: efeito, repositorio: destino.repositorio,
        branch: efeito === 'push' ? branch : destino.base }, quando);
      return null;
    } catch (e) {
      if (!(e instanceof RecusaDoArco)) throw e;
      recusado.motivo = e.motivo;
      return { recusa: e.message, correcao: 'o efeito fica para um envelope vigente que o autorize' };
    }
  };
  return { conferir, recusado };
}

function publicar(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, trabalho: TrabalhoNaFila, lido: Lido,
  opcoes: OpcoesDaEntrega, remoto: string): ResultadoDaEntrega {
  const ids = { trabalho: trabalho.id, thread: lido.t.id };
  const envelope = conferirParaPublicar(carregado.raiz, arco, estado, lido.destino!, branchDaWorktree(lido.t), opcoes.quando);
  const r = publicarEntrega(carregado, lido.t.id, { remoto, forja: opcoes.forja, executorGh: opcoes.executorGh, antesDoEfeito: envelope.conferir });
  if (r.acao === 'publicou') return { acao: 'publicou', ...ids, pr: r.pr?.numero ?? null, head: r.head };
  if (r.acao === 'ja-publicada') {
    return { acao: 'aguardar', ...ids, motivo: 'noctum.entrega.ci-pendente', detalhe: r.detalhe, ate: depoisDe(opcoes.quando ?? new Date().toISOString(), ESPERA_DO_CI_MS) };
  }
  // A recusa do envelope sai com o motivo dele (revogado, expirado, fora do destino); a do publicar, com o dele.
  const motivo = envelope.recusado.motivo ?? `publicar.${r.motivo ?? 'recusada'}`;
  return { acao: 'bloqueado', ...ids, motivo, detalhe: `${r.detalhe}${r.correcao ? ` (${r.correcao})` : ''}`, outros: [] };
}

// ---------------------------------------------------------------------------
// O despacho do CHECK independente (D1, D2): o caminho curto do despacho da N2, com as primitivas exportadas.
// ---------------------------------------------------------------------------

function vezDeDespachar(raiz: string, esperarMs: number): number | null {
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum']);
  const dir = path.join(principal, '.orkastery', 'noctum');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const prazo = Date.now() + esperarMs;
  for (;;) {
    const fd = tentarTravaExclusiva(path.join(dir, 'despacho.lock'));
    if (fd !== null) return fd;
    if (Date.now() >= prazo) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
}

function perfisDisponiveis(raiz: string, agoraMs: number): Array<{ id: string; runtime: string }> {
  try { return lerPerfis(raiz).perfis.filter(p => perfilDisponivel(p, agoraMs)).map(p => ({ id: p.id, runtime: p.runtime })); }
  catch { return []; }
}

function despacharRevisao(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, trabalho: TrabalhoNaFila, t: Thread,
  opcoes: OpcoesDaEntrega, quando: string): ResultadoDaEntrega {
  const { raiz } = carregado;
  const ids = { trabalho: trabalho.id, thread: t.id };
  const aguardar = (motivo: string, detalhe: string): ResultadoDaEntrega =>
    ({ acao: 'aguardar', ...ids, motivo, detalhe, ate: depoisDe(quando, ESPERA_DO_CI_MS) });
  if (!kernelDisponivel()) return aguardar('sem-trava-do-kernel', 'o arco só despacha com /usr/bin/flock');
  const conteudo = estado.conteudo!;
  if (!envelopeComTrabalhos(conteudo)) return aguardar('fonte-indisponivel', 'o envelope vigente não tem a capacidade da v2');
  const fd = vezDeDespachar(raiz, opcoes.esperarMs ?? 30_000);
  if (fd === null) return aguardar('despacho-em-curso', 'outro passo de arco desta máquina segura a vez de despachar');
  try {
    const fase: Fase = 'CHECK';
    const runtime = resolverDespacho(carregado.manifesto, {}, configDoBloco(lerSetup(raiz), t.modo, fase)).runtime;
    const capacidade = fatosDeCapacidade(carregado, { quando, consultar: opcoes.consultarSessoes });
    const perfis = (opcoes.perfis ?? (() => perfisDisponiveis(raiz, Date.parse(quando))))();
    const doRuntime = perfis.filter(p => p.runtime === runtime).map(p => p.id);
    const conta = escolherConta(conteudo.capacidade, capacidade, doRuntime)
      ?? conteudo.capacidade.porConta.find(c => doRuntime.includes(c.conta))?.conta ?? null;
    if (!conta) return aguardar('capacidade.conta-nao-autorizada', `nenhuma conta do envelope é perfil disponível do runtime ${runtime}`);
    const admissao = admitir({ runtime, conta, revisao: true }, conteudo.capacidade, capacidade, vagaDoDespacho(carregado, t.id, quando));
    if (!admissao.ok) return aguardar(admissao.motivo, admissao.detalhe);
    let reserva: number;
    try {
      reserva = reservarDespacho(raiz, { arco, envelopeSha256: estado.envelopeSha256 ?? '', trabalho: trabalho.id, thread: t.id, fase,
        runtime, conta, revisao: true }, quando).seq;
    } catch (e) {
      if (!(e instanceof RecusaDoArco)) throw e;
      return { acao: 'bloqueado', ...ids, motivo: e.motivo, detalhe: e.message, outros: [] };
    }
    const devolver = (motivo: string, detalhe: string, bloquear: boolean): ResultadoDaEntrega => {
      concluirDespacho(raiz, arco, reserva, { motivo });
      return bloquear ? { acao: 'bloqueado', ...ids, motivo, detalhe, outros: [] } : aguardar(motivo, detalhe);
    };
    const pedido = pedidoDaThread(raiz, t);
    if (!pedido) return devolver('noctum.despacho.pedido-ausente', `a thread ${t.id} não guardou o pedido`, true);
    const antes = lerLedger(dirThread(raiz, t.id)).length;
    const r = (opcoes.despachar ?? rodarFase)(carregado, t.id, { fase, prompt: pedido.texto, perfil: conta, canal: canalDoProcesso(),
      correlacao: `noctum:${arco}`, baselinePeloDespacho: false });
    if (r.motivo === 'baseline.pendente') return devolver('noctum.entrega.baseline-ausente', 'o despacho do CHECK pediu a baseline', true);
    if (r.bloqueado) return devolver(String(r.motivo ?? 'despacho.bloqueado'), r.erro ?? 'o núcleo recusou o despacho do CHECK', false);
    if (r.sessionId || r.idempotente) {
      concluirDespacho(raiz, arco, reserva, { thread: t.id, sessionId: r.sessionId, idempotente: r.idempotente === true });
      return { acao: 'revisao-pedida', ...ids, sessionId: r.sessionId, reserva, conta, runtime };
    }
    // Como na N2: sem id e com motivo de antes do lançamento, a sessão volta ao orçamento; o resto fica pendente para a N4.
    const novos = lerLedger(dirThread(raiz, t.id)).slice(antes);
    const idDaFalha = novos.filter(e => e.tipo === TIPOS_DE_EVENTO.despachoFalhou && typeof e.sessionId === 'string').at(-1)?.sessionId ?? null;
    if (!idDaFalha && r.motivo && r.motivo !== 'runtime.unavailable') return devolver(String(r.motivo), r.erro ?? 'o runtime recusou o despacho', false);
    return aguardar(String(r.motivo ?? 'despacho.sem-sessao'), `${r.erro ?? 'o núcleo não abriu sessão'}; a reserva fica pendente para a N4 reconciliar`);
  } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------------------
// A integração (D9 e D10).
// ---------------------------------------------------------------------------

export interface IntegracaoDaEntrega {
  /** O commit para o qual a base aponta depois do push: o merge, ou o commit dos docs derivados em cima dele. */
  merge: string;
  mergeSha: string;
  pontaDaBase: string;
  docs: { commit: string | null; itens: string[] };
  provas: string;
}

export interface OpcoesDaIntegracao extends OpcoesDaEntrega {
  /** O candidato que a N3 recebeu: a fonte, a base e o sha256 das provas que a vez tomou. */
  esperado?: { fonte: string; base: string; provas: string };
}

/** O arquivo da trava do kernel do destino nesta máquina: um integrador por repositório e base, entre todos os arcos. */
export function caminhoDaTravaDoDestino(raiz: string, destino: Pick<Destino, 'repositorio' | 'base'>): string {
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum']);
  const dir = path.join(principal, '.orkastery', 'noctum');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chave = createHash('sha256').update(`${destino.repositorio.toLowerCase()}\n${destino.base}`).digest('hex').slice(0, 16);
  return path.join(dir, `integracao-${chave}.lock`);
}

const travaDoDestino = (raiz: string, destino: Destino): number | null => tentarTravaExclusiva(caminhoDaTravaDoDestino(raiz, destino));

/** A thread chega ao SHIP quando o ciclo dela tem SHIP, e só avança (como no `ork ship registrar-pr`). */
function avancarParaShip(raiz: string, threadId: string): void {
  const t = lerThread(raiz, threadId);
  const fases = t.fases ?? [];
  if (!fases.includes('SHIP') || fases.indexOf(t.faseAtual) >= fases.indexOf('SHIP')) return;
  gravarThread(raiz, { ...t, faseAtual: 'SHIP' });
}

/**
 * D10: a página do item que deixaria a `main` vermelha (`sdlc.thread` desta thread e `estado.codigo` fora de `Mesclado`)
 * recebe o estado derivado num commit em cima do merge: o `docs sincronizar` dos itens dela, numa worktree temporária com uma
 * branch temporária no merge como base, conferido pelo `docs verificar` estrito antes de voltar.
 */
function docsDerivados(raiz: string, threadId: string, merge: string, arco: string): { commit: string | null; itens: string[] } {
  const pendentes = docsPendentesDoMerge(raiz, threadId, merge);
  const itens = [...new Set(pendentes.map(p => p.id))];
  if (!itens.length) return { commit: null, itens: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-noctum-docs-'));
  const ramo = `noctum-entrega-${randomUUID().slice(0, 8)}`;
  try {
    if (!git(raiz, ['worktree', 'add', '--detach', tmp, merge]).ok) throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', 'a worktree temporária dos docs não nasceu');
    git(raiz, ['branch', ramo, merge]);
    sincronizarDocs(tmp, { baseBranch: ramo, itens, escrever: true });
    const mudados = git(tmp, ['status', '--porcelain', '-z']).stdout.split('\0').filter(Boolean).map(l => l.slice(3));
    if (!mudados.length) return { commit: null, itens };
    git(tmp, ['add', '--', ...mudados]);
    const c = git(tmp, ['commit', '-q', '-m', `docs(${threadId}): ${itens.join(', ')} com o estado depois do merge (arco ${arco})`]);
    if (!c.ok) throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', `o commit dos docs derivados falhou: ${c.stderr.trim().split('\n')[0]}`);
    const commit = git(tmp, ['rev-parse', 'HEAD']).stdout.trim();
    git(raiz, ['branch', '-f', ramo, commit]);
    const ruins = verificarDocs(tmp, { baseBranch: ramo }).achados
      .filter(a => a.gravidade === 'erro' && ((a.id !== undefined && itens.includes(a.id)) || a.regra === 'docs.paridade.indice'));
    if (ruins.length) {
      throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', `o estado derivado ainda reprova: ${ruins.slice(0, 3).map(a => `${a.regra} (${a.id ?? a.arquivo})`).join('; ')}`);
    }
    return { commit, itens };
  } finally {
    git(raiz, ['worktree', 'remove', '--force', tmp]);
    git(raiz, ['branch', '-D', ramo]);
    fs.rmSync(tmp, { recursive: true, force: true });
    git(raiz, ['worktree', 'prune']);
  }
}

/**
 * D9: a integração amarrada ao SHA, sob a trava do destino. Relê o envelope, a base pelo `ls-remote`, a fonte pela ref
 * local e pela remota, e todas as provas; confere a N1 com `merge` logo antes do push; o merge tem a árvore da fonte e os
 * pais base e fonte; o push vai sem força, então a base que andou recusa; o `ls-remote` prova. Lança a recusa tipada.
 */
export function integrarNoDestino(carregado: ManifestoCarregado, arco: string, threadId: string, opcoes: OpcoesDaIntegracao = {}): IntegracaoDaEntrega {
  const { raiz } = carregado;
  const quando = opcoes.quando;
  const remoto = opcoes.remoto ?? 'origin';
  const estado = lerArco(raiz, arco, quando);
  if (!estado?.conteudo || !envelopeComTrabalhos(estado.conteudo)) throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', 'o arco não tem envelope v2 vigente');
  if (estado.conteudo.contrato !== CONTRATO_ENVELOPE_V2 && !opcoes.esperado) {
    throw new RecusaDaEntrega('noctum.entrega.exige-vez-da-n3', 'fora da v2, a integração é da vez entre máquinas (N3)');
  }
  const d = destinoDoTrabalho(carregado, estado.conteudo.destinos, remoto, opcoes.forja);
  if (!d.ok) throw new RecusaDaEntrega(d.motivo, d.detalhe);
  if (!d.podeMerge) throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', 'o envelope não autoriza merge neste destino');
  const destino = d.destino;
  if (!kernelDisponivel()) throw new RecusaDaEntrega('noctum.entrega.integracao-ocupada', 'sem /usr/bin/flock, nenhuma integração passa');
  const trava = travaDoDestino(raiz, destino);
  if (trava === null) throw new RecusaDaEntrega('noctum.entrega.integracao-ocupada', `outro processo desta máquina integra em ${destino.repositorio}, base ${destino.base}`);
  try {
    const t = lerThread(raiz, threadId);
    const branch = branchDaWorktree(t);
    const ponta = pontaDaBaseNoRemoto(raiz, remoto, destino.base);
    if (!ponta.sha) throw new RecusaDaEntrega('noctum.entrega.base-sem-leitura', ponta.erro ?? 'a base não se leu');
    const provas = provasDaEntrega(carregado, threadId, { remoto, base: destino.base, forja: opcoes.forja, executorCi: opcoes.executorCi, pontaDaBase: ponta });
    const falha = provas.provas.find(p => !p.ok);
    if (falha) throw new RecusaDaEntrega(falha.motivo ?? 'noctum.entrega.nao-provada', `${falha.id}: ${falha.detalhe}`);
    const fonte = provas.fonte!;
    if (opcoes.esperado) {
      if (opcoes.esperado.fonte !== fonte) throw new RecusaDaEntrega('noctum.entrega.fonte-mudou', `a fonte é ${curto(fonte)}, e o candidato ${curto(opcoes.esperado.fonte)}`);
      if (opcoes.esperado.base !== ponta.sha) throw new RecusaDaEntrega('noctum.entrega.base-mudou', `a base é ${curto(ponta.sha)}, e o candidato ${curto(opcoes.esperado.base)}`);
      if (opcoes.esperado.provas !== provas.sha256) throw new RecusaDaEntrega('noctum.entrega.nao-provada', 'as provas de agora não são as do candidato');
    }
    // O CI rodou no PR da branch: a branch no remoto precisa ser a fonte.
    const remota = git(raiz, ['ls-remote', '--', remoto, `refs/heads/${branch}`]).stdout.split('\n').map(l => l.trim().split(/\s+/))
      .find(p => p[1] === `refs/heads/${branch}`)?.[0] ?? null;
    if (remota !== fonte) throw new RecusaDaEntrega('noctum.entrega.fonte-mudou', `a branch ${branch} no remoto está em ${curto(remota)}, e a fonte provada é ${curto(fonte)}`);
    const passos: string[] = [`git ls-remote ${remoto} refs/heads/${destino.base}`, `git ls-remote ${remoto} refs/heads/${branch}`];
    const envelopeSha256 = estado.envelopeSha256 ?? '';
    // A N1 imediatamente antes do efeito.
    conferirAntesDoEfeito(raiz, { arco, envelopeSha256, acao: 'merge', repositorio: destino.repositorio, branch: destino.base }, quando);
    const assunto = `ship(${threadId}): merge de ${branch} em ${destino.base}`;
    const corpo = [`thread: ${t.id} (${t.slug})`, `modo: ${tagDoModo(t.modo)}`, `arco: ${arco} (envelope ${envelopeSha256.slice(0, 12)})`,
      `provas: ${provas.sha256}`, `verificado em: ${fonte}`].join('\n');
    const merge = git(raiz, ['commit-tree', `${fonte}^{tree}`, '-p', ponta.sha, '-p', fonte, '-m', assunto, '-m', corpo]);
    const mergeSha = merge.stdout.trim();
    if (!merge.ok || !SHA.test(mergeSha)) throw new RecusaDaEntrega('noctum.entrega.nao-provada', `o commit do merge falhou: ${merge.stderr.trim().split('\n')[0]}`);
    passos.push(`git commit-tree ${curto(fonte)}^{tree} -p ${curto(ponta.sha)} -p ${curto(fonte)}`);
    const docs = docsDerivados(raiz, threadId, mergeSha, arco);
    if (docs.commit) passos.push(`ork docs sincronizar --escrever --so ${docs.itens.join(',')} (commit ${curto(docs.commit)})`);
    const alvo = docs.commit ?? mergeSha;
    const push = git(raiz, ['push', '--', remoto, `${alvo}:refs/heads/${destino.base}`], 180000);
    passos.push(`git push -- ${remoto} ${curto(alvo)}:refs/heads/${destino.base}`);
    const depois = pontaDaBaseNoRemoto(raiz, remoto, destino.base);
    passos.push(`git ls-remote ${remoto} refs/heads/${destino.base}`);
    if (depois.sha !== alvo) {
      const recusado = /rejected|non-fast-forward|fetch first|stale info|failed to update ref/i.test(`${push.stderr}${push.stdout}`);
      if (recusado || (push.ok && depois.sha)) {
        throw new RecusaDaEntrega('noctum.entrega.base-mudou', `a base andou antes do push (${curto(depois.sha)}): o candidato se refaz sobre a base nova`);
      }
      registrar(dirThread(raiz, threadId), threadId, EVENTO_DO_PUSH_INCERTO, { arco, base: destino.base, alvo, mergeSha, fonte,
        remoto, lido: depois.sha, erro: (push.stderr || depois.erro || '').trim().split('\n')[0].slice(0, 200) });
      throw new RecusaDaEntrega('noctum.entrega.push-incerto', 'o push para a base não se provou; o passo seguinte relê o remoto antes de qualquer coisa');
    }
    if (!git(raiz, ['merge-base', '--is-ancestor', fonte, alvo]).ok) throw new RecusaDaEntrega('noctum.entrega.nao-provada', 'a ponta da base não contém a fonte');
    const ci = provas.provas.find(p => p.id === 'ci')!.evidencia;
    registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.shipConcluido, {
      de: branch, para: destino.base, shaDe: fonte, shaParaAntes: ponta.sha, mergeSha, pontaDaBase: alvo, jaIncorporado: false,
      remoto, shaRemoto: depois.sha, pushVerificado: true, fonteDaProva: `git ls-remote ${remoto} refs/heads/${destino.base}`,
      autorizadoPor: `envelope ${envelopeSha256.slice(0, 12)} do arco ${arco} (#Noctum)`, tipoDeAutorizacao: 'noctum',
      modo: t.modo, tag: tagDoModo(t.modo),
      evidencia: { arco, envelopeSha256, provas: { sha256: provas.sha256, itens: provas.provas.map(p => ({ id: p.id, ok: p.ok, detalhe: p.detalhe.slice(0, 200) })) },
        falhasRegistradas: provas.falhasRegistradas, ci, docs, passos },
    });
    avancarParaShip(raiz, threadId);
    publicarEmSegundoPlano(raiz);
    return { merge: alvo, mergeSha, pontaDaBase: alvo, docs, provas: provas.sha256 };
  } finally { fs.closeSync(trava); }
}

/**
 * A fonte que já está na base remota sem `ship_done` (o push incerto que chegou, ou o merge feito por outro caminho): o
 * registro sai com o commit que a incorporou e a ponta provada pelo `ls-remote`, sem integrar de novo.
 */
function reconciliarEntrega(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, threadId: string, remoto: string,
  destino: Destino, ponta: string): { mergeSha: string; pontaDaBase: string } {
  const { raiz } = carregado;
  const t = lerThread(raiz, threadId);
  const branch = branchDaWorktree(t);
  const fonte = git(raiz, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).stdout.trim();
  const mergeSha = commitQueIncorporou(raiz, fonte, ponta);
  if (!mergeSha) throw new RecusaDaEntrega('noctum.entrega.nao-provada', 'o commit que incorporou a fonte na base não se achou');
  const incerto = lerLedger(dirThread(raiz, threadId)).filter(e => e.tipo === EVENTO_DO_PUSH_INCERTO).at(-1) ?? null;
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: branch, para: destino.base, shaDe: fonte, mergeSha, pontaDaBase: ponta, jaIncorporado: true, remoto, shaRemoto: ponta,
    pushVerificado: true, fonteDaProva: `git merge-base --is-ancestor ${fonte} ${ponta} (ls-remote ${remoto} refs/heads/${destino.base})`,
    autorizadoPor: `envelope ${(estado.envelopeSha256 ?? '').slice(0, 12)} do arco ${arco} (#Noctum), reconciliado`, tipoDeAutorizacao: 'noctum',
    modo: t.modo, tag: tagDoModo(t.modo),
    evidencia: { arco, reconciliado: true, pushIncerto: incerto ? { eventId: incerto.eventId, alvo: incerto.alvo } : null },
  });
  avancarParaShip(raiz, threadId);
  publicarEmSegundoPlano(raiz);
  return { mergeSha, pontaDaBase: ponta };
}

/** O candidato que a N3 leva à vez de integrar: a branch, a fonte, a base e o sha256 das provas. */
export function candidatoDaEntrega(provas: ProvasDaEntrega): { branch: string; fonte: string; base: string; provas: string } | null {
  return provas.ok && provas.fonte && provas.base.sha ? { branch: provas.branch, fonte: provas.fonte, base: provas.base.sha, provas: provas.sha256 } : null;
}

/**
 * D9: a mesma integração na forma do `Integrador` da N3 (`integrarComVez`): recebe o remoto, o destino e o candidato já
 * revalidados pela vez, confere que a fonte, a base e as provas são as do candidato e devolve o commit para onde a base aponta.
 */
export function integradorDaEntrega(carregado: ManifestoCarregado, arco: string, threadId: string, opcoes: OpcoesDaEntrega = {}):
  (c: { remoto: string; destino: { repositorio: string; base: string }; candidato: { branch: string; fonte: string; base: string; provas: string } }) =>
  { merge: string } {
  return (c) => {
    const branch = branchDaWorktree(lerThread(carregado.raiz, threadId));
    if (c.candidato.branch !== branch) throw new RecusaDaEntrega('noctum.entrega.fonte-mudou', `o candidato é da branch ${c.candidato.branch}, e a thread é ${branch}`);
    if (c.destino.base !== carregado.manifesto.worktree.base_branch) {
      throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', `a base ${c.destino.base} não é a do projeto`);
    }
    const r = integrarNoDestino(carregado, arco, threadId, { ...opcoes, remoto: c.remoto,
      esperado: { fonte: c.candidato.fonte, base: c.candidato.base, provas: c.candidato.provas } });
    return { merge: r.merge };
  };
}
