/** Encerramento administrativo não representa uma entrega nem um score humano. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirThread, lerThread, gravarThread } from './thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { raizDoEstado } from './estado-thread';
import { MotivoFechamentoAdmin, ProvaDeEntrega, Thread } from './types';
import { agora } from './util';
import { publicarEmSegundoPlano } from './fabrica-publicar';

export function validarArtefato(raiz: string, arquivo: string, sha256: string): ProvaDeEntrega {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('sha256 inválido');
  const root = fs.realpathSync(raizDoEstado(raiz));
  const destino = fs.realpathSync(path.resolve(root, arquivo));
  const relativo = path.relative(root, destino);
  if (!relativo || relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) {
    throw new Error('artefato deve estar dentro do projeto');
  }
  if (!fs.statSync(destino).isFile()) throw new Error('artefato deve ser arquivo regular');
  if (createHash('sha256').update(fs.readFileSync(destino)).digest('hex') !== sha256) {
    throw new Error('hash do artefato diverge');
  }
  return { tipo: 'artefato', arquivo: relativo, sha256 };
}

export function provaDeEntrega(raiz: string, id: string): ProvaDeEntrega | null {
  const eventos = lerLedger(dirThread(raiz, id));
  const ship = [...eventos].reverse().find(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
  if (ship) return { tipo: 'ship', ts: ship.ts, mergeSha: String(ship.mergeSha ?? '') };
  for (const e of eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.artefatoEntregue).reverse()) {
    try { return validarArtefato(raiz, String(e.arquivo), String(e.sha256)); } catch { /* prova precisa continuar válida */ }
  }
  return null;
}

export function exigirEntrega(raiz: string, id: string): ProvaDeEntrega {
  const t = lerThread(raiz, id);
  if (t.fechamentoAdmin) throw new Error('thread encerrada administrativamente não pode receber MASTER');
  const prova = provaDeEntrega(raiz, id);
  if (!prova) throw new Error('MASTER exige entrega: ship_done ou artefato existente com hash verificado');
  return prova;
}

export function registrarArtefato(raiz: string, id: string, arquivo: string, sha256: string, por: string): ProvaDeEntrega {
  const t = lerThread(raiz, id);
  if (t.status === 'fechada' || !por.trim()) throw new Error('artefato exige thread aberta e autoria explícita');
  const prova = validarArtefato(raiz, arquivo, sha256);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.artefatoEntregue, { arquivo, sha256, fase: 'SHIP', por: por.trim() });
  return prova;
}

export function fecharAdministrativamente(raiz: string, id: string, opcoes: { motivo: string; por: string; justificativa: string }): Thread {
  if (!['orfa', 'engano', 'superada'].includes(opcoes.motivo)) throw new Error('motivo deve ser orfa, engano ou superada');
  if (!opcoes.por.trim() || opcoes.justificativa.trim().length < 3) throw new Error('fechamento exige autoria e justificativa');
  const t = lerThread(raiz, id);
  if (t.fechamentoAdmin) {
    if (t.fechamentoAdmin.motivo !== opcoes.motivo) throw new Error('thread já encerrada por outro motivo');
    return t;
  }
  if (provaDeEntrega(raiz, id) || t.score) throw new Error('thread entregue ou pontuada exige MASTER, não fechamento administrativo');
  t.fechamentoAdmin = { motivo: opcoes.motivo as MotivoFechamentoAdmin, por: opcoes.por.trim(), justificativa: opcoes.justificativa.trim(), fechadoEm: agora() };
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.threadFechadaAdmin, t.fechamentoAdmin);
  t.status = 'fechada';
  gravarThread(raiz, t);
  publicarEmSegundoPlano(raiz);
  return t;
}
