/** Operação estruturada: argumentos só identificam a thread; execução sempre confinada. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exigirManifesto } from './manifest';
import { dirThread, lerThread } from './thread';
import { lerClaims } from './claims';
import { adquirirRegiao, caminhoFila, caminhoLease, dirLeases, lerLease, leasesColidentes, liberar } from './leases';
import { validarArquivosEstadoMcp } from './mcp-artifacts';
import { comandosDoManifesto, ConducaoDoVerify, ExecutorVerify, prazoDoComando, verificar } from './verify';
import { criarExecutorSandbox } from './verify-sandbox';
import { ResultadoDeComando } from './types';
import { branchDaWorktree, worktreesDoGit } from './worktree';

const PRAZO_TOTAL_MS = 180_000;
const RESERVA_MS = 10_000;
// I-37 (D4): o teto por comando cabe o `test:ci` medido (196 s); quem limita e o prazo total.
const COMANDO_MAX_MS = 300_000;
const MAX_COMANDOS = 512;
const MAX_CLAIMS = 512;
const LIMITE_RETORNO = 40;

function identidade(st: fs.Stats) { return `${st.dev}:${st.ino}`; }
function diretorioFixo(p: string): string {
  const real = fs.realpathSync(p);
  if (real !== path.resolve(p) || !fs.lstatSync(p).isDirectory()) throw Error('mcp.verify.scope');
  return real;
}
function dentro(raiz: string, p: string): boolean { return p.startsWith(raiz + path.sep); }
function mesmoLease(a: ReturnType<typeof lerLease>, b: NonNullable<ReturnType<typeof lerLease>>) {
  return !!a && a.nome === b.nome && a.thread === b.thread && a.pid === b.pid &&
    a.adquiridoEm === b.adquiridoEm && a.expiraEm === b.expiraEm && a.motivo === b.motivo;
}

/** Síncrono: prazo total/per-command, não cancelamento reativo do event loop. */
export function verificarMcp(raizEntrada: string, threadId: string, conducao: ConducaoDoVerify = {}) {
  const deadline = Date.now() + PRAZO_TOTAL_MS;
  if (!path.isAbsolute(raizEntrada) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId)) throw Error('mcp.verify.invalid');
  const raiz = diretorioFixo(raizEntrada);
  const carregado = exigirManifesto(raiz);
  if (fs.realpathSync(carregado.raiz) !== raiz) throw Error('mcp.verify.project');
  // Nenhum componente de estado pode redirecionar as APIs legadas que usam caminhos.
  for (const p of [path.join(raiz, '.orkastery'), path.join(raiz, '.orkastery', 'threads'), dirThread(raiz, threadId)]) {
    if (!dentro(raiz, diretorioFixo(p))) throw Error('mcp.verify.scope');
  }
  validarArquivosEstadoMcp(raiz, threadId);
  const t = lerThread(raiz, threadId);
  if (t.id !== threadId || t.status === 'fechada' || !t.worktree) throw Error('mcp.verify.thread');
  const worktree = diretorioFixo(t.worktree);
  if (!dentro(raiz, worktree)) throw Error('mcp.verify.worktree');
  if (!worktreesDoGit(raiz).some(w => w.dir === worktree && w.branch === branchDaWorktree(t))) throw Error('mcp.verify.worktree.unregistered');
  const fixacaoRaiz = identidade(fs.statSync(raiz)), fixacaoWt = identidade(fs.statSync(worktree));
  const nomes = [`worktree-write:${threadId}`, `path:.orkastery/threads/${threadId}`];
  const leasesDir = dirLeases(raiz);
  const stDir = fs.lstatSync(leasesDir, { throwIfNoEntry: false });
  if (stDir && (!stDir.isDirectory() || !dentro(raiz, diretorioFixo(leasesDir)))) throw Error('mcp.verify.scope');
  const stFila = fs.lstatSync(caminhoFila(raiz), { throwIfNoEntry: false });
  if (stFila && (!stFila.isFile() || stFila.nlink !== 1)) throw Error('mcp.verify.queue.unsafe');
  // Não herda nem remove lease existente, inclusive própria, expirada ou corrompida.
  if (nomes.some(nome => fs.lstatSync(caminhoLease(raiz, nome), { throwIfNoEntry: false }) ||
      leasesColidentes(raiz, nome).length) || leasesColidentes(raiz, 'main-tree').length) {
    throw Error('lease.busy: verificação exige leases próprias livres');
  }
  const tempoParaLease = deadline - Date.now();
  if (tempoParaLease <= RESERVA_MS) throw Error('mcp.verify.deadline: prazo esgotado no preflight');
  const adquiridos: NonNullable<ReturnType<typeof lerLease>>[] = [];
  const conservaLeases = () => adquiridos.length === nomes.length &&
    adquiridos.every(lease => mesmoLease(lerLease(raiz, lease.nome), lease));
  try {
    for (const nome of nomes) {
      const adquirido = adquirirRegiao(raiz, nome, { thread: threadId, motivo: 'MCP VERIFY ' + randomUUID(),
        ttlMs: tempoParaLease + RESERVA_MS, retomarVencido: false });
      if (!adquirido.ok || !adquirido.lease) throw Error('lease.busy: verificação não adquiriu região');
      adquiridos.push(adquirido.lease);
    }
    validarArquivosEstadoMcp(raiz, threadId);
    const atual = lerThread(raiz, threadId);
    if (atual.id !== threadId || atual.status === 'fechada' || atual.worktree !== t.worktree) throw Error('mcp.verify.thread.changed');
    const claims = lerClaims(raiz, threadId).filter(c => c.estado !== 'retirada');
    const comandos = claims.flatMap(c => c.verificar)
      .concat(comandosDoManifesto(carregado.manifesto).map(c => c.comando));
    if (claims.length > MAX_CLAIMS || comandos.length > MAX_COMANDOS || comandos.reduce((n, c) => n + Buffer.byteLength(c), 0) > 1024 * 1024) {
      throw Error('mcp.verify.limit: plano de execução excede limite');
    }
    const executor: ExecutorVerify = (nomeComando, comando, cwd): ResultadoDeComando & { executado: boolean } => {
      if (diretorioFixo(raiz) !== raiz || identidade(fs.statSync(raiz)) !== fixacaoRaiz ||
          diretorioFixo(worktree) !== worktree || identidade(fs.statSync(worktree)) !== fixacaoWt || cwd !== worktree) {
        throw Error('mcp.verify.scope.changed');
      }
      validarArquivosEstadoMcp(raiz, threadId);
      if (lerThread(raiz, threadId).worktree !== t.worktree || !conservaLeases()) throw Error('mcp.verify.lease-or-scope.changed');
      const restante = deadline - Date.now() - RESERVA_MS;
      if (restante < 100) return { nome: nomeComando, comando, ok: false, code: -1,
        resumo: 'não executado: prazo total de VERIFY esgotado', executado: false };
      const prazo = Math.min(COMANDO_MAX_MS, prazoDoComando(carregado.manifesto, nomeComando));
      const confinado = criarExecutorSandbox({ worktree, timeoutMs: Math.min(prazo, restante) });
      try {
        const resultado = confinado.executar(nomeComando, comando, cwd);
        if (!conservaLeases()) throw Error('mcp.verify.lease.changed');
        validarArquivosEstadoMcp(raiz, threadId);
        return { ...resultado, executado: true };
      }
      finally { confinado.fechar(); }
    };
    // I-36 (T8): o MESMO lease de execucao do CLI; a sessao filha reentra pela identidade do despacho.
    const r = verificar(carregado, threadId, { executor, operacao: 'mcp.verify', conducao });
    const execucoes = r.claims.flatMap(c => c.execucoes).concat(r.comandos);
    return {
      threadId, ok: r.ok, commit: r.commit, motivos: r.motivos,
      claims: { total: r.claims.length, verificadas: r.claims.filter(c => c.verificado).length },
      execucoes: execucoes.slice(0, LIMITE_RETORNO).map(c => ({ nome: c.nome, ok: c.ok, code: c.code,
        executado: (c as ResultadoDeComando & { executado?: boolean }).executado === true, resumo: c.resumo })),
      totalExecucoes: execucoes.length, omitidas: Math.max(0, execucoes.length - LIMITE_RETORNO),
      regressoes: r.regressoes.map(c => c.nome), preExistentes: r.preExistentes.map(c => c.nome),
      executor: 'codex-sandbox', prazoTotalMs: PRAZO_TOTAL_MS, limitePorComandoMs: COMANDO_MAX_MS,
    };
  } finally {
    for (const lease of adquiridos.reverse()) {
      if (mesmoLease(lerLease(raiz, lease.nome), lease)) liberar(raiz, lease.nome, threadId);
    }
  }
}
