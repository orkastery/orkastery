/** Consultas do projeto fixado. Nunca reserva item, publica máquina ou executa push. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { listarReservas, PainelDeReservas } from './roadmap-reservas';
import { lerFabrica, PainelDaFabrica } from './fabrica-estado';
import { criarPerfilShipMcp } from './mcp-ship';
import { ambienteGitMcp, gitPassivoMcp, perfilGitMcp } from './mcp-git';

type Consulta = 'reservas' | 'fabrica';
type Transporte = 'github-ssh' | 'bare-local';
type Painel = PainelDeReservas | PainelDaFabrica;
export const consultaExperienciaSchema = z.object({}).strict();
type Registrar = <S extends z.AnyZodObject>(nome: string,
  config: { description: string; inputSchema: S; annotations: Tool['annotations'] },
  handler: (args: z.infer<S>, extra: { signal: AbortSignal }) => Promise<CallToolResult>) => void;

export function apresentarConsulta(painel: Painel) {
  const estado = painel.atualizado ? 'atualizado' : painel.ponta ? 'desatualizado' : 'indisponivel';
  return { estado, dados: estado === 'indisponivel' ? null : painel,
    motivo: estado === 'atualizado' ? null : 'mcp.experiencia.remoto.indisponivel' };
}
const indisponivel = () => ({ estado: 'indisponivel', dados: null, motivo: 'mcp.experiencia.consulta.indisponivel' });

/** Chamada somente depois de validar a fixação do worker. */
export function consultarPainel(raiz: string, tipo: Consulta) {
  try {
    return apresentarConsulta(tipo === 'reservas' ? listarReservas(raiz, { remoto: 'origin' })
      : lerFabrica(raiz, { remoto: 'origin', timeoutMs: 15000 }));
  } catch { return indisponivel(); }
}

/** Usa as mesmas guardas de transporte do núcleo; não cria autorização de SHIP. */
function assinatura(raiz: string, transporte: Transporte): string {
  criarPerfilShipMcp(raiz, transporte);
  const g = path.join(raiz, '.git');
  perfilGitMcp(raiz, g, g, 'consulta-experiencia', []);
  const st = fs.statSync(raiz);
  return createHash('sha256').update(JSON.stringify([st.dev, st.ino, fs.realpathSync(raiz),
    gitPassivoMcp(raiz, ['remote', 'get-url', '--all', 'origin']),
    gitPassivoMcp(raiz, ['config', '--null', '--list'])])).digest('hex');
}

type Resultado = ReturnType<typeof apresentarConsulta> | ReturnType<typeof indisponivel>;
const PRAZO_DA_CONSULTA_MS = 90000;

/**
 * O worker herda somente ambiente permitido; nunca modifica env do servidor. Roda assíncrono para
 * o servidor MCP seguir atendendo as outras tools durante a consulta remota, e em grupo próprio:
 * prazo ou cancelamento da chamada matam o worker e o git que ele abriu.
 */
export function criarLeitorExperiencia(raiz: string, transporte: Transporte, prazoMs = PRAZO_DA_CONSULTA_MS) {
  let fixacao: string | null = null;
  try { fixacao = assinatura(raiz, transporte); } catch { /* ferramenta continua descoberta, com lacuna explícita */ }
  return (tipo: Consulta, signal?: AbortSignal): Promise<Resultado> => new Promise(resolve => {
    if (!fixacao || signal?.aborted) { resolve(indisponivel()); return; }
    const grupo = process.platform !== 'win32';
    const filho = spawn(process.execPath, [__filename, '--consulta-experiencia'], {
      cwd: raiz, env: { ...ambienteGitMcp(), SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK },
      stdio: ['pipe', 'pipe', 'ignore'], detached: grupo,
    });
    let saida = '', terminado = false;
    const concluir = (r: Resultado) => {
      if (terminado) return;
      terminado = true; clearTimeout(prazo); signal?.removeEventListener('abort', abortar); resolve(r);
    };
    const abortar = () => {
      if (terminado) return;
      filho.stdout?.destroy();
      try { if (filho.pid) process.kill(grupo ? -filho.pid : filho.pid, 'SIGKILL'); } catch { /* já terminou */ }
      concluir(indisponivel());
    };
    const prazo = setTimeout(abortar, prazoMs);
    signal?.addEventListener('abort', abortar, { once: true });
    filho.stdout!.setEncoding('utf8');
    filho.stdout!.on('data', (parte: string) => { saida += parte; if (saida.length > 1024 * 1024) abortar(); });
    filho.stdin!.on('error', () => undefined);
    filho.on('error', () => concluir(indisponivel()));
    filho.on('close', (codigo, sinal) => {
      if (codigo !== 0 || sinal) { concluir(indisponivel()); return; }
      try { concluir(JSON.parse(saida) as Resultado); } catch { concluir(indisponivel()); }
    });
    filho.stdin!.end(JSON.stringify({ raiz, transporte, fixacao, tipo }));
  });
}

export function registrarConsultasExperiencia(registrar: Registrar, opcoes: {
  raiz: string; carregar: () => unknown; transporte: Transporte;
}): void {
  const ler = criarLeitorExperiencia(opcoes.raiz, opcoes.transporte);
  for (const [nome, tipo] of [['ork_roadmap_reservas', 'reservas'], ['ork_fabrica', 'fabrica']] as const) {
    registrar(nome, { description: 'Consulta de ' + tipo + ' do projeto e origin fixados; distingue remoto atualizado, cópia desatualizada e indisponibilidade. Não reserva nem publica.',
      inputSchema: consultaExperienciaSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }, async (_args, extra) => {
      opcoes.carregar();
      return { content: [{ type: 'text', text: JSON.stringify(await ler(tipo, extra.signal)) }] };
    });
  }
}

if (require.main === module && process.argv[2] === '--consulta-experiencia') {
  try {
    const p = z.object({ raiz: z.string(), transporte: z.enum(['github-ssh', 'bare-local']),
      fixacao: z.string().regex(/^[a-f0-9]{64}$/), tipo: z.enum(['reservas', 'fabrica']) }).strict()
      .parse(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (assinatura(p.raiz, p.transporte) !== p.fixacao) throw Error('scope.changed');
    process.stdout.write(JSON.stringify(consultarPainel(p.raiz, p.tipo)));
  } catch { process.stdout.write(JSON.stringify(indisponivel())); }
}
