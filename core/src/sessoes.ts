/**
 * `ork sessions`: observabilidade real das sessoes despachadas.
 *
 * A fonte da verdade e o runtime (`claude agents --json`), nunca o `thread.json`.
 * O `ork` cruza as duas visoes e denuncia divergencia em vez de repetir o self-report.
 */

import * as adapter from './adapters/claude-bg';
import { inventariarSessoes, InventarioDeSessoes } from './sessoes-inventario';
import { lerPerfis, PerfilDeDespacho, perfilDeDespacho } from './runtime-profiles';
import { tabela } from './util';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar } from './ledger';
import { dirThread, lerThread } from './thread';

export function textoDoInventario(r: InventarioDeSessoes): string {
  const linhas = [
    `Inventário ${r.escopo.global ? 'global' : 'do projeto'} da conta ${r.escopo.usuario}; histórico: ${r.escopo.historico ? 'incluído' : 'omitido'}.`,
    `Fontes: ${r.fontes.map(f => `${f.origem} (${f.ausente ? 'ausente' : f.ok ? 'ok' : 'FALHA'})`).join('; ')}`,
    `Total: ${r.total}; sem thread: ${r.semThread}; ambíguas: ${r.ambiguas}; fantasmas: ${r.fantasmas}; consulta: ${r.ok ? 'válida' : 'INCOMPLETA'}.`,
  ];
  // RM-056 (D4): a coluna PERFIL e o id do perfil (`processo` sem perfil), nunca o diretorio da conta.
  if (r.sessoes.length) linhas.push(tabela(['ID', 'RUNTIME', 'PERFIL', 'ESTADO', 'THREAD/FASE'],
    r.sessoes.map(s => [s.sessionId, s.runtime, s.perfil ?? 'processo',
      `${s.state ?? s.status ?? 'unknown'}${s.fantasma ? ' (fantasma)' : ''}`,
      s.vinculos.map(v => `${v.thread}/${v.fase}`).join(', ') || '(fora do ork)'])));
  if (r.fantasmas > 0) linhas.push('Fantasma: registro sem processo vivo, não ocupa vaga; `ork sessions limpar-fantasmas` solta o vínculo do ork sem tocar no runtime.');
  for (const f of r.fontes.filter(f => !f.ok)) linhas.push(`Falha: ${f.detalhe}`);
  // Fatia 2 do ensaio da 0.5.0 (P1): a fonte ausente nao e falha, mas diz o que falta e como ter.
  for (const f of r.fontes.filter(f => f.ausente)) linhas.push(`Ausente: ${f.detalhe}${f.correcao ? `; correção: ${f.correcao}` : ''}`);
  return linhas.join('\n');
}

export function tabelaDeSessoes(raiz: string, todas = false): string {
  return textoDoInventario(inventariarSessoes(raiz, { todas }));
}

/**
 * RM-037 (defeitosdeco D-2): a sessao pelo id curto, id completo ou nome, procurada no ambiente do
 * processo e em cada perfil claude-bg do projeto (inclusive desativado, que ainda pode ter sessao
 * viva). So uma conta pode responder; duas viram recusa, nenhuma mantem a mensagem de antes.
 */
function localizarSessao(chave: string, raiz?: string | null): { achada: adapter.SessaoNaConta } | { texto: string; codigo: number } {
  let perfis: PerfilDeDespacho[] = [];
  const falhas: string[] = [];
  if (raiz) {
    try { perfis = lerPerfis(raiz).perfis.filter(p => p.runtime === 'claude-bg').map(perfilDeDespacho); }
    catch (e) { falhas.push(`perfis: ${(e as Error).message}`); }
  }
  const r = adapter.acharSessaoNasContas(chave, perfis);
  falhas.push(...r.falhas);
  if (r.achadas.length === 1) return { achada: r.achadas[0] };
  if (r.achadas.length > 1) {
    const contas = r.achadas.map(a => `${a.perfil?.id ?? 'processo'} (${a.sessao.sessionId})`).join(', ');
    return { texto: `sessao "${chave}" encontrada em mais de uma conta: ${contas}; use o id completo`, codigo: 1 };
  }
  return { texto: `sessao "${chave}" nao encontrada no runtime` + (falhas.length ? `; contas sem resposta: ${falhas.join('; ')}` : ''),
    codigo: 1 };
}

/** Logs de uma sessao pelo id curto, id completo ou nome, lidos na conta onde ela esta. */
export function logsDaSessao(chave: string, linhas: number, raiz?: string | null): { texto: string; codigo: number } {
  const l = localizarSessao(chave, raiz);
  if (!('achada' in l)) return l;
  const { sessao, ambiente } = l.achada;
  const r = adapter.logsDaSessao(sessao.id ?? sessao.sessionId.slice(0, 8), linhas, ambiente);
  return { texto: r.texto, codigo: r.ok ? 0 : 1 };
}

/** Para uma sessao pelo id curto, id completo ou nome, com o `CLAUDE_CONFIG_DIR` da conta dela. */
export function pararSessao(chave: string, raiz?: string | null): { texto: string; codigo: number } {
  const l = localizarSessao(chave, raiz);
  if (!('achada' in l)) return l;
  const { sessao, perfil, ambiente } = l.achada;
  const r = adapter.pararAchada(sessao, ambiente);
  return { texto: r.texto || `sessao ${sessao.sessionId} parada${perfil ? ` (perfil ${perfil.id})` : ''}`, codigo: r.ok ? 0 : 1 };
}

/** Comando de attach (precisa de TTY, entao o CLI imprime em vez de executar). */
export function comandoDeAttach(chave: string, raiz?: string | null): { texto: string; codigo: number } {
  const l = localizarSessao(chave, raiz);
  if (!('achada' in l)) return l;
  const { sessao, perfil, configDir } = l.achada;
  return { texto: adapter.comandoAttach(sessao.sessionId, perfil ? configDir : null), codigo: 0 };
}

/** RM-056 (D6): o que `ork sessions limpar-fantasmas` fez (ou faria, no ensaio) com cada fantasma. */
export interface FantasmaTratado {
  sessionId: string;
  perfil: string | null;
  thread: string | null;
  fase: string | null;
  /** `solto`: `sessao_morta` gravado; `ja-solto`: o ledger ja encerrava a sessao; `sem-thread`: nada a soltar no ork;
   *  `outro-projeto`: o vinculo e de outro projeto, que solta pelo proprio `ork`. */
  acao: 'solto' | 'ja-solto' | 'sem-thread' | 'outro-projeto';
}

const ENCERRAM_A_SESSAO = ['phase_result', 'sessao_morta', 'session_superseded'];

/**
 * RM-056 (D6): solta o vinculo do `ork` com cada sessao fantasma (sem pid e sem processo) deste
 * projeto, gravando `sessao_morta` no ledger da thread: e o evento que libera a conducao
 * (`fimDaSessao`) e a vaga. Nunca chama o runtime: o registro no `claude agents` fica onde esta.
 */
export function limparFantasmas(raiz: string,
  opcoes: { dryRun?: boolean; agora?: string; thread?: string; origem?: string } = {}):
  { ok: boolean; dryRun: boolean; itens: FantasmaTratado[]; falhas: string[] } {
  const canonica = raizDoEstado(raiz);
  const inv = inventariarSessoes(canonica, { global: true });
  const itens: FantasmaTratado[] = [];
  for (const s of inv.sessoes.filter(x => x.fantasma)) {
    // Fechamento (RM-056, ao fechar): so os vinculos da thread que fecha; o resto fica como estava.
    const vinculos = opcoes.thread ? s.vinculos.filter(v => v.thread === opcoes.thread && v.raiz === canonica) : s.vinculos;
    if (opcoes.thread && vinculos.length === 0) continue;
    if (vinculos.length === 0) { itens.push({ sessionId: s.sessionId, perfil: s.perfil, thread: null, fase: null, acao: 'sem-thread' }); continue; }
    for (const v of vinculos) {
      const base = { sessionId: s.sessionId, perfil: s.perfil, thread: v.thread, fase: v.fase };
      if (v.raiz !== canonica) { itens.push({ ...base, acao: 'outro-projeto' }); continue; }
      const dir = dirThread(canonica, v.thread);
      if (lerLedger(dir).some(e => ENCERRAM_A_SESSAO.includes(e.tipo) && e.sessionId === s.sessionId)) {
        itens.push({ ...base, acao: 'ja-solto' }); continue;
      }
      if (!opcoes.dryRun) registrar(dir, v.thread, 'sessao_morta', {
        fase: v.fase, sessionId: s.sessionId, runtime: s.runtime, ...(s.perfil ? { perfilId: s.perfil } : {}),
        origem: opcoes.origem ?? 'sessions.limpar-fantasmas', estadoNoRuntime: s.state ?? s.status ?? null,
        evidencia: 'claude agents lista a sessao sem pid ou com pid sem processo (fantasma, RM-056 D5)',
        razao: 'solta o vinculo do ork (conducao e vaga) sem tocar no runtime: claude stop e claude rm nao acham o job',
      });
      itens.push({ ...base, acao: 'solto' });
    }
  }
  return { ok: inv.ok, dryRun: opcoes.dryRun === true, itens, falhas: inv.fontes.filter(f => !f.ok).map(f => `${f.origem}: ${f.detalhe}`) };
}

/**
 * RM-056 (ao fechar): as sessoes registradas na thread que o ledger dela ainda nao encerra. E o filtro
 * barato do fechamento: so com alguma delas o `liberarAoFechar` consulta o inventario (o `claude agents`
 * de cada conta). Sessao sem fim pode estar viva; quem decide se e fantasma e o inventario.
 */
export function sessoesSemFim(raiz: string, threadId: string): string[] {
  const canonica = raizDoEstado(raiz);
  const t = lerThread(canonica, threadId);
  const eventos = lerLedger(dirThread(canonica, threadId));
  const encerradas = new Set(eventos.filter(e => ENCERRAM_A_SESSAO.includes(e.tipo)).map(e => String(e.sessionId ?? '')));
  const ids = (Array.isArray(t.sessoes) ? t.sessoes : []).map(s => s?.sessionId).filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].filter(id => !encerradas.has(id));
}

export function textoDaLimpeza(r: ReturnType<typeof limparFantasmas>): string {
  if (r.itens.length === 0) return `Nenhuma sessão fantasma${r.ok ? '' : ' nas contas que responderam'}.` +
    r.falhas.map(f => `\nFalha: ${f}`).join('');
  const verbo: Record<FantasmaTratado['acao'], string> = {
    solto: r.dryRun ? 'soltaria (sessao_morta no ledger)' : 'solto: sessao_morta no ledger',
    'ja-solto': 'já encerrada no ledger', 'sem-thread': 'fora do ork: nada a soltar',
    'outro-projeto': 'vínculo de outro projeto: rode lá',
  };
  return [
    `Sessões fantasma (sem pid e sem processo)${r.dryRun ? ', ensaio: nada foi gravado' : ''}. O runtime não foi tocado.`,
    tabela(['ID', 'PERFIL', 'THREAD/FASE', 'AÇÃO'], r.itens.map(i => [i.sessionId, i.perfil ?? 'processo',
      i.thread ? `${i.thread}/${i.fase}` : '-', verbo[i.acao]])),
    ...r.falhas.map(f => `Falha: ${f}`),
  ].join('\n');
}
