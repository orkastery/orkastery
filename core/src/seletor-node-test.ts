/** RM-074 M10: seleção conservadora de testes compilados pelo fecho de `require`. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export type MotivoDaSelecaoNode = 'selecionada' | 'sem-mudancas' | 'fora-do-mapeamento'
  | 'require-dinamico' | 'caminho-nao-resolvido';

export interface PlanoDaSelecaoNode {
  modo: 'selecionada' | 'inteira';
  motivo: MotivoDaSelecaoNode;
  arquivos: string[];
  alterados: string[];
  ambiguidade?: { arquivo: string; pedido: string };
}

interface Dependencias {
  locais: string[];
  dinamico: boolean;
  pedidoDinamico: string;
}

function barras(arquivo: string): string {
  return arquivo.split(path.sep).join('/');
}

function dentro(raiz: string, arquivo: string): boolean {
  const relativo = path.relative(raiz, arquivo);
  return relativo !== '' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo);
}

function resolverLocal(distTest: string, arquivo: string, pedido: string): string | null {
  const alvo = path.resolve(path.dirname(arquivo), pedido);
  const candidatos = [alvo, `${alvo}.js`, `${alvo}.json`, path.join(alvo, 'index.js')];
  return candidatos.find((candidato) => dentro(distTest, candidato)
    && fs.statSync(candidato, { throwIfNoEntry: false })?.isFile()) ?? null;
}

function dependenciasDoArquivo(arquivo: string): Dependencias {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const locais: string[] = [];
  let dinamico = false;
  let pedidoDinamico = '';
  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === 'require') {
      const argumento = no.arguments[0];
      if (no.arguments.length !== 1 || !argumento || !(ts.isStringLiteral(argumento)
        || ts.isNoSubstitutionTemplateLiteral(argumento))) {
        dinamico = true;
        pedidoDinamico ||= argumento?.getText(fonte) ?? '<ausente>';
      } else if (argumento.text.startsWith('.')) locais.push(argumento.text);
      else if (path.isAbsolute(argumento.text)) {
        dinamico = true;
        pedidoDinamico ||= argumento.text;
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return { locais, dinamico, pedidoDinamico };
}

/** Extensão do fonte TypeScript que corresponde ao teste compilado. */
const EXTENSAO_DO_FONTE = '.ts';

function caminhoDeFonte(distTest: string, arquivo: string): string {
  const relativo = barras(path.relative(distTest, arquivo));
  return `core/${relativo.replace(/\.js$/, EXTENSAO_DO_FONTE)}`;
}

/** Processo filho e referências ao produto inteiro ficam sempre na seleção. */
export function testeSobeProcesso(texto: string): boolean {
  return /\b(?:spawn|spawnSync|exec|execFile|execFileSync|execSync|fork)\b/.test(texto)
    || /dist[\\/]index\.js/.test(texto) || /(?:^|[\\/])scripts(?:[\\/]|['"])/m.test(texto);
}

/**
 * O grafo inteiro precisa ser resolvido antes de selecionar: uma ambiguidade em qualquer fecho devolve a lane inteira.
 * Pacotes e módulos `node:` não participam do mapa porque não podem aparecer no diff mapeado da F5.
 */
export function planejarSelecaoNode(distTest: string, arquivosDaLane: readonly string[], alteradosRecebidos: readonly string[]): PlanoDaSelecaoNode {
  const completos = [...new Set(arquivosDaLane)].sort();
  const alterados = [...new Set(alteradosRecebidos.map(barras))].sort();
  const inteira = (motivo: Exclude<MotivoDaSelecaoNode, 'selecionada'>,
    ambiguidade?: PlanoDaSelecaoNode['ambiguidade']): PlanoDaSelecaoNode =>
    ({ modo: 'inteira', motivo, arquivos: completos, alterados, ...(ambiguidade ? { ambiguidade } : {}) });
  if (alterados.length === 0) return inteira('sem-mudancas');
  if (alterados.some((arquivo) => !/^core\/(?:src|test)\//.test(arquivo))) return inteira('fora-do-mapeamento');

  const dirDosTestes = path.join(distTest, 'test');
  const cache = new Map<string, Dependencias>();
  const ler = (arquivo: string): Dependencias => {
    const existente = cache.get(arquivo);
    if (existente) return existente;
    const lido = dependenciasDoArquivo(arquivo);
    cache.set(arquivo, lido);
    return lido;
  };
  const fechos = new Map<string, Set<string>>();
  const processos = new Set<string>();
  for (const nome of completos) {
    const raiz = path.join(dirDosTestes, nome);
    if (!fs.statSync(raiz, { throwIfNoEntry: false })?.isFile()) {
      return inteira('caminho-nao-resolvido', { arquivo: caminhoDeFonte(distTest, raiz), pedido: nome });
    }
    if (testeSobeProcesso(fs.readFileSync(raiz, 'utf8'))) processos.add(nome);
    const vistos = new Set<string>([raiz]);
    const pilha = [raiz];
    while (pilha.length) {
      const atual = pilha.pop()!;
      const dependencias = ler(atual);
      if (dependencias.dinamico) {
        return inteira('require-dinamico', { arquivo: caminhoDeFonte(distTest, atual), pedido: dependencias.pedidoDinamico });
      }
      for (const pedido of dependencias.locais) {
        const resolvido = resolverLocal(distTest, atual, pedido);
        if (!resolvido) return inteira('caminho-nao-resolvido', { arquivo: caminhoDeFonte(distTest, atual), pedido });
        if (!vistos.has(resolvido)) { vistos.add(resolvido); pilha.push(resolvido); }
      }
    }
    fechos.set(nome, new Set([...vistos].map((arquivo) => caminhoDeFonte(distTest, arquivo))));
  }

  const mudou = new Set(alterados);
  const selecionados = completos.filter((nome) => processos.has(nome)
    || [...(fechos.get(nome) ?? [])].some((arquivo) => mudou.has(arquivo)));
  return { modo: 'selecionada', motivo: 'selecionada', arquivos: selecionados, alterados };
}
