/**
 * RM-039 (B6): o `ork doctor` acusa o pulse que bate devagar demais.
 *
 * A cadencia por tag (#OrkPulseOn-15m e as outras) so vale inteira com a varredura do cron de 15
 * em 15 minutos. A instalacao antiga fica em `0 * * * *`, e nada avisava. Com o transporte do
 * pulse configurado (`.orkastery/monitor/pulse-host.json`), o doctor le o `crontab -l` e avisa,
 * sem bloquear, quando a linha da varredura falta ou bate mais devagar que o template
 * `monitor/pulse.cron`. O doctor nunca edita o crontab: a correcao traz a linha pronta.
 *
 * RM-063 (F1): com thread aberta no projeto, a falta da batida REPROVA, com ou sem `pulse-host.json`.
 * Sem transporte o doctor calava, e o maquina-b ficou de 03/10 a 12/10/2026 sem varredura nenhuma. A
 * correcao e o `ork fabrica batida instalar`, que instala a linha do template de forma idempotente.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Check } from './types';
import { exec } from './util';
import { msg } from './locale';
import { formatarDataHoraRotulada } from './horario';

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
  if (r.error === 'ENOENT') return { ok: false, motivo: msg().doctor.cronSemComando };
  // RM-063 (F1): o usuario sem crontab tem um crontab vazio, nao uma leitura que falhou; e o caso da maquina nova.
  if (/no crontab for /i.test(`${r.stderr}${r.stdout}`)) return { ok: true, texto: '' };
  const primeira = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
  return { ok: false, motivo: primeira ? msg().doctor.cronFalhou(primeira) : msg().doctor.cronSaiu(r.code) };
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

/**
 * RM-063 (F1, GO-FIX): um valor como o `sh` do cron o le: aspas simples literais; aspas duplas com `$HOME`; sem aspas,
 * com o `~` do comeco e `$HOME`. So o que a linha da varredura usa; o resto fica como esta.
 */
export function valorNoShell(bruto: string, home: string = os.homedir()): string {
  const comHome = (v: string) => v.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);
  if (bruto.length >= 2 && bruto.startsWith(`'`) && bruto.endsWith(`'`)) return bruto.slice(1, -1).replace(/'\\''/g, `'`);
  if (bruto.length >= 2 && bruto.startsWith('"') && bruto.endsWith('"')) return comHome(bruto.slice(1, -1).replace(/\\(["\\$`])/g, '$1'));
  return comHome(bruto === '~' ? home : bruto.startsWith('~/') ? home + bruto.slice(1) : bruto);
}

/** Um valor de atribuicao ou um caminho: entre aspas simples, entre aspas duplas, ou ate o espaco. */
const VALOR = String.raw`(?:'(?:[^']|'\\'')*'|"(?:[^"\\]|\\.)*"|[^\s;&|<>()]+)`;

/** O valor de `ORK_PULSE_PROJECT=` na linha, como o `sh` o le; `null` quando a linha nao o diz. */
export function projetoDaLinha(linha: string, home: string = os.homedir()): string | null {
  const m = new RegExp(`(?:^|\\s)ORK_PULSE_PROJECT=(${VALOR})`).exec(linha);
  return m ? valorNoShell(m[1], home) : null;
}

/** Os scripts da varredura citados na linha, como o `sh` os le; `varredura-pulse.sh.bak` nao e o script. */
export function scriptsDaLinha(linha: string, home: string = os.homedir()): string[] {
  const nome = SCRIPT_DA_VARREDURA.replace(/\./g, '\\.');
  const re = new RegExp(`(?:^|[\\s=])('[^']*${nome}'|"[^"]*${nome}"|[^\\s'";&|<>()]*${nome})(?=$|[\\s;&|<>)])`, 'g');
  return [...linha.matchAll(re)].map((m) => valorNoShell(m[1], home));
}

/** Uma entrada ativa do crontab que roda a varredura, com o projeto alvo que o `sh` vai ver. */
export interface EntradaDaVarredura {
  /** A linha como esta no crontab. */
  linha: string;
  /** `ORK_PULSE_PROJECT` efetivo: o da propria linha ou o de uma linha de ambiente acima dela; `null` sem nenhum. */
  projeto: string | null;
  scripts: string[];
}

/**
 * RM-063 (F1, GO-FIX): as entradas da varredura, na ordem. A linha de ambiente do crontab (`NOME=valor`) vale para as
 * entradas que vem depois dela: o template sem `ORK_PULSE_PROJECT` abaixo de `ORK_PULSE_PROJECT=/outro` varre o outro.
 */
export function entradasDaVarredura(crontab: string, home: string = os.homedir()): EntradaDaVarredura[] {
  const ambiente: Record<string, string> = {};
  const entradas: EntradaDaVarredura[] = [];
  for (const linha of crontab.split('\n')) {
    const t = linha.trim();
    if (!t || t.startsWith('#')) continue;
    const env = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(t);
    if (env) { ambiente[env[1]] = valorNoShell(env[2].trim(), ambiente.HOME ?? home); continue; }
    const casa = ambiente.HOME ?? home;
    const scripts = scriptsDaLinha(t, casa);
    if (!scripts.length) continue;
    entradas.push({ linha, projeto: projetoDaLinha(t, casa) ?? ambiente.ORK_PULSE_PROJECT ?? null, scripts });
  }
  return entradas;
}

/**
 * RM-063 (F1): a entrada roda, com certeza, a varredura DESTE projeto: o `ORK_PULSE_PROJECT` efetivo e ele, ou nao ha
 * projeto nenhum e o script e o do proprio checkout (que entao e o alvo, como no template).
 */
export function entradaDoProjeto(e: EntradaDaVarredura, raiz: string): boolean {
  if (e.projeto !== null) return mesmoCaminho(e.projeto, raiz);
  const doCheckout = path.join(raiz, 'monitor', SCRIPT_DA_VARREDURA);
  return e.scripts.some((s) => mesmoCaminho(s, doCheckout));
}

/** O mesmo caminho, escrito igual ou pelo mesmo destino real. */
export function mesmoCaminho(a: string, b: string): boolean {
  if (path.resolve(a) === path.resolve(b)) return true;
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}

/**
 * A entrada vale para o aviso de cadencia (sem thread aberta) quando nao aponta OUTRO projeto: a linha antiga do
 * template, sem projeto, continua valendo como na RM-039.
 */
export function entradaNaoEDeOutro(e: EntradaDaVarredura, raiz: string): boolean {
  return e.projeto === null || mesmoCaminho(e.projeto, raiz);
}

/** Acima disto sem rodada nova no `hitl.log`, a batida esta atrasada: duas batidas do template perdidas. */
export const ATRASO_DA_BATIDA_MIN = 30;

/** A ultima rodada da varredura, lida do `hitl.log` que ela mesma escreve a cada batida. */
export interface RodadaDaVarredura { em: string; code: number | null; detalhe: string }

export function ultimaRodadaDaVarredura(dirMonitor: string): RodadaDaVarredura | null {
  const arquivo = path.join(dirMonitor, 'hitl.log');
  let texto: string;
  try {
    const fd = fs.openSync(arquivo, 'r');
    try {
      const tamanho = fs.fstatSync(fd).size, lido = Math.min(tamanho, 64 * 1024);
      const buffer = Buffer.alloc(lido);
      fs.readSync(fd, buffer, 0, lido, tamanho - lido);
      texto = buffer.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  for (const linha of texto.split('\n').reverse()) {
    try {
      const e = JSON.parse(linha) as { ts?: unknown; tipo?: unknown; code?: unknown; detalhe?: unknown };
      if (e.tipo !== 'pulse_scan' || typeof e.ts !== 'string' || !Number.isFinite(Date.parse(e.ts))) continue;
      return { em: e.ts, code: typeof e.code === 'number' ? e.code : null, detalhe: typeof e.detalhe === 'string' ? e.detalhe : '' };
    } catch { /* linha cortada no inicio do trecho, ou ilegivel */ }
  }
  return null;
}

/** RM-063 (F1): threads nao fechadas no estado do projeto (`.orkastery/threads/<id>/thread.json`). */
export function threadsAbertasNoEstado(dirEstado: string): number {
  const dir = path.join(dirEstado, 'threads');
  let nomes: string[];
  try { nomes = fs.readdirSync(dir); } catch { return 0; }
  let abertas = 0;
  for (const nome of nomes) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, nome, 'thread.json'), 'utf8')) as { status?: unknown; origem?: unknown };
      // O registro de adocao nao tem trabalho a conduzir; a thread pausada espera o dono, e a batida e quem o lembra.
      if (t.status !== 'fechada' && t.origem !== 'adocao') abertas++;
    } catch { /* pasta sem thread.json, ou ilegivel: nao e thread a vigiar */ }
  }
  return abertas;
}

/** O comando que instala a batida; e a correcao do doctor quando ela falta (RM-063, F1). */
export const COMANDO_DE_INSTALAR_A_BATIDA = 'ork fabrica batida instalar';

/** Aspas de shell so quando o caminho precisa (a linha vai colada no crontab, que roda por `sh`). */
export function citarNoShell(caminho: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(caminho) ? caminho : `'${caminho.replace(/'/g, `'\\''`)}'`;
}

/**
 * O script da varredura que este `ork` traz: no pacote do npm, `monitor/` fica ao lado de `dist/`; no
 * checkout, na raiz do repositorio, dois niveis acima de `core/dist/`. `null` quando nenhum existe.
 */
export function scriptDaVarreduraDoOrk(dirDoDist: string = __dirname): string | null {
  for (const dir of [path.join(dirDoDist, '..', 'monitor'), path.join(dirDoDist, '..', '..', 'monitor')]) {
    const script = path.join(dir, SCRIPT_DA_VARREDURA);
    if (fs.existsSync(script)) return path.resolve(script);
  }
  return null;
}

/**
 * O comando que a linha nova do crontab roda. Ensaio de 03/10/2026 (RM-049): a correcao apontava
 * `<projeto>/monitor/varredura-pulse.sh`, que so existe no checkout do proprio Orkastery; quem instalou
 * pelo npm recebia um caminho que nao existe. Quando o projeto nao traz o script, a linha usa o do `ork`
 * instalado e diz o projeto por `ORK_PULSE_PROJECT` (o cron nao roda no diretorio do projeto).
 */
export function comandoDaVarredura(raizDoProjeto: string, scriptDoOrk: string | null = scriptDaVarreduraDoOrk()): string {
  const doProjeto = path.join(raizDoProjeto, 'monitor', SCRIPT_DA_VARREDURA);
  if (fs.existsSync(doProjeto) || !scriptDoOrk) return citarNoShell(doProjeto);
  return `ORK_PULSE_PROJECT=${citarNoShell(raizDoProjeto)} ${citarNoShell(scriptDoOrk)}`;
}

/**
 * Check "cadencia do pulse no cron". `null` quando o projeto nao tem transporte do pulse nem thread
 * aberta: sem `pulse-host.json` e sem thread a vigiar, o doctor nao fala de cron.
 *
 * RM-063 (F1): com thread aberta (`abertas`, contadas no estado ao lado de `dirMonitor`), a falta da
 * batida reprova, com ou sem transporte, e a correcao e o `ork fabrica batida instalar`.
 */
export function checarCronDoPulse(dirMonitor: string, raizDoCheckout: string,
  ler: LeitorDoCrontab = lerCrontabDoSistema, scriptDoOrk: string | null = scriptDaVarreduraDoOrk(),
  abertas: number = threadsAbertasNoEstado(path.dirname(dirMonitor))): Check | null {
  const comHost = fs.existsSync(path.join(dirMonitor, 'pulse-host.json'));
  if (!comHost && abertas === 0) return null;
  const nome = 'cadencia do pulse no cron';
  const comandoSugerido = comandoDaVarredura(raizDoCheckout, scriptDoOrk);
  const linhaNova = (comando: string) => `${BATIDA_DO_TEMPLATE} ${comando}`;
  const ausente = (detalhe: string): Check => abertas > 0
    ? { nome, nivel: 'fail', detalhe: msg().doctor.batidaAusente(abertas, detalhe),
      correcao: msg().doctor.batidaInstale(COMANDO_DE_INSTALAR_A_BATIDA) }
    : { nome, nivel: 'warn', detalhe, correcao: msg().doctor.cronAdicione(linhaNova(comandoSugerido)) };

  // RM-063 (F1, GO-FIX): a varredura que bate por outro agendador (timer do systemd, batida do host) se prova pelo hitl.log.
  const rodada = ultimaRodadaDaVarredura(dirMonitor);
  const haMin = rodada ? Math.floor((Date.now() - Date.parse(rodada.em)) / 60000) : null;
  const semCron = (detalhe: string): Check => haMin !== null && haMin >= 0 && haMin <= ATRASO_DA_BATIDA_MIN
    ? { nome, nivel: 'ok', detalhe: msg().doctor.batidaPeloLog(haMin) } : ausente(detalhe);

  const leitura = ler();
  if (!leitura.ok) return semCron(comHost ? msg().doctor.cronSemLeitura(leitura.motivo) : msg().doctor.batidaSemLeitura(leitura.motivo));
  // Com thread aberta, so a batida DESTE projeto; sem thread, o aviso de cadencia aceita a linha antiga sem projeto.
  const linhas = entradasDaVarredura(leitura.texto)
    .filter(e => abertas > 0 ? entradaDoProjeto(e, raizDoCheckout) : entradaNaoEDeOutro(e, raizDoCheckout)).map(e => e.linha.trim());
  if (linhas.length === 0) return semCron(comHost ? msg().doctor.cronSemLinha(SCRIPT_DA_VARREDURA) : msg().doctor.batidaSemLinha(SCRIPT_DA_VARREDURA));

  const lentas: { linha: string; comando: string; intervalo: number | null }[] = [];
  for (const linha of linhas) {
    const partes = dividirLinha(linha);
    const intervalo = partes ? intervaloEmMinutos(partes.quando) : null;
    if (intervalo === null || intervalo > 15) lentas.push({ linha, comando: partes?.comando ?? comandoSugerido, intervalo });
  }
  if (lentas.length < linhas.length) {
    // RM-063 (fatia 3, H1): a linha no crontab nao prova que a batida roda (cron parado, script que cai antes do log).
    // Com thread aberta, a ultima rodada mais velha que o atraso reprova; sem rodada nenhuma ainda, a linha recem-instalada vale.
    if (abertas > 0 && haMin !== null && haMin > ATRASO_DA_BATIDA_MIN) {
      return { nome, nivel: 'fail', detalhe: msg().doctor.batidaAtrasada(haMin, linhas.length), correcao: msg().doctor.batidaAtrasadaCorrecao };
    }
    return { nome, nivel: 'ok', detalhe: msg().doctor.cronOk(linhas.length) };
  }
  const l = lentas[0];
  return { nome, nivel: 'warn', detalhe: msg().doctor.cronLento(msg().doctor.cronRitmo(l.intervalo), l.linha),
    correcao: msg().doctor.cronTroque(linhaNova(l.comando)) };
}

// ---------------------------------------------------------------------------
// RM-063 (fatia 3, H1): a batida como o host a le, no `ork doctor --json`.
// ---------------------------------------------------------------------------

/** O estado da batida para a segunda linha do host: a idade da ultima rodada e o aviso pronto para o dono. */
export interface BatidaNoDoctor {
  threadsAbertas: number;
  /** A linha da varredura deste projeto esta no crontab? `null` quando o crontab nao pode ser lido. */
  instalada: boolean | null;
  ultimaRodadaEm: string | null;
  /** O codigo de saida da ultima rodada (`pulse_scan` do `hitl.log`). */
  codigo: number | null;
  haMin: number | null;
  limiteMin: number;
  /** Com thread aberta: a ultima rodada passou do limite, ou nunca houve rodada e a batida nao esta instalada. */
  atrasada: boolean;
  /** O texto que o host manda ao dono quando `atrasada`; `null` quando nao ha o que avisar. */
  aviso: string | null;
}

export function batidaNoDoctor(dirMonitor: string, raizDoCheckout: string, opcoes: { projeto: string; maquina: string;
  ler?: LeitorDoCrontab; agora?: number; abertas?: number }): BatidaNoDoctor {
  const abertas = opcoes.abertas ?? threadsAbertasNoEstado(path.dirname(dirMonitor));
  const rodada = ultimaRodadaDaVarredura(dirMonitor);
  const agora = opcoes.agora ?? Date.now();
  const haMin = rodada ? Math.max(0, Math.floor((agora - Date.parse(rodada.em)) / 60000)) : null;
  const leitura = (opcoes.ler ?? lerCrontabDoSistema)();
  const instalada = leitura.ok ? entradasDaVarredura(leitura.texto).some((e) => entradaDoProjeto(e, raizDoCheckout)) : null;
  const atrasada = abertas > 0 && (haMin !== null ? haMin > ATRASO_DA_BATIDA_MIN : instalada !== true);
  const quando = rodada ? formatarDataHoraRotulada(rodada.em, { agora: new Date(agora).toISOString() }) : null;
  const aviso = !atrasada ? null : haMin !== null
    ? `Orkastery: a fabrica ${opcoes.projeto} na maquina ${opcoes.maquina} esta sem batida ha ${haMin} min (ultima rodada em ${quando}` +
      `${rodada?.code ? `, codigo ${rodada.code}` : ''}), com ${abertas} thread(s) aberta(s). Confira com: ork fabrica batida status`
    : `Orkastery: a fabrica ${opcoes.projeto} na maquina ${opcoes.maquina} nao tem batida (nenhuma rodada da varredura e a linha nao ` +
      `esta no crontab), com ${abertas} thread(s) aberta(s). Instale com: ork fabrica batida instalar`;
  return { threadsAbertas: abertas, instalada, ultimaRodadaEm: rodada?.em ?? null, codigo: rodada?.code ?? null, haMin,
    limiteMin: ATRASO_DA_BATIDA_MIN, atrasada, aviso };
}

// ---------------------------------------------------------------------------
// RM-063 (fatia 3, H4): a falha do transporte do pulse, que a entrega grava em `transporte.log`.
// ---------------------------------------------------------------------------

export const ARQUIVO_DO_TRANSPORTE = 'transporte.log';
/** A entrega mais velha que isto nao e mais noticia: o doctor nao acusa a falha de ontem. */
const VALIDADE_DA_FALHA_MS = 24 * 60 * 60 * 1000;

export interface TentativaDoTransporte { host: string; ok: boolean; codigo: number | null; detalhe: string }
export interface EntregaRegistrada { ts: string; oQue: string; ok: boolean; host: string | null; tentativas: TentativaDoTransporte[] }

/** A ultima entrega registrada no `transporte.log` (lida do fim, com teto). */
export function ultimaEntrega(dirMonitor: string): EntregaRegistrada | null {
  let texto: string;
  try {
    const fd = fs.openSync(path.join(dirMonitor, ARQUIVO_DO_TRANSPORTE), 'r');
    try {
      const tamanho = fs.fstatSync(fd).size, lido = Math.min(tamanho, 64 * 1024);
      const buffer = Buffer.alloc(lido);
      fs.readSync(fd, buffer, 0, lido, tamanho - lido);
      texto = buffer.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  for (const linha of texto.split('\n').reverse()) {
    try {
      const e = JSON.parse(linha) as Partial<EntregaRegistrada> & { tipo?: unknown };
      if (e.tipo !== 'transporte_entrega' || typeof e.ts !== 'string' || !Array.isArray(e.tentativas)) continue;
      return { ts: e.ts, oQue: String(e.oQue ?? ''), ok: e.ok === true, host: typeof e.host === 'string' ? e.host : null, tentativas: e.tentativas };
    } catch { /* linha cortada */ }
  }
  return null;
}

/**
 * Check "transporte do pulse": a ultima entrega do resumo. Saiu pelo primeiro transporte, ok; saiu pelo outro host
 * configurado, aviso; nao saiu por nenhum, falha. `null` sem `pulse-host.json`, ou sem entrega nas ultimas 24 h.
 */
export function checarTransporteDoPulse(dirMonitor: string, agora: number = Date.now()): Check | null {
  if (!fs.existsSync(path.join(dirMonitor, 'pulse-host.json'))) return null;
  const e = ultimaEntrega(dirMonitor);
  if (!e || !(agora - Date.parse(e.ts) <= VALIDADE_DA_FALHA_MS)) return null;
  const nome = 'transporte do pulse';
  // I-35: o check guarda o ISO; o relatorio o localiza no fuso do dono.
  const quando = e.ts;
  if (!e.ok) {
    const tentativas = e.tentativas.map((t) => `${t.host}: ${t.codigo ?? 'sem código'}`).join('; ');
    return { nome, nivel: 'fail', detalhe: msg().doctor.transporteFalhou(quando, tentativas), correcao: msg().doctor.transporteCorrecao };
  }
  const falhas = e.tentativas.filter((t) => !t.ok);
  if (falhas.length) {
    return { nome, nivel: 'warn', detalhe: msg().doctor.transporteDesvio(falhas.map((t) => t.host).join(', '), e.host ?? '?', quando),
      correcao: msg().doctor.transporteCorrecao };
  }
  return { nome, nivel: 'ok', detalhe: msg().doctor.transporteOk(e.host ?? '?', quando) };
}
