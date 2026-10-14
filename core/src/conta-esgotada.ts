/** RM-064 T1/T2: uma cota esgotada pertence à conta, não só à sessão que a revelou. */
import { createHash } from 'node:crypto';
import { ambienteDoPerfil, pararAchada } from './adapters/claude-bg';
import { lerLedger, registrarSeExiste, threadPresente, TIPOS_DE_EVENTO } from './ledger';
import { listarProjetos } from './projeto-alvo';
import { chaveDaConta, perfilDoRegistro, PerfilDeDespacho } from './runtime-profiles';
import { comLockDeSessao } from './session-events';
import { inventariarSessoes, InventarioDeSessoes } from './sessoes-inventario';
import { dirThread, lerThread, listarIds } from './thread';
import { SinalDeFalhaDeConta } from './types';

export interface EpisodioDeContaEsgotada {
  raiz: string;
  perfil: PerfilDeDespacho;
  falha: SinalDeFalhaDeConta;
  esgotadoAte: string;
  erroEm: string;
  agoraMs?: number;
}

export interface SessaoReconciliada {
  raiz: string; thread: string; fase: string; sessionId: string;
  parada: boolean; registrada: boolean; detalhe: string;
}

export interface ResultadoDaContaEsgotada {
  conta: string; episodio: string; completo: boolean;
  sessoes: SessaoReconciliada[]; falhas: string[];
}

export interface DependenciasDaContaEsgotada {
  inventario: (raiz: string) => InventarioDeSessoes;
  projetos: (raiz: string) => string[];
  parar: (sessionId: string, id: string | undefined, perfil: PerfilDeDespacho) => { ok: boolean; detalhe: string };
}

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const padrao: DependenciasDaContaEsgotada = {
  inventario: (raiz) => inventariarSessoes(raiz, { global: true, todas: true, prazoMs: 30_000 }),
  projetos: (raiz) => [...new Set([raiz, ...listarProjetos().filter((p) => p.presente).map((p) => p.raiz)])],
  parar: (sessionId, id, perfil) => {
    const r = pararAchada({ sessionId, ...(id ? { id } : {}) }, ambienteDoPerfil(perfil));
    return { ok: r.ok, detalhe: r.texto || (r.ok ? 'runtime confirmou a parada' : 'runtime recusou a parada') };
  },
};

interface VinculoConfirmado { raiz: string; thread: string; fase: string; despachoEm: string }

function vinculosDaConta(projetos: readonly string[], sessionId: string, conta: string): { vinculos: VinculoConfirmado[]; falhas: string[] } {
  const vinculos: VinculoConfirmado[] = [], falhas: string[] = [];
  for (const raiz of projetos) {
    let ids: string[];
    try { ids = listarIds(raiz); } catch (e) { falhas.push(`projeto não lido: ${(e as Error).message}`); continue; }
    for (const id of ids) {
      try {
        const thread = lerThread(raiz, id);
        const sessao = thread.sessoes.find((s) => s.sessionId === sessionId && s.origem !== 'adocao');
        if (!sessao?.despachadaEm) continue;
        const eventos = lerLedger(dirThread(raiz, id));
        const perfil = perfilDoRegistro(eventos, { sessionId, despachadaEm: sessao.despachadaEm });
        if (!perfil || chaveDaConta(perfil) !== conta) continue;
        vinculos.push({ raiz, thread: id, fase: sessao.fase, despachoEm: sessao.despachadaEm });
      } catch (e) { falhas.push(`vínculo ${id} não confirmado: ${(e as Error).message}`); }
    }
  }
  return { vinculos: vinculos.filter((v, i, a) => a.findIndex((x) => x.raiz === v.raiz && x.thread === v.thread) === i), falhas };
}

/**
 * Para cada sessão viva da mesma conta: prova o vínculo pelo ledger, pede a parada uma vez e só
 * então grava o terminal que libera a condução. Consulta incompleta nunca vira falso sucesso.
 */
export function reconciliarContaEsgotada(entrada: EpisodioDeContaEsgotada,
    deps: DependenciasDaContaEsgotada = padrao): ResultadoDaContaEsgotada {
  const agoraMs = entrada.agoraMs ?? Date.now();
  const contaBruta = chaveDaConta(entrada.perfil), conta = sha(contaBruta);
  const episodio = sha([conta, entrada.erroEm, entrada.esgotadoAte]);
  const inv = deps.inventario(entrada.raiz);
  const projetos = deps.projetos(entrada.raiz);
  const falhas = inv.fontes.filter((f) => !f.ok).map((f) => f.detalhe);
  const sessoes: SessaoReconciliada[] = [];
  const candidatas = inv.sessoes.filter((s) => s.runtime === entrada.perfil.runtime && s.perfil === entrada.perfil.id && s.viva);
  for (const sessao of candidatas) {
    const achados = vinculosDaConta(projetos, sessao.sessionId, contaBruta);
    falhas.push(...achados.falhas);
    if (achados.vinculos.length === 0) continue;
    const pendentes = achados.vinculos.filter((v) => !lerLedger(dirThread(v.raiz, v.thread)).some((e) =>
      e.tipo === 'phase_result' && e.quotaEpisodeId === episodio && e.sessionId === sessao.sessionId));
    for (const v of achados.vinculos.filter((x) => !pendentes.includes(x))) {
      sessoes.push({ ...v, sessionId: sessao.sessionId, parada: true, registrada: false, detalhe: 'episódio já reconciliado' });
    }
    if (pendentes.length === 0) continue;
    if (sessao.runtime !== 'claude-bg') {
      for (const v of pendentes) sessoes.push({ ...v, sessionId: sessao.sessionId, parada: false, registrada: false,
        detalhe: 'sessão codex viva exige controller vinculado; parada não inferida' });
      falhas.push(`sessão ${sessao.sessionId} não parada: controller codex não comprovado`);
      continue;
    }
    const parada = deps.parar(sessao.sessionId, sessao.id, entrada.perfil);
    for (const v of pendentes) {
      const dir = dirThread(v.raiz, v.thread);
      if (!parada.ok || !threadPresente(dir)) {
        sessoes.push({ ...v, sessionId: sessao.sessionId, parada: parada.ok, registrada: false, detalhe: parada.detalhe });
        continue;
      }
      let registrada = false;
      comLockDeSessao(dir, () => {
        const atuais = lerLedger(dir);
        if (atuais.some((e) => e.tipo === 'phase_result' && e.quotaEpisodeId === episodio && e.sessionId === sessao.sessionId)) return;
        const dados = { fase: v.fase, sessionId: sessao.sessionId, despachoEm: v.despachoEm, runtime: sessao.runtime,
          motivo: 'runtime.quota-exhausted', quotaEpisodeId: episodio, conta, resetEm: entrada.falha.resetEm,
          esgotadoAte: entrada.esgotadoAte, observadoEm: new Date(agoraMs).toISOString(), origem: 'account.quota-exhausted',
          perfil: { id: entrada.perfil.id, runtime: entrada.perfil.runtime },
          falhaDeConta: { motivo: entrada.falha.motivo, resetEm: entrada.falha.resetEm,
            fonte: entrada.falha.fonte, trecho: entrada.falha.trecho },
          evidencia: 'vínculo da sessão, conta do despacho e parada confirmados pelo núcleo' };
        registrarSeExiste(dir, v.thread, 'runtime_account_exhausted', dados);
        registrarSeExiste(dir, v.thread, TIPOS_DE_EVENTO.gateBloqueado, { ...dados, gate: 'phase.dispatch',
          modo: lerThread(v.raiz, v.thread).modo, detalhe: 'a conta do despacho esgotou; retomar no próximo destino capaz',
          correcao: `ork retry run ${v.thread}` });
        registrarSeExiste(dir, v.thread, 'phase_result', { ...dados, sensorResultId: `quota:${episodio}:${sessao.sessionId}`,
          classificacao: 'gate_blocked', ok: false, estado: 'bloqueada', paradaConfirmada: true });
        registrada = true;
      });
      sessoes.push({ ...v, sessionId: sessao.sessionId, parada: true, registrada,
        detalhe: registrada ? 'sessão parada e condução liberada' : 'episódio já reconciliado' });
    }
  }
  return { conta, episodio, completo: inv.ok && falhas.length === 0 && sessoes.every((s) => s.parada && (s.registrada || s.detalhe.includes('já'))),
    sessoes, falhas };
}
