/**
 * RM-058, fatia N2 (D11 da ork-rm058n2): o passo do arco.
 *
 * Um despacho por chamada, sempre pelo núcleo. Sob a trava do kernel de despacho da raiz de estado (um despachante por
 * vez, entre todos os arcos desta raiz), o passo relê o arco e os fatos, monta a fila, escolhe o primeiro candidato que
 * a capacidade admite, reserva o despacho com a conferência do envelope sob o lock do arco (`reservarDespacho`, que é a
 * conferência imediatamente antes do efeito), abre a thread quando o trabalho é novo (`novaThread`) e despacha por
 * `rodarFase`, que toma o lease de condução e é idempotente para a mesma fase e o mesmo prompt. O desfecho volta ao log do
 * arco (`concluirDespacho`): a recusa do núcleo devolve a sessão ao orçamento.
 *
 * A baseline que o bloco com GO pede nunca roda entre a reserva e o lançamento (A1 do CHECK da ork-rm058n2): o despacho
 * recusa com `baseline.pendente`, a reserva volta, a trava de despacho é solta e só então a baseline é gravada; o passo
 * seguinte confere o envelope de novo e despacha. Desde a integração (D6 da ork-rm058integra), vale em qualquer runtime,
 * não só no codex: a entrega da N5 cobra a baseline de toda thread do arco. RM-037 (CHECK 3 da ork-rm037defeit2): o preparo
 * de `worktree.dependencias` (até 10 min) também nunca roda ali: a thread nova nasce com ele pendente (`adiarDependencias`),
 * e a baseline o roda antes dos comandos dela, fora da trava e na fila pesada. A falha de um candidato antes de lançar (abrir a thread, ler o
 * pedido) devolve a reserva e o passo segue para o próximo (A4). Do núcleo, só a recusa de antes do lançamento devolve a
 * reserva: a recusa dos portões, e a da conta, do limite de uso ou do impedimento do dono quando nenhuma sessão foi dita.
 * Quando o runtime pode ter aberto a sessão (a falha seca dele, o id dito antes da falha, o núcleo que voltou sem sessão
 * nem recusa, ou a exceção de dentro do `rodarFase`), a reserva fica pendente e contada até a N4 reconciliar (B1 da rodada
 * 2). A recusa tipada do arco, inclusive a do log adulterado, volta como resultado.
 *
 * A revogação nunca espera um despacho: ela usa o lock do arco, e a trava de despacho é outra. Quem chama decide quando
 * chamar de novo (o vigia é da N4); a decisão da fila diz até quando esperar. Nada aqui liga o modo.
 *
 * RM-058, fatia N4 (D8, D14 e D21 da ork-rm058n4): o passo aceita as decisões da supervisão, que vão à fila (isolados e
 * retomadas), e os alvos de runtime da fase, em ordem: o primeiro com conta do envelope disponível e com folga leva o
 * despacho, com o modelo e o esforço dele. Sem essas entradas, o passo é o da N2.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { vagaDoDespacho } from './board';
import { canalDoProcesso, ErroDeConducao } from './conducao';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { ErroDaFilaPesada, kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { ManifestoCarregado } from './manifest';
import { ConsumoMedidoDoDespacho, concluirDespacho, reservarDespacho } from './noctum-arco';
import { admitir, Admissao, escolherConta, fatosDeCapacidade, LeituraDeSessoes } from './noctum-capacidade';
import { envelopeComTrabalhos, envelopeMultimaquina, RecusaDoArco } from './noctum-envelope';
import { medidoParaReserva, medirArco, MedicaoDoArco, precisaMedir } from './noctum-medicao';
import { CoordenacaoDaFila, DecisaoDaFila, DecisoesDaSupervisao, FatosDaFila, fatosDaFila, FilaDoArco, LeitorDeReservas, montarFila,
  MOTIVO_DO_ERRO_NO_DESPACHO } from './noctum-fila';
import { pedidoDoArco } from './noctum-guarda';
import { OcupanteDaEspera } from './noctum-supervisao';
import { OpcoesRun, resolverDespacho, ResultadoRun, rodarFase } from './phase';
import { lerPerfis, perfilDisponivel } from './runtime-profiles';
import { configDoBloco, lerSetup } from './setup';
import { blocoDaThread, dirThread, lerThread, novaThread, OpcoesNovaThread, pedidoDaThread } from './thread';
import { Fase, Thread } from './types';
import { ConducaoDoVerify, gravarBaseline } from './verify';

/** Quanto o passo espera a vez de despachar antes de devolver `aguardar`: o despacho de outro arco leva segundos. */
export const ESPERA_DA_VEZ_DE_DESPACHAR_MS = 30_000;
const PAUSA_MS = 200;

/** RM-058 N4 (D14): um runtime em que a fase pode sair, com o modelo e o esforço dele quando não é o do bloco. */
export interface AlvoDoPasso { runtime: string; model?: string; effort?: string }

export interface OpcoesDoPasso {
  quando?: string;
  maquina?: string;
  esperarVezMs?: number;
  /** Dependências dos testes; em produção, `rodarFase`, `novaThread`, as reservas locais, as contas e o store de perfis. */
  despachar?: (carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesRun) => ResultadoRun;
  abrirThread?: (carregado: ManifestoCarregado, opcoes: OpcoesNovaThread) => Thread;
  lerReservas?: LeitorDeReservas;
  consultarSessoes?: () => LeituraDeSessoes;
  perfis?: () => Array<{ id: string; runtime: string }>;
  /** A baseline que o despacho pediu, gravada fora da trava de despacho; em produção, `gravarBaseline`. */
  gravarBaseline?: (carregado: ManifestoCarregado, threadId: string, conducao: ConducaoDoVerify) => void;
  /** A reserva no log do arco; em produção, `reservarDespacho`. */
  reservar?: typeof reservarDespacho;
  /**
   * RM-058 N3: o que o ramo de coordenação diz a esta máquina, dado só pelo passo da máquina (`noctum-maquinas.ts`), com a
   * reserva do despacho que toma a vaga global (S5 da revisão: ela vence a `reservar` daqui). Sem isso, o arco entre
   * máquinas (envelope `v3`) não despacha daqui.
   */
  coordenacao?: CoordenacaoDaFila & { reservar: typeof reservarDespacho };
  /** RM-058 N4: as decisões da supervisão do arco (isolados e retomadas), repassadas à fila. */
  supervisao?: DecisoesDaSupervisao;
  /** RM-058 N4 (D14): os runtimes da fase, em ordem; sem eles, só o do bloco, como na N2. */
  alvos?: (fase: Fase, runtimeDoBloco: string, modo: Thread['modo']) => AlvoDoPasso[];
  /**
   * RM-058 N6 (D5 da ork-rm058n6): a medição do consumo do arco, uma vez por passo, só quando algum teto não está em
   * `sessoes`; em produção, `medirArco` sobre o disco.
   */
  medir?: (raiz: string, estado: NonNullable<FatosDaFila['estado']>, quando: string) => MedicaoDoArco;
}

export type ResultadoDoPasso =
  | { acao: 'despachou'; trabalho: string; thread: string; fase: Fase; runtime: string; conta: string; sessionId: string | null;
    idempotente: boolean; reserva: number; fila: FilaDoArco }
  | { acao: 'recusado'; trabalho: string; thread: string | null; fase: Fase; motivo: string; detalhe: string; reserva: number | null;
    fila: FilaDoArco }
  | { acao: 'aguardar'; ate: string; motivo: string; detalhe: string; fila: FilaDoArco | null;
    ocupantes?: OcupanteDaEspera[] }
  | { acao: 'encerrar'; motivo: 'fila-vazia' | 'arco-encerrado'; fila: FilaDoArco };

const pausa = new Int32Array(new SharedArrayBuffer(4));
const dormir = (ms: number) => { if (ms > 0) Atomics.wait(pausa, 0, 0, Math.ceil(ms)); };

/** A trava de despacho da raiz de estado: o descritor, ou `null` quando outro passo não a soltou no prazo. */
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
    dormir(Math.min(PAUSA_MS, prazo - Date.now()));
  }
}

/** O runtime que o `phase run` vai usar para a fase desta thread: o do bloco no setup, senão o do manifesto. */
function runtimeDaFase(carregado: ManifestoCarregado, modo: Thread['modo'], fase: Fase): string {
  return resolverDespacho(carregado.manifesto, {}, configDoBloco(lerSetup(carregado.raiz), modo, fase)).runtime;
}

/** Os perfis do store que podem receber despacho agora; store ilegível é nenhum perfil (a fila espera, não chuta). */
function perfisDisponiveis(raiz: string, agoraMs: number): Array<{ id: string; runtime: string }> {
  try { return lerPerfis(raiz).perfis.filter(p => perfilDisponivel(p, agoraMs)).map(p => ({ id: p.id, runtime: p.runtime })); }
  catch { return []; }
}

const aguardar = (decisao: Extract<DecisaoDaFila, { acao: 'aguardar' }>, fila: FilaDoArco): ResultadoDoPasso =>
  ({ acao: 'aguardar', ate: decisao.ate, motivo: decisao.motivo, detalhe: fila.lacunas.join('; '), fila });

/** O motivo que sobra quando nenhum candidato coube: a máquina cheia vale para todos, e o resto é do último tentado. */
const MOTIVOS_DE_MAQUINA: readonly string[] = ['capacidade.fonte-indisponivel', 'capacidade.projeto', 'capacidade.maquina'];

/** As recusas da reserva que são só deste candidato (A4): a janela, a revogação, o hash e o log valem para todos. */
const RECUSAS_DO_CANDIDATO: readonly string[] = ['noctum.despacho.fora-do-envelope', 'noctum.orcamento.esgotado'];

const mensagem = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Os eventos do ledger da thread, ou `null` quando ele não se lê. */
function eventosDaThread(raiz: string, threadId: string): ReturnType<typeof lerLedger> | null {
  try { return lerLedger(dirThread(raiz, threadId)); } catch { return null; }
}

/**
 * RM-058, integração (D6 da ork-rm058integra): a baseline do arco, em qualquer runtime. Fora do arco, o despacho só a
 * exige no codex (`baselineDoDespachoNecessaria`, em `phase.ts`, que não muda); no arco, a entrega da N5 a cobra sempre
 * (`noctum.entrega.baseline-ausente`), então o bloco que tem GO a partir da fase do despacho não sai sem ela. O ledger que
 * não se lê não prova a baseline: o despacho espera.
 */
export function baselineDoArcoPendente(raiz: string, thread: Thread, fase: Fase): boolean {
  const bloco = blocoDaThread(thread, fase);
  if (!bloco.fases.slice(bloco.fases.indexOf(fase)).includes('GO')) return false;
  const eventos = eventosDaThread(raiz, thread.id);
  return eventos === null || !eventos.some(e => e.tipo === TIPOS_DE_EVENTO.baselineGravada);
}

type Recusado = Extract<ResultadoDoPasso, { acao: 'recusado' }>;
/** O despacho que parou na baseline: a reserva já voltou, e a baseline roda depois de soltar a trava de despacho. */
interface BaselinePendente { acao: 'baseline'; trabalho: string; thread: string; fase: Fase; fila: FilaDoArco }

/**
 * RM-058, integração (N1 do CHECK 2): a baseline do arco que falhou sem ser espera (o comando que não existe na worktree nova,
 * a worktree quebrada). O passo devolve a recusa tipada deste trabalho, e a supervisão o isola com a causa.
 */
export const MOTIVO_DA_BASELINE_FALHA = 'noctum.baseline.falhou';
/** A recusa que é só deste candidato: o passo segue para o próximo. */
type RecusaDoCandidato = Recusado & { seguir: true };

/**
 * Um passo do arco: no máximo um despacho, pelo núcleo, com o envelope conferido imediatamente antes. Lança só o erro
 * que não é recusa (disco, git); toda recusa tipada volta como resultado.
 */
export function passoDoArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoPasso = {}): ResultadoDoPasso {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const cadencia = new Date(Date.parse(quando) + 60_000).toISOString();
  if (!kernelDisponivel()) {
    return { acao: 'aguardar', ate: cadencia, motivo: 'sem-trava-do-kernel', fila: null,
      detalhe: 'o arco só despacha com /usr/bin/flock: sem a trava do kernel, dois passos poderiam passar juntos dos limites' };
  }
  const fd = vezDeDespachar(raiz, opcoes.esperarVezMs ?? ESPERA_DA_VEZ_DE_DESPACHAR_MS);
  if (fd === null) {
    return { acao: 'aguardar', ate: cadencia, motivo: 'despacho-em-curso', fila: null,
      detalhe: 'outro passo de arco desta máquina segura a vez de despachar' };
  }
  let pendente: BaselinePendente | null = null;
  try {
    let fatos: FatosDaFila;
    try {
      fatos = fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, coordenacao: opcoes.coordenacao,
        supervisao: opcoes.supervisao });
    }
    catch (e) {
      // S6 do CHECK: a recusa tipada do arco (o log adulterado, por exemplo) volta como resultado, e não como exceção.
      if (!(e instanceof RecusaDoArco)) throw e;
      return { acao: 'aguardar', ate: cadencia, motivo: e.motivo, detalhe: e.message, fila: null };
    }
    // N3: o arco entre máquinas só despacha pelo passo da máquina, que confere ordem, reserva e vaga global antes.
    if (fatos.estado?.conteudo && envelopeMultimaquina(fatos.estado.conteudo) && typeof opcoes.coordenacao?.reservar !== 'function') {
      return { acao: 'aguardar', ate: cadencia, motivo: 'noctum.coordenacao.exige-passo-da-maquina', fila: null,
        detalhe: 'o envelope vigente é de várias máquinas: o despacho passa pelo passo da máquina, com a ordem, a reserva e a vaga global' };
    }
    const fila = montarFila(fatos);
    if (fila.decisao.acao === 'encerrar') return { acao: 'encerrar', motivo: fila.decisao.motivo, fila };
    if (fila.decisao.acao === 'aguardar') return aguardar(fila.decisao, fila);
    // A fila só decide despachar com o envelope v2 vigente; a guarda estreita o tipo e cobre o impossível.
    const conteudo = fatos.estado?.conteudo;
    if (!conteudo || !envelopeComTrabalhos(conteudo)) {
      return { acao: 'aguardar', ate: cadencia, motivo: 'fonte-indisponivel', detalhe: 'o arco não tem envelope v2 vigente', fila };
    }
    const capacidade = fatosDeCapacidade(carregado, { quando, consultar: opcoes.consultarSessoes });
    const perfis = (opcoes.perfis ?? (() => perfisDisponiveis(raiz, Date.parse(quando))))();
    // N6 (D5): fora da trava do arco e sob a de despacho; a reserva confere o medido de cada teto sob o lock do arco.
    const medicao = precisaMedir(conteudo) && fatos.estado
      ? (opcoes.medir ?? ((r, e, q) => medirArco(r, e, { quando: q })))(raiz, fatos.estado, quando) : null;
    let recusa: Extract<Admissao, { ok: false }> | null = null;
    let doCandidato: Recusado | null = null;
    for (const candidato of fila.candidatos) {
      const fase = candidato.fase!;
      let thread: Thread | null, runtime: string;
      try {
        thread = candidato.thread ? lerThread(raiz, candidato.thread) : null;
        runtime = runtimeDaFase(carregado, thread?.modo ?? 'auto', fase);
      } catch (e) {
        // A4 do CHECK: a thread que não se lê ou o bloco sem runtime são deste candidato; os outros seguem.
        doCandidato = { acao: 'recusado', trabalho: candidato.id, thread: candidato.thread, fase, motivo: MOTIVO_DO_ERRO_NO_DESPACHO,
          detalhe: mensagem(e), reserva: null, fila };
        continue;
      }
      // RM-058 N4 (D14): os alvos da fase, em ordem; sem eles, só o runtime do bloco, como na N2.
      const alvos: AlvoDoPasso[] = opcoes.alvos ? opcoes.alvos(fase, runtime, thread?.modo ?? 'auto') : [{ runtime }];
      const doRuntime = (r: string) => perfis.filter(p => p.runtime === r).map(p => p.id);
      // A conta com mais folga no primeiro alvo que tem uma; sem folga em nenhum, a primeira do envelope no primeiro alvo com
      // perfil, para `admitir` dizer o motivo na ordem dele (a máquina cheia antes da conta).
      let alvo: AlvoDoPasso = alvos[0] ?? { runtime }, conta: string | null = null;
      for (const a of alvos) {
        const c = escolherConta(conteudo.capacidade, capacidade, doRuntime(a.runtime));
        if (c) { alvo = a; conta = c; break; }
      }
      for (const a of conta === null ? alvos : []) {
        const c = conteudo.capacidade.porConta.find(x => doRuntime(a.runtime).includes(x.conta))?.conta;
        if (c) { alvo = a; conta = c; break; }
      }
      const vaga = vagaDoDespacho(carregado, thread?.id ?? '', quando);
      const admissao = conta === null
        ? { ok: false as const, motivo: 'capacidade.conta-nao-autorizada' as const,
          detalhe: `nenhuma conta do envelope é perfil disponível do runtime ${alvos.map(a => a.runtime).join(' ou ') || runtime}` }
        : admitir({ runtime: alvo.runtime, conta, revisao: fase === 'CHECK' }, conteudo.capacidade, capacidade, vaga);
      if (!admissao.ok) {
        recusa = admissao;
        if (MOTIVOS_DE_MAQUINA.includes(admissao.motivo)) break;
        continue;
      }
      const r = despacharCandidato(carregado, arco, fila, { trabalho: candidato.id, thread, item: candidato.item, fase, runtime: alvo.runtime,
        conta: conta!, quando, pedido: conteudo.trabalhos.find(t => t.id === candidato.id)?.pedido ?? null,
        trio: alvo.runtime === runtime ? null : alvo,
        medido: medicao ? medidoParaReserva(medicao, conteudo, conta!, alvo.runtime) : undefined }, opcoes);
      if (r.acao === 'baseline') { pendente = r; break; }
      if ('seguir' in r) {
        const { seguir: _seguir, ...recusado } = r;
        doCandidato = recusado;
        continue;
      }
      return r;
    }
    if (!pendente) {
      // Sem vaga para ninguém, espera a vaga; sem vaga por erro de candidato, diz o erro.
      if (doCandidato && !recusa) return doCandidato;
      return { acao: 'aguardar', ate: new Date(Math.min(Date.parse(quando) + 5 * 60_000, Date.parse(conteudo.janela.fim))).toISOString(),
        motivo: recusa?.motivo ?? 'capacidade', detalhe: recusa?.detalhe ?? 'nenhum candidato coube', fila,
        ocupantes: capacidade.ocupantes.map(o => ({ origem: o.origem, runtime: o.runtime, revisao: o.revisao })) };
    }
  } finally { fs.closeSync(fd); }
  return baselineForaDaTrava(carregado, arco, pendente, cadencia, opcoes);
}

/**
 * A1 do CHECK: a baseline que o despacho pediu, com a trava de despacho já solta (os outros arcos não esperam a suíte).
 * Ela espera a fila de recursos pesados como todo verify; sem a vez, ou com a thread conduzida, o passo espera a cadência.
 */
function baselineForaDaTrava(carregado: ManifestoCarregado, arco: string, p: BaselinePendente, cadencia: string,
  opcoes: OpcoesDoPasso): ResultadoDoPasso {
  const conducao: ConducaoDoVerify = { canal: canalDoProcesso(), correlacao: `noctum:${arco}` };
  try {
    (opcoes.gravarBaseline ?? ((k, t, c) => { gravarBaseline(k, t, undefined, c, 'phase.run'); }))(carregado, p.thread, conducao);
  } catch (e) {
    // N1 do CHECK 2: a falha que não é espera não derruba o passo (nem o condutor, nem o CLI): volta como a recusa deste
    // trabalho, que não passa sozinha, e a supervisão o isola; os outros trabalhos seguem.
    if (!(e instanceof ErroDaFilaPesada) && !(e instanceof ErroDeConducao)) {
      return { acao: 'recusado', trabalho: p.trabalho, thread: p.thread, fase: p.fase, motivo: MOTIVO_DA_BASELINE_FALHA, detalhe: mensagem(e),
        reserva: null, fila: p.fila };
    }
    return { acao: 'aguardar', ate: cadencia, motivo: 'baseline-pendente', detalhe: mensagem(e), fila: p.fila };
  }
  return { acao: 'aguardar', ate: new Date().toISOString(), motivo: 'baseline-gravada', fila: p.fila,
    detalhe: `a baseline da thread ${p.thread} foi gravada fora da trava de despacho; o próximo passo confere o envelope e despacha` };
}

/** Reserva, abre a thread quando falta e despacha pelo núcleo; o desfecho volta ao log do arco. */
function despacharCandidato(carregado: ManifestoCarregado, arco: string, fila: FilaDoArco,
  c: { trabalho: string; thread: Thread | null; item: string; fase: Fase; runtime: string; conta: string; quando: string;
    /** O pedido do dono, para a thread que o arco abre; `null` no trabalho que já é uma thread. */
    pedido: string | null;
    /** RM-058 N4 (D14): o alvo de fallback, com modelo e esforço; `null` no runtime do bloco. */
    trio?: AlvoDoPasso | null;
    /** RM-058 N6: o consumo medido dos tetos fora de `sessoes`. */
    medido?: ConsumoMedidoDoDespacho },
  opcoes: OpcoesDoPasso): ResultadoDoPasso | BaselinePendente | RecusaDoCandidato {
  const { raiz } = carregado;
  let reserva: number;
  try {
    reserva = (opcoes.coordenacao?.reservar ?? opcoes.reservar ?? reservarDespacho)(raiz, { arco, envelopeSha256: fila.envelopeSha256 ?? '', trabalho: c.trabalho,
      thread: c.thread?.id ?? null, fase: c.fase, runtime: c.runtime, conta: c.conta, revisao: c.fase === 'CHECK',
      ...(c.medido ? { medido: c.medido } : {}) }, c.quando).seq;
  } catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    const r: Recusado = { acao: 'recusado', trabalho: c.trabalho, thread: c.thread?.id ?? null, fase: c.fase, motivo: e.motivo,
      detalhe: e.message, reserva: null, fila };
    return RECUSAS_DO_CANDIDATO.includes(e.motivo) ? { ...r, seguir: true } : r;
  }
  const recusar = (motivo: string, detalhe: string, thread: string | null): Recusado => {
    concluirDespacho(raiz, arco, reserva, { motivo });
    return { acao: 'recusado', trabalho: c.trabalho, thread, fase: c.fase, motivo, detalhe, reserva, fila };
  };
  let thread = c.thread;
  let pedido: { texto: string } | null;
  try {
    if (!thread) {
      if (!c.pedido) return { ...recusar('noctum.despacho.pedido-ausente', `o trabalho ${c.trabalho} não traz pedido para abrir a thread`, null), seguir: true };
      // RM-037 (CHECK 3 da ork-rm037defeit2): sob a trava de despacho, o preparo das dependências só fica pendente.
      const base = `${c.item.toLowerCase()} ${c.trabalho}`;
      const numero = opcoes.coordenacao?.ordens?.get(c.trabalho)?.numero;
      const sufixo = numero === undefined ? '' : ` o${numero}`;
      const nome = sufixo ? `${base.slice(0, Math.max(1, 12 - sufixo.length)).trimEnd()}${sufixo}` : base;
      thread = (opcoes.abrirThread ?? ((k, o) => novaThread(k, o).thread))(carregado, { nome,
        modo: 'auto', roadmap: c.item, pedido: c.pedido, criarWorktree: true, adiarDependencias: true });
    }
    pedido = pedidoDaThread(raiz, thread);
  } catch (e) {
    // A4 do CHECK: a falha antes de lançar (abrir a thread, ler o pedido) é deste candidato: a reserva volta e o passo segue.
    return { ...recusar(MOTIVO_DO_ERRO_NO_DESPACHO, mensagem(e), thread?.id ?? null), seguir: true };
  }
  if (!pedido) return { ...recusar('noctum.despacho.pedido-ausente', `a thread ${thread.id} não guardou o pedido`, thread.id), seguir: true };
  // RM-058, integração (D6): sem a baseline do bloco com GO, em qualquer runtime, a reserva volta antes do lançamento, e a
  // baseline roda fora da trava de despacho (`baselineForaDaTrava`); o vigia nunca a grava: ela fica para o condutor.
  if (baselineDoArcoPendente(raiz, thread, c.fase)) {
    concluirDespacho(raiz, arco, reserva, { motivo: 'baseline.pendente' });
    return { acao: 'baseline', trabalho: c.trabalho, thread: thread.id, fase: c.fase, fila };
  }
  // S5 do CHECK: a falha de dentro do núcleo pode ter aberto a sessão; ela sobe, e a reserva fica pendente e conta.
  const antes = eventosDaThread(raiz, thread.id)?.length ?? 0;
  const trio = c.trio ? { runtime: c.trio.runtime, ...(c.trio.model ? { model: c.trio.model } : {}), ...(c.trio.effort ? { effort: c.trio.effort } : {}) } : {};
  // RM-058, integração (D5 da ork-rm058integra): a sessão sabe que o SHIP e o MASTER da thread são do arco. A linha é fixa,
  // e o mesmo pedido dá o mesmo prompt em toda chamada: o `rodarFase` segue idempotente.
  const r = (opcoes.despachar ?? rodarFase)(carregado, thread.id, { fase: c.fase, prompt: pedidoDoArco(pedido.texto, arco), perfil: c.conta,
    canal: canalDoProcesso(), correlacao: `noctum:${arco}`, baselinePeloDespacho: false, ...trio });
  if (r.motivo === 'baseline.pendente') {
    concluirDespacho(raiz, arco, reserva, { motivo: 'baseline.pendente' });
    return { acao: 'baseline', trabalho: c.trabalho, thread: thread.id, fase: c.fase, fila };
  }
  // A recusa dos portões do núcleo vem antes de chamar o runtime: nada abriu, e a sessão volta ao orçamento.
  if (r.bloqueado) return recusar(String(r.motivo ?? 'despacho.bloqueado'), r.erro ?? 'o núcleo recusou o despacho', thread.id);
  if (r.sessionId || r.idempotente) {
    concluirDespacho(raiz, arco, reserva, { thread: thread.id, sessionId: r.sessionId, idempotente: r.idempotente === true });
    return { acao: 'despachou', trabalho: c.trabalho, thread: thread.id, fase: c.fase, runtime: c.runtime, conta: c.conta,
      sessionId: r.sessionId, idempotente: r.idempotente === true, reserva, fila };
  }
  // B1 da rodada 2: o núcleo chamou o runtime e voltou sem sessão. A conta, o limite de uso e o impedimento do dono recusam
  // antes de rodar, e devolvem a sessão; mas a falha seca do runtime, o id dito antes da falha (o `claude --bg` que diz o id
  // e sai com erro deixa a sessão aberta) e o núcleo que não diz nada deixam a reserva pendente e contada.
  const novos = eventosDaThread(raiz, thread.id);
  const idDaFalha = novos === null ? '(ledger ilegível)' : novos.slice(antes)
    .filter(e => e.tipo === TIPOS_DE_EVENTO.despachoFalhou && typeof e.sessionId === 'string').map(e => e.sessionId as string).at(-1) ?? null;
  if (!idDaFalha && r.motivo && r.motivo !== 'runtime.unavailable') return recusar(String(r.motivo), r.erro ?? 'o runtime recusou o despacho', thread.id);
  return { acao: 'recusado', trabalho: c.trabalho, thread: thread.id, fase: c.fase, motivo: String(r.motivo ?? 'despacho.sem-sessao'),
    detalhe: `${r.erro ?? 'o núcleo não abriu sessão'}; a sessão pode ter aberto${idDaFalha ? ` (${idDaFalha})` : ''}, e a reserva fica ` +
      'pendente e contada até a N4 reconciliar', reserva, fila };
}
