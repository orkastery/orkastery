/** Correções append-only. Backups não recebem autoria humana retroativa. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirThread, lerThread, listarIds, gravarThread } from './thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { masterRatificado, parseClasse, CONTRATO_MASTER_PENDENTE, exigirScoreValido } from './master';
import { provaDeEntrega } from './thread-close';
import { raizDoEstado } from './estado-thread';
import { MotivoFechamentoAdmin, ScoreProposto } from './types';
import { agora, gravarJson, lerJson } from './util';

export interface CorrecaoMaster { thread: string; acao: 'administrativo' | 'batch'; motivo?: MotivoFechamentoAdmin; origem: string }
const ARQUIVOS = ['thread.json', 'ledger.jsonl', 'POSTMORTEM.json', 'master-log.json'];
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(ARQUIVOS.filter(f => fs.existsSync(path.join(dir, f))).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}
function hash(dados: Record<string, string>): string { return createHash('sha256').update(JSON.stringify(dados)).digest('hex'); }
function motivoLegado(justificativa: string): MotivoFechamentoAdmin | undefined {
  const s = justificativa.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/orfa/.test(s)) return 'orfa';
  if (/engano|recriar|recriando/.test(s)) return 'engano';
  if (/superad|substituid/.test(s)) return 'superada';
  return undefined;
}
export function planejarMigracaoMaster(raiz: string): CorrecaoMaster[] {
  return listarIds(raiz).flatMap(id => {
    const t = lerThread(raiz, id);
    if (!t.score || t.fechamentoAdmin || masterRatificado(raiz, id)) return [];
    if (t.status !== 'fechada' && t.faseAtual !== 'MASTER') return [];
    if (lerLedger(dirThread(raiz, id)).some(e => e.tipo === TIPOS_DE_EVENTO.masterMigrado && e.versao === 1)) return [];
    const motivo = t.score.valor === 0 && !provaDeEntrega(raiz, id) ? motivoLegado(t.score.justificativa) : undefined;
    return [{ thread: id, acao: motivo ? 'administrativo' : 'batch', ...(motivo ? { motivo } : {}), origem: hash(snapshot(dirThread(raiz, id))) }];
  });
}

export function migrarMaster(raiz: string, opcoes: { dryRun?: boolean; por: string }): { dryRun: boolean; correcoes: CorrecaoMaster[]; adiadas: string[] } {
  if (!opcoes.por.trim()) throw new Error('migração exige autoria explícita');
  const correcoes = planejarMigracaoMaster(raiz);
  const adiadas = listarIds(raiz).filter(id => {
    const t = lerThread(raiz, id);
    return !!t.score && !masterRatificado(raiz, id) && t.status !== 'fechada' && t.faseAtual !== 'MASTER';
  });
  // O ensaio e a aplicação validam todos os documentos antes de criar backups.
  for (const c of correcoes) {
    const dir = dirThread(raiz, c.thread), score = lerThread(raiz, c.thread).score!;
    exigirScoreValido(score.valor, score.justificativa);
    for (const nome of ['master-log.json', 'POSTMORTEM.json']) {
      const file = path.join(dir, nome);
      if (fs.existsSync(file)) {
        const documento = lerJson<unknown>(file);
        if (!documento || typeof documento !== 'object' || Array.isArray(documento)) throw new Error(`documento legado inválido: ${file}`);
      }
    }
  }
  if (opcoes.dryRun) return { dryRun: true, correcoes, adiadas };
  const lock = path.join(raizDoEstado(raiz), '.orkastery', 'master-migracao.lock');
  fs.mkdirSync(lock);
  try {
    // Preflight do conjunto antes da primeira mutação.
    for (const c of correcoes) {
      const dir = dirThread(raiz, c.thread);
      if (hash(snapshot(dir)) !== c.origem) throw new Error(`estado mudou durante preflight: ${c.thread}`);
      if (fs.existsSync(path.join(dir, 'migracao-master-v1'))) throw new Error(`backup anterior exige inspeção: ${c.thread}`);
    }
    for (const c of correcoes) {
      const dir = dirThread(raiz, c.thread), antes = snapshot(dir), t = lerThread(raiz, c.thread);
      if (hash(antes) !== c.origem) throw new Error(`estado mudou antes da correção: ${c.thread}`);
      const backup = path.join(dir, 'migracao-master-v1');
      fs.mkdirSync(backup);
      for (const [file, conteudo] of Object.entries(antes)) fs.writeFileSync(path.join(backup, file), conteudo, { flag: 'wx' });
      const hashes = Object.fromEntries(Object.entries(antes).map(([f, v]) => [f, createHash('sha256').update(v).digest('hex')]));
      gravarJson(path.join(backup, 'snapshot.json'), { origem: c.origem, hashes, correcao: c });
      const score = t.score!;
      t.score = null;
      if (c.acao === 'administrativo') {
        t.status = 'fechada';
        t.score_proposto = null;
        t.fechamentoAdmin = { motivo: c.motivo!, por: opcoes.por.trim(), justificativa: score.justificativa, fechadoEm: agora() };
        registrar(dir, t.id, 'thread_closed_admin', { ...t.fechamentoAdmin, migracao: true, backup });
        // Os logs legados ficam preservados; o leitor exige ratificação e os ignora.
      } else {
        const log = antes['master-log.json'] ? lerJson<Record<string, unknown>>(path.join(backup, 'master-log.json')) : {};
        const classes = Array.isArray(log.classesDeFalha) ? log.classesDeFalha.map((c: unknown) => typeof c === 'string' ? parseClasse(c) : null).filter((c): c is NonNullable<typeof c> => c !== null) : [];
        const proposta: ScoreProposto = { valor: score.valor, justificativa: score.justificativa,
          classes: classes.length ? classes : ['outra'], propostoPor: opcoes.por.trim(), propostoEm: agora(),
          resumo: 'Score legado sem prova de ratificação humana; revisar entrega e autoria.' };
        t.score_proposto = proposta; t.status = 'aberta'; t.faseAtual = 'MASTER';
        // Mantém toda a origem no backup e remove atribuição presumida da versão corrente.
        const { avaliadoPor: _por, avaliadoEm: _em, ...base } = log;
        gravarJson(path.join(dir, 'master-log.json'), { ...base, contrato: CONTRATO_MASTER_PENDENTE, versao: 1,
          thread: t.id, score: null, estado: 'ratificacao-pendente', score_proposto: proposta });
        const post = antes['POSTMORTEM.json'] ? lerJson<Record<string, unknown>>(path.join(backup, 'POSTMORTEM.json')) : { thread: t.id };
        gravarJson(path.join(dir, 'POSTMORTEM.json'), { ...post, score: null, score_proposto: proposta });
        registrar(dir, t.id, TIPOS_DE_EVENTO.scoreProposto, { fase: 'MASTER', ...proposta, migracao: true, backup });
      }
      gravarThread(raiz, t);
      registrar(dir, t.id, TIPOS_DE_EVENTO.masterMigrado, { versao: 1, por: opcoes.por.trim(), acao: c.acao, origem: c.origem, backup, hashes,
        razao: 'Separar encerramento administrativo e score sem autoria humana comprovada, preservando os originais' });
    }
    return { dryRun: false, correcoes, adiadas };
  } finally { fs.rmdirSync(lock); }
}
