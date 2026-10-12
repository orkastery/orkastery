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
 * A revogação nunca espera um despacho: ela usa o lock do arco, e a trava de despacho é outra. Quem chama decide quando
 * chamar de novo (o vigia é da N4); a decisão da fila diz até quando esperar. Nada aqui liga o modo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { vagaDoDespacho } from './board';
import { canalDoProcesso } from './conducao';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { ManifestoCarregado } from './manifest';
import { concluirDespacho, reservarDespacho } from './noctum-arco';
import { admitir, Admissao, escolherConta, fatosDeCapacidade, LeituraDeSessoes } from './noctum-capacidade';
import { envelopeComTrabalhos, RecusaDoArco } from './noctum-envelope';
import { DecisaoDaFila, fatosDaFila, FilaDoArco, LeitorDeReservas, montarFila } from './noctum-fila';
import { OpcoesRun, resolverDespacho, ResultadoRun, rodarFase } from './phase';
import { lerPerfis, perfilDisponivel } from './runtime-profiles';
import { configDoBloco, lerSetup } from './setup';
import { lerThread, novaThread, OpcoesNovaThread, pedidoDaThread } from './thread';
import { Fase, Thread } from './types';

/** Quanto o passo espera a vez de despachar antes de devolver `aguardar`: o despacho de outro arco leva segundos. */
export const ESPERA_DA_VEZ_DE_DESPACHAR_MS = 30_000;
const PAUSA_MS = 200;

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
}

export type ResultadoDoPasso =
  | { acao: 'despachou'; trabalho: string; thread: string; fase: Fase; runtime: string; conta: string; sessionId: string | null;
    idempotente: boolean; reserva: number; fila: FilaDoArco }
  | { acao: 'recusado'; trabalho: string; thread: string | null; fase: Fase; motivo: string; detalhe: string; reserva: number | null;
    fila: FilaDoArco }
  | { acao: 'aguardar'; ate: string; motivo: string; detalhe: string; fila: FilaDoArco | null }
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
  try {
    const fatos = fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas });
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
    let recusa: Extract<Admissao, { ok: false }> | null = null;
    for (const candidato of fila.candidatos) {
      const fase = candidato.fase!;
      const thread = candidato.thread ? lerThread(raiz, candidato.thread) : null;
      const runtime = runtimeDaFase(carregado, thread?.modo ?? 'auto', fase);
      const doRuntime = perfis.filter(p => p.runtime === runtime).map(p => p.id);
      // A conta com mais folga; sem folga em nenhuma, a primeira do envelope no runtime, para `admitir` dizer o motivo na
      // ordem dele (a máquina cheia antes da conta).
      const conta = escolherConta(conteudo.capacidade, capacidade, doRuntime)
        ?? conteudo.capacidade.porConta.find(c => doRuntime.includes(c.conta))?.conta ?? null;
      const vaga = vagaDoDespacho(carregado, thread?.id ?? '', quando);
      const admissao = conta === null
        ? { ok: false as const, motivo: 'capacidade.conta-nao-autorizada' as const,
          detalhe: `nenhuma conta do envelope é perfil disponível do runtime ${runtime}` }
        : admitir({ runtime, conta, revisao: fase === 'CHECK' }, conteudo.capacidade, capacidade, vaga);
      if (!admissao.ok) {
        recusa = admissao;
        if (MOTIVOS_DE_MAQUINA.includes(admissao.motivo)) break;
        continue;
      }
      return despacharCandidato(carregado, arco, fila, { trabalho: candidato.id, thread, item: candidato.item, fase, runtime,
        conta: conta!, quando, pedido: conteudo.trabalhos.find(t => t.id === candidato.id)?.pedido ?? null }, opcoes);
    }
    return { acao: 'aguardar', ate: new Date(Math.min(Date.parse(quando) + 5 * 60_000, Date.parse(conteudo.janela.fim))).toISOString(),
      motivo: recusa?.motivo ?? 'capacidade', detalhe: recusa?.detalhe ?? 'nenhum candidato coube', fila };
  } finally { fs.closeSync(fd); }
}

/** Reserva, abre a thread quando falta e despacha pelo núcleo; o desfecho volta ao log do arco. */
function despacharCandidato(carregado: ManifestoCarregado, arco: string, fila: FilaDoArco,
  c: { trabalho: string; thread: Thread | null; item: string; fase: Fase; runtime: string; conta: string; quando: string;
    /** O pedido do dono, para a thread que o arco abre; `null` no trabalho que já é uma thread. */
    pedido: string | null },
  opcoes: OpcoesDoPasso): ResultadoDoPasso {
  const { raiz } = carregado;
  let reserva: number;
  try {
    reserva = reservarDespacho(raiz, { arco, envelopeSha256: fila.envelopeSha256 ?? '', trabalho: c.trabalho, thread: c.thread?.id ?? null,
      fase: c.fase, runtime: c.runtime, conta: c.conta, revisao: c.fase === 'CHECK' }, c.quando).seq;
  } catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    return { acao: 'recusado', trabalho: c.trabalho, thread: c.thread?.id ?? null, fase: c.fase, motivo: e.motivo, detalhe: e.message,
      reserva: null, fila };
  }
  const recusar = (motivo: string, detalhe: string, thread: string | null): ResultadoDoPasso => {
    concluirDespacho(raiz, arco, reserva, { motivo });
    return { acao: 'recusado', trabalho: c.trabalho, thread, fase: c.fase, motivo, detalhe, reserva, fila };
  };
  try {
    let thread = c.thread;
    if (!thread) {
      if (!c.pedido) return recusar('noctum.despacho.pedido-ausente', `o trabalho ${c.trabalho} não traz pedido para abrir a thread`, null);
      thread = (opcoes.abrirThread ?? ((k, o) => novaThread(k, o).thread))(carregado, { nome: `${c.item.toLowerCase()} ${c.trabalho}`,
        modo: 'auto', roadmap: c.item, pedido: c.pedido, criarWorktree: true });
    }
    const pedido = pedidoDaThread(raiz, thread);
    if (!pedido) return recusar('noctum.despacho.pedido-ausente', `a thread ${thread.id} não guardou o pedido`, thread.id);
    const r = (opcoes.despachar ?? rodarFase)(carregado, thread.id, { fase: c.fase, prompt: pedido.texto, perfil: c.conta,
      canal: canalDoProcesso(), correlacao: `noctum:${arco}` });
    if (r.bloqueado || (!r.sessionId && !r.idempotente)) {
      return recusar(String(r.motivo ?? 'despacho.sem-sessao'), r.erro ?? 'o núcleo não abriu sessão', thread.id);
    }
    concluirDespacho(raiz, arco, reserva, { thread: thread.id, sessionId: r.sessionId, idempotente: r.idempotente === true });
    return { acao: 'despachou', trabalho: c.trabalho, thread: thread.id, fase: c.fase, runtime: c.runtime, conta: c.conta,
      sessionId: r.sessionId, idempotente: r.idempotente === true, reserva, fila };
  } catch (e) {
    // A falha no meio (disco, git) devolve a sessão e sobe: o passo seguinte relê tudo, e a thread aberta é achada pelo pedido.
    try { concluirDespacho(raiz, arco, reserva, { motivo: 'noctum.despacho.erro' }); } catch { /* a reserva fica pendente e conta */ }
    throw e;
  }
}

