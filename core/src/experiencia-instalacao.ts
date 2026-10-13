/** Bloco próprio nos arquivos lidos pelo host. Nunca altera o bloco de ork init. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Locale, LOCALE_PADRAO, msg } from './locale';

export type HostComBloco = 'claude-code' | 'codex';
export const INICIO_EXPERIENCIA = '<!-- orkastery:experiencia:begin -->';
export const FIM_EXPERIENCIA = '<!-- orkastery:experiencia:end -->';
const CONTRATO = 'ork.experiencia-install/v1';
/** RM-061 (F3a, D8): as linguas em que o bloco e escrito e, sem recibo, reconhecido. */
const LOCALES_DO_BLOCO: readonly Locale[] = ['pt-BR', 'en'];
/** Marca do diretorio no molde da linha: o texto antes e depois dela reconhece a linha em cada lingua. */
const MARCA_DO_DIRETORIO = '{{diretorio}}';
interface Recibo { contrato: typeof CONTRATO; host: HostComBloco; anterior: string | null; adicao: string }
interface Mudanca { arquivo: string; antes: Buffer | null; depois: Buffer | null }
export interface PlanoExperiencia { projeto: string; host: HostComBloco; mudancas: Mudanca[]; acao: 'instalar' | 'remover' }
/** Bloco encontrado no arquivo: bytes [inicio, fim) e o separador que a instalação pôs antes dele. */
interface BlocoAtual { inicio: number; fim: number; separador: Buffer; eol: string; doRecibo: boolean }
const conflito = (): never => { throw Error('experiencia.bloco.conflict: bloco ou recibo alterado/duplicado; preserve os arquivos e revise a instalação'); };

/** Recusa symlinks e hardlinks em qualquer componente antes da leitura/escrita. */
export function caminhoSeguro(projeto: string, arquivo: string): void {
  if (fs.realpathSync(projeto) !== projeto || !arquivo.startsWith(projeto + path.sep)) throw Error('experiencia.path.unsafe');
  let atual = projeto;
  const partes = path.relative(projeto, arquivo).split(path.sep);
  for (let i = 0; i < partes.length; i++) {
    atual = path.join(atual, partes[i]);
    const s = fs.lstatSync(atual, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isSymbolicLink() || (i < partes.length - 1 ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)) throw Error('experiencia.path.unsafe');
  }
}
function ler(projeto: string, arquivo: string): Buffer | null {
  caminhoSeguro(projeto, arquivo);
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo) : null;
}
function iguais(a: Buffer | null, b: Buffer | null): boolean { return a === null ? b === null : b !== null && a.equals(b); }
function contar(b: Buffer, texto: string): number {
  let n = 0, i = 0;
  while ((i = b.indexOf(texto, i)) >= 0) { n++; i += Buffer.byteLength(texto); }
  return n;
}
function decodificar(s: unknown): Buffer {
  if (typeof s !== 'string') return conflito();
  const b = Buffer.from(s, 'base64');
  if (b.toString('base64') !== s) return conflito();
  return b;
}
const eolDe = (b: Buffer): string => b.includes('\r\n') ? '\r\n' : '\n';

/**
 * O caminho vai relativo ao projeto: o arquivo de instruções costuma ser versionado. RM-061 (F3a, D1 e D2): o texto
 * sai na língua pedida, pela família `gerados` do catálogo; os marcadores são os mesmos nas duas línguas.
 */
function nucleoDoBloco(skill: string, eol: string, locale: Locale): Buffer {
  const t = msg(locale).gerados.experiencia;
  return Buffer.from([INICIO_EXPERIENCIA, `## ${t.titulo}`, t.consulte, t.diretorio(JSON.stringify(skill)), t.preferencias,
    FIM_EXPERIENCIA, ''].join(eol));
}

/** O diretório escrito na linha do bloco de uma língua, ou null se a linha não é a dessa língua. */
function diretorioDaLinha(linha: string, locale: Locale): string | null {
  const molde = msg(locale).gerados.experiencia.diretorio(MARCA_DO_DIRETORIO);
  const corte = molde.indexOf(MARCA_DO_DIRETORIO);
  const antes = molde.slice(0, corte), depois = molde.slice(corte + MARCA_DO_DIRETORIO.length);
  if (linha.length < antes.length + depois.length || !linha.startsWith(antes) || !linha.endsWith(depois)) return null;
  let skill: unknown;
  try { skill = JSON.parse(linha.slice(antes.length, linha.length - depois.length)); } catch { return null; }
  return typeof skill === 'string' && !/[\r\n`]/.test(skill) ? skill : null;
}

/**
 * Bloco sem recibo (clone novo, `.orkastery/` apagado) só é adotado quando é exatamente o texto
 * que esta versão ou a anterior geram, com qualquer diretório e em qualquer das duas línguas (RM-061,
 * F3a, D8); qualquer outra edição é conflito.
 */
function reconhecerBloco(antes: Buffer): BlocoAtual | null {
  if (contar(antes, INICIO_EXPERIENCIA) !== 1 || contar(antes, FIM_EXPERIENCIA) !== 1) return null;
  const inicio = antes.indexOf(INICIO_EXPERIENCIA), marcaFim = antes.indexOf(FIM_EXPERIENCIA);
  if (marcaFim < inicio || (inicio > 0 && antes[inicio - 1] !== 10)) return null;
  let fim = marcaFim + Buffer.byteLength(FIM_EXPERIENCIA);
  const eol = eolDe(antes.subarray(inicio, fim));
  if (antes.subarray(fim, fim + eol.length).toString() === eol) fim += eol.length;
  const texto = antes.subarray(inicio, fim);
  const linha = texto.toString('utf8').split(eol)[3] ?? '';
  const reconhecido = LOCALES_DO_BLOCO.some((locale) => {
    const skill = diretorioDaLinha(linha, locale);
    if (skill === null) return false;
    const esperado = nucleoDoBloco(skill, eol, locale);
    return texto.equals(esperado) || texto.equals(esperado.subarray(0, esperado.length - eol.length));
  });
  if (!reconhecido) return null;
  // Uma linha em branco antes do bloco é o separador que a instalação põe depois de uma linha.
  const sep = Buffer.from(eol);
  const separador = inicio >= 2 * sep.length && antes.subarray(inicio - sep.length, inicio).equals(sep) &&
    antes[inicio - sep.length - 1] === 10 ? sep : Buffer.alloc(0);
  return { inicio, fim, separador, eol, doRecibo: false };
}

/**
 * Remove o bloco e, se ainda intacto, o separador. O separador de uma quebra só sai quando a linha
 * anterior continua terminada; o de duas, quando a última linha do conteúdo original continua sem
 * quebra. Conteúdo externo depois do bloco não se funde à última linha do prefixo.
 */
function removerBloco(antes: Buffer, bloco: BlocoAtual): Buffer {
  let inicio = bloco.inicio;
  const sep = bloco.separador, antesDoSep = bloco.inicio - sep.length;
  if (sep.length && antesDoSep > 0 && antes.subarray(antesDoSep, bloco.inicio).equals(sep)) {
    const terminaEmLinha = antes[antesDoSep - 1] === 10;
    if ((contar(sep, '\n') === 1) === terminaEmLinha) inicio = antesDoSep;
  }
  const prefixo = antes.subarray(0, inicio), sufixo = antes.subarray(bloco.fim);
  const juncao = prefixo.length && prefixo.at(-1) !== 10 && sufixo.length ? Buffer.from(bloco.eol) : Buffer.alloc(0);
  return Buffer.concat([prefixo, juncao, sufixo]);
}

/**
 * Planejamento puro em relação ao disco: dry-run e preflight usam o mesmo contrato. O bloco sai no `locale` pedido
 * (RM-061, F3a), pt-BR por omissão: só o `ork adapter install` passa a língua do dono (D2).
 */
export function planejarExperiencia(projeto: string, host: HostComBloco, skill: string | null,
  locale: Locale = LOCALE_PADRAO): PlanoExperiencia {
  projeto = fs.realpathSync(path.resolve(projeto));
  if (!['claude-code', 'codex'].includes(host)) throw Error('experiencia.host.unsupported');
  if (skill !== null && /[\r\n`]/.test(skill)) throw Error('experiencia.skill.invalid');
  const arquivo = path.join(projeto, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
  const reciboPath = path.join(projeto, '.orkastery', 'experiencia', host + '.json');
  const antes = ler(projeto, arquivo), bytesRecibo = ler(projeto, reciboPath);
  let recibo: Recibo | null = null;
  if (bytesRecibo) {
    try { recibo = JSON.parse(bytesRecibo.toString('utf8')); } catch { conflito(); }
    if (!recibo || recibo.contrato !== CONTRATO || recibo.host !== host) return conflito();
    if (recibo.anterior !== null) decodificar(recibo.anterior);
  }
  const marcas = antes ? contar(antes, INICIO_EXPERIENCIA) + contar(antes, FIM_EXPERIENCIA) : 0;
  // Sem marcas, um recibo que sobrou (arquivo apagado ou bloco tirado à mão) não descreve nada.
  let bloco: BlocoAtual | null = null;
  if (antes && marcas) {
    if (recibo) {
      const adicao = decodificar(recibo.adicao), corte = adicao.indexOf(INICIO_EXPERIENCIA);
      if (contar(adicao, INICIO_EXPERIENCIA) !== 1 || contar(adicao, FIM_EXPERIENCIA) !== 1 || corte < 0) return conflito();
      const nucleo = adicao.subarray(corte), inicio = antes.indexOf(nucleo);
      if (marcas === 2 && inicio >= 0) {
        bloco = { inicio, fim: inicio + nucleo.length, separador: adicao.subarray(0, corte), eol: eolDe(nucleo), doRecibo: true };
      }
    }
    bloco ??= reconhecerBloco(antes);
    if (!bloco) return conflito();
  }
  let depois: Buffer | null = antes, proximoRecibo: Buffer | null = null;
  if (skill !== null) {
    let separador: Buffer, nucleo: Buffer, anterior: string | null;
    if (antes && bloco) {
      // Atualização no lugar: o que está antes e depois do bloco, inclusive edição externa, fica.
      nucleo = nucleoDoBloco(skill, bloco.eol, locale); separador = bloco.separador;
      depois = Buffer.concat([antes.subarray(0, bloco.inicio), nucleo, antes.subarray(bloco.fim)]);
      // Adotado sem recibo: se só havia o bloco, o arquivo conta como criado pelo pacote.
      const semBloco = removerBloco(antes, bloco);
      anterior = bloco.doRecibo ? recibo!.anterior : semBloco.length ? semBloco.toString('base64') : null;
    } else {
      const base = antes ?? Buffer.alloc(0), eol = eolDe(base);
      nucleo = nucleoDoBloco(skill, eol, locale);
      separador = Buffer.from(base.length ? (base.at(-1) === 10 ? eol : eol + eol) : '');
      depois = Buffer.concat([base, separador, nucleo]);
      anterior = antes?.toString('base64') ?? null;
    }
    proximoRecibo = Buffer.from(JSON.stringify({ contrato: CONTRATO, host, anterior,
      adicao: Buffer.concat([separador, nucleo]).toString('base64'),
    } satisfies Recibo, null, 2) + '\n');
  } else if (antes && bloco) {
    depois = removerBloco(antes, bloco);
    // Vazio só some quando o arquivo não existia (recibo) ou quando, sem recibo, só havia o bloco.
    if (depois.length === 0 && (recibo ? recibo.anterior === null : true)) depois = null;
  }
  const mudancas = [{ arquivo, antes, depois }, { arquivo: reciboPath, antes: bytesRecibo, depois: proximoRecibo }]
    .filter(m => !iguais(m.antes, m.depois));
  return { projeto, host, acao: skill === null ? 'remover' : 'instalar', mudancas };
}

/** Revalida o plano inteiro; falha de gravação restaura as mudanças já aplicadas. */
export function aplicarExperiencia(plano: PlanoExperiencia): void {
  for (const m of plano.mudancas) if (!iguais(ler(plano.projeto, m.arquivo), m.antes)) throw Error('experiencia.plan.stale');
  const aplicadas: Mudanca[] = [];
  const gravar = (arquivo: string, conteudo: Buffer | null) => {
    caminhoSeguro(plano.projeto, arquivo);
    if (conteudo === null) { fs.unlinkSync(arquivo); return; }
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.' + randomUUID() + '.tmp';
    try {
      // Arquivo novo segue o umask, como um CLAUDE.md criado à mão.
      const modo = fs.statSync(arquivo, { throwIfNoEntry: false })?.mode ?? 0o666;
      fs.writeFileSync(tmp, conteudo, { flag: 'wx', mode: modo }); fs.renameSync(tmp, arquivo);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  };
  try {
    for (const m of plano.mudancas) { gravar(m.arquivo, m.depois); aplicadas.push(m); }
  } catch (e) {
    for (const m of aplicadas.reverse()) gravar(m.arquivo, m.antes);
    throw e;
  }
}
