/**
 * RM-031 KG3 (D2 a D4, D6): indice persistente e local do grafo de codigo.
 *
 * O indice e derivado do grafo do KG2 e chaveado pela revisao da arvore limpa: mora no estado
 * canonico do projeto, fora do git, uma pasta por chave:
 *
 *   <raiz canonica>/.orkastery/grafo/idx-<sha256>/{indice.json, grafo.json, relatorio.json}
 *
 * Pastas 0700 e arquivos 0600, do dono do processo, sem link simbolico nem segundo link fisico. A
 * chave deriva da revisao, do repositorio, do tenant, da ACL, das versoes dos analisadores, do fecho
 * de pacotes deles e da impressao do codigo compilado do extrator e do indice: mesma chave, mesmo
 * conteudo, byte a byte, sem horario. Arquivo rastreado que a leitura nao alcanca (sparse checkout,
 * `skip-worktree`) recusa a construcao: o grafo precisa ser o da revisao inteira.
 * A construcao valida o grafo, confere cada fonte e cada evidencia contra os bytes lidos e so entao
 * publica, por pasta temporaria e `rename`; a leitura confere tamanho e digest dos bytes.
 *
 * O indice nao e autoridade de fato: e projecao descartavel do repositorio. Nada nele concede acesso.
 *
 * RM-031 KG4 (D1, D2, D5, D7): o indice guarda tambem as unidades por arquivo (`unidades.json`), e a
 * construcao sem indice do HEAD parte do indice da revisao ancestral mais proxima com o mesmo perfil:
 * reextrai so o que a mudanca alcanca e grava os mesmos bytes da extracao completa. Sem base que
 * prove isso, extrai completo e diz por que.
 */
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GRAFO_SCHEMA, canonico, compararUtf8, conferirFontesDoGrafoValidado, sha256DoCanonico, type FonteFornecida, type GrafoCodigo,
} from './intelligence-graph-contract';
import {
  UNIDADES_SCHEMA, decodificarUtf8, extrairGrafo, type EntradaDeExtracao, type Parser, type Reaproveitamento, type RelatorioDeExtracao,
  type ResultadoDaExtracao, type UnidadesDaExtracao,
} from './intelligence-graph-extract';
import { carregarAnalisadores, pacotesDosAnalisadores, versoesDosAnalisadores, type VersoesDosAnalisadores } from './intelligence-graph-parsers';
import {
  TENANT_PADRAO, identidadeDaLeitura, lerRepositorio, revisaoDaArvore, revisoesAncestrais, type OpcoesDeLeitura, type RevisaoDaArvore,
} from './intelligence-graph-repo';

/** KG4 (D2): a v1 tem as unidades por arquivo; a v0 (KG3) nao serve de base e o `limpar` a remove. */
export const INDICE_SCHEMA = 'ork.code-graph-index/v1' as const;
export const INDICE_SCHEMA_ANTERIOR = 'ork.code-graph-index/v0' as const;
export const NOME_DE_INDICE = /^idx-[a-f0-9]{64}$/;
const ARQUIVOS = { manifesto: 'indice.json', grafo: 'grafo.json', relatorio: 'relatorio.json', unidades: 'unidades.json' } as const;
/** KG4 (D1): quantas revisoes, do HEAD para tras, a escolha da base percorre. */
export const LIMITE_DE_ANCESTRAIS = 512;
/** Temporario e lixo de construcao interrompida so saem no `limpar` depois deste prazo. */
export const PRAZO_DE_SOBRA_MS = 60 * 60 * 1000;
/** D3: os modulos compilados da extracao e do indice. Codigo corrigido sem troca de versao muda a chave. */
export const MODULOS_DO_EXTRATOR = [
  'intelligence-graph-contract', 'intelligence-graph-extract', 'intelligence-graph-extract-ts', 'intelligence-graph-extract-md',
  'intelligence-graph-repo', 'intelligence-graph-parsers', 'intelligence-graph-index', 'yaml',
] as const;
/**
 * CHECK rodada 1 (B1): exclusoes do KG2 que dependem da arvore, nao da revisao. Com o status limpo,
 * elas vem de sparse checkout ou `skip-worktree`, e o grafo seria outro na mesma revisao.
 */
export const EXCLUSOES_DA_ARVORE: ReadonlySet<string> = new Set(['ausente-na-arvore', 'nao-e-arquivo', 'fora-do-repositorio']);

export interface ContextoDoIndice {
  /** Diretorio dentro do repositorio (worktree ou arvore principal). */
  raiz: string;
  /** Raiz canonica do estado (`raizDoEstado`): a da arvore principal, tambem a partir de worktree. */
  estado: string;
  /** O `project.name` do manifesto que o CLI carregou; sem ele, o `orkastery.yaml` da raiz do Git. */
  repositorio?: string;
}

export interface PerfilDoIndice {
  repository_id: string;
  tenant_id: string;
  acl_refs: string[];
  analisadores: VersoesDosAnalisadores;
  /** O fecho de pacotes dos analisadores, `nome@versao` ordenado. */
  pacotes: string[];
  codigo: string;
}

export interface ManifestoDoIndice extends PerfilDoIndice {
  schema: typeof INDICE_SCHEMA;
  chave: string;
  revision: string;
  graph_schema: typeof GRAFO_SCHEMA;
  snapshot_id: string;
  graph_digest: string;
  graph_bytes: number;
  report_digest: string;
  report_bytes: number;
  contagens: RelatorioDeExtracao['contagens'];
  conferencia: { fontes: number; evidencias: number };
  units_schema: typeof UNIDADES_SCHEMA;
  units_digest: string;
  units_bytes: number;
}

export interface IndiceCarregado {
  dir: string;
  manifesto: ManifestoDoIndice;
  /** Ausente quando so a integridade foi pedida. */
  grafo: GrafoCodigo | null;
  relatorio: RelatorioDeExtracao | null;
  /** So quando pedidas: a base do incremental. */
  unidades: UnidadesDaExtracao | null;
}

export type EstadoDaConstrucao = 'criado' | 'existente' | 'reconstruido-identico' | 'substituido';

export interface ResultadoDaConstrucao {
  estado: EstadoDaConstrucao;
  /** Por que o indice que havia foi trocado (corrompido, permissao) ou `null`. */
  motivo: string | null;
  chave: string;
  dir: string;
  manifesto: ManifestoDoIndice;
  determinismo: { ordem: string; digest: string; relatorio: string; unidades: string; igual: boolean }[] | null;
  ms: number;
  /** KG4: como a extracao rodou; `null` quando o indice ja existia e nada foi extraido. */
  modo: 'completo' | 'incremental' | null;
  /** O indice ancestral usado como base (ou conferido no `--verificar`). */
  base: { revision: string; chave: string } | null;
  /** Por que nao houve base: sem indice ancestral, extrator mudado, base ilegivel, `--forcar`. */
  motivo_completo: string | null;
  /** O que veio da base, quando houve. */
  reaproveitamento: Reaproveitamento | null;
  /** `--verificar` com base: o incremental extraido de novo e comparado byte a byte com a completa. */
  incremental: { base: string; igual: boolean; reaproveitamento: Reaproveitamento | null } | null;
}

function falha(codigo: string, detalhe?: string): never {
  throw new Error(detalhe ? `${codigo}: ${detalhe}` : codigo);
}

const sha256 = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');
const uid = (): number | null => (typeof process.getuid === 'function' ? process.getuid() : null);

/** As versoes do `Parser` carregado, no formato que `versoesDosAnalisadores` le sem carregar. */
export const versoesDoParser = (p: Parser): VersoesDosAnalisadores =>
  ({ typescript: p.ts.version, javascript: p.javascript.versao, markdown: p.markdown.versao, unicode: p.unicode });

/** D3: SHA-256 dos bytes compilados dos modulos da extracao, na ordem fixa; `dir` so muda em teste. */
export function impressaoDoExtrator(dir: string = __dirname): string {
  const h = createHash('sha256');
  for (const m of MODULOS_DO_EXTRATOR) {
    const bytes = fs.readFileSync(path.join(dir, `${m}.js`));
    h.update(`${m}\u0000${bytes.length}\u0000`).update(bytes);
  }
  return h.digest('hex');
}

export function perfilDoIndice(raiz: string, analisadores: VersoesDosAnalisadores = versoesDosAnalisadores(), leitura: OpcoesDeLeitura = {}): PerfilDoIndice {
  const id = identidadeDaLeitura(raiz, leitura);
  return {
    ...id, acl_refs: [...new Set(id.acl_refs)].sort(compararUtf8), analisadores, pacotes: pacotesDosAnalisadores(), codigo: impressaoDoExtrator(),
  };
}

/** A leitura do contexto: o repositorio do manifesto do CLI, se veio, sob as opcoes pedidas. */
const leituraDo = (ctx: ContextoDoIndice, leitura: OpcoesDeLeitura = {}): OpcoesDeLeitura =>
  (ctx.repositorio && leitura.repository_id === undefined ? { ...leitura, repository_id: ctx.repositorio } : leitura);

/** D3: a chave particiona por revisao, repositorio, tenant, ACL, analisadores e codigo do extrator. */
export function chaveDoIndice(revision: string, perfil: PerfilDoIndice): string {
  return `idx-${sha256DoCanonico({ schema: INDICE_SCHEMA, revision, ...perfil })}`;
}

/**
 * D6: a avaliacao local. Quem roda o CLI e le a raiz do repositorio recebe a leitura dele, no
 * tenant local; nada mais. Sem leitura, a recusa e explicita, sem cair para outro escopo.
 */
export function concessaoLocal(raiz: string, perfil: PerfilDoIndice): { tenant_id: string; acl_refs: string[] } {
  try {
    fs.accessSync(raiz, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    falha('grafo.acesso.negado', 'quem roda o CLI nao le a raiz do repositorio');
  }
  return { tenant_id: TENANT_PADRAO, acl_refs: [`repo:${perfil.repository_id}:leitura`] };
}

/** Pasta do estado: real, do dono e 0700; `criar` ajusta a que o proprio processo cria. */
function pastaPrivada(p: string, criar: boolean): void {
  if (criar) {
    try {
      fs.mkdirSync(p, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) falha('grafo.indice.ausente');
  if (st.isSymbolicLink() || !st.isDirectory()) falha('grafo.indice.permissao-invalida', `${path.basename(p)} nao e pasta real`);
  const dono = uid();
  if (dono !== null && st.uid !== dono) falha('grafo.indice.permissao-invalida', `${path.basename(p)} de outro dono`);
  if ((st.mode & 0o777) !== 0o700) {
    if (!criar) falha('grafo.indice.permissao-invalida', `${path.basename(p)} com modo ${(st.mode & 0o777).toString(8)}`);
    fs.chmodSync(p, 0o700);
  }
}

/** `<estado>/.orkastery/grafo`, real e privada. So a construcao cria. */
export function pastaDoGrafo(ctx: ContextoDoIndice, criar: boolean): string {
  const estado = path.join(ctx.estado, '.orkastery');
  if (criar) fs.mkdirSync(estado, { recursive: true });
  const st = fs.lstatSync(estado, { throwIfNoEntry: false });
  if (!st) falha('grafo.indice.ausente');
  if (st.isSymbolicLink() || !st.isDirectory()) falha('grafo.indice.permissao-invalida', '.orkastery nao e pasta real');
  const dir = path.join(estado, 'grafo');
  pastaPrivada(dir, criar);
  return dir;
}

/** Le arquivo do indice pelo descritor aberto sem seguir link: regular, do dono, 0600 e com um link so. */
function lerPrivado(arquivo: string): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT') falha('grafo.indice.corrompido', `${path.basename(arquivo)} ausente`);
    falha('grafo.indice.permissao-invalida', `${path.basename(arquivo)} (${codigo ?? 'erro'})`);
  }
  try {
    const st = fs.fstatSync(fd);
    const dono = uid();
    if (!st.isFile() || st.nlink !== 1 || (dono !== null && st.uid !== dono) || (st.mode & 0o777) !== 0o600) {
      falha('grafo.indice.permissao-invalida', path.basename(arquivo));
    }
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** KG4: as mesmas regras de `lerPrivado` e o tamanho do manifesto, sem ler o conteudo (a consulta nao precisa das unidades). */
function conferirPrivado(arquivo: string, bytes: number): void {
  let fd: number;
  try {
    fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT') falha('grafo.indice.corrompido', `${path.basename(arquivo)} ausente`);
    falha('grafo.indice.permissao-invalida', `${path.basename(arquivo)} (${codigo ?? 'erro'})`);
  }
  try {
    const st = fs.fstatSync(fd);
    const dono = uid();
    if (!st.isFile() || st.nlink !== 1 || (dono !== null && st.uid !== dono) || (st.mode & 0o777) !== 0o600) {
      falha('grafo.indice.permissao-invalida', path.basename(arquivo));
    }
    if (st.size !== bytes) falha('grafo.indice.corrompido', `${path.basename(arquivo)} nao bate com o tamanho`);
  } finally {
    fs.closeSync(fd);
  }
}

function gravarPrivado(arquivo: string, texto: string): void {
  const fd = fs.openSync(arquivo, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, texto, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function sincronizarPasta(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const HEX64 = /^[a-f0-9]{64}$/;

function manifestoValido(m: unknown, chave: string): ManifestoDoIndice {
  const o = m as ManifestoDoIndice;
  const inteiro = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0;
  if (o && typeof o === 'object' && (o as { schema?: unknown }).schema === INDICE_SCHEMA_ANTERIOR) {
    falha('grafo.indice.formato-anterior', `${INDICE_SCHEMA_ANTERIOR} (KG3), sem unidades; o ork grafo limpar o remove`);
  }
  if (!o || typeof o !== 'object' || o.schema !== INDICE_SCHEMA || o.chave !== chave || o.graph_schema !== GRAFO_SCHEMA
    || o.units_schema !== UNIDADES_SCHEMA || !HEX64.test(o.units_digest) || !inteiro(o.units_bytes)
    || typeof o.revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(o.revision)
    || !HEX64.test(o.graph_digest) || !HEX64.test(o.report_digest) || !inteiro(o.graph_bytes) || !inteiro(o.report_bytes)
    || typeof o.snapshot_id !== 'string' || typeof o.repository_id !== 'string' || typeof o.tenant_id !== 'string'
    || !Array.isArray(o.acl_refs) || !o.analisadores || !Array.isArray(o.pacotes) || typeof o.codigo !== 'string') {
    falha('grafo.indice.corrompido', 'indice.json');
  }
  return o;
}

/**
 * Le o indice da chave e confere a integridade: permissao de pasta e arquivo, manifesto, tamanho e
 * digest dos bytes do grafo e do relatorio, e o envelope do grafo contra o manifesto. Nao roda
 * `validarGrafo` (D4): a construcao ja validou, e o digest prova que os bytes sao aqueles.
 */
export function lerIndice(ctx: ContextoDoIndice, chave: string, opcoes: { grafo?: boolean; relatorio?: boolean; unidades?: boolean } = {}): IndiceCarregado {
  if (!NOME_DE_INDICE.test(chave)) falha('grafo.indice.chave-invalida');
  const dir = path.join(pastaDoGrafo(ctx, false), chave);
  pastaPrivada(dir, false);
  let manifesto: ManifestoDoIndice;
  try {
    manifesto = manifestoValido(JSON.parse(lerPrivado(path.join(dir, ARQUIVOS.manifesto)).toString('utf8')), chave);
  } catch (e) {
    if (e instanceof SyntaxError) falha('grafo.indice.corrompido', 'indice.json');
    throw e;
  }
  const conferido = (nome: string, bytes: number, digest: string): Buffer => {
    const b = lerPrivado(path.join(dir, nome));
    if (b.length !== bytes || sha256(b) !== digest) falha('grafo.indice.corrompido', `${nome} nao bate com o digest`);
    return b;
  };
  const bytesDoGrafo = conferido(ARQUIVOS.grafo, manifesto.graph_bytes, manifesto.graph_digest);
  const bytesDoRelatorio = conferido(ARQUIVOS.relatorio, manifesto.report_bytes, manifesto.report_digest);
  let grafo: GrafoCodigo | null = null;
  if (opcoes.grafo !== false) {
    grafo = JSON.parse(bytesDoGrafo.toString('utf8')) as GrafoCodigo;
    const s = grafo.snapshot;
    if (grafo.schema !== GRAFO_SCHEMA || grafo.tenant_id !== manifesto.tenant_id || grafo.repository_id !== manifesto.repository_id
      || !s || s.snapshot_id !== manifesto.snapshot_id || s.revision !== manifesto.revision) {
      falha('grafo.indice.corrompido', 'grafo.json fora do manifesto');
    }
  }
  const relatorio = opcoes.relatorio ? JSON.parse(bytesDoRelatorio.toString('utf8')) as RelatorioDeExtracao : null;
  // KG4: as unidades so sao lidas (e o digest conferido) por quem as usa; a consulta confere so o tamanho.
  let unidades: UnidadesDaExtracao | null = null;
  if (opcoes.unidades) {
    let u: UnidadesDaExtracao;
    try {
      u = JSON.parse(conferido(ARQUIVOS.unidades, manifesto.units_bytes, manifesto.units_digest).toString('utf8')) as UnidadesDaExtracao;
    } catch (e) {
      if (e instanceof SyntaxError) falha('grafo.indice.corrompido', 'unidades.json');
      throw e;
    }
    if (!u || u.schema !== UNIDADES_SCHEMA || u.snapshot_id !== manifesto.snapshot_id || u.graph_digest !== manifesto.graph_digest
      || !Array.isArray(u.arquivos) || !Array.isArray(u.globais_ts)) {
      falha('grafo.indice.corrompido', 'unidades.json fora do manifesto');
    }
    unidades = u;
  } else conferirPrivado(path.join(dir, ARQUIVOS.unidades), manifesto.units_bytes);
  return { dir, manifesto, grafo, relatorio, unidades };
}

/** Embaralhamento reproduzivel (LCG): a permutacao da verificacao nao depende de acaso. */
function embaralhar<T>(itens: readonly T[], semente: number): T[] {
  const r = [...itens];
  let s = semente >>> 0;
  for (let i = r.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function mesmoConteudo(dir: string, conteudos: Record<string, string>): boolean {
  try {
    return Object.entries(conteudos).every(([nome, texto]) => lerPrivado(path.join(dir, nome)).equals(Buffer.from(texto, 'utf8')))
      && fs.readdirSync(dir).length === Object.keys(conteudos).length;
  } catch {
    return false;
  }
}

function removerPasta(grafoDir: string, nome: string): void {
  const alvo = path.join(grafoDir, nome);
  const st = fs.lstatSync(alvo, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    fs.unlinkSync(alvo);
    return;
  }
  // Renomeia antes de apagar: quem le nunca ve a pasta da chave pela metade.
  const lixo = nome.startsWith('.lixo-') ? alvo : path.join(grafoDir, `.lixo-${randomUUID()}`);
  if (lixo !== alvo) fs.renameSync(alvo, lixo);
  fs.rmSync(lixo, { recursive: true, force: true });
}

export interface OpcoesDaConstrucao {
  verificar?: boolean;
  forcar?: boolean;
  parser?: Parser;
  leitura?: OpcoesDeLeitura;
  /** So para teste: roda entre gravar o temporario e publica-lo. */
  antesDePublicar?: () => void;
}

/**
 * Constroi o indice do HEAD limpo, ou confirma o que ja existe. `--forcar` extrai de novo e so
 * troca os arquivos se o conteudo mudou; `--verificar` extrai de novo, prova o determinismo com a
 * ordem de leitura trocada e reprova se o guardado integro difere; indice que nao passa na leitura
 * e substituido.
 */
/** KG4 (D1): o indice de outra revisao que serve de base, com as unidades ja conferidas. */
interface BaseDoIncremental { revision: string; chave: string; unidades: UnidadesDaExtracao }

/** O perfil que um manifesto guarda: tudo o que entra na chave, menos a revisao. */
const perfilDoManifesto = (m: ManifestoDoIndice): PerfilDoIndice => ({
  repository_id: m.repository_id, tenant_id: m.tenant_id, acl_refs: m.acl_refs, analisadores: m.analisadores, pacotes: m.pacotes, codigo: m.codigo,
});
const curta = (r: string): string => r.slice(0, 12);

/**
 * KG4 (D1, D5): a base e o indice da revisao ancestral mais proxima do HEAD (nas `LIMITE_DE_ANCESTRAIS`
 * do `git rev-list`) com o mesmo perfil. Sem ela, o motivo diz o que havia: indice ancestral de outro
 * extrator, indice do mesmo extrator fora da linha do HEAD (historico reescrito ou outro ramo), indice
 * de formato anterior, ou nenhum. Base que nao passa na leitura e trocada pela proxima, com o erro.
 */
export function escolherBase(ctx: ContextoDoIndice, perfil: PerfilDoIndice, head: string, raiz: string): { base: BaseDoIncremental | null; motivo: string | null } {
  let dir: string;
  try {
    dir = pastaDoGrafo(ctx, false);
  } catch (e) {
    if ((e as Error).message === 'grafo.indice.ausente') return { base: null, motivo: 'nenhum indice guardado' };
    throw e;
  }
  const posicao = new Map(revisoesAncestrais(raiz, LIMITE_DE_ANCESTRAIS).map((r, i) => [r, i]));
  const desejado = canonico(perfil), identidade = canonico([perfil.repository_id, perfil.tenant_id, perfil.acl_refs]);
  const candidatos: { chave: string; revision: string; posicao: number }[] = [];
  let outroExtrator: { revision: string; campos: string[]; posicao: number } | null = null, foraDaLinha: string | null = null, anterior = false;
  for (const nome of fs.readdirSync(dir).sort(compararUtf8)) {
    if (!NOME_DE_INDICE.test(nome)) continue;
    let m: ManifestoDoIndice;
    try {
      pastaPrivada(path.join(dir, nome), false);
      m = manifestoValido(JSON.parse(lerPrivado(path.join(dir, nome, ARQUIVOS.manifesto)).toString('utf8')), nome);
    } catch (e) {
      if ((e as Error).message.startsWith('grafo.indice.formato-anterior')) anterior = true;
      continue;
    }
    if (m.revision === head) continue;
    const p = perfilDoManifesto(m), i = posicao.get(m.revision);
    if (canonico(p) === desejado) {
      if (i === undefined) foraDaLinha ??= m.revision;
      else candidatos.push({ chave: nome, revision: m.revision, posicao: i });
    } else if (i !== undefined && canonico([p.repository_id, p.tenant_id, p.acl_refs]) === identidade && (!outroExtrator || i < outroExtrator.posicao)) {
      const campos = (['analisadores', 'pacotes', 'codigo'] as const).filter((k) => canonico(p[k]) !== canonico(perfil[k]));
      outroExtrator = { revision: m.revision, campos, posicao: i };
    }
  }
  const erros: string[] = [];
  for (const c of candidatos.sort((a, b) => a.posicao - b.posicao)) {
    try {
      const lido = lerIndice(ctx, c.chave, { grafo: false, unidades: true });
      return { base: { revision: c.revision, chave: c.chave, unidades: lido.unidades as UnidadesDaExtracao }, motivo: null };
    } catch (e) {
      erros.push(`${curta(c.revision)}: ${(e as Error).message}`);
    }
  }
  if (erros.length) return { base: null, motivo: `base ilegivel (${erros.join('; ')})` };
  const motivos: string[] = [];
  if (foraDaLinha) {
    motivos.push(`nenhum indice de revisao ancestral nas ultimas ${LIMITE_DE_ANCESTRAIS}; o de ${curta(foraDaLinha)} nao esta entre elas (historico reescrito, outro ramo ou revisao mais antiga)`);
  }
  if (outroExtrator) motivos.push(`o extrator mudou desde o indice de ${curta(outroExtrator.revision)} (${outroExtrator.campos.join(', ')})`);
  if (!motivos.length && anterior) motivos.push(`so ha indice de formato anterior (${INDICE_SCHEMA_ANTERIOR})`);
  return { base: null, motivo: motivos.length ? motivos.join('; ') : 'nenhum indice de revisao ancestral com este extrator' };
}

const textoDasUnidades = (u: UnidadesDaExtracao): string => JSON.stringify(u);

/**
 * Constroi o indice do HEAD limpo, ou confirma o que ja existe. Sem o indice do HEAD, parte do indice
 * ancestral com o mesmo perfil (KG4) e reextrai so o que a mudanca alcanca; sem base, ou se o
 * incremental falha, extrai completo e diz por que. `--forcar` extrai completo e so troca os arquivos se
 * o conteudo mudou; `--verificar` extrai completo, prova o determinismo com a ordem de leitura trocada,
 * compara com o incremental quando ha base e reprova se o guardado integro difere; indice que nao passa
 * na leitura e substituido. O incremental passa pelas mesmas validacoes da completa antes de publicar.
 */
export function construirIndice(ctx: ContextoDoIndice, opcoes: OpcoesDaConstrucao = {}): ResultadoDaConstrucao {
  const inicio = process.hrtime.bigint();
  const ms = (): number => Number((process.hrtime.bigint() - inicio) / 1000000n);
  const arvore = revisaoDaArvore(ctx.raiz);
  if (arvore.motivo !== null || arvore.head === null) falha('grafo.indice.arvore-nao-limpa', arvore.motivo ?? 'sem-commit');
  const head = arvore.head;
  const parser = opcoes.parser ?? carregarAnalisadores();
  const leitura = leituraDo(ctx, opcoes.leitura);
  const perfil = perfilDoIndice(arvore.raiz, versoesDoParser(parser), leitura);
  const chave = chaveDoIndice(head, perfil);
  const grafoDir = pastaDoGrafo(ctx, true);
  const final = path.join(grafoDir, chave);

  let motivo: string | null = null;
  const existia = !!fs.lstatSync(final, { throwIfNoEntry: false });
  if (existia) {
    try {
      const atual = lerIndice(ctx, chave, { grafo: false });
      // `--verificar` nunca confia no guardado: extrai de novo e compara, como o `--forcar`.
      if (!opcoes.forcar && !opcoes.verificar) {
        return {
          estado: 'existente', motivo: null, chave, dir: final, manifesto: atual.manifesto, determinismo: null, ms: ms(),
          modo: null, base: null, motivo_completo: null, reaproveitamento: null, incremental: null,
        };
      }
    } catch (e) {
      motivo = (e as Error).message;
    }
  }

  const entrada: EntradaDeExtracao = lerRepositorio(arvore.raiz, leitura);
  if (entrada.revision !== head) falha('grafo.indice.arvore-nao-limpa', entrada.revision_unavailable_reason ?? 'revisao-mudou');
  const fora = (entrada.excluidas ?? []).filter((e) => EXCLUSOES_DA_ARVORE.has(e.motivo)).sort((a, b) => compararUtf8(a.path, b.path));
  if (fora.length) {
    falha('grafo.indice.arvore-nao-limpa', `rastreado fora da leitura (${fora[0].motivo}: ${fora[0].path}${fora.length > 1 ? ` e mais ${fora.length - 1}` : ''})`);
  }

  // KG4 (D1, D5, D7): a base, salvo com `--forcar`.
  let base: BaseDoIncremental | null = null, motivoCompleto: string | null = 'pedido com --forcar';
  if (!opcoes.forcar) ({ base, motivo: motivoCompleto } = escolherBase(ctx, perfil, head, arvore.raiz));
  let r: ResultadoDaExtracao | null = null, modo: 'completo' | 'incremental' = 'completo';
  if (base && !opcoes.verificar) {
    try {
      r = extrairGrafo(entrada, parser, base.unidades);
      modo = 'incremental';
    } catch (e) {
      // O incremental nunca impede o indice: a completa decide, e o motivo fica dito.
      motivoCompleto = `o incremental a partir de ${curta(base.revision)} falhou e a extracao foi completa (${(e as Error).message})`;
      r = null;
    }
  }
  if (!r) r = extrairGrafo(entrada, parser);
  const bytesDe = new Map(entrada.fontes.map((f) => [f.path, f.bytes]));
  const fornecidas = new Map<string, FonteFornecida>(r.grafo.snapshot.source_manifest.map((m) => {
    const b = bytesDe.get(m.path) as Uint8Array;
    return [m.path, { tipo: decodificarUtf8(b) === null ? 'binario' : 'texto', bytes: b }];
  }));
  // KG4 (D6): `r.grafo` e o retorno de `validarGrafo` dentro da extracao; validar de novo so repetiria.
  const conferencia = conferirFontesDoGrafoValidado(r.grafo, fornecidas);
  if (conferencia.estado !== 'verificada' || conferencia.evidenciasIndisponiveis > 0) falha('grafo.indice.fontes-nao-conferidas');

  const textoDoGrafo = canonico(r.grafo), textoDoRelatorio = canonico(r.relatorio), unidades = textoDasUnidades(r.unidades);
  if (sha256(textoDoGrafo) !== r.digest) falha('grafo.indice.digest-divergente');
  let determinismo: ResultadoDaConstrucao['determinismo'] = null, incremental: ResultadoDaConstrucao['incremental'] = null;
  if (opcoes.verificar) {
    const relatorio = sha256(textoDoRelatorio), dasUnidades = sha256(unidades);
    determinismo = ([['ordem invertida', [...entrada.fontes].reverse()], ['ordem embaralhada', embaralhar(entrada.fontes, 2026)]] as const)
      .map(([ordem, fontes]) => {
        const outra = extrairGrafo({ ...entrada, fontes }, parser);
        const doOutro = sha256DoCanonico(outra.relatorio), unidadesDoOutro = sha256(textoDasUnidades(outra.unidades));
        return {
          ordem, digest: outra.digest, relatorio: doOutro, unidades: unidadesDoOutro,
          igual: outra.digest === r.digest && doOutro === relatorio && unidadesDoOutro === dasUnidades,
        };
      });
    const diferente = determinismo.find((d) => !d.igual);
    if (diferente) falha('grafo.indice.nao-deterministico', diferente.ordem);
    if (base) {
      // KG4 (D7): a prova no repositorio de quem usa: o incremental da base da os mesmos bytes da completa.
      let inc: ResultadoDaExtracao;
      try {
        inc = extrairGrafo(entrada, parser, base.unidades);
      } catch (e) {
        falha('grafo.indice.incremental-divergente', `o incremental da base ${curta(base.revision)} falhou: ${(e as Error).message}`);
      }
      const igual = canonico(inc.grafo) === textoDoGrafo && canonico(inc.relatorio) === textoDoRelatorio && textoDasUnidades(inc.unidades) === unidades;
      if (!igual) falha('grafo.indice.incremental-divergente', `base ${curta(base.revision)}`);
      incremental = { base: base.revision, igual, reaproveitamento: inc.reaproveitamento };
    }
  }

  const manifesto: ManifestoDoIndice = {
    schema: INDICE_SCHEMA, chave, revision: head, ...perfil, graph_schema: GRAFO_SCHEMA, snapshot_id: r.grafo.snapshot.snapshot_id,
    graph_digest: r.digest, graph_bytes: Buffer.byteLength(textoDoGrafo, 'utf8'),
    report_digest: sha256(textoDoRelatorio), report_bytes: Buffer.byteLength(textoDoRelatorio, 'utf8'),
    contagens: r.relatorio.contagens,
    conferencia: { fontes: conferencia.fontesVerificadas.length, evidencias: conferencia.evidenciasVerificadas },
    units_schema: UNIDADES_SCHEMA, units_digest: sha256(unidades), units_bytes: Buffer.byteLength(unidades, 'utf8'),
  };
  const conteudos: Record<string, string> = {
    [ARQUIVOS.manifesto]: canonico(manifesto), [ARQUIVOS.grafo]: textoDoGrafo, [ARQUIVOS.relatorio]: textoDoRelatorio, [ARQUIVOS.unidades]: unidades,
  };
  const daBase = modo === 'incremental' && base ? { revision: base.revision, chave: base.chave } : opcoes.verificar && base ? { revision: base.revision, chave: base.chave } : null;

  const tmp = path.join(grafoDir, `.tmp-${randomUUID()}`);
  pastaPrivada(tmp, true);
  try {
    for (const [nome, texto] of Object.entries(conteudos)) gravarPrivado(path.join(tmp, nome), texto);
    sincronizarPasta(tmp);
    opcoes.antesDePublicar?.();
    const resultado = (estado: EstadoDaConstrucao): ResultadoDaConstrucao => ({
      estado, motivo, chave, dir: final, manifesto, determinismo, ms: ms(), modo, base: daBase,
      motivo_completo: modo === 'incremental' ? null : motivoCompleto, reaproveitamento: r?.reaproveitamento ?? null, incremental,
    });
    if (!existia && fs.lstatSync(final, { throwIfNoEntry: false })) {
      // Corrida: outra construcao publicou a mesma chave durante esta. Vale a dela, se estiver integra.
      lerIndice(ctx, chave, { grafo: false });
      return resultado('existente');
    }
    if (existia && fs.lstatSync(final, { throwIfNoEntry: false })) {
      if (motivo === null && mesmoConteudo(final, conteudos)) return resultado('reconstruido-identico');
      // Mesma chave e conteudo integro diferente: a extracao nao se repetiu. A verificacao reprova; o forcar troca.
      if (motivo === null && opcoes.verificar) falha('grafo.indice.nao-deterministico', 'o indice guardado difere da extracao nova');
      if (motivo === null) motivo = 'conteudo diferente na mesma chave';
      removerPasta(grafoDir, chave);
      fs.renameSync(tmp, final);
      sincronizarPasta(grafoDir);
      return resultado('substituido');
    }
    try {
      fs.renameSync(tmp, final);
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (codigo !== 'ENOTEMPTY' && codigo !== 'EEXIST') throw e;
      lerIndice(ctx, chave, { grafo: false });
      return resultado('existente');
    }
    sincronizarPasta(grafoDir);
    return resultado('criado');
  } finally {
    if (fs.lstatSync(tmp, { throwIfNoEntry: false })) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** O indice do HEAD com o extrator desta instalacao, e a arvore como esta agora. */
export function indiceDoHead(ctx: ContextoDoIndice, opcoes: { grafo?: boolean; relatorio?: boolean } = {}):
  { arvore: RevisaoDaArvore; perfil: PerfilDoIndice; chave: string; indice: IndiceCarregado } {
  const arvore = revisaoDaArvore(ctx.raiz);
  if (arvore.head === null) falha('grafo.indice.arvore-nao-limpa', 'sem-commit');
  const perfil = perfilDoIndice(arvore.raiz, undefined, leituraDo(ctx));
  const chave = chaveDoIndice(arvore.head, perfil);
  try {
    return { arvore, perfil, chave, indice: lerIndice(ctx, chave, opcoes) };
  } catch (e) {
    if ((e as Error).message === 'grafo.indice.ausente') falha('grafo.indice.ausente', `sem indice do HEAD ${arvore.head.slice(0, 12)}; rode ork grafo indexar`);
    throw e;
  }
}

export interface ResumoDoIndice {
  chave: string;
  bytes: number;
  revision: string | null;
  repository_id: string | null;
  snapshot_id: string | null;
  problema: string | null;
}

export interface EstadoDosIndices {
  dir: string | null;
  indices: ResumoDoIndice[];
  sobras: string[];
  bytes: number;
}

function bytesDaPasta(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const st = fs.lstatSync(p);
    total += st.isDirectory() ? bytesDaPasta(p) : st.size;
  }
  return total;
}

/** Os indices guardados, com a integridade de cada um, e as sobras de construcao interrompida. */
export function estadoDosIndices(ctx: ContextoDoIndice): EstadoDosIndices {
  let dir: string;
  try {
    dir = pastaDoGrafo(ctx, false);
  } catch (e) {
    if ((e as Error).message === 'grafo.indice.ausente') return { dir: null, indices: [], sobras: [], bytes: 0 };
    throw e;
  }
  const indices: ResumoDoIndice[] = [], sobras: string[] = [];
  let bytes = 0;
  for (const nome of fs.readdirSync(dir).sort(compararUtf8)) {
    // Uma construcao concorrente pode renomear o `.tmp-` entre a listagem e o `lstat`: some da lista.
    const p = path.join(dir, nome), st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    let tamanho: number;
    try {
      tamanho = st.isDirectory() && !st.isSymbolicLink() ? bytesDaPasta(p) : st.size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    bytes += tamanho;
    if (!NOME_DE_INDICE.test(nome)) {
      sobras.push(nome);
      continue;
    }
    try {
      const { manifesto } = lerIndice(ctx, nome, { grafo: false });
      indices.push({ chave: nome, bytes: tamanho, revision: manifesto.revision, repository_id: manifesto.repository_id, snapshot_id: manifesto.snapshot_id, problema: null });
    } catch (e) {
      indices.push({ chave: nome, bytes: tamanho, revision: null, repository_id: null, snapshot_id: null, problema: (e as Error).message });
    }
  }
  return { dir, indices, sobras, bytes };
}

/**
 * Apaga os indices fora de `manter` e cuja revisao nao esta em `manterRevisoes` (ou todos, com
 * `tudo`), e as sobras `.tmp-` e `.lixo-` com mais de uma hora. Nome que nao e do indice nunca e
 * apagado.
 */
export function limparIndices(ctx: ContextoDoIndice,
  opcoes: { manter?: readonly string[]; manterRevisoes?: readonly string[]; tudo?: boolean; agora?: number } = {}):
  { removidos: { nome: string; bytes: number }[]; bytes: number } {
  const estado = estadoDosIndices(ctx);
  if (!estado.dir) return { removidos: [], bytes: 0 };
  const dir = estado.dir, agora = opcoes.agora ?? Date.now(), manter = new Set(opcoes.manter ?? []);
  const revisoes = new Set(opcoes.manterRevisoes ?? []);
  const removidos: { nome: string; bytes: number }[] = [];
  for (const i of estado.indices) {
    if (!opcoes.tudo && (manter.has(i.chave) || (i.revision !== null && revisoes.has(i.revision)))) continue;
    removerPasta(dir, i.chave);
    removidos.push({ nome: i.chave, bytes: i.bytes });
  }
  for (const nome of estado.sobras) {
    if (!/^\.(tmp|lixo)-[0-9a-f-]{36}$/.test(nome)) continue;
    const p = path.join(dir, nome), st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st || agora - st.mtimeMs < PRAZO_DE_SOBRA_MS) continue;
    const tamanho = st.isDirectory() && !st.isSymbolicLink() ? bytesDaPasta(p) : st.size;
    removerPasta(dir, nome);
    removidos.push({ nome, bytes: tamanho });
  }
  return { removidos, bytes: removidos.reduce((n, r) => n + r.bytes, 0) };
}
