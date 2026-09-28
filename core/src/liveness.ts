import { exigirEscopoDeEscrita } from './escopo-escrita';
/** D3: silêncio é ausência de progresso verificável, não ausência de PID. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acharRollout, casaDoCodex } from './adapters/codex';
import { diretorioEfetivo, perfilDoRegistro } from './runtime-profiles';
import { dirThread, lerThread, listarIds } from './thread';
import { lerLedger, registrar } from './ledger';
import { ManifestoCarregado } from './manifest';
import { EventoLedger, Fase, PlanoDeRetry, Thread } from './types';
import { planejarRetry } from './retry';
import { agora, exec } from './util';

export interface FontesDeVida { commitEm?: string; rollout?: string }
export interface FaseOrfa {
  classe: 'fase_orfa'; motivo: 'runtime.silencio'; thread: string; fase: Fase;
  sessionId: string; despachadaEm: string; ultimoHeartbeatEm: string;
  silencioHaMin: number; desdeEm: string; evidencia: string[]; retry: PlanoDeRetry;
}
interface Snapshot { despacho: string; tamanho: number; heartbeatEm: string; arquivo: string }

/**
 * Transcrição local do Claude. O UUID evita interpretar identificador como caminho.
 * I-33 (D4): `config` é o diretório já resolvido pelo perfil da sessão (ou o implícito, sem
 * perfil); o default pelo env do processo deixou de existir aqui.
 */
export function transcricaoClaude(sessionId: string, cwd: string, config: string): string | undefined {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return undefined;
  const projetos = path.join(config, 'projects');
  const candidato = path.join(projetos, path.resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-'), `${sessionId}.jsonl`);
  if (fs.existsSync(candidato)) return candidato;
  if (!fs.existsSync(projetos)) return undefined;
  // Também cobre a chave abreviada de projetos com caminhos extensos.
  for (const entrada of fs.readdirSync(projetos, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const arquivo = path.join(projetos, entrada.name, `${sessionId}.jsonl`);
    if (fs.existsSync(arquivo)) return arquivo;
  }
  return undefined;
}

function fontesReais(t: Thread, d: EventoLedger): FontesDeVida {
  const commit = t.worktree ? exec('git', ['log', '-1', '--format=%cI'], t.worktree) : null;
  const commitEm = commit?.ok ? commit.stdout.trim() : undefined;
  if (typeof d.sessionId !== 'string') return { commitEm };
  // I-33 (D4): a fonte de vida mora no diretório do perfil gravado no `phase_dispatch`. Perfil
  // inválido não vira leitura pela conta do processo: sem rollout, a prova de vida fica no commit.
  let perfil;
  try { perfil = perfilDoRegistro([d], { sessionId: d.sessionId }); } catch { return { commitEm }; }
  const rollout = d.runtime === 'codex' ? acharRollout(d.sessionId, 3, casaDoCodex(perfil))
    : d.runtime === 'claude-bg' ? transcricaoClaude(d.sessionId, t.worktree ?? process.cwd(), diretorioEfetivo('claude-bg', perfil)) : null;
  return { commitEm, rollout: rollout ?? undefined };
}

/** Último evento do rollout, com leitura limitada. Não carrega o histórico inteiro. */
function instanteDoRollout(arquivo: string): string | null {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const size = fs.fstatSync(fd).size, n = Math.min(size, 65536), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    for (const linha of buf.toString('utf8').split('\n').reverse()) {
      try {
        const e = JSON.parse(linha);
        if (typeof e.timestamp === 'string' && Number.isFinite(Date.parse(e.timestamp))) return e.timestamp;
      } catch { /* última linha incompleta ou primeira linha truncada */ }
    }
    return null;
  } finally { fs.closeSync(fd); }
}

export function detectarFasesOrfas(carregado: ManifestoCarregado, opcoes: {
  quando?: string; registrar?: boolean; escopo?: readonly string[]; diagnosticos?: string[];
  fontes?: (thread: Thread, despacho: EventoLedger) => FontesDeVida;
  estados?: Map<string, string>;
  runtimes?: readonly string[];
} = {}): FaseOrfa[] {
  const autorizadas = opcoes.registrar ? exigirEscopoDeEscrita(opcoes.escopo) : new Set<string>();
  const quando = opcoes.quando ?? agora(), now = Date.parse(quando);
  const limite = carregado.manifesto.liveness?.silencio_max_min ?? 10;
  if (!Number.isFinite(now) || !Number.isFinite(limite) || limite <= 0) throw new Error('instante ou limite de liveness inválido');
  const orfas: FaseOrfa[] = [];
  for (const id of listarIds(carregado.raiz)) {
    const escrever = opcoes.registrar === true && autorizadas.has(id);
    const t = lerThread(carregado.raiz,id), dir = dirThread(carregado.raiz,id);
    if (t.status !== 'aberta') continue;
    const eventos = lerLedger(dir), di = eventos.map(e=>e.tipo).lastIndexOf('phase_dispatch');
    if (di < 0) continue;
    const d = eventos[di], inicio = Date.parse(d.ts), fase = d.fase as Fase;
    if (opcoes.runtimes && !opcoes.runtimes.includes(String(d.runtime))) continue;
    if (!Number.isFinite(inicio) || inicio > now) continue;
    const apos = eventos.slice(di+1);
    const terminal = apos.some(e => ['ship_done','master_done','thread_closed_admin'].includes(e.tipo) ||
      (e.tipo==='phase_result' && e.fase===fase && (!e.sessionId || e.sessionId===d.sessionId) &&
        (e.estado==='concluida' || e.ok===true || e.exitCode===0 || e.status==='ok')));
    if (terminal || opcoes.estados?.get(String(d.sessionId)) === 'blocked') continue;
    // Gate explícito em aberto não é falta de progresso. Pausa futura do modo não conta.
    const gate = apos.filter(e => (!e.fase || e.fase===fase) && (!e.sessionId || e.sessionId===d.sessionId) &&
      (e.tipo==='gate_blocked' || e.tipo==='gate_passed' || (e.tipo==='human_gate' && e.acao==='approve'))).at(-1);
    if (gate?.tipo==='gate_blocked' && gate.motivo!=='runtime.silencio' &&
        !(gate.motivo==='human.pending' && gate.origem==='retry.run')) continue;
    let heartbeat = inicio;
    const evidencia = [`phase_dispatch ${d.ts} sessão ${String(d.sessionId ?? '')}`];
    const incorporar = (ts: string | undefined | null, fonte: string) => {
      const n = ts ? Date.parse(ts) : NaN;
      if (n > heartbeat && n <= now) { heartbeat=n; evidencia.push(`${fonte}: ${ts}`); }
    };
    for (const e of apos) {
      if (['runtime_event','runtime_heartbeat','phase_heartbeat','sessao_heartbeat', 'commit',
          'runtime_stop', 'runtime_subagent_stop', 'sessao_destravada'].includes(e.tipo) &&
          typeof d.sessionId==='string' && e.sessionId===d.sessionId && (!e.fase || e.fase===fase)) {
        incorporar(e.ts,e.tipo);
      }
    }
    const fontes = (opcoes.fontes ?? fontesReais)(t,d);
    incorporar(fontes.commitEm,'commit na worktree');
    const file = path.join(dir,'liveness.json'), chave = `${d.ts}|${d.sessionId}`;
    let anterior: Snapshot | null = null;
    let snapshotInvalido = false;
    if (fs.existsSync(file)) {
      try {
        anterior = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
        if (!anterior || typeof anterior.despacho !== 'string' || typeof anterior.arquivo !== 'string' ||
            !Number.isFinite(anterior.tamanho) || anterior.tamanho < 0 || !Number.isFinite(Date.parse(anterior.heartbeatEm))) {
          throw new Error('snapshot invalido');
        }
      } catch {
        anterior = null; snapshotInvalido = true;
        const diagnostico = `liveness.snapshot.invalid:${id}`;
        evidencia.push(diagnostico); opcoes.diagnosticos?.push(diagnostico);
      }
    }
    if (anterior?.despacho===chave) incorporar(anterior.heartbeatEm,'rollout observado');
    if (fontes.rollout && fs.existsSync(fontes.rollout)) {
      const stat=fs.statSync(fontes.rollout);
      if (anterior?.despacho!==chave || anterior.arquivo!==fontes.rollout || stat.size>anterior.tamanho) {
        incorporar(instanteDoRollout(fontes.rollout),'evento no rollout em crescimento');
      }
      if (escrever && !snapshotInvalido) {
        const snapshot: Snapshot={despacho:chave,tamanho:stat.size,heartbeatEm:new Date(heartbeat).toISOString(),arquivo:fontes.rollout};
        const tmp=file+`.${randomUUID()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(snapshot)+'\n'); fs.renameSync(tmp,file);
      }
    }
    const silencio=(now-heartbeat)/60000;
    const episodio = apos.filter(e => ['gate_blocked', 'gate_passed'].includes(e.tipo) &&
      e.motivo === 'runtime.silencio' && e.despacho === chave).at(-1);
    if (silencio < limite) {
      if (escrever && gate === episodio && episodio?.tipo === 'gate_blocked') {
        registrar(dir, id, 'gate_passed', { fase, motivo: 'runtime.silencio', despacho: chave,
          sessionId: d.sessionId, origem: 'pulse', detalhe: 'heartbeat observado após silêncio', evidencia });
      }
      continue;
    }
    const estado = opcoes.estados?.get(String(d.sessionId));
    const retry=planejarRetry(carregado,id,{motivo:'runtime.silencio',fase,
      estadoDaSessao: estado ? { sessionId: String(d.sessionId), estado } : undefined });
    const resultado: FaseOrfa={classe:'fase_orfa',motivo:'runtime.silencio',thread:id,fase,
      sessionId:String(d.sessionId??''),despachadaEm:d.ts,ultimoHeartbeatEm:new Date(heartbeat).toISOString(),
      silencioHaMin:Math.floor(silencio),desdeEm:new Date(heartbeat+limite*60000).toISOString(),evidencia,retry};
    orfas.push(resultado);
    if (escrever && episodio?.tipo !== 'gate_blocked') {
      registrar(dir,id,'gate_blocked',{fase,motivo:'runtime.silencio',gate:'phase.dispatch',
        despacho:chave,sessionId:d.sessionId,detalhe:`${resultado.silencioHaMin} minutos sem heartbeat`,
        origem:'pulse',correcao:`ork retry run ${id} --motivo runtime.silencio --fase ${fase}`,evidencia});
    }
  }
  return orfas;
}
