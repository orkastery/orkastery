import { exigirAtivacao } from './write-activation';
/** Publicacao de atos humanos comprovados. Texto automatico nunca autentica uma pessoa. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ManifestoCarregado, exigirManifesto } from './manifest';
import { dirThread, listarIds, lerThread } from './thread';
import { registrar } from './ledger';
import { raizDoEstado } from './estado-thread';
import { EventoLedger, EntradaNova, ResultadoDeGravacao } from './types';
import type { Memoria } from './memoria';
import { THREADS_PROTEGIDAS, validarDiretorioDeThread } from './escopo-escrita';
import { aprovacaoHumanaProvada } from './gates';
import { ehContratoDePedido } from './hitl-contract';

export interface ProvenienciaDeGate { source: 'human'; evidencia: string; evidenciaSha256?: string }
export interface GateInventariado {
  tenant: string;
  thread: string;
  linha: number;
  evento: string;
  sha256: string;
  elegivel: boolean;
  motivo: string;
  autor: string;
  evidencia: string | null;
  evidenciaSha256: string | null;
}
export interface ResultadoDeMemoriaHumana {
  inventario: GateInventariado[];
  resultados: Array<{ evento: string; gravacao: ResultadoDeGravacao }>;
  elegiveis: number;
  excluidos: number;
  falhas: number;
}

export function eventoAutomatico(e: Record<string, unknown>): boolean {
  return e.automatico === true || e.automated === true ||
    /watchdog|automatizad|autom[aá]ti[cz]|auto[- ]?(?:aprov|avan[cç])/i.test(
      [e.autorizadoPor, e.autor, e.observacao, e.origem, e.via].filter(v => typeof v === 'string').join(' '));
}

/** Evidencia deve existir no estado canonico da propria thread, inclusive apos SHIP. */
export function evidenciaDeGate(raiz: string, threadId: string, referencia: string): { arquivo: string; sha256: string } | null {
  const dir = dirThread(raiz, threadId);
  const nome = referencia.split('#')[0];
  if (!nome) return null;
  const candidatos = [path.resolve(dir, nome), path.resolve(raiz, nome), path.resolve(raizDoEstado(raiz), nome)];
  for (const candidato of candidatos) {
    if (!fs.existsSync(candidato) || !fs.statSync(candidato).isFile()) continue;
    const real = fs.realpathSync(candidato), canonico = fs.realpathSync(dir);
    if (!real.startsWith(canonico + path.sep)) continue;
    const bytes = fs.readFileSync(real);
    if (!bytes.length) return null;
    return { arquivo: `.orkastery/threads/${threadId}/${path.relative(canonico, real).split(path.sep).join('/')}`,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return null;
}

/** Inventario somente leitura, incluindo pendencias, automacao e autoria ambigua. */
export function inventariarGatesHumanos(carregado: ManifestoCarregado, somenteThread?: string): GateInventariado[] {
  const { raiz, manifesto } = carregado;
  const tenant = manifesto.memory.tenant || manifesto.project.name;
  const resultado: GateInventariado[] = [];
  for (const id of somenteThread ? [somenteThread] : listarIds(raiz)) {
    if (THREADS_PROTEGIDAS.has(id.toLowerCase())) continue;
    const thread = lerThread(raiz, id);
    const arquivo = path.join(dirThread(raiz, id), 'ledger.jsonl');
    if (!fs.existsSync(arquivo)) continue;
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (!linhas[i].trim()) continue;
      let e: EventoLedger;
      try { e = JSON.parse(linhas[i]); } catch { throw new Error('memory.human.ledger-invalid'); }
      if (e.tipo !== 'human_gate') continue;
      const autor = typeof e.autorizadoPor === 'string' ? e.autorizadoPor.trim() : typeof e.autor === 'string' ? e.autor.trim() : '';
      const evidencia = typeof e.evidencia === 'string' ? evidenciaDeGate(raiz, id, e.evidencia) : null;
      let motivo = 'elegivel';
      if (thread.projeto.name !== manifesto.project.name || (e.tenant && e.tenant !== tenant)) motivo = 'tenant_nao_confirmado';
      else if (e.thread !== id) motivo = 'evento_de_outra_thread';
      else if (e.estado !== 'aprovado') motivo = 'nao_confirmado';
      else if (eventoAutomatico(e)) motivo = 'automacao_declarada';
      // I-41 (T4c): as duas versoes entram na memoria, por lista fechada. O que torna a autoria
      // ambigua e o contrato ser DESCONHECIDO, nao ser a versao nova; recusar v2 faria a
      // aprovacao do dono deixar de ser dele aos olhos da memoria.
      else if (e.source !== 'human' || !ehContratoDePedido(e.contrato)) motivo = 'autoria_ambigua';
      else if (!evidencia) motivo = 'evidencia_ausente';
      else if (e.evidenciaSha256 && e.evidenciaSha256 !== evidencia.sha256) motivo = 'evidencia_divergente';
      else if (!aprovacaoHumanaProvada(raiz, id, e)) motivo = 'autoria_ambigua';
      resultado.push({ tenant, thread: id, linha: i + 1,
        evento: `.orkastery/threads/${id}/ledger.jsonl#evento:${i + 1}`,
        sha256: createHash('sha256').update(linhas[i]).digest('hex'), elegivel: motivo === 'elegivel', motivo, autor,
        evidencia: evidencia?.arquivo ?? null, evidenciaSha256: evidencia?.sha256 ?? null });
    }
  }
  return resultado;
}

function entradaDoGate(carregado: ManifestoCarregado, item: GateInventariado): EntradaNova {
  const linhas = fs.readFileSync(path.join(dirThread(carregado.raiz, item.thread), 'ledger.jsonl'), 'utf8').split('\n');
  const linha = linhas[item.linha - 1];
  if (createHash('sha256').update(linha).digest('hex') !== item.sha256) throw new Error('memory.human.event-changed');
  if (evidenciaDeGate(carregado.raiz, item.thread, item.evidencia!)?.sha256 !== item.evidenciaSha256) {
    throw new Error('memory.human.evidence-changed');
  }
  const e = JSON.parse(linha) as EventoLedger;
  const fase = typeof e.fase === 'string' ? e.fase : 'desconhecida';
  return { collection: 'decision', source: 'human', priority: 'high',
    content: `Decisao humana confirmada por ${item.autor} na thread ${item.thread}.\n` +
      `Assunto: ${typeof e.sobre === 'string' ? e.sobre : 'nao declarado'}.\n` +
      `Resposta registrada: ${typeof e.observacao === 'string' && e.observacao ? e.observacao : 'Aprovacao confirmada no evento original, sem observacao adicional.'}\n` +
      `Evento: ${item.evento}, em ${e.ts}.\nEvidencia humana: ${item.evidencia}`,
    tags: { project: [item.tenant], skill: [fase, 'orkastery-decision'],
      situation: ['human_gate', `thread:${item.thread}`, `fase:${fase}`], agent: ['desconhecido:desconhecido', 'ork'] },
    metadata: { tenant: item.tenant, thread: item.thread, eventoOriginal: e,
      proveniencia: { tipo: 'human_gate', source: 'human', confirmado: true, autor: item.autor,
        origem: e.origem, canal: typeof e.canal === 'string' ? e.canal : null,
        evento: item.evento, sha256: item.sha256, evidencia: item.evidencia, evidenciaSha256: item.evidenciaSha256 } } };
}

/** Publica eventos apenas da thread autorizada; inventario nao autoriza escrita cruzada. */
export function publicarGatesHumanos(
  carregado: ManifestoCarregado, memoria: Memoria, somenteThread?: string
): ResultadoDeMemoriaHumana {
  if (!somenteThread) throw new Error('scope.write.required');
  validarDiretorioDeThread(carregado.raiz, somenteThread);
  const inventario = inventariarGatesHumanos(carregado, somenteThread);
  const resultados = inventario.filter(i => i.elegivel).map(item => {
    let gravacao: ResultadoDeGravacao;
    try {
      validarDiretorioDeThread(carregado.raiz, item.thread);
      gravacao = memoria.gravar(entradaDoGate(carregado, item));
    }
    catch { gravacao = { ok: false, id: null, duplicada: false, collection: 'decision', detalhe: 'memory.human.publication-failed' }; }
    return { evento: item.evento, gravacao };
  });
  const resultado = { inventario, resultados, elegiveis: resultados.length,
    excluidos: inventario.filter(i => !i.elegivel).length,
    falhas: resultados.filter(r => !r.gravacao.ok).length };
  for (const id of new Set(inventario.map(i => i.thread))) {
    const daThread = resultados.filter(r => r.evento.startsWith(`.orkastery/threads/${id}/`));
    if (!daThread.length) continue;
    registrar(dirThread(carregado.raiz, id), id, 'human_memory_sync', {
      tenant: memoria.estado.tenant, regime: memoria.regime, resultados: daThread,
      excluidos: inventario.filter(i => i.thread === id && !i.elegivel).map(i => ({ evento: i.evento, motivo: i.motivo })) });
  }
  return resultado;
}

export interface PublicacaoDeAprovacao {
  estado: 'publicada' | 'pendente';
  motivo: string | null;
  recuperar: string;
}

/** O gate ja e durable. Falha posterior e uma pendencia de publicacao recuperavel. */
export function publicarAprovacaoHumana(
  raiz: string, threadId: string, aprovacao: EventoLedger
): PublicacaoDeAprovacao {
  const recuperar = `ork memory sync ${threadId}`;
  try {
    const carregado = exigirManifesto(raiz);
    if (carregado.manifesto.memory.mode === 'orkmind') exigirAtivacao(carregado, threadId, 'memory');
    const { abrirMemoria } = require('./memoria') as typeof import('./memoria');
    const r = publicarGatesHumanos(carregado, abrirMemoria(carregado), threadId);
    const sha256 = createHash('sha256').update(JSON.stringify(aprovacao)).digest('hex');
    const alvo = r.inventario.find(i => i.sha256 === sha256 && i.elegivel);
    if (r.falhas === 0 && alvo && r.resultados.some(i => i.evento === alvo.evento && i.gravacao.ok)) {
      return { estado: 'publicada', motivo: null, recuperar };
    }
  } catch { /* Erros arbitrarios de driver, manifesto ou evidencia nao entram no ledger. */ }
  const motivo = 'memory.human.publication-pending';
  registrar(dirThread(raiz, threadId), threadId, 'human_memory_sync_failed', {
    motivo, aprovacaoPersistida: true, recuperar,
  });
  return { estado: 'pendente', motivo, recuperar };
}
