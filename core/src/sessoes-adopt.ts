/** Adoção é registro de uma identidade existente, nunca despacho ou retomada. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ManifestoCarregado } from './manifest';
import { raizDoEstado } from './estado-thread';
import { inventariarSessoes, VinculoDeSessao } from './sessoes-inventario';
import { novaThread, dirThread, gravarThread } from './thread';
import { registrar } from './ledger';
import { agora } from './util';
import { Thread } from './types';
import { adquirirLockMonitor } from './pulse-delivery';

/** Classificação pura: reconhece adoções legadas sem regravar seus IDs ou ledgers. */
export function ehRegistroDeAdocao(thread: Thread): boolean {
  return (thread.origem === 'adocao' || thread.sessoes.length > 0) &&
    thread.sessoes.every(s => s.origem === 'adocao');
}

export interface ResultadoAdocao {
  ok: boolean; criada: boolean; sessionId?: string; runtime?: string;
  vinculo?: VinculoDeSessao; motivo?: string; detalhe: string;
}

export function adotarSessao(carregado: ManifestoCarregado, chave: string): ResultadoAdocao {
  if (!/^[a-f0-9-]{8,}$/i.test(chave)) return {
    ok: false, criada: false, motivo: 'session.invalid', detalhe: 'use identidade exata ou prefixo de pelo menos oito caracteres',
  };
  const raiz = raizDoEstado(carregado.raiz);
  const lock = path.join(raiz, '.orkastery/sessions-adopt.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const ocupada: ResultadoAdocao = { ok: false, criada: false, motivo: 'lease.busy',
    detalhe: 'adoção em curso ou lock sem dono comprovadamente morto; preserve o lock e consulte o proprietário' };
  // A guarda oficial serializa a recuperação; o arquivo mantém compatibilidade com adoções anteriores.
  const guarda = adquirirLockMonitor(lock + '.guard');
  if (!guarda.ok) return ocupada;
  let fd: number | undefined;
  let corpo = '';
  try {
    try {
      try { fd = fs.openSync(lock, 'wx', 0o600); }
      catch (erro) {
        if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') return ocupada;
        const antes = fs.lstatSync(lock);
        if (!antes.isFile()) return ocupada;
        const conteudo = fs.readFileSync(lock, 'utf8');
        const pid = JSON.parse(conteudo).pid;
        if (!Number.isInteger(pid) || pid <= 0) return ocupada;
        try { process.kill(pid, 0); return ocupada; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return ocupada; }
        const atual = fs.lstatSync(lock);
        if (atual.ino !== antes.ino || atual.dev !== antes.dev || fs.readFileSync(lock, 'utf8') !== conteudo) return ocupada;
        fs.unlinkSync(lock);
        fd = fs.openSync(lock, 'wx', 0o600);
      }
      corpo = JSON.stringify({ pid: process.pid, criadaEm: agora() });
      fs.writeFileSync(fd, corpo);
    } catch { return ocupada; }
    const inventario = inventariarSessoes(raiz, { global: true, todas: true });
    if (!inventario.ok) return { ok: false, criada: false, motivo: 'runtime.unavailable',
      detalhe: 'inventário incompleto ou ambíguo; consulte sessions --global --all --json' };
    const exatas = inventario.sessoes.filter(s => s.sessionId === chave);
    const candidatas = exatas.length ? exatas : inventario.sessoes.filter(s => s.sessionId.startsWith(chave));
    if (candidatas.length !== 1) return { ok: false, criada: false,
      motivo: candidatas.length ? 'session.ambiguous' : 'session.missing',
      detalhe: candidatas.length ? 'prefixo identifica mais de uma sessão' : 'identidade não encontrada no runtime' };
    const s = candidatas[0];
    if (s.vinculos.length === 1) return { ok: true, criada: false, sessionId: s.sessionId,
      runtime: s.runtime, vinculo: s.vinculos[0], detalhe: 'vínculo existente preservado' };
    const assunto = 'ad' + createHash('sha256').update(s.runtime + ':' + s.sessionId).digest('hex').slice(0, 10);
    // Preparar a thread inteira antes da gravação evita uma janela sem identidade.
    const { thread } = novaThread({ ...carregado, raiz }, { nome: `Sessão adotada ${s.runtime} ${s.sessionId}`,
      assunto, modo: 'auto', dryRun: true });
    const dir = dirThread(raiz, thread.id);
    if (fs.existsSync(dir)) return { ok: false, criada: false, motivo: 'session.conflict',
      detalhe: 'domicílio de adoção já existe sem vínculo confirmado; preservar e reconciliar' };
    const adotadaEm = agora();
    thread.origem = 'adocao';
    thread.sessoes.push({ sessionId: s.sessionId, runtime: s.runtime, slug: thread.slug,
      fase: thread.faseAtual, bloco: 'ad-hoc', origem: 'adocao', adotadaEm, cwdOrigem: s.cwd!, verificada: true });
    gravarThread(raiz, thread);
    registrar(dir, thread.id, 'session_adopted', { sessionId: s.sessionId, runtime: s.runtime,
      origem: 'adocao', adotadaEm, cwdOrigem: s.cwd, por: 'ork sessions adopt',
      evidencia: inventario.fontes.filter(f => f.ok).map(f => f.origem) });
    return { ok: true, criada: true, sessionId: s.sessionId, runtime: s.runtime,
      vinculo: { raiz, thread: thread.id, fase: thread.faseAtual, origem: path.join(dir, 'thread.json') },
      detalhe: 'sessão real adotada em thread ad hoc Auto' };
  } finally {
    try {
      if (fd !== undefined) {
        const nosso = fs.fstatSync(fd);
        fs.closeSync(fd);
        if (fs.existsSync(lock)) {
          const atual = fs.lstatSync(lock);
          if (atual.ino === nosso.ino && atual.dev === nosso.dev && fs.readFileSync(lock, 'utf8') === corpo) fs.unlinkSync(lock);
        }
      }
    } finally { guarda.liberar(); }
  }
}
