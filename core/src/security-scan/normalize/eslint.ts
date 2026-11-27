import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface EslintFile { filePath: string; messages?: { ruleId?: string | null; severity?: number; message?: string; line?: number }[] }

const REGRA_ARGUMENTO_INSEGURO = '@typescript-eslint/no-unsafe-argument';
const MARCADOR_TIPO_DO_PARAMETRO = ' assigned to a parameter of type `';

/** Ordena só os membros da união externa, preservando uniões dentro de genéricos, objetos e tuplas. */
function uniaoExternaCanonica(tipo: string): string {
  const partes: string[] = [];
  const fechamentos: string[] = [];
  let inicio = 0;
  let aspas: '"' | "'" | null = null;
  let escapado = false;
  const fechamento: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
  for (let i = 0; i < tipo.length; i++) {
    const caractere = tipo[i];
    if (aspas) {
      if (escapado) escapado = false;
      else if (caractere === '\\') escapado = true;
      else if (caractere === aspas) aspas = null;
      continue;
    }
    if (caractere === '"' || caractere === "'") { aspas = caractere; continue; }
    if (fechamento[caractere]) { fechamentos.push(fechamento[caractere]); continue; }
    if (caractere === fechamentos.at(-1)) { fechamentos.pop(); continue; }
    if (caractere === '|' && fechamentos.length === 0 && tipo[i - 1] === ' ' && tipo[i + 1] === ' ') {
      partes.push(tipo.slice(inicio, i).trim());
      inicio = i + 1;
    }
  }
  if (partes.length === 0) return tipo;
  partes.push(tipo.slice(inicio).trim());
  return partes.sort((a, b) => a < b ? -1 : a > b ? 1 : 0).join(' | ');
}

/** A ordem instável é só a união do tipo do parâmetro desta regra; a mensagem pública fica intacta. */
function snippetDoEslint(regra: string | null | undefined, mensagem: string): string {
  if (regra !== REGRA_ARGUMENTO_INSEGURO || !mensagem.endsWith('`.')) return mensagem;
  const inicio = mensagem.indexOf(MARCADOR_TIPO_DO_PARAMETRO);
  if (inicio < 0) return mensagem;
  const inicioTipo = inicio + MARCADOR_TIPO_DO_PARAMETRO.length;
  const fimTipo = mensagem.length - 2;
  const tipo = mensagem.slice(inicioTipo, fimTipo);
  return `${mensagem.slice(0, inicioTipo)}${uniaoExternaCanonica(tipo)}${mensagem.slice(fimTipo)}`;
}

/** ESLint JSON: `filePath` is absolute inside the container. A message without a rule is a parse error. */
export function eslint(output: string, ctx: NormalizeContext): RawFinding[] {
  const files = parseReport('eslint', output) as EslintFile[];
  return files.flatMap(f => asArray(f.messages).map(m => {
    const message = m.message ?? '';
    return {
      tool: 'eslint', rule: m.ruleId ?? 'parse-error', category: 'quality' as const, severity: mapSeverity('eslint', m.severity), stack: 'js' as const,
      file: repoPath(f.filePath, ctx), line: m.line, message, snippet: snippetDoEslint(m.ruleId, message),
    };
  }));
}
