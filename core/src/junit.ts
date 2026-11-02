/**
 * RM-081 F1: o subconjunto de JUnit XML que o verify usa como evidencia nominal.
 *
 * O parser e deliberadamente pequeno: valida o balanceamento do XML, nao aceita DTD e so
 * interpreta suites, casos e os tres marcadores de resultado. Saida, propriedades e mensagens
 * continuam opacas. O codigo de saida do comando permanece a autoridade do veredito.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';
import type { EvidenciaJUnit, Manifesto, MarcacaoDeRelogio, ResultadoDeComando } from './types';
import { procurarSegredos } from './policies';
import { redigirCredenciaisUrl } from './redacao-url';

export type EstadoDoTesteJUnit = 'passou' | 'falhou' | 'erro' | 'pulado';

export interface CasoJUnit {
  nome: string;
  estado: EstadoDoTesteJUnit;
  duracaoMs: number;
}

export interface RelatorioJUnit {
  casos: CasoJUnit[];
  testes: number;
  falhas: number;
  erros: number;
  pulados: number;
  duracaoMs: number;
}

/** Relatorio acima deste teto e evidencia invalida, sem tentar alocar o XML inteiro. */
export const LIMITE_JUNIT_BYTES = 16 * 1024 * 1024;
/** Sistemas de arquivos podem arredondar mtime; a remocao previa continua sendo a barreira principal. */
const TOLERANCIA_MTIME_MS = 2_000;

export interface RelatorioJUnitPreparado {
  cwd: string;
  caminho: string;
  absoluto: string;
  raizReal: string;
  iniciadoEmMs: number;
  descarte?: EvidenciaJUnit;
}

const NOME_XML = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function erro(detalhe: string): never {
  throw new Error(`junit.xml.invalido: ${detalhe}`);
}

function decodificar(texto: string): string {
  for (let i = texto.indexOf('&'); i >= 0; i = texto.indexOf('&', i)) {
    const entidade = /^&([A-Za-z][A-Za-z0-9]*);/.exec(texto.slice(i));
    if (!entidade || !Object.hasOwn(ENTIDADES, entidade[1])) {
      return erro('entidade XML nao aceita');
    }
    i += entidade[0].length;
  }
  return texto.replace(/&([^;]+);/g, (_tudo, nome: string) => ENTIDADES[nome] ?? erro(`entidade &${nome}; nao aceita`));
}

function codigoDoErro(e: unknown): string {
  const codigo = (e as NodeJS.ErrnoException)?.code;
  return typeof codigo === 'string' && /^[A-Z0-9_]+$/.test(codigo) ? codigo : 'DESCONHECIDO';
}

function nomeLocal(nome: string): string {
  return nome.slice(nome.lastIndexOf(':') + 1);
}

function fimDaTag(xml: string, inicio: number): number {
  let aspas: '"' | "'" | null = null;
  for (let i = inicio; i < xml.length; i++) {
    const c = xml[i];
    if (aspas) { if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") { aspas = c; continue; }
    if (c === '>') return i;
  }
  return erro('tag sem fechamento');
}

function lerInicio(bruto: string): { nome: string; atributos: Record<string, string>; autocontido: boolean } {
  let texto = bruto.trim();
  const autocontido = texto.endsWith('/');
  if (autocontido) texto = texto.slice(0, -1).trimEnd();
  const achado = NOME_XML.exec(texto);
  if (!achado) return erro('nome de elemento ausente');
  const nome = achado[0];
  const atributos: Record<string, string> = {};
  let i = nome.length;
  while (i < texto.length) {
    while (/\s/.test(texto[i] ?? '')) i++;
    if (i >= texto.length) break;
    const atributo = NOME_XML.exec(texto.slice(i));
    if (!atributo) return erro(`atributo invalido em <${nome}>`);
    const chave = atributo[0];
    i += chave.length;
    while (/\s/.test(texto[i] ?? '')) i++;
    if (texto[i++] !== '=') return erro(`atributo ${chave} sem =`);
    while (/\s/.test(texto[i] ?? '')) i++;
    const aspas = texto[i++];
    if (aspas !== '"' && aspas !== "'") return erro(`atributo ${chave} sem aspas`);
    const fim = texto.indexOf(aspas, i);
    if (fim < 0) return erro(`atributo ${chave} sem fechamento`);
    if (Object.hasOwn(atributos, chave)) return erro(`atributo ${chave} repetido`);
    atributos[chave] = decodificar(texto.slice(i, fim)).replace(/[\t\n]/g, ' ');
    i = fim + 1;
  }
  return { nome, atributos, autocontido };
}

function duracao(atributos: Record<string, string>): number {
  if (atributos.time === undefined || atributos.time === '') return 0;
  const segundos = Number(atributos.time);
  if (!Number.isFinite(segundos) || segundos < 0) return erro(`duracao invalida: ${atributos.time}`);
  const milissegundos = segundos * 1000;
  if (!Number.isFinite(milissegundos) || milissegundos > Number.MAX_SAFE_INTEGER) {
    return erro('duracao fora do intervalo aceito');
  }
  return Math.round(milissegundos * 1000) / 1000;
}

function identidade(atributos: Record<string, string>): string {
  const nome = atributos.name?.trim();
  if (!nome) return erro('testcase sem name');
  const prefixo = (atributos.classname || atributos.file || '').trim();
  return prefixo ? `${prefixo} :: ${nome}` : nome;
}

function conferirIdentidadePersistivel(caso: CasoJUnit): void {
  if (caso.estado !== 'falhou' && caso.estado !== 'erro') return;
  if (caso.nome.length > 200 || redigirCredenciaisUrl(caso.nome) !== caso.nome || procurarSegredos(caso.nome).length > 0) {
    return erro('identidade de testcase nao pode ser persistida com seguranca');
  }
}

/** Le pytest, Vitest, Jest, Playwright e gotestsum pelo contrato JUnit comum. */
export function lerJUnitXml(xml: string): RelatorioJUnit {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) return erro('caractere de controle nao aceito');
  xml = xml.replace(/\r\n?/g, '\n');
  const pilha: string[] = [];
  const casos: CasoJUnit[] = [];
  let atual: CasoJUnit | null = null;
  let raiz: string | null = null;
  let viuSuite = false;
  let suitesAbertas = 0;
  let pos = xml.charCodeAt(0) === 0xfeff ? 1 : 0;

  const marcar = (estado: EstadoDoTesteJUnit): void => {
    if (!atual) return;
    const peso: Record<EstadoDoTesteJUnit, number> = { passou: 0, pulado: 1, falhou: 2, erro: 3 };
    if (peso[estado] > peso[atual.estado]) atual.estado = estado;
  };

  while (pos < xml.length) {
    const abre = xml.indexOf('<', pos);
    const texto = abre < 0 ? xml.slice(pos) : xml.slice(pos, abre);
    if (pilha.length === 0 && texto.trim()) return erro('texto fora da raiz');
    if (pilha.length > 0 && texto) decodificar(texto);
    if (abre < 0) { pos = xml.length; break; }

    if (xml.startsWith('<!--', abre)) {
      const fim = xml.indexOf('-->', abre + 4);
      if (fim < 0) return erro('comentario sem fechamento');
      pos = fim + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', abre)) {
      const fim = xml.indexOf(']]>', abre + 9);
      if (fim < 0) return erro('CDATA sem fechamento');
      pos = fim + 3;
      continue;
    }
    if (xml.startsWith('<?', abre)) {
      const fim = xml.indexOf('?>', abre + 2);
      if (fim < 0) return erro('instrucao sem fechamento');
      pos = fim + 2;
      continue;
    }
    if (xml.startsWith('<!', abre)) return erro('declaracao ou DTD nao aceita');

    const fim = fimDaTag(xml, abre + 1);
    const conteudo = xml.slice(abre + 1, fim);
    if (conteudo.startsWith('/')) {
      const nome = conteudo.slice(1).trim();
      if (!NOME_XML.test(nome) || NOME_XML.exec(nome)?.[0] !== nome) return erro('fechamento invalido');
      const esperado = pilha.pop();
      if (esperado !== nome) return erro(`fechamento </${nome}> nao corresponde a <${esperado ?? 'ausente'}>`);
      if (nomeLocal(nome) === 'testcase') {
        if (!atual) return erro('testcase fechado sem abertura');
        casos.push(atual);
        atual = null;
      }
      if (nomeLocal(nome) === 'testsuite') suitesAbertas--;
      pos = fim + 1;
      continue;
    }

    const inicio = lerInicio(conteudo);
    const local = nomeLocal(inicio.nome);
    if (!raiz) {
      if (local !== 'testsuite' && local !== 'testsuites') return erro(`raiz <${inicio.nome}> nao e JUnit`);
      raiz = inicio.nome;
    } else if (pilha.length === 0) return erro('mais de uma raiz');
    if (local === 'testsuite') viuSuite = true;
    if (local === 'testcase') {
      if (atual) return erro('testcase aninhado');
      if (suitesAbertas === 0) return erro('testcase fora de testsuite');
      atual = { nome: identidade(inicio.atributos), estado: 'passou', duracaoMs: duracao(inicio.atributos) };
    } else if (local === 'failure') marcar('falhou');
    else if (local === 'error') marcar('erro');
    else if (local === 'skipped') marcar('pulado');

    if (inicio.autocontido) {
      if (local === 'testcase') { casos.push(atual!); atual = null; }
    } else {
      pilha.push(inicio.nome);
      if (local === 'testsuite') suitesAbertas++;
    }
    pos = fim + 1;
  }

  if (pilha.length > 0) return erro(`elemento <${pilha.at(-1)}> sem fechamento`);
  if (!raiz || !viuSuite) return erro('nenhuma testsuite');
  casos.forEach(conferirIdentidadePersistivel);
  const contar = (estado: EstadoDoTesteJUnit) => casos.filter((c) => c.estado === estado).length;
  const duracaoMs = casos.reduce((soma, caso) => soma + caso.duracaoMs, 0);
  if (!Number.isSafeInteger(Math.round(duracaoMs))) return erro('duracao somada fora do intervalo aceito');
  return {
    casos,
    testes: casos.length,
    falhas: contar('falhou'),
    erros: contar('erro'),
    pulados: contar('pulado'),
    duracaoMs: Math.round(duracaoMs * 1000) / 1000,
  };
}

function dentro(raiz: string, alvo: string): boolean {
  const relativo = path.relative(raiz, alvo);
  return relativo !== '..' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo);
}

function evidencia(caminho: string, estado: EvidenciaJUnit['estado'], motivo: string): EvidenciaJUnit {
  return { caminho, estado, motivo: motivo.slice(0, 300) };
}

/** O caminho declarado para o nome interno do comando (`test:<lane>` no Agile). */
export function caminhoJUnitDoComando(manifesto: Manifesto, nome: string): string | undefined {
  if (nome.startsWith('test:')) return manifesto.check?.agile?.junit?.[nome.slice('test:'.length)];
  return manifesto.verify.junit?.[nome as keyof NonNullable<Manifesto['verify']['junit']>];
}

/** A marcacao fechada que acompanha o relatorio do mesmo comando ou lane. */
export function marcacaoDeRelogioDoComando(manifesto: Manifesto, nome: string): MarcacaoDeRelogio | undefined {
  if (nome.startsWith('test:')) return manifesto.check?.agile?.relogio?.[nome.slice('test:'.length)];
  return manifesto.verify.relogio?.[nome as keyof NonNullable<Manifesto['verify']['relogio']>];
}

/** Nome e granular; marcador e tag declaram que o proprio comando ja selecionou aquela categoria. */
function casoMedeRelogio(nome: string, marcacao: MarcacaoDeRelogio | undefined): boolean {
  if (!marcacao) return false;
  if ('marcador' in marcacao || 'tag' in marcacao) return true;
  return marcacao.nome.some((padrao) => {
    try { return new RegExp(padrao).test(nome); }
    catch { return false; }
  });
}

type DiretorioAncorado = { ok: true; descritor: number; alvo: string }
  | { ok: false; estado: EvidenciaJUnit['estado']; motivo: string };

function acessoAoDescritor(descritor: number): { atalho: string; real: string } | null {
  for (const base of ['/proc/self/fd', '/dev/fd']) {
    const atalho = path.join(base, String(descritor));
    try { return { atalho, real: fs.realpathSync(atalho) }; }
    catch { /* tenta o acesso por descritor que a plataforma oferece */ }
  }
  return null;
}

/**
 * Abre o diretorio pai sem seguir o ultimo link e ancora as operacoes no descritor. O realpath do
 * descritor detecta troca em qualquer ancestral; dali em diante, rename de caminho nao muda o pai.
 */
function abrirDiretorioAncorado(absoluto: string, raizReal: string): DiretorioAncorado {
  const pai = path.dirname(absoluto);
  let descritor: number;
  try {
    descritor = fs.openSync(pai, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    const codigo = codigoDoErro(e);
    return { ok: false, estado: codigo === 'ENOENT' ? 'ausente' : codigo === 'ELOOP' || codigo === 'ENOTDIR' ? 'inseguro' : 'erro',
      motivo: `nao foi possivel ancorar o diretorio do relatorio (${codigo})` };
  }
  try {
    const acesso = acessoAoDescritor(descritor);
    if (!acesso) {
      fs.closeSync(descritor);
      return { ok: false, estado: 'erro', motivo: 'a plataforma nao oferece acesso ancorado ao relatorio' };
    }
    const info = fs.fstatSync(descritor);
    const atual = fs.statSync(pai);
    if (!info.isDirectory() || !dentro(raizReal, acesso.real) || atual.dev !== info.dev || atual.ino !== info.ino) {
      fs.closeSync(descritor);
      return { ok: false, estado: 'inseguro', motivo: 'o diretorio do relatorio mudou ou sai da worktree' };
    }
    return { ok: true, descritor, alvo: path.join(acesso.atalho, path.basename(absoluto)) };
  } catch (e) {
    fs.closeSync(descritor);
    return { ok: false, estado: 'erro', motivo: `nao foi possivel validar o diretorio do relatorio (${codigoDoErro(e)})` };
  }
}

/** Le no maximo o teto mais um byte, suficiente para detectar crescimento sem alocacao aberta. */
function lerComLimite(descritor: number): { bytes?: Buffer; excedeu: boolean } {
  const partes: Buffer[] = [];
  let total = 0;
  while (total <= LIMITE_JUNIT_BYTES) {
    const tamanho = Math.min(64 * 1024, LIMITE_JUNIT_BYTES + 1 - total);
    if (tamanho === 0) break;
    const parte = Buffer.allocUnsafe(tamanho);
    const lidos = fs.readSync(descritor, parte, 0, tamanho, null);
    if (lidos === 0) break;
    partes.push(parte.subarray(0, lidos));
    total += lidos;
  }
  return total > LIMITE_JUNIT_BYTES ? { excedeu: true } : { bytes: Buffer.concat(partes, total), excedeu: false };
}

/** Remove a evidencia anterior antes do comando. Falha fechada: o comando ainda roda, mas o XML nao sera usado. */
export function prepararRelatorioJUnit(cwd: string, caminho: string): RelatorioJUnitPreparado {
  const absoluto = path.resolve(cwd, caminho);
  let raizReal = cwd;
  try { raizReal = fs.realpathSync(cwd); }
  catch {
    return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now(),
      descarte: evidencia(caminho, 'inseguro', 'worktree sem realpath') };
  }
  const pai = abrirDiretorioAncorado(absoluto, raizReal);
  if (!pai.ok) {
    if (pai.estado === 'ausente') return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now() };
    return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now(),
      descarte: evidencia(caminho, pai.estado, pai.motivo) };
  }
  try {
    const anterior = fs.lstatSync(pai.alvo, { throwIfNoEntry: false });
    if (!anterior) return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now() };
    if (anterior.isDirectory()) {
      return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now(),
        descarte: evidencia(caminho, 'inseguro', 'relatorio anterior nao e arquivo removivel') };
    }
    fs.unlinkSync(pai.alvo);
    if (fs.lstatSync(pai.alvo, { throwIfNoEntry: false })) {
      return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now(),
        descarte: evidencia(caminho, 'erro', 'relatorio anterior permaneceu depois da remocao') };
    }
    return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now() };
  } catch (e) {
    return { cwd, caminho, absoluto, raizReal, iniciadoEmMs: Date.now(),
      descarte: evidencia(caminho, 'erro', `nao foi possivel remover o relatorio anterior (${codigoDoErro(e)})`) };
  } finally {
    fs.closeSync(pai.descritor);
  }
}

/** Le somente o arquivo novo e regular da rodada; qualquer duvida vira motivo de descarte. */
export function lerRelatorioJUnit(preparado: RelatorioJUnitPreparado): { evidencia: EvidenciaJUnit; relatorio?: RelatorioJUnit } {
  if (preparado.descarte) return { evidencia: preparado.descarte };
  const { caminho, absoluto, raizReal } = preparado;
  try {
    const pai = abrirDiretorioAncorado(absoluto, raizReal);
    if (!pai.ok) {
      const estado = pai.estado === 'ausente' ? 'ausente' : pai.estado;
      const motivo = pai.estado === 'ausente' ? 'o comando nao escreveu o relatorio' : pai.motivo;
      return { evidencia: evidencia(caminho, estado, motivo) };
    }
    let bytes: Buffer | undefined;
    let descarteAposFechar: EvidenciaJUnit | undefined;
    let identidadeLida: { dev: number; ino: number } | undefined;
    try {
      const inicial = fs.lstatSync(pai.alvo, { throwIfNoEntry: false });
      if (!inicial) descarteAposFechar = evidencia(caminho, 'ausente', 'o comando nao escreveu o relatorio');
      else if (!inicial.isFile() || inicial.isSymbolicLink()) {
        descarteAposFechar = evidencia(caminho, 'inseguro', 'o relatorio nao e arquivo regular');
      } else {
        let descritor: number | undefined;
        try {
          descritor = fs.openSync(pai.alvo,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
          const info = fs.fstatSync(descritor);
          const acesso = acessoAoDescritor(descritor);
          const atual = fs.statSync(pai.alvo);
          if (!acesso || !info.isFile() || !dentro(raizReal, acesso.real) ||
              atual.dev !== info.dev || atual.ino !== info.ino) {
            descarteAposFechar = evidencia(caminho, 'inseguro', 'o relatorio mudou durante a validacao de confinamento');
          } else {
            identidadeLida = { dev: info.dev, ino: info.ino };
            if (info.mtimeMs + TOLERANCIA_MTIME_MS < preparado.iniciadoEmMs) {
              descarteAposFechar = evidencia(caminho, 'outra-rodada', 'o relatorio e anterior ao inicio do comando');
            } else if (info.size > LIMITE_JUNIT_BYTES) {
              descarteAposFechar = evidencia(caminho, 'invalido', `o relatorio excede ${LIMITE_JUNIT_BYTES} bytes`);
            } else {
              const lido = lerComLimite(descritor);
              if (lido.excedeu) descarteAposFechar = evidencia(caminho, 'invalido', `o relatorio excede ${LIMITE_JUNIT_BYTES} bytes`);
              else bytes = lido.bytes;
              const final = fs.fstatSync(descritor);
              if (final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs) {
                descarteAposFechar = evidencia(caminho, 'inseguro', 'o relatorio mudou durante a leitura');
                bytes = undefined;
              }
            }
          }
        } catch (e) {
          const estado = codigoDoErro(e) === 'ELOOP' ? 'inseguro' : 'erro';
          descarteAposFechar = evidencia(caminho, estado, `nao foi possivel abrir o relatorio (${codigoDoErro(e)})`);
        } finally {
          if (descritor !== undefined) fs.closeSync(descritor);
        }
      }
      const atual = fs.lstatSync(pai.alvo, { throwIfNoEntry: false });
      if (identidadeLida && (!atual || !atual.isFile() || atual.isSymbolicLink() ||
          atual.dev !== identidadeLida.dev || atual.ino !== identidadeLida.ino)) {
        descarteAposFechar = evidencia(caminho, 'inseguro', 'o relatorio mudou antes da limpeza');
        bytes = undefined;
      }
      if (atual && !atual.isDirectory()) fs.unlinkSync(pai.alvo);
    } finally {
      fs.closeSync(pai.descritor);
    }
    if (descarteAposFechar) return { evidencia: descarteAposFechar };
    if (!bytes) return { evidencia: evidencia(caminho, 'erro', 'o relatorio nao pode ser lido') };
    let xml: string;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { evidencia: evidencia(caminho, 'invalido', 'o relatorio nao e UTF-8 valido') }; }
    let relatorio: RelatorioJUnit;
    try { relatorio = lerJUnitXml(xml); }
    catch { return { evidencia: evidencia(caminho, 'invalido', 'o relatorio nao contem XML JUnit valido') }; }
    return { evidencia: { caminho, estado: 'lido', testes: relatorio.testes, falhas: relatorio.falhas,
      erros: relatorio.erros, pulados: relatorio.pulados, duracaoMs: relatorio.duracaoMs }, relatorio };
  } catch (e) {
    return { evidencia: evidencia(caminho, 'erro', `nao foi possivel ler o relatorio (${codigoDoErro(e)})`) };
  }
}

/** Anexa estatisticas e, em comando vermelho, substitui o extrator de stdout pelos nomes completos do XML. */
export function anexarRelatorioJUnit(resultado: ResultadoDeComando, preparado: RelatorioJUnitPreparado,
  marcacao?: MarcacaoDeRelogio): ResultadoDeComando {
  const lido = lerRelatorioJUnit(preparado);
  if (!lido.relatorio) return { ...resultado, junit: lido.evidencia };
  if (resultado.ok) return { ...resultado, junit: lido.evidencia };
  const caidos = lido.relatorio.casos.filter((c) => c.estado === 'falhou' || c.estado === 'erro').map((c) => c.nome);
  const base: ResultadoDeComando = { ...resultado, junit: lido.evidencia, testeQueCaiu: caidos,
    falhasDeTeste: caidos.map((nome) => ({ nome, relogio: casoMedeRelogio(nome, marcacao) })) };
  if (caidos.length > 0) return base;
  const { testeQueCaiu: _testes, falhasDeTeste: _falhas, ...semNomes } = base;
  return semNomes;
}
