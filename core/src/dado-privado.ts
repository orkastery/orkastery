/**
 * RM-062 (F1 e F2): a barreira de dado privado do repositório público.
 *
 * Nada privado do dono entra no repositório: nem em linha, nem em nome de arquivo, nem no bundle de CI. A varredura
 * procura três padrões genéricos (caminho de home, e-mail fora da lista permitida e hostname no formato de máquina) e
 * os termos de uma lista local que mora fora do git. O relatório diz arquivo, linha, coluna e o nome do padrão, nunca
 * o valor casado: relatório que repete o termo é um segundo vazamento (a mesma regra de `procurarSegredos`).
 *
 * - O que é exemplo inventado entra nas exceções versionadas (`orkastery.privado.json`), revisadas em PR (D4).
 * - A lista local (`termos-privados.txt`) fica na pasta do usuário do `ork` e na `.orkastery/` do projeto, ou no
 *   caminho de `ORK_TERMOS_PRIVADOS` (D5). Ausente, como no CI, os padrões genéricos continuam valendo, e a saída diz.
 * - Exceção nunca vale para a lista local.
 * - Nome de arquivo também é conteúdo: o caminho de um arquivo com achado no nome sai com o trecho trocado por
 *   `[omitido]` em todo lugar onde aparece (D8).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from './util';
import { pastaDoUsuario } from './maquina';
import { raizDoEstado } from './estado-thread';
import type { ManifestoCarregado } from './manifest';
import { avaliarPolicies, FatosDoDadoPrivado, severidadeDeclarada, ViolacaoDePolicy } from './policies';
import type { Thread } from './types';

export const CONTRATO_DAS_EXCECOES = 'ork.privado/v1' as const;
export const CONTRATO_DA_VARREDURA = 'ork.privado-varredura/v1' as const;
/** O arquivo versionado de exceções e e-mails permitidos, na raiz do repositório. */
export const ARQUIVO_DAS_EXCECOES = 'orkastery.privado.json';
/** O nome do arquivo da lista local, na pasta do usuário do `ork` e na `.orkastery/` do projeto. */
export const ARQUIVO_DA_LISTA_LOCAL = 'termos-privados.txt';
/** Com ela, a lista local é só o arquivo que ela aponta. */
export const VARIAVEL_DA_LISTA_LOCAL = 'ORK_TERMOS_PRIVADOS';
/** Termo mais curto que isso casaria em quase toda linha: é ignorado e contado. */
export const MENOR_TERMO = 3;
export const OMITIDO = '[omitido]';

export type PadraoGenerico = 'home' | 'email' | 'hostname';
export type Padrao = PadraoGenerico | 'lista-local';
export const PADROES_GENERICOS: readonly PadraoGenerico[] = ['home', 'email', 'hostname'];

/** Um achado, sem o valor casado. */
export interface Achado {
  /** O caminho relativo, com cada trecho casado no nome trocado por `[omitido]`. */
  arquivo: string;
  /** 1-based; `null` quando o achado é o nome do arquivo. */
  linha: number | null;
  coluna: number | null;
  padrao: Padrao;
  /** Só na lista local: a posição do termo na lista lida, de 1 em diante. */
  termo?: number;
}

export interface Excecao {
  padrao: PadraoGenerico;
  /** Glob relativo à raiz (`**` cruza pastas, `*` não). */
  caminho?: string;
  /** O trecho exato, sem diferença de caixa, ou com `*` como curinga estreito. */
  valor: string;
  motivo: string;
}

export interface EmailPermitido {
  /** Endereço exato. Curinga não é aceito. */
  valor: string;
  motivo: string;
}

export interface ArquivoDeExcecoes {
  presente: boolean;
  emailsPermitidos: EmailPermitido[];
  excecoes: Excecao[];
}

export interface ListaLocal {
  /** Pelo menos um arquivo da lista foi lido. */
  presente: boolean;
  /** Onde a lista foi procurada, com `~` no lugar da pasta pessoal. */
  procurada: string[];
  /** Os arquivos lidos, na mesma forma. */
  lidos: string[];
  /** Os termos, em minúsculas e sem repetição. Nunca saem daqui. */
  termos: string[];
  /** Termos curtos demais (menos de `MENOR_TERMO` caracteres), ignorados. */
  ignorados: number;
  /** Arquivos da lista que o git versiona dentro do repositório varrido (relativos à raiz). */
  versionados: string[];
  /** Recusa segura da lista; nunca inclui caminho nem conteúdo. */
  recusada: string | null;
}

export interface ContextoDaVarredura {
  /** A raiz do repositório varrido (o checkout do CI, a worktree da thread). */
  raiz: string;
  excecoes: ArquivoDeExcecoes;
  lista: ListaLocal;
}

export type EscopoDaVarredura =
  | { tipo: 'arvore' }
  /** `ref` é de onde veio a base (`origin/main`, `main`); `null` é o commit carimbado da thread. */
  | { tipo: 'diff'; base: string; ref: string | null }
  | { tipo: 'texto'; nome: string };

export interface Varredura {
  schema: typeof CONTRATO_DA_VARREDURA;
  escopo: EscopoDaVarredura[];
  /** Arquivos cujo conteúdo foi lido, inclusive binários. */
  arquivos: number;
  /** Linhas lidas: as do arquivo inteiro na árvore; as acrescentadas no diff. */
  linhas: number;
  /** Nomes de arquivo varridos. */
  nomes: number;
  listaLocal: { presente: boolean; procurada: string[]; lidos: string[]; termos: number; ignorados: number };
  excecoes: { arquivo: string | null; total: number; emailsPermitidos: number; semUso: string[] };
  achados: Achado[];
  /** O arquivo de exceções fora do contrato, a lista local versionada ou o git que não respondeu: nada foi varrido. */
  erro: string | null;
}

// ---------------------------------------------------------------------------
// Os padrões genéricos (D9)
// ---------------------------------------------------------------------------

/**
 * Caminho de home: `/home/<usuário>` e `/Users/<usuário>`, também escapado (`\/home\/x` numa regex, `\\/home\\/x` no
 * JSON dela), `/var/home/<usuário>` e `C:\Users\<usuário>`. O usuário aceita letra com acento; o marcador `<usuário>`
 * não casa. Colado a letra, dígito ou ponto (`https://site.com/home/pagina`, `app/home/page.tsx`, a casa falsa em
 * `/tmp/ensaio/home/x`), é trecho de URL ou de outro caminho.
 */
const HOME = /(?:(?<=\/var)|(?<![\p{L}\p{N}._-]))(?:\\*\/)+(home|Users)(?:\\*\/)+([\p{L}\p{N}._-]+)|\b([A-Za-z]):\\{1,2}Users\\{1,2}([\p{L}\p{N}._-]+)/gu;
/** Usuários de sistema e marcadores que não dizem de quem é a máquina. */
const USUARIOS_GENERICOS = new Set(['user', 'usuario', 'usuário', 'username', 'runner', 'ubuntu', 'node', 'git']);

/**
 * E-mail: o endereço inteiro, com domínio de letras. O lookbehind tira o que vem logo depois de `\` (o `\n@app.get`
 * de um JSON), de `@` e do meio de outro endereço. `/` e `:` são prefixos válidos; credenciais de URL são
 * reconhecidas pela autoridade completa, não pelo caractere anterior.
 */
const EMAIL = /(?<![A-Za-z0-9._%+\-\\@])([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63})(?![A-Za-z0-9-])/g;
/** RFC 2606 e RFC 6761: domínios reservados para exemplo e teste. */
const DOMINIOS_DE_EXEMPLO = ['example.com', 'example.net', 'example.org'];
const TLDS_DE_EXEMPLO = new Set(['example', 'invalid', 'test', 'localhost']);

/** Hostname no formato de máquina: o hostname que não segue formato nenhum é da lista local. */
const HOSTNAMES: readonly RegExp[] = [
  // Nome de máquina pessoal: `<nome>-pc`, `<nome>-laptop`, `<nome>-macbook-pro`... (os exemplos daqui usam marcador,
  // para o comentário não casar com a própria regra).
  /\b[a-z0-9]+(?:-[a-z0-9]+)*-(?:pc|laptop|desktop|notebook|workstation|thinkpad|macbook(?:-pro|-air)?|imac|mac-mini|mac-studio)\b/gi,
  // Padrões de fábrica do Windows.
  /\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{6,10}\b/g,
  /\bWIN-[A-Z0-9]{8,15}\b/g,
  // AWS (`ip-` com os quatro números do IP), VPS (`vps-` com 8 hexadecimais, `srv` ou `vmi` com 5 dígitos ou mais) e
  // DigitalOcean (`ubuntu-s-` com o tamanho da máquina).
  /\bip-(?:\d{1,3}-){3}\d{1,3}\b/g,
  /\bvps-[0-9a-f]{8}\b/gi,
  /\b(?:srv|vmi)\d{5,}\b/gi,
  /\bubuntu-s-\d+vcpu-\d+gb-[a-z0-9-]+\b/gi,
  // O formato `srv` + letras + dígitos (o nome de servidor com as iniciais de alguém).
  /\bsrv[a-z]{2,10}\d{1,4}\b/gi,
];

/** Um trecho casado, ainda com o valor: nunca sai deste módulo. */
interface Casamento { inicio: number; fim: number; padrao: Padrao; valor: string; termo?: number }

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `*` casa qualquer sequência; sem diferença de caixa. */
function curingaCasa(padrao: string, valor: string): boolean {
  return new RegExp(`^${padrao.split('*').map(escaparRegex).join('.*')}$`, 'iu').test(valor);
}

/** Glob de caminho: `**` cruza pastas, `*` e `?` não. */
function globCasa(glob: string, caminho: string): boolean {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escaparRegex(c);
  }
  return new RegExp(`^${re}$`, 'u').test(caminho);
}

/**
 * Amostras distintas de cada família que uma exceção não pode cobrir inteira. O teste é pelo efeito do curinga, não
 * pela grafia: `**`, `*@*`, `/home/*` e formas equivalentes caem na mesma regra.
 */
const FAMILIAS_DE_VALORES: Record<PadraoGenerico, readonly (readonly string[])[]> = {
  home: [
    ['/home/' + 'pessoa-a', '/home/' + 'pessoa-longa'],
    ['/Users/' + 'pessoa-a', '/Users/' + 'pessoa-longa'],
    ['C:\\Users\\' + 'pessoa-a', 'C:\\Users\\' + 'pessoa-longa'],
  ],
  email: [['a' + '@dominio-a.com', 'nome.sobrenome+tag' + '@sub.dominio-b.org']],
  hostname: [['pessoa-a-' + 'pc', 'DESKTOP-' + 'AB12CD3', 'ip-' + '10-0-1-23', 'srv' + 'abc42']],
};

function valorEquivaleACuringaGlobal(padrao: PadraoGenerico, valor: string): boolean {
  return FAMILIAS_DE_VALORES[padrao].some((familia) => familia.every((amostra) => curingaCasa(valor, amostra)));
}

function caminhoEquivaleACuringaGlobal(caminho: string): boolean {
  return ['arquivo.txt', 'pasta/arquivo.txt', 'pasta/interna/arquivo.txt'].every((amostra) => globCasa(caminho, amostra));
}

function emailDeExemplo(dominio: string): boolean {
  const d = dominio.toLowerCase();
  if (DOMINIOS_DE_EXEMPLO.some((e) => d === e || d.endsWith(`.${e}`))) return true;
  return TLDS_DE_EXEMPLO.has(d.slice(d.lastIndexOf('.') + 1));
}

/** O endereço começa na autoridade de uma URL, antes do caminho, query, fragmento ou delimitador do documento. */
function naAutoridadeDeUrl(texto: string, inicio: number): boolean {
  const antes = texto.slice(Math.max(0, inicio - 512), inicio);
  const separador = antes.lastIndexOf('://');
  if (separador < 0) return false;
  const prefixo = antes.slice(0, separador);
  if (!/(?:^|[^a-z0-9+.-])[a-z][a-z0-9+.-]*$/i.test(prefixo)) return false;
  const autoridade = antes.slice(separador + 3);
  return !/[\s/?#"'<>\[\]{},]/u.test(autoridade);
}

/** Os casamentos dos padrões genéricos e da lista local num texto, antes das exceções. */
function casamentos(texto: string, termos: readonly RegExp[]): Casamento[] {
  const achados: Casamento[] = [];
  for (const m of texto.matchAll(HOME)) {
    const raizDoCaminho = m[1] ?? null;
    const usuario = (m[2] ?? m[4] ?? '').replace(/[._-]+$/, '');
    // Pasta oculta direto na raiz das casas (`/home/.cache`) não é usuário.
    if (!usuario || usuario.startsWith('.') || USUARIOS_GENERICOS.has(usuario.toLowerCase())) continue;
    const valor = raizDoCaminho ? `/${raizDoCaminho}/${usuario}` : `${m[3]}:\\Users\\${usuario}`;
    achados.push({ inicio: m.index!, fim: m.index! + m[0].length, padrao: 'home', valor });
  }
  for (const m of texto.matchAll(EMAIL)) {
    const inicio = m.index!;
    // Na autoridade de uma URL (`ssh://x=u@host/`, `git+ssh://u:1#t@host/`), o `@` separa a credencial do host.
    if (naAutoridadeDeUrl(texto, inicio)) continue;
    // `git@host` e `usuario@host:caminho` são remotos SSH, não o endereço de alguém.
    const depois = texto.slice(inicio + m[0].length, inicio + m[0].length + 2);
    if (m[1].toLowerCase() === 'git' || /^:[^\s]/.test(depois)) continue;
    if (emailDeExemplo(m[2])) continue;
    achados.push({ inicio, fim: inicio + m[0].length, padrao: 'email', valor: m[0] });
  }
  for (const re of HOSTNAMES) {
    for (const m of texto.matchAll(re)) {
      achados.push({ inicio: m.index!, fim: m.index! + m[0].length, padrao: 'hostname', valor: m[0] });
    }
  }
  termos.forEach((termo, i) => {
    for (const m of texto.matchAll(termo)) {
      achados.push({ inicio: m.index!, fim: m.index! + m[0].length, padrao: 'lista-local', valor: m[0], termo: i + 1 });
    }
  });
  // O mesmo trecho achado por dois padrões de hostname conta uma vez.
  const vistos = new Set<string>();
  return achados.filter((a) => {
    const chave = `${a.inicio}:${a.padrao}:${a.termo ?? ''}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  }).sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
}

// ---------------------------------------------------------------------------
// As exceções versionadas (D4)
// ---------------------------------------------------------------------------

/** O uso das exceções numa varredura, para dizer as que não cobriram nada. */
class UsoDasExcecoes {
  readonly excecoes = new Set<number>();
  readonly emails = new Set<number>();
}

/**
 * Lê o `orkastery.privado.json` da raiz. Ausente, nenhuma exceção (só as regras do código). Fora do contrato, o erro
 * com o motivo: a varredura não roda com exceção que ninguém sabe o que cobre.
 */
export function lerExcecoes(raiz: string): { ok: true; valor: ArquivoDeExcecoes } | { ok: false; erro: string } {
  const arquivo = path.join(raiz, ARQUIVO_DAS_EXCECOES);
  if (!fs.existsSync(arquivo)) return { ok: true, valor: { presente: false, emailsPermitidos: [], excecoes: [] } };
  const fora = (motivo: string) => ({ ok: false as const, erro: `${ARQUIVO_DAS_EXCECOES} fora do contrato ${CONTRATO_DAS_EXCECOES}: ${motivo}` });
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (e) { return fora(`não é JSON (${(e as Error).message})`); }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return fora('a raiz não é um objeto');
  const objeto = bruto as Record<string, unknown>;
  const estranhas = Object.keys(objeto).filter((k) => !['contrato', 'descricao', 'emailsPermitidos', 'excecoes'].includes(k));
  if (estranhas.length) return fora(`chave desconhecida: ${estranhas.join(', ')}`);
  if (objeto.contrato !== CONTRATO_DAS_EXCECOES) return fora(`"contrato" tem de ser "${CONTRATO_DAS_EXCECOES}"`);
  if (objeto.descricao !== undefined && typeof objeto.descricao !== 'string') return fora('"descricao" tem de ser texto');
  const emails = objeto.emailsPermitidos ?? [];
  if (!Array.isArray(emails)) return fora('"emailsPermitidos" tem de ser uma lista');
  const emailsPermitidos: EmailPermitido[] = [];
  for (const [i, e] of emails.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return fora(`emailsPermitidos[${i}] não é um objeto`);
    const x = e as Record<string, unknown>;
    const outras = Object.keys(x).filter((k) => !['valor', 'motivo'].includes(k));
    if (outras.length) return fora(`emailsPermitidos[${i}] tem chave desconhecida: ${outras.join(', ')}`);
    if (typeof x.valor !== 'string' || !/^[^\s@*]+@[^\s@*]+$/.test(x.valor)) {
      return fora(`emailsPermitidos[${i}].valor tem de ser endereço exato, sem curinga`);
    }
    if (typeof x.motivo !== 'string' || !x.motivo.trim()) return fora(`emailsPermitidos[${i}] sem motivo`);
    emailsPermitidos.push({ valor: x.valor, motivo: x.motivo.trim() });
  }
  const lista = objeto.excecoes ?? [];
  if (!Array.isArray(lista)) return fora('"excecoes" tem de ser uma lista');
  const excecoes: Excecao[] = [];
  for (const [i, e] of lista.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return fora(`excecoes[${i}] não é um objeto`);
    const x = e as Record<string, unknown>;
    const outras = Object.keys(x).filter((k) => !['padrao', 'caminho', 'valor', 'motivo'].includes(k));
    if (outras.length) return fora(`excecoes[${i}] tem chave desconhecida: ${outras.join(', ')}`);
    if (!PADROES_GENERICOS.includes(x.padrao as PadraoGenerico)) {
      return fora(`excecoes[${i}].padrao tem de ser ${PADROES_GENERICOS.join(', ')}`);
    }
    if (typeof x.motivo !== 'string' || !x.motivo.trim()) return fora(`excecoes[${i}] sem motivo`);
    for (const campo of ['caminho', 'valor'] as const) {
      if (x[campo] !== undefined && (typeof x[campo] !== 'string' || !(x[campo] as string).trim())) {
        return fora(`excecoes[${i}].${campo} tem de ser texto não vazio`);
      }
    }
    if (x.valor === undefined) return fora(`excecoes[${i}] sem valor/trecho`);
    if (x.valor === '*') return fora(`excecoes[${i}].valor não pode ser curinga global`);
    if (x.caminho === '**') return fora(`excecoes[${i}].caminho não pode ser curinga global`);
    if (valorEquivaleACuringaGlobal(x.padrao as PadraoGenerico, x.valor as string)) {
      return fora(`excecoes[${i}].valor equivale a curinga global para ${x.padrao}`);
    }
    if (x.caminho !== undefined && caminhoEquivaleACuringaGlobal(x.caminho as string)) {
      return fora(`excecoes[${i}].caminho equivale a curinga global`);
    }
    excecoes.push({ padrao: x.padrao as Excecao['padrao'], motivo: (x.motivo as string).trim(), valor: x.valor as string,
      ...(x.caminho !== undefined ? { caminho: x.caminho as string } : {}) });
  }
  return { ok: true, valor: { presente: true, emailsPermitidos, excecoes } };
}

/** O casamento genérico coberto pela lista de e-mails permitidos ou por uma exceção; marca o uso. */
function coberto(c: Casamento, arquivo: string, excecoes: ArquivoDeExcecoes, uso: UsoDasExcecoes): boolean {
  if (c.padrao === 'lista-local') return false;
  if (c.padrao === 'email') {
    const i = excecoes.emailsPermitidos.findIndex((e) => e.valor.toLowerCase() === c.valor.toLowerCase());
    if (i >= 0) { uso.emails.add(i); return true; }
  }
  const j = excecoes.excecoes.findIndex((e) => e.padrao === c.padrao
    && (e.caminho === undefined || globCasa(e.caminho, arquivo)) && curingaCasa(e.valor, c.valor));
  if (j >= 0) { uso.excecoes.add(j); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// A lista local (D5)
// ---------------------------------------------------------------------------

/** O arquivo `dentro` da raiz `raiz`, relativo a ela; `null` fora dela. */
function relativoDentro(raiz: string, dentro: string): string | null {
  let real: string;
  let base: string;
  try { real = fs.realpathSync(dentro); base = fs.realpathSync(raiz); } catch { return null; }
  const rel = path.relative(base, real);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
}

/**
 * Lê a lista local: com `ORK_TERMOS_PRIVADOS`, só o arquivo dela; sem ela, `termos-privados.txt` da pasta do usuário
 * do `ork` (`~/.orkastery/`) e da `.orkastery/` da raiz do estado do projeto. Um termo por linha, `#` comenta, sem
 * diferença de caixa. `raiz` é o repositório varrido: a lista que o git versiona nele volta em `versionados`.
 */
export function lerListaLocal(raizDoEstado: string | null, raiz: string | null = null,
  env: NodeJS.ProcessEnv = process.env): ListaLocal {
  const explicita = (env[VARIAVEL_DA_LISTA_LOCAL] ?? '').trim();
  const rotuloDaPastaDoUsuario = (env.ORK_USUARIO_DIR ?? '').trim()
    ? `ORK_USUARIO_DIR/${ARQUIVO_DA_LISTA_LOCAL}`
    : (env.ORKASTERY_HOME ?? '').trim()
      ? `ORKASTERY_HOME/${ARQUIVO_DA_LISTA_LOCAL}`
      : `~/.orkastery/${ARQUIVO_DA_LISTA_LOCAL}`;
  const candidatos = explicita
    ? [{ arquivo: path.resolve(explicita), rotulo: `arquivo indicado por ${VARIAVEL_DA_LISTA_LOCAL}` }]
    : [{ arquivo: path.join(pastaDoUsuario(env), ARQUIVO_DA_LISTA_LOCAL), rotulo: rotuloDaPastaDoUsuario },
      ...(raizDoEstado ? [{ arquivo: path.join(raizDoEstado, '.orkastery', ARQUIVO_DA_LISTA_LOCAL),
        rotulo: `.orkastery/${ARQUIVO_DA_LISTA_LOCAL}` }] : [])];
  const unicos = [...new Map(candidatos.map((c) => [c.arquivo, c])).values()];
  const termos: string[] = [];
  const lidos: string[] = [];
  const versionados: string[] = [];
  let recusada: string | null = null;
  let ignorados = 0;
  for (const candidato of unicos) {
    const { arquivo, rotulo } = candidato;
    let texto: string;
    let fd: number | null = null;
    try {
      const antes = fs.lstatSync(arquivo);
      if (antes.isSymbolicLink()) { recusada = `${rotulo} foi recusado: link simbólico não é aceito`; break; }
      if (!antes.isFile()) { recusada = `${rotulo} foi recusado: não é arquivo comum`; break; }
      fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const st = fs.fstatSync(fd);
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      if (!st.isFile()) { recusada = `${rotulo} foi recusado: não é arquivo comum`; break; }
      if (uid === null || st.uid !== uid) { recusada = `${rotulo} foi recusado: o dono não é o usuário atual`; break; }
      if ((st.mode & 0o777) !== 0o600) { recusada = `${rotulo} foi recusado: a permissão tem de ser 0600`; break; }
      texto = fs.readFileSync(fd, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      recusada = `${rotulo} foi recusado: não foi possível abrir com segurança`;
      break;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    lidos.push(rotulo);
    const rel = raiz ? relativoDentro(raiz, arquivo) : null;
    if (rel && exec('git', ['ls-files', '--error-unmatch', '--', rel], raiz!).ok) versionados.push(rel);
    for (const bruta of texto.split(/\r?\n/)) {
      const linha = bruta.trim();
      if (!linha || linha.startsWith('#')) continue;
      if ([...linha].length < MENOR_TERMO) { ignorados += 1; continue; }
      const termo = linha.toLowerCase();
      if (!termos.includes(termo)) termos.push(termo);
    }
  }
  return { presente: lidos.length > 0, procurada: unicos.map((c) => c.rotulo), lidos, termos,
    ignorados, versionados, recusada };
}

// ---------------------------------------------------------------------------
// A varredura
// ---------------------------------------------------------------------------

/** O contexto de uma varredura: as exceções da raiz varrida e a lista local. */
export function contextoDaVarredura(raiz: string, raizDoEstado: string | null,
  env: NodeJS.ProcessEnv = process.env): { ok: true; valor: ContextoDaVarredura } | { ok: false; erro: string; lista: ListaLocal } {
  const lista = lerListaLocal(raizDoEstado, raiz, env);
  const excecoes = lerExcecoes(raiz);
  if (!excecoes.ok) return { ok: false, erro: excecoes.erro, lista };
  if (lista.recusada) return { ok: false, erro: lista.recusada, lista };
  if (lista.versionados.length) {
    return { ok: false, lista, erro: `a lista local de termos privados está versionada (${lista.versionados.length} arquivo(s)): ` +
      'tire-a do git; ela nunca vai ao repositório' };
  }
  return { ok: true, valor: { raiz, excecoes: excecoes.valor, lista } };
}

/** Acumula os achados de uma varredura, com o caminho mascarado e o uso das exceções. */
class Coletor {
  readonly achados: Achado[] = [];
  readonly uso = new UsoDasExcecoes();
  arquivos = 0;
  linhas = 0;
  nomes = 0;

  /** Os termos da lista local como regex, compiladas uma vez por varredura. */
  private readonly termos: RegExp[];

  constructor(readonly contexto: ContextoDaVarredura) {
    this.termos = contexto.lista.termos.map((t) => new RegExp(escaparRegex(t), 'giu'));
  }

  /** Os casamentos que valem num texto do arquivo (o nome, uma linha ou o arquivo inteiro), depois das exceções. */
  private validos(texto: string, arquivo: string, comGenericos: boolean): Casamento[] {
    return casamentos(texto, this.termos).filter((c) => c.padrao === 'lista-local'
      || (comGenericos && !coberto(c, arquivo, this.contexto.excecoes, this.uso)));
  }

  /**
   * O caminho para o relatório: cada trecho casado no nome trocado por `[omitido]` (trechos que se encostam viram um
   * só). Varre o nome uma vez.
   */
  caminho(arquivo: string): { mostrado: string; achados: Casamento[] } {
    const achados = this.validos(arquivo, arquivo, true);
    let mostrado = '';
    let ate = 0;
    achados.forEach((c, i) => {
      if (i === 0 || c.inicio > ate) mostrado += arquivo.slice(ate, c.inicio) + OMITIDO;
      ate = Math.max(ate, c.fim);
    });
    return { mostrado: mostrado + arquivo.slice(ate), achados };
  }

  /** O nome do arquivo como achado. */
  nome(arquivo: string): string {
    this.nomes += 1;
    const { mostrado, achados } = this.caminho(arquivo);
    for (const c of achados) {
      this.achados.push({ arquivo: mostrado, linha: null, coluna: null, padrao: c.padrao, ...(c.termo ? { termo: c.termo } : {}) });
    }
    return mostrado;
  }

  /**
   * As linhas de um arquivo: `numeradas` são pares (número da linha, texto). O arquivo de exceções não passa pelos
   * padrões genéricos (ele lista o que é permitido), só pela lista local.
   */
  linhasDe(arquivo: string, mostrado: string, numeradas: Iterable<[number, string]>): void {
    const comGenericos = arquivo !== ARQUIVO_DAS_EXCECOES;
    for (const [numero, texto] of numeradas) {
      this.linhas += 1;
      for (const c of this.validos(texto, arquivo, comGenericos)) this.registrar(mostrado, numero, texto, 0, c);
    }
  }

  /**
   * O arquivo inteiro de uma vez (a árvore e os não rastreados): nenhum padrão atravessa a quebra de linha, e a
   * linha de cada casamento sai do índice dos inícios de linha.
   */
  arquivoInteiro(arquivo: string, mostrado: string, texto: string): void {
    const inicios = [0];
    for (let i = texto.indexOf('\n'); i >= 0; i = texto.indexOf('\n', i + 1)) inicios.push(i + 1);
    // A quebra no fim do arquivo não abre linha nova.
    this.linhas += texto.endsWith('\n') ? inicios.length - 1 : inicios.length;
    for (const c of this.validos(texto, arquivo, arquivo !== ARQUIVO_DAS_EXCECOES)) {
      let baixo = 0;
      let alto = inicios.length - 1;
      while (baixo < alto) {
        const meio = (baixo + alto + 1) >> 1;
        if (inicios[meio] <= c.inicio) baixo = meio; else alto = meio - 1;
      }
      this.registrar(mostrado, baixo + 1, texto, inicios[baixo], c);
    }
  }

  private registrar(mostrado: string, linha: number, texto: string, inicioDaLinha: number, c: Casamento): void {
    const coluna = [...texto.slice(inicioDaLinha, c.inicio)].length + 1;
    this.achados.push({ arquivo: mostrado, linha, coluna, padrao: c.padrao, ...(c.termo ? { termo: c.termo } : {}) });
  }

  resultado(escopo: EscopoDaVarredura[], erro: string | null = null): Varredura {
    const { excecoes, lista } = this.contexto;
    const semUso = [
      ...excecoes.excecoes.flatMap((e, i) => this.uso.excecoes.has(i) ? []
        : [`excecoes[${i}] ${e.padrao}`]),
      ...excecoes.emailsPermitidos.flatMap((_e, i) => this.uso.emails.has(i) ? [] : [`emailsPermitidos[${i}] email`]),
    ];
    return {
      schema: CONTRATO_DA_VARREDURA, escopo, arquivos: this.arquivos, linhas: this.linhas, nomes: this.nomes,
      listaLocal: resumoDaLista(lista),
      excecoes: { arquivo: excecoes.presente ? ARQUIVO_DAS_EXCECOES : null, total: excecoes.excecoes.length,
        emailsPermitidos: excecoes.emailsPermitidos.length, semUso },
      achados: this.achados, erro,
    };
  }
}

function resumoDaLista(lista: ListaLocal): Varredura['listaLocal'] {
  return { presente: lista.presente, procurada: lista.procurada, lidos: lista.lidos, termos: lista.termos.length,
    ignorados: lista.ignorados };
}

/** A varredura que não rodou: o motivo, sem achado. */
export function varreduraComErro(erro: string, lista: ListaLocal, escopo: EscopoDaVarredura[] = []): Varredura {
  return { schema: CONTRATO_DA_VARREDURA, escopo, arquivos: 0, linhas: 0, nomes: 0, listaLocal: resumoDaLista(lista),
    excecoes: { arquivo: null, total: 0, emailsPermitidos: 0, semUso: [] }, achados: [], erro };
}

/**
 * O conteúdo de um arquivo do repositório como texto, inclusive quando contém bytes nulos ou UTF-8 inválido. O link
 * simbólico é o alvo dele: o caminho para onde aponta também é conteúdo, e o link nunca é seguido.
 */
function conteudo(raiz: string, arquivo: string): string | null {
  const absoluto = path.join(raiz, arquivo);
  let st: fs.Stats;
  try { st = fs.lstatSync(absoluto); } catch { return null; }
  if (st.isSymbolicLink()) return fs.readlinkSync(absoluto);
  if (!st.isFile()) return null;
  return fs.readFileSync(absoluto).toString('utf8');
}

function listaZ(saida: string): string[] {
  return saida.split('\0').filter(Boolean);
}

/** F1: os nomes e o conteúdo dos arquivos versionados (`git ls-files`) da raiz. */
export function varrerArvore(contexto: ContextoDaVarredura): Varredura {
  const coletor = new Coletor(contexto);
  const escopo: EscopoDaVarredura[] = [{ tipo: 'arvore' }];
  const r = exec('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], contexto.raiz);
  if (!r.ok) return coletor.resultado(escopo, `git ls-files não respondeu em ${contexto.raiz}: ${r.stderr.trim() || r.code}`);
  for (const arquivo of listaZ(r.stdout)) {
    const mostrado = coletor.nome(arquivo);
    const texto = conteudo(contexto.raiz, arquivo);
    if (texto === null) continue;
    coletor.arquivos += 1;
    coletor.arquivoInteiro(arquivo, mostrado, texto);
  }
  return coletor.resultado(escopo);
}

/** O caminho do cabeçalho `+++ b/<caminho>` do diff, também entre aspas (o git as põe no nome com tab ou aspas). */
function caminhoDoCabecalho(resto: string): string | null {
  if (resto === '/dev/null') return null;
  if (resto.startsWith('"') && resto.endsWith('"')) {
    try { resto = JSON.parse(resto.replace(/\\([0-7]{3})/g, (_, o: string) => `\\u${Number.parseInt(o, 8).toString(16).padStart(4, '0')}`)); }
    catch { return null; }
  }
  return resto.replace(/^b\//, '');
}

/** As linhas acrescentadas de um `git diff --unified=0`, por arquivo, com o número da linha nova. */
function linhasAcrescentadas(saida: string): Map<string, [number, string][]> {
  const porArquivo = new Map<string, [number, string][]>();
  let arquivo: string | null = null;
  let cabecalho = false;
  let nova = 0;
  for (const l of saida.split('\n')) {
    if (l.startsWith('diff --git ')) { cabecalho = true; arquivo = null; continue; }
    // O `+++` só é o nome do arquivo no cabeçalho; dentro do hunk, é uma linha acrescentada que começa por "++".
    if (cabecalho && l.startsWith('+++ ')) { arquivo = caminhoDoCabecalho(l.slice(4)); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { nova = Number(h[1]); cabecalho = false; continue; }
    if (!cabecalho && arquivo && l.startsWith('+')) {
      if (!porArquivo.has(arquivo)) porArquivo.set(arquivo, []);
      porArquivo.get(arquivo)!.push([nova, l.slice(1)]);
      nova += 1;
    }
  }
  return porArquivo;
}

/**
 * F2: o diff da thread contra `base`: as linhas acrescentadas da árvore de trabalho (o que já foi commitado e o que
 * ainda não foi), os arquivos não rastreados inteiros e os nomes dos arquivos acrescentados e dos não rastreados. O
 * nome que já estava na base é da árvore, que o CI varre. `ignorar` tira caminhos (o bundle que o `ci prepare`
 * troca e varre pelo texto novo).
 */
export function varrerDiff(contexto: ContextoDaVarredura, base: BaseDoDiff,
  opcoes: { ignorar?: readonly string[] } = {}): Varredura {
  const coletor = new Coletor(contexto);
  const escopo: EscopoDaVarredura[] = [{ tipo: 'diff', base: base.sha, ref: base.ref }];
  const ignorar = new Set(opcoes.ignorar ?? []);
  const git = (args: string[]) => exec('git', ['-c', 'core.quotePath=false', ...args], contexto.raiz);
  const diff = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--unified=0', '--no-renames', base.sha, '--']);
  const novos = git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', base.sha, '--']);
  const soltos = git(['ls-files', '--others', '--exclude-standard', '-z']);
  const falhou = [diff, novos, soltos].find((r) => !r.ok);
  if (falhou) return coletor.resultado(escopo, `git não respondeu ao ler o diff contra ${base.sha.slice(0, 12)}: ${falhou.stderr.trim() || falhou.code}`);
  const mostrados = new Map<string, string>();
  const mostrar = (arquivo: string, comNome: boolean): string => {
    if (!mostrados.has(arquivo)) mostrados.set(arquivo, comNome ? coletor.nome(arquivo) : coletor.caminho(arquivo).mostrado);
    return mostrados.get(arquivo)!;
  };
  const naoRastreados = listaZ(soltos.stdout).filter((a) => !ignorar.has(a));
  for (const arquivo of [...listaZ(novos.stdout).filter((a) => !ignorar.has(a)), ...naoRastreados]) mostrar(arquivo, true);
  for (const [arquivo, linhas] of linhasAcrescentadas(diff.stdout)) {
    if (ignorar.has(arquivo)) continue;
    coletor.arquivos += 1;
    coletor.linhasDe(arquivo, mostrar(arquivo, false), linhas);
  }
  for (const arquivo of naoRastreados) {
    const texto = conteudo(contexto.raiz, arquivo);
    if (texto === null) continue;
    coletor.arquivos += 1;
    coletor.arquivoInteiro(arquivo, mostrar(arquivo, true), texto);
  }
  return coletor.resultado(escopo);
}

/** Um texto que ainda não está no disco (o bundle do `ci prepare`), varrido como o arquivo `nome`. */
export function varrerTexto(contexto: ContextoDaVarredura, nome: string, texto: string): Varredura {
  const coletor = new Coletor(contexto);
  coletor.arquivos += 1;
  coletor.arquivoInteiro(nome, coletor.caminho(nome).mostrado, texto);
  return coletor.resultado([{ tipo: 'texto', nome }]);
}

/** Duas varreduras do mesmo contexto numa só (o diff e o bundle do `ci prepare`). Exceção sem uso é a de nenhuma. */
export function juntarVarreduras(a: Varredura, b: Varredura): Varredura {
  const semUsoEmB = new Set(b.excecoes.semUso);
  return { ...a, escopo: [...a.escopo, ...b.escopo], arquivos: a.arquivos + b.arquivos, linhas: a.linhas + b.linhas,
    nomes: a.nomes + b.nomes, excecoes: { ...a.excecoes, semUso: a.excecoes.semUso.filter((s) => semUsoEmB.has(s)) },
    achados: [...a.achados, ...b.achados], erro: a.erro ?? b.erro };
}

const SHA = /^[0-9a-f]{40,64}$/;

/** A base do diff: o commit e de onde ele veio (`ref` da merge-base; `null` no commit carimbado da thread). */
export interface BaseDoDiff { sha: string; ref: string | null }

/** A merge-base de HEAD com `ref` (nome de branch ou de ref remota), ou `null` sem ela. */
export function mergeBase(cwd: string, ref: string): BaseDoDiff | null {
  if (!exec('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).ok) return null;
  const r = exec('git', ['merge-base', 'HEAD', ref], cwd);
  const sha = r.stdout.trim();
  return r.ok && SHA.test(sha) ? { sha, ref } : null;
}

/**
 * A base do diff da thread (D7): a merge-base de HEAD com `origin/<base>`, senão com a base local, senão o commit
 * carimbado na thread, se for ancestral de HEAD. `null` sem nenhuma: quem chama varre a árvore inteira e diz.
 */
export function baseDaThread(cwd: string, baseBranch: string, carimbada?: string | null): BaseDoDiff | null {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const qualificada = ref.startsWith('origin/') ? `refs/remotes/${ref}` : `refs/heads/${ref}`;
    if (!exec('git', ['rev-parse', '--verify', '--quiet', qualificada], cwd).ok) continue;
    const base = mergeBase(cwd, qualificada);
    if (base) return { sha: base.sha, ref };
  }
  if (carimbada && SHA.test(carimbada) && exec('git', ['merge-base', '--is-ancestor', carimbada, 'HEAD'], cwd).ok) {
    return { sha: carimbada, ref: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// O relatório (D8)
// ---------------------------------------------------------------------------

/** `arquivo:linha:coluna  padrão`, ou `arquivo  nome do arquivo: padrão`; o termo da lista sai pelo número. */
export function linhaDoAchado(a: Achado): string {
  const padrao = a.padrao === 'lista-local' ? `lista-local (termo ${a.termo})` : a.padrao;
  return a.linha === null ? `${a.arquivo}  nome do arquivo: ${padrao}` : `${a.arquivo}:${a.linha}:${a.coluna}  ${padrao}`;
}

/** O escopo em uma frase. */
export function textoDoEscopo(v: Varredura): string {
  const partes = v.escopo.map((e) => e.tipo === 'arvore' ? 'árvore versionada'
    : e.tipo === 'diff' ? `diff contra ${e.base.slice(0, 12)} (${e.ref ? `merge-base com ${e.ref}` : 'base carimbada da thread'})`
    : `texto de ${e.nome}`);
  return `${partes.join(' e ') || 'nada'}: ${v.arquivos} arquivo(s), ${v.linhas} linha(s), ${v.nomes} nome(s)`;
}

/** A lista local em uma frase, sem termo: ausente (e onde foi procurada) ou quantos termos de onde. */
export function textoDaListaLocal(v: Varredura): string {
  const l = v.listaLocal;
  const ignorados = l.ignorados ? `; ${l.ignorados} termo(s) curto(s) demais ignorado(s)` : '';
  return l.presente
    ? `${l.termos} termo(s) de ${l.lidos.join(' e ')}${ignorados}`
    : `ausente (procurada em ${l.procurada.join(' e ')}); só os padrões genéricos (${PADROES_GENERICOS.join(', ')})`;
}

/** O relatório da varredura, sem valor casado nem termo. */
export function relatorioDoDadoPrivado(v: Varredura): string[] {
  const linhas = [`Varredura de dado privado: ${textoDoEscopo(v)}`, `  lista local  ${textoDaListaLocal(v)}`];
  linhas.push(`  exceções     ${v.excecoes.arquivo
    ? `${v.excecoes.arquivo}: ${v.excecoes.total} exceção(ões) e ${v.excecoes.emailsPermitidos} e-mail(s) permitido(s)`
    : `sem ${ARQUIVO_DAS_EXCECOES}: só as regras do código`}`);
  if (v.erro) {
    linhas.push(`  erro         ${v.erro}`);
    return linhas;
  }
  // Exceção sem uso só diz alguma coisa na árvore inteira; no diff, ela cobre o que a thread não mexeu.
  if (v.escopo.some((e) => e.tipo === 'arvore')) {
    for (const s of v.excecoes.semUso) linhas.push(`  aviso        exceção sem uso, revise no PR: ${s}`);
  }
  linhas.push(`  achados      ${v.achados.length}${v.achados.length ? ' (o valor casado nunca é impresso)' : ''}`);
  for (const a of v.achados) linhas.push(`    ${linhaDoAchado(a)}`);
  return linhas;
}

// ---------------------------------------------------------------------------
// A barreira da thread (F2): a policy `dado_privado` no `ork verify` e no `ork ci prepare`
// ---------------------------------------------------------------------------

/** Até quantos `arquivo:linha` vão ao detalhe da policy e ao ledger. */
const ONDE_NO_DETALHE = 10;
const ONDE_NO_LEDGER = 50;

/** O `arquivo:linha` de um achado, ou `arquivo (nome)`; o caminho já vem mascarado. */
export function ondeDoAchado(a: Achado): string {
  return a.linha === null ? `${a.arquivo} (nome)` : `${a.arquivo}:${a.linha}`;
}

function padroesAchados(v: Varredura): string[] {
  return [...new Set(v.achados.map((a) => a.padrao))];
}

/** Os fatos da varredura para a policy, sem valor casado nem termo. */
export function fatosDaVarredura(v: Varredura): FatosDoDadoPrivado {
  return { achados: v.achados.length, padroes: padroesAchados(v), onde: v.achados.slice(0, ONDE_NO_DETALHE).map(ondeDoAchado),
    listaLocal: v.listaLocal.presente, escopo: textoDoEscopo(v), erro: v.erro };
}

export interface BarreiraDaThread {
  severidade: 'block' | 'warn';
  varredura: Varredura;
  violacoes: ViolacaoDePolicy[];
}

/** O que vai ao ledger: escopo, contagens, padrões e onde; nunca o valor casado nem o termo. */
export function resumoNoLedger(b: BarreiraDaThread): Record<string, unknown> {
  const v = b.varredura;
  return { policy: b.severidade, escopo: v.escopo, arquivos: v.arquivos, linhas: v.linhas, nomes: v.nomes,
    listaLocal: { presente: v.listaLocal.presente, termos: v.listaLocal.termos }, achados: v.achados.length,
    padroes: padroesAchados(v), onde: v.achados.slice(0, ONDE_NO_LEDGER).map(ondeDoAchado), erro: v.erro };
}

function estadoDoProjeto(raiz: string): string | null {
  try { return raizDoEstado(raiz); } catch { return null; }
}

/**
 * RM-062 (F2): a barreira no diretório de trabalho da thread. Com `policies.dado_privado` declarada fora de `off`,
 * varre o diff da thread contra a base (D7; sem base, a árvore inteira), mais o que `extra` varrer (o bundle do `ci
 * prepare`), e avalia a policy no gate. Fora do manifesto, `null`: nada roda.
 */
export function barreiraDaThread(carregado: ManifestoCarregado, thread: Pick<Thread, 'id' | 'modo' | 'base'>, cwd: string,
  gate: 'verify' | 'ci.prepare', opcoes: { extra?: (c: ContextoDaVarredura) => Varredura; ignorar?: readonly string[];
    env?: NodeJS.ProcessEnv } = {}): BarreiraDaThread | null {
  const severidade = severidadeDeclarada(carregado.manifesto, 'dado_privado');
  if (severidade === null || severidade === 'off') return null;
  const c = contextoDaVarredura(cwd, estadoDoProjeto(carregado.raiz), opcoes.env);
  let varredura: Varredura;
  if (!c.ok) varredura = varreduraComErro(c.erro, c.lista);
  else {
    const base = baseDaThread(cwd, carregado.manifesto.worktree.base_branch, thread.base?.commit);
    varredura = base ? varrerDiff(c.valor, base, { ignorar: opcoes.ignorar }) : varrerArvore(c.valor);
    if (opcoes.extra) varredura = juntarVarreduras(varredura, opcoes.extra(c.valor));
  }
  const violacoes = avaliarPolicies(carregado.manifesto, { gate, threadId: thread.id, modo: thread.modo,
    dadoPrivado: fatosDaVarredura(varredura) });
  return { severidade, varredura, violacoes };
}
