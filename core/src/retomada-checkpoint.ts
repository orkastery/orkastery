/** RM-064 T3: checkpoint determinístico para continuar um bloco sem recomeçar GOAL/PLAN. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerClaims } from './claims';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { cwdLocalOuNulo, diretorioDaThread } from './procedencia';
import { dirThread } from './thread';
import { formatarResumoDoTrabalho, ResumoDoTrabalho, resumirTrabalhoDaThread } from './trabalho-thread';
import { EventoLedger, Fase, Thread } from './types';
import { exec } from './util';

export interface PontoDeParada {
  fase: Fase;
  ultimoCommit: string | null;
  gitStatus: string[];
  claimsPendentes: string[];
  rodadaCheck: number;
  goFixEmCurso: number | null;
  trabalho: ResumoDoTrabalho;
}

export interface PromptDeRetomada {
  prompt: string;
  promptPath: string;
  promptSha256: string;
  promptOriginalPath: string;
  promptOriginalSha256: string;
  ponto: PontoDeParada;
}

const hash = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');
const SHA = /^[a-f0-9]{40}$/;

function numero(e: EventoLedger): number | null {
  return typeof e.rodada === 'number' && Number.isSafeInteger(e.rodada) && e.rodada > 0 ? e.rodada : null;
}

export function derivarPontoDeParada(raiz: string, thread: Thread, fase: Fase,
    eventos: readonly EventoLedger[] = lerLedger(dirThread(raiz, thread.id))): PontoDeParada {
  const cwdBruto = diretorioDaThread(raiz, thread);
  const cwd = cwdLocalOuNulo(raiz, thread.id, cwdBruto, 'thread');
  const head = cwd ? exec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], cwd, 30_000) : null;
  const ultimoCommit = head?.ok && SHA.test(head.stdout.trim()) ? head.stdout.trim() : null;
  const status = cwd ? exec('git', ['status', '--porcelain=v1', '--untracked-files=normal'], cwd, 30_000) : null;
  const gitStatus = status?.ok ? status.stdout.split('\n').filter(Boolean).slice(0, 100) : ['git status indisponível'];
  const claimsPendentes = lerClaims(raiz, thread.id).filter((c) => !['verificado', 'retirada'].includes(c.estado)).map((c) => c.id);
  const rodadaCheck = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.verificacao || e.tipo === TIPOS_DE_EVENTO.reverifyConcluido).length;
  const abertas = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.fixAberto).map(numero).filter((n): n is number => n !== null);
  const fechadas = new Set(eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.reverifyConcluido).map(numero).filter((n): n is number => n !== null));
  const goFixEmCurso = abertas.filter((r) => !fechadas.has(r)).at(-1) ?? null;
  const trabalho = resumirTrabalhoDaThread(raiz, thread.id);
  return { fase, ultimoCommit, gitStatus, claimsPendentes, rodadaCheck, goFixEmCurso, trabalho };
}

function secao(p: PontoDeParada, originalSha: string): string {
  const status = p.gitStatus.length ? p.gitStatus.map((l) => `  ${l}`).join('\n') : '  (limpa)';
  return `## Ponto de parada\n\n` +
    `Esta sessão retoma uma interrupção por cota. Continue da fase \`${p.fase}\`; não repita GOAL nem PLAN.\n\n` +
    `- Prompt original: \`${originalSha}\`\n` +
    `- Fase: \`${p.fase}\`\n` +
    `- Último commit: ${p.ultimoCommit ? `\`${p.ultimoCommit}\`` : '(indisponível)'}\n` +
    `- Claims pendentes: ${p.claimsPendentes.length ? p.claimsPendentes.map((c) => `\`${c}\``).join(', ') : '(nenhuma)'}\n` +
    `- Rodadas de CHECK observadas: ${p.rodadaCheck}\n` +
    `- GO-FIX em curso: ${p.goFixEmCurso === null ? '(nenhum)' : `rodada ${p.goFixEmCurso}`}\n` +
    `- Trabalho retomável: \`${p.trabalho.caminho}\`\n` +
    `${formatarResumoDoTrabalho(p.trabalho)}\n` +
    `- \`git status --porcelain\`:\n\n\`\`\`text\n${status}\n\`\`\`\n\n`;
}

/** O original é conferido pelo chamador; este escritor só cria o derivado e nunca o altera. */
export function prepararPromptDeRetomada(raiz: string, thread: Thread, fase: Fase, original: {
  prompt: string; promptPath: string; promptSha256: string;
}, gravar = true): PromptDeRetomada {
  const ponto = derivarPontoDeParada(raiz, thread, fase);
  const prompt = `${secao(ponto, original.promptSha256)}${original.prompt}`;
  const promptSha256 = hash(prompt);
  const pasta = path.join(dirThread(raiz, thread.id), 'prompts');
  const promptPath = path.join(pasta, `retomada-${fase.toLowerCase()}-${promptSha256.slice(0, 12)}.md`);
  if (gravar) {
    fs.mkdirSync(pasta, { recursive: true });
    try { fs.writeFileSync(promptPath, prompt, { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || hash(fs.readFileSync(promptPath, 'utf8')) !== promptSha256) throw e;
    }
  }
  return { prompt, promptPath, promptSha256, promptOriginalPath: original.promptPath,
    promptOriginalSha256: original.promptSha256, ponto };
}
