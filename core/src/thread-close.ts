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
import { liberarAoFechar } from './fechamento';
import { ErroDoCatalogo } from './locale';

export function validarArtefato(raiz: string, arquivo: string, sha256: string): ProvaDeEntrega {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ErroDoCatalogo((m) => m.thread.sha256Invalido);
  const root = fs.realpathSync(raizDoEstado(raiz));
  const destino = fs.realpathSync(path.resolve(root, arquivo));
  const relativo = path.relative(root, destino);
  if (!relativo || relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) {
    throw new ErroDoCatalogo((m) => m.thread.artefatoForaDoProjeto);
  }
  if (!fs.statSync(destino).isFile()) throw new ErroDoCatalogo((m) => m.thread.artefatoNaoRegular);
  if (createHash('sha256').update(fs.readFileSync(destino)).digest('hex') !== sha256) {
    throw new ErroDoCatalogo((m) => m.thread.artefatoDiverge);
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
  if (t.fechamentoAdmin) throw new ErroDoCatalogo((m) => m.master.encerradaAdmin);
  const prova = provaDeEntrega(raiz, id);
  if (!prova) throw new ErroDoCatalogo((m) => m.master.exigeEntrega);
  return prova;
}

export function registrarArtefato(raiz: string, id: string, arquivo: string, sha256: string, por: string): ProvaDeEntrega {
  const t = lerThread(raiz, id);
  if (t.status === 'fechada' || !por.trim()) throw new ErroDoCatalogo((m) => m.thread.artefatoExige);
  const prova = validarArtefato(raiz, arquivo, sha256);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.artefatoEntregue, { arquivo, sha256, fase: 'SHIP', por: por.trim() });
  return prova;
}

export function fecharAdministrativamente(raiz: string, id: string, opcoes: { motivo: string; por: string; justificativa: string }): Thread {
  if (!['orfa', 'engano', 'superada'].includes(opcoes.motivo)) throw new ErroDoCatalogo((m) => m.thread.motivoDoFechamento);
  if (!opcoes.por.trim() || opcoes.justificativa.trim().length < 3) throw new ErroDoCatalogo((m) => m.thread.fechamentoExige);
  const t = lerThread(raiz, id);
  if (t.fechamentoAdmin) {
    if (t.fechamentoAdmin.motivo !== opcoes.motivo) throw new ErroDoCatalogo((m) => m.thread.encerradaPorOutroMotivo);
    return t;
  }
  if (provaDeEntrega(raiz, id) || t.score) throw new ErroDoCatalogo((m) => m.thread.entregueExigeMaster);
  t.fechamentoAdmin = { motivo: opcoes.motivo as MotivoFechamentoAdmin, por: opcoes.por.trim(), justificativa: opcoes.justificativa.trim(), fechadoEm: agora() };
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.threadFechadaAdmin, t.fechamentoAdmin);
  t.status = 'fechada';
  gravarThread(raiz, t);
  publicarEmSegundoPlano(raiz);
  // RM-037 (rm037noite): a thread fechada solta o que segurava, com registro no ledger dela.
  liberarAoFechar(raiz, id);
  return t;
}
