/**
 * RM-053 (D2, D9): a adesao desta maquina a rede da pessoa, e o disparo em segundo plano.
 *
 * Modulo leve de proposito, como a `fabrica-publicar`: quem publica em segundo plano (thread nova,
 * despacho de fase, entrega) chega aqui por ela e nao pode arrastar o retrato nem a forja.
 *
 * A adesao e da MAQUINA, em `~/.orkastery/rede.json` (contrato `ork.rede/v1`), gravado por
 * `ork network entrar` e `ork network sair`. Sem esse arquivo, a maquina que ja fez
 * `ork fabrica entrar` (`fabricaCompartilhada: true` em `maquina.json`) e membro HERDADO: entra na
 * rede sem refazer nada. `ork network sair` grava `membro: false`, que vence a heranca. O manifesto
 * do projeto nao conta: um time nao inscreve a maquina de ninguem na rede pessoal.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lerConfigDaMaquina, pastaDoUsuario } from './maquina';
import { agora as agoraIso } from './util';

export const CONTRATO_DA_ADESAO = 'ork.rede/v1' as const;
export const REPOSITORIO_PADRAO = 'orkastery-network';
/**
 * D9: no maximo uma tentativa de publicacao em segundo plano (evento ou batida) a cada 14 minutos.
 * Um minuto de folga sob o cron de 15: com o teto igual ao periodo, a oscilacao do horario de cada
 * batida pulava metade delas (B4 do CHECK 1).
 */
export const TETO_DE_TENTATIVA_MS = 14 * 60 * 1000;

export type Adesao = 'rede' | 'fabrica';

export interface ConfigDaRede {
  contrato: typeof CONTRATO_DA_ADESAO;
  membro: boolean;
  forja: 'github' | 'gitlab' | null;
  host: string | null;
  dono: string | null;
  repositorio: string | null;
  atualizadoEm: string;
}

export interface EstadoDaAdesao {
  membro: boolean;
  /** `rede`: entrou pelo `ork network entrar`; `fabrica`: herdada do `ork fabrica entrar`. */
  adesao: Adesao | null;
  config: ConfigDaRede | null;
}

/** `~/.orkastery/rede`: o cache bare da casa, as marcas e o log da rede. */
export const pastaDaRede = (): string => path.join(pastaDoUsuario(), 'rede');
const arquivoDaConfig = (): string => path.join(pastaDoUsuario(), 'rede.json');
const arquivoDaTentativa = (): string => path.join(pastaDaRede(), 'tentativa.json');

const IDENTIFICADOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const texto = (v: unknown, padrao: RegExp): string | null => typeof v === 'string' && padrao.test(v) ? v : null;

export function lerConfigDaRede(): ConfigDaRede | null {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivoDaConfig(), 'utf8')) as Record<string, unknown>;
    if (!bruto || bruto.contrato !== CONTRATO_DA_ADESAO || typeof bruto.membro !== 'boolean') return null;
    return {
      contrato: CONTRATO_DA_ADESAO, membro: bruto.membro,
      forja: bruto.forja === 'github' || bruto.forja === 'gitlab' ? bruto.forja : null,
      host: texto(bruto.host, HOST), dono: texto(bruto.dono, IDENTIFICADOR), repositorio: texto(bruto.repositorio, IDENTIFICADOR),
      atualizadoEm: typeof bruto.atualizadoEm === 'string' ? bruto.atualizadoEm : '',
    };
  } catch { return null; }
}

/** Grava a adesao (troca atomica). Campo ausente na mudanca fica como estava. */
export function gravarConfigDaRede(mudanca: Partial<Omit<ConfigDaRede, 'contrato' | 'atualizadoEm'>>): ConfigDaRede {
  const atual = lerConfigDaRede();
  const config: ConfigDaRede = {
    contrato: CONTRATO_DA_ADESAO,
    membro: mudanca.membro ?? atual?.membro ?? false,
    forja: mudanca.forja !== undefined ? mudanca.forja : atual?.forja ?? null,
    host: mudanca.host !== undefined ? mudanca.host : atual?.host ?? null,
    dono: mudanca.dono !== undefined ? mudanca.dono : atual?.dono ?? null,
    repositorio: mudanca.repositorio !== undefined ? mudanca.repositorio : atual?.repositorio ?? null,
    atualizadoEm: new Date().toISOString(),
  };
  if (config.host !== null && !HOST.test(config.host)) throw new Error(`rede.config: host invalido ("${config.host}")`);
  for (const [campo, valor] of [['dono', config.dono], ['repositorio', config.repositorio]] as const) {
    if (valor !== null && !IDENTIFICADOR.test(valor)) throw new Error(`rede.config: ${campo} invalido ("${valor}")`);
  }
  const dir = pastaDoUsuario();
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.rede.json.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, arquivoDaConfig());
  return config;
}

/** Esta maquina esta na rede? Explicita pelo `rede.json`, senao herdada da fabrica. */
export function adesaoDaRede(): EstadoDaAdesao {
  const config = lerConfigDaRede();
  if (config) return { membro: config.membro, adesao: config.membro ? 'rede' : null, config };
  const herdada = lerConfigDaMaquina()?.fabricaCompartilhada === true;
  return { membro: herdada, adesao: herdada ? 'fabrica' : null, config: null };
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const arquivoDoId = (): string => path.join(pastaDoUsuario(), 'maquina-id');

function lerId(arquivo: string): string | null {
  try { const id = fs.readFileSync(arquivo, 'utf8').trim(); return ID.test(id) ? id : null; } catch { return null; }
}

/** O id desta instalacao, sem criar: `null` quando ela nunca publicou (a leitura nao cria estado). */
export function lerIdDaMaquina(): string | null {
  return lerId(arquivoDoId());
}

/**
 * B7 do CHECK 1: um identificador aleatorio desta instalacao, criado na primeira publicacao. Vai no
 * retrato para duas maquinas com o mesmo nome (hostname `ubuntu`, o corte em 64 caracteres) nao
 * regravarem o arquivo uma da outra. Nao identifica pessoa.
 *
 * S3 da revisao 2: mora em `~/.orkastery/maquina-id`, ao lado do `maquina.json`, e NAO na pasta de
 * cache `~/.orkastery/rede/`: apagar o cache nao pode fazer a maquina virar outra de si mesma.
 * U6 da revisao 3: sem arquivo, `link` de um temporario cria so se nao existe (atomico).
 * V5 da revisao 4: arquivo ruim e trocado por um id DERIVADO dele, o mesmo para todo processo que o
 * viu. W7 e W8 da revisao 5: nenhum caminho expoe arquivo vazio, e link pendurado tambem e trocado.
 * Todo caminho devolve o que ficou gravado, nunca o que tentou gravar.
 */
export function idDaMaquina(): string {
  const arquivo = arquivoDoId();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const lido = lerId(arquivo);
    if (lido) return lido;
    fs.mkdirSync(pastaDoUsuario(), { recursive: true });
    let st: fs.BigIntStats | null = null;
    try { st = fs.lstatSync(arquivo, { bigint: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (st) trocarIdInvalido(arquivo, st);
    else criarId(arquivo);
  }
  const persistido = lerId(arquivo);
  if (!persistido) throw new Error(`rede.id: nao consegui gravar nem ler ${arquivo}`);
  return persistido;
}

function gravarTemporario(conteudo: string): string {
  const temporario = path.join(pastaDoUsuario(), `.maquina-id.${process.pid}.${randomUUID()}.tmp`);
  fs.writeFileSync(temporario, conteudo, { mode: 0o600 });
  return temporario;
}

/** Troca o que estiver no caminho (arquivo ou link) por um arquivo inteiro com o id: `rename` e atomico. */
function trocarPor(arquivo: string, id: string): void {
  const temporario = gravarTemporario(id);
  try { fs.renameSync(temporario, arquivo); } finally { fs.rmSync(temporario, { force: true }); }
}

const SEM_HARD_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

/** Cria o id so se o arquivo nao existe; perdeu a corrida, fica o do outro. */
function criarId(arquivo: string): void {
  const temporario = gravarTemporario(randomUUID());
  try {
    fs.linkSync(temporario, arquivo);
    return;
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code ?? '';
    if (codigo === 'EEXIST') return;
    if (!SEM_HARD_LINK.has(codigo)) throw e;
  } finally { fs.rmSync(temporario, { force: true }); }
  // W7 da revisao 5: sistema de arquivos sem hard link (vboxsf, alguns FUSE e SMB). Nada de arquivo
  // vazio nem de espera por relogio: o id DERIVADO da pasta e do boot, o mesmo para todo processo
  // desta maquina agora, gravado inteiro por `rename`.
  const pasta = fs.statSync(pastaDoUsuario(), { bigint: true });
  trocarPor(arquivo, idDerivado(['novo', pasta.dev, pasta.ino]));
}

/** O arquivo ruim (vazio, corrompido, link pendurado) vira o id derivado dele; o que mudou no meio, quem chamou rele. */
function trocarIdInvalido(arquivo: string, st: fs.BigIntStats): void {
  let conteudo: Buffer;
  if (st.isSymbolicLink()) {
    // W8 da revisao 5: o link pendurado (ou para arquivo ruim) sai; o alvo fica como esta.
    conteudo = Buffer.from(`link:${fs.readlinkSync(arquivo)}`);
  } else if (st.isFile()) {
    let fd: number;
    try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (e) { if (['ENOENT', 'ELOOP'].includes((e as NodeJS.ErrnoException).code ?? '')) return; throw e; }
    try {
      // Conteudo e metadados do MESMO inode: o `fstat` do descritor aberto, nao do caminho.
      st = fs.fstatSync(fd, { bigint: true });
      const buffer = Buffer.alloc(4096);
      conteudo = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0));
    } finally { fs.closeSync(fd); }
    if (ID.test(conteudo.toString('utf8').trim())) return;
  } else {
    throw new Error(`rede.id: ${arquivo} nao e um arquivo; apague-o e rode de novo`);
  }
  trocarPor(arquivo, idDerivado([createHash('sha256').update(conteudo).digest('hex'), st.dev, st.ino, st.mtimeNs, st.size]));
}

/**
 * O id que todo processo desta maquina deriva do mesmo estado, agora. W6 da revisao 5: alem das
 * partes (o arquivo ruim, ou a pasta), o hostname e o boot (`boot_id` e `machine-id`): VMs clonadas
 * da mesma imagem, com o mesmo arquivo, inode e hostname, tem boot proprio e ganham ids diferentes.
 * Formato de UUID v4.
 */
export function idDerivado(partes: ReadonlyArray<string | bigint>, fontes: readonly string[] = fontesDaMaquina()): string {
  const h = createHash('sha256').update([...partes.map(String), ...fontes].join('\0')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function fontesDaMaquina(): string[] {
  const ler = (arquivo: string) => { try { return fs.readFileSync(arquivo, 'utf8').trim(); } catch { return ''; } };
  return [os.hostname(), ler('/proc/sys/kernel/random/boot_id'), ler('/etc/machine-id')];
}

export const ehIdDeMaquina = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** Publicacao automatica desligada pelo ambiente (testes, `ork eval`, demo). */
export function publicacaoDesligada(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORK_REDE_PUBLICAR === '0' || env.ORK_FABRICA_PUBLICAR === '0';
}

/**
 * D9: toma a vez de tentar publicar, no maximo uma a cada 14 minutos por maquina. Devolve `false`
 * quando a ultima tentativa (evento ou batida) foi ha menos que isso; a marca e gravada antes da
 * tentativa, para duas batidas simultaneas nao dispararem juntas.
 */
export function tomarVezDePublicar(agora: number = Date.now()): boolean {
  try {
    const ultima = Date.parse((JSON.parse(fs.readFileSync(arquivoDaTentativa(), 'utf8')) as { em?: string }).em ?? '');
    if (Number.isFinite(ultima) && agora - ultima < TETO_DE_TENTATIVA_MS && agora >= ultima) return false;
  } catch { /* primeira vez, ou marca ilegivel: tenta */ }
  try {
    fs.mkdirSync(pastaDaRede(), { recursive: true });
    // Dado de maquina: o JSON vai inteiro, sem concatenar o ISO em texto (lint de horario, RM-035).
    fs.writeFileSync(arquivoDaTentativa(), JSON.stringify({ em: new Date(agora).toISOString() }), { mode: 0o600 });
  } catch { return false; }
  return true;
}

/**
 * Evento de thread (criada, fase despachada, entregue, fechada): dispara `ork network publicar
 * --silencioso` sem segurar quem chamou. So para membro, so fora do teto, nunca com a publicacao
 * desligada pelo ambiente.
 */
export function publicarRedeEmSegundoPlano(opcoes: { diretorio?: string; cli?: string; env?: NodeJS.ProcessEnv; agora?: number } = {}): boolean {
  const env = opcoes.env ?? process.env;
  if (publicacaoDesligada(env) || !adesaoDaRede().membro) return false;
  const cli = opcoes.cli ?? path.join(__dirname, 'index.js');
  if (!fs.existsSync(cli) || !tomarVezDePublicar(opcoes.agora)) return false;
  try {
    const filho = spawn(process.execPath, [cli, 'network', 'publicar', '--silencioso'],
      { cwd: opcoes.diretorio ?? process.cwd(), detached: true, stdio: 'ignore', env });
    filho.unref();
    return true;
  } catch { return false; }
}

/** Uma linha JSON por publicacao em segundo plano, em `~/.orkastery/rede/rede.log`: quem publica sozinho deixa rastro. */
export function registrarNaRede(registro: Record<string, unknown>): void {
  try {
    fs.mkdirSync(pastaDaRede(), { recursive: true });
    fs.appendFileSync(path.join(pastaDaRede(), 'rede.log'), JSON.stringify({ ts: agoraIso(), ...registro }) + '\n', { mode: 0o600 });
  } catch { /* o log e informativo */ }
}
