/**
 * RM-063 (fatia 3, H3 e H4): o transporte do pulse pronto de cada host, gravado pelo onboarding junto com o canal do dono.
 *
 * Incidente de 03 a 12/10/2026 (P1 da pagina da RM-063): sem `pulse-host.json`, o `ork doctor` calava e a maquina ficou
 * nove dias sem batida e sem aviso. O transporte era um JSON que o dono escrevia a mao, com o executavel e os argumentos
 * de cada host, e so o do OpenClaw estava pronto num guia. Agora a etapa `maestro` do onboarding aceita o canal do dono
 * (`canal: { host, destino }`) e grava o `.orkastery/monitor/pulse-host.json` desta maquina com o modelo pronto do host:
 *
 *  - `openclaw`: `openclaw message send --channel telegram --target <chat> --message {{mensagem}} --json`;
 *  - `hermes`: o Python do venv do Hermes com o `ork-pulse-enviar.py` do adaptador e `--target telegram:<chat>[:<topico>]`.
 *
 * O canal de um host novo vira o principal, e o do outro host que ja estava fica como alternativo (H4): a entrega tenta o
 * outro quando o primeiro falha. O arquivo e desta maquina e nunca vai ao git (RM-047).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { exigirHostLocal, rastreadoPeloGit } from './procedencia';
import { noPath } from './util';

export const HOSTS_DO_CANAL = ['openclaw', 'hermes'] as const;
export type HostDoCanal = typeof HOSTS_DO_CANAL[number];

/** O canal do dono como a etapa `maestro` do onboarding o guarda. */
export interface CanalDoDono {
  host: HostDoCanal;
  /** O chat autorizado: `telegram:<chat>` (e, no Hermes, `telegram:<chat>:<topico>`). */
  destino: string;
  /** O executavel do host, quando nao e o do PATH (OpenClaw) ou o do venv do Hermes. */
  executavel?: string;
  /** Hermes: o `ork-pulse-enviar.py` do adaptador instalado, quando nao esta em `$HERMES_HOME/bin`. */
  script?: string;
}

/** Um transporte do pulse: o executavel do host e os argumentos, com `{{mensagem}}` num deles. */
export interface TransporteDoHost { executavel: string; argumentos: string[]; host?: string; destino?: string }

/** O `pulse-host.json`: o principal e os outros hosts configurados, tentados na ordem quando ele falha. */
export interface TransportePulse extends TransporteDoHost { alternativos?: TransporteDoHost[] }

export const DESTINO_DO_CANAL = /^telegram:(-?\d{1,20})(?::(\d{1,12}))?$/;
const MARCA = '{' + '{mensagem}}';
const CHAVES_DO_CANAL = ['host', 'destino', 'executavel', 'script'];
const caminhoAceito = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096 && path.isAbsolute(v) && !/\p{Cc}/u.test(v);

/** A forma do canal, sem tocar o disco: host conhecido, destino Telegram explicito e caminhos absolutos. */
export function canalValido(v: unknown): v is CanalDoDono {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  if (Object.keys(c).some((k) => !CHAVES_DO_CANAL.includes(k))) return false;
  if (!(HOSTS_DO_CANAL as readonly string[]).includes(c.host as string)) return false;
  if (typeof c.destino !== 'string' || !DESTINO_DO_CANAL.test(c.destino)) return false;
  if (c.executavel !== undefined && !caminhoAceito(c.executavel)) return false;
  if (c.script !== undefined && (c.host !== 'hermes' || !caminhoAceito(c.script))) return false;
  // O `message send` do OpenClaw recebe o chat; o topico e do transporte do Hermes.
  if (c.host === 'openclaw' && DESTINO_DO_CANAL.exec(c.destino)?.[2] !== undefined) return false;
  return true;
}

/** Um transporte valido: executavel e argumentos de texto, com `{{mensagem}}` em algum. */
export function transporteValido(t: unknown): t is TransporteDoHost {
  const c = t as { executavel?: unknown; argumentos?: unknown } | null;
  return !!c && typeof c.executavel === 'string' && !!c.executavel && Array.isArray(c.argumentos) &&
    c.argumentos.every((a) => typeof a === 'string') && c.argumentos.some((a) => (a as string).includes(MARCA));
}

/** O nome do host de um transporte: o declarado, ou o que o executavel e os argumentos dizem. */
export function hostDoTransporte(t: TransporteDoHost): string {
  if (typeof t.host === 'string' && /^[a-z0-9][a-z0-9._-]{0,39}$/i.test(t.host)) return t.host;
  const nomes = [t.executavel, ...t.argumentos].map((a) => path.basename(a)).join(' ');
  return /openclaw/i.test(nomes) ? 'openclaw' : /hermes|ork-pulse-enviar/i.test(nomes) ? 'hermes' : path.basename(t.executavel).slice(0, 40);
}

const executavel = (arquivo: string): boolean => {
  try { fs.accessSync(arquivo, fs.constants.X_OK); return fs.statSync(arquivo).isFile(); } catch { return false; }
};

/**
 * O transporte pronto do host do canal, com os caminhos desta maquina. Lanca `onboarding.canal.transporte` com a
 * correcao quando o executavel do host nao esta aqui: o onboarding nao grava um transporte que nunca entrega.
 */
export function transporteDoCanal(raiz: string, canal: CanalDoDono, env: NodeJS.ProcessEnv = process.env): TransporteDoHost {
  const falta = (detalhe: string): never => { throw new Error(`onboarding.canal.transporte: ${detalhe}`); };
  if (canal.host === 'openclaw') {
    const bin = canal.executavel ?? noPath('openclaw', env);
    if (!bin || !path.isAbsolute(bin) || !executavel(bin)) {
      return falta('o openclaw não está no PATH desta máquina; informe canal.executavel com o caminho absoluto dele');
    }
    if (rastreadoPeloGit(raiz, bin)) return falta(`${bin} está versionado no git: o transporte só vale de um arquivo local desta máquina`);
    const chat = DESTINO_DO_CANAL.exec(canal.destino)![1];
    return { host: 'openclaw', destino: canal.destino, executavel: bin,
      argumentos: ['message', 'send', '--channel', 'telegram', '--target', chat, '--message', MARCA, '--json'] };
  }
  const casa = (env.HERMES_HOME ?? '').trim() || path.join(os.homedir(), '.hermes');
  const agente = (env.HERMES_AGENT_DIR ?? '').trim() || path.join(casa, 'hermes-agent');
  const python = canal.executavel ?? path.join(agente, 'venv', 'bin', 'python3');
  if (!executavel(python)) return falta(`o Python do venv do Hermes não está em ${python}; informe canal.executavel`);
  const script = canal.script ?? [path.join(casa, 'bin', 'ork-pulse-enviar.py'), path.join(raizDoEstado(raiz), '.hermes', 'bin', 'ork-pulse-enviar.py')]
    .find((s) => fs.existsSync(s));
  if (!script || !fs.existsSync(script)) {
    return falta('o ork-pulse-enviar.py do adaptador Hermes não foi achado (ork adapter install hermes); informe canal.script');
  }
  // RM-047: o que a entrega executa so vale do arquivo local desta maquina; versionado no git, veio com o repositorio.
  for (const arquivo of [python, script]) {
    if (rastreadoPeloGit(raiz, arquivo)) return falta(`${arquivo} está versionado no git: o transporte só vale de um arquivo local desta máquina`);
  }
  return { host: 'hermes', destino: canal.destino, executavel: python, argumentos: [script, '--target', canal.destino, '--message', MARCA] };
}

export function caminhoDoPulseHost(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'monitor', 'pulse-host.json');
}

/**
 * Grava o transporte do canal como o principal do `pulse-host.json` desta maquina. O principal de outro host que ja
 * estava vira alternativo, na frente dos outros; o do mesmo host e trocado. Devolve o arquivo e os hosts alternativos.
 */
export function gravarTransporteDoCanal(raiz: string, novo: TransporteDoHost): { arquivo: string; alternativos: string[] } {
  const arquivo = caminhoDoPulseHost(raiz);
  exigirHostLocal(raiz, arquivo);
  let atual: TransportePulse | null = null;
  try {
    const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as unknown;
    if (transporteValido(lido)) atual = lido as TransportePulse;
  } catch { atual = null; }
  const host = hostDoTransporte(novo);
  const alternativos: TransporteDoHost[] = [];
  const somar = (t: TransporteDoHost) => {
    const h = hostDoTransporte(t);
    if (h !== host && !alternativos.some((a) => hostDoTransporte(a) === h)) {
      alternativos.push({ ...(t.host ? { host: t.host } : { host: h }), ...(t.destino ? { destino: t.destino } : {}),
        executavel: t.executavel, argumentos: t.argumentos });
    }
  };
  if (atual) {
    somar(atual);
    for (const a of Array.isArray(atual.alternativos) ? atual.alternativos.filter(transporteValido) : []) somar(a);
  }
  const conteudo: TransportePulse = { ...novo, ...(alternativos.length ? { alternativos } : {}) };
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(temporario, JSON.stringify(conteudo, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporario, arquivo);
  } finally { fs.rmSync(temporario, { force: true }); }
  return { arquivo, alternativos: alternativos.map(hostDoTransporte) };
}
