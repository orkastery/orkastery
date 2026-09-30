/**
 * RM-053: a Orkastery Network, as maquinas de uma pessoa em rede (lado da escrita).
 *
 * D1 (ADR-001): a rede mora num repositorio PRIVADO da pessoa na forja, `<usuario>/orkastery-network`,
 * branch `main`, um `maquinas/<maquina>.json` por maquina (`ork.rede-maquina/v1`) e o `REDE.md`.
 * A gravacao e a da RM-047 (`branch-de-estado`): indice temporario, commit sobre a ponta lida, push
 * sem forca e releitura quando recusado, num cache bare em `~/.orkastery/rede/`, fora de qualquer
 * clone de projeto.
 *
 * D3: publicar exige o repositorio privado, conferido na forja antes de cada publicacao.
 * D5: o retrato e uma LISTA DE PERMISSAO (maquina, hostname, forjas, runtimes, hosts, projetos,
 * versao do `ork`, batida) e passa por uma varredura de segredo antes do push: um achado recusa a
 * publicacao inteira, e o erro diz o padrao e o campo, nunca o valor.
 * D6: cada maquina so escreve o proprio retrato; o `REDE.md` e indice derivado que quem publica
 * regenera. A forja nao distingue maquinas da mesma pessoa, entao a garantia e daqui e a auditoria
 * e do git.
 * D9: retrato igual so volta ao remoto de hora em hora (a batida); a leitura fica em `rede-status`.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buscarBranch, exigirGit, git, gravarNaBranch, MudancaNaBranch } from './branch-de-estado';
import { formatarDataHora, legendaDoFuso } from './horario';
import { Host, HOSTS, lerRecibo, ORDEM_DOS_HOSTS } from './hosts';
import { gravarConfigDaMaquina, nomeDaMaquina } from './maquina';
import { adquirirLockMonitor } from './monitor-lock';
import { procurarSegredos } from './policies';
import { Adesao, adesaoDaRede, ConfigDaRede, gravarConfigDaRede, lerConfigDaRede, pastaDaRede, publicacaoDesligada,
  REPOSITORIO_PADRAO, tomarVezDePublicar } from './rede-adesao';
import { AmbienteDaMaquina, acharBinario, comGitIsolado, Forja, forjaPorNome, forjasDaMaquina, IdentidadeDoGit, IdentidadeNaForja, NomeDaForja,
  versaoDoBinario } from './rede-forja';
import { projetosConhecidos } from './rede-projetos';
import { VERSAO_DO_ORK } from './versao';

export const CONTRATO_DO_RETRATO = 'ork.rede-maquina/v1' as const;
export const BRANCH_DA_REDE = 'main';
export const DIR_DOS_RETRATOS = 'maquinas';
export const PAINEL_DA_REDE = 'REDE.md';
/** D9: retrato igual so volta ao remoto depois disto; e o sinal de vida da maquina. */
export const PULSACAO_DA_REDE_MS = 60 * 60 * 1000;
const PREFIXO = 'rede';
const TENTATIVAS = 5;
const DESCRICAO = 'Orkastery Network: o retrato de cada maquina desta pessoa (RM-053). Gerado pelo ork; nao edite a mao.';

export interface ForjaNoRetrato { forja: NomeDaForja; host: string; cli: string; versao: string | null; usuario: string | null }
export interface RuntimeNoRetrato { runtime: string; binario: string; versao: string | null }
export interface HostNoRetrato { host: Host; versao: string | null; adaptador: string | null }
export interface ProjetoNoRetrato { nome: string; remoto: string | null; caminho: string }

export interface RetratoDaMaquina {
  contrato: typeof CONTRATO_DO_RETRATO;
  maquina: string;
  hostname: string;
  adesao: Adesao;
  forjas: ForjaNoRetrato[];
  runtimes: RuntimeNoRetrato[];
  hosts: HostNoRetrato[];
  projetos: ProjetoNoRetrato[];
  versaoOrk: string;
  /** A ultima batida que chegou ao remoto. */
  publicadoEm: string;
}

export interface CasaDaRede {
  forja: NomeDaForja;
  host: string;
  dono: string;
  repositorio: string;
  /** De onde veio: a adesao gravada, a opcao do comando ou o login da forja. */
  origem: 'rede.json' | 'opcao' | 'forja';
}

/** Os runtimes que o `ork` despacha, pelo binario que cada um usa. */
const RUNTIMES_DA_REDE: ReadonlyArray<readonly [string, string]> = [['claude-bg', 'claude'], ['codex', 'codex']];
/** O binario de cada host de conducao. */
const BINARIO_DO_HOST: Readonly<Record<Host, string>> = { 'claude-code': 'claude', codex: 'codex', hermes: 'hermes', openclaw: 'openclaw' };
const VERSAO_ESTRITA = /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]{1,20})?$/;

export const refDaCasa = (c: Pick<CasaDaRede, 'host' | 'dono' | 'repositorio'>): string => `${c.host}/${c.dono}/${c.repositorio}`;

/** O nome da maquina no que vai a forja: so o que o git e a forja aceitam sem surpresa. */
function nomeSeguro(maquina: string): string {
  const nome = maquina.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 64);
  if (!nome) throw new Error(`rede.maquina: nome de maquina invalido ("${maquina}"); use ork network entrar --maquina NOME`);
  return nome;
}

/** O arquivo do retrato da maquina na casa. */
export function arquivoDoRetrato(maquina: string): string {
  return `${DIR_DOS_RETRATOS}/${nomeSeguro(maquina)}.json`;
}

// ---------------------------------------------------------------------------
// A casa da rede.
// ---------------------------------------------------------------------------

export interface OpcoesDaCasa {
  amb?: AmbienteDaMaquina;
  /** `--forja`: troca a forja da casa. */
  forja?: NomeDaForja;
  /** `--repositorio dono/nome` ou so `nome`. */
  repositorio?: string;
  /** As identidades ja lidas (evita chamar `gh api user` duas vezes). */
  identidades?: IdentidadeNaForja[];
}

export interface CasaResolvida {
  casa: CasaDaRede | null;
  forja: Forja | null;
  identidades: IdentidadeNaForja[];
  /** Por que nao ha casa: `forja.ausente` ou `forja.sem-login`. */
  motivo: { tipo: 'forja.ausente' | 'forja.sem-login'; detalhe: string } | null;
}

/**
 * A casa: a opcao do comando, senao a adesao gravada, senao o login da primeira forja com login.
 * Nunca lanca: sem forja ou sem login, devolve o motivo tipado.
 */
export function resolverCasa(opcoes: OpcoesDaCasa = {}): CasaResolvida {
  const amb = opcoes.amb ?? {};
  const forjas = forjasDaMaquina(amb);
  const identidades = opcoes.identidades ?? forjas.map((f) => f.identidade());
  const config = lerConfigDaRede();
  const [donoPedido, nomePedido] = opcoes.repositorio?.includes('/') ? opcoes.repositorio.split('/', 2) : [null, opcoes.repositorio ?? null];
  // B3: `--repositorio` sozinho troca so o repositorio; a forja gravada continua valendo.
  const nomeDaForja: NomeDaForja | null = opcoes.forja ?? config?.forja ?? null;
  if (!opcoes.forja && !opcoes.repositorio && config?.forja && config.dono && config.repositorio && config.host) {
    // B9: a forja da casa e a do host gravado (GitLab proprio), nao a do ambiente de quem chamou.
    const forja = forjaPorNome(config.forja, amb, config.host);
    return { casa: { forja: config.forja, host: config.host, dono: config.dono, repositorio: config.repositorio, origem: 'rede.json' },
      forja, identidades, motivo: forja ? null : { tipo: 'forja.ausente', detalhe: `a CLI da forja ${config.forja} nao esta nesta maquina` } };
  }
  // A forja gravada vale com o host gravado (GitLab proprio), mesmo quando so o repositorio muda.
  const daCasaGravada = nomeDaForja && config?.forja === nomeDaForja && config.host ? forjaPorNome(nomeDaForja, amb, config.host) : null;
  const candidatas = daCasaGravada ? [daCasaGravada] : nomeDaForja ? forjas.filter((f) => f.nome === nomeDaForja) : forjas;
  if (candidatas.length === 0) {
    return { casa: null, forja: null, identidades, motivo: { tipo: 'forja.ausente',
      detalhe: nomeDaForja ? `a CLI da forja ${nomeDaForja} nao esta nesta maquina` : 'nenhuma CLI de forja (gh ou glab) nesta maquina' } };
  }
  for (const forja of candidatas) {
    const lida = identidades.find((i) => i.forja === forja.nome && i.host === forja.host);
    const usuario = (lida ?? forja.identidade()).usuario;
    if (!usuario) continue;
    const origem = opcoes.forja || opcoes.repositorio ? 'opcao' : 'forja';
    return { casa: { forja: forja.nome, host: forja.host, dono: donoPedido ?? usuario, repositorio: nomePedido ?? REPOSITORIO_PADRAO, origem },
      forja, identidades, motivo: null };
  }
  return { casa: null, forja: null, identidades, motivo: { tipo: 'forja.sem-login',
    detalhe: `${candidatas.map((f) => f.cli).join(' e ')} sem login nesta maquina (${candidatas.map((f) => `${f.cli} auth login`).join(' ou ')})` } };
}

// ---------------------------------------------------------------------------
// O retrato.
// ---------------------------------------------------------------------------

export interface OpcoesDoRetrato {
  amb?: AmbienteDaMaquina;
  maquina?: string;
  /** O diretorio de onde o `ork` foi chamado (o projeto dele entra na lista). */
  diretorio?: string | null;
  agora?: string;
  identidades?: IdentidadeNaForja[];
  /** Os projetos do ultimo retrato desta maquina (a reserva da D7). */
  anteriores?: readonly ProjetoNoRetrato[];
  /** O registro da RM-052; sem nada, `~/.orkastery/projetos.json`. */
  arquivoDeProjetos?: string;
  adesao?: Adesao;
}

function versaoDoAdaptador(host: Host, home: string): string | null {
  const recibo = lerRecibo(path.join(home, HOSTS[host].destinoPadrao, HOSTS[host].subdir));
  return typeof recibo?.versao === 'string' && VERSAO_ESTRITA.test(recibo.versao) ? recibo.versao : null;
}

function hostnameSeguro(): string {
  const bruto = os.hostname().trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(bruto) ? bruto : bruto.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 253) || 'desconhecido';
}

/** O retrato desta maquina, montado so com os campos da lista de permissao (D5). */
export function retratoDaMaquina(opcoes: OpcoesDoRetrato = {}): RetratoDaMaquina {
  const amb = opcoes.amb ?? {};
  const home = amb.home ?? os.homedir();
  const identidades = opcoes.identidades ?? forjasDaMaquina(amb).map((f) => f.identidade());
  const versoes = new Map<string, { binario: string; versao: string | null } | null>();
  const binario = (nome: string) => {
    if (!versoes.has(nome)) {
      const achado = acharBinario(nome, amb);
      versoes.set(nome, achado ? { binario: nome, versao: versaoDoBinario(achado, amb) } : null);
    }
    return versoes.get(nome) ?? null;
  };
  const runtimes = RUNTIMES_DA_REDE.flatMap(([runtime, nome]) => {
    const b = binario(nome);
    return b ? [{ runtime, binario: nome, versao: b.versao }] : [];
  });
  const hosts = ORDEM_DOS_HOSTS.flatMap((host) => {
    const b = binario(BINARIO_DO_HOST[host]);
    return b ? [{ host, versao: b.versao, adaptador: versaoDoAdaptador(host, home) }] : [];
  });
  const { projetos } = projetosConhecidos({ arquivo: opcoes.arquivoDeProjetos, diretorio: opcoes.diretorio, anteriores: opcoes.anteriores });
  return {
    contrato: CONTRATO_DO_RETRATO,
    maquina: nomeDaMaquina(opcoes.maquina),
    hostname: hostnameSeguro(),
    adesao: opcoes.adesao ?? adesaoDaRede().adesao ?? 'rede',
    forjas: identidades.map((i) => ({ forja: i.forja, host: i.host, cli: i.cli, versao: i.versao, usuario: i.usuario })),
    runtimes,
    hosts,
    projetos: projetos.filter((p) => p.presente).map((p) => ({ nome: p.nome, remoto: p.remoto, caminho: p.caminho })),
    versaoOrk: VERSAO_DO_ORK,
    publicadoEm: opcoes.agora ?? new Date().toISOString(),
  };
}

/** O que muda o retrato (sem o carimbo de hora): retrato igual nao precisa de push. */
export function assinaturaDoRetrato(r: RetratoDaMaquina): string {
  const { publicadoEm: _publicadoEm, ...resto } = r;
  return createHash('sha256').update(JSON.stringify(resto)).digest('hex');
}

// ---------------------------------------------------------------------------
// As guardas (D5 e D6).
// ---------------------------------------------------------------------------

/** Alem do catalogo do nucleo (`procurarSegredos`): o que a rede nunca deixa sair. */
const PADROES_DA_REDE: ReadonlyArray<{ nome: string; regex: RegExp }> = [
  { nome: 'token do GitHub', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { nome: 'token do GitLab', regex: /\bgl(?:pat|dt|oas|rt|cbt|ptt|ft|imt|agent|soat)-[A-Za-z0-9_-]{16,}/ },
  { nome: 'token do Slack', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { nome: 'token JWT', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { nome: 'credencial em URL', regex: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@"]+:[^/\s@"]+@/i },
  { nome: 'arquivo de credencial', regex: /(?:\.credentials\.json|auth\.json|hosts\.ya?ml|\.git-credentials|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|ed25519|ecdsa)\b|[/\\]\.ssh[/\\]|\.config[/\\](?:gh|glab-cli)\b)/i },
  { nome: 'e-mail de conta', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b(?!:)/ },
];

const CAMPOS: Record<string, readonly string[]> = {
  retrato: ['contrato', 'maquina', 'hostname', 'adesao', 'forjas', 'runtimes', 'hosts', 'projetos', 'versaoOrk', 'publicadoEm'],
  forjas: ['forja', 'host', 'cli', 'versao', 'usuario'],
  runtimes: ['runtime', 'binario', 'versao'],
  hosts: ['host', 'versao', 'adaptador'],
  projetos: ['nome', 'remoto', 'caminho'],
};

function exigirSoCampos(onde: string, v: unknown, permitidos: readonly string[]): void {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`rede.segredo: ${onde} fora do contrato; nada foi publicado`);
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!permitidos.includes(k)) throw new Error(`rede.segredo: campo "${onde}.${k}" fora da lista de permissao; nada foi publicado`);
    if (x !== null && typeof x === 'string' && x.length > 1024) throw new Error(`rede.segredo: campo "${onde}.${k}" longo demais; nada foi publicado`);
  }
}

/**
 * D5: o retrato so tem os campos da lista de permissao, e nenhum valor com cara de segredo. O erro
 * diz o padrao e o campo, nunca o valor: relatorio que imprime o segredo vaza de novo.
 */
export function exigirRetratoSeguro(r: RetratoDaMaquina): void {
  exigirSoCampos('retrato', r, CAMPOS.retrato);
  for (const lista of ['forjas', 'runtimes', 'hosts', 'projetos'] as const) {
    if (!Array.isArray(r[lista])) throw new Error(`rede.segredo: ${lista} fora do contrato; nada foi publicado`);
    r[lista].forEach((item, i) => exigirSoCampos(`${lista}[${i}]`, item, CAMPOS[lista]));
  }
  const visitar = (v: unknown, onde: string): void => {
    if (typeof v === 'string') {
      const achado = procurarSegredos(v)[0]?.nome ?? PADROES_DA_REDE.find((p) => p.regex.test(v))?.nome;
      if (achado) throw new Error(`rede.segredo: padrao "${achado}" em ${onde}; nada foi publicado (valor omitido de proposito)`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visitar(x, `${onde}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visitar(x, onde ? `${onde}.${k}` : k);
  };
  visitar(r, '');
}

/** D6: uma publicacao desta maquina so toca o proprio retrato e o indice. */
export function exigirSoOProprioRetrato(maquina: string, mudancas: readonly MudancaNaBranch[]): void {
  const proprio = arquivoDoRetrato(maquina);
  for (const m of mudancas) {
    if (m.caminho !== proprio && m.caminho !== PAINEL_DA_REDE) {
      throw new Error(`rede.retrato-alheio: ${maquina} tentou gravar ${m.caminho}; cada maquina so escreve ${proprio}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Os retratos da casa.
// ---------------------------------------------------------------------------

export interface RetratoInvalido { arquivo: string; motivo: string }

function retratoValido(v: unknown): v is RetratoDaMaquina {
  const r = v as RetratoDaMaquina;
  return !!r && r.contrato === CONTRATO_DO_RETRATO && typeof r.maquina === 'string' && !!r.maquina.trim() &&
    typeof r.publicadoEm === 'string' && Number.isFinite(Date.parse(r.publicadoEm)) &&
    (['forjas', 'runtimes', 'hosts', 'projetos'] as const).every((k) => Array.isArray(r[k]));
}

/**
 * Os retratos de uma ponta, cada um conferido: contrato, forma e o NOME do arquivo igual ao da
 * maquina que o retrato diz ser. Arquivo ruim vira `invalidos`, nunca derruba a leitura.
 */
export function retratosDaPonta(cache: string, ponta: string | null): { retratos: RetratoDaMaquina[]; invalidos: RetratoInvalido[] } {
  return comGitIsolado(() => lerRetratos(cache, ponta));
}

function lerRetratos(cache: string, ponta: string | null): { retratos: RetratoDaMaquina[]; invalidos: RetratoInvalido[] } {
  if (!ponta) return { retratos: [], invalidos: [] };
  const arquivos = exigirGit(cache, ['ls-tree', '-r', '--name-only', ponta, '--', `${DIR_DOS_RETRATOS}/`], PREFIXO)
    .split('\n').filter((n) => n.endsWith('.json'));
  const retratos: RetratoDaMaquina[] = [], invalidos: RetratoInvalido[] = [];
  for (const arquivo of arquivos) {
    let bruto: unknown;
    try { bruto = JSON.parse(exigirGit(cache, ['show', `${ponta}:${arquivo}`], PREFIXO)); }
    catch { invalidos.push({ arquivo, motivo: 'JSON ilegivel' }); continue; }
    if (!retratoValido(bruto)) { invalidos.push({ arquivo, motivo: `fora do contrato ${CONTRATO_DO_RETRATO}` }); continue; }
    let esperado: string | null = null;
    try { esperado = arquivoDoRetrato(bruto.maquina); } catch { /* nome impossivel */ }
    if (esperado !== arquivo) { invalidos.push({ arquivo, motivo: `diz ser a maquina "${bruto.maquina}", que nao e a dona deste arquivo` }); continue; }
    retratos.push(bruto);
  }
  retratos.sort((a, b) => a.maquina.localeCompare(b.maquina));
  return { retratos, invalidos };
}

// ---------------------------------------------------------------------------
// O cache bare e o git sem prompt.
// ---------------------------------------------------------------------------

export function dirDoCache(casa: Pick<CasaDaRede, 'forja' | 'host' | 'dono' | 'repositorio'>): string {
  return path.join(pastaDaRede(), `${casa.forja}-${casa.host}-${casa.dono}-${casa.repositorio}`.replace(/[^A-Za-z0-9._-]+/g, '-'));
}

/** O cache ja foi criado? */
export const cachePronto = (dir: string): boolean => fs.existsSync(path.join(dir, '.git', 'HEAD'));

/**
 * O cache da casa: um repositorio com arvore de trabalho VAZIA (nunca ha checkout), porque a
 * remocao de arquivo do `gravarNaBranch` (`update-index --force-remove`) exige arvore de trabalho,
 * como nos clones em que a fabrica roda. Remoto `origin` na URL que a forja devolveu; autor = esta
 * maquina; sem hook nem assinatura (roda em segundo plano); e, para HTTPS, o helper de credencial da
 * propria forja so aqui dentro (D4): o primeiro valor vazio zera os helpers da configuracao global.
 */
export function prepararCache(casa: CasaDaRede, url: string, helper: string | null, maquina: string): string {
  return comGitIsolado(() => configurarCache(casa, url, helper, maquina));
}

function configurarCache(casa: CasaDaRede, url: string, helper: string | null, maquina: string): string {
  const dir = dirDoCache(casa);
  if (!cachePronto(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    exigirGit(dir, ['init', '--quiet'], PREFIXO);
  }
  const semHooks = path.join(dir, '.git', 'sem-hooks');
  fs.mkdirSync(semHooks, { recursive: true });
  const config = (chave: string, valor: string) => exigirGit(dir, ['config', chave, valor], PREFIXO);
  config('remote.origin.url', url);
  config('core.hooksPath', semHooks);
  config('commit.gpgsign', 'false');
  config('user.name', maquina);
  config('user.email', `${nomeSeguro(maquina)}@rede.orkastery.invalid`);
  if (helper && /^https?:\/\//i.test(url)) {
    const chave = `credential.${new URL(url).origin}.helper`;
    git(dir, ['config', '--unset-all', chave]);
    exigirGit(dir, ['config', '--add', chave, ''], PREFIXO);
    exigirGit(dir, ['config', '--add', chave, helper], PREFIXO);
  }
  return dir;
}

/** O autor dos commits da casa: a maquina, com e-mail que nao existe (B8). */
export function identidadeDoGit(maquina: string): IdentidadeDoGit {
  return { nome: nomeSeguro(maquina), email: `${nomeSeguro(maquina)}@rede.orkastery.invalid` };
}

// ---------------------------------------------------------------------------
// Publicar, entrar e sair.
// ---------------------------------------------------------------------------

/** A ultima publicacao desta maquina: assinatura, casa (ref e forja) e os projetos, que viram a reserva da D7. */
export interface MarcaDaRede { assinatura: string; em: string; commit: string; casa: string; forja: NomeDaForja; maquina: string; projetos: ProjetoNoRetrato[] }
const arquivoDaMarca = () => path.join(pastaDaRede(), 'publicada.json');

export function lerMarcaDaRede(): MarcaDaRede | null {
  try { return JSON.parse(fs.readFileSync(arquivoDaMarca(), 'utf8')) as MarcaDaRede; } catch { return null; }
}

function gravarMarca(marca: MarcaDaRede): void {
  fs.mkdirSync(pastaDaRede(), { recursive: true });
  fs.writeFileSync(arquivoDaMarca(), JSON.stringify(marca, null, 2) + '\n', { mode: 0o600 });
}

export interface OpcoesDaPublicacao extends OpcoesDaCasa {
  maquina?: string;
  diretorio?: string | null;
  agora?: string;
  forcar?: boolean;
  arquivoDeProjetos?: string;
}

export interface ResultadoDaRede {
  /** `ocupado`: outra publicacao desta maquina estava em andamento; a proxima batida pega o estado novo. */
  acao: 'publicou' | 'sem-mudanca' | 'ocupado';
  maquina: string;
  casa: string;
  commit: string | null;
  tentativas: number;
}

/** A casa com o repositorio conferido: existe e e privado (D3). `criar` so no `ork network entrar`. */
function casaConferida(opcoes: OpcoesDaCasa & { criar?: boolean }): { casa: CasaDaRede; forja: Forja; url: string; criado: boolean; identidades: IdentidadeNaForja[] } {
  const r = resolverCasa(opcoes);
  if (!r.casa || !r.forja) throw new Error(`rede.sem-forja: ${r.motivo?.detalhe ?? 'nenhuma forja utilizavel'}`);
  let repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
  let criado = false;
  if (!repo.existe) {
    if (!opcoes.criar) throw new Error(`rede.sem-repositorio: ${refDaCasa(r.casa)} ainda nao existe; ork network entrar o cria, privado`);
    const login = r.identidades.find((i) => i.forja === r.forja!.nome)?.usuario;
    if (r.casa.dono !== login) {
      throw new Error(`rede.repositorio-alheio: ${refDaCasa(r.casa)} nao existe e nao e do login ${login}; crie o repositorio privado na forja e rode de novo`);
    }
    repo = r.forja.criarPrivado(r.casa.repositorio, DESCRICAO);
    criado = true;
  }
  if (repo.privado !== true) throw new Error(`rede.repositorio-publico: ${refDaCasa(r.casa)} nao e privado; nada foi publicado`);
  if (!repo.url) throw new Error(`rede.forja: ${r.forja.cli} nao devolveu a URL de ${refDaCasa(r.casa)}`);
  return { casa: r.casa, forja: r.forja, url: repo.url, criado, identidades: r.identidades };
}

/**
 * `ork network publicar`: grava o retrato desta maquina na casa. So membro publica. Retrato igual ao
 * ultimo, dentro da batida, nem chama a forja; `forcar` publica mesmo assim.
 */
export function publicarRede(opcoes: OpcoesDaPublicacao & { criar?: boolean } = {}): ResultadoDaRede & { criado: boolean } {
  const adesao = adesaoDaRede();
  if (!adesao.membro) throw new Error('rede.fora: esta maquina nao esta na rede; ork network entrar');
  const amb = opcoes.amb ?? {};
  const identidades = opcoes.identidades ?? forjasDaMaquina(amb).map((f) => f.identidade());
  const casaPrevia = resolverCasa({ ...opcoes, identidades });
  if (!casaPrevia.casa) throw new Error(`rede.sem-forja: ${casaPrevia.motivo?.detalhe ?? 'nenhuma forja utilizavel'}`);
  const maquina = nomeDaMaquina(opcoes.maquina);
  const marca = lerMarcaDaRede();
  const mesmaCasa = marca?.casa === refDaCasa(casaPrevia.casa) && marca?.maquina === maquina;
  const retrato = retratoDaMaquina({ amb, maquina, diretorio: opcoes.diretorio, agora: opcoes.agora, identidades,
    anteriores: mesmaCasa ? marca?.projetos : undefined, arquivoDeProjetos: opcoes.arquivoDeProjetos, adesao: adesao.adesao ?? 'rede' });
  exigirRetratoSeguro(retrato);
  const assinatura = assinaturaDoRetrato(retrato);
  if (!opcoes.forcar && mesmaCasa && marca?.assinatura === assinatura &&
      Date.parse(retrato.publicadoEm) - Date.parse(marca.em) < PULSACAO_DA_REDE_MS) {
    return { acao: 'sem-mudanca', maquina, casa: marca.casa, commit: marca.commit, tentativas: 0, criado: false };
  }
  const { casa, forja, url, criado } = casaConferida({ ...opcoes, identidades });
  const cache = prepararCache(casa, url, forja.helperDeCredencial(), maquina);
  fs.mkdirSync(pastaDaRede(), { recursive: true });
  const trava = adquirirLockMonitor(path.join(pastaDaRede(), 'publicar.lock'));
  if (!trava.ok) return { acao: 'ocupado', maquina, casa: refDaCasa(casa), commit: null, tentativas: 0, criado };
  try {
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      const { ponta, atualizado } = comGitIsolado(() => buscarBranch(cache, 'origin', BRANCH_DA_REDE, PREFIXO, 30000));
      if (!atualizado) throw new Error(`rede.sem-leitura: nao consegui ler ${refDaCasa(casa)}; publicar exige rede`);
      const outros = retratosDaPonta(cache, ponta).retratos.filter((r) => r.maquina !== maquina);
      const mudancas: MudancaNaBranch[] = [
        { caminho: arquivoDoRetrato(maquina), conteudo: JSON.stringify(retrato, null, 2) + '\n' },
        { caminho: PAINEL_DA_REDE, conteudo: painelDaRede([...outros, retrato]) },
      ];
      exigirSoOProprioRetrato(maquina, mudancas);
      const commit = comGitIsolado(() => gravarNaBranch(cache, 'origin', BRANCH_DA_REDE, ponta, mudancas,
        `rede: ${maquina} publicou o retrato`, PREFIXO), identidadeDoGit(maquina));
      if (commit) {
        gravarMarca({ assinatura, em: retrato.publicadoEm, commit, casa: refDaCasa(casa), forja: casa.forja, maquina, projetos: retrato.projetos });
        return { acao: 'publicou', maquina, casa: refDaCasa(casa), commit, tentativas: tentativa, criado };
      }
    }
    throw new Error(`rede.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
  } finally { trava.liberar(); }
}

/**
 * D9: a batida do pulse (e o `ork network publicar --silencioso` dos eventos). So membro, so com a
 * publicacao ligada, no maximo uma tentativa a cada 15 minutos. `null` quando nao era a vez.
 */
export function publicarRedeNaBatida(opcoes: OpcoesDaPublicacao & { agoraMs?: number } = {}): ResultadoDaRede | null {
  if (publicacaoDesligada(opcoes.amb?.env ?? process.env) || !adesaoDaRede().membro) return null;
  if (!tomarVezDePublicar(opcoes.agoraMs)) return null;
  const { criado: _criado, ...r } = publicarRede({ ...opcoes, criar: false });
  return r;
}

export interface ResultadoDaEntrada {
  config: ConfigDaRede;
  casa: CasaDaRede;
  criado: boolean;
  publicacao: ResultadoDaRede;
}

/**
 * `ork network entrar`: nome da maquina (opcional), casa conferida (criada privada quando falta e
 * e do proprio login), adesao gravada e o primeiro retrato publicado.
 */
export function entrarNaRede(opcoes: OpcoesDaPublicacao = {}): ResultadoDaEntrada {
  if (opcoes.maquina) gravarConfigDaMaquina({ nome: opcoes.maquina });
  const amb = opcoes.amb ?? {};
  const identidades = opcoes.identidades ?? forjasDaMaquina(amb).map((f) => f.identidade());
  const { casa, criado } = casaConferida({ ...opcoes, identidades, criar: true });
  const config = gravarConfigDaRede({ membro: true, forja: casa.forja, host: casa.host, dono: casa.dono, repositorio: casa.repositorio });
  const { criado: _criado, ...publicacao } = publicarRede({ ...opcoes, identidades, forja: undefined, repositorio: undefined, forcar: true });
  return { config, casa: { ...casa, origem: 'rede.json' }, criado, publicacao };
}

/** `ork network sair`: a adesao vira `membro: false` e o retrato desta maquina sai da casa. */
export function sairDaRede(opcoes: OpcoesDaPublicacao = {}): { maquina: string; casa: string | null; commit: string | null } {
  const maquina = nomeDaMaquina(opcoes.maquina);
  const r = resolverCasa(opcoes);
  gravarConfigDaRede({ membro: false, ...(r.casa ? { forja: r.casa.forja, host: r.casa.host, dono: r.casa.dono, repositorio: r.casa.repositorio } : {}) });
  try { fs.rmSync(arquivoDaMarca(), { force: true }); } catch { /* marca local */ }
  if (!r.casa || !r.forja) return { maquina, casa: null, commit: null };
  const repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
  if (!repo.existe || !repo.url) return { maquina, casa: refDaCasa(r.casa), commit: null };
  const cache = prepararCache(r.casa, repo.url, r.forja.helperDeCredencial(), maquina);
  const proprio = arquivoDoRetrato(maquina);
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = comGitIsolado(() => buscarBranch(cache, 'origin', BRANCH_DA_REDE, PREFIXO, 30000));
    if (!atualizado) throw new Error(`rede.sem-leitura: saiu da rede aqui, mas nao consegui ler ${refDaCasa(r.casa)} para tirar o retrato; rode ork network sair de novo com rede`);
    const { retratos } = retratosDaPonta(cache, ponta);
    const temArquivo = !!ponta && comGitIsolado(() => git(cache, ['cat-file', '-e', `${ponta}:${proprio}`]).ok);
    if (!temArquivo) return { maquina, casa: refDaCasa(r.casa), commit: null };
    const mudancas: MudancaNaBranch[] = [
      { caminho: proprio, conteudo: null },
      { caminho: PAINEL_DA_REDE, conteudo: painelDaRede(retratos.filter((x) => x.maquina !== maquina)) },
    ];
    exigirSoOProprioRetrato(maquina, mudancas);
    const commit = comGitIsolado(() => gravarNaBranch(cache, 'origin', BRANCH_DA_REDE, ponta, mudancas, `rede: ${maquina} saiu`, PREFIXO),
      identidadeDoGit(maquina));
    if (commit) return { maquina, casa: refDaCasa(r.casa), commit };
  }
  throw new Error(`rede.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

// ---------------------------------------------------------------------------
// O REDE.md da casa.
// ---------------------------------------------------------------------------

const celula = (s: string) => s.replace(/\|/g, '/');

/** O `REDE.md`: a mesma rede, para quem abre a forja. Sem caminho local: esses ficam no JSON. */
export function painelDaRede(retratos: readonly RetratoDaMaquina[]): string {
  const linhas = [
    '# Orkastery Network',
    '',
    'As máquinas desta pessoa e o que cada uma tem. Gerado pelo `ork network publicar`; não edite à mão.',
    'De qualquer máquina: `ork network status`.',
    '',
    '| Máquina | Hostname | Forjas | Runtimes | Hosts | Projetos | ork | Última batida |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const lista = [...retratos].sort((a, b) => a.maquina.localeCompare(b.maquina));
  if (lista.length === 0) linhas.push('| — | nenhuma máquina publicou | — | — | — | — | — | — |');
  for (const r of lista) {
    const forjas = r.forjas.map((f) => `${f.forja}: ${f.usuario ?? 'sem login'}`).join(', ') || '—';
    const runtimes = r.runtimes.map((x) => `${x.runtime} ${x.versao ?? '?'}`).join(', ') || '—';
    const hosts = r.hosts.map((h) => `${h.host} ${h.versao ?? '?'}${h.adaptador ? ` (adaptador ${h.adaptador})` : ''}`).join(', ') || '—';
    const projetos = r.projetos.map((p) => p.nome).join(', ') || '—';
    linhas.push(`| ${[r.maquina, r.hostname, forjas, runtimes, hosts, projetos, r.versaoOrk, formatarDataHora(r.publicadoEm)].map(celula).join(' | ')} |`);
  }
  return [...linhas, '', legendaDoFuso(), ''].join('\n');
}
