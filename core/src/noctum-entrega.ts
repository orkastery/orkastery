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
 * - `integrar`: sob a trava do kernel do destino, as provas relidas do zero, o merge da fonte sobre a base conferida, a
 *   página do item com o estado derivado (quando ela deixaria a `main` vermelha), a conferência da N1 com `merge` e, logo
 *   depois, o push amarrado à ponta conferida (a base que andou recusa) e a prova pelo `ls-remote`; o `ship_done` leva a
 *   evidência das provas;
 * - `reconciliar`: a fonte já está na base (o push que ficou incerto chegou): o `ship_done` sai sem integrar de novo;
 * - `master`: o MASTER por omissão da thread entregue, com o índice derivado do ledger.
 *
 * A recusa que vem antes de qualquer efeito (a leitura que falhou, a trava ocupada, a prova que mudou sob a trava) não
 * encerra o passo: o trabalho seguinte da fila tem a vez, e um trabalho travado não prende os outros.
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
import { admitir, escolherConta, fatosDeCapacidade, LeituraDeSessoes, MotivoDaCapacidade } from './noctum-capacidade';
import { ARQUIVO_DO_CHANGELOG, entradasDaThread, linhasDaBasePerdidas, linhasRemovidas, posicionarEntradas,
  resolverConflitosAditivos } from './noctum-changelog';
import { ConteudoDoEnvelope, CONTRATO_ENVELOPE_V2, Destino, envelopeComTrabalhos, envelopeMultimaquina, MotivoDeRecusaDoArco, RecusaDoArco, shaDoPedido,
  Trabalho } from './noctum-envelope';
import { DecisoesDaSupervisao, fatosDaFila, LeitorDeReservas, montarFila, TrabalhoNaFila } from './noctum-fila';
import { pedidoDoArco } from './noctum-guarda';
import { blobEm, garantirObjetos, gitDaEntrega, MotivoDaEntrega, OpcoesDasProvas, pontaDaBaseNoRemoto, ProvasDaEntrega, provasDaEntrega,
  RecusaDaEntrega, textoDe } from './noctum-provas';
import { contaForaAgora, EstadoDaSupervisao, lerSupervisao } from './noctum-supervisao';
import { ExecutorDoGh } from './parado-no-condutor';
import { OpcoesRun, resolverDespacho, ResultadoRun, rodarFase } from './phase';
import { procurarSegredos } from './policies';
import { lerPerfis, perfilDisponivel } from './runtime-profiles';
import { configDoBloco, lerSetup } from './setup';
import { commitQueIncorporou } from './ship';
import { Forja, manifestoDaBranch, Publicacao, publicarEntrega } from './ship-publicar';
import { dirThread, gravarThread, lerThread, pedidoDaThread } from './thread';
import { Fase, MotivoGate, Thread } from './types';
import { ConducaoDoVerify, verificar } from './verify';
import { branchDaWorktree } from './worktree';
import { integrarComVez } from './noctum-integracao';
import { coordenacaoDaFila, lerRede, RedeDoArco } from './noctum-rede';

export const CONTRATO_DA_ENTREGA = 'ork.noctum-entrega/v1' as const;
/** D2: quantas vezes o arco despacha o CHECK independente de um trabalho antes de bloquear. */
export const LIMITE_DE_REVISOES = 4;
/** D7: a espera pelo CI pendente, a cadência do vigia. */
export const ESPERA_DO_CI_MS = 5 * 60_000;
/** O evento do ledger da thread que guarda a atualização recusada por conflito, com a ponta da base. */
export const EVENTO_DA_ATUALIZACAO_RECUSADA = 'noctum_atualizacao_recusada';
/** O evento do ledger da thread que guarda o push para a base de resultado incerto. */
export const EVENTO_DO_PUSH_INCERTO = 'noctum_push_incerto';
/** A4 da rodada 1: o evento do ledger da thread que guarda o push que o remoto recusou com a base parada (proteção, gancho). */
export const EVENTO_DO_PUSH_RECUSADO = 'noctum_push_recusado';
/**
 * R2-A3 da rodada 2 e R3-S1 da rodada 3: a linha em que o remoto recusa o push de vez (a proteção da branch, um gancho, a
 * permissão), e não a rede nem a falha passageira do servidor (a trava da ref, o desempacotamento), que esperam. O código do
 * GitHub só vale na linha `remote: error: GH0..`, nunca no endereço do remoto; no `[remote rejected]`, decide o motivo entre
 * parênteses.
 */
function recusaDoRemoto(stderr: string): string | null {
  for (const bruta of stderr.split('\n')) {
    const linha = bruta.trim();
    if (/^remote: error: GH0\d\d\b/.test(linha) || /\bhook declined\b/i.test(linha) || /^!? *\[rejected\] /.test(linha)) return linha.slice(0, 300);
    const remota = /^!? *\[remote rejected\] [^(]*\((.*)\)$/.exec(linha);
    if (remota && /protected|\bden(?:y|ied)\b|permission/i.test(remota[1])) return linha.slice(0, 300);
  }
  return null;
}

/**
 * A8 da rodada 1: o motivo de espera e de bloqueio do passo, tipado pela origem: os da entrega (`noctum.entrega.*`), os do
 * envelope (`noctum.efeito.*`, `noctum.despacho.*`, `noctum.orcamento.*`), os da capacidade (`capacidade.*`), os da
 * publicação (`publicar.*`, com o motivo do `publicarEntrega`) e os do despacho do núcleo (o `motivo` do `rodarFase`).
 */
export type MotivoDoPasso = MotivoDaEntrega | MotivoDeRecusaDoArco | MotivoDaCapacidade | `publicar.${MotivoGate | 'recusada'}`
  | NonNullable<ResultadoRun['motivo']>;

const SHA = /^[0-9a-f]{40}$/;
const curto = (s: string | null | undefined): string => (s ? s.slice(0, 12) : '-');
const mensagem = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
const primeira = (s: string): string => s.trim().split('\n')[0].slice(0, 200);

/** B1 da rodada 1: o git da entrega, com o buffer grande e `ok` só com saída 0 (o mesmo das provas). */
const git = gitDaEntrega;

/** A leitura do git que falhou num efeito: lacuna tipada, que espera e não grava recusa nenhuma. */
const lacuna = (detalhe: string): RecusaDaEntrega => new RecusaDaEntrega('noctum.entrega.git-sem-leitura', detalhe);

// ---------------------------------------------------------------------------
// A supervisão da N4 (R2-B1 da rodada 2): o que ela decide vale aqui como no passo da N2.
// ---------------------------------------------------------------------------

/** O log de supervisão do arco; o que não se lê é lacuna tipada, e nenhum efeito sai sem ele. */
function supervisaoDoArco(raiz: string, arco: string): EstadoDaSupervisao {
  try { return lerSupervisao(raiz, arco); }
  catch (e) { throw new RecusaDaEntrega('noctum.entrega.supervisao-sem-leitura', `o log de supervisão do arco ${arco} não se leu: ${mensagem(e)}`); }
}

/** As decisões da supervisão na forma que a fila da N2 respeita: o trabalho isolado não sai sozinho neste arco. */
function decisoesDaEntrega(sup: EstadoDaSupervisao): DecisoesDaSupervisao {
  return { isolados: new Map([...sup.isolados].map(([t, i]) => [t, `${i.motivo}: ${i.detalhe}`] as const)), retomadas: new Map() };
}

/** Imediatamente antes de um efeito: a supervisão não parou o arco nem isolou o trabalho desde a leitura da fila. */
function conferirSupervisao(raiz: string, arco: string, trabalhos: readonly string[]): void {
  const sup = supervisaoDoArco(raiz, arco);
  if (sup.parada) throw new RecusaDaEntrega('noctum.entrega.arco-parado', `a supervisão parou o arco (${sup.parada.motivo}): ${sup.parada.detalhe}`);
  for (const id of trabalhos) {
    const isolado = sup.isolados.get(id);
    if (isolado) throw new RecusaDaEntrega('noctum.entrega.isolado', `o trabalho ${id} foi isolado pela supervisão (${isolado.motivo}): ${isolado.detalhe}`);
  }
}

/** R2-S3 da rodada 2: os trabalhos do envelope que são da thread, pela regra da fila: a thread fixada, ou o item com o pedido. */
function trabalhosDaThread(conteudo: ConteudoDoEnvelope & { trabalhos: Trabalho[] }, t: Thread): Trabalho[] {
  // R3-S3 da rodada 3: a thread fixada de outro item é `item-divergente` na fila, e não integra aqui.
  return conteudo.trabalhos.filter(w => w.item === t.roadmap && (w.thread !== undefined ? w.thread === t.id
    : !!w.pedido && t.pedido?.sha256 === shaDoPedido(w.pedido)));
}

// ---------------------------------------------------------------------------
// A decisão, pura.
// ---------------------------------------------------------------------------

export type AcaoDaEntrega = 'master' | 'reconciliar' | 'atualizar' | 'revisar' | 'verificar' | 'publicar' | 'integrar';

export type DecisaoDaEntrega =
  | { acao: AcaoDaEntrega; porque: string }
  | { acao: 'aguardar'; motivo: MotivoDaEntrega; porque: string }
  | { acao: 'bloqueado'; motivo: MotivoDaEntrega; porque: string }
  | { acao: 'nada'; porque: string };

/** O que a decisão de um trabalho precisa saber. */
export interface EntradaDaDecisao {
  /** Já tem `ship_done`. */
  entregue: boolean;
  masterPendente: boolean;
  /** B4 da rodada 1: a branch não tem commit próprio (fora os merges) desde o commit de partida da thread. */
  semProduto: boolean;
  /** A fonte já está na base remota, sem `ship_done`: a integração aconteceu e falta o registro. */
  incorporada: boolean;
  /** O destino do envelope para o repositório da thread, ou o motivo de não haver um. */
  destino: { ok: true; podeMerge: boolean } | { ok: false; motivo: MotivoDaEntrega; detalhe: string };
  provas: ProvasDaEntrega | null;
  /** A atualização da base atual já foi recusada (conflito que não é só aditivo). */
  atualizacaoRecusada: boolean;
  /** A4 da rodada 1: o remoto já recusou o push desta fonte sobre esta base, com a base parada. */
  pushRecusado: boolean;
  revisoesDespachadas: number;
  /** A publicação como o `publicarEntrega` em ensaio a vê: `ja-publicada`, `publicaria` ou a recusa dele. */
  publicacao: { acao: Publicacao['acao']; detalhe: string } | null;
}

const motivoDe = (p: ProvasDaEntrega, id: string) => p.provas.find(x => x.id === id) ?? null;

/**
 * A ordem do plano da N5: entregue (MASTER), destino, produto, integração com a base, leituras que faltaram, provas
 * estáticas, falhas que não se repetem, revisão, verify, CI com a publicação e, por fim, a integração.
 */
export function decidirEntrega(e: EntradaDaDecisao): DecisaoDaEntrega {
  if (e.entregue) return e.masterPendente ? { acao: 'master', porque: 'entregue: falta o MASTER' } : { acao: 'nada', porque: 'entregue e com MASTER' };
  if (!e.destino.ok) return { acao: 'bloqueado', motivo: e.destino.motivo, porque: e.destino.detalhe };
  if (e.semProduto) {
    return { acao: 'bloqueado', motivo: 'noctum.entrega.sem-produto', porque: 'a branch não tem commit próprio desde o commit de partida da thread: não há o que entregar' };
  }
  if (e.incorporada) return { acao: 'reconciliar', porque: 'a fonte já está na base remota e falta o ship_done' };
  if (!e.provas) return { acao: 'bloqueado', motivo: 'noctum.entrega.fonte-ausente', porque: 'as provas não se leram' };
  const p = e.provas;
  const integracao = motivoDe(p, 'integracao')!;
  if (integracao.motivo === 'noctum.entrega.fonte-ausente') return { acao: 'bloqueado', motivo: integracao.motivo, porque: integracao.detalhe };
  if (integracao.motivo === 'noctum.entrega.base-sem-leitura') return { acao: 'aguardar', motivo: integracao.motivo, porque: integracao.detalhe };
  // B1 da rodada 1: a leitura do git que falhou não vira "nada mudou"; nenhuma decisão sai de fatos pela metade.
  const semLeitura = p.provas.find(x => x.motivo === 'noctum.entrega.git-sem-leitura');
  if (semLeitura) return { acao: 'aguardar', motivo: 'noctum.entrega.git-sem-leitura', porque: `${semLeitura.id}: ${semLeitura.detalhe}` };
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
  if (e.pushRecusado) {
    return { acao: 'bloqueado', motivo: 'noctum.entrega.push-recusado',
      porque: 'o remoto já recusou o push desta fonte sobre esta base, com a base parada: a proteção da branch ou um gancho decide, e não o arco' };
  }
  return { acao: 'integrar', porque: 'todas as provas valem no SHA fonte e na base vigente' };
}

// ---------------------------------------------------------------------------
// O passo.
// ---------------------------------------------------------------------------

export interface OpcoesDaEntrega {
  /**
   * O instante das leituras do passo (o arco, a fila); sem ele, o relógio do processo no começo do passo. Ele nunca vale
   * para a conferência antes de um efeito (R2-A4 da rodada 2): quem chama com o instante do tique faria o efeito sair com a
   * janela vista no começo do passo.
   */
  quando?: string;
  /**
   * O relógio da conferência da N1 imediatamente antes de cada efeito (push, PR, merge) e do despacho do CHECK sob a trava;
   * sem ele, o relógio do processo na hora da conferência. Só os testes o fixam.
   */
  relogio?: () => string;
  maquina?: string;
  /** O remoto do projeto; padrão `origin`. */
  remoto?: string;
  /** A projeção já lida por quem compõe o tique; sem ela, o passo lê o ramo uma vez. */
  projecaoDaRede?: RedeDoArco;
  /** Prazo e ambiente do Git que lê e grava o ramo de coordenação. */
  redeDaCoordenacao?: import('./branch-de-estado').OpcoesDeGit;
  /** Porta da integração da N3; em produção usa `integrarComVez`, e os ensaios de composição fixam o desfecho da rede. */
  integrarPelaRede?: typeof integrarComVez;
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
  | { acao: 'aguardar'; trabalho: string | null; thread: string | null; motivo: MotivoDoPasso; detalhe: string; ate: string }
  | { acao: 'bloqueado'; trabalho: string; thread: string; motivo: MotivoDoPasso; detalhe: string; outros: Array<{ trabalho: string; motivo: MotivoDoPasso }> }
  | { acao: 'nada'; motivo: 'sem-entrega' | 'arco-encerrado' | 'sem-autorizacao' | 'sem-trabalhos'; detalhe: string };

const depoisDe = (quando: string, ms: number): string => new Date(Date.parse(quando) + ms).toISOString();

/**
 * O destino do envelope para o repositório da thread: o mesmo repositório com a base do projeto (S9 da rodada 1: entre os
 * destinos do repositório, o da base, e não o primeiro da lista), com `push` e `pr`.
 */
function destinoDoTrabalho(carregado: ManifestoCarregado, destinos: readonly Destino[], remoto: string, forja?: Forja):
  { ok: true; destino: Destino; podeMerge: boolean } | { ok: false; motivo: MotivoDaEntrega; detalhe: string } {
  const url = git(carregado.raiz, ['remote', 'get-url', '--', remoto]);
  const repositorio = forja?.repositorio ?? (url.ok ? repositorioGitHub(url.stdout.trim()) : null);
  if (!repositorio) return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o remoto ${remoto} não é um repositório do GitHub` };
  const doRepositorio = destinos.filter(d => d.repositorio.toLowerCase() === repositorio.toLowerCase());
  if (!doRepositorio.length) return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o repositório ${repositorio} não está no envelope` };
  const base = carregado.manifesto.worktree.base_branch;
  const destino = doRepositorio.find(d => d.base === base);
  if (!destino) {
    return { ok: false, motivo: 'noctum.entrega.fora-do-destino',
      detalhe: `nenhum destino do envelope em ${repositorio} tem a base do projeto (${base}); o envelope tem ${doRepositorio.map(d => d.base).join(', ')}` };
  }
  if (!destino.permissoes.includes('push') || !destino.permissoes.includes('pr')) {
    return { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: `o envelope não autoriza push e PR em ${destino.repositorio}` };
  }
  return { ok: true, destino, podeMerge: destino.permissoes.includes('merge') };
}

/**
 * B4 da rodada 1: a branch tem produto quando tem ao menos um commit que não é merge desde o commit de partida da thread.
 * A branch que nunca divergiu da base (ou só recebeu merges dela) não entrega nada, nem por reconciliação. `null` é lacuna.
 */
function temProduto(raiz: string, t: Thread, fonte: string): boolean | null {
  const partida = t.base?.commit;
  if (!partida || !SHA.test(partida)) return false;
  const r = git(raiz, ['rev-list', '--count', '--no-merges', `${partida}..${fonte}`]);
  if (!r.ok) return null;
  return Number(r.stdout.trim()) > 0;
}

/** A9 da rodada 1: a ponta de cada base é lida uma vez por passo (por remoto e base), e não uma vez por trabalho. */
type LeiturasDoPasso = Map<string, { sha: string | null; erro: string | null }>;

/** O que o passo lê de um trabalho na entrega, agora. A leitura que falha lança a lacuna tipada, e o trabalho espera. */
function entradaDoTrabalho(carregado: ManifestoCarregado, estado: EstadoDoArco, trabalho: TrabalhoNaFila, opcoes: OpcoesDaEntrega,
  remoto: string, leituras: LeiturasDoPasso): { t: Thread; entrada: EntradaDaDecisao; destino: Destino | null; base: string | null } {
  const { raiz } = carregado;
  const t = lerThread(raiz, trabalho.thread!);
  const eventos = lerLedger(dirThread(raiz, t.id));
  const entregue = eventos.some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
  const masterPendente = entregue && t.status !== 'fechada' && !masterRatificado(raiz, t.id);
  const revisoesDespachadas = revisoesDoTrabalho(estado, trabalho.id);
  const d = destinoDoTrabalho(carregado, estado.conteudo!.destinos, remoto, opcoes.forja);
  const vazia: EntradaDaDecisao = { entregue, masterPendente, semProduto: false, incorporada: false,
    destino: d.ok ? { ok: true, podeMerge: d.podeMerge } : d, provas: null, atualizacaoRecusada: false, pushRecusado: false,
    revisoesDespachadas, publicacao: null };
  if (entregue || !d.ok) return { t, entrada: vazia, destino: d.ok ? d.destino : null, base: null };
  const chave = `${remoto}\n${d.destino.base}`;
  const ponta = leituras.get(chave) ?? pontaDaBaseNoRemoto(raiz, remoto, d.destino.base);
  leituras.set(chave, ponta);
  if (ponta.sha) garantirObjetos(raiz, remoto, d.destino.base, ponta.sha);
  const branch = branchDaWorktree(t);
  const ref = git(raiz, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  const fonte = ref.ok && SHA.test(ref.stdout.trim()) ? ref.stdout.trim() : null;
  if (fonte) {
    const produto = temProduto(raiz, t, fonte);
    if (produto === null) throw lacuna(`não se leu se a branch ${branch} tem commit próprio desde a partida da thread`);
    if (!produto) return { t, entrada: { ...vazia, semProduto: true }, destino: d.destino, base: ponta.sha };
  }
  if (ponta.sha && fonte) {
    const contida = git(raiz, ['merge-base', '--is-ancestor', fonte, ponta.sha]);
    if (contida.code !== 0 && contida.code !== 1) throw lacuna(`não se leu se a fonte ${curto(fonte)} já está na base`);
    if (contida.code === 0) return { t, entrada: { ...vazia, incorporada: true }, destino: d.destino, base: ponta.sha };
  }
  const opcoesDasProvas: OpcoesDasProvas = { remoto, base: d.destino.base, forja: opcoes.forja, executorCi: opcoes.executorCi, pontaDaBase: ponta };
  const provas = provasDaEntrega(carregado, t.id, opcoesDasProvas);
  const atualizacaoRecusada = !!ponta.sha && eventos.some(e => e.tipo === EVENTO_DA_ATUALIZACAO_RECUSADA && e.base === ponta.sha);
  const pushRecusado = !!ponta.sha && !!provas.fonte &&
    eventos.some(e => e.tipo === EVENTO_DO_PUSH_RECUSADO && e.base === ponta.sha && e.fonte === provas.fonte);
  // A publicação só importa com o CI pendente: o ensaio do `publicarEntrega` lê o remoto e a forja sem efeito nenhum.
  const ciPendente = provas.provas.find(x => x.id === 'ci')?.motivo === 'noctum.entrega.ci-pendente';
  const publicacao = ciPendente ? (() => {
    const r = publicarEntrega(carregado, t.id, { remoto, forja: opcoes.forja, executorGh: opcoes.executorGh, dryRun: true, quando: opcoes.quando,
      doArco: estado.arco });
    return { acao: r.acao, detalhe: r.detalhe };
  })() : null;
  return { t, entrada: { ...vazia, provas, atualizacaoRecusada, pushRecusado, publicacao }, destino: d.destino, base: ponta.sha };
}

/** Os CHECKs de revisão que o arco já despachou para o trabalho (a reserva não recusada). */
function revisoesDoTrabalho(estado: EstadoDoArco, trabalho: string): number {
  return estado.despachos.filter(d => d.trabalho === trabalho && d.fase === 'CHECK' && d.revisao && d.desfecho !== 'recusado').length;
}

/**
 * Um passo da entrega do arco: no máximo um efeito, nos trabalhos que a fila da N2 mostra na entrega (`aguardando-entrega`)
 * ou entregues sem MASTER, na ordem da fila. Lança só o erro que não é recusa (disco); toda recusa volta como resultado.
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
    return { acao: 'aguardar', trabalho: null, thread: null, motivo: 'noctum.entrega.agendado', detalhe: 'a janela do arco ainda não começou',
      ate: estado.conteudo.janela.inicio };
  }
  if (estado.situacao !== 'vigente') return { acao: 'nada', motivo: 'arco-encerrado', detalhe: `o arco está ${estado.situacao}: nenhum efeito novo` };
  const conteudo = estado.conteudo;
  if (!envelopeComTrabalhos(conteudo)) return { acao: 'nada', motivo: 'sem-trabalhos', detalhe: 'o envelope vigente não tem lista de trabalhos' };
  // R2-B1 da rodada 2: o arco que a supervisão parou não faz efeito novo, e o trabalho que ela isolou não sai da fila.
  let sup: EstadoDaSupervisao;
  try { sup = supervisaoDoArco(carregado.raiz, arco); }
  catch (e) {
    if (!(e instanceof RecusaDaEntrega)) throw e;
    return { acao: 'aguardar', trabalho: null, thread: null, motivo: e.motivo, detalhe: e.message, ate: depoisDe(quando, ESPERA_DO_CI_MS) };
  }
  if (sup.parada) return { acao: 'nada', motivo: 'arco-encerrado', detalhe: `a supervisão parou o arco (${sup.parada.motivo}): nenhum efeito novo` };
  const multimaquina = envelopeMultimaquina(conteudo);
  const rede = multimaquina ? opcoes.projecaoDaRede ?? lerRede(carregado, arco,
    { quando, maquina: opcoes.maquina, remoto, rede: opcoes.redeDaCoordenacao }) : null;
  if (rede?.lacuna) {
    return { acao: 'aguardar', trabalho: null, thread: null, motivo: rede.lacuna.motivo, detalhe: rede.lacuna.detalhe,
      ate: depoisDe(quando, ESPERA_DO_CI_MS) };
  }
  const coordenacao = rede ? coordenacaoDaFila(rede) : null;
  const fila = montarFila(fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas,
    ...(coordenacao ? { coordenacao } : {}), supervisao: decisoesDaEntrega(sup) }));
  const naEntrega = fila.trabalhos.filter(t => t.thread && (t.estado === 'aguardando-entrega' || t.estado === 'entregue'))
    .sort((a, b) => a.prioridade - b.prioridade || a.posicao - b.posicao);
  if (!naEntrega.length) return { acao: 'nada', motivo: 'sem-entrega', detalhe: 'nenhum trabalho do arco está na entrega' };
  let espera: Extract<ResultadoDaEntrega, { acao: 'aguardar' }> | null = null;
  const bloqueios: Array<{ trabalho: string; thread: string; motivo: MotivoDoPasso; detalhe: string }> = [];
  const leituras: LeiturasDoPasso = new Map();
  for (const trabalho of naEntrega) {
    // R3-S4 da rodada 3: o trabalho entregue que a supervisão isolou depois não recebe o MASTER do arco (a fila o mostra
    // entregue antes de olhar o isolamento).
    const isoladoDepois = trabalho.estado === 'entregue' ? sup.isolados.get(trabalho.id) : undefined;
    if (isoladoDepois) {
      bloqueios.push({ trabalho: trabalho.id, thread: trabalho.thread!, motivo: 'noctum.entrega.isolado',
        detalhe: `o trabalho ${trabalho.id} foi isolado pela supervisão (${isoladoDepois.motivo}): ${isoladoDepois.detalhe}` });
      continue;
    }
    if (multimaquina && rede?.trabalhos.find(t => t.id === trabalho.id)?.estado === 'entregue') {
      let entregueAqui = false;
      try { entregueAqui = lerLedger(dirThread(carregado.raiz, trabalho.thread!)).some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido); }
      catch { /* a leitura normal abaixo dará a lacuna se este trabalho ainda couber aqui */ }
      if (!entregueAqui) continue;
    }
    let lido: Lido;
    try { lido = entradaDoTrabalho(carregado, estado, trabalho, opcoes, remoto, leituras); }
    catch (e) {
      // A leitura que falhou neste trabalho: ele espera, e os outros seguem.
      if (!(e instanceof RecusaDaEntrega)) throw e;
      espera ??= { acao: 'aguardar', trabalho: trabalho.id, thread: trabalho.thread, motivo: e.motivo, detalhe: e.message, ate: depoisDe(quando, ESPERA_DO_CI_MS) };
      continue;
    }
    const decisao = decidirEntrega(lido.entrada);
    const ids = { trabalho: trabalho.id, thread: lido.t.id };
    if (decisao.acao === 'nada') continue;
    if (decisao.acao === 'aguardar') {
      espera ??= { acao: 'aguardar', ...ids, motivo: decisao.motivo, detalhe: decisao.porque, ate: depoisDe(quando, ESPERA_DO_CI_MS) };
      continue;
    }
    if (decisao.acao === 'bloqueado') { bloqueios.push({ ...ids, motivo: decisao.motivo, detalhe: decisao.porque }); continue; }
    let executado: { resultado: ResultadoDaEntrega; efeito: boolean };
    if (multimaquina && decisao.acao === 'integrar') {
      const ordem = coordenacao?.ordens?.get(trabalho.id);
      const candidato = lido.entrada.provas ? candidatoDaEntrega(lido.entrada.provas) : null;
      if (!ordem || !candidato || !lido.destino) {
        bloqueios.push({ trabalho: trabalho.id, thread: trabalho.thread!, motivo: 'noctum.coordenacao.ordem-vencida',
          detalhe: `o trabalho ${trabalho.id} não tem ordem aceita desta máquina e candidato provado para a vez` });
        continue;
      }
      try {
        const feita = (opcoes.integrarPelaRede ?? integrarComVez)(carregado, arco, { ordem: ordem.ordem,
          destino: { repositorio: lido.destino.repositorio, base: lido.destino.base }, candidato },
        integradorDaEntrega(carregado, arco, lido.t.id, opcoes),
        { quando, maquina: opcoes.maquina, remoto, rede: opcoes.redeDaCoordenacao });
        executado = { resultado: { acao: 'integrou', trabalho: trabalho.id, thread: lido.t.id, mergeSha: feita.merge,
          pontaDaBase: feita.merge, docs: null, provas: candidato.provas }, efeito: true };
      } catch (e) {
        if (!(e instanceof RecusaDoArco)) throw e;
        const ids = { trabalho: trabalho.id, thread: lido.t.id };
        if (['noctum.integracao.ja-entregue', 'noctum.coordenacao.ordem-vencida'].includes(e.motivo)) {
          executado = { resultado: { acao: 'nada', motivo: 'sem-entrega', detalhe: e.message }, efeito: false };
        } else if (e.motivo === 'noctum.integracao.base-nao-provada') {
          executado = { resultado: { acao: 'bloqueado', ...ids, motivo: e.motivo, detalhe: e.message, outros: [] }, efeito: false };
        } else {
          executado = { resultado: { acao: 'aguardar', ...ids, motivo: e.motivo, detalhe: e.message,
            ate: depoisDe(quando, ESPERA_DO_CI_MS) }, efeito: false };
        }
      }
    } else {
      executado = executar(carregado, arco, estado, trabalho, lido, decisao.acao, opcoes, remoto, quando);
    }
    const { resultado, efeito } = executado;
    // Um efeito por chamada (A1 da rodada 1): o efeito feito, ou de resultado incerto, encerra o passo; a recusa de antes de
    // qualquer efeito deixa o trabalho seguinte tentar, e o trabalho travado não prende a fila.
    if (efeito) return resultado;
    if (resultado.acao === 'aguardar') { espera ??= resultado; continue; }
    if (resultado.acao === 'bloqueado') { bloqueios.push({ trabalho: resultado.trabalho, thread: resultado.thread, motivo: resultado.motivo, detalhe: resultado.detalhe }); continue; }
    if (resultado.acao === 'nada') continue;
    return resultado;
  }
  if (espera) return espera;
  if (bloqueios.length) {
    const [primeiro, ...outros] = bloqueios;
    return { acao: 'bloqueado', ...primeiro, outros: outros.map(o => ({ trabalho: o.trabalho, motivo: o.motivo })) };
  }
  return { acao: 'nada', motivo: 'sem-entrega', detalhe: 'os trabalhos na entrega já estão entregues e com MASTER' };
}

type Lido = ReturnType<typeof entradaDoTrabalho>;

/** Se o efeito já passou do ponto sem volta: quem o executa marca, e a recusa depois dele encerra o passo. */
interface Rastro { efeito: boolean }

/** As recusas que esperam a cadência, em vez de bloquear: a trava, a leitura e o push que ninguém sabe se chegou. */
const RECUSAS_QUE_ESPERAM: readonly MotivoDaEntrega[] = ['noctum.entrega.integracao-ocupada', 'noctum.entrega.base-sem-leitura',
  'noctum.entrega.push-incerto', 'noctum.entrega.git-sem-leitura', 'noctum.entrega.ocupada', 'noctum.entrega.git-falhou',
  'noctum.entrega.supervisao-sem-leitura'];

function executar(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, trabalho: TrabalhoNaFila, lido: Lido, acao: AcaoDaEntrega,
  opcoes: OpcoesDaEntrega, remoto: string, quando: string): { resultado: ResultadoDaEntrega; efeito: boolean } {
  const ids = { trabalho: trabalho.id, thread: lido.t.id };
  const recusa = (motivo: MotivoDoPasso, detalhe: string, aguardar = false): ResultadoDaEntrega => aguardar
    ? { acao: 'aguardar', ...ids, motivo, detalhe, ate: depoisDe(quando, ESPERA_DO_CI_MS) }
    : { acao: 'bloqueado', ...ids, motivo, detalhe, outros: [] };
  const rastro: Rastro = { efeito: false };
  try {
    switch (acao) {
      case 'master': {
        const a = aceitarPorOmissao(carregado.raiz, lido.t.id, { arco });
        return { resultado: { acao: 'master', ...ids, indice: a.indice.valor }, efeito: true };
      }
      case 'reconciliar': {
        const r = reconciliarEntrega(carregado, arco, estado, lido.t.id, remoto, lido.destino!, lido.base!);
        return { resultado: { acao: 'reconciliou', ...ids, mergeSha: r.mergeSha, pontaDaBase: r.pontaDaBase }, efeito: true };
      }
      case 'atualizar': return { resultado: atualizarCandidato(carregado, arco, trabalho, lido.t, lido.base!, opcoes, rastro), efeito: true };
      case 'revisar': {
        const resultado = despacharRevisao(carregado, arco, trabalho, lido.t, lido.entrada.revisoesDespachadas, opcoes, rastro);
        return { resultado, efeito: rastro.efeito };
      }
      case 'verificar': {
        const r = verificarAFonte(carregado, arco, lido.t.id, opcoes);
        return { resultado: { acao: 'verificou', ...ids, commit: lido.entrada.provas?.fonte ?? '', ok: r.ok }, efeito: true };
      }
      case 'publicar': {
        const resultado = publicar(carregado, arco, estado, trabalho, lido, opcoes, remoto, rastro);
        return { resultado, efeito: rastro.efeito };
      }
      case 'integrar': {
        // B2 da rodada 1: sem o instante deste passo; a integração confere o envelope com o relógio da hora do push.
        const r = integrarNoDestino(carregado, arco, lido.t.id, { ...opcoes, remoto });
        return { resultado: { acao: 'integrou', ...ids, mergeSha: r.mergeSha, pontaDaBase: r.pontaDaBase, docs: r.docs.commit, provas: r.provas }, efeito: true };
      }
    }
  } catch (e) {
    // Só o push de resultado incerto, ou o que o executor marcou, é efeito: as outras recusas vêm antes de qualquer um (a
    // atualização recusada desfaz o merge local).
    const efeito = rastro.efeito || (e instanceof RecusaDaEntrega && e.motivo === 'noctum.entrega.push-incerto');
    if (e instanceof RecusaDaEntrega) return { resultado: recusa(e.motivo, e.message, RECUSAS_QUE_ESPERAM.includes(e.motivo)), efeito };
    if (e instanceof RecusaDoArco) return { resultado: recusa(e.motivo, e.message), efeito };
    if (e instanceof ErroDeConducao || e instanceof ErroDaFilaPesada) return { resultado: recusa('noctum.entrega.ocupada', mensagem(e), true), efeito };
    if (e instanceof Error && /^HITL ocupado/.test(e.message)) return { resultado: recusa('noctum.entrega.ocupada', mensagem(e), true), efeito };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Os efeitos.
// ---------------------------------------------------------------------------

/** D4: as entradas do índice com conflito e os estágios de cada uma (`git ls-files -u`); a leitura que falha é lacuna. */
function conflitosDoIndice(wt: string): Map<string, Set<string>> {
  const r = git(wt, ['ls-files', '-u', '-z']);
  if (!r.ok) throw lacuna(`os conflitos do índice não se leram: ${primeira(r.stderr) || `código ${r.code}`}`);
  const mapa = new Map<string, Set<string>>();
  for (const entrada of r.stdout.split('\0').filter(Boolean)) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(entrada);
    if (m) mapa.set(m[2], (mapa.get(m[2]) ?? new Set()).add(m[1]));
  }
  return mapa;
}

/** S7 da rodada 1: o arquivo comum da worktree, sem seguir link simbólico; `null` quando falta ou não é arquivo comum. */
function lerArquivoDaWorktree(wt: string, arquivo: string): Buffer | null {
  let fd: number;
  try { fd = fs.openSync(path.join(wt, arquivo), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT' || codigo === 'ELOOP') return null;
    throw e;
  }
  try { return fs.fstatSync(fd).isFile() ? fs.readFileSync(fd) : null; }
  finally { fs.closeSync(fd); }
}

/** S7 da rodada 1: grava o arquivo comum da worktree sem seguir link simbólico. */
function gravarArquivoDaWorktree(wt: string, arquivo: string, texto: string): void {
  const fd = fs.openSync(path.join(wt, arquivo), fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW);
  try { fs.writeFileSync(fd, texto); } finally { fs.closeSync(fd); }
}

/**
 * D4: atualiza o candidato contra a base lida no remoto, na worktree limpa da thread e sob a condução do verify: merge
 * diff3, conflito só aditivo pela regra do núcleo, a entrada da thread em "Não publicado", nenhuma linha da base perdida, o
 * bundle regravado e o verify logo depois. A recusa aborta o merge, grava a base recusada e bloqueia; a leitura que falha
 * aborta e espera, sem gravar recusa.
 */
function atualizarCandidato(carregado: ManifestoCarregado, arco: string, trabalho: TrabalhoNaFila, t: Thread, base: string,
  opcoes: OpcoesDaEntrega, rastro: Rastro): ResultadoDaEntrega {
  const ids = { trabalho: trabalho.id, thread: t.id };
  const wt = t.worktree;
  if (!wt || !fs.existsSync(wt)) throw new RecusaDaEntrega('noctum.entrega.fonte-ausente', `a thread ${t.id} não tem a worktree dela`);
  const conducao: ConducaoDoVerify = { canal: canalDoProcesso(), correlacao: `noctum:${arco}`, filaPesada: { esperarMs: opcoes.esperarMs } };
  const pedido = { canal: conducao.canal!, correlacao: conducao.correlacao, operacao: 'verify' as const, prazoMs: 30 * 60_000 };
  return comConducao(carregado.raiz, t.id, pedido, () => {
    const branch = branchDaWorktree(t);
    const ler = (args: string[], oQue: string): string => {
      const r = git(wt, args);
      if (!r.ok) throw lacuna(`${oQue} não se leu: ${primeira(r.stderr) || `código ${r.code}`}`);
      return r.stdout;
    };
    const ref = git(wt, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!ref.ok || ref.stdout.trim() !== branch) {
      throw new RecusaDaEntrega('noctum.entrega.worktree-suja', `a worktree da thread não está na branch ${branch}`);
    }
    if (ler(['status', '--porcelain'], 'o estado da worktree').trim()) {
      throw new RecusaDaEntrega('noctum.entrega.worktree-suja', 'a worktree da thread tem mudança que não foi commitada');
    }
    const antes = ler(['rev-parse', 'HEAD'], 'o HEAD da worktree').trim();
    const contida = git(wt, ['merge-base', '--is-ancestor', base, antes]);
    if (contida.code !== 0 && contida.code !== 1) throw lacuna(`não se leu se a base ${curto(base)} já está na branch`);
    let conflitos: string[] = [];
    if (contida.code === 1) {
      conflitos = mesclarABase(carregado, t, wt, branch, antes, base, arco);
      rastro.efeito = true;
    }
    const daBranch = manifestoDaBranch(carregado, ler(['rev-parse', 'HEAD'], 'o HEAD depois do merge').trim());
    const arquivo = prepararBundleCi(daBranch, t.id);
    const relativo = path.relative(wt, arquivo);
    const bundleMudou = ler(['status', '--porcelain', '--', relativo], 'o estado do bundle').trim() !== '';
    if (bundleMudou) {
      // R3-A4 da rodada 3: o bundle que não commita (um gancho, a trava do índice) volta ao que a branch tinha, e o passo
      // espera, como no commit do merge (R2-A2), sem deixar a worktree suja para o passo seguinte.
      const desfazerBundle = (): void => {
        git(wt, ['reset', '-q', '--', relativo]);
        const naBranch = git(wt, ['cat-file', '-p', `HEAD:${relativo}`]);
        if (naBranch.ok) fs.writeFileSync(path.join(wt, relativo), naBranch.stdout);
        else fs.rmSync(path.join(wt, relativo), { force: true });
      };
      const a = git(wt, ['add', '--', relativo]);
      if (!a.ok) {
        desfazerBundle();
        throw new RecusaDaEntrega('noctum.entrega.git-falhou', `o git add do bundle ${relativo} falhou: ${primeira(a.stderr)}`);
      }
      const c = git(wt, ['commit', '-q', '-m', `ci(${t.id}): bundle regravado na atualização do arco ${arco}`]);
      if (!c.ok) {
        desfazerBundle();
        throw new RecusaDaEntrega('noctum.entrega.git-falhou', `o commit do bundle falhou: ${primeira(c.stderr)}`);
      }
      rastro.efeito = true;
    }
    const depois = ler(['rev-parse', 'HEAD'], 'o HEAD depois do bundle').trim();
    // O verify que não teve a vez na fila pesada não desfaz a atualização: ele fica para o passo seguinte (`verify: null`).
    let verify: boolean | null = null;
    try { verify = (opcoes.verificar ?? ((k, id, c) => verificar(k, id, { conducao: c })))(carregado, t.id, conducao).ok; }
    catch (e) { if (!(e instanceof ErroDaFilaPesada || e instanceof ErroDeConducao)) throw e; }
    return { acao: 'atualizou', ...ids, de: antes, para: depois, conflitos, bundle: bundleMudou, verify };
  });
}

/**
 * O merge da base na branch, com a regra do núcleo; devolve os arquivos que conflitaram. O conflito que a regra não
 * resolve aborta e grava a base recusada; qualquer outra saída antes do commit (a lacuna, o git que falha sem conflito,
 * o erro de disco) só aborta, e o passo seguinte tenta de novo a mesma base (R2-A2 da rodada 2).
 */
function mesclarABase(carregado: ManifestoCarregado, t: Thread, wt: string, branch: string, antes: string, base: string, arco: string): string[] {
  const msg = `Merge da base (${curto(base)}) na ${branch}: atualização do arco ${arco}`;
  const m = git(wt, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', '-m', msg, base], 300000);
  const abortar = (): void => { git(wt, ['merge', '--abort']); };
  const recusar = (detalhe: string, arquivos: string[]): never => {
    abortar();
    registrar(dirThread(carregado.raiz, t.id), t.id, EVENTO_DA_ATUALIZACAO_RECUSADA, { arco, base, de: antes, arquivos: arquivos.slice(0, 50),
      motivo: detalhe.slice(0, 300) });
    throw new RecusaDaEntrega('noctum.entrega.conflito-nao-aditivo', detalhe);
  };
  try {
    const estagios = conflitosDoIndice(wt);
    const conflitos = [...estagios.keys()];
    // R2-A2 da rodada 2: o merge que falha sem conflito (a trava do índice que outro git deixou, o prazo) não é recusa da
    // base: aborta e espera a cadência.
    if (!m.ok && !conflitos.length) {
      throw new RecusaDaEntrega('noctum.entrega.git-falhou', `o merge da base falhou sem conflito de conteúdo: ${primeira(m.stderr || m.stdout)}`);
    }
    const semConteudo = conflitos.find(a => estagios.get(a)!.size !== 3);
    if (semConteudo) recusar(`${semConteudo}: conflito que não é de conteúdo (apagado, renomeado ou criado dos dois lados)`, conflitos);
    for (const arquivo of conflitos) {
      const bytes = lerArquivoDaWorktree(wt, arquivo);
      if (bytes === null) recusar(`${arquivo}: o conflito não está num arquivo comum (link simbólico ou outro tipo)`, conflitos);
      // B3 da rodada 1: binário ou fora de UTF-8 não tem a regra do núcleo; ler como texto e gravar trocaria os bytes.
      const texto = textoDe(bytes!);
      if (texto === null) recusar(`${arquivo}: conflito em arquivo que não é texto UTF-8 (binário): o núcleo não escolhe um dos lados`, conflitos);
      const resolvido = resolverConflitosAditivos(texto!);
      if (!resolvido.ok) recusar(`${arquivo}: ${resolvido.recusa}`, conflitos);
      else if (resolvido.conflitos === 0) recusar(`${arquivo}: o git marcou conflito sem marcador de texto`, conflitos);
      else gravarArquivoDaWorktree(wt, arquivo, resolvido.texto);
    }
    // D5: a entrada da thread em "Não publicado", com ou sem conflito no CHANGELOG.
    const atualBytes = lerArquivoDaWorktree(wt, ARQUIVO_DO_CHANGELOG);
    if (atualBytes !== null) {
      const atual = textoDe(atualBytes);
      if (atual === null) recusar('o CHANGELOG depois do merge não é texto UTF-8', conflitos);
      const ancestral = git(carregado.raiz, ['merge-base', antes, base]);
      if (!ancestral.ok) throw lacuna('o ancestral comum da branch e da base não se leu');
      const noAncestral = blobEm(carregado.raiz, ancestral.stdout.trim(), ARQUIVO_DO_CHANGELOG) ?? '';
      const naThread = blobEm(carregado.raiz, antes, ARQUIVO_DO_CHANGELOG) ?? '';
      const daBase = blobEm(carregado.raiz, base, ARQUIVO_DO_CHANGELOG) ?? '';
      const pos = posicionarEntradas(atual!, entradasDaThread(noAncestral, naThread), daBase);
      if (pos.perdidas) recusar(`${pos.perdidas} entrada(s) da thread sumiram do CHANGELOG no merge`, conflitos);
      // A3 da rodada 1: a linha antiga que a própria thread corrigiu desde o ancestral comum não é perda da base.
      const perdidas = linhasDaBasePerdidas(daBase, pos.texto, linhasRemovidas(noAncestral, naThread));
      if (perdidas.length) recusar(`${perdidas.length} linha(s) do CHANGELOG da base sumiriam no merge`, conflitos);
      if (pos.texto !== atual) gravarArquivoDaWorktree(wt, ARQUIVO_DO_CHANGELOG, pos.texto);
    }
    const aAdicionar = [...new Set([...conflitos, ...(atualBytes !== null ? [ARQUIVO_DO_CHANGELOG] : [])])];
    if (aAdicionar.length) {
      const a = git(wt, ['add', '--', ...aAdicionar]);
      if (!a.ok) throw new RecusaDaEntrega('noctum.entrega.git-falhou', `o git add da resolução falhou: ${primeira(a.stderr)}`);
    }
    const c = git(wt, ['commit', '-q', '--no-edit']);
    if (!c.ok) throw new RecusaDaEntrega('noctum.entrega.git-falhou', `o commit do merge falhou: ${primeira(c.stderr)}`);
    return conflitos;
  } catch (e) {
    // A recusa já abortou e gravou a base; o resto aborta aqui, sem marcar a base como recusada.
    if (!(e instanceof RecusaDaEntrega && e.motivo === 'noctum.entrega.conflito-nao-aditivo')) abortar();
    throw e;
  }
}

/** O verify da fonte, na fila pesada e sob a condução da thread. */
function verificarAFonte(carregado: ManifestoCarregado, arco: string, threadId: string, opcoes: OpcoesDaEntrega): { ok: boolean } {
  const conducao: ConducaoDoVerify = { canal: canalDoProcesso(), correlacao: `noctum:${arco}`, filaPesada: { esperarMs: opcoes.esperarMs } };
  return (opcoes.verificar ?? ((k, id, c) => verificar(k, id, { conducao: c })))(carregado, threadId, conducao);
}

/**
 * R4-B1 da rodada 4: o título e o corpo do PR que o arco abre ficam públicos na forja. O corpo é o `pr-body.md` da thread,
 * fora do git e escrito pelas sessões, então a varredura da história não o lê: o padrão de segredo nele bloqueia, com o nome
 * do padrão e a linha (nunca o trecho), e o texto que não chegou à conferência não abre PR.
 */
function conferirTextoDoPr(pr: { titulo: string; corpo: string } | undefined): void {
  if (!pr) throw new RecusaDaEntrega('noctum.entrega.nao-provada', 'o título e o corpo do PR não chegaram à conferência: o arco não abre PR sem lê-los');
  const achados = [...procurarSegredos(pr.titulo).map(a => `${a.nome} no título`),
    ...procurarSegredos(pr.corpo).map(a => `${a.nome} na linha ${a.linha} do corpo`)];
  if (achados.length) {
    throw new RecusaDaEntrega('noctum.entrega.segredo', `padrão de segredo no PR que o arco abriria (o pr-body.md da thread): ${achados.join('; ')}`);
  }
}

/**
 * A conferência da N1 de um efeito, na forma que o `publicarEntrega` recebe; guarda o motivo da recusa do envelope e marca
 * o rastro quando a conferência passa (o efeito vem logo depois dela).
 */
function conferirParaPublicar(raiz: string, arco: string, estado: EstadoDoArco, destino: Destino, branch: string, trabalho: string,
  fonte: string | null, relogio: (() => string) | undefined, rastro: Rastro) {
  const recusado: { motivo: MotivoDoPasso | null } = { motivo: null };
  const conferir = (efeito: 'push' | 'pr', pr?: { titulo: string; corpo: string }) => {
    try {
      // R2-S2 da rodada 2: o push leva a fonte que as provas viram; a branch que andou depois delas espera o passo seguinte.
      if (efeito === 'push') {
        const ponta = git(raiz, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]).stdout.trim();
        if (!fonte || ponta !== fonte) {
          throw new RecusaDaEntrega('noctum.entrega.fonte-mudou', `a branch ${branch} está em ${curto(ponta)}, e as provas são da fonte ${curto(fonte)}`);
        }
      }
      if (efeito === 'pr') conferirTextoDoPr(pr);
      // R2-B1 da rodada 2: a supervisão não isolou o trabalho nem parou o arco desde a leitura da fila.
      conferirSupervisao(raiz, arco, [trabalho]);
      conferirAntesDoEfeito(raiz, { arco, envelopeSha256: estado.envelopeSha256 ?? '', acao: efeito, repositorio: destino.repositorio,
        branch: efeito === 'push' ? branch : destino.base }, relogio?.());
      rastro.efeito = true;
      return null;
    } catch (e) {
      if (e instanceof RecusaDaEntrega) {
        recusado.motivo = e.motivo;
        return { recusa: e.message, correcao: e.motivo === 'noctum.entrega.segredo'
          ? 'tire o padrão de segredo do pr-body.md da thread; o passo seguinte confere de novo' : 'o passo seguinte relê as provas e a supervisão' };
      }
      if (!(e instanceof RecusaDoArco)) throw e;
      recusado.motivo = e.motivo;
      return { recusa: e.message, correcao: 'o efeito fica para um envelope vigente que o autorize' };
    }
  };
  return { conferir, recusado };
}

function publicar(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, trabalho: TrabalhoNaFila, lido: Lido,
  opcoes: OpcoesDaEntrega, remoto: string, rastro: Rastro): ResultadoDaEntrega {
  const ids = { trabalho: trabalho.id, thread: lido.t.id };
  const envelope = conferirParaPublicar(carregado.raiz, arco, estado, lido.destino!, branchDaWorktree(lido.t), trabalho.id,
    lido.entrada.provas?.fonte ?? null, opcoes.relogio, rastro);
  const r = publicarEntrega(carregado, lido.t.id, { remoto, forja: opcoes.forja, executorGh: opcoes.executorGh, antesDoEfeito: envelope.conferir,
    doArco: arco });
  const ate = depoisDe(opcoes.quando ?? new Date().toISOString(), ESPERA_DO_CI_MS);
  if (r.acao === 'publicou') return { acao: 'publicou', ...ids, pr: r.pr?.numero ?? null, head: r.head };
  if (r.acao === 'ja-publicada') return { acao: 'aguardar', ...ids, motivo: 'noctum.entrega.ci-pendente', detalhe: r.detalhe, ate };
  // A recusa do envelope sai com o motivo dele (revogado, expirado, fora do destino); a da supervisão e a da fonte que
  // andou, com o da entrega; a do publicar, com o dele.
  const motivo: MotivoDoPasso = envelope.recusado.motivo ?? (`publicar.${r.motivo ?? 'recusada'}` as const);
  const detalhe = `${r.detalhe}${r.correcao ? ` (${r.correcao})` : ''}`;
  if (motivo === 'noctum.entrega.fonte-mudou' || (RECUSAS_QUE_ESPERAM as readonly string[]).includes(motivo)) {
    return { acao: 'aguardar', ...ids, motivo, detalhe, ate };
  }
  return { acao: 'bloqueado', ...ids, motivo, detalhe, outros: [] };
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

/**
 * O CHECK numa sessão nova, pela reserva de revisão do arco. Tudo o que decide sai sob a trava de despacho (A10 da rodada
 * 1): o arco relido do disco, a contagem de revisões do trabalho e o relógio de agora (B2: a espera pela vez pode passar do
 * fim da janela). O rastro marca o efeito quando o despacho chega ao núcleo, e volta a falso quando ele recusa antes de lançar.
 */
function despacharRevisao(carregado: ManifestoCarregado, arco: string, trabalho: TrabalhoNaFila, t: Thread, revisoesNaDecisao: number,
  opcoes: OpcoesDaEntrega, rastro: Rastro): ResultadoDaEntrega {
  const { raiz } = carregado;
  const ids = { trabalho: trabalho.id, thread: t.id };
  // R2-A4 da rodada 2: o relógio da hora da reserva, e não o instante de quem chamou o passo.
  const agora = (): string => opcoes.relogio?.() ?? new Date().toISOString();
  const aguardar = (motivo: MotivoDoPasso, detalhe: string): ResultadoDaEntrega =>
    ({ acao: 'aguardar', ...ids, motivo, detalhe, ate: depoisDe(agora(), ESPERA_DO_CI_MS) });
  const bloquear = (motivo: MotivoDoPasso, detalhe: string): ResultadoDaEntrega => ({ acao: 'bloqueado', ...ids, motivo, detalhe, outros: [] });
  if (!kernelDisponivel()) return aguardar('noctum.entrega.sem-trava-do-kernel', 'o arco só despacha com /usr/bin/flock');
  const fd = vezDeDespachar(raiz, opcoes.esperarMs ?? 30_000);
  if (fd === null) return aguardar('noctum.entrega.despacho-em-curso', 'outro passo de arco desta máquina segura a vez de despachar');
  try {
    const quando = agora();
    let estado: EstadoDoArco | null;
    try { estado = lerArco(raiz, arco, quando); }
    catch (e) {
      if (!(e instanceof RecusaDoArco)) throw e;
      return bloquear(e.motivo, e.message);
    }
    const conteudo = estado?.conteudo;
    if (!estado || !conteudo || !envelopeComTrabalhos(conteudo)) return bloquear('noctum.entrega.fora-do-envelope', 'o arco relido sob a trava não tem envelope v2');
    if (revisoesDoTrabalho(estado, trabalho.id) !== revisoesNaDecisao) {
      return aguardar('noctum.entrega.revisao-em-curso', 'outro passo despachou o CHECK deste trabalho enquanto este esperava a vez');
    }
    // R2-B1 da rodada 2: sob a trava, a supervisão relida: o arco parado e o trabalho isolado não despacham CHECK, e a
    // conta que o arco tirou não entra na escolha.
    let sup: EstadoDaSupervisao;
    try { sup = supervisaoDoArco(raiz, arco); }
    catch (e) {
      if (!(e instanceof RecusaDaEntrega)) throw e;
      return aguardar(e.motivo, e.message);
    }
    if (sup.parada) return bloquear('noctum.entrega.arco-parado', `a supervisão parou o arco (${sup.parada.motivo}): ${sup.parada.detalhe}`);
    const isolado = sup.isolados.get(trabalho.id);
    if (isolado) return bloquear('noctum.entrega.isolado', `o trabalho ${trabalho.id} foi isolado pela supervisão (${isolado.motivo}): ${isolado.detalhe}`);
    const fase: Fase = 'CHECK';
    const runtime = resolverDespacho(carregado.manifesto, {}, configDoBloco(lerSetup(raiz), t.modo, fase)).runtime;
    const capacidade = fatosDeCapacidade(carregado, { quando, consultar: opcoes.consultarSessoes });
    const perfis = (opcoes.perfis ?? (() => perfisDisponiveis(raiz, Date.parse(quando))))().filter(p => !contaForaAgora(sup, p.id, quando));
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
      return bloquear(e.motivo, e.message);
    }
    const devolver = (motivo: MotivoDoPasso, detalhe: string, bloqueia: boolean): ResultadoDaEntrega => {
      concluirDespacho(raiz, arco, reserva, { motivo });
      rastro.efeito = false;
      return bloqueia ? bloquear(motivo, detalhe) : aguardar(motivo, detalhe);
    };
    const pedido = pedidoDaThread(raiz, t);
    if (!pedido) return devolver('noctum.entrega.pedido-ausente', `a thread ${t.id} não guardou o pedido`, true);
    const antes = lerLedger(dirThread(raiz, t.id)).length;
    rastro.efeito = true;
    // RM-058, integração (D5): a sessão da revisão recebe a linha do arco no pedido, como a do passo da N2.
    const r = (opcoes.despachar ?? rodarFase)(carregado, t.id, { fase, prompt: pedidoDoArco(pedido.texto, arco), perfil: conta,
      canal: canalDoProcesso(), correlacao: `noctum:${arco}`, baselinePeloDespacho: false });
    if (r.motivo === 'baseline.pendente') return devolver('noctum.entrega.baseline-ausente', 'o despacho do CHECK pediu a baseline', true);
    if (r.bloqueado) return devolver(r.motivo ?? 'noctum.entrega.despacho-recusado', r.erro ?? 'o núcleo recusou o despacho do CHECK', false);
    if (r.sessionId || r.idempotente) {
      concluirDespacho(raiz, arco, reserva, { thread: t.id, sessionId: r.sessionId, idempotente: r.idempotente === true });
      return { acao: 'revisao-pedida', ...ids, sessionId: r.sessionId, reserva, conta, runtime };
    }
    // Como na N2: sem id e com motivo de antes do lançamento, a sessão volta ao orçamento; o resto fica pendente para a N4.
    const novos = lerLedger(dirThread(raiz, t.id)).slice(antes);
    const idDaFalha = novos.filter(e => e.tipo === TIPOS_DE_EVENTO.despachoFalhou && typeof e.sessionId === 'string').at(-1)?.sessionId ?? null;
    if (!idDaFalha && r.motivo && r.motivo !== 'runtime.unavailable') return devolver(r.motivo, r.erro ?? 'o runtime recusou o despacho', false);
    return aguardar('noctum.entrega.despacho-incerto', `${r.erro ?? 'o núcleo não abriu sessão'}; a reserva fica pendente para a N4 reconciliar`);
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
  /**
   * O candidato que a N3 recebeu: a fonte, a base e o sha256 das provas que a vez tomou, e o repositório do destino dela
   * (S5 da rodada 1: o destino de outro repositório recusa).
   */
  esperado?: { fonte: string; base: string; provas: string; repositorio?: string };
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
    if (!git(raiz, ['branch', ramo, merge]).ok) throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', 'a branch temporária dos docs não nasceu');
    sincronizarDocs(tmp, { baseBranch: ramo, itens, escrever: true });
    const estado = git(tmp, ['status', '--porcelain', '-z']);
    if (!estado.ok) throw lacuna(`o estado da worktree dos docs derivados não se leu: ${primeira(estado.stderr)}`);
    const mudados = estado.stdout.split('\0').filter(Boolean).map(l => l.slice(3));
    if (!mudados.length) return { commit: null, itens };
    if (!git(tmp, ['add', '--', ...mudados]).ok) throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', 'o git add dos docs derivados falhou');
    const c = git(tmp, ['commit', '-q', '-m', `docs(${threadId}): ${itens.join(', ')} com o estado depois do merge (arco ${arco})`]);
    if (!c.ok) throw new RecusaDaEntrega('noctum.entrega.docs-vermelhos', `o commit dos docs derivados falhou: ${primeira(c.stderr)}`);
    const commit = git(tmp, ['rev-parse', 'HEAD']).stdout.trim();
    if (!SHA.test(commit)) throw lacuna('o commit dos docs derivados não se leu');
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
 * local e pela remota, e todas as provas; o merge tem a árvore da fonte e os pais base e fonte; a conferência da N1 com
 * `merge` vem depois do merge e dos docs derivados, imediatamente antes do push; o push vai amarrado à ponta conferida, então
 * a base que andou recusa; o `ls-remote` prova. Lança a recusa tipada.
 */
export function integrarNoDestino(carregado: ManifestoCarregado, arco: string, threadId: string, opcoes: OpcoesDaIntegracao = {}): IntegracaoDaEntrega {
  const { raiz } = carregado;
  // B2 da rodada 1 e R2-A4 da rodada 2: cada leitura do arco e cada conferência usa o relógio da hora dela; o instante de
  // quem chamou o passo (`quando`) nunca vale aqui.
  const relogio = (): string | undefined => opcoes.relogio?.();
  const remoto = opcoes.remoto ?? 'origin';
  const estado = lerArco(raiz, arco, relogio());
  if (!estado?.conteudo || !envelopeComTrabalhos(estado.conteudo)) throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', 'o arco não tem envelope v2 vigente');
  if (estado.conteudo.contrato !== CONTRATO_ENVELOPE_V2 && !opcoes.esperado) {
    throw new RecusaDaEntrega('noctum.entrega.exige-vez-da-n3', 'fora da v2, a integração é da vez entre máquinas (N3)');
  }
  // S5 da rodada 1 e R2-S3 da rodada 2: só integra a thread que é trabalho do envelope, pela regra da fila (a thread
  // fixada, ou o item com o sha256 do pedido).
  const daThread = lerThread(raiz, threadId);
  const trabalhosDoEnvelope = trabalhosDaThread(estado.conteudo, daThread).map(w => w.id);
  if (!trabalhosDoEnvelope.length) {
    throw new RecusaDaEntrega('noctum.entrega.fora-do-envelope', `a thread ${threadId} (item ${daThread.roadmap ?? 'nenhum'}) não é trabalho do envelope do arco ${arco}`);
  }
  // R2-B1 da rodada 2: o trabalho que a supervisão isolou, ou o arco que ela parou, não integra, nem pela vez da N3.
  conferirSupervisao(raiz, arco, trabalhosDoEnvelope);
  const d = destinoDoTrabalho(carregado, estado.conteudo.destinos, remoto, opcoes.forja);
  if (!d.ok) throw new RecusaDaEntrega(d.motivo, d.detalhe);
  if (!d.podeMerge) throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', 'o envelope não autoriza merge neste destino');
  const destino = d.destino;
  if (opcoes.esperado?.repositorio !== undefined && opcoes.esperado.repositorio.toLowerCase() !== destino.repositorio.toLowerCase()) {
    throw new RecusaDaEntrega('noctum.entrega.fora-do-destino', `o candidato é do repositório ${opcoes.esperado.repositorio}, e o destino é ${destino.repositorio}`);
  }
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
    const lida = git(raiz, ['ls-remote', '--', remoto, `refs/heads/${branch}`]);
    if (!lida.ok) throw new RecusaDaEntrega('noctum.entrega.base-sem-leitura', `a branch ${branch} não se leu no remoto: ${primeira(lida.stderr)}`);
    const remota = lida.stdout.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] === `refs/heads/${branch}`)?.[0] ?? null;
    if (remota !== fonte) throw new RecusaDaEntrega('noctum.entrega.fonte-mudou', `a branch ${branch} no remoto está em ${curto(remota)}, e a fonte provada é ${curto(fonte)}`);
    const passos: string[] = [`git ls-remote ${remoto} refs/heads/${destino.base}`, `git ls-remote ${remoto} refs/heads/${branch}`];
    const envelopeSha256 = estado.envelopeSha256 ?? '';
    const assunto = `ship(${threadId}): merge de ${branch} em ${destino.base}`;
    const corpo = [`thread: ${t.id} (${t.slug})`, `modo: ${tagDoModo(t.modo)}`, `arco: ${arco} (envelope ${envelopeSha256.slice(0, 12)})`,
      `provas: ${provas.sha256}`, `verificado em: ${fonte}`].join('\n');
    const merge = git(raiz, ['commit-tree', `${fonte}^{tree}`, '-p', ponta.sha, '-p', fonte, '-m', assunto, '-m', corpo]);
    const mergeSha = merge.stdout.trim();
    if (!merge.ok || !SHA.test(mergeSha)) throw new RecusaDaEntrega('noctum.entrega.nao-provada', `o commit do merge falhou: ${primeira(merge.stderr)}`);
    passos.push(`git commit-tree ${curto(fonte)}^{tree} -p ${curto(ponta.sha)} -p ${curto(fonte)}`);
    const docs = docsDerivados(raiz, threadId, mergeSha, arco);
    if (docs.commit) passos.push(`ork docs sincronizar --escrever --so ${docs.itens.join(',')} (commit ${curto(docs.commit)})`);
    const alvo = docs.commit ?? mergeSha;
    // B2 da rodada 1: a supervisão e a N1 imediatamente antes do push, depois do merge e dos docs derivados, com o relógio
    // desta hora.
    conferirSupervisao(raiz, arco, [...trabalhosDoEnvelope]);
    conferirAntesDoEfeito(raiz, { arco, envelopeSha256, acao: 'merge', repositorio: destino.repositorio, branch: destino.base }, relogio());
    // S3 da rodada 1: o lease amarra o push à ponta conferida. O alvo descende dela (o merge a tem como primeiro pai), então o
    // push é sempre de avanço; a base que andou, ou que foi forçada para trás, recusa.
    const lease = `--force-with-lease=refs/heads/${destino.base}:${ponta.sha}`;
    const push = git(raiz, ['push', lease, '--', remoto, `${alvo}:refs/heads/${destino.base}`], 180000);
    passos.push(`git push --force-with-lease=refs/heads/${destino.base}:${curto(ponta.sha)} -- ${remoto} ${curto(alvo)}:refs/heads/${destino.base}`);
    const depois = pontaDaBaseNoRemoto(raiz, remoto, destino.base);
    passos.push(`git ls-remote ${remoto} refs/heads/${destino.base}`);
    const incerto = (detalhe: string): never => {
      registrar(dirThread(raiz, threadId), threadId, EVENTO_DO_PUSH_INCERTO, { arco, base: destino.base, alvo, mergeSha, fonte, remoto,
        lido: depois.sha, provas: provas.sha256, falhasRegistradas: provas.falhasRegistradas,
        erro: primeira(push.stderr || depois.erro || '') });
      throw new RecusaDaEntrega('noctum.entrega.push-incerto', detalhe);
    };
    if (depois.sha !== alvo) {
      // O push que o git deu por feito sem a ponta no remoto, ou o remoto que não se leu: ninguém sabe se chegou.
      if (push.ok || !depois.sha) incerto('o push para a base não se provou; o passo seguinte relê o remoto antes de qualquer coisa');
      if (depois.sha !== ponta.sha) {
        throw new RecusaDaEntrega('noctum.entrega.base-mudou', `a base andou antes do push (${curto(depois.sha)}): o candidato se refaz sobre a base nova`);
      }
      // R2-A3 da rodada 2: só a recusa do remoto bloqueia sem repetir; a falha do transporte (a rede, o endereço, o prazo)
      // espera e tenta de novo na cadência, com as provas e a conferência refeitas.
      const linhaDaRecusa = recusaDoRemoto(push.stderr);
      if (!linhaDaRecusa) {
        throw new RecusaDaEntrega('noctum.entrega.git-falhou',
          `o push para ${destino.base} falhou sem recusa do remoto, com a base parada em ${curto(ponta.sha)}: ${primeira(push.stderr) || `código ${push.code}`}`);
      }
      // A4 da rodada 1: a base parada e o push recusado (a proteção da branch, um gancho do remoto): repetir não muda nada.
      registrar(dirThread(raiz, threadId), threadId, EVENTO_DO_PUSH_RECUSADO, { arco, base: ponta.sha, fonte, alvo, remoto, erro: linhaDaRecusa });
      throw new RecusaDaEntrega('noctum.entrega.push-recusado', `o remoto recusou o push para ${destino.base} com a base parada em ${curto(ponta.sha)}: ${linhaDaRecusa}`);
    }
    if (!git(raiz, ['merge-base', '--is-ancestor', fonte, alvo]).ok) incerto('a ponta da base não mostrou a fonte depois do push');
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
 * registro sai com o commit que a incorporou e a ponta provada pelo `ls-remote`, sem integrar de novo. O push incerto da
 * mesma fonte, quando há, empresta ao registro as provas e as falhas que ele guardou (S6 da rodada 1).
 */
function reconciliarEntrega(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, threadId: string, remoto: string,
  destino: Destino, ponta: string): { mergeSha: string; pontaDaBase: string } {
  const { raiz } = carregado;
  const t = lerThread(raiz, threadId);
  const branch = branchDaWorktree(t);
  const ref = git(raiz, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
  const fonte = ref.stdout.trim();
  if (!ref.ok || !SHA.test(fonte)) throw lacuna(`a ponta da branch ${branch} não se leu`);
  const mergeSha = commitQueIncorporou(raiz, fonte, ponta);
  if (!mergeSha) throw new RecusaDaEntrega('noctum.entrega.nao-provada', 'o commit que incorporou a fonte na base não se achou');
  const incerto = lerLedger(dirThread(raiz, threadId)).filter(e => e.tipo === EVENTO_DO_PUSH_INCERTO && e.fonte === fonte).at(-1) ?? null;
  // R2-S4 da rodada 2 e R3-S2 da rodada 3: quem incorporou se lê no commit que incorporou. O merge do arco leva
  // `arco: <arco> (envelope ...)` no corpo; sem isso, foi outro caminho (o dono, a batida da RM-063, um merge à mão), mesmo
  // com um push incerto do arco que não chegou.
  const corpoDoMerge = git(raiz, ['log', '-1', '--format=%B', mergeSha]);
  const doArco = corpoDoMerge.ok && corpoDoMerge.stdout.includes(`\narco: ${arco} (envelope `);
  const envelope = `envelope ${(estado.envelopeSha256 ?? '').slice(0, 12)} do arco ${arco} (#Noctum)`;
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: branch, para: destino.base, shaDe: fonte, mergeSha, pontaDaBase: ponta, jaIncorporado: true, remoto, shaRemoto: ponta,
    pushVerificado: true, fonteDaProva: `git merge-base --is-ancestor ${fonte} ${ponta} (ls-remote ${remoto} refs/heads/${destino.base})`,
    autorizadoPor: doArco ? `${envelope}, reconciliado` : `merge ${curto(mergeSha)} de fora do arco, registrado pelo ${envelope}`,
    tipoDeAutorizacao: 'noctum', modo: t.modo, tag: tagDoModo(t.modo),
    evidencia: { arco, reconciliado: true, incorporadaPor: doArco ? 'arco' : 'outro-caminho',
      pushIncerto: incerto ? { eventId: incerto.eventId, alvo: incerto.alvo, provas: incerto.provas ?? null } : null,
      falhasRegistradas: Array.isArray(incerto?.falhasRegistradas) ? incerto!.falhasRegistradas : [] },
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
 * revalidados pela vez, confere que o repositório, a base, a fonte e as provas são as do candidato e devolve o merge
 * (`mergeSha`), que a N3 confere no remoto. Os docs derivados, quando há, vão por cima dele no mesmo push, e a ponta da base
 * não é o merge (A-R3D-1 da revisão da ork-rm058n3).
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
      esperado: { fonte: c.candidato.fonte, base: c.candidato.base, provas: c.candidato.provas, repositorio: c.destino.repositorio } });
    return { merge: r.mergeSha };
  };
}
