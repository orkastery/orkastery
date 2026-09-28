/**
 * I-33 (D3): perfis de conta por runtime, contrato `ork.runtime-profiles/v1`.
 *
 * Um perfil aponta o DIRETORIO onde o proprio CLI do runtime guarda configuracao e login
 * (`CLAUDE_CONFIG_DIR` no claude-bg, `CODEX_HOME` no codex). O `ork` nunca le, copia nem
 * migra o que o CLI grava la dentro: o login e feito pelo proprio CLI com o env do perfil, e
 * o store guarda so identidade, diretorio e estado de uso. Nenhum segredo entra aqui.
 *
 * O arquivo mora em `<estado>/.orkastery/private/runtime-profiles.json` (diretorio 0700,
 * arquivo 0600, dono igual ao uid do processo), com a mesma validacao do recibo local de
 * HITL: modo exato, sem link simbolico, realpath conferido e identidade do diretorio
 * reconferida depois de abrir o arquivo. Sem store, nao ha perfil: o despacho segue com o
 * ambiente do processo, exatamente como antes (P8 do GOAL).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { formatarDataHora } from './horario';

export const CONTRATO_PERFIS = 'ork.runtime-profiles/v1';
export const ARQUIVO_PERFIS = 'runtime-profiles.json';

/** Runtimes homologados que aceitam perfil, e a variavel que cada um le. */
export const VARIAVEL_DO_PERFIL = { 'claude-bg': 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' } as const;
export type RuntimeComPerfil = keyof typeof VARIAVEL_DO_PERFIL;
export const RUNTIMES_COM_PERFIL = Object.keys(VARIAVEL_DO_PERFIL) as RuntimeComPerfil[];

/**
 * I-33 (D13): `provider-pago` e o perfil cujo proprio CLI diz que o login e por API key,
 * `api_key_helper`, Console ou provider de nuvem, e nao pela assinatura. Nunca recebe despacho;
 * so volta ao rodizio quando `ork accounts check` confere login de assinatura.
 */
export const ESTADOS_DE_PERFIL = ['ativo', 'esgotado', 'sem-auth', 'provider-pago', 'desativado'] as const;
export type EstadoDePerfil = typeof ESTADOS_DE_PERFIL[number];

/** Ultima falha de conta observada no perfil: motivo tipado, instante e trecho curto da evidencia. */
export interface FalhaDePerfil { motivo: string; em: string; detalhe: string }

export interface PerfilDeRuntime {
  id: string;
  runtime: RuntimeComPerfil;
  /** claude-bg: vira `CLAUDE_CONFIG_DIR` do filho. */
  configDir?: string;
  /** codex: vira `CODEX_HOME` do filho. */
  codexHome?: string;
  estado: EstadoDePerfil;
  /** Ate quando o perfil fica fora do rodizio por cota esgotada; `null` sem prazo. */
  esgotadoAte: string | null;
  ultimaFalha: FalhaDePerfil | null;
  ultimoUso: string | null;
  criadoEm: string;
}

export interface StoreDePerfis { contrato: typeof CONTRATO_PERFIS; perfis: PerfilDeRuntime[] }

/** O que vai ao despacho e ao registro da sessao: identidade e diretorio, nunca estado de uso. */
export interface PerfilDeDespacho { id: string; runtime: RuntimeComPerfil; configDir?: string; codexHome?: string }

const ID_DE_PERFIL = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
const LIMITE_STORE_BYTES = 256 * 1024;
const LIMITE_DETALHE = 200;

const uid = (): number => {
  const atual = process.getuid?.();
  if (atual === undefined) throw new Error('runtime.profiles.invalid: uid do processo indisponivel');
  return atual;
};

export function runtimeComPerfil(nome: string): nome is RuntimeComPerfil {
  return Object.prototype.hasOwnProperty.call(VARIAVEL_DO_PERFIL, nome);
}

/** Caminho absoluto, normalizado, sem controle e sem ser a raiz: e so isso que o perfil aceita. */
export function validarDiretorioDePerfil(dir: unknown): string {
  if (typeof dir !== 'string' || dir.length === 0 || dir.length > 1024 || /\p{Cc}/u.test(dir) ||
      !path.isAbsolute(dir) || path.normalize(dir) !== dir || dir === '/' || dir.endsWith('/'))
    throw new Error('runtime.profiles.invalid: diretorio do perfil precisa ser caminho absoluto normalizado');
  return dir;
}

export function validarIdDePerfil(id: unknown): string {
  if (typeof id !== 'string' || !ID_DE_PERFIL.test(id))
    throw new Error('runtime.profiles.invalid: id do perfil aceita letras, digitos, ponto, hifen e sublinhado (ate 63)');
  return id;
}

/** Diretorio do perfil, pelo campo do seu runtime. */
export function diretorioDoPerfil(p: PerfilDeDespacho): string {
  const dir = p.runtime === 'claude-bg' ? p.configDir : p.codexHome;
  return validarDiretorioDePerfil(dir);
}

/** Valida um perfil de despacho vindo do ledger, do thread.json ou do pedido da fila. */
export function validarPerfilDeDespacho(v: unknown): PerfilDeDespacho {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('runtime.profiles.invalid: perfil de despacho ausente');
  const o = v as Record<string, unknown>;
  const runtime = o.runtime;
  if (typeof runtime !== 'string' || !runtimeComPerfil(runtime)) throw new Error('runtime.profiles.invalid: runtime do perfil desconhecido');
  const campo = runtime === 'claude-bg' ? 'configDir' : 'codexHome';
  const outro = runtime === 'claude-bg' ? 'codexHome' : 'configDir';
  if (o[outro] !== undefined || Object.keys(o).some(k => !['id', 'runtime', campo].includes(k)))
    throw new Error('runtime.profiles.invalid: perfil de despacho com campo inesperado');
  const id = validarIdDePerfil(o.id), dir = validarDiretorioDePerfil(o[campo]);
  return runtime === 'claude-bg' ? { id, runtime, configDir: dir } : { id, runtime, codexHome: dir };
}

export function perfilDeDespacho(p: PerfilDeRuntime): PerfilDeDespacho {
  return p.runtime === 'claude-bg' ? { id: p.id, runtime: p.runtime, configDir: diretorioDoPerfil(p) }
    : { id: p.id, runtime: p.runtime, codexHome: diretorioDoPerfil(p) };
}

/**
 * Diretorio implicito de quem despacha sem perfil: o do ambiente informado, ou o padrao do
 * CLI na HOME. E o comportamento anterior a I-33, agora com um unico domicilio.
 */
export function diretorioImplicito(runtime: RuntimeComPerfil, env: NodeJS.ProcessEnv = process.env): string {
  const valor = (env[VARIAVEL_DO_PERFIL[runtime]] ?? '').trim();
  return valor !== '' ? valor : path.join(os.homedir(), runtime === 'claude-bg' ? '.claude' : '.codex');
}

/** Diretorio efetivo: o do perfil registrado, ou o implicito quando a sessao nao tem perfil. */
export function diretorioEfetivo(runtime: RuntimeComPerfil, perfil: PerfilDeDespacho | null | undefined,
  env: NodeJS.ProcessEnv = process.env): string {
  if (!perfil) return diretorioImplicito(runtime, env);
  if (perfil.runtime !== runtime) throw new Error('runtime.profiles.invalid: perfil de outro runtime');
  return diretorioDoPerfil(perfil);
}

/**
 * Ambiente do filho com o perfil aplicado sobre uma base ja higienizada (sem provider pago).
 * Sem perfil devolve a base intacta. Nunca le nada de dentro do diretorio do perfil.
 */
export function ambienteComPerfil(base: NodeJS.ProcessEnv, perfil: PerfilDeDespacho | null | undefined): NodeJS.ProcessEnv {
  const env = { ...base };
  if (perfil) env[VARIAVEL_DO_PERFIL[perfil.runtime]] = diretorioDoPerfil(perfil);
  return env;
}

/**
 * D4: o perfil gravado no registro da sessao. O `session_sensor_registered` do despacho vence;
 * sem ele, o `phase_dispatch` da sessao. Ausente devolve `null` (sessao sem perfil, ambiente do
 * processo); presente e invalido LANCA, porque cair para o env do processo seria observar a
 * sessao pela conta errada, que e o risco R2.
 */
export function perfilDoRegistro(eventos: readonly Record<string, unknown>[],
  sessao: { sessionId: string; despachadaEm?: string }): PerfilDeDespacho | null {
  const doSensor = eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === sessao.sessionId &&
    (sessao.despachadaEm === undefined || e.despachoEm === sessao.despachadaEm)).at(-1);
  const doDespacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId).at(-1);
  const bruto = doSensor?.perfil !== undefined ? doSensor.perfil : doDespacho?.perfil;
  if (bruto === undefined || bruto === null) return null;
  const perfil = validarPerfilDeDespacho(bruto);
  if (doSensor?.perfil !== undefined && doDespacho?.perfil !== undefined &&
      JSON.stringify(validarPerfilDeDespacho(doDespacho.perfil)) !== JSON.stringify(perfil))
    throw new Error('runtime.profiles.invalid: perfil do sensor diverge do despacho');
  return perfil;
}

// ---------------------------------------------------------------------------
// Armazenamento privado.
// ---------------------------------------------------------------------------

export function pastaPrivada(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'private');
}

export function caminhoDoStore(raiz: string): string {
  return path.join(pastaPrivada(raiz), ARQUIVO_PERFIS);
}

function validarPasta(pasta: string): fs.Stats {
  const st = fs.lstatSync(pasta);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid() || (st.mode & 0o777) !== 0o700 ||
      fs.realpathSync(pasta) !== pasta) throw new Error('runtime.profiles.invalid: pasta privada precisa ser 0700 do proprio usuario');
  return st;
}

function garantirPasta(raiz: string): { pasta: string; st: fs.Stats } {
  const pasta = pastaPrivada(raiz);
  const estado = path.dirname(pasta);
  const stEstado = fs.lstatSync(estado);
  if (!stEstado.isDirectory() || stEstado.isSymbolicLink() || fs.realpathSync(estado) !== estado)
    throw new Error('runtime.profiles.invalid: diretorio de estado invalido');
  try { fs.mkdirSync(pasta, { mode: 0o700 }); fs.chmodSync(pasta, 0o700); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  return { pasta, st: validarPasta(pasta) };
}

function storeVazio(): StoreDePerfis { return { contrato: CONTRATO_PERFIS, perfis: [] }; }

function data(v: unknown, campo: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error(`runtime.profiles.invalid: ${campo} invalido`);
  return v;
}

function validarPerfil(v: unknown): PerfilDeRuntime {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('runtime.profiles.invalid: perfil invalido');
  const o = v as Record<string, unknown>;
  const despacho = validarPerfilDeDespacho({ id: o.id, runtime: o.runtime,
    ...(o.configDir !== undefined ? { configDir: o.configDir } : {}), ...(o.codexHome !== undefined ? { codexHome: o.codexHome } : {}) });
  const permitidos = ['id', 'runtime', 'configDir', 'codexHome', 'estado', 'esgotadoAte', 'ultimaFalha', 'ultimoUso', 'criadoEm'];
  if (Object.keys(o).some(k => !permitidos.includes(k))) throw new Error('runtime.profiles.invalid: campo inesperado no perfil');
  if (!ESTADOS_DE_PERFIL.includes(o.estado as EstadoDePerfil)) throw new Error('runtime.profiles.invalid: estado do perfil desconhecido');
  let ultimaFalha: FalhaDePerfil | null = null;
  if (o.ultimaFalha !== null) {
    const f = o.ultimaFalha as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object' || typeof f.motivo !== 'string' || typeof f.detalhe !== 'string' ||
        f.detalhe.length > LIMITE_DETALHE || Object.keys(f).some(k => !['motivo', 'em', 'detalhe'].includes(k)))
      throw new Error('runtime.profiles.invalid: ultimaFalha invalida');
    ultimaFalha = { motivo: f.motivo, em: data(f.em, 'ultimaFalha.em') as string, detalhe: f.detalhe };
  }
  return { ...despacho, estado: o.estado as EstadoDePerfil, esgotadoAte: data(o.esgotadoAte, 'esgotadoAte'),
    ultimaFalha, ultimoUso: data(o.ultimoUso, 'ultimoUso'), criadoEm: data(o.criadoEm, 'criadoEm') as string };
}

/** Conteudo validado; ids unicos e diretorio unico por runtime. */
export function validarStore(v: unknown): StoreDePerfis {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('runtime.profiles.invalid: store invalido');
  const o = v as Record<string, unknown>;
  if (o.contrato !== CONTRATO_PERFIS || !Array.isArray(o.perfis) || Object.keys(o).sort().join(',') !== 'contrato,perfis')
    throw new Error(`runtime.profiles.invalid: contrato ${CONTRATO_PERFIS} esperado`);
  const perfis = o.perfis.map(validarPerfil);
  if (new Set(perfis.map(p => p.id)).size !== perfis.length) throw new Error('runtime.profiles.invalid: id de perfil repetido');
  if (new Set(perfis.map(p => `${p.runtime}|${diretorioDoPerfil(p)}`)).size !== perfis.length)
    throw new Error('runtime.profiles.invalid: dois perfis do mesmo runtime no mesmo diretorio');
  return { contrato: CONTRATO_PERFIS, perfis };
}

/** Le o store. Sem pasta privada ou sem arquivo: store vazio (nenhum perfil configurado). */
export function lerPerfis(raiz: string): StoreDePerfis {
  const pasta = pastaPrivada(raiz);
  let pastaSt: fs.Stats;
  try { pastaSt = validarPasta(pasta); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return storeVazio(); throw e; }
  let fd: number;
  try { fd = fs.openSync(path.join(pasta, ARQUIVO_PERFIS), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return storeVazio();
    throw new Error('runtime.profiles.invalid: arquivo de perfis ilegivel ou link simbolico');
  }
  try {
    const st = fs.fstatSync(fd), atual = fs.lstatSync(pasta);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || (st.mode & 0o777) !== 0o600 || st.size > LIMITE_STORE_BYTES ||
        atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) throw new Error('runtime.profiles.invalid: arquivo de perfis precisa ser 0600 do proprio usuario');
    let bruto: unknown;
    try { bruto = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch { throw new Error('runtime.profiles.invalid: arquivo de perfis com JSON invalido'); }
    return validarStore(bruto);
  } finally { fs.closeSync(fd); }
}

function gravarStore(pasta: string, pastaSt: fs.Stats, store: StoreDePerfis): void {
  gravarArquivoPrivado(pasta, pastaSt, ARQUIVO_PERFIS, JSON.stringify(validarStore(store), null, 2) + '\n');
}

/** Gravacao atomica de um arquivo 0600 numa pasta privada ja conferida (temp, fsync, rename). */
function gravarArquivoPrivado(pasta: string, pastaSt: fs.Stats, arquivo: string, conteudo: string): void {
  const temp = path.join(pasta, `.${arquivo}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    // O umask so tira bits; o modo exato e imposto aqui para a leitura nao reprovar depois.
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, conteudo);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const atual = fs.lstatSync(pasta);
  if (atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) {
    fs.rmSync(temp, { force: true });
    throw new Error('runtime.profiles.invalid: pasta privada trocada durante a gravacao');
  }
  fs.renameSync(temp, path.join(pasta, arquivo));
  const dfd = fs.openSync(pasta, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

const PRAZO_DO_LOCK_MS = 15000;
const LOCK_SEM_DONO_VELHO_MS = 10000;

/** Conteudo do arquivo de dono do lock, ou `null` quando ele ainda nao existe ou ja saiu. */
function lerDono(dono: string): string | null {
  try { return fs.readFileSync(dono, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}

/**
 * D15 (A5): quebra do lock velho sem apagar lock vivo de outro processo. O diretorio e renomeado
 * para um nome unico (so um processo ganha o `rename`); se o dono que foi junto nao e o morto que
 * foi observado, o lock era de um dono novo e volta ao lugar.
 */
function quebrarLockVelho(lock: string, donoObservado: string | null): void {
  const velho = `${lock}.velho.${randomUUID()}`;
  try { fs.renameSync(lock, velho); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  const levado = lerDono(path.join(velho, 'pid'));
  if (levado !== donoObservado) {
    try { fs.renameSync(velho, lock); return; } catch { /* um terceiro ja tomou o lugar: o renomeado e descartado */ }
  }
  fs.rmSync(path.join(velho, 'pid'), { force: true });
  try { fs.rmdirSync(velho); } catch { /* resto alheio fica para inspecao */ }
}

/**
 * Exclusao curta entre processos `ork` que atualizam o store ao mesmo tempo. D15 (A5): o dono pode
 * liberar o lock a qualquer instante entre as leituras de quem espera; `ENOENT` nessas leituras quer
 * dizer "livre agora" e volta ao `mkdir`, nunca vira erro da atualizacao. A espera tem jitter para
 * nao formar comboio e prazo folgado; so o prazo estourado vira `runtime.profiles.busy`.
 */
function comLockDoStore<T>(pasta: string, executar: () => T, arquivo: string = ARQUIVO_PERFIS): T {
  const lock = path.join(pasta, `${arquivo}.lock`), dono = path.join(lock, 'pid');
  const prazo = Date.now() + PRAZO_DO_LOCK_MS, pausa = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const bruto = lerDono(dono);
    let mtimeMs: number;
    try { mtimeMs = fs.statSync(lock).mtimeMs; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    const pid = bruto === null ? null : Number(bruto);
    let vivo = true;
    if (pid !== null && Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (erro) { vivo = (erro as NodeJS.ErrnoException).code !== 'ESRCH'; }
    } else vivo = Date.now() - mtimeMs < LOCK_SEM_DONO_VELHO_MS;
    if (!vivo) { quebrarLockVelho(lock, bruto); continue; }
    if (Date.now() >= prazo) throw new Error('runtime.profiles.busy: store de perfis ocupado; tente novamente');
    Atomics.wait(pausa, 0, 0, 2 + Math.floor(Math.random() * 18));
  }
  try { fs.writeFileSync(dono, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (e) { try { fs.rmdirSync(lock); } catch { /* lock ja tomado */ } throw e; }
  try { return executar(); }
  finally {
    // So libera o lock que ainda e deste processo.
    if (lerDono(dono) === String(process.pid)) { fs.rmSync(dono, { force: true }); try { fs.rmdirSync(lock); } catch { /* ja removido */ } }
  }
}

/** Leitura, mutacao e gravacao sob o lock do store. A mutacao recebe uma copia. */
export function atualizarPerfis<T>(raiz: string, mutar: (store: StoreDePerfis) => T): T {
  const { pasta, st } = garantirPasta(raiz);
  return comLockDoStore(pasta, () => {
    const store = lerPerfis(raiz);
    const copia: StoreDePerfis = { contrato: CONTRATO_PERFIS, perfis: store.perfis.map(p => ({ ...p })) };
    const r = mutar(copia);
    gravarStore(pasta, st, copia);
    return r;
  });
}

function exigirPerfil(store: StoreDePerfis, id: string): PerfilDeRuntime {
  const p = store.perfis.find(x => x.id === id);
  if (!p) throw new Error(`runtime.profiles.unknown: perfil "${id}" nao existe (veja: ork accounts list)`);
  return p;
}

/**
 * A7: identidade do diretorio pelo caminho REAL, resolvendo links do trecho que ja existe (o resto
 * do caminho, ainda nao criado, entra como esta). Dois perfis que chegam a mesma conta por um link
 * simbolico sao o mesmo perfil.
 */
export function caminhoRealDoPerfil(dir: string): string {
  const faltando: string[] = [];
  let atual = dir;
  for (;;) {
    try { return path.join(fs.realpathSync(atual), ...faltando.reverse()); }
    catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (codigo !== 'ENOENT' && codigo !== 'ENOTDIR') return path.join(atual, ...faltando.reverse());
      const pai = path.dirname(atual);
      if (pai === atual) return path.join(atual, ...faltando.reverse());
      faltando.push(path.basename(atual));
      atual = pai;
    }
  }
}

/**
 * A7: cria (0700) ou confere o diretorio de um perfil ANTES de grava-lo: diretorio de verdade, do
 * proprio usuario e com leitura e escrita. Diretorio de outro usuario ou inacessivel nunca vira perfil.
 */
export function prepararDiretorioDoPerfil(dir: string): void {
  validarDiretorioDePerfil(dir);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch (e) { throw new Error(`runtime.profiles.invalid: diretorio do perfil inacessivel (${(e as NodeJS.ErrnoException).code ?? 'erro'})`); }
  let st: fs.Stats;
  try { st = fs.statSync(dir); }
  catch (e) { throw new Error(`runtime.profiles.invalid: diretorio do perfil inacessivel (${(e as NodeJS.ErrnoException).code ?? 'erro'})`); }
  if (!st.isDirectory()) throw new Error('runtime.profiles.invalid: o caminho do perfil nao e diretorio');
  if (st.uid !== uid()) throw new Error('runtime.profiles.invalid: diretorio do perfil pertence a outro usuario');
  try { fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK); }
  catch { throw new Error('runtime.profiles.invalid: diretorio do perfil sem leitura e escrita para este usuario'); }
}

export function adicionarPerfil(raiz: string, novo: { id: string; runtime: string; dir: string },
  agoraIso = new Date().toISOString()): PerfilDeRuntime {
  if (!runtimeComPerfil(novo.runtime)) throw new Error(`runtime.profiles.invalid: runtime "${novo.runtime}" nao aceita perfil`);
  const runtime = novo.runtime;
  const dir = validarDiretorioDePerfil(novo.dir);
  const perfil: PerfilDeRuntime = { id: validarIdDePerfil(novo.id), runtime,
    ...(runtime === 'claude-bg' ? { configDir: dir } : { codexHome: dir }),
    estado: 'ativo', esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: agoraIso };
  return atualizarPerfis(raiz, store => {
    const existente = store.perfis.find(p => p.id === perfil.id);
    if (existente) {
      // A9: `remove` desativa; o mesmo `add` (mesmo id, runtime e diretorio) devolve o perfil ao rodizio.
      if (existente.estado === 'desativado' && existente.runtime === runtime && diretorioDoPerfil(existente) === dir) {
        existente.estado = 'ativo'; existente.esgotadoAte = null;
        return { ...existente };
      }
      throw new Error(`runtime.profiles.invalid: perfil "${perfil.id}" ja existe` +
        (existente.estado === 'desativado' ? ` (desativado em ${diretorioDoPerfil(existente)}; reative com o mesmo --runtime e --dir)` : ''));
    }
    if (store.perfis.some(p => p.runtime === runtime && diretorioDoPerfil(p) === dir))
      throw new Error(`runtime.profiles.invalid: ja ha perfil ${runtime} em ${dir}`);
    // A7: o mesmo diretorio por outro caminho (link simbolico) e a mesma conta, nao outro perfil.
    const real = caminhoRealDoPerfil(dir);
    const mesmo = store.perfis.find(p => p.runtime === runtime && caminhoRealDoPerfil(diretorioDoPerfil(p)) === real);
    if (mesmo) throw new Error(`runtime.profiles.invalid: ${dir} e o mesmo diretorio do perfil "${mesmo.id}" (${real})`);
    store.perfis.push(perfil);
    return perfil;
  });
}

/** `remove` desativa: o diretorio e o login do CLI ficam onde estao. */
export function desativarPerfil(raiz: string, id: string): PerfilDeRuntime {
  return atualizarPerfis(raiz, store => {
    const p = exigirPerfil(store, id);
    p.estado = 'desativado';
    return { ...p };
  });
}

/** Volta ao rodizio (login de assinatura conferido ou prazo de cota vencido). Perfil desativado so volta por `add`. */
export function reativarPerfil(raiz: string, id: string): PerfilDeRuntime {
  const p = atualizarPerfis(raiz, store => {
    const p = exigirPerfil(store, id);
    if (p.estado === 'desativado') throw new Error(`runtime.profiles.invalid: perfil "${id}" esta desativado`);
    p.estado = 'ativo'; p.esgotadoAte = null;
    return { ...p };
  });
  // I-49: login conferido ou prazo vencido vale para a conta, entao sai do registro compartilhado.
  publicarEstadoDaConta(p, raizDoEstado(raiz));
  return p;
}

/**
 * D5: marca a falha de conta. Cota esgotada sai do rodizio ate `esgotadoAte`; auth ausente
 * sai sem prazo, ate o login ser refeito e conferido.
 */
export function marcarFalhaDePerfil(raiz: string, id: string, falha: {
  estado: 'esgotado' | 'sem-auth' | 'provider-pago'; esgotadoAte: string | null; motivo: string; detalhe: string; em?: string;
}): PerfilDeRuntime {
  if (falha.estado === 'esgotado' && (falha.esgotadoAte === null || !Number.isFinite(Date.parse(falha.esgotadoAte))))
    throw new Error('runtime.profiles.invalid: cota esgotada exige esgotadoAte');
  const marcado = atualizarPerfis(raiz, store => {
    const p = exigirPerfil(store, id);
    if (p.estado !== 'desativado') p.estado = falha.estado;
    p.esgotadoAte = falha.estado === 'esgotado' ? falha.esgotadoAte : null;
    p.ultimaFalha = { motivo: falha.motivo, em: falha.em ?? new Date().toISOString(), detalhe: detalheCurto(falha.detalhe) };
    return { ...p };
  });
  // I-49: a falha e da CONTA; as outras fabricas do mesmo usuario passam a enxerga-la.
  if (marcado.estado !== 'desativado') publicarEstadoDaConta(marcado, raizDoEstado(raiz));
  return marcado;
}

const detalheCurto = (detalhe: string): string => Array.from(detalhe.replace(/\p{Cc}/gu, ' ')).slice(0, LIMITE_DETALHE).join('');

/**
 * A14: conferencia de login INCONCLUSIVA (timeout, resposta ilegivel, binario ausente). Nao e prova
 * de login perdido: so a `ultimaFalha` registra o fato, o estado nao muda, e o proximo despacho
 * confere de novo antes de usar o perfil.
 */
export function registrarConferenciaInconclusiva(raiz: string, id: string, detalhe: string, em = new Date().toISOString()): PerfilDeRuntime {
  return atualizarPerfis(raiz, store => {
    const p = exigirPerfil(store, id);
    p.ultimaFalha = { motivo: 'runtime.unavailable', em, detalhe: detalheCurto(`conferencia de login inconclusiva: ${detalhe}`) };
    return { ...p };
  });
}

/** Uso bem sucedido: carimba o instante e devolve ao rodizio o perfil cujo prazo de cota venceu. */
export function registrarUsoDePerfil(raiz: string, id: string, em = new Date().toISOString()): PerfilDeRuntime {
  const p = atualizarPerfis(raiz, store => {
    const p = exigirPerfil(store, id);
    p.ultimoUso = em;
    if (p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) <= Date.parse(em)) {
      p.estado = 'ativo'; p.esgotadoAte = null;
    }
    return { ...p };
  });
  // I-49: uso bem sucedido prova que a conta responde; se outro projeto a marcou, a marca sai.
  if (p.estado === 'ativo' && lerContasCompartilhadas().some((c) => { try { return c.chave === chaveDaConta(p); } catch { return false; } })) {
    publicarEstadoDaConta(p, raizDoEstado(raiz), Date.parse(em));
  }
  return p;
}

// ---------------------------------------------------------------------------
// I-49 (RM-040): estado da CONTA compartilhado entre os projetos do mesmo usuario.
// ---------------------------------------------------------------------------

/**
 * O store de perfis e por projeto, mas a conta e do usuario: tres fabricas na mesma maquina
 * apontam para o mesmo `CLAUDE_CONFIG_DIR`. Quando uma delas ve a cota esgotada, o login perdido
 * ou a credencial paga, as outras precisam saber antes de bater na mesma parede.
 *
 * O registro mora em `~/.orkastery/private/contas.json`, com as mesmas garantias do store (pasta
 * 0700, arquivo 0600 do proprio usuario, sem link simbolico, gravacao atomica sob lock). A chave
 * e o runtime mais o caminho REAL do diretorio do perfil: o id do perfil e do projeto, a conta e
 * do diretorio. Nenhum segredo entra aqui, como no store.
 *
 * O registro so escurece: ele nunca devolve ao rodizio um perfil que o projeto marcou fora, e
 * leitura com problema vale registro vazio (o despacho segue como antes da I-49).
 */
export const CONTRATO_CONTAS = 'ork.contas-compartilhadas/v1';
export const ARQUIVO_CONTAS = 'contas.json';
const LIMITE_CONTAS_BYTES = 64 * 1024;

type EstadoCompartilhado = 'esgotado' | 'sem-auth' | 'provider-pago';
const ESTADOS_COMPARTILHADOS: readonly string[] = ['esgotado', 'sem-auth', 'provider-pago'];

export interface ContaCompartilhada {
  /** `<runtime>:<caminho real do diretorio do perfil>`. */
  chave: string;
  estado: EstadoCompartilhado;
  esgotadoAte: string | null;
  motivo: string;
  detalhe: string;
  em: string;
  /** Raiz do projeto que viu a falha: so para a pessoa saber de onde veio. */
  projeto: string;
}

export interface RegistroDeContas { contrato: typeof CONTRATO_CONTAS; contas: ContaCompartilhada[] }

export function pastaDasContas(): string {
  // Testes e o `ork eval` apontam para uma pasta propria, para nunca tocar o registro do usuario.
  const isolada = process.env.ORK_CONTAS_DIR;
  if (isolada && path.isAbsolute(isolada)) return isolada;
  // Pelo caminho real do home: a pasta privada so vale sem link simbolico no caminho.
  let home = os.homedir();
  try { home = fs.realpathSync(home); } catch { /* home ausente: a leitura vale vazio */ }
  return path.join(home, '.orkastery', 'private');
}

export function chaveDaConta(p: PerfilDeDespacho): string {
  return `${p.runtime}:${caminhoRealDoPerfil(diretorioDoPerfil(p))}`;
}

function validarRegistroDeContas(v: unknown): RegistroDeContas {
  if (!v || typeof v !== 'object' || (v as { contrato?: unknown }).contrato !== CONTRATO_CONTAS ||
      !Array.isArray((v as { contas?: unknown }).contas)) throw new Error('runtime.profiles.invalid: registro de contas invalido');
  const contas = (v as { contas: unknown[] }).contas.map((c) => {
    const o = c as Record<string, unknown>;
    if (!o || typeof o.chave !== 'string' || !ESTADOS_COMPARTILHADOS.includes(String(o.estado)) ||
        typeof o.motivo !== 'string' || typeof o.detalhe !== 'string' || typeof o.projeto !== 'string' || typeof o.em !== 'string')
      throw new Error('runtime.profiles.invalid: conta compartilhada invalida');
    return { chave: o.chave, estado: o.estado as EstadoCompartilhado, esgotadoAte: data(o.esgotadoAte ?? null, 'esgotadoAte'),
      motivo: o.motivo, detalhe: detalheCurto(o.detalhe), em: data(o.em, 'em') as string, projeto: o.projeto };
  });
  return { contrato: CONTRATO_CONTAS, contas };
}

/** Le o registro. Ausente, ilegivel ou com dono e modo errados vale vazio: o registro so escurece. */
export function lerContasCompartilhadas(): ContaCompartilhada[] {
  const pasta = pastaDasContas();
  try {
    const pastaSt = validarPasta(pasta);
    const fd = fs.openSync(path.join(pasta, ARQUIVO_CONTAS), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd), atual = fs.lstatSync(pasta);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== uid() || (st.mode & 0o777) !== 0o600 || st.size > LIMITE_CONTAS_BYTES ||
          atual.dev !== pastaSt.dev || atual.ino !== pastaSt.ino) return [];
      return validarRegistroDeContas(JSON.parse(fs.readFileSync(fd, 'utf8'))).contas;
    } finally { fs.closeSync(fd); }
  } catch {
    return [];
  }
}

function garantirPastaDasContas(): { pasta: string; st: fs.Stats } {
  const pasta = pastaDasContas();
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  fs.chmodSync(pasta, 0o700);
  return { pasta, st: validarPasta(pasta) };
}

/** O diretorio da conta ainda existe? Entrada de diretorio apagado (sandbox, conta removida) sai. */
function contaAindaExiste(c: ContaCompartilhada): boolean {
  const dir = c.chave.slice(c.chave.indexOf(':') + 1);
  return path.isAbsolute(dir) && fs.existsSync(dir);
}

/**
 * Grava no registro o estado que o projeto acabou de ver na conta do perfil: falha de conta
 * entra (ou substitui a anterior), perfil de volta ao rodizio sai. Entradas com prazo vencido
 * saem junto. Melhor esforco: o registro nunca derruba a operacao do projeto.
 */
export function publicarEstadoDaConta(p: PerfilDeRuntime, projeto: string, agoraMs = Date.now()): void {
  try {
    const chave = chaveDaConta(p);
    const { pasta, st } = garantirPastaDasContas();
    comLockDoStore(pasta, () => {
      const vivas = lerContasCompartilhadas().filter((c) => c.chave !== chave && contaAindaExiste(c) &&
        !(c.estado === 'esgotado' && c.esgotadoAte !== null && Date.parse(c.esgotadoAte) <= agoraMs));
      if (ESTADOS_COMPARTILHADOS.includes(p.estado) && !(p.estado === 'esgotado' && p.esgotadoAte === null)) {
        vivas.push({ chave, estado: p.estado as EstadoCompartilhado, esgotadoAte: p.estado === 'esgotado' ? p.esgotadoAte : null,
          motivo: p.ultimaFalha?.motivo ?? 'runtime.unavailable', detalhe: p.ultimaFalha?.detalhe ?? '',
          em: p.ultimaFalha?.em ?? new Date(agoraMs).toISOString(), projeto });
      }
      gravarArquivoPrivado(pasta, st, ARQUIVO_CONTAS,
        JSON.stringify({ contrato: CONTRATO_CONTAS, contas: vivas } satisfies RegistroDeContas, null, 2) + '\n');
    }, ARQUIVO_CONTAS);
  } catch { /* o registro compartilhado e melhor esforco: o store do projeto ja foi gravado */ }
}

/**
 * O store do projeto com o que as outras fabricas viram na mesma conta. So escurece: perfil
 * desativado ou com credencial paga continua como esta; esgotado local com prazo maior mantem o
 * dele. Entrada vencida nao vale.
 */
export function aplicarContasCompartilhadas(store: StoreDePerfis, contas: readonly ContaCompartilhada[],
  agoraMs = Date.now()): StoreDePerfis {
  if (contas.length === 0) return store;
  const porChave = new Map(contas.map((c) => [c.chave, c]));
  return { contrato: store.contrato, perfis: store.perfis.map((p) => {
    if (p.estado === 'desativado' || p.estado === 'provider-pago') return p;
    let c: ContaCompartilhada | undefined;
    try { c = porChave.get(chaveDaConta(p)); } catch { return p; }
    if (!c) return p;
    const falha = { motivo: c.motivo, em: c.em, detalhe: detalheCurto(`visto em outro projeto: ${c.detalhe}`) };
    if (c.estado === 'esgotado') {
      const ate = c.esgotadoAte === null ? NaN : Date.parse(c.esgotadoAte);
      if (!(ate > agoraMs)) return p;
      if (p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) >= ate) return p;
      if (p.estado === 'sem-auth') return p;
      return { ...p, estado: 'esgotado', esgotadoAte: c.esgotadoAte, ultimaFalha: falha };
    }
    return { ...p, estado: c.estado, esgotadoAte: null, ultimaFalha: falha };
  }) };
}

/** Os perfis que o despacho enxerga: o store do projeto com o estado compartilhado das contas. */
export function lerPerfisComContas(raiz: string, agoraMs = Date.now()): StoreDePerfis {
  return aplicarContasCompartilhadas(lerPerfis(raiz), lerContasCompartilhadas(), agoraMs);
}

// ---------------------------------------------------------------------------
// Escolha do perfil (leitura pura do store).
// ---------------------------------------------------------------------------

export function perfisDoRuntime(store: StoreDePerfis, runtime: string): PerfilDeRuntime[] {
  return store.perfis.filter(p => p.runtime === runtime);
}

/** Ativo, ou esgotado com o prazo ja vencido. `sem-auth`, `provider-pago` e `desativado` nunca recebem despacho. */
export function perfilDisponivel(p: PerfilDeRuntime, agoraMs = Date.now()): boolean {
  if (p.estado === 'ativo') return true;
  return p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) <= agoraMs;
}

/**
 * I-33 (D14, D16): politica de troca automatica entre perfis do MESMO runtime, lida do manifesto
 * (`runtime_profiles.rotate_same_runtime_on_quota` e `..._on_auth`). A troca entre runtimes pela
 * ordem de fallback do bloco nao depende dela. O que e esgotamento (troca) e o que e rate limit
 * comum (nunca troca, espera a janela) sai do criterio unico `naturezaDoLimite` (adapters/claude-bg).
 */
export interface PoliticaDeRotacao { mesmoRuntimePorCota: boolean; mesmoRuntimePorAuth: boolean }
/** Defaults da D16: por cota ligada (decisao do dono em 19/09/2026) e por login perdido ligada. */
export const POLITICA_PADRAO: PoliticaDeRotacao = { mesmoRuntimePorCota: true, mesmoRuntimePorAuth: true };

export function politicaDeRotacao(manifesto: { runtime_profiles?: { rotate_same_runtime_on_quota?: unknown;
  rotate_same_runtime_on_auth?: unknown } }): PoliticaDeRotacao {
  const r = manifesto.runtime_profiles;
  return { mesmoRuntimePorCota: r?.rotate_same_runtime_on_quota !== false,
    mesmoRuntimePorAuth: r?.rotate_same_runtime_on_auth !== false };
}

/**
 * D14: o perfil da vez do runtime, na ordem do store. `desativado` e `provider-pago` nunca foram
 * elegiveis e sao pulados. `sem-auth` so e pulado com a troca por login ligada. Perfil esgotado
 * (ou ja tentado nesta rotacao) so e pulado com a troca por cota ligada: desligada, ele SEGURA o
 * runtime ate o prazo, e nenhum outro perfil do mesmo runtime o substitui automaticamente.
 */
export function proximoPerfilDisponivel(store: StoreDePerfis, runtime: string, politica: PoliticaDeRotacao,
  opcoes: { excluir?: readonly string[]; agoraMs?: number } = {}): PerfilDeRuntime | null {
  const agoraMs = opcoes.agoraMs ?? Date.now();
  for (const p of perfisDoRuntime(store, runtime)) {
    if (p.estado === 'desativado' || p.estado === 'provider-pago') continue;
    if (p.estado === 'sem-auth') { if (politica.mesmoRuntimePorAuth) continue; return null; }
    if (!(opcoes.excluir ?? []).includes(p.id) && perfilDisponivel(p, agoraMs)) return p;
    if (!politica.mesmoRuntimePorCota) return null;
  }
  return null;
}

/**
 * D14: quando o runtime volta a ter perfil da vez, pela mesma regra da escolha. Com a troca por
 * cota desligada, e o prazo do perfil que segura o runtime; ligada, o menor prazo entre os
 * esgotados. Sem prazo (so login ausente, ou perfil ainda disponivel), `null`.
 */
export function prazoDoRuntime(store: StoreDePerfis, runtime: string, politica: PoliticaDeRotacao, agoraMs = Date.now()): string | null {
  const prazos: string[] = [];
  for (const p of perfisDoRuntime(store, runtime)) {
    if (p.estado === 'desativado' || p.estado === 'provider-pago') continue;
    if (p.estado === 'sem-auth') { if (politica.mesmoRuntimePorAuth) continue; break; }
    if (p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) > agoraMs) prazos.push(p.esgotadoAte);
    if (!politica.mesmoRuntimePorCota) break;
  }
  return prazos.sort()[0] ?? null;
}

/** Menor prazo entre os runtimes informados, pela politica da D14: prazo da fila duravel (P4). */
export function prazoDaFila(store: StoreDePerfis, runtimes: readonly string[], politica: PoliticaDeRotacao,
  agoraMs = Date.now()): string | null {
  return runtimes.map(r => prazoDoRuntime(store, r, politica, agoraMs)).filter((p): p is string => p !== null).sort()[0] ?? null;
}

/** Menor `esgotadoAte` futuro entre os perfis dos runtimes informados, sem politica (leitura do store). */
export function menorEsgotadoAte(store: StoreDePerfis, runtimes: readonly string[], agoraMs = Date.now()): string | null {
  const prazos = store.perfis.filter(p => runtimes.includes(p.runtime) && p.estado === 'esgotado' && p.esgotadoAte !== null &&
    Date.parse(p.esgotadoAte) > agoraMs).map(p => p.esgotadoAte as string).sort();
  return prazos[0] ?? null;
}

/**
 * Linhas da tabela de `ork accounts list` e `ork accounts check`: sem segredo, porque o store
 * nao guarda nenhum. I-35: a tabela e texto para pessoa, entao as tres colunas de horario saem
 * no fuso do dono; o store e a saida `--json` continuam em UTC ISO. Quem imprime diz o fuso uma
 * vez, pela `legendaDoFuso()`, quando `perfisComHorario` acusa alguma coluna preenchida.
 */
export function linhasDePerfis(store: StoreDePerfis): string[][] {
  return store.perfis.map(p => [p.id, p.runtime, diretorioDoPerfil(p), p.estado,
    p.esgotadoAte ? formatarDataHora(p.esgotadoAte) : '-', p.ultimoUso ? formatarDataHora(p.ultimoUso) : '-',
    p.ultimaFalha ? `${p.ultimaFalha.motivo} em ${formatarDataHora(p.ultimaFalha.em)}` : '-']);
}

/** True quando a tabela mostra algum horario, e a mensagem precisa dizer o fuso uma vez. */
export function perfisComHorario(store: StoreDePerfis): boolean {
  return store.perfis.some(p => p.esgotadoAte !== null || p.ultimoUso !== null || p.ultimaFalha !== null);
}
export const COLUNAS_DE_PERFIS = ['PERFIL', 'RUNTIME', 'DIRETORIO', 'ESTADO', 'ESGOTADO ATE', 'ULTIMO USO', 'ULTIMA FALHA'];
