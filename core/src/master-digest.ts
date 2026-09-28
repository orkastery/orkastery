/** Uma fotografia semanal, páginas limitadas e recibos antes de marcar entrega. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { listarBatch, ratificarBatch, SelecaoMaster } from './master-batch';
import { ORDEM_DAS_CLASSES } from './master';
import { raizDoEstado } from './estado-thread';
import { redigirSegredos } from './hitl';
import { enviarPayloadHost, ReciboHost, TransportePulse, adquirirLockMonitor } from './pulse-delivery';
import { lerJson } from './util';
import { dataLocal, fusoDoDono } from './horario';

export interface PaginaDigest { contrato: 'ork.master-digest-page/v1'; texto: string; opcoes: string[] }
export interface DigestSemanal {
  contrato: 'ork.master-digest/v1'; semana: string; criadoEm: string; assinatura: string;
  selecao: SelecaoMaster[]; paginas: PaginaDigest[];
  recibos: { pagina: number; sha256: string; confirmadoEm: string; host: ReciboHost }[];
  concluidoEm: string | null;
}
export const dirDigest = (raiz: string) => path.join(raizDoEstado(raiz), '.orkastery', 'monitor', 'master-digest');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/**
 * I-35: a sexta-feira é a do fuso do dono (`owner.timezone`; sem ele, o fuso do sistema).
 * Com o dono em Brasília o dia é o mesmo de antes em qualquer `TZ` do processo.
 */
export function sextaLocal(quando: string, fuso: string = fusoDoDono().fuso): string | null {
  const data = new Date(quando);
  if (!Number.isFinite(data.getTime())) throw new Error('data inválida');
  const dia = dataLocal(data, fuso);
  return new Date(`${dia}T12:00:00Z`).getUTCDay() === 5 ? dia : null;
}
function pagina(texto: string, opcoes: string[]): PaginaDigest {
  if (texto.length > 3900 || opcoes.length > 12 || opcoes.some(o => o.length > 200)) throw new Error('página excede limite do host');
  return { contrato: 'ork.master-digest-page/v1', texto, opcoes };
}
export function montarDigest(raiz: string, quando: string): DigestSemanal {
  const semana = sextaLocal(quando);
  if (!semana) throw new Error(`digest semanal exige sexta-feira no fuso do dono (${fusoDoDono().fuso})`);
  const itens = listarBatch(raiz);
  const selecao = itens.filter(i => i.proposta && i.entregue).map(i => ({ thread: i.thread, assinatura: i.assinatura! }));
  const assinatura = hash(selecao);
  const paginas = [pagina(`Orkastery: ${itens.length} scores esperando você. Semana de ${semana.split('-').reverse().join('/')}.\nRevise as propostas nas páginas seguintes antes de aceitar o lote.\nO lote contém ${selecao.length} propostas com entrega comprovada.`,
    selecao.length ? [`ratificar-lote ${semana} ${assinatura}`] : [])];
  for (const i of itens) {
    const campo = (s: string, n: number) => redigirSegredos(s).slice(0, n);
    const texto = `Thread ${i.thread}: ${campo(i.nome, 180)}\n` + (i.proposta
      ? `Proposta: ${i.proposta.valor}/5 por ${campo(i.proposta.propostoPor, 100)}\nJustificativa: ${campo(i.proposta.justificativa, 1800)}\nClasses propostas: ${i.proposta.classes.join(', ')}\nProposta ${i.assinatura}\nEscolha a classe para ratificar este score e esta justificativa.`
      : 'Sem proposta. Registre score e justificativa após revisar a entrega.') + (!i.entregue ? '\nFalta prova de entrega; ratificação indisponível.' : '');
    paginas.push(pagina(texto, i.proposta && i.entregue ? ORDEM_DAS_CLASSES.map(c => `ratificar ${i.thread} ${i.assinatura} ${c}`) : []));
  }
  return { contrato: 'ork.master-digest/v1', semana, criadoEm: quando, assinatura, selecao, paginas, recibos: [], concluidoEm: null };
}
function salvar(file: string, job: DigestSemanal): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function lerDigest(raiz: string, semana: string): DigestSemanal {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) throw new Error('semana inválida');
  const job = lerJson<DigestSemanal>(path.join(dirDigest(raiz), `${semana}.json`));
  if (job.contrato !== 'ork.master-digest/v1' || job.semana !== semana || hash(job.selecao) !== job.assinatura ||
      !Array.isArray(job.paginas) || !Array.isArray(job.recibos)) throw new Error('digest inválido');
  return job;
}
export function responderLoteDigest(raiz: string, resposta: string, por: string) {
  const partes = resposta.trim().split(/\s+/);
  if (partes.length !== 3 || partes[0] !== 'ratificar-lote') throw new Error('resposta de lote inválida');
  const job = lerDigest(raiz, partes[1]);
  if (!job.concluidoEm || partes[2] !== job.assinatura) throw new Error('lote não entregue ou assinatura divergente');
  return ratificarBatch(raiz, job.selecao, por);
}
export function enviarDigest(opcoes: { raiz: string; quando?: string; transporte?: TransportePulse; enviar?: (p: PaginaDigest) => ReciboHost }): { code: number; detalhe: string; enviadas: number; semana: string | null } {
  const quando = opcoes.quando ?? new Date().toISOString(), semana = sextaLocal(quando);
  if (!semana) return { code: 0, detalhe: `fora da sexta-feira no fuso do dono (${fusoDoDono().fuso})`, enviadas: 0, semana };
  const raiz = raizDoEstado(opcoes.raiz), dir = dirDigest(raiz);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'envio.lock'), file = path.join(dir, `${semana}.json`);
  const trava = adquirirLockMonitor(lock);
  if (!trava.ok) return { code: 1, detalhe: trava.detalhe, enviadas: 0, semana };
  let enviadas = 0;
  try {
    const job = fs.existsSync(file) ? lerDigest(raiz, semana) : montarDigest(raiz, quando);
    if (job.concluidoEm) return { code: 0, detalhe: 'semana já confirmada', enviadas, semana };
    salvar(file, job);
    const config = opcoes.transporte ?? (!opcoes.enviar ? lerJson<TransportePulse>(path.join(raiz, '.orkastery/monitor/master-host.json')) : undefined);
    for (const [indice, p] of job.paginas.entries()) {
      if (job.recibos.some(r => r.pagina === indice && r.sha256 === hash(p))) continue;
      const recibo = opcoes.enviar ? opcoes.enviar(p) : enviarPayloadHost(raiz, config!, p);
      if (recibo.success !== true || !Number.isInteger(recibo.message_id) || recibo.message_id <= 0 || !recibo.platform) throw new Error('recibo inválido');
      job.recibos.push({ pagina: indice, sha256: hash(p), confirmadoEm: quando, host: recibo });
      enviadas++; salvar(file, job);
    }
    job.concluidoEm = quando; salvar(file, job);
    return { code: 0, detalhe: 'digest confirmado pelo host', enviadas, semana };
  } catch (e) { return { code: 1, detalhe: (e as Error).message, enviadas, semana }; }
  finally { trava.liberar(); }
}
