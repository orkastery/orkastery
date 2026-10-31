/** Cache de resultado normalizado do Agile, por conteúdo e fora do repositório. */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cacheRoot, type ToolResult, type TrabalhoDaFerramenta } from './run';
import type { ToolSpec } from './types';

const CONTRATO = 'ork.security-scan.incremental/v1';
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock',
  'Pipfile.lock', 'go.mod', 'go.sum']);

type Escopo = 'arquivo' | 'lockfile';
interface Retrato { escopo: Escopo; arquivos: Record<string, string> }
interface Entrada { contrato: typeof CONTRATO; chave: string; retrato: Retrato; resultado: ToolResult }
export interface ConsultaIncremental {
  escopo: Escopo | null;
  atual: Retrato | null;
  anterior: ToolResult | null;
  alterados: string[];
  reutilizado: ToolResult | null;
}

const sha256 = (valor: string | Buffer): string => crypto.createHash('sha256').update(valor).digest('hex');

/** Só habilita o que tem garantia explícita: Semgrep por arquivo e dependências por lockfile. */
function escopoDaFerramenta(t: ToolSpec): Escopo | null {
  if (t.name === 'semgrep') return 'arquivo';
  if (t.category === 'dependency') return 'lockfile';
  return null;
}

function arquivos(root: string, escopo: Escopo): Record<string, string> {
  const saida: Record<string, string> = {};
  const visitar = (dir: string): void => {
    let nomes: fs.Dirent[];
    try { nomes = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const nome of nomes) {
      if (nome.name === '.git') continue;
      const absoluto = path.join(dir, nome.name);
      if (nome.isDirectory()) { visitar(absoluto); continue; }
      if (!nome.isFile()) continue;
      const relativo = path.relative(root, absoluto).split(path.sep).join('/');
      const lockfile = LOCKFILES.has(nome.name) || /^requirements(?:\.[^.]+)?\.txt$/.test(nome.name);
      if (escopo === 'lockfile' && !lockfile) continue;
      try { saida[relativo] = sha256(fs.readFileSync(absoluto)); } catch { /* arquivo mudou durante a leitura: nao entra */ }
    }
  };
  visitar(root);
  return saida;
}

function identidade(trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec): string {
  // A especificação inclui versão, imagem e os identificadores das regras; a configuração inclui exclusões e flags.
  return sha256(JSON.stringify({ ferramenta, unidades: trabalho.units, configuracao: trabalho.config, base: trabalho.ctx.base }));
}

function localDaEntrada(chave: string): string {
  return path.join(cacheRoot(), 'incremental', `${chave}.json`);
}

export function consultarCacheIncremental(trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec): ConsultaIncremental {
  const escopo = escopoDaFerramenta(ferramenta);
  if (!escopo) return { escopo: null, atual: null, anterior: null, alterados: [], reutilizado: null };
  const retrato: Retrato = { escopo, arquivos: arquivos(trabalho.ctx.headTree, escopo) };
  if (escopo === 'lockfile' && Object.keys(retrato.arquivos).length === 0) {
    return { escopo, atual: retrato, anterior: null, alterados: [], reutilizado: null };
  }
  const chave = identidade(trabalho, ferramenta);
  try {
    const entrada = JSON.parse(fs.readFileSync(localDaEntrada(chave), 'utf8')) as Entrada;
    if (entrada.contrato !== CONTRATO || entrada.chave !== chave || entrada.resultado?.run?.state !== 'ran') {
      return { escopo, atual: retrato, anterior: null, alterados: [], reutilizado: null };
    }
    const nomes = new Set([...Object.keys(entrada.retrato.arquivos), ...Object.keys(retrato.arquivos)]);
    const alterados = [...nomes].filter((nome) => entrada.retrato.arquivos[nome] !== retrato.arquivos[nome]).sort();
    return { escopo, atual: retrato, anterior: entrada.resultado, alterados,
      reutilizado: alterados.length === 0 ? entrada.resultado : null };
  } catch { return { escopo, atual: retrato, anterior: null, alterados: [], reutilizado: null }; }
}

export const lerCacheIncremental = (trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec): ToolResult | null =>
  consultarCacheIncremental(trabalho, ferramenta).reutilizado;

export function gravarCacheIncremental(trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec, resultado: ToolResult): void {
  const escopo = escopoDaFerramenta(ferramenta);
  if (!escopo || resultado.run.state !== 'ran') return;
  const retrato: Retrato = { escopo, arquivos: arquivos(trabalho.ctx.headTree, escopo) };
  if (escopo === 'lockfile' && Object.keys(retrato.arquivos).length === 0) return;
  const chave = identidade(trabalho, ferramenta), arquivo = localDaEntrada(chave);
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
    const temporario = `${arquivo}.${process.pid}.tmp`;
    const entrada: Entrada = { contrato: CONTRATO, chave, retrato, resultado };
    fs.writeFileSync(temporario, JSON.stringify(entrada), { mode: 0o600 });
    fs.renameSync(temporario, arquivo);
  } catch { /* cache ausente custa CPU, mas nunca muda o veredito */ }
}
