/** Indicadores operacionais: ausência de evidência nunca conta como aprovação. */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { listarIds, lerThread, dirThread } from './thread';
import { lerLedger } from './ledger';
import { lerMasterLog, masterRatificado } from './master';
import { lerDigest, sextaLocal, DigestSemanal, dirDigest } from './master-digest';

export function reciboSemanalValido(job: DigestSemanal): boolean {
  if (!job.concluidoEm || sextaLocal(job.concluidoEm) !== job.semana || !job.paginas.length ||
      job.recibos.length !== job.paginas.length || new Set(job.recibos.map(r => r.pagina)).size !== job.paginas.length) return false;
  return job.paginas.every((p, pagina) => {
    const r = job.recibos.find(r => r.pagina === pagina);
    return !!r && r.sha256 === createHash('sha256').update(JSON.stringify(p)).digest('hex') &&
      r.host.success === true && Number.isInteger(r.host.message_id) && r.host.message_id > 0 &&
      typeof r.host.platform === 'string' && !!r.host.platform.trim() &&
      Number.isFinite(Date.parse(r.confirmadoEm)) && Date.parse(r.confirmadoEm) >= Date.parse(job.criadoEm) &&
      Date.parse(r.confirmadoEm) <= Date.parse(job.concluidoEm!);
  });
}
export function auditarMaster(raiz: string, quando = new Date().toISOString()) {
  const fim = Date.parse(quando), inicio = fim - 30 * 86400000;
  if (!Number.isFinite(fim)) throw new Error('data de auditoria inválida');
  const fechadas: { thread: string; ok: boolean; tipo: string }[] = [], classes = new Set<string>();
  for (const id of listarIds(raiz)) {
    const t = lerThread(raiz, id);
    if (t.status !== 'fechada') continue;
    const data = Date.parse(t.atualizadaEm);
    if (Number.isFinite(data) && (data < inicio || data > fim)) continue;
    const eventos = lerLedger(dirThread(raiz, id));
    const admin = t.fechamentoAdmin && !t.score && eventos.some(e => e.tipo === 'thread_closed_admin' &&
      e.motivo === t.fechamentoAdmin!.motivo && e.por === t.fechamentoAdmin!.por && e.fechadoEm === t.fechamentoAdmin!.fechadoEm);
    const log = masterRatificado(raiz, id) ? lerMasterLog(raiz, id) : null;
    const ok = Number.isFinite(data) && !!(admin || log);
    fechadas.push({ thread: id, ok, tipo: admin ? 'administrativo' : log ? 'ratificado' : 'sem-prova' });
    if (ok && log) log.classesDeFalha.forEach(c => classes.add(c));
  }
  let sexta: string | null = null, referencia = fim;
  for (let n = 0; n < 7 && !sexta; n++, referencia -= 86400000) sexta = sextaLocal(new Date(referencia).toISOString());
  const semanas = [21, 14, 7, 0].map(dias => new Date(Date.parse(`${sexta}T12:00:00Z`) - dias * 86400000).toISOString().slice(0, 10));
  const recibos = semanas.map(semana => {
    try {
      const job = lerDigest(raiz, semana);
      return { semana, ok: reciboSemanalValido(job) && Date.parse(job.concluidoEm!) <= fim, paginas: job.paginas.length };
    } catch { return { semana, ok: false, paginas: 0 }; }
  });
  const conformes = fechadas.filter(f => f.ok).length;
  const cobertura = { ok: fechadas.length > 0 && conformes === fechadas.length, total: fechadas.length, conformes,
    percentual: fechadas.length ? 100 * conformes / fechadas.length : null, threads: fechadas };
  const distribuicao = { ok: classes.size >= 3, minimo: 3, classes: [...classes].sort() };
  const digest = { ok: recibos.every(r => r.ok), semanas: recibos,
    arquivosObservados: fs.existsSync(dirDigest(raiz)) ? fs.readdirSync(dirDigest(raiz)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length : 0 };
  return { contrato: 'ork.master-audit/v1', consultadoEm: quando, janelaDias: 30,
    ok: cobertura.ok && distribuicao.ok && digest.ok, cobertura, distribuicao, digest,
    limite: 'Testes controlados provam o mecanismo; somente estado e recibos operacionais satisfazem estes KPIs.' };
}
