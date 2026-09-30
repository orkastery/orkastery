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
import { gravarConfigDaMaquina, lerConfigDaMaquina, nomeDaMaquina } from './maquina';
import { adquirirLockMonitor } from './monitor-lock';
import { procurarSegredos } from './policies';
import { Adesao, adesaoDaRede, ConfigDaRede, ehIdDeMaquina, gravarConfigDaRede, idDaMaquina, lerConfigDaRede, pastaDaRede,
  publicacaoDesligada, REPOSITORIO_PADRAO, tomarVezDePublicar } from './rede-adesao';
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
  /** B7: identificador aleatorio da instalacao; opcional no v1 (retratos antigos nao tem). */
  id?: string;
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

/**
 * O nome da maquina no que vai a forja: so o que o git e a forja aceitam sem surpresa. E o mesmo no
 * arquivo, no campo `maquina` do retrato, na trava e nos commits (S2 da revisao 2: o leitor recusava o
 * retrato de nome longo ou com espaco que o escritor publicava).
 */
export function nomeSeguro(maquina: string): string {
  const nome = maquina.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 64);
  // U3 da revisao 3: nome so com caracteres fora do ASCII (`日本`) ou so com pontos nao lanca mais; vira
  // um nome estavel derivado dele, para o status e o sair continuarem funcionando.
  return nome || `maquina-${createHash('sha256').update(maquina.trim()).digest('hex').slice(0, 8)}`;
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
  /** A identidade desta instalacao (B7). */
  id?: string;
}

function versaoDoAdaptador(host: Host, home: string): string | null {
  const recibo = lerRecibo(path.join(home, HOSTS[host].destinoPadrao, HOSTS[host].subdir));
  return typeof recibo?.versao === 'string' && VERSAO_ESTRITA.test(recibo.versao) ? recibo.versao : null;
}

export function hostnameSeguro(): string {
  const bruto = os.hostname().trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(bruto) ? bruto : bruto.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 253) || 'desconhecido';
}

/** Um projeto que ficou fora do retrato: o campo e o padrao, nunca o valor. */
export interface Descarte { campo: string; padrao: string }

/** O retrato desta maquina, montado so com os campos da lista de permissao (D5). */
export function retratoDaMaquina(opcoes: OpcoesDoRetrato = {}): RetratoDaMaquina {
  return retratoComDescartes(opcoes).retrato;
}

/**
 * O retrato e os projetos que ficaram fora dele. Projeto vem de fora do nucleo (o registro da
 * RM-052, o cwd, o ultimo retrato): um valor dele com cara de segredo tira SO aquele projeto, com
 * aviso, em vez de travar a publicacao da maquina para sempre (A1 do CHECK 1). O que o nucleo monta
 * (maquina, hostname, forjas, runtimes, hosts) continua falhando fechado em `exigirRetratoSeguro`.
 */
export function retratoComDescartes(opcoes: OpcoesDoRetrato = {}): { retrato: RetratoDaMaquina; descartados: Descarte[] } {
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
  const descartados: Descarte[] = [];
  // S2 da revisao 2: so vai o que o leitor aceita. Remoto longo demais vira `null` (e informativo);
  // nome ou caminho fora do contrato tiram o projeto, com aviso; no maximo 200 projetos.
  const presentes = projetos.filter((p) => p.presente)
    .map((p) => ({ nome: p.nome, remoto: p.remoto !== null && p.remoto.length <= 500 ? p.remoto : null, caminho: p.caminho }));
  const limpos = presentes.filter((p, i) => {
    if (!p.nome.trim() || p.nome.length > 80 || p.caminho.length > 1024) {
      descartados.push({ campo: `projetos[${i}]`, padrao: 'fora do contrato ork.rede-maquina/v1' });
      return false;
    }
    for (const campo of ['nome', 'remoto', 'caminho'] as const) {
      const padrao = typeof p[campo] === 'string' ? achadoDeSegredo(p[campo] as string) : null;
      if (padrao) { descartados.push({ campo: `projetos[${i}].${campo}`, padrao }); return false; }
    }
    return true;
  });
  if (limpos.length > MAXIMO_DE_ITENS) {
    descartados.push({ campo: `projetos[${MAXIMO_DE_ITENS}..]`, padrao: `limite de ${MAXIMO_DE_ITENS} projetos` });
    limpos.length = MAXIMO_DE_ITENS;
  }
  const retrato: RetratoDaMaquina = {
    contrato: CONTRATO_DO_RETRATO,
    maquina: nomeSeguro(nomeDaMaquina(opcoes.maquina)),
    ...(opcoes.id ? { id: opcoes.id } : {}),
    hostname: hostnameSeguro(),
    adesao: opcoes.adesao ?? adesaoDaRede().adesao ?? 'rede',
    forjas: identidades.map((i) => ({ forja: i.forja, host: i.host, cli: i.cli, versao: i.versao, usuario: i.usuario })),
    runtimes,
    hosts,
    projetos: limpos,
    versaoOrk: VERSAO_DO_ORK,
    publicadoEm: opcoes.agora ?? new Date().toISOString(),
  };
  return { retrato, descartados };
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
  { nome: 'credencial em URL', regex: /[a-z][a-z0-9+.-]*:\/\/[^\s"]*?[^/\s:@"\\]+:[^/\s@"]*@/i },
  { nome: 'arquivo de credencial', regex: /(?:\.credentials\.json|auth\.json|hosts\.ya?ml|\.git-credentials|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|ed25519|ecdsa)\b|[/\\]\.ssh[/\\]|\.config[/\\](?:gh|glab-cli)\b)/i },
  { nome: 'e-mail de conta', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b(?!:)/ },
];

/** O nome do padrao de segredo que casa no texto, ou `null`: o catalogo do nucleo e o da rede. */
export function achadoDeSegredo(texto: string): string | null {
  return procurarSegredos(texto)[0]?.nome ?? PADROES_DA_REDE.find((p) => p.regex.test(texto))?.nome ?? null;
}

const CAMPOS: Record<string, readonly string[]> = {
  retrato: ['contrato', 'maquina', 'id', 'hostname', 'adesao', 'forjas', 'runtimes', 'hosts', 'projetos', 'versaoOrk', 'publicadoEm'],
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
  // S2 da revisao 2: o que o escritor publica, o leitor aceita; senao, ninguem ve esta maquina.
  if (!normalizarRetrato(r)) throw new Error('rede.contrato: o retrato desta maquina nao passa no contrato ork.rede-maquina/v1; nada foi publicado');
  const visitar = (v: unknown, onde: string): void => {
    if (typeof v === 'string') {
      const achado = achadoDeSegredo(v);
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

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ehTexto = (v: unknown, teto = 1024): v is string => typeof v === 'string' && v.length <= teto;
const ehTextoOuNulo = (v: unknown, teto = 1024): v is string | null => v === null || ehTexto(v, teto);

/** O teto de itens de cada lista do retrato, igual no escritor e no leitor. */
export const MAXIMO_DE_ITENS = 200;
const PULAR = Symbol('pular');

/**
 * Cada item de uma lista do retrato, campo a campo; so os campos do contrato saem. Item com valor de
 * enum que esta versao nao conhece (um host novo, outra forja) e PULADO: versao nova e compativel,
 * e a maquina que atualizou primeiro nao some para quem nao atualizou (S2 da revisao 2).
 */
function itens<T>(v: unknown, item: (x: Record<string, unknown>) => T | null | typeof PULAR): T[] | null {
  if (!Array.isArray(v) || v.length > MAXIMO_DE_ITENS) return null;
  const saida: T[] = [];
  for (const x of v) {
    const ok = ehObjeto(x) ? item(x) : null;
    if (ok === null) return null;
    if (ok !== PULAR) saida.push(ok);
  }
  return saida;
}

/**
 * O retrato lido da casa, conferido por inteiro (M1 do CHECK 1): cada campo do contrato com o tipo
 * certo, cada item de cada lista idem. Campo desconhecido e ignorado (versao nova e compativel);
 * campo do contrato ausente ou com outro tipo invalida o arquivo, que vira lacuna. Antes, um
 * `projetos: [null]` derrubava o status, o publicar e o sair de todas as maquinas.
 */
export function normalizarRetrato(bruto: unknown): RetratoDaMaquina | null {
  if (!ehObjeto(bruto) || bruto.contrato !== CONTRATO_DO_RETRATO) return null;
  const r = bruto;
  if (!ehTexto(r.maquina, 64) || !r.maquina.trim() || !ehTexto(r.hostname, 253) || !ehTexto(r.versaoOrk, 40)) return null;
  if (!ehTexto(r.publicadoEm, 40) || !Number.isFinite(Date.parse(r.publicadoEm))) return null;
  if (r.adesao !== 'rede' && r.adesao !== 'fabrica') return null;
  const forjas = itens(r.forjas, (x) => !(ehTexto(x.forja, 40) && ehTexto(x.host, 255) && ehTexto(x.cli, 16) &&
    ehTextoOuNulo(x.versao, 40) && ehTextoOuNulo(x.usuario, 255)) ? null
    : x.forja !== 'github' && x.forja !== 'gitlab' ? PULAR
      : { forja: x.forja as NomeDaForja, host: x.host as string, cli: x.cli as string, versao: x.versao as string | null, usuario: x.usuario as string | null });
  const runtimes = itens(r.runtimes, (x) => ehTexto(x.runtime, 40) && ehTexto(x.binario, 40) && ehTextoOuNulo(x.versao, 40)
    ? { runtime: x.runtime as string, binario: x.binario as string, versao: x.versao as string | null } : null);
  const hosts = itens(r.hosts, (x) => !(ehTexto(x.host, 40) && ehTextoOuNulo(x.versao, 40) && ehTextoOuNulo(x.adaptador, 40)) ? null
    : !(ORDEM_DOS_HOSTS as readonly unknown[]).includes(x.host) ? PULAR
      : { host: x.host as Host, versao: x.versao as string | null, adaptador: x.adaptador as string | null });
  const projetos = itens(r.projetos, (x) => ehTexto(x.nome, 80) && ehTextoOuNulo(x.remoto, 500) && ehTexto(x.caminho, 1024)
    ? { nome: x.nome as string, remoto: x.remoto as string | null, caminho: x.caminho as string } : null);
  if (!forjas || !runtimes || !hosts || !projetos) return null;
  if (r.id !== undefined && !ehIdDeMaquina(r.id)) return null;
  return { contrato: CONTRATO_DO_RETRATO, maquina: r.maquina, ...(r.id !== undefined ? { id: r.id } : {}), hostname: r.hostname,
    adesao: r.adesao, forjas, runtimes, hosts, projetos, versaoOrk: r.versaoOrk, publicadoEm: r.publicadoEm };
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
  // B12: `-z`, porque sem ele o git poe aspas em nome nao ASCII e o arquivo sumia calado.
  const arquivos = exigirGit(cache, ['ls-tree', '-r', '-z', '--name-only', ponta, '--', `${DIR_DOS_RETRATOS}/`], PREFIXO)
    .split('\0').filter(Boolean);
  const retratos: RetratoDaMaquina[] = [], invalidos: RetratoInvalido[] = [];
  for (const arquivo of arquivos) {
    const visivel = JSON.stringify(arquivo).slice(1, -1).slice(0, 120);
    if (!/^maquinas\/[A-Za-z0-9._-]{1,64}\.json$/.test(arquivo)) {
      invalidos.push({ arquivo: visivel, motivo: 'nome de arquivo fora do padrao maquinas/<maquina>.json' });
      continue;
    }
    let bruto: unknown;
    try { bruto = JSON.parse(exigirGit(cache, ['show', `${ponta}:${arquivo}`], PREFIXO)); }
    catch { invalidos.push({ arquivo, motivo: 'JSON ilegivel' }); continue; }
    const retrato = normalizarRetrato(bruto);
    if (!retrato) { invalidos.push({ arquivo, motivo: `fora do contrato ${CONTRATO_DO_RETRATO}` }); continue; }
    let esperado: string | null = null;
    try { esperado = arquivoDoRetrato(retrato.maquina); } catch { /* nome impossivel */ }
    if (esperado !== arquivo) { invalidos.push({ arquivo, motivo: `diz ser a maquina "${retrato.maquina}", que nao e a dona deste arquivo` }); continue; }
    retratos.push(retrato);
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
  // B6: so grava o que mudou; leitura e publicacao simultaneas nao disputam a config a cada chamada.
  // So a config LOCAL do cache conta: a global da pessoa (o `gh auth setup-git`, por exemplo) fica como esta.
  const config = (chave: string, valor: string) => {
    if (git(dir, ['config', '--local', '--get', chave]).stdout.replace(/\n$/, '') !== valor) exigirGit(dir, ['config', '--local', chave, valor], PREFIXO);
  };
  config('remote.origin.url', url);
  config('core.hooksPath', semHooks);
  config('commit.gpgsign', 'false');
  config('user.name', identidadeDoGit(maquina).nome);
  config('user.email', identidadeDoGit(maquina).email);
  if (helper && /^https?:\/\//i.test(url)) {
    const chave = `credential.${new URL(url).origin}.helper`;
    if (git(dir, ['config', '--local', '--get-all', chave]).stdout !== `\n${helper}\n`) {
      git(dir, ['config', '--local', '--unset-all', chave]);
      exigirGit(dir, ['config', '--local', '--add', chave, ''], PREFIXO);
      exigirGit(dir, ['config', '--local', '--add', chave, helper], PREFIXO);
    }
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

/**
 * A ultima publicacao desta maquina: assinatura, casa (ref e forja), os projetos (a reserva da D7) e
 * as forjas lidas, que deixam o atalho "sem mudanca" decidir sem chamar a forja (M4 do CHECK 1).
 */
export interface MarcaDaRede {
  assinatura: string; em: string; commit: string; casa: string; forja: NomeDaForja; maquina: string;
  projetos: ProjetoNoRetrato[]; forjas?: ForjaNoRetrato[];
}
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
  /** `ork network entrar --forcar`: toma o nome que outra instalacao usa (B7), com registro no commit. */
  tomarNome?: boolean;
}

export interface ResultadoDaRede {
  /** `ocupado`: outra publicacao desta maquina estava em andamento; a proxima batida pega o estado novo. */
  acao: 'publicou' | 'sem-mudanca' | 'ocupado';
  maquina: string;
  casa: string;
  commit: string | null;
  tentativas: number;
  /** Projetos que ficaram fora do retrato por ter valor com cara de segredo (campo e padrao, sem o valor). */
  descartados: Descarte[];
  /** S7 da revisao 2: esta publicacao tomou o nome de outra instalacao (`entrar --forcar`). */
  tomouNome?: true;
}

interface CasaConferida { casa: CasaDaRede; forja: Forja; url: string; criado: boolean; identidades: IdentidadeNaForja[] }

/** A casa com o repositorio conferido: existe e e privado (D3). `criar` so no `ork network entrar`. */
function casaConferida(opcoes: OpcoesDaCasa & { criar?: boolean }): CasaConferida {
  const r = resolverCasa(opcoes);
  if (!r.casa || !r.forja) throw new Error(`rede.sem-forja: ${r.motivo?.detalhe ?? 'nenhuma forja utilizavel'}`);
  let repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
  let criado = false;
  if (!repo.existe) {
    if (!opcoes.criar) throw new Error(`rede.sem-repositorio: ${refDaCasa(r.casa)} ainda nao existe; ork network entrar o cria, privado`);
    const login = (r.identidades.find((i) => i.forja === r.forja!.nome && i.host === r.forja!.host) ?? r.forja.identidade()).usuario;
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
 * S8 da revisao 2: no GitLab proprio, a forja do ambiente (sem `GITLAB_HOST` no cron) aponta para
 * gitlab.com; o retrato leva a identidade do HOST DA CASA, lida pela forja da casa.
 */
function identidadesComACasa(identidades: IdentidadeNaForja[], forja: Forja): IdentidadeNaForja[] {
  if (identidades.some((i) => i.forja === forja.nome && i.host === forja.host)) return identidades;
  const ordem = (i: IdentidadeNaForja) => (i.forja === 'github' ? 0 : 1);
  return [...identidades.filter((i) => i.forja !== forja.nome), forja.identidade()].sort((a, b) => ordem(a) - ordem(b));
}

const TRAVA = () => path.join(pastaDaRede(), 'publicar.lock');

/** Uma trava sem `pid` valido ha mais que isto e orfa: quem a criou caiu entre o `mkdir` e a gravacao do pid. */
const TRAVA_ORFA_MS = 5 * 60 * 1000;

/** U5 da revisao 3: sem `pid`, com `pid` vazio ou com lixo, e velha. A de `pid` valido fica com o monitor-lock (vivo ou morto). */
function travaOrfa(): boolean {
  try {
    if (Date.now() - fs.statSync(TRAVA()).mtimeMs <= TRAVA_ORFA_MS) return false;
    const pid = fs.existsSync(path.join(TRAVA(), 'pid')) ? Number(fs.readFileSync(path.join(TRAVA(), 'pid'), 'utf8')) : NaN;
    return !(Number.isInteger(pid) && pid > 0);
  } catch { return false; }
}

/**
 * A trava de escrita na casa desta maquina, esperando ate `esperaMs` quando outra escrita esta em
 * curso. S11 da revisao 2: a trava orfa (sem `pid`, velha) sai uma vez, em vez de devolver "ocupado"
 * para sempre; a com `pid` vivo nunca e tirada.
 */
function travarCasa(esperaMs: number): { ok: true; liberar: () => void } | { ok: false } {
  fs.mkdirSync(pastaDaRede(), { recursive: true });
  const limite = Date.now() + esperaMs;
  let tirouOrfa = false;
  for (;;) {
    const trava = adquirirLockMonitor(TRAVA());
    if (trava.ok) return trava;
    if (!trava.ativo && !tirouOrfa && travaOrfa()) {
      tirouOrfa = true;
      // Renomeia antes de apagar: so um processo consegue mover a mesma orfa, e o que perdeu a corrida
      // nao apaga a trava que o outro acabou de tomar.
      const lixo = `${TRAVA()}.orfa-${process.pid}-${Date.now()}`;
      try { fs.renameSync(TRAVA(), lixo); fs.rmSync(lixo, { recursive: true, force: true }); } catch { /* outro processo levou */ }
      continue;
    }
    if (Date.now() >= limite) return { ok: false };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

/**
 * U2 da revisao 3: o `id` gravado no arquivo com o nome desta maquina, mesmo quando esta versao nao le
 * o retrato (contrato mais novo, campo que ela nao conhece). `null` quando nao ha arquivo ou `id`.
 */
function idNoArquivo(cache: string, ponta: string | null, arquivo: string): string | null {
  if (!ponta) return null;
  const r = comGitIsolado(() => git(cache, ['show', `${ponta}:${arquivo}`]));
  if (!r.ok) return null;
  try { const id = (JSON.parse(r.stdout) as { id?: unknown }).id; return ehIdDeMaquina(id) ? id : null; } catch { return null; }
}

/**
 * Grava o retrato na casa, sob a trava desta maquina. B6: a adesao e reconferida DENTRO da trava
 * (um `sair` no meio nao ve o retrato reaparecer). B7: o arquivo com este nome que for de outra
 * instalacao (outro `id`) nao e regravado, salvo `tomarNome`.
 */
function gravarNaCasa(conferida: CasaConferida, retrato: RetratoDaMaquina, descartados: Descarte[],
  opcoes: { exigirAdesao: boolean; tomarNome?: boolean }): ResultadoDaRede {
  const { casa, forja, url } = conferida;
  const maquina = retrato.maquina;
  const trava = travarCasa(0);
  if (!trava.ok) return { acao: 'ocupado', maquina, casa: refDaCasa(casa), commit: null, tentativas: 0, descartados };
  try {
    if (opcoes.exigirAdesao && !adesaoDaRede().membro) throw new Error('rede.fora: esta maquina saiu da rede; nada foi publicado');
    const cache = prepararCache(casa, url, forja.helperDeCredencial(), maquina);
    const assinatura = assinaturaDoRetrato(retrato);
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      const { ponta, atualizado } = comGitIsolado(() => buscarBranch(cache, 'origin', BRANCH_DA_REDE, PREFIXO, 30000));
      if (!atualizado) throw new Error(`rede.sem-leitura: nao consegui ler ${refDaCasa(casa)}; publicar exige rede`);
      const { retratos } = retratosDaPonta(cache, ponta);
      const atual = retratos.find((r) => r.maquina === maquina);
      // U2: o arquivo que esta versao nao le ainda pode ser de outra instalacao (contrato mais novo).
      const idDoOutro = atual ? atual.id ?? null : idNoArquivo(cache, ponta, arquivoDoRetrato(maquina));
      const alheio = !!idDoOutro && idDoOutro !== retrato.id;
      if (alheio && !opcoes.tomarNome) {
        // U7 da revisao 3: o hostname igual sugere a propria maquina, mas duas VMs podem se chamar `ubuntu`.
        const dica = atual?.hostname === hostnameSeguro()
          ? '; o retrato tem o hostname desta maquina: se for ela mesma, com ~/.orkastery apagada ou copiada, retome o nome com ' +
            'ork network entrar --forcar; se for outra maquina ou instalacao com o mesmo hostname, escolha outro nome com --maquina NOME'
          : '; escolha outro nome com ork network entrar --maquina NOME, ou tome este com --forcar';
        const quem = atual ? ` (hostname ${atual.hostname}, batida ${formatarDataHora(atual.publicadoEm)})` : ' (num contrato que esta versao nao le)';
        throw new Error(`rede.nome-em-uso: outra instalacao ja publica como "${maquina}"${quem}${dica}`);
      }
      const mudancas: MudancaNaBranch[] = [
        { caminho: arquivoDoRetrato(maquina), conteudo: JSON.stringify(retrato, null, 2) + '\n' },
        { caminho: PAINEL_DA_REDE, conteudo: painelDaRede([...retratos.filter((r) => r.maquina !== maquina), retrato]) },
      ];
      exigirSoOProprioRetrato(maquina, mudancas);
      const mensagem = alheio ? `rede: ${maquina} publicou o retrato, tomando o nome de outra instalacao` : `rede: ${maquina} publicou o retrato`;
      const commit = comGitIsolado(() => gravarNaBranch(cache, 'origin', BRANCH_DA_REDE, ponta, mudancas, mensagem, PREFIXO),
        identidadeDoGit(maquina));
      if (commit) {
        gravarMarca({ assinatura, em: retrato.publicadoEm, commit, casa: refDaCasa(casa), forja: casa.forja, maquina,
          projetos: retrato.projetos, forjas: retrato.forjas });
        return { acao: 'publicou', maquina, casa: refDaCasa(casa), commit, tentativas: tentativa, descartados, ...(alheio ? { tomouNome: true as const } : {}) };
      }
    }
    throw new Error(`rede.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
  } finally { trava.liberar(); }
}

/**
 * `ork network publicar`: grava o retrato desta maquina na casa. So membro publica. M4 do CHECK 1:
 * retrato igual ao ultimo, dentro da batida, nao chama a forja nenhuma vez (as forjas vem da marca);
 * `forcar` publica mesmo assim.
 */
export function publicarRede(opcoes: OpcoesDaPublicacao = {}): ResultadoDaRede {
  const adesao = adesaoDaRede();
  if (!adesao.membro) throw new Error('rede.fora: esta maquina nao esta na rede; ork network entrar');
  const amb = opcoes.amb ?? {};
  const maquina = nomeSeguro(nomeDaMaquina(opcoes.maquina));
  const id = idDaMaquina();
  const agora = opcoes.agora ?? new Date().toISOString();
  const marca = lerMarcaDaRede();
  const base = { amb, maquina, id, diretorio: opcoes.diretorio, agora, arquivoDeProjetos: opcoes.arquivoDeProjetos, adesao: adesao.adesao ?? 'rede' } as const;
  // S15 da revisao 2: relogio que voltou (agora antes da marca) nao conta como dentro da batida.
  const desde = marca ? Date.parse(agora) - Date.parse(marca.em) : NaN;
  const dentroDaBatida = !!marca && marca.maquina === maquina && desde >= 0 && desde < PULSACAO_DA_REDE_MS;
  if (!opcoes.forcar && dentroDaBatida && marca!.forjas && !opcoes.forja && !opcoes.repositorio) {
    const barato = retratoComDescartes({ ...base, identidades: marca!.forjas, anteriores: marca!.projetos });
    if (assinaturaDoRetrato(barato.retrato) === marca!.assinatura) {
      return { acao: 'sem-mudanca', maquina, casa: marca!.casa, commit: marca!.commit, tentativas: 0, descartados: barato.descartados };
    }
  }
  const lidas = opcoes.identidades ?? forjasDaMaquina(amb).map((f) => f.identidade());
  const conferida = casaConferida({ ...opcoes, identidades: lidas });
  const identidades = identidadesComACasa(lidas, conferida.forja);
  const mesmaCasa = marca?.casa === refDaCasa(conferida.casa) && marca?.maquina === maquina;
  const { retrato, descartados } = retratoComDescartes({ ...base, identidades, anteriores: mesmaCasa ? marca?.projetos : undefined });
  exigirRetratoSeguro(retrato);
  if (!opcoes.forcar && mesmaCasa && dentroDaBatida && marca?.assinatura === assinaturaDoRetrato(retrato)) {
    return { acao: 'sem-mudanca', maquina, casa: marca.casa, commit: marca.commit, tentativas: 0, descartados };
  }
  return gravarNaCasa(conferida, retrato, descartados, { exigirAdesao: true, tomarNome: false });
}

/**
 * D9: a batida do pulse (e o `ork network publicar --silencioso` dos eventos). So membro, so com a
 * publicacao ligada, no maximo uma tentativa a cada 14 minutos. `null` quando nao era a vez.
 */
export function publicarRedeNaBatida(opcoes: OpcoesDaPublicacao & { agoraMs?: number } = {}): ResultadoDaRede | null {
  if (publicacaoDesligada(opcoes.amb?.env ?? process.env) || !adesaoDaRede().membro) return null;
  if (!tomarVezDePublicar(opcoes.agoraMs)) return null;
  return publicarRede(opcoes);
}

export interface ResultadoDaEntrada {
  config: ConfigDaRede;
  casa: CasaDaRede;
  criado: boolean;
  publicacao: ResultadoDaRede;
}

const NOME_DE_MAQUINA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * `ork network entrar`. M2 do CHECK 1: atomico do ponto de vista da maquina. Confere (e cria,
 * privada) a casa, publica o primeiro retrato e SO ENTAO grava o nome e a adesao; se a publicacao
 * falha, nada muda aqui. M3: o nome que vale e gravado, como no `ork fabrica entrar`: `--maquina`,
 * senao o ja gravado, senao `ORK_MAQUINA` ou o hostname; assim o cron publica com o mesmo nome.
 */
export function entrarNaRede(opcoes: OpcoesDaPublicacao = {}): ResultadoDaEntrada {
  // O nome explicito tem de ser valido; o que vem do arquivo, de ORK_MAQUINA ou do hostname e saneado.
  const explicito = (opcoes.maquina ?? '').trim();
  const maquina = explicito || nomeSeguro(lerConfigDaMaquina()?.nome || nomeDaMaquina());
  if (!NOME_DE_MAQUINA.test(maquina)) {
    throw new Error(`rede.maquina: nome de maquina invalido ("${maquina}"); use ork network entrar --maquina NOME (letras, numeros, ponto, _ ou -)`);
  }
  const amb = opcoes.amb ?? {};
  const lidas = opcoes.identidades ?? forjasDaMaquina(amb).map((f) => f.identidade());
  const conferida = casaConferida({ ...opcoes, identidades: lidas, criar: true });
  // S6 da revisao 2: entrar de novo, na mesma casa e com o mesmo nome, mantem a reserva D7 da marca.
  const marca = lerMarcaDaRede();
  const anteriores = marca?.casa === refDaCasa(conferida.casa) && marca.maquina === maquina ? marca.projetos : undefined;
  const { retrato, descartados } = retratoComDescartes({ amb, maquina, id: idDaMaquina(), diretorio: opcoes.diretorio,
    agora: opcoes.agora, identidades: identidadesComACasa(lidas, conferida.forja), anteriores, arquivoDeProjetos: opcoes.arquivoDeProjetos,
    adesao: 'rede' });
  exigirRetratoSeguro(retrato);
  const publicacao = gravarNaCasa(conferida, retrato, descartados, { exigirAdesao: false, tomarNome: opcoes.tomarNome });
  if (publicacao.acao === 'ocupado') {
    throw new Error(`rede.ocupado: outra publicacao desta maquina esta em andamento (${TRAVA()}); rode ork network entrar de novo em instantes`);
  }
  gravarConfigDaMaquina({ nome: maquina });
  const { casa } = conferida;
  const config = gravarConfigDaRede({ membro: true, forja: casa.forja, host: casa.host, dono: casa.dono, repositorio: casa.repositorio });
  return { config, casa: { ...casa, origem: 'rede.json' }, criado: conferida.criado, publicacao };
}

export interface ResultadoDaSaida {
  maquina: string;
  casa: string | null;
  commit: string | null;
  /** B7: o arquivo com este nome e de outra instalacao; nada foi removido. */
  alheio: boolean;
  /** S3 da revisao 2: a outra instalacao tem o hostname desta (provavelmente ela mesma, com id novo). */
  mesmoHostname?: true;
}

/**
 * `ork network sair`: a adesao vira `membro: false` e o retrato desta maquina sai da casa. B6: sob a
 * trava desta maquina (espera a publicacao em curso). B7: nunca remove o retrato de outra instalacao.
 */
export function sairDaRede(opcoes: OpcoesDaPublicacao = {}): ResultadoDaSaida {
  // U3 da revisao 3: a saida local vem primeiro; nada depois dela pode deixar a maquina membro.
  gravarConfigDaRede({ membro: false });
  const maquina = nomeSeguro(nomeDaMaquina(opcoes.maquina));
  const r = resolverCasa(opcoes);
  if (r.casa) gravarConfigDaRede({ forja: r.casa.forja, host: r.casa.host, dono: r.casa.dono, repositorio: r.casa.repositorio });
  try { fs.rmSync(arquivoDaMarca(), { force: true }); } catch { /* marca local */ }
  if (!r.casa || !r.forja) return { maquina, casa: null, commit: null, alheio: false };
  const repo = r.forja.repositorio(r.casa.dono, r.casa.repositorio);
  if (!repo.existe || !repo.url) return { maquina, casa: refDaCasa(r.casa), commit: null, alheio: false };
  const trava = travarCasa(30000);
  if (!trava.ok) throw new Error(`rede.ocupado: saiu da rede aqui, mas outra publicacao desta maquina segura a casa (${TRAVA()}); rode ork network sair de novo`);
  try {
    const cache = prepararCache(r.casa, repo.url, r.forja.helperDeCredencial(), maquina);
    const proprio = arquivoDoRetrato(maquina);
    const id = idDaMaquina();
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      const { ponta, atualizado } = comGitIsolado(() => buscarBranch(cache, 'origin', BRANCH_DA_REDE, PREFIXO, 30000));
      if (!atualizado) throw new Error(`rede.sem-leitura: saiu da rede aqui, mas nao consegui ler ${refDaCasa(r.casa)} para tirar o retrato; rode ork network sair de novo com rede`);
      const { retratos, invalidos } = retratosDaPonta(cache, ponta);
      const atual = retratos.find((x) => x.maquina === maquina);
      // S9 da revisao 2: o arquivo com o nome desta maquina sai tambem quando esta invalido; so o de
      // outra instalacao (retrato valido com outro `id`) fica.
      const invalido = invalidos.some((x) => x.arquivo === proprio);
      if (!atual && !invalido) return { maquina, casa: refDaCasa(r.casa), commit: null, alheio: false };
      // U2: invalido para esta versao, mas com o `id` de outra instalacao (contrato mais novo): nao e nosso.
      const idDoOutro = atual ? atual.id ?? null : idNoArquivo(cache, ponta, proprio);
      if (!atual && idDoOutro && idDoOutro !== id) return { maquina, casa: refDaCasa(r.casa), commit: null, alheio: true };
      if (atual?.id && atual.id !== id) {
        return { maquina, casa: refDaCasa(r.casa), commit: null, alheio: true, ...(atual.hostname === hostnameSeguro() ? { mesmoHostname: true as const } : {}) };
      }
      const mudancas: MudancaNaBranch[] = [
        { caminho: proprio, conteudo: null },
        { caminho: PAINEL_DA_REDE, conteudo: painelDaRede(retratos.filter((x) => x.maquina !== maquina)) },
      ];
      exigirSoOProprioRetrato(maquina, mudancas);
      const commit = comGitIsolado(() => gravarNaBranch(cache, 'origin', BRANCH_DA_REDE, ponta, mudancas, `rede: ${maquina} saiu`, PREFIXO),
        identidadeDoGit(maquina));
      if (commit) return { maquina, casa: refDaCasa(r.casa), commit, alheio: false };
    }
    throw new Error(`rede.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
  } finally { trava.liberar(); }
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
