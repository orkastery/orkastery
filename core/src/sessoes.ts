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

export function textoDoInventario(r: InventarioDeSessoes): string {
  const linhas = [
    `Inventário ${r.escopo.global ? 'global' : 'do projeto'} da conta ${r.escopo.usuario}; histórico: ${r.escopo.historico ? 'incluído' : 'omitido'}.`,
    `Fontes: ${r.fontes.map(f => `${f.origem} (${f.ok ? 'ok' : 'FALHA'})`).join('; ')}`,
    `Total: ${r.total}; sem thread: ${r.semThread}; ambíguas: ${r.ambiguas}; fantasmas: ${r.fantasmas}; consulta: ${r.ok ? 'válida' : 'INCOMPLETA'}.`,
  ];
  // RM-056 (D4): a coluna PERFIL e o id do perfil (`processo` sem perfil), nunca o diretorio da conta.
  if (r.sessoes.length) linhas.push(tabela(['ID', 'RUNTIME', 'PERFIL', 'ESTADO', 'THREAD/FASE'],
    r.sessoes.map(s => [s.sessionId, s.runtime, s.perfil ?? 'processo',
      `${s.state ?? s.status ?? 'unknown'}${s.fantasma ? ' (fantasma)' : ''}`,
      s.vinculos.map(v => `${v.thread}/${v.fase}`).join(', ') || '(fora do ork)'])));
  if (r.fantasmas > 0) linhas.push('Fantasma: registro sem processo vivo, não ocupa vaga; `ork sessions limpar-fantasmas` solta o vínculo do ork sem tocar no runtime.');
  for (const f of r.fontes.filter(f => !f.ok)) linhas.push(`Falha: ${f.detalhe}`);
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
