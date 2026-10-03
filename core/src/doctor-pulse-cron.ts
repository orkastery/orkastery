/**
 * RM-039 (B6): o `ork doctor` acusa o pulse que bate devagar demais.
 *
 * A cadencia por tag (#OrkPulseOn-15m e as outras) so vale inteira com a varredura do cron de 15
 * em 15 minutos. A instalacao antiga fica em `0 * * * *`, e nada avisava. Com o transporte do
 * pulse configurado (`.orkastery/monitor/pulse-host.json`), o doctor le o `crontab -l` e avisa,
 * sem bloquear, quando a linha da varredura falta ou bate mais devagar que o template
 * `monitor/pulse.cron`. O doctor nunca edita o crontab: a correcao traz a linha pronta.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Check } from './types';
import { exec } from './util';

/** A batida do template `monitor/pulse.cron` (I-50): a menor cadencia das tags. */
export const BATIDA_DO_TEMPLATE = '*/15 * * * *';
/** O script que o template agenda; a linha do crontab e achada por ele. */
export const SCRIPT_DA_VARREDURA = 'varredura-pulse.sh';
/** Comando do template antes da troca do caminho pelo checkout de quem instala. */
export const COMANDO_DO_TEMPLATE = '/CAMINHO/orkastery/monitor/varredura-pulse.sh';

/** Resultado do `crontab -l`: o texto, ou a ausencia (sem crontab, sem binario, erro). */
export type LeituraDoCrontab = { ok: true; texto: string } | { ok: false; motivo: string };
export type LeitorDoCrontab = () => LeituraDoCrontab;

/** Le o crontab do usuario do processo, sem shell e com prazo. */
export function lerCrontabDoSistema(): LeituraDoCrontab {
  const r = exec('crontab', ['-l'], undefined, 5000);
  if (r.ok) return { ok: true, texto: r.stdout };
  if (r.error === 'ENOENT') return { ok: false, motivo: 'comando crontab ausente nesta maquina' };
  const msg = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
  return { ok: false, motivo: msg ? `crontab -l falhou: ${msg}` : `crontab -l saiu ${r.code}` };
}

const MACROS: Record<string, number> = { '@hourly': 60, '@daily': 1440, '@midnight': 1440, '@weekly': 10080,
  '@monthly': 43200, '@yearly': 525600, '@annually': 525600 };

/**
 * Maior intervalo, em minutos, entre duas batidas da linha (so os campos de minuto e hora; dia,
 * mes e dia da semana restritos contam como mais devagar que uma hora). `null` quando a expressao
 * nao e reconhecida: o doctor entao avisa pela linha, sem adivinhar.
 */
export function intervaloEmMinutos(expressao: string): number | null {
  const campos = expressao.trim().split(/\s+/);
  if (campos.length === 1 && campos[0].startsWith('@')) return MACROS[campos[0]] ?? null;
  if (campos.length !== 5) return null;
  const [minuto, hora, dia, mes, semana] = campos;
  const minutos = valoresDoCampo(minuto, 0, 59);
  if (!minutos) return null;
  if (hora !== '*' || dia !== '*' || mes !== '*' || semana !== '*') return Math.max(60, maiorLacuna(minutos, 60));
  return maiorLacuna(minutos, 60);
}

function valoresDoCampo(campo: string, min: number, max: number): number[] | null {
  const valores = new Set<number>();
  for (const parte of campo.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(parte);
    if (!m) return null;
    const inicio = m[1] === '*' ? min : Number(m[2]);
    const fim = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : inicio;
    const passo = m[4] !== undefined ? Number(m[4]) : 1;
    if (passo < 1 || inicio < min || fim > max || inicio > fim) return null;
    for (let v = inicio; v <= fim; v += passo) valores.add(v);
  }
  return [...valores].sort((a, b) => a - b);
}

/** Maior distancia entre dois valores consecutivos, contando a volta do ciclo. */
function maiorLacuna(valores: number[], ciclo: number): number {
  let maior = 0;
  for (let i = 0; i < valores.length; i++) {
    const proximo = i + 1 < valores.length ? valores[i + 1] : valores[0] + ciclo;
    maior = Math.max(maior, proximo - valores[i]);
  }
  return maior;
}

/** Separa a expressao de horario do comando numa linha do crontab. */
function dividirLinha(linha: string): { quando: string; comando: string } | null {
  const t = linha.trim();
  if (t.startsWith('@')) {
    const m = /^(@\S+)\s+(.+)$/.exec(t);
    return m ? { quando: m[1], comando: m[2] } : null;
  }
  const m = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/.exec(t);
  return m ? { quando: m[1], comando: m[2] } : null;
}

/** Linhas ativas (nao comentario, nao variavel) que agendam a varredura do pulse. */
export function linhasDaVarredura(crontab: string): string[] {
  return crontab.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l) && l.includes(SCRIPT_DA_VARREDURA));
}

/**
 * Check "cadencia do pulse no cron". `null` quando o projeto nao tem transporte do pulse: sem
 * `pulse-host.json` nao ha resumo para entregar, e o doctor nao fala de cron.
 */
export function checarCronDoPulse(dirMonitor: string, raizDoCheckout: string,
  ler: LeitorDoCrontab = lerCrontabDoSistema): Check | null {
  if (!fs.existsSync(path.join(dirMonitor, 'pulse-host.json'))) return null;
  const nome = 'cadencia do pulse no cron';
  const comandoSugerido = path.join(raizDoCheckout, 'monitor', SCRIPT_DA_VARREDURA);
  const linhaNova = (comando: string) => `${BATIDA_DO_TEMPLATE} ${comando}`;
  const ausente = (detalhe: string): Check => ({ nome, nivel: 'warn', detalhe,
    correcao: `adicione ao crontab (crontab -e), como no template monitor/pulse.cron: ${linhaNova(comandoSugerido)}` });

  const leitura = ler();
  if (!leitura.ok) return ausente(`pulse-host.json presente, mas sem crontab para ler (${leitura.motivo}): a varredura nao bate`);
  const linhas = linhasDaVarredura(leitura.texto);
  if (linhas.length === 0) return ausente(`pulse-host.json presente, e nenhuma linha do crontab roda ${SCRIPT_DA_VARREDURA}: o resumo nao sai`);

  const lentas: { linha: string; comando: string; intervalo: number | null }[] = [];
  for (const linha of linhas) {
    const partes = dividirLinha(linha);
    const intervalo = partes ? intervaloEmMinutos(partes.quando) : null;
    if (intervalo === null || intervalo > 15) lentas.push({ linha, comando: partes?.comando ?? comandoSugerido, intervalo });
  }
  if (lentas.length < linhas.length) {
    return { nome, nivel: 'ok', detalhe: `varredura no cron a cada 15 minutos ou menos (${linhas.length} linha(s))` };
  }
  const l = lentas[0];
  const ritmo = l.intervalo === null ? 'com horario que o doctor nao le' : l.intervalo === 60 ? 'de hora em hora'
    : `a cada ${l.intervalo} minutos`;
  return { nome, nivel: 'warn',
    detalhe: `a varredura do pulse bate ${ritmo} (\`${l.linha}\`): a cadencia por tag (RM-039) pede 15 minutos`,
    correcao: `troque a linha no crontab (crontab -e) por: ${linhaNova(l.comando)}` };
}
