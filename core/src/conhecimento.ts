/**
 * RM-026 K7 (fatia 1): conhecimento escrito, no contrato `ork.conhecimento/v1`.
 *
 * Cada documento é um Markdown versionado na pasta que o `orkastery.yaml` declara (`conhecimento.dir`), com
 * frontmatter fechado: `id` (`doc-...`), `titulo`, `colecoes` e, opcional, `referencias` a ids do Brain e a
 * decisões `thread#linha` do ledger. A coleção é o nome no frontmatter, sem arquivo próprio.
 *
 * Só leitura. Documento inválido ou referência que não confere vira lacuna tipada, nunca resposta (D4). A pasta
 * vem com o repositório e segue a fronteira da RM-047 (D6): relativa, dentro da raiz pelo caminho real, sem
 * seguir link e sem executar nada. Nesta fatia a decisão confere no ledger canônico e o id do Brain só pela forma
 * (D5); a CLI, as tools MCP e a conferência pelo Brain chegam nas fatias 2 e 3. Contrato:
 * docs/referencia/contratos/conhecimento-rm026.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bytesHash } from './company-brain-journal';
import { ehPaginaDeDocs, separarFrontmatter } from './docs';
import { ManifestoCarregado } from './manifest';
import { ID_DE_ENTIDADE } from './portfolio';
import { dirThread } from './thread';
import { lerYaml, ValorYaml } from './yaml';

export const CONTRATO_CONHECIMENTO = 'ork.conhecimento/v1' as const;

/** D3: a forma do id do documento (a regra dos ids do portfólio), da coleção e da citação de decisão. */
export const ID_DE_DOCUMENTO = /^doc-[a-z0-9][a-z0-9-]{2,47}$/;
export const NOME_DE_COLECAO = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const REFERENCIA_DE_DECISAO = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})#([1-9][0-9]{0,8})$/;
const LIMITE_DO_TITULO = 160;
const COLECOES_POR_DOCUMENTO = 16;
const REFERENCIAS_POR_LISTA = 64;
/** D2: as chaves do frontmatter; qualquer outra invalida o documento. */
const CHAVES_DO_DOCUMENTO = ['id', 'titulo', 'colecoes', 'referencias'];
const CHAVES_DAS_REFERENCIAS = ['brain', 'decisoes'];
/** D5: as linhas do ledger que são decisão, as do dossiê; `human_decision` é relato sem recibo e não conta. */
const TIPOS_DE_DECISAO = ['autonomous_decision', 'hitl_requested', 'human_gate'] as const;
type TipoDeDecisao = typeof TIPOS_DE_DECISAO[number];
/** D6: pastas do repositório que nunca guardam conhecimento. */
const PASTAS_RESERVADAS = ['.git', '.orkastery'];
/** Caractere de controle, de formato ou separador de linha: não entra em título, nome de arquivo nem lacuna. */
const CONTROLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const CONTROLES = new RegExp(CONTROLE.source, 'gu');

/** D7: tetos da leitura. Os da pasta falham fechado; o do documento vira lacuna só dele. */
export interface LimitesDoConhecimento {
  entradas: number;
  profundidade: number;
  bytesPorDocumento: number;
  bytesDoFrontmatter: number;
  bytesNoTotal: number;
  bytesDoLedger: number;
}
export const LIMITES_DO_CONHECIMENTO: Readonly<LimitesDoConhecimento> = Object.freeze({
  entradas: 5000, profundidade: 8, bytesPorDocumento: 1024 * 1024, bytesDoFrontmatter: 16 * 1024,
  bytesNoTotal: 32 * 1024 * 1024, bytesDoLedger: 16 * 1024 * 1024,
});

export type CodigoDeLacunaDoConhecimento =
  | 'conhecimento.nao-declarado' | 'conhecimento.dir-invalido' | 'conhecimento.dir-fora-da-raiz' | 'conhecimento.dir-ausente'
  | 'conhecimento.limite'
  | 'documento.link' | 'documento.nao-regular' | 'documento.nome-invalido' | 'documento.grande-demais' | 'documento.codificacao'
  | 'documento.sem-frontmatter' | 'documento.frontmatter-invalido' | 'documento.chave-desconhecida' | 'documento.id-invalido'
  | 'documento.id-repetido' | 'documento.titulo-invalido' | 'documento.colecoes-invalidas' | 'documento.referencias-invalidas'
  | 'referencia.invalida' | 'referencia.decisao-ausente' | 'referencia.nao-e-decisao';

export interface LacunaDoConhecimento {
  codigo: CodigoDeLacunaDoConhecimento;
  /** Caminho relativo à raiz, com `/`; `null` nas lacunas da pasta. */
  arquivo: string | null;
  /** O id do documento, quando ele chegou a ser lido na forma certa. */
  documento: string | null;
  /** A referência como escrita (sem caractere de controle), nas lacunas de referência. */
  referencia: string | null;
  detalhe: string;
}

/** A decisão citada, conferida no ledger, com a citação que a captura do Brain grava (`source_ref`, `source_hash`). */
export interface DecisaoCitada {
  ref: string;
  thread: string;
  linha: number;
  tipo: TipoDeDecisao;
  fonte: string;
  sha256: string;
}

export interface DocumentoDeConhecimento {
  id: string;
  titulo: string;
  colecoes: string[];
  /** `brain` confere só pela forma nesta fatia (D5); `decisoes` confere no ledger canônico. */
  referencias: { brain: string[]; decisoes: DecisaoCitada[] };
  /** Caminho real do arquivo, relativo à raiz, com `/`. */
  arquivo: string;
  bytes: number;
  sha256: string;
}

export interface Conhecimento {
  contrato: typeof CONTRATO_CONHECIMENTO;
  /** A pasta como o manifesto declara; `null` sem declaração. */
  dir: string | null;
  documentos: DocumentoDeConhecimento[];
  colecoes: { nome: string; documentos: string[] }[];
  lacunas: LacunaDoConhecimento[];
}

const comparar = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ehMapa = (v: ValorYaml | undefined): v is { [k: string]: ValorYaml } => !!v && typeof v === 'object' && !Array.isArray(v);
/** Texto que veio do repositório, pronto para ir a uma lacuna: sem controle e curto. */
const semControle = (v: string, teto = 200) => v.replace(CONTROLES, '').slice(0, teto);
const relativo = (raizReal: string, abs: string) => path.relative(raizReal, abs).split(path.sep).join('/');
const LINK = 'link simbólico não é seguido; o documento é o arquivo versionado';

function lacuna(codigo: CodigoDeLacunaDoConhecimento, detalhe: string,
  onde: { arquivo?: string | null; documento?: string | null; referencia?: string | null } = {}): LacunaDoConhecimento {
  return { codigo, arquivo: onde.arquivo ?? null, documento: onde.documento ?? null,
    referencia: typeof onde.referencia === 'string' ? semControle(onde.referencia) : null, detalhe };
}

/**
 * D6: a pasta declarada, pelo caminho real. A forma recusa antes de tocar o disco (absoluta, `..`, `\`, controle,
 * a própria raiz, `.git` e `.orkastery`); o caminho real, com os links resolvidos, precisa ficar dentro da raiz.
 */
function pastaDoConhecimento(raiz: string, dir: string): { real: string; raizReal: string } | LacunaDoConhecimento {
  const segmentos = dir.split('/').filter((s) => s !== '' && s !== '.');
  if (path.isAbsolute(dir) || dir.includes('\\') || CONTROLE.test(dir) || !segmentos.length || segmentos.includes('..') ||
      PASTAS_RESERVADAS.includes(segmentos[0])) {
    return lacuna('conhecimento.dir-invalido', 'conhecimento.dir precisa ser uma pasta relativa à raiz, sem "..", ' +
      'fora de .git e .orkastery, como docs/conhecimento; nada foi lido');
  }
  const raizReal = fs.realpathSync(raiz);
  let real: string;
  try { real = fs.realpathSync(path.join(raizReal, ...segmentos)); }
  catch { return lacuna('conhecimento.dir-ausente', 'a pasta de conhecimento.dir não existe'); }
  const rel = path.relative(raizReal, real);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return lacuna('conhecimento.dir-fora-da-raiz', 'pelo caminho real (links resolvidos), conhecimento.dir sai da raiz ' +
      'do projeto; o manifesto vem com o repositório e não escolhe caminho fora dela; nada foi lido');
  }
  if (rel === '' || PASTAS_RESERVADAS.includes(rel.split(path.sep)[0]) || CONTROLE.test(rel)) {
    return lacuna('conhecimento.dir-invalido', 'pelo caminho real, conhecimento.dir é a própria raiz, cai em .git ou ' +
      '.orkastery, ou tem caractere de controle; nada foi lido');
  }
  if (!fs.statSync(real, { throwIfNoEntry: false })?.isDirectory()) return lacuna('conhecimento.dir-ausente', 'conhecimento.dir não é uma pasta');
  return { real, raizReal };
}

interface Candidato { abs: string; arquivo: string; st: fs.Stats; }

/**
 * Varre a pasta sem seguir link (D6) e sem ler entrada oculta (D8). Devolve os candidatos a documento, ou o
 * detalhe do teto estourado (D7), que falha fechado.
 */
function varrer(real: string, raizReal: string, limites: LimitesDoConhecimento, lacunas: LacunaDoConhecimento[]):
  Candidato[] | { teto: string } {
  const candidatos: Candidato[] = [];
  const pilha = [{ abs: real, profundidade: 0 }];
  let entradas = 0;
  while (pilha.length) {
    const atual = pilha.pop()!;
    let nomes: Buffer[];
    try { nomes = fs.readdirSync(atual.abs, { encoding: 'buffer' }).sort(Buffer.compare); }
    catch {
      lacunas.push(lacuna('documento.nao-regular', 'a pasta não abriu para leitura; o que está nela não foi lido',
        { arquivo: relativo(raizReal, atual.abs) }));
      continue;
    }
    for (const bruto of nomes) {
      if (bruto[0] === 0x2e) continue;
      if (++entradas > limites.entradas) return { teto: `a pasta passa de ${limites.entradas} entradas` };
      const nome = bruto.toString('utf8');
      if (!Buffer.from(nome, 'utf8').equals(bruto) || CONTROLE.test(nome)) {
        lacunas.push(lacuna('documento.nome-invalido', 'nome fora de UTF-8 ou com caractere de controle; não foi lido',
          { arquivo: relativo(raizReal, path.join(atual.abs, nome.replace(CONTROLES, '?'))) }));
        continue;
      }
      const abs = path.join(atual.abs, nome), arquivo = relativo(raizReal, abs);
      const st = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isSymbolicLink()) { lacunas.push(lacuna('documento.link', LINK, { arquivo })); continue; }
      if (st.isDirectory()) {
        if (atual.profundidade + 1 > limites.profundidade) return { teto: `a pasta passa de ${limites.profundidade} níveis` };
        // Uma pasta trocada por link entre a listagem e a leitura não leva a varredura para fora.
        let realDaPasta: string | null;
        try { realDaPasta = fs.realpathSync(abs); } catch { realDaPasta = null; }
        if (realDaPasta !== abs) { lacunas.push(lacuna('documento.link', LINK, { arquivo })); continue; }
        pilha.push({ abs, profundidade: atual.profundidade + 1 });
        continue;
      }
      if (!ehPaginaDeDocs(nome)) continue;
      if (!st.isFile()) { lacunas.push(lacuna('documento.nao-regular', 'não é arquivo comum; não foi lido', { arquivo })); continue; }
      candidatos.push({ abs, arquivo, st });
    }
  }
  return candidatos;
}

/**
 * Lê um arquivo comum sem seguir link (`O_NOFOLLOW`) e sem travar em FIFO (`O_NONBLOCK`), conferindo que é o
 * mesmo do `lstat` e que cabe no teto. Devolve os bytes ou o motivo.
 */
function lerArquivo(abs: string, st: fs.Stats, teto: number): Buffer | 'link' | 'nao-regular' | 'grande' {
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ELOOP' ? 'link' : 'nao-regular'; }
  try {
    const f = fs.fstatSync(fd);
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino) return 'nao-regular';
    if (f.size > teto) return 'grande';
    const bytes = Buffer.alloc(f.size + 1);
    let lidos = 0, n: number;
    while (lidos < bytes.length && (n = fs.readSync(fd, bytes, lidos, bytes.length - lidos, null)) > 0) lidos += n;
    return lidos === f.size ? bytes.subarray(0, lidos) : 'nao-regular';
  } finally { fs.closeSync(fd); }
}

/**
 * Valor de lista do frontmatter: lista de textos ou um texto só. Inteiro vira texto, sem perda; nulo, booleano
 * e decimal (o `yes` que o YAML lê como `true`, a vírgula sobrando que vira nulo) recusam em vez de virar texto.
 */
function lista(v: ValorYaml | undefined): string[] | null {
  if (v === undefined || v === null) return [];
  const itens: string[] = [];
  for (const b of Array.isArray(v) ? v : [v]) {
    if (typeof b === 'string') itens.push(b);
    else if (typeof b === 'number' && Number.isSafeInteger(b)) itens.push(String(b));
    else return null;
  }
  return itens;
}

interface Valido { id: string; titulo: string; colecoes: string[]; brain: string[]; decisoes: string[]; }

/** D2 e D3: o frontmatter vale inteiro ou devolve a lacuna do primeiro problema, com o id quando ele já vale. */
function validarFrontmatter(dados: ValorYaml, arquivo: string): Valido | LacunaDoConhecimento {
  if (!ehMapa(dados)) return lacuna('documento.frontmatter-invalido', 'o frontmatter precisa ser um mapa de chaves', { arquivo });
  const id = typeof dados.id === 'string' && ID_DE_DOCUMENTO.test(dados.id) ? dados.id : null;
  if (!id) {
    return lacuna('documento.id-invalido', 'id precisa ser doc- seguido de 3 a 48 letras minúsculas, números ou hífens, ' +
      'começando por letra ou número', { arquivo });
  }
  const onde = { arquivo, documento: id };
  const estranhas = Object.keys(dados).filter((k) => !CHAVES_DO_DOCUMENTO.includes(k));
  if (estranhas.length) {
    return lacuna('documento.chave-desconhecida', `chave fora do contrato: ${estranhas.map((k) => JSON.stringify(semControle(k, 40))).join(', ')} ` +
      `(o frontmatter tem só ${CHAVES_DO_DOCUMENTO.join(', ')})`, onde);
  }
  const titulo = typeof dados.titulo === 'string' ? dados.titulo.trim() : '';
  if (!titulo || titulo.length > LIMITE_DO_TITULO || CONTROLE.test(titulo)) {
    return lacuna('documento.titulo-invalido', `titulo precisa ser texto de 1 a ${LIMITE_DO_TITULO} caracteres, ` +
      'sem caractere de controle', onde);
  }
  const colecoes = lista(dados.colecoes);
  if (!colecoes || !colecoes.length || colecoes.length > COLECOES_POR_DOCUMENTO ||
      colecoes.some((c) => !NOME_DE_COLECAO.test(c)) || new Set(colecoes).size !== colecoes.length) {
    return lacuna('documento.colecoes-invalidas', `colecoes precisa listar de 1 a ${COLECOES_POR_DOCUMENTO} nomes ` +
      'de 1 a 48 letras minúsculas, números ou hífens, sem repetir', onde);
  }
  const refs = dados.referencias ?? null;
  const brain = ehMapa(refs) ? lista(refs.brain) : [], decisoes = ehMapa(refs) ? lista(refs.decisoes) : [];
  if ((refs !== null && !ehMapa(refs)) || (ehMapa(refs) && Object.keys(refs).some((k) => !CHAVES_DAS_REFERENCIAS.includes(k))) ||
      !brain || brain.length > REFERENCIAS_POR_LISTA || !decisoes || decisoes.length > REFERENCIAS_POR_LISTA) {
    return lacuna('documento.referencias-invalidas', 'referencias é um mapa só com brain e decisoes, cada uma uma lista ' +
      `de até ${REFERENCIAS_POR_LISTA} textos`, onde);
  }
  return { id, titulo, colecoes: [...colecoes].sort(comparar), brain: [...new Set(brain)], decisoes: [...new Set(decisoes)] };
}

type LinhasCitadas = { linhas: Map<number, string>; completas: number } | { motivo: string };

/**
 * As linhas citadas do ledger canônico de uma thread (D5). O ledger é lido como a captura do Brain o lê
 * (`readCycle`): só linhas completas, em UTF-8 exato, para o sha256 da linha ser o `source_hash` dela no Brain.
 * Cada ledger é lido uma vez, e só as linhas citadas ficam na memória.
 */
function linhasCitadas(raiz: string, thread: string, citadas: Set<number>, teto: number): LinhasCitadas {
  let arquivo: string;
  try { arquivo = path.join(dirThread(raiz, thread), 'ledger.jsonl'); }
  catch { return { motivo: 'a pasta da thread no estado do projeto é link ou fica fora da regra de id' }; }
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (!st) return { motivo: `a thread ${thread} não tem ledger neste projeto` };
  const bytes = lerArquivo(arquivo, st, teto);
  if (!Buffer.isBuffer(bytes)) return { motivo: `o ledger da thread ${thread} não é arquivo comum de até ${teto / 1024 / 1024} MiB` };
  const fim = bytes.lastIndexOf(10) + 1;
  const completo = bytes.subarray(0, fim).toString('utf8');
  if (!Buffer.from(completo, 'utf8').equals(bytes.subarray(0, fim))) return { motivo: `o ledger da thread ${thread} não é UTF-8` };
  const todas = completo.split('\n').slice(0, -1);
  const linhas = new Map<number, string>();
  for (const n of citadas) if (n <= todas.length) linhas.set(n, todas[n - 1]);
  return { linhas, completas: todas.length };
}

/** D5: a referência `thread#linha` confere quando a linha completa existe, é da thread e é uma decisão. */
function conferirDecisao(ref: string, ledgers: Map<string, LinhasCitadas>): DecisaoCitada | { codigo: CodigoDeLacunaDoConhecimento; detalhe: string } {
  const m = REFERENCIA_DE_DECISAO.exec(ref);
  if (!m) return { codigo: 'referencia.invalida', detalhe: 'decisão é <thread>#<linha>, com o id da thread e a linha do ledger a partir de 1' };
  const thread = m[1], linha = Number(m[2]);
  const ledger = ledgers.get(thread)!;
  if ('motivo' in ledger) return { codigo: 'referencia.decisao-ausente', detalhe: ledger.motivo };
  const bruta = ledger.linhas.get(linha);
  if (bruta === undefined) {
    return { codigo: 'referencia.decisao-ausente', detalhe: `o ledger da thread ${thread} tem ${ledger.completas} linha(s) completa(s)` };
  }
  let evento: { thread?: unknown; tipo?: unknown } | null = null;
  try {
    const lido: unknown = JSON.parse(bruta);
    if (lido && typeof lido === 'object' && !Array.isArray(lido)) evento = lido;
  } catch { /* linha que não é JSON não é decisão */ }
  const onde = `a linha ${linha} do ledger da thread ${thread}`;
  if (!evento) return { codigo: 'referencia.nao-e-decisao', detalhe: `${onde} não é um evento JSON` };
  if (evento.thread !== thread) return { codigo: 'referencia.nao-e-decisao', detalhe: `${onde} é de outra thread` };
  const tipo = TIPOS_DE_DECISAO.find((t) => t === evento?.tipo);
  if (!tipo) {
    const visto = typeof evento.tipo === 'string' && /^[a-z_]{1,40}$/.test(evento.tipo) ? evento.tipo : 'sem tipo conhecido';
    return { codigo: 'referencia.nao-e-decisao', detalhe: `${onde} é ${visto}, não decisão (${TIPOS_DE_DECISAO.join(', ')})` };
  }
  return { ref, thread, linha, tipo, fonte: `threads/${thread}/ledger.jsonl#L${linha}`, sha256: bytesHash(bruta) };
}

/**
 * Lê o conhecimento declarado no manifesto: documentos válidos, coleções e lacunas, tudo em ordem estável.
 * Nunca lança por causa do conteúdo do repositório; o que não vale vira lacuna tipada.
 */
export function lerConhecimento(c: ManifestoCarregado, limites: LimitesDoConhecimento = LIMITES_DO_CONHECIMENTO): Conhecimento {
  const declarado = c.manifesto.conhecimento?.dir ?? null;
  const dir = declarado === null ? null : semControle(declarado);
  const so = (l: LacunaDoConhecimento): Conhecimento => ({ contrato: CONTRATO_CONHECIMENTO, dir, documentos: [], colecoes: [], lacunas: [l] });
  if (declarado === null) return so(lacuna('conhecimento.nao-declarado', 'o orkastery.yaml não declara conhecimento.dir'));
  const pasta = pastaDoConhecimento(c.raiz, declarado);
  if ('codigo' in pasta) return so(pasta);
  const teto = (detalhe: string) => so(lacuna('conhecimento.limite', `${detalhe}; nenhum documento foi devolvido`));

  const lacunas: LacunaDoConhecimento[] = [];
  const candidatos = varrer(pasta.real, pasta.raizReal, limites, lacunas);
  if (!Array.isArray(candidatos)) return teto(candidatos.teto);

  const decodificador = new TextDecoder('utf-8', { fatal: true });
  const validos: (Valido & { arquivo: string; bytes: number; sha256: string })[] = [];
  let total = 0;
  for (const { abs, arquivo, st } of candidatos) {
    const bytes = lerArquivo(abs, st, limites.bytesPorDocumento);
    if (bytes === 'link') { lacunas.push(lacuna('documento.link', LINK, { arquivo })); continue; }
    if (bytes === 'nao-regular') {
      lacunas.push(lacuna('documento.nao-regular', 'não abriu como arquivo comum, ou mudou durante a leitura', { arquivo }));
      continue;
    }
    if (bytes === 'grande') {
      lacunas.push(lacuna('documento.grande-demais', `o documento passa de ${limites.bytesPorDocumento / 1024} KiB`, { arquivo }));
      continue;
    }
    total += bytes.length;
    if (total > limites.bytesNoTotal) return teto(`os documentos passam de ${limites.bytesNoTotal / 1024 / 1024} MiB no total`);
    let texto: string;
    try { texto = decodificador.decode(bytes); }
    catch { lacunas.push(lacuna('documento.codificacao', 'o arquivo não é UTF-8', { arquivo })); continue; }
    const { bruto } = separarFrontmatter(texto);
    if (bruto === null) {
      lacunas.push(lacuna('documento.sem-frontmatter', 'o arquivo não começa com o frontmatter entre duas linhas ---', { arquivo }));
      continue;
    }
    if (Buffer.byteLength(bruto, 'utf8') > limites.bytesDoFrontmatter) {
      lacunas.push(lacuna('documento.frontmatter-invalido', `o frontmatter passa de ${limites.bytesDoFrontmatter / 1024} KiB`, { arquivo }));
      continue;
    }
    let dados: ValorYaml;
    try { dados = lerYaml(bruto, { estrito: true }); }
    catch (e) { lacunas.push(lacuna('documento.frontmatter-invalido', semControle((e as Error).message), { arquivo })); continue; }
    const v = validarFrontmatter(dados, arquivo);
    if ('codigo' in v) { lacunas.push(v); continue; }
    validos.push({ ...v, arquivo, bytes: bytes.length, sha256: bytesHash(bytes) });
  }

  // D4: id repetido não escolhe arquivo; todos os documentos com ele saem da resposta.
  const porId = new Map<string, number>();
  for (const v of validos) porId.set(v.id, (porId.get(v.id) ?? 0) + 1);
  const unicos = validos.filter((v) => {
    const vezes = porId.get(v.id)!;
    if (vezes > 1) {
      lacunas.push(lacuna('documento.id-repetido', `o id aparece em ${vezes} arquivos; nenhum deles vale até sobrar um`,
        { arquivo: v.arquivo, documento: v.id }));
    }
    return vezes === 1;
  });

  // D5: cada ledger citado é lido uma vez, com as linhas que os documentos válidos pedem.
  const citadas = new Map<string, Set<number>>();
  for (const v of unicos) for (const ref of v.decisoes) {
    const m = REFERENCIA_DE_DECISAO.exec(ref);
    if (m) citadas.set(m[1], (citadas.get(m[1]) ?? new Set<number>()).add(Number(m[2])));
  }
  const ledgers = new Map<string, LinhasCitadas>();
  for (const [thread, linhas] of citadas) ledgers.set(thread, linhasCitadas(c.raiz, thread, linhas, limites.bytesDoLedger));

  const documentos: DocumentoDeConhecimento[] = [];
  for (const v of unicos) {
    const onde = { arquivo: v.arquivo, documento: v.id };
    const brain: string[] = [], decisoes: DecisaoCitada[] = [];
    for (const referencia of v.brain) {
      if (ID_DE_ENTIDADE.test(referencia)) brain.push(referencia);
      else lacunas.push(lacuna('referencia.invalida', 'id do Brain é prod-, proj- ou init-, na regra dos ids do portfólio', { ...onde, referencia }));
    }
    for (const referencia of v.decisoes) {
      const r = conferirDecisao(referencia, ledgers);
      if ('codigo' in r) lacunas.push(lacuna(r.codigo, r.detalhe, { ...onde, referencia }));
      else decisoes.push(r);
    }
    documentos.push({ id: v.id, titulo: v.titulo, colecoes: v.colecoes,
      referencias: { brain: brain.sort(comparar), decisoes: decisoes.sort((a, b) => comparar(a.thread, b.thread) || a.linha - b.linha) },
      arquivo: v.arquivo, bytes: v.bytes, sha256: v.sha256 });
  }

  const colecoes = new Map<string, string[]>();
  for (const d of documentos) for (const nome of d.colecoes) {
    const ids = colecoes.get(nome) ?? [];
    ids.push(d.id);
    colecoes.set(nome, ids);
  }
  return {
    contrato: CONTRATO_CONHECIMENTO, dir,
    documentos: documentos.sort((a, b) => comparar(a.id, b.id)),
    colecoes: [...colecoes].map(([nome, ids]) => ({ nome, documentos: ids.sort(comparar) })).sort((a, b) => comparar(a.nome, b.nome)),
    lacunas: lacunas.sort((a, b) => comparar(a.arquivo ?? '', b.arquivo ?? '') || comparar(a.codigo, b.codigo) ||
      comparar(a.referencia ?? '', b.referencia ?? '')),
  };
}
