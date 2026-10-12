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
import { raizDoEstado } from './estado-thread';
import { redigirSaida } from './redacao-saida';
import { caminhoThread, dirThread, lerThread } from './thread';
import { CanalDeConducao, Claim, MotivoGate, ResultadoDeComando, Thread } from './types';
import { commitReal, ExecutorVerify, prazoDoComando, TIMEOUT_VERIFY_MS, verificarClaim } from './verify';
import { criarExecutorSandbox } from './verify-sandbox';
import { branchDaWorktree, worktreesDoGit } from './worktree';
import { ErroDoCatalogo, Mensagens, msg, remontar, textoDoCatalogo } from './locale';

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
export class ErroDeConferencia extends ErroDoCatalogo {}
/** RM-061 (F3b): a recusa nasce do catalogo; o `--json` a leva como nasceu e o texto a remonta no locale do comando. */
const recusa = (motivo: string, detalhe: (m: Mensagens['claims']) => string) =>
  new ErroDeConferencia((m) => m.claims.recusa(motivo, detalhe(m.claims)));

/** `C3,C7, c9` vira `['C3', 'C7', 'C9']`, sem repeticao e na ordem pedida. */
export function idsDeClaims(bruto: string): string[] {
  const ids = bruto.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!ids.length) throw recusa('uso', (m) => m.semClaims);
  const invalido = ids.find((id) => !/^C\d+$/.test(id));
  if (invalido) throw recusa('uso', (m) => m.idInvalido(invalido));
  const repetido = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repetido) throw recusa('repetida', (m) => m.repetida(repetido));
  return ids;
}

/**
 * A linha de verify de uma tarefa nos formatos em uso nos planos: `- **verify:** ...`, `- **verify**: ...`,
 * `- verify: ...`, `` - `verify`: ... `` e `Verify: ...` fora de lista. O grupo 1 e o que vem depois do rotulo.
 */
const ROTULO_DE_VERIFY = /^\s*(?:[-*]\s+)?(?:\*\*verify:\*\*|\*\*verify\*\*\s*:|`verify`\s*:|verify\s*:)\s*(.*)$/i;

/** Linha que abre outro item de lista, cabecalho ou cerca de codigo. */
const ABRE_BLOCO = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```|~~~)/;
const recuo = (linha: string) => /^[ \t]*/.exec(linha)![0].replace(/\t/g, '    ').length;

/**
 * O item inteiro do verify da linha `k`: o texto depois do rotulo e as linhas que o Markdown junta a ele, a
 * continuacao logo abaixo que nao abre outro item e as linhas mais recuadas que o rotulo, mesmo depois de
 * linha em branco. Verify que quebra na linha seguinte ("e o teste da fatia 1 (`node --test ...`)") e um
 * item so, e o pedaco da linha de baixo nao pode ficar de fora.
 */
function itemDoVerify(bloco: string[], k: number, inicio: string): string {
  const base = recuo(bloco[k]);
  const partes = [inicio];
  let depoisDeBranco = false;
  for (const linha of bloco.slice(k + 1)) {
    if (!linha.trim()) { depoisDeBranco = true; continue; }
    if (recuo(linha) <= base && (depoisDeBranco || ABRE_BLOCO.test(linha))) break;
    partes.push(linha.trim());
    depoisDeBranco = false;
  }
  return partes.join(' ').trim();
}

/**
 * O comando de verify da tarefa `T<id>` no texto do plano (D7). O cabeçalho (niveis `##` a `######`)
 * aparece uma vez so; no bloco dele, ate o proximo cabecalho de nivel igual ou maior, ha um unico
 * item `verify`, e ele e um trecho entre crases e nada mais (ponto final aceito), contando as linhas
 * de continuacao do item. Item com dois trechos ou com texto alem do comando ("`git status` vazio e
 * `ork verify`") recusa: rodar so um pedaco daria "passou" a um verify que nao rodou inteiro.
 */
export function verifyDaTarefa(plano: string, tarefaBruta: string): { tarefa: string; comando: string } {
  const id = tarefaBruta.trim().replace(/^T/i, '');
  if (!/^\d+(?:\.\d+)*$/.test(id)) throw recusa('uso', (m) => m.tarefaInvalida(tarefaBruta));
  const tarefa = `T${id}`;
  const linhas = plano.replace(/\r\n/g, '\n').split('\n');
  const cabecalho = /^(#{2,6})\s+T(\d+(?:\.\d+)*)(?=[\s.:)]|$)/;
  const inicios = linhas.flatMap((l, i) => {
    const m = cabecalho.exec(l);
    return m && m[2] === id ? [{ i, nivel: m[1].length }] : [];
  });
  if (inicios.length === 0) throw recusa('tarefa-ausente', (m) => m.tarefaAusente(tarefa));
  if (inicios.length > 1) throw recusa('tarefa-repetida', (m) => m.tarefaRepetida(inicios.length, tarefa));
  const { i, nivel } = inicios[0];
  const fimDoBloco = linhas.findIndex((l, j) => j > i && new RegExp(`^#{1,${nivel}}\\s`).test(l));
  const bloco = linhas.slice(i + 1, fimDoBloco < 0 ? undefined : fimDoBloco);
  const verifies = bloco.flatMap((l, k) => {
    const m = ROTULO_DE_VERIFY.exec(l);
    return m ? [itemDoVerify(bloco, k, m[1].trim())] : [];
  });
  if (verifies.length === 0) throw recusa('tarefa-sem-verify', (m) => m.tarefaSemVerify(tarefa));
  if (verifies.length > 1) throw recusa('tarefa-ambigua', (m) => m.tarefaAmbigua(tarefa, verifies.length));
  const resto = verifies[0];
  const trechos = [...resto.matchAll(/`([^`]+)`/g)].length;
  if (trechos === 0) throw recusa('tarefa-sem-comando', (m) => m.tarefaSemComando(tarefa, resto.slice(0, 120)));
  const unico = /^`([^`]+)`\s*\.?$/.exec(resto);
  if (!unico || !unico[1].trim()) {
    throw recusa('tarefa-ambigua', (m) => m.tarefaVariosTrechos(tarefa, trechos, resto.slice(0, 120)));
  }
  return { tarefa, comando: unico[1].trim() };
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
    throw recusa('plano-inseguro', (m) => m.planoNaoAbre);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_DO_PLANO) throw recusa('plano-inseguro', (m) => m.planoGrande);
    const bytes = fs.readFileSync(fd);
    return { arquivo: 'docs/plan.md', sha256: createHash('sha256').update(bytes).digest('hex'), conteudo: bytes.toString('utf8') };
  } finally { fs.closeSync(fd); }
}

/**
 * Como o `ork_verify` (`mcp-verify.ts`): so a worktree propria da thread, dentro do projeto e registrada no git
 * dele na branch da thread, fica gravavel no sandbox. O projeto e a arvore principal, mesmo com o CLI rodando de
 * dentro de uma worktree. Thread sem worktree seria conferida com a arvore principal gravavel, e worktree de
 * outro repositorio numa branch de mesmo nome abriria escrita fora do projeto: as duas recusam.
 */
function worktreeConferida(raiz: string, thread: Thread): string {
  if (!thread.worktree) throw recusa('sem-worktree', (m) => m.semWorktree(thread.id));
  let dir: string;
  try { dir = fs.realpathSync(thread.worktree); }
  catch { throw recusa('worktree-ausente', (m) => m.worktreeAusente(thread.id)); }
  const projeto = fs.realpathSync(raizDoEstado(raiz));
  if (!dir.startsWith(projeto + path.sep))
    throw recusa('worktree-fora-do-projeto', (m) => m.worktreeFora(thread.id));
  const branch = branchDaWorktree(thread);
  if (!worktreesDoGit(projeto).some((w) => w.dir === dir && w.branch === branch))
    throw recusa('worktree-nao-registrada', (m) => m.worktreeNaoRegistrada(thread.id, branch));
  return dir;
}

/** A fabrica padrao: o sandbox do codex, um por comando, como o `ork_verify`. */
const fabricaPadrao: FabricaDeExecutor = (worktree, timeoutMs) => criarExecutorSandbox({ worktree, timeoutMs });

/** Sandbox que nao abre vira recusa tipada: a conferencia nunca roda fora dele (D6). */
function confinado(fabrica: FabricaDeExecutor, worktree: string, timeoutMs: number) {
  try { return fabrica(worktree, timeoutMs); }
  catch (e) { const erro = (e as Error).message; throw recusa('sandbox-indisponivel', (m) => m.sandboxIndisponivel(erro)); }
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
  if (!pedido.claims === !pedido.tarefa) throw recusa('uso', (m) => m.claimsOuTarefa);
  const prazoTotalMs = pedido.prazoMs ?? PRAZO_PADRAO_MS;
  if (!Number.isInteger(prazoTotalMs) || prazoTotalMs < PRAZO_MINIMO_MS || prazoTotalMs > PRAZO_MAXIMO_MS)
    throw recusa('prazo', (m) => m.prazo(PRAZO_MINIMO_MS / 1000, PRAZO_MAXIMO_MS / 1000));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId) || !fs.existsSync(caminhoThread(raiz, threadId)))
    throw recusa('thread-ausente', (m) => m.threadAusente(threadId));
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') throw recusa('thread-fechada', (m) => m.threadFechada(threadId));
  const cwd = worktreeConferida(raiz, thread);

  // O que vai rodar, inteiro resolvido antes de tomar a conducao: recusa de uso nao toca a worktree.
  let alvo: ResultadoDaConferencia['alvo'];
  let selecionadas: Claim[];
  if (pedido.claims) {
    const ids = pedido.claims;
    const todas = lerClaims(raiz, threadId);
    selecionadas = ids.map((id) => {
      const claim = todas.find((c) => c.id === id);
      if (!claim) throw recusa('desconhecida', (m) => m.desconhecida(id, threadId));
      if (claim.estado === 'retirada') { const motivo = claim.motivoDaRetirada; throw recusa('retirada', (m) => m.retiradaNaConferencia(id, motivo)); }
      return claim;
    });
    alvo = { tipo: 'claims', ids };
  } else {
    const plano = lerPlano(raiz, threadId);
    if (!plano) throw recusa('plano-ausente', (m) => m.planoAusente(threadId));
    const { tarefa, comando } = verifyDaTarefa(plano.conteudo, pedido.tarefa!);
    selecionadas = [{ id: tarefa, thread: threadId, fase: null, arquivo: plano.arquivo, alegacao: `verify da tarefa ${tarefa} do plano`,
      negativa: false, verificar: [comando], criadoEm: '', estado: 'pendente' }];
    alvo = { tipo: 'tarefa', tarefa, plano: { arquivo: plano.arquivo, sha256: plano.sha256 }, comando };
  }

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
        return { nome, comando, ok: false, code: -1, executado: false, resumo: textoDoCatalogo((m) => m.claims.prazoEsgotado) };
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
  // RM-061 (F3b): a moldura pelo catalogo; o detalhe de cada claim (montado em pt-BR, como o --json o leva) remontado.
  const m = msg().claims;
  const linhas = [m.conferencia(r.thread)];
  linhas.push(m.headReal(r.commit));
  linhas.push(m.executor(r.executor, Math.round(r.prazoTotalMs / 1000)));
  linhas.push(r.alvo.tipo === 'claims'
    ? m.alvoClaims(r.alvo.ids.join(', '))
    : m.alvoTarefa(r.alvo.tarefa, r.alvo.plano.sha256.slice(0, 12), r.alvo.comando));
  linhas.push('');
  for (const i of r.itens) {
    linhas.push(m.item(i.id, i.verificado, i.motivo, i.alegacao));
    if (!i.verificado) {
      linhas.push(`      ${remontar(i.detalhe)}`);
      const falhou = i.execucoes.find((e) => !e.ok);
      if (falhou?.fim) linhas.push(...remontar(falhou.fim).split('\n').map((l) => `      | ${l}`));
    }
  }
  linhas.push('');
  linhas.push(r.ok ? m.tudoPassou : m.naoPassou(r.motivos.join(', ')));
  return linhas.join('\n');
}
