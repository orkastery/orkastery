/**
 * Fila DURAVEL de rate limit (bloco B3).
 *
 * Quando o runtime da assinatura bate o limite de uso, a fase morre no meio. Ate aqui
 * isso virava um `runtime.unavailable` seco e alguem tinha que lembrar de redespachar
 * na mao, na janela seguinte, com o prompt certo. O B3 troca a lembranca por estado em
 * disco: o sinal de rate limit vira um PEDIDO na fila, com o horario de reset que o
 * proprio runtime disse, o caminho do prompt EXATO e o sha256 dele.
 *
 * Duas honestidades que mandam neste arquivo:
 *
 *   1. **Horario nunca e chutado.** Quando o stderr traz a hora (epoch, ISO, relogio ou
 *      duracao), ela e o `liberaEm`. Quando nao traz, o `liberaEm` sai da janela padrao
 *      do manifesto e o pedido carrega `janelaEstimada: true`. Estimativa declarada e
 *      diferente de medida inventada, a mesma regra do gate de tokens.
 *   2. **O prompt nao muda entre a morte e a retomada.** A retomada confere o sha256 do
 *      arquivo antes de despachar. Prompt alterado nao e retomada, e outro despacho.
 *
 * Este modulo e FOLHA de proposito: ele guarda e le a fila. Quem redespacha e o
 * `retry.ts`, que e quem pode importar o `phase.ts` sem criar ciclo.
 */

import * as path from 'node:path';
import { dirEstado, ManifestoCarregado } from './manifest';
import { Fase, Manifesto, MotivoGate, PedidoDeRetomada, SinalDeFalhaDeConta, SinalDeRateLimit } from './types';
import { agora, anexarJsonl, lerJsonl, proximoIdSequencial, tabela } from './util';
import { formatarDataHora, legendaDoFuso } from './horario';
import { marcarFalhaDePerfil, PerfilDeDespacho, PerfilDeRuntime } from './runtime-profiles';

export { parseRateLimit } from './adapters/claude-bg';

/** Diretorio de estado da autonomia do B3. */
export function dirRetry(raiz: string): string {
  return path.join(dirEstado(raiz), 'retry');
}

/**
 * Fila duravel do projeto.
 *
 * Fica no projeto, e nao na thread, porque o limite de uso e da ASSINATURA: uma fase de
 * outra thread que morre no mesmo minuto espera a mesma janela, e quem olha a fila
 * precisa ver as duas de uma vez.
 *
 * I-33 (P4, R3): com perfis, a assinatura deixa de ser uma so. A fila vira o ULTIMO recurso,
 * quando nenhum perfil ativo resta em nenhum runtime da ordem de fallback, e o prazo e o menor
 * `esgotadoAte` entre os perfis. O formato do `fila.jsonl` nao muda: o pedido so ganha campos
 * opcionais (runtime, perfil e motivo), e pedido antigo continua legivel sem eles.
 */
export function caminhoDaFila(raiz: string): string {
  return path.join(dirRetry(raiz), 'fila.jsonl');
}

/** Le a fila inteira (JSONL append-only: a ultima gravacao de um id vence). */
export function lerFilaDeRetomada(raiz: string): PedidoDeRetomada[] {
  return lerJsonl<PedidoDeRetomada>(caminhoDaFila(raiz));
}

/** Janela padrao do manifesto, em ms, usada so quando o runtime nao disse a hora. */
export function janelaPadraoMs(manifesto: Manifesto): number {
  return manifesto.retry.janela_padrao_min * 60 * 1000;
}

export interface PedidoNovo {
  thread: string;
  fase: Fase;
  slug: string;
  /** Caminho ABSOLUTO do prompt gravado; a fila guarda o relativo a raiz. */
  promptPath: string;
  promptSha256: string;
  cwd: string;
  model: string | null;
  effort: string | null;
  sinal: SinalDeRateLimit;
  detalhe: string;
  /** I-33 (R3): runtime e perfil da retomada; ausentes, a retomada escolhe como hoje. */
  runtime?: string;
  perfil?: string | null;
  /** I-33: motivo que levou a fila (`runtime.rate-limited` quando ausente). */
  motivo?: MotivoGate;
}

/** I-33 (R3): pedido da fila com os campos opcionais de perfil. */
export type PedidoComPerfil = PedidoDeRetomada & { runtime?: string; perfil?: string | null; motivo?: MotivoGate };

/**
 * Enfileira a fase morta por rate limit.
 *
 * `liberaEm` sai do horario que o runtime disse; sem horario, da janela padrao, e ai o
 * pedido nasce com `janelaEstimada: true` para o `ork retry list` mostrar a diferenca.
 */
export function enfileirar(
  carregado: ManifestoCarregado,
  novo: PedidoNovo,
  agoraMs = Date.now()
): PedidoDeRetomada {
  const { raiz, manifesto } = carregado;
  const ids = lerFilaDeRetomada(raiz).map((p) => p.id);
  const estimada = novo.sinal.resetEm === null;
  const pedido: PedidoDeRetomada = {
    id: proximoIdSequencial(ids, 'R'),
    thread: novo.thread,
    fase: novo.fase,
    slug: novo.slug,
    promptPath: path.isAbsolute(novo.promptPath)
      ? path.relative(raiz, novo.promptPath)
      : novo.promptPath,
    promptSha256: novo.promptSha256,
    cwd: novo.cwd,
    model: novo.model,
    effort: novo.effort,
    sinal: novo.sinal,
    liberaEm:
      novo.sinal.resetEm ?? new Date(agoraMs + janelaPadraoMs(manifesto)).toISOString(),
    janelaEstimada: estimada,
    tentativas: 0,
    estado: 'aguardando',
    criadoEm: agora(),
    atualizadoEm: agora(),
    detalhe: novo.detalhe,
    ...(novo.runtime !== undefined ? { runtime: novo.runtime } : {}),
    ...(novo.perfil !== undefined ? { perfil: novo.perfil } : {}),
    ...(novo.motivo !== undefined ? { motivo: novo.motivo } : {}),
  } as PedidoComPerfil;
  anexarJsonl(caminhoDaFila(raiz), pedido);
  return pedido;
}

/**
 * I-33 (D5): ate quando a conta sai do rodizio. Cota esgotada: a hora dita pelo runtime ou, sem
 * ela, a janela padrao do manifesto (estimativa declarada, nunca chute). Auth ausente: sem prazo.
 */
export function prazoDaConta(manifesto: Manifesto, falha: SinalDeFalhaDeConta, agoraMs = Date.now()): string | null {
  if (falha.motivo === 'runtime.auth-missing') return null;
  // A10: horario dito que ja passou nao devolve o perfil ao rodizio na hora: vale a janela padrao.
  if (falha.resetEm !== null && Date.parse(falha.resetEm) > agoraMs) return falha.resetEm;
  return new Date(agoraMs + janelaPadraoMs(manifesto)).toISOString();
}

/** Marca no store o perfil que falhou pela conta. Sem perfil (ambiente do processo), nada a marcar. */
export function marcarContaDaFalha(carregado: ManifestoCarregado, perfil: PerfilDeDespacho | null | undefined,
  falha: SinalDeFalhaDeConta, agoraMs = Date.now()): PerfilDeRuntime | null {
  if (!perfil) return null;
  const esgotado = falha.motivo === 'runtime.quota-exhausted';
  return marcarFalhaDePerfil(carregado.raiz, perfil.id, { estado: esgotado ? 'esgotado' : 'sem-auth',
    esgotadoAte: prazoDaConta(carregado.manifesto, falha, agoraMs), motivo: falha.motivo, detalhe: falha.trecho,
    em: new Date(agoraMs).toISOString() });
}

/** Regrava um pedido (append-only: a versao nova vence, o historico fica). */
export function gravarPedido(raiz: string, pedido: PedidoDeRetomada): PedidoDeRetomada {
  const atualizado = { ...pedido, atualizadoEm: agora() };
  anexarJsonl(caminhoDaFila(raiz), atualizado);
  return atualizado;
}

/** Um pedido pelo id, ou erro acionavel quando o id nao existe. */
export function exigirPedido(raiz: string, id: string): PedidoDeRetomada {
  const achado = lerFilaDeRetomada(raiz).find((p) => p.id === id);
  if (!achado) {
    throw new Error(`pedido "${id}" nao existe na fila de rate limit (veja: ork retry list)`);
  }
  return achado;
}

/** Pedidos ainda aguardando, na ordem em que a janela libera. */
export function aguardando(raiz: string): PedidoDeRetomada[] {
  return lerFilaDeRetomada(raiz)
    .filter((p) => p.estado === 'aguardando')
    .sort((a, b) => a.liberaEm.localeCompare(b.liberaEm));
}

/** Pedidos cuja janela JA liberou no instante informado (padrao: agora). */
export function vencidos(raiz: string, quando: string = agora()): PedidoDeRetomada[] {
  return aguardando(raiz).filter((p) => p.liberaEm <= quando);
}

/** Quanto falta para a janela de um pedido, em texto curto para o CLI. */
export function faltaPara(pedido: PedidoDeRetomada, quando: string = agora()): string {
  const ms = new Date(pedido.liberaEm).getTime() - new Date(quando).getTime();
  if (ms <= 0) return 'ja liberou';
  const min = Math.ceil(ms / 60000);
  return min < 60 ? `em ${min} min` : `em ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/** Tabela de `ork retry list`. */
export function tabelaDaFila(raiz: string, quando: string = agora()): string {
  const fila = lerFilaDeRetomada(raiz).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (fila.length === 0) {
    return 'Fila de rate limit vazia: nenhuma fase morreu por limite de uso neste projeto.';
  }
  const linhas = fila.map((p) => [
    p.id,
    p.thread,
    p.fase,
    p.estado,
    formatarDataHora(p.liberaEm, { agora: quando }),
    p.janelaEstimada ? `estimada (${p.sinal.fonte})` : `dita pelo runtime (${p.sinal.fonte})`,
    p.estado === 'aguardando' ? faltaPara(p, quando) : '',
    String(p.tentativas),
  ]);
  return tabela(
    ['ID', 'THREAD', 'FASE', 'ESTADO', 'LIBERA EM', 'ORIGEM DA HORA', 'FALTA', 'TENT'],
    linhas
  ) + `\n${legendaDoFuso(undefined, quando)}`;
}
