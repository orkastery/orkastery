/**
 * RM-058, fatia N2 (D9 da ork-rm058n2): a fila de recursos pesados.
 *
 * Verify rodando junto com build de outra worktree deu regressão falsa nesta máquina: com a CPU dividida, teste
 * com relógio estoura o prazo e a suíte reprova sem que nada tenha quebrado. A fila deixa no máximo `slots`
 * operações pesadas ao mesmo tempo por raiz de estado (todas as worktrees do projeto nesta máquina) e nunca duas
 * no mesmo artefato (o diretório onde a operação compila e testa).
 *
 * Tudo é trava do kernel (`flock` exclusivo, como a condução e o lock do HITL): quem segura é o processo, e a
 * trava solta sozinha quando ele morre, inclusive por SIGKILL. Nenhum prazo, PID ou arquivo apagado libera vaga;
 * um processo perdido em segundo plano não prende a fila. A ordem de chegada é uma senha, também com trava do
 * kernel: quem chegou antes e segue vivo passa antes, e a senha de quem morreu não segura ninguém.
 *
 * Limites ditos: a fila é da raiz de estado, e outro projeto da mesma máquina tem a sua; o descritor não passa
 * aos filhos, então o processo que morre por SIGKILL solta a vaga mesmo que um comando dele ainda rode até o
 * próprio prazo (o `timeout` do verify o encerra); e só o Linux com `/usr/bin/flock` tem a fila.
 *
 * O dono da vez passa aos comandos que roda a marca da posse (`ORK_FILA_PESADA_DONO`): um verify aninhado num
 * comando dele (a claim que roda `ork verify` de outra thread do mesmo projeto) entra como reentrada, em vez de
 * esperar a vaga do próprio pai até o prazo. A marca só vale com o dono vivo, ancestral do processo e segurando a
 * vaga que diz, com o identificador da posse que gravou nela: marca copiada para fora dessa árvore de processos, ou
 * guardada de uma vez anterior do mesmo dono, não pula a fila.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { formatarDesde } from './horario';

export const CONTRATO_FILA_PESADA = 'ork.fila-pesada/v1' as const;
/** A marca da posse que o dono da vez passa aos processos filhos. */
export const ENV_DONO_DA_FILA = 'ORK_FILA_PESADA_DONO';
const FLOCK = '/usr/bin/flock';
const DIR = 'fila-pesada';
/** Entre uma tentativa e outra. A vez costuma durar minutos; meio segundo não pesa em ninguém. */
const PAUSA_MS = 500;
/** A batida e complementar ao flock: atravessa a observacao de um sandbox com outro namespace de PID. */
const BATIDA_CADA_MS = 1_000;
const BATIDA_VALE_MS = 5_000;

export interface PedidoDeRecursoPesado {
  /** O diretório onde a operação compila e testa (a worktree da thread). Dois pedidos nele nunca rodam juntos. */
  artefato: string;
  /** O que roda: `verify`, `baseline`. Vai para quem ocupa, para o humano saber quem espera quem. */
  operacao: string;
  thread: string | null;
  /** Quantas operações pesadas ao mesmo tempo nesta raiz de estado; 0 desliga a fila. */
  slots: number;
  /** Quanto esperar a vez antes de recusar; 0 tenta uma vez só. */
  esperarMs: number;
  /** Chamado uma vez, quando a vez não sai na primeira tentativa: quem ocupa agora. */
  aoEsperar?: (ocupantes: OcupanteDaFila[]) => void;
  /** O comando que repete o pedido com mais espera, para o texto da recusa. */
  comandoDeEsperar?: string;
}

/** Quem segura uma vaga agora, como ele mesmo gravou ao pegá-la. */
export interface OcupanteDaFila {
  slot: number;
  operacao: string;
  thread: string | null;
  artefato: string;
  pid: number;
  desde: string;
  /** Estado observado, nunca inferido so pela visibilidade local do PID. */
  vida?: VidaDoOcupante;
  prova?: ProvaDaVida;
  inicio?: string | null;
  host?: string | null;
  espacoPids?: string | null;
  posse?: string;
  batidaExpiraEm?: string | null;
}

export type VidaDoOcupante = 'vivo' | 'morto' | 'desconhecido';
export type ProvaDaVida = 'trava-kernel' | 'trava-livre' | 'batida' | 'processo' | 'processo-ausente' | 'indeterminada';

/** Evidencias separadas para a regra ser testavel sem fingir namespaces no processo de teste. */
export interface EvidenciasDaVida {
  trava: 'ocupada' | 'livre' | 'desconhecida';
  batidaValida: boolean;
  mesmoHost: boolean;
  mesmoEspacoPids: boolean;
  processo: 'vivo' | 'ausente' | 'desconhecido';
}

export function avaliarVidaDoOcupante(e: EvidenciasDaVida): { vida: VidaDoOcupante; prova: ProvaDaVida } {
  if (e.trava === 'ocupada') return { vida: 'vivo', prova: 'trava-kernel' };
  if (e.trava === 'livre') return { vida: 'morto', prova: 'trava-livre' };
  if (e.batidaValida) return { vida: 'vivo', prova: 'batida' };
  if (e.mesmoHost && e.mesmoEspacoPids && e.processo === 'vivo') return { vida: 'vivo', prova: 'processo' };
  if (e.mesmoHost && e.mesmoEspacoPids && e.processo === 'ausente') return { vida: 'morto', prova: 'processo-ausente' };
  return { vida: 'desconhecido', prova: 'indeterminada' };
}

export interface UsoDaFilaPesada {
  /** `reentrada`: este processo já segurava a vez; `desligada`: `slots` 0; `sem-kernel`: sem `flock` aqui. */
  situacao: 'adquirida' | 'reentrada' | 'desligada' | 'sem-kernel';
  slot: number | null;
  esperouMs: number;
}

export interface RecusaDaFilaPesada {
  contrato: 'ork.fila-pesada-recusa/v1';
  motivo: 'fila-pesada.ocupada' | 'concurrency.lease-indeterminado';
  operacao: string;
  thread: string | null;
  slots: number;
  esperouMs: number;
  ocupantes: OcupanteDaFila[];
  texto: string;
}

/** A recusa é resposta, não falha: o CLI a imprime como a da condução, e sai com 3. */
export class ErroDaFilaPesada extends Error {
  readonly recusa: RecusaDaFilaPesada;
  constructor(recusa: RecusaDaFilaPesada) {
    super(`${recusa.motivo}: ${recusa.texto}`);
    this.name = 'ErroDaFilaPesada';
    this.recusa = recusa;
  }
}

export function kernelDisponivel(): boolean {
  return process.platform === 'linux' && fs.existsSync(FLOCK);
}

type ObservacaoDaTrava = 'adquirida' | 'ocupada' | 'desconhecida';

/** Diferencia a contencao provada do erro de observacao; erro nunca vira trava livre. */
function observarTrava(fd: number): ObservacaoDaTrava {
  const r = spawnSync(FLOCK, ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
  if (!r.error && r.status === 0) return 'adquirida';
  if (!r.error && r.status === 1) return 'ocupada';
  return 'desconhecida';
}

/** Tomar a trava exige prova positiva. Contencao e observacao inconclusiva falham fechadas. */
function trancar(fd: number): boolean { return observarTrava(fd) === 'adquirida'; }

function abrirTrava(arquivo: string, criar: boolean): number {
  const fd = fs.openSync(arquivo, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | (criar ? fs.constants.O_CREAT : 0), 0o600);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.uid !== process.getuid?.()) {
    fs.closeSync(fd);
    throw new Error(`fila-pesada: ${path.basename(arquivo)} não é arquivo de trava do núcleo`);
  }
  return fd;
}

/**
 * A trava exclusiva do kernel num arquivo da raiz de estado: o descritor, ou `null` quando outro processo vivo a
 * segura. A trava dura enquanto o descritor estiver aberto neste processo, e nunca mais que o processo.
 */
export function tentarTravaExclusiva(arquivo: string): number | null {
  const fd = abrirTrava(arquivo, true);
  if (trancar(fd)) return fd;
  fs.closeSync(fd);
  return null;
}

/** O diretório da fila na raiz de estado, criado privado. */
export function dirDaFilaPesada(raiz: string): string {
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', DIR]);
  const dir = path.join(principal, '.orkastery', DIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** O artefato pelo caminho real: a mesma worktree por dois caminhos é o mesmo artefato. */
function chaveDoArtefato(artefato: string): string {
  let real: string;
  try { real = fs.realpathSync(artefato); } catch { real = path.resolve(artefato); }
  return createHash('sha256').update(real).digest('hex').slice(0, 16);
}

interface Senha { nome: string; fd: number }

/**
 * A senha de chegada: criada com outro nome, trancada e só então renomeada, para ninguém vê-la destrancada e
 * tomá-la por senha de processo morto. O nome começa pelo instante, com zeros: a ordem dos nomes é a de chegada.
 */
function tirarSenha(dir: string): Senha {
  const marca = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(10, '0')}-${randomUUID().slice(0, 8)}`;
  const provisorio = path.join(dir, `.senha-${marca}.tmp`);
  const fd = abrirTrava(provisorio, true);
  if (!trancar(fd)) { fs.closeSync(fd); fs.rmSync(provisorio, { force: true }); throw new Error('fila-pesada: a senha nova não trancou'); }
  const nome = `senha-${marca}.lock`;
  fs.renameSync(provisorio, path.join(dir, nome));
  return { nome, fd };
}

/** Apaga a senha com a trava na mão e só depois a solta: ninguém a vê destrancada no diretório. */
function devolverSenha(dir: string, senha: Senha | null): void {
  if (!senha) return;
  try { fs.unlinkSync(path.join(dir, senha.nome)); } catch { /* já saiu */ }
  try { fs.closeSync(senha.fd); } catch { /* já fechado */ }
}

/**
 * É a vez desta senha? Só quando nenhuma senha anterior segue viva. A de processo morto está destrancada: quem a
 * acha a tranca, apaga e solta, para ela não segurar a fila de ninguém. A provisória de quem morreu entre criar e
 * renomear também sai, pelo mesmo teste da trava.
 */
function minhaVez(dir: string, senha: Senha): boolean {
  const nomes = fs.readdirSync(dir);
  for (const nome of nomes.filter(n => /^\.senha-.+\.tmp$/.test(n))) {
    // Entre criar e trancar, a provisória viva fica um instante destrancada: só a velha é de quem morreu.
    const st = fs.statSync(path.join(dir, nome), { throwIfNoEntry: false });
    if (!st || Date.now() - st.mtimeMs < 30_000) continue;
    let fd: number;
    try { fd = abrirTrava(path.join(dir, nome), false); } catch { continue; }
    if (trancar(fd)) { try { fs.unlinkSync(path.join(dir, nome)); } catch { /* outro já limpou */ } }
    fs.closeSync(fd);
  }
  const anteriores = nomes.filter(n => /^senha-.+\.lock$/.test(n) && n < senha.nome).sort();
  for (const nome of anteriores) {
    let fd: number;
    try { fd = abrirTrava(path.join(dir, nome), false); } catch { continue; }
    if (!trancar(fd)) { fs.closeSync(fd); return false; }
    try { fs.unlinkSync(path.join(dir, nome)); } catch { /* outro já limpou */ }
    fs.closeSync(fd);
  }
  return true;
}

interface IdentidadeDaMaquina { host: string | null; espacoPids: string | null }

function hashLocal(valor: string): string { return createHash('sha256').update(valor).digest('hex').slice(0, 24); }

/** Identidades opacas: provam igualdade sem publicar hostname, boot id ou inode do namespace. */
function identidadeDaMaquina(): IdentidadeDaMaquina {
  let host: string | null = null, espacoPids: string | null = null;
  try { host = hashLocal(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()); } catch { /* nao observavel */ }
  try { espacoPids = hashLocal(fs.readlinkSync('/proc/self/ns/pid')); } catch { /* nao observavel */ }
  return { host, espacoPids };
}

/** `id`: o identificador desta posse, gravado na vaga e na marca que os filhos herdam. */
interface Posse {
  fdArtefato: number; fdVaga: number; slot: number; id: string;
  batida: Worker | null; arquivoDaBatida: string | null;
}

function gravarDono(fd: number, dono: OcupanteDaFila, posse: string): void {
  const bytes = Buffer.from(JSON.stringify({ contrato: CONTRATO_FILA_PESADA, ...dono, posse }) + '\n', 'utf8');
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, bytes, 0, bytes.length, 0);
}

function arquivoDaBatida(dir: string, slot: number, posse: string): string {
  return path.join(dir, `vaga-${slot}.${posse}.heartbeat.json`);
}

/** Worker nativo: a batida continua enquanto o verify sincrono bloqueia a thread JS, sem processo shell perdido. */
function iniciarBatida(dir: string, slot: number, posse: string): { worker: Worker; arquivo: string } | null {
  const arquivo = arquivoDaBatida(dir, slot, posse);
  try {
    const worker = new Worker(`
      const fs = require('node:fs');
      const { parentPort, workerData } = require('node:worker_threads');
      const { randomUUID } = require('node:crypto');
      let ativo = true;
      parentPort.on('message', () => { ativo = false; });
      function bater() {
        if (!ativo) return;
        const tmp = workerData.arquivo + '.' + randomUUID() + '.tmp';
        try {
          fs.writeFileSync(tmp, JSON.stringify({ contrato: 'ork.fila-pesada-heartbeat/v1', posse: workerData.posse,
            expiraEm: new Date(Date.now() + workerData.validadeMs).toISOString() }) + '\\n', { flag: 'wx', mode: 0o600 });
          fs.renameSync(tmp, workerData.arquivo);
        } catch (_) { try { fs.unlinkSync(tmp); } catch (_) {} }
        if (ativo) setTimeout(bater, workerData.intervaloMs);
      }
      bater();
    `, { eval: true, workerData: { arquivo, posse, intervaloMs: BATIDA_CADA_MS, validadeMs: BATIDA_VALE_MS } });
    worker.unref();
    return { worker, arquivo };
  } catch { return null; }
}

/** O artefato primeiro, depois a primeira vaga livre; sem vaga, solta o artefato. Nunca espera segurando nada. */
function tentarVaga(dir: string, pedido: PedidoDeRecursoPesado): Posse | null {
  const fdArtefato = tentarTravaExclusiva(path.join(dir, `artefato-${chaveDoArtefato(pedido.artefato)}.lock`));
  if (fdArtefato === null) return null;
  for (let slot = 0; slot < pedido.slots; slot++) {
    const fdVaga = tentarTravaExclusiva(path.join(dir, `vaga-${slot}.lock`));
    if (fdVaga === null) continue;
    const id = randomUUID();
    const identidade = identidadeDaMaquina();
    const dono: OcupanteDaFila = { slot, operacao: pedido.operacao, thread: pedido.thread, artefato: path.resolve(pedido.artefato),
      pid: process.pid, desde: new Date().toISOString(), inicio: inicioDoProcesso(process.pid), ...identidade };
    gravarDono(fdVaga, dono, id);
    gravarDono(fdArtefato, dono, id);
    const batida = iniciarBatida(dir, slot, id);
    return { fdArtefato, fdVaga, slot, id, batida: batida?.worker ?? null, arquivoDaBatida: batida?.arquivo ?? null };
  }
  fs.closeSync(fdArtefato);
  return null;
}

function soltar(posse: Posse): void {
  try { posse.batida?.postMessage('parar'); void posse.batida?.terminate(); } catch { /* o processo tambem encerra o worker */ }
  if (posse.arquivoDaBatida) try { fs.unlinkSync(posse.arquivoDaBatida); } catch { /* batida expira sozinha */ }
  for (const fd of [posse.fdVaga, posse.fdArtefato]) {
    try { fs.ftruncateSync(fd, 0); } catch { /* o descritor fecha de qualquer jeito */ }
    try { fs.closeSync(fd); } catch { /* já fechado */ }
  }
}

/**
 * Quem ocupa as vagas agora. Somente leitura do que os donos gravaram; a vaga que tranca na hora está livre e é
 * solta em seguida. Vaga trancada sem dono legível ainda conta, como ocupada por desconhecido.
 */
export function ocupantesDaFilaPesada(raiz: string): OcupanteDaFila[] {
  if (!kernelDisponivel()) return [];
  const dir = dirDaFilaPesada(raiz);
  const ocupantes: OcupanteDaFila[] = [];
  for (const nome of fs.readdirSync(dir).filter(n => /^vaga-\d+\.lock$/.test(n)).sort()) {
    let fd: number;
    try { fd = abrirTrava(path.join(dir, nome), false); } catch { continue; }
    try {
      const trava = observarTrava(fd);
      if (trava === 'adquirida') continue;
      const slot = Number(/^vaga-(\d+)\.lock$/.exec(nome)![1]);
      let dono: Partial<OcupanteDaFila> & { posse?: unknown } = {};
      try { dono = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')) as typeof dono; } catch { /* dono ainda gravando */ }
      let batidaExpiraEm: string | null = null;
      if (typeof dono.posse === 'string') {
        try {
          const batida = JSON.parse(fs.readFileSync(arquivoDaBatida(dir, slot, dono.posse), 'utf8')) as { posse?: unknown; expiraEm?: unknown };
          if (batida.posse === dono.posse && typeof batida.expiraEm === 'string') batidaExpiraEm = batida.expiraEm;
        } catch { /* batida ausente, vencida ou ainda sendo publicada */ }
      }
      const local = identidadeDaMaquina();
      const mesmoHost = typeof dono.host === 'string' && local.host === dono.host;
      const mesmoEspacoPids = typeof dono.espacoPids === 'string' && local.espacoPids === dono.espacoPids;
      let processo: EvidenciasDaVida['processo'] = 'desconhecido';
      if (mesmoHost && mesmoEspacoPids && typeof dono.pid === 'number' && typeof dono.inicio === 'string') {
        const atual = inicioDoProcesso(dono.pid);
        processo = atual === dono.inicio ? 'vivo' : atual === null ? 'ausente' : 'ausente';
      }
      const estado = avaliarVidaDoOcupante({ trava: trava === 'ocupada' ? 'ocupada' : 'desconhecida',
        batidaValida: batidaExpiraEm !== null && Date.parse(batidaExpiraEm) > Date.now(), mesmoHost, mesmoEspacoPids, processo });
      ocupantes.push({ slot, operacao: typeof dono.operacao === 'string' ? dono.operacao : 'desconhecida',
        thread: typeof dono.thread === 'string' ? dono.thread : null, artefato: typeof dono.artefato === 'string' ? dono.artefato : '',
        pid: typeof dono.pid === 'number' ? dono.pid : 0, desde: typeof dono.desde === 'string' ? dono.desde : '',
        inicio: typeof dono.inicio === 'string' ? dono.inicio : null, host: typeof dono.host === 'string' ? dono.host : null,
        espacoPids: typeof dono.espacoPids === 'string' ? dono.espacoPids : null,
        posse: typeof dono.posse === 'string' ? dono.posse : undefined, batidaExpiraEm, ...estado });
    } finally { fs.closeSync(fd); }
  }
  return ocupantes;
}

function recusaDaFila(pedido: PedidoDeRecursoPesado, esperouMs: number, ocupantes: OcupanteDaFila[]): RecusaDaFilaPesada {
  const indeterminado = ocupantes.some(o => o.vida === 'desconhecido');
  const motivo = indeterminado ? 'concurrency.lease-indeterminado' : 'fila-pesada.ocupada';
  const espera = esperouMs < 60000 ? `${Math.round(esperouMs / 1000)} s` : `${Math.round(esperouMs / 60000)} min`;
  const linhas = [
    `Operação pesada não executada: ${pedido.operacao}${pedido.thread ? ` da thread ${pedido.thread}` : ''} esperou ${espera} ` +
      `e a fila de recursos pesados não liberou a vez (até ${pedido.slots} ao mesmo tempo, concurrency.max_parallel_heavy). ` +
      'Verify e build juntos nesta máquina dão regressão falsa.',
    ...(ocupantes.length ? ocupantes.map(o => `  Quem ocupa: ${o.operacao}${o.thread ? ` da thread ${o.thread}` : ''}, ` +
      `desde ${formatarDesde(o.desde)}, processo ${o.pid}${o.vida === 'desconhecido' ? '; vida indeterminada' : ''}.`) :
      ['  Quem ocupa: a vez é de outro pedido que chegou antes e ainda espera.']),
    ...(indeterminado ? ['A vida do lease não pôde ser comprovada deste ambiente; “não sei” nunca é órfão. ' +
      'Espere com --esperar ou devolva à condução com concurrency.lease-indeterminado.'] : []),
    'O que você pode fazer:',
    '  1. Esperar a vez: o dono da vaga segue rodando e, quando ele termina ou morre, a vaga volta sozinha.',
    ...(pedido.comandoDeEsperar ? [`     ${pedido.comandoDeEsperar}`] : []),
    '  2. Desligar a fila só nesta máquina, se ela aguenta: concurrency.max_parallel_heavy no orkastery.yaml (0 desliga).',
  ];
  return { contrato: 'ork.fila-pesada-recusa/v1', motivo, operacao: pedido.operacao, thread: pedido.thread,
    slots: pedido.slots, esperouMs, ocupantes, texto: linhas.join('\n') };
}

const pausa = new Int32Array(new SharedArrayBuffer(4));
function dormir(ms: number): void {
  if (ms > 0) Atomics.wait(pausa, 0, 0, Math.ceil(ms));
}

/** A vez que este processo segura, por raiz de estado: a reentrada não pede vaga de novo. */
const emCurso = new Map<string, { slot: number | null }>();

/** O campo 22 do `/proc/<pid>/stat` (instante de início em ticks): com o pid, identifica o processo sem reuso. */
function inicioDoProcesso(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch { return null; }
}

function paiDe(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const pai = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    return Number.isSafeInteger(pai) && pai > 0 ? pai : null;
  } catch { return null; }
}

/** O processo é ancestral deste? Sobe pela cadeia de pais, no máximo 64 degraus. */
function ancestral(pid: number): boolean {
  let atual: number | null = process.ppid;
  for (let i = 0; i < 64 && atual !== null && atual > 1; i++) {
    if (atual === pid) return true;
    atual = paiDe(atual);
  }
  return false;
}

/**
 * A vaga que um processo ancestral segura nesta raiz, pela marca que ele passou; `null` quando a marca não vale: outra
 * raiz, dono morto ou trocado (pid com outro início), dono que não é ancestral, ou vaga que ele não segura mais, inclusive
 * a de uma vez anterior dele (o identificador da posse gravado na vaga é outro).
 */
function vagaDoAncestral(chave: string, dir: string): number | null {
  const bruto = process.env[ENV_DONO_DA_FILA];
  if (!bruto) return null;
  let marca: { raiz?: unknown; pid?: unknown; inicio?: unknown; slot?: unknown; posse?: unknown };
  try { marca = JSON.parse(bruto) as typeof marca; } catch { return null; }
  const { pid, slot } = marca;
  if (marca.raiz !== chave || typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid ||
      typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0 || typeof marca.posse !== 'string') return null;
  if (inicioDoProcesso(pid) !== marca.inicio || !ancestral(pid)) return null;
  const arquivo = path.join(dir, `vaga-${slot}.lock`);
  try {
    const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { pid?: unknown; posse?: unknown };
    if (gravado.pid !== pid || gravado.posse !== marca.posse) return null;
  } catch { return null; }
  let fd: number;
  try { fd = abrirTrava(arquivo, false); } catch { return null; }
  try { return trancar(fd) ? null : slot; } finally { fs.closeSync(fd); }
}

/**
 * Roda `executar` com a vez da fila de recursos pesados desta raiz de estado: a senha de chegada, a trava do
 * artefato e uma das `slots` vagas, todas do kernel. Espera em primeiro plano até `esperarMs` e, sem a vez, lança
 * `ErroDaFilaPesada` sem rodar nada. Dentro de quem já segura a vez neste processo, roda direto.
 */
export function comRecursoPesado<T>(raiz: string, pedido: PedidoDeRecursoPesado, executar: (uso: UsoDaFilaPesada) => T): T {
  if (!(pedido.slots > 0)) return executar({ situacao: 'desligada', slot: null, esperouMs: 0 });
  const chave = path.resolve(raizDoEstado(raiz));
  const atual = emCurso.get(chave);
  if (atual) return executar({ situacao: 'reentrada', slot: atual.slot, esperouMs: 0 });
  if (!kernelDisponivel()) return executar({ situacao: 'sem-kernel', slot: null, esperouMs: 0 });
  const dir = dirDaFilaPesada(raiz);
  const doAncestral = vagaDoAncestral(chave, dir);
  if (doAncestral !== null) return executar({ situacao: 'reentrada', slot: doAncestral, esperouMs: 0 });
  const inicio = Date.now();
  const prazo = inicio + Math.max(0, pedido.esperarMs);
  let senha: Senha | null = tirarSenha(dir);
  let avisou = false;
  try {
    for (;;) {
      const posse = minhaVez(dir, senha!) ? tentarVaga(dir, pedido) : null;
      if (posse) {
        // Com a vaga na mão, a senha sai: quem vem depois disputa a próxima vaga livre.
        devolverSenha(dir, senha);
        senha = null;
        emCurso.set(chave, { slot: posse.slot });
        // Os comandos que rodam dentro da vez herdam a marca da posse: o verify aninhado neles é reentrada.
        const marcaAnterior = process.env[ENV_DONO_DA_FILA];
        process.env[ENV_DONO_DA_FILA] = JSON.stringify({ raiz: chave, pid: process.pid, inicio: inicioDoProcesso(process.pid), slot: posse.slot,
          posse: posse.id });
        try { return executar({ situacao: 'adquirida', slot: posse.slot, esperouMs: Date.now() - inicio }); }
        finally {
          if (marcaAnterior === undefined) delete process.env[ENV_DONO_DA_FILA]; else process.env[ENV_DONO_DA_FILA] = marcaAnterior;
          emCurso.delete(chave);
          soltar(posse);
        }
      }
      if (Date.now() >= prazo) throw new ErroDaFilaPesada(recusaDaFila(pedido, Date.now() - inicio, ocupantesDaFilaPesada(raiz)));
      if (!avisou) {
        avisou = true;
        try { pedido.aoEsperar?.(ocupantesDaFilaPesada(raiz)); } catch { /* o aviso nunca derruba a espera */ }
      }
      dormir(Math.min(PAUSA_MS, prazo - Date.now()));
    }
  } finally { devolverSenha(dir, senha); }
}
