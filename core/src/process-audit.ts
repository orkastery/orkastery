/** PR1..PR3 derivados do estado canônico, sem runtime de LLM. */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ManifestoCarregado } from './manifest';
import { dirThread, listarIds, lerThread } from './thread';
import { lerLedger } from './ledger';
import { caminhoMasterLog, masterRatificado, CONTRATO_MASTER_LOG, CONTRATO_MASTER_PENDENTE } from './master';
import { provaDeEntrega } from './thread-close';
import { raizDoEstado } from './estado-thread';
import { registrarAchado, lerBoard, carimbarAchado } from './divida';
import { POSTURA_DO_ESTAGIO } from './auditoria';

export interface AchadoProcesso { regra: 'PR1' | 'PR2' | 'PR3'; chave: string; threads: string[]; motivo: string; evidencia: string[] }
export function inspecionarProcesso(raiz: string): AchadoProcesso[] {
  const achados: AchadoProcesso[] = [], motivos = new Map<string, Set<string>>();
  const adicionar = (regra: AchadoProcesso['regra'], threads: string[], motivo: string) => {
    threads.sort();
    const chave = createHash('sha256').update(JSON.stringify(regra === 'PR3' ? [regra, motivo] : [regra, threads, motivo])).digest('hex');
    achados.push({ regra, chave, threads, motivo, evidencia: threads.map(id => `.orkastery/threads/${id}/ledger.jsonl`) });
  };
  for (const id of listarIds(raiz)) {
    const t = lerThread(raiz, id), eventos = lerLedger(dirThread(raiz, id));
    if (!t.fechamentoAdmin && provaDeEntrega(raiz, id)) {
      let temLog = false;
      try {
        const log = JSON.parse(fs.readFileSync(caminhoMasterLog(raiz, id), 'utf8'));
        temLog = log.thread === id && [CONTRATO_MASTER_LOG, CONTRATO_MASTER_PENDENTE].includes(log.contrato);
      } catch { /* ausência ou JSON inválido é PR1 */ }
      if (!temLog) adicionar('PR1', [id], 'entrega sem MASTER log válido');
      if (!masterRatificado(raiz, id)) adicionar('PR2', [id], 'entrega sem ratificação humana');
    }
    for (const e of eventos) if (e.tipo === 'gate_blocked' && typeof e.motivo === 'string' && e.motivo.trim()) {
      const ids = motivos.get(e.motivo) ?? new Set<string>(); ids.add(id); motivos.set(e.motivo, ids);
    }
  }
  for (const [motivo, ids] of motivos) if (ids.size >= 2) adicionar('PR3', [...ids], motivo);
  return achados.sort((a, b) => a.chave.localeCompare(b.chave));
}
export function auditarProcesso(carregado: ManifestoCarregado, registrarNoBoard = false) {
  const raiz = raizDoEstado(carregado.raiz), { manifesto } = carregado;
  const achados = inspecionarProcesso(raiz), postura = POSTURA_DO_ESTAGIO[manifesto.project.stage];
  const ids: string[] = [];
  if (registrarNoBoard) {
    const existentes = lerBoard(raiz);
    for (const a of achados) {
      const rodada = `process-${a.chave}`;
      const anterior = existentes.find(e => e.rodada === rodada && e.regra === a.regra);
      if (anterior) {
        const descricao = `${a.threads.join(', ')}: ${a.motivo}`;
        if (anterior.descricao !== descricao || anterior.arquivo !== a.evidencia[0]) {
          carimbarAchado(raiz, anterior, { descricao, arquivo: a.evidencia[0],
            claim: { ...anterior.claim, arquivo: a.evidencia[0], alegacao: `${a.regra} observado em ${a.threads.join(', ')}` } });
        }
        ids.push(anterior.id); continue;
      }
      const comando = `node core/dist/index.js audit process --exigir-achado ${a.chave}`;
      const r = registrarAchado(raiz, { rodada, pack: 'process', regra: a.regra, severidade: 'menor',
        titulo: `${a.regra}: ${a.motivo}`, arquivo: a.evidencia[0], descricao: `${a.threads.join(', ')}: ${a.motivo}`,
        alegacao: `${a.regra} observado em ${a.threads.join(', ')}`, verificar: [comando],
        impacto: 'Entrega ou repetição de falha sem aprendizado humano confirmado',
        fix: a.regra === 'PR3' ? 'Revisar o motivo recorrente e propor controle no roadmap' : 'Revisar a entrega e concluir MASTER com ratificação humana',
        estimativa: '1h', irreversivel: 'nenhum', produto: manifesto.project.name, estagio: manifesto.project.stage,
        postura, memory: manifesto.memory.mode });
      existentes.push(r); ids.push(r.id);
    }
  }
  return { contrato: 'ork.process-audit/v1', postura, achados, board: ids };
}
