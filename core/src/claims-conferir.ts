/**
 * `ork claims conferir` (RM-059, T0.10): reexecuta so as claims pedidas, ou o verify de uma tarefa do
 * plano da thread, no mesmo sandbox do `ork_verify`, sem gravar recibo.
 *
 * E por aqui que os mods de fase (Freio e Portao, no plano dos mods) conferem o que um lote do GO
 * mexeu: o comando de claim e de verify e escrito pelo modelo, e fora do sandbox ele passaria longe do
 * guard e daria resultado diferente do `ork verify` (D12 do plano). Por isso:
 *
 *  - o executor e o confinado do codex (`criarExecutorSandbox`), um por comando, e nunca ha fallback:
 *    sem sandbox, a conferencia recusa (D6 da thread ork-rm059nucleo);
 *  - o julgamento de cada claim e o do `ork verify` (`verificarClaim`), sem regra paralela;
 *  - quem executa na worktree precisa da conducao da thread, como o `ork verify` (I-36): a sessao que
 *    conduz reentra pela identidade do despacho, e outra conducao recusa;
 *  - nada e gravado: nem `verify_run`, nem estado de claim, nem `gate_blocked`. Quem verifica de
 *    verdade continua sendo o `ork verify`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { lerClaims } from './claims';
import { canalDoProcesso, comConducao, identidadeDoAmbiente, prazoDaVerificacao } from './conducao';
import { ManifestoCarregado } from './manifest';
import { redigirSaida } from './redacao-saida';
import { dirThread, lerThread } from './thread';
import { CanalDeConducao, Claim, MotivoGate, ResultadoDeComando } from './types';
import { commitReal, cwdDaThread, ExecutorVerify, prazoDoComando, TIMEOUT_VERIFY_MS, verificarClaim } from './verify';
import { criarExecutorSandbox } from './verify-sandbox';

export const FORMATO_DA_CONFERENCIA = 'ork.claims-conferencia/v1';
/** O prazo total do `ork_verify` pelo MCP: a conferencia e pontual e nao deve demorar mais que ele. */
export const PRAZO_PADRAO_MS = 180_000;
/** Teto: o prazo de um comando de verify. Pedir mais e pedir o `ork verify` inteiro. */
export const PRAZO_MAXIMO_MS = TIMEOUT_VERIFY_MS;
const PRAZO_MINIMO_MS = 10_000;
/** Folga para fechar o sandbox e responder dentro do prazo pedido. */
const RESERVA_MS = 5_000;

/** Fabrica do executor confinado; os testes injetam uma, o CLI usa o sandbox do codex. */
export type FabricaDeExecutor = (worktree: string, timeoutMs: number) => { executar: ExecutorVerify; fechar: () => void };

export interface PedidoDeConferencia {
  /** Ids das claims (`C3`); exclusivo com `tarefa`. */
  claims?: string[];
  /** Id da tarefa do plano (`T2.1` ou `2.1`); exclusivo com `claims`. */
  tarefa?: string;
  prazoMs?: number;
  canal?: CanalDeConducao;
  correlacao?: string | null;
  /** Somente testes: o sandbox entra aqui. Nunca argumento de CLI ou MCP. */
  fabrica?: FabricaDeExecutor;
}

export interface ExecucaoConferida {
  nome: string;
  comando: string;
  ok: boolean;
  code: number;
  executado: boolean;
  causa?: string;
  prazoMs?: number;
  duracaoMs?: number;
  /** O fim da saida, passado pelo redator do nucleo (segredo nunca sai daqui). */
  fim: string;
}

export interface ItemConferido {
  id: string;
  alegacao: string;
  arquivo: string | null;
  verificado: boolean;
  motivo: MotivoGate | null;
  detalhe: string;
  execucoes: ExecucaoConferida[];
}

export interface ResultadoDaConferencia {
  formato: typeof FORMATO_DA_CONFERENCIA;
  thread: string;
  commit: string;
  cwd: string;
  executor: 'codex-sandbox';
  reciboOficial: false;
  prazoTotalMs: number;
  alvo: { tipo: 'claims'; ids: string[] } | { tipo: 'tarefa'; tarefa: string; plano: { arquivo: string; sha256: string }; comando: string };
  itens: ItemConferido[];
  ok: boolean;
  motivos: MotivoGate[];
}

/** Erro de uso tipado: o CLI sai 2 com ele. */
export class ErroDeConferencia extends Error {}
const recusa = (motivo: string, detalhe: string) => new ErroDeConferencia(`claims.conferir.${motivo}: ${detalhe}`);

/** `C3,C7, c9` vira `['C3', 'C7', 'C9']`, sem repeticao e na ordem pedida. */
export function idsDeClaims(bruto: string): string[] {
  const ids = bruto.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!ids.length) throw recusa('uso', 'informe ao menos uma claim em --claims (ex.: C3,C7)');
  const invalido = ids.find((id) => !/^C\d+$/.test(id));
  if (invalido) throw recusa('uso', `id de claim invalido: ${invalido}`);
  const repetido = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repetido) throw recusa('repetida', `${repetido} pedida duas vezes`);
  return ids;
}

/**
 * O comando de verify da tarefa `T<id>` no texto do plano (D7). O cabeçalho (niveis `##` a `######`)
 * aparece uma vez so; no bloco dele, ate o proximo cabecalho de nivel igual ou maior, ha uma unica
 * linha `verify` (com ou sem negrito), e o comando e o primeiro trecho entre crases dela.
 */
export function verifyDaTarefa(plano: string, tarefaBruta: string): { tarefa: string; comando: string } {
  const id = tarefaBruta.trim().replace(/^T/i, '');
  if (!/^\d+(?:\.\d+)*$/.test(id)) throw recusa('uso', `tarefa invalida: ${tarefaBruta} (ex.: T2.1)`);
  const tarefa = `T${id}`;
  const linhas = plano.replace(/\r\n/g, '\n').split('\n');
  const cabecalho = /^(#{2,6})\s+T(\d+(?:\.\d+)*)(?=[\s.:)]|$)/;
  const inicios = linhas.flatMap((l, i) => {
    const m = cabecalho.exec(l);
    return m && m[2] === id ? [{ i, nivel: m[1].length }] : [];
  });
  if (inicios.length === 0) throw recusa('tarefa-ausente', `o plano nao tem a tarefa ${tarefa}`);
  if (inicios.length > 1) throw recusa('tarefa-repetida', `o plano tem ${inicios.length} cabecalhos da tarefa ${tarefa}`);
  const { i, nivel } = inicios[0];
  const fimDoBloco = linhas.findIndex((l, j) => j > i && new RegExp(`^#{1,${nivel}}\\s`).test(l));
  const bloco = linhas.slice(i + 1, fimDoBloco < 0 ? undefined : fimDoBloco);
  const verifies = bloco.filter((l) => /^\s*[-*]\s+(?:\*\*)?verify(?:\*\*)?\s*:/i.test(l) || /^\s*[-*]\s+\*\*verify:\*\*/i.test(l));
  if (verifies.length === 0) throw recusa('tarefa-sem-verify', `a tarefa ${tarefa} nao tem linha de verify`);
  if (verifies.length > 1) throw recusa('tarefa-ambigua', `a tarefa ${tarefa} tem ${verifies.length} linhas de verify`);
  const comando = /`([^`]+)`/.exec(verifies[0])?.[1]?.trim();
  if (!comando) throw recusa('tarefa-sem-comando', `o verify da tarefa ${tarefa} nao tem comando entre crases: ${verifies[0].trim().slice(0, 120)}`);
  return { tarefa, comando };
}

/** O teto dos documentos de fase (`docs/*.md` da thread). */
const LIMITE_DO_PLANO = 128 * 1024;

/**
 * O `docs/plan.md` da thread, com o sha256 dos bytes lidos; `null` quando ele nao existe. Le pela pasta
 * de estado da thread, que e a do checkout principal mesmo com o CLI rodando de dentro da worktree.
 */
function lerPlano(raiz: string, threadId: string): { arquivo: string; sha256: string; conteudo: string } | null {
  const arquivo = path.join(dirThread(raiz, threadId), 'docs', 'plan.md');
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw recusa('plano-inseguro', 'docs/plan.md da thread nao abre como arquivo comum');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_DO_PLANO) throw recusa('plano-inseguro', 'docs/plan.md da thread nao e arquivo comum de ate 128 KiB');
    const bytes = fs.readFileSync(fd);
    return { arquivo: 'docs/plan.md', sha256: createHash('sha256').update(bytes).digest('hex'), conteudo: bytes.toString('utf8') };
  } finally { fs.closeSync(fd); }
}

/** A fabrica padrao: o sandbox do codex, um por comando, como o `ork_verify`. */
const fabricaPadrao: FabricaDeExecutor = (worktree, timeoutMs) => criarExecutorSandbox({ worktree, timeoutMs });

/** Sandbox que nao abre vira recusa tipada: a conferencia nunca roda fora dele (D6). */
function confinado(fabrica: FabricaDeExecutor, worktree: string, timeoutMs: number) {
  try { return fabrica(worktree, timeoutMs); }
  catch (e) { throw recusa('sandbox-indisponivel', `${(e as Error).message}; a conferencia so roda confinada, sem fallback`); }
}

function conferida(r: ResultadoDeComando): ExecucaoConferida {
  return {
    nome: r.nome, comando: r.comando, ok: r.ok, code: r.code, executado: r.executado !== false,
    ...(r.causa ? { causa: r.causa } : {}),
    ...(r.prazoMs !== undefined ? { prazoMs: r.prazoMs } : {}),
    ...(r.duracaoMs !== undefined ? { duracaoMs: r.duracaoMs } : {}),
    fim: r.resumo ? redigirSaida(r.resumo) : '',
  };
}

/** `ork claims conferir`: so o que foi pedido, no sandbox, sob a conducao da thread, sem gravar nada. */
export function conferirClaims(carregado: ManifestoCarregado, threadId: string, pedido: PedidoDeConferencia): ResultadoDaConferencia {
  const { raiz, manifesto } = carregado;
  if (!pedido.claims === !pedido.tarefa) throw recusa('uso', 'informe --claims C1,C2 ou --tarefa T1, um dos dois');
  const prazoTotalMs = pedido.prazoMs ?? PRAZO_PADRAO_MS;
  if (!Number.isInteger(prazoTotalMs) || prazoTotalMs < PRAZO_MINIMO_MS || prazoTotalMs > PRAZO_MAXIMO_MS)
    throw recusa('prazo', `--prazo vai de ${PRAZO_MINIMO_MS / 1000} a ${PRAZO_MAXIMO_MS / 1000} segundos`);
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') throw recusa('thread-fechada', `a thread ${threadId} esta fechada`);

  // O que vai rodar, inteiro resolvido antes de tomar a conducao: recusa de uso nao toca a worktree.
  let alvo: ResultadoDaConferencia['alvo'];
  let selecionadas: Claim[];
  if (pedido.claims) {
    const ids = pedido.claims;
    const todas = lerClaims(raiz, threadId);
    selecionadas = ids.map((id) => {
      const claim = todas.find((c) => c.id === id);
      if (!claim) throw recusa('desconhecida', `${id} nao existe na thread ${threadId}`);
      if (claim.estado === 'retirada') throw recusa('retirada', `${id} foi retirada (${claim.motivoDaRetirada ?? 'sem motivo'})`);
      return claim;
    });
    alvo = { tipo: 'claims', ids };
  } else {
    const plano = lerPlano(raiz, threadId);
    if (!plano) throw recusa('plano-ausente', `a thread ${threadId} nao tem docs/plan.md`);
    const { tarefa, comando } = verifyDaTarefa(plano.conteudo, pedido.tarefa!);
    selecionadas = [{ id: tarefa, thread: threadId, fase: null, arquivo: plano.arquivo, alegacao: `verify da tarefa ${tarefa} do plano`,
      negativa: false, verificar: [comando], criadoEm: '', estado: 'pendente' }];
    alvo = { tipo: 'tarefa', tarefa, plano: { arquivo: plano.arquivo, sha256: plano.sha256 }, comando };
  }

  const cwd = cwdDaThread(raiz, thread);
  // O sandbox e conferido antes da conducao: sem ele, nada toma o lease nem toca a worktree.
  const fabrica = pedido.fabrica ?? fabricaPadrao;
  confinado(fabrica, cwd, PRAZO_MINIMO_MS).fechar();
  const pedidoDeConducao = {
    canal: pedido.canal ?? canalDoProcesso(),
    correlacao: pedido.correlacao ?? null,
    operacao: 'verify' as const,
    identidade: identidadeDoAmbiente(threadId, process.env, raiz),
    prazoMs: prazoDaVerificacao(prazoTotalMs, 1),
  };
  return comConducao(raiz, threadId, pedidoDeConducao, (tomada) => {
    const prazoFinal = Date.now() + prazoTotalMs;
    const executor: ExecutorVerify = (nome, comando, dir) => {
      const restante = prazoFinal - Date.now() - RESERVA_MS;
      if (restante < 100) {
        return { nome, comando, ok: false, code: -1, executado: false, resumo: 'nao executado: prazo total da conferencia esgotado' };
      }
      const prazoMs = Math.min(prazoDoComando(manifesto, nome), restante);
      tomada.renovar(prazoMs);
      const sandbox = confinado(fabrica, cwd, prazoMs);
      const inicio = Date.now();
      try {
        const r = sandbox.executar(nome, comando, dir);
        const estourou = !r.ok && /timeout do sandbox/.test(`${(r as { stderr?: string }).stderr ?? ''}${r.resumo}`);
        return { ...r, executado: true, prazoMs, duracaoMs: Date.now() - inicio, ...(estourou ? { causa: 'timeout' as const } : {}) };
      } finally { sandbox.fechar(); }
    };
    const resultados = selecionadas.map((c) => verificarClaim(c, cwd, executor));
    const itens: ItemConferido[] = resultados.map((r) => ({
      id: r.claim.id, alegacao: r.claim.alegacao, arquivo: r.claim.arquivo ?? null, verificado: r.verificado,
      motivo: r.motivo, detalhe: r.detalhe, execucoes: r.execucoes.map(conferida),
    }));
    const motivos = [...new Set(itens.map((i) => i.motivo).filter((m): m is MotivoGate => m !== null))];
    return {
      formato: FORMATO_DA_CONFERENCIA, thread: threadId, commit: commitReal(cwd), cwd, executor: 'codex-sandbox',
      reciboOficial: false, prazoTotalMs, alvo, itens, ok: itens.every((i) => i.verificado), motivos,
    };
  });
}

/** Texto de `ork claims conferir`, para quem roda no terminal. */
export function textoDaConferencia(r: ResultadoDaConferencia): string {
  const linhas = [`Conferencia pontual da thread ${r.thread} (sem recibo: o ork verify continua sendo quem verifica)`];
  linhas.push(`  HEAD real   ${r.commit}`);
  linhas.push(`  executor    ${r.executor}, prazo total ${Math.round(r.prazoTotalMs / 1000)} s`);
  linhas.push(r.alvo.tipo === 'claims'
    ? `  alvo        claims ${r.alvo.ids.join(', ')}`
    : `  alvo        verify da tarefa ${r.alvo.tarefa} (plano sha256 ${r.alvo.plano.sha256.slice(0, 12)}): ${r.alvo.comando}`);
  linhas.push('');
  for (const i of r.itens) {
    linhas.push(`  ${i.id}  ${i.verificado ? 'passou' : `NAO PASSOU (${i.motivo})`}  ${i.alegacao}`);
    if (!i.verificado) {
      linhas.push(`      ${i.detalhe}`);
      const falhou = i.execucoes.find((e) => !e.ok);
      if (falhou?.fim) linhas.push(...falhou.fim.split('\n').map((l) => `      | ${l}`));
    }
  }
  linhas.push('');
  linhas.push(r.ok ? 'Resultado: tudo passou.' : `Resultado: nao passou. Motivos: ${r.motivos.join(', ')}`);
  return linhas.join('\n');
}
