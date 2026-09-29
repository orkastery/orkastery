/**
 * RM-052: o projeto-alvo explicito.
 *
 * Em 29/09/2026 o dono pediu pelo Telegram o status do roadmap do orkastery e recebeu o panorama de
 * `~/.openclaw/workspace`: as tools do host chamavam o `ork` sem projeto, o nucleo resolvia pelo
 * `process.cwd()` do gateway e a saida nao dizia qual projeto tinha lido. Este modulo e a correcao
 * no nucleo, em tres pecas:
 *
 *   1. o REGISTRO dos projetos desta maquina, `~/.orkastery/projetos.json` (contrato
 *      `ork.projetos/v1`), alimentado por `ork init`, `ork thread new` e `ork fabrica entrar`. So
 *      identificadores: nome, abbrev, raiz, remoto sem credencial e datas. Nenhum segredo;
 *   2. a RESOLUCAO do projeto-alvo, com precedencia explicita sobre o cwd:
 *      `--projeto` > `ORK_PROJETO` > host sem cwd (`ORK_PROJETO_EXPLICITO=1`) > cwd. Nome ambiguo ou
 *      desconhecido recusa com `ErroDeProjeto` e a lista de candidatos; o nucleo nunca chuta;
 *   3. o CABECALHO da consulta (`ork.consulta/v1`): qual projeto foi lido, por que ele, e o que NAO
 *      foi lido, para nenhum leitor concluir "roadmap vazio" a partir de um board sem threads.
 *
 * O registro e por MAQUINA e nao reusa o portfolio da RM-019 (D1): o portfolio e estado canonico de
 * UM projeto e nao conhece as raizes locais das copias. RM-053 e RM-054 leem este contrato.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { carregarManifesto, fixarDiretorioDoProjeto, ManifestoCarregado, NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';
import { pastaDoUsuario } from './maquina';
import { procurarSegredos } from './policies';
import { redigirCredenciaisUrl } from './redacao-url';
import { exec, subirAte } from './util';

export const CONTRATO_PROJETOS = 'ork.projetos/v1' as const;
export const CONTRATO_CONSULTA = 'ork.consulta/v1' as const;
/** O projeto pedido pelo ambiente, abaixo de `--projeto` e acima do cwd. */
export const ENV_PROJETO = 'ORK_PROJETO';
/** Declarado pelos adaptadores de host: o cwd do gateway nao e projeto de ninguem (D3). */
export const ENV_PROJETO_EXPLICITO = 'ORK_PROJETO_EXPLICITO';
/** Codigo de saida da recusa de projeto-alvo no CLI (D3). */
export const SAIDA_DE_PROJETO = 4;
const ARQUIVO = 'projetos.json';
const TRAVA = 'projetos.json.lock';
/** Nome ou abbrev de projeto: o mesmo alfabeto dos identificadores de thread, sem barra. */
export const PADRAO_DO_NOME_DE_PROJETO = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export type FonteDoRegistro = 'init' | 'thread new' | 'fabrica entrar' | 'projetos registrar' | 'mcp thread new';

export interface ProjetoRegistrado {
  nome: string;
  abbrev: string;
  /** Raiz canonica: a arvore principal, nunca a worktree de uma thread. */
  raiz: string;
  /** URL do remoto da fabrica (`fabrica.remoto`, padrao `origin`), sem credencial; `null` sem remoto. */
  remoto: string | null;
  registradoEm: string;
  atualizadoEm: string;
  fonte: FonteDoRegistro;
}

export interface RegistroDeProjetos {
  contrato: typeof CONTRATO_PROJETOS;
  atualizadoEm: string | null;
  projetos: ProjetoRegistrado[];
}

/** Um projeto do registro com o fato do disco: o manifesto ainda esta na raiz? */
export interface ProjetoListado extends ProjetoRegistrado { presente: boolean }

/**
 * De onde veio o projeto consultado. `instalacao` e o servidor MCP, fixado no startup; `cwd` e o
 * comportamento de sempre do terminal.
 */
export type OrigemDoProjeto = 'opcao' | 'ambiente' | 'unico-conhecido' | 'cwd' | 'instalacao';

export interface ProjetoAlvo {
  raiz: string;
  origem: OrigemDoProjeto;
  /** O que foi pedido (`--projeto`/`ORK_PROJETO`), quando foi. */
  pedido: string | null;
}

export type CodigoDeProjeto = 'projeto.desconhecido' | 'projeto.ambiguo' | 'projeto.sem-manifesto' |
  'projeto.escolha' | 'projeto.nenhum' | 'projeto.fora-do-servidor';

export interface CandidatoDeProjeto { nome: string; abbrev: string; raiz: string; remoto: string | null; presente: boolean }

/** A recusa tipada: o texto para o humano, o JSON para o host, os candidatos para escolher. */
export class ErroDeProjeto extends Error {
  constructor(readonly codigo: CodigoDeProjeto, readonly detalhe: string, readonly candidatos: CandidatoDeProjeto[],
      readonly correcao: string) {
    super(`${codigo}: ${detalhe}`);
    this.name = 'ErroDeProjeto';
  }

  get recusa(): { erro: CodigoDeProjeto; detalhe: string; candidatos: CandidatoDeProjeto[]; correcao: string } {
    return { erro: this.codigo, detalhe: this.detalhe, candidatos: this.candidatos, correcao: this.correcao };
  }

  get texto(): string {
    return [
      `${this.codigo}: ${this.detalhe}`,
      ...(this.candidatos.length ? ['Candidatos:', ...this.candidatos.map((c) => `  • ${linhaDoCandidato(c)}`)] : []),
      this.correcao,
    ].join('\n');
  }
}

function linhaDoCandidato(c: CandidatoDeProjeto): string {
  return `${c.nome} (${c.abbrev || '-'}) · ${c.raiz} · ${c.remoto ?? 'sem remoto'}${c.presente ? '' : ' · ausente do disco'}`;
}

// ---------------------------------------------------------------------------
// O registro.
// ---------------------------------------------------------------------------

export function caminhoDoRegistro(): string {
  return path.join(pastaDoUsuario(), ARQUIVO);
}

const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const textoCurto = (v: unknown, teto: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= teto &&
  !/[\x00-\x1f\x7f]/.test(v);
const FONTES: readonly FonteDoRegistro[] = ['init', 'thread new', 'fabrica entrar', 'projetos registrar', 'mcp thread new'];

function entradaValida(v: unknown): v is ProjetoRegistrado {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return textoCurto(e.nome, 120) && typeof e.abbrev === 'string' && e.abbrev.length <= 16 &&
    textoCurto(e.raiz, 4096) && path.isAbsolute(e.raiz as string) &&
    (e.remoto === null || textoCurto(e.remoto, 2048)) && iso(e.registradoEm) && iso(e.atualizadoEm) &&
    FONTES.includes(e.fonte as FonteDoRegistro);
}

/** Leitura tolerante: arquivo ausente, corrompido ou de outro contrato vale registro vazio. */
export function lerRegistroDeProjetos(): RegistroDeProjetos {
  const vazio: RegistroDeProjetos = { contrato: CONTRATO_PROJETOS, atualizadoEm: null, projetos: [] };
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(caminhoDoRegistro(), 'utf8')); } catch { return vazio; }
  if (!bruto || typeof bruto !== 'object' || (bruto as { contrato?: unknown }).contrato !== CONTRATO_PROJETOS) return vazio;
  const projetos = (bruto as { projetos?: unknown }).projetos;
  const atualizadoEm = (bruto as { atualizadoEm?: unknown }).atualizadoEm;
  return { contrato: CONTRATO_PROJETOS, atualizadoEm: iso(atualizadoEm) ? atualizadoEm : null,
    projetos: Array.isArray(projetos) ? projetos.filter(entradaValida) : [] };
}

/** O manifesto ainda esta na raiz registrada? */
function manifestoPresente(raiz: string): boolean {
  return [NOME_MANIFESTO, NOME_MANIFESTO_LEGADO].some((n) => fs.existsSync(path.join(raiz, n)));
}

export function listarProjetos(): ProjetoListado[] {
  return lerRegistroDeProjetos().projetos.map((p) => ({ ...p, presente: manifestoPresente(p.raiz) }))
    .sort((a, b) => a.nome.localeCompare(b.nome) || a.raiz.localeCompare(b.raiz));
}

/** A raiz canonica de uma copia: a arvore principal da worktree, com caminho real. */
export function raizCanonica(raiz: string): string {
  const real = fs.realpathSync(path.resolve(raiz));
  try { return fs.realpathSync(raizDoEstado(real)); } catch { return real; }
}

/**
 * A URL do remoto sem usuario nem senha: saem inteiros, nao so redigidos, como a RM-053 le o
 * registro. A forma scp do git (`git@host:dono/repo.git`) e caminho local ficam como estao: o
 * usuario de transporte nao e segredo. URL que nao se deixa ler cai na redacao de sempre.
 */
export function remotoSemCredencial(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = ''; u.password = '';
    return u.toString();
  } catch { return redigirCredenciaisUrl(url); }
}

/** URL do remoto, sem credencial. `null` quando o projeto nao tem aquele remoto. */
export function remotoDoProjeto(raiz: string, remoto = 'origin'): string | null {
  const r = exec('git', ['remote', 'get-url', remoto], raiz, 5000);
  const url = r.ok ? r.stdout.trim() : '';
  return url ? remotoSemCredencial(url) : null;
}

/**
 * Trava curta do registro. O registro e um indice de conveniencia (D7): quem segura a trava e um
 * processo vivo; trava de processo que ja morreu e retomada, porque ninguem mais vai solta-la.
 */
function comTrava<T>(alterar: () => T, esperaMs = 2000): T {
  const dir = pastaDoUsuario(), trava = path.join(dir, TRAVA);
  fs.mkdirSync(dir, { recursive: true });
  const limite = Date.now() + esperaMs;
  let fd: number;
  for (;;) {
    try { fd = fs.openSync(trava, 'wx', 0o600); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let dono = 0;
      try { dono = Number(JSON.parse(fs.readFileSync(trava, 'utf8')).pid); } catch { /* trava sendo escrita */ }
      if (Number.isSafeInteger(dono) && dono > 0 && !processoVivo(dono)) { fs.rmSync(trava, { force: true }); continue; }
      if (Date.now() >= limite) throw new Error(`registro de projetos ocupado (${trava}); tente de novo`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, em: new Date().toISOString() }));
    return alterar();
  } finally { fs.closeSync(fd); fs.rmSync(trava, { force: true }); }
}

function processoVivo(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function gravarRegistro(registro: RegistroDeProjetos): void {
  const dir = pastaDoUsuario(), destino = caminhoDoRegistro();
  const conteudo = JSON.stringify(registro, null, 2) + '\n';
  // Varredura final: o arquivo nunca carrega credencial, nem por um remoto mal redigido.
  if (procurarSegredos(conteudo).length) throw new Error('registro de projetos recusado: o conteudo parece carregar segredo');
  const temp = path.join(dir, `.${ARQUIVO}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, conteudo, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, destino);
  } finally { fs.rmSync(temp, { force: true }); }
}

/**
 * O projeto de um caminho qualquer dentro dele: a raiz do manifesto e, quando ela e a worktree de
 * uma thread, a arvore principal (se a principal tem o proprio manifesto). `null` sem manifesto.
 */
function projetoDoCaminho(caminho: string): { raiz: string; carregado: ManifestoCarregado } | null {
  const local = carregarManifesto(caminho);
  if (!local) return null;
  const raizLocal = fs.realpathSync(local.raiz), canonica = raizCanonica(raizLocal);
  if (canonica !== raizLocal) {
    const principal = carregarManifesto(canonica);
    if (principal && fs.realpathSync(principal.raiz) === canonica) return { raiz: canonica, carregado: principal };
  }
  return { raiz: raizLocal, carregado: local };
}

/**
 * Registra (ou atualiza) o projeto do caminho informado. A raiz vira a canonica: registrar de dentro
 * da worktree de uma thread registra a arvore principal.
 */
export function registrarProjeto(caminho: string, fonte: FonteDoRegistro,
    opcoes: { quando?: string; esperaMs?: number } = {}): ProjetoRegistrado {
  const achado = projetoDoCaminho(caminho);
  if (!achado) {
    throw new ErroDeProjeto('projeto.sem-manifesto', `nenhum manifesto do ork em ${raizParaExibir(path.resolve(caminho))}`, [],
      'Rode `ork init` na raiz do projeto antes de registrá-lo.');
  }
  const { raiz: canonica, carregado } = achado;
  if (carregado.erros.length) throw new Error(`registro de projetos: manifesto inválido em ${carregado.caminho}`);
  const quando = opcoes.quando ?? new Date().toISOString();
  const novo: Omit<ProjetoRegistrado, 'registradoEm'> = {
    nome: carregado.manifesto.project.name, abbrev: carregado.manifesto.project.abbrev, raiz: canonica,
    remoto: remotoDoProjeto(canonica, carregado.manifesto.fabrica?.remoto ?? 'origin'), atualizadoEm: quando, fonte,
  };
  if (procurarSegredos(JSON.stringify(novo)).length) {
    throw new Error('registro de projetos recusado: a entrada parece carregar segredo');
  }
  return comTrava(() => {
    const registro = lerRegistroDeProjetos();
    const anterior = registro.projetos.find((p) => p.raiz === canonica);
    const entrada: ProjetoRegistrado = { ...novo, registradoEm: anterior?.registradoEm ?? quando };
    registro.projetos = [...registro.projetos.filter((p) => p.raiz !== canonica), entrada]
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.raiz.localeCompare(b.raiz));
    registro.atualizadoEm = quando;
    gravarRegistro(registro);
    return entrada;
  }, opcoes.esperaMs);
}

/**
 * D7: o registro nunca derruba o comando que o alimenta. Devolve o aviso para o terminal, ou `null`.
 */
export function registrarProjetoEmSilencio(raiz: string, fonte: FonteDoRegistro): string | null {
  try { registrarProjeto(raiz, fonte); return null; }
  catch (e) { return `aviso: projeto não registrado em ${caminhoDoRegistro()} (${(e as Error).message})`; }
}

/** Tira do registro por nome, abbrev ou caminho. Nada casou e recusa, com os registrados. */
export function esquecerProjeto(alvo: string, cwd = process.cwd()): ProjetoRegistrado[] {
  const valor = alvo.trim();
  return comTrava(() => {
    const registro = lerRegistroDeProjetos();
    const porCaminho = ehCaminho(valor) ? caminhoPossivel(valor, cwd) : null;
    const sai = registro.projetos.filter((p) => porCaminho ? p.raiz === porCaminho : casaNome(p, valor));
    if (!sai.length) {
      throw new ErroDeProjeto('projeto.desconhecido', `"${valor}" não está no registro de projetos desta máquina`,
        registro.projetos.map(candidatoDoRegistro), 'Veja os registrados com `ork projetos`.');
    }
    registro.projetos = registro.projetos.filter((p) => !sai.includes(p));
    registro.atualizadoEm = new Date().toISOString();
    gravarRegistro(registro);
    return sai;
  });
}

// ---------------------------------------------------------------------------
// A resolucao.
// ---------------------------------------------------------------------------

function ehCaminho(valor: string): boolean {
  return valor.includes('/') || valor.startsWith('.') || valor.startsWith('~') || path.isAbsolute(valor);
}

function expandirHome(valor: string): string {
  return valor === '~' ? os.homedir() : valor.startsWith('~/') ? path.join(os.homedir(), valor.slice(2)) : valor;
}

/** Caminho real quando existe; o resolvido quando nao (esquecer uma raiz que sumiu do disco). */
function caminhoPossivel(valor: string, cwd: string): string {
  const resolvido = path.resolve(cwd, expandirHome(valor));
  try { return fs.realpathSync(resolvido); } catch { return resolvido; }
}

function casaNome(p: { nome: string; abbrev: string }, valor: string): boolean {
  const v = valor.toLowerCase();
  return p.nome.toLowerCase() === v || (!!p.abbrev && p.abbrev.toLowerCase() === v);
}

function candidatoDoRegistro(p: ProjetoRegistrado): CandidatoDeProjeto {
  return { nome: p.nome, abbrev: p.abbrev, raiz: raizParaExibir(p.raiz), remoto: p.remoto, presente: manifestoPresente(p.raiz) };
}

/** A raiz do manifesto a partir de um caminho qualquer dentro do projeto. */
function raizPorCaminho(valor: string, cwd: string): string {
  const dir = path.resolve(cwd, expandirHome(valor));
  if (!fs.existsSync(dir)) {
    throw new ErroDeProjeto('projeto.sem-manifesto', `o caminho ${raizParaExibir(dir)} não existe`, [],
      'Informe o caminho da raiz de um projeto com orkastery.yaml, ou o nome de um projeto registrado (`ork projetos`).');
  }
  const achada = subirAte(dir, NOME_MANIFESTO) ?? subirAte(dir, NOME_MANIFESTO_LEGADO);
  if (!achada) {
    throw new ErroDeProjeto('projeto.sem-manifesto', `nenhum orkastery.yaml em ${raizParaExibir(dir)} nem acima dele`, [],
      'Rode `ork init` na raiz do projeto, ou informe o nome de um projeto registrado (`ork projetos`).');
  }
  return fs.realpathSync(achada);
}

function raizPorNome(valor: string): string {
  if (!PADRAO_DO_NOME_DE_PROJETO.test(valor)) {
    throw new ErroDeProjeto('projeto.desconhecido', `"${valor}" não é um nome de projeto válido`,
      lerRegistroDeProjetos().projetos.map(candidatoDoRegistro), 'Use o nome ou o abbrev de um projeto de `ork projetos`.');
  }
  const registrados = lerRegistroDeProjetos().projetos;
  const casados = registrados.filter((p) => casaNome(p, valor));
  const presentes = casados.filter((p) => manifestoPresente(p.raiz));
  if (presentes.length === 1) return presentes[0].raiz;
  if (presentes.length > 1) {
    throw new ErroDeProjeto('projeto.ambiguo', `"${valor}" casa ${presentes.length} projetos registrados nesta máquina`,
      presentes.map(candidatoDoRegistro), 'Repita com o caminho da raiz (`--projeto <caminho>`), ou tire a cópia que sobra com `ork projetos esquecer <caminho>`.');
  }
  throw new ErroDeProjeto('projeto.desconhecido',
    casados.length ? `"${valor}" está registrado, mas o manifesto não está mais na raiz` : `"${valor}" não está no registro de projetos desta máquina`,
    registrados.map(candidatoDoRegistro),
    'Veja os registrados com `ork projetos`; registre uma cópia com `ork projetos registrar <caminho>`.');
}

function resolverValor(valor: string, cwd: string): string {
  return ehCaminho(valor) ? raizPorCaminho(valor, cwd) : raizPorNome(valor);
}

/** Os candidatos de um host sem cwd de projeto: o registro presente e o projeto do cwd, sem repetir. */
export function candidatosDoHost(cwd: string): { raiz: string; candidato: CandidatoDeProjeto }[] {
  const saida = new Map<string, CandidatoDeProjeto>();
  for (const p of lerRegistroDeProjetos().projetos) {
    if (manifestoPresente(p.raiz)) saida.set(p.raiz, candidatoDoRegistro(p));
  }
  const temManifesto = subirAte(path.resolve(cwd), NOME_MANIFESTO) ?? subirAte(path.resolve(cwd), NOME_MANIFESTO_LEGADO);
  const local = temManifesto ? projetoDoCaminho(temManifesto) : null;
  if (local && !saida.has(local.raiz)) {
    const { raiz, carregado } = local;
    saida.set(raiz, { nome: carregado.manifesto.project.name, abbrev: carregado.manifesto.project.abbrev,
      raiz: raizParaExibir(raiz), remoto: remotoDoProjeto(raiz, carregado.manifesto.fabrica?.remoto ?? 'origin'), presente: true });
  }
  return [...saida.entries()].map(([raiz, candidato]) => ({ raiz, candidato }))
    .sort((a, b) => a.candidato.nome.localeCompare(b.candidato.nome) || a.raiz.localeCompare(b.raiz));
}

export interface EntradaDaResolucao {
  /** O valor de `--projeto`; `''` (opcao sem valor) e recusa. */
  opcao?: string | null;
  ambiente?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * O projeto-alvo do processo, ou `null` quando vale o cwd de sempre. Precedencia (D2):
 * `--projeto` > `ORK_PROJETO` > host sem cwd (`ORK_PROJETO_EXPLICITO=1`, D3) > cwd.
 */
export function resolverProjetoAlvo(entrada: EntradaDaResolucao = {}): ProjetoAlvo | null {
  const ambiente = entrada.ambiente ?? process.env, cwd = entrada.cwd ?? process.cwd();
  const host = (ambiente[ENV_PROJETO_EXPLICITO] ?? '').trim() === '1';
  if (entrada.opcao !== undefined && entrada.opcao !== null) {
    const valor = entrada.opcao.trim();
    if (!valor) {
      throw new ErroDeProjeto('projeto.desconhecido', '--projeto sem valor', lerRegistroDeProjetos().projetos.map(candidatoDoRegistro),
        'Uso: --projeto <nome|caminho>; os nomes registrados estão em `ork projetos`.');
    }
    // D4 (F1 do CHECK): no host, quem pede escolhe entre os projetos da maquina pelo NOME. Caminho nao
    // entra por nenhuma tool, nem pela que repassa os argumentos como dados (os scripts do Hermes).
    if (host && ehCaminho(valor)) {
      throw new ErroDeProjeto('projeto.desconhecido', `no host o projeto vem pelo nome registrado; o caminho "${valor}" não é aceito`,
        lerRegistroDeProjetos().projetos.map(candidatoDoRegistro), 'Use o nome de um projeto de `ork projetos` (ex.: --projeto orkastery).');
    }
    return { raiz: resolverValor(valor, cwd), origem: 'opcao', pedido: valor };
  }
  const doAmbiente = (ambiente[ENV_PROJETO] ?? '').trim();
  if (doAmbiente) return { raiz: resolverValor(doAmbiente, cwd), origem: 'ambiente', pedido: doAmbiente };
  if (host) {
    const candidatos = candidatosDoHost(cwd);
    if (candidatos.length === 1) return { raiz: candidatos[0].raiz, origem: 'unico-conhecido', pedido: null };
    if (candidatos.length > 1) {
      throw new ErroDeProjeto('projeto.escolha',
        `${candidatos.length} projetos conhecidos nesta máquina e nenhum foi pedido; o ork não escolhe pelo diretório do gateway`,
        candidatos.map((c) => c.candidato), 'Repita com o projeto pedido: parâmetro `projeto` da tool, ou `--projeto <nome>`.');
    }
    throw new ErroDeProjeto('projeto.nenhum', 'nenhum projeto conhecido nesta máquina e nenhum foi pedido', [],
      'Registre o projeto com `ork projetos registrar <caminho>` (ou `ork init` na raiz dele) e repita com o nome.');
  }
  return null;
}

// ---------------------------------------------------------------------------
// O alvo do processo.
// ---------------------------------------------------------------------------

let alvoDoProcesso: ProjetoAlvo | null = null;

/** Fixa o alvo do processo: as raizes padrao do manifesto passam a partir dele (`diretorioDoProjeto`). */
export function fixarProjetoAlvo(alvo: ProjetoAlvo | null): void {
  alvoDoProcesso = alvo;
  fixarDiretorioDoProjeto(alvo?.raiz ?? null);
}

export function projetoAlvoAtual(): ProjetoAlvo | null {
  return alvoDoProcesso;
}

// ---------------------------------------------------------------------------
// O cabecalho da consulta.
// ---------------------------------------------------------------------------

export interface ConsultaDoProjeto {
  contrato: typeof CONTRATO_CONSULTA;
  projeto: { nome: string; abbrev: string; raiz: string; remoto: string | null; origem: OrigemDoProjeto };
  /** O que esta resposta leu. */
  lido: string[];
  /** O que esta resposta NAO leu: a lacuna declarada nunca vira "vazio". */
  naoLido: string[];
}

/** D8: `~` no lugar da pasta da conta. O texto vai a canais de conversa. */
export function raizParaExibir(raiz: string): string {
  const home = os.homedir();
  if (raiz === home) return '~';
  return raiz.startsWith(home + path.sep) ? `~${path.sep}${raiz.slice(home.length + 1)}` : raiz;
}

/** Quantos OUTROS projetos presentes o registro desta maquina conhece. */
export function outrosProjetosConhecidos(raiz: string): number {
  let canonica: string;
  try { canonica = raizCanonica(raiz); } catch { canonica = path.resolve(raiz); }
  return listarProjetos().filter((p) => p.presente && p.raiz !== canonica).length;
}

/** As fontes que uma leitura pode deixar de fora, na mesma frase em todo comando e canal. */
export const FORA_DA_CONSULTA = Object.freeze({
  roadmap: 'roadmap (ork roadmap status)',
  reservas: 'reservas do roadmap (ork roadmap reservas)',
  outrasMaquinas: 'outras máquinas (ork fabrica)',
  threadsDaMaquina: 'threads deste projeto nesta máquina',
});

/** A lacuna de quem nao tem o remoto: nada foi lido de la, e isso nao e "nenhuma publicou". */
export function semRemoto(remoto: string): string {
  return `outras máquinas: o projeto não tem o remoto ${remoto}, nada foi lido de ork/fabrica-estado`;
}

export const ORIGENS_DO_PROJETO: Readonly<Record<OrigemDoProjeto, string>> = Object.freeze({
  opcao: 'pela opção --projeto',
  ambiente: 'por ORK_PROJETO',
  'unico-conhecido': 'único projeto conhecido nesta máquina',
  cwd: 'pelo diretório atual',
  instalacao: 'fixado na instalação do servidor MCP',
});

/**
 * Monta o cabecalho. `origem` explicita vence; sem ela, vale o alvo do processo quando ele e este
 * projeto, e o cwd quando nao. `outrosProjetos: false` omite a contagem (o MCP e fixado num projeto
 * e nao revela os demais).
 */
export function consultaDoProjeto(carregado: ManifestoCarregado,
    opcoes: { lido: string[]; naoLido: string[]; origem?: OrigemDoProjeto; outrosProjetos?: boolean;
      /** A URL ja lida por quem chama (`remotoDoProjeto`), para nao consultar o git duas vezes. */
      remoto?: string | null }): ConsultaDoProjeto {
  const alvo = projetoAlvoAtual();
  const origem = opcoes.origem ?? (alvo && path.resolve(alvo.raiz) === path.resolve(carregado.raiz) ? alvo.origem : 'cwd');
  const outros = opcoes.outrosProjetos === false ? 0 : outrosProjetosConhecidos(carregado.raiz);
  const remoto = opcoes.remoto !== undefined ? opcoes.remoto
    : remotoDoProjeto(carregado.raiz, carregado.manifesto.fabrica?.remoto ?? 'origin');
  return {
    contrato: CONTRATO_CONSULTA,
    projeto: { nome: carregado.manifesto.project.name, abbrev: carregado.manifesto.project.abbrev,
      raiz: raizParaExibir(carregado.raiz), remoto, origem },
    lido: [...opcoes.lido],
    naoLido: [...opcoes.naoLido, ...(outros > 0 ? [`outros projetos desta máquina: ${outros} (ork projetos)`] : [])],
  };
}

/** As duas linhas do cabecalho em texto: o projeto consultado e o que nao foi lido. */
export function linhasDaConsulta(c: ConsultaDoProjeto): string[] {
  const p = c.projeto;
  return [
    `Projeto consultado: ${p.nome} (${p.abbrev || '-'}) · ${p.raiz} · ${p.remoto ?? 'sem remoto'} · ${ORIGENS_DO_PROJETO[p.origem]}`,
    `Não lido: ${c.naoLido.length ? c.naoLido.join(' · ') : 'nada fora do projeto consultado'}`,
  ];
}
