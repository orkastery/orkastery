/** Cache de resultado normalizado do Agile, por conteúdo e fora do repositório. */
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

const SCRIPT_DO_REGISTRO = String.raw`
# ORK_SEMGREP_RESOLVE_V1
import sys, urllib.request
pedido = urllib.request.Request(sys.argv[1], headers={"Accept": "application/json", "User-Agent": "orkastery-security-scan"})
with urllib.request.urlopen(pedido, timeout=20) as resposta:
    if resposta.status != 200:
        raise RuntimeError("HTTP " + str(resposta.status))
    sys.stdout.buffer.write(resposta.read())
`;

/** O mesmo endpoint público para o qual o resolvedor do Semgrep mapeia um id do registro. */
function urlDoRegistro(referencia: string): string | null {
  if (/^[prs]\/[A-Za-z0-9._/-]+$/.test(referencia)) return `https://semgrep.dev/c/${referencia}`;
  if (/^https:\/\//.test(referencia)) return referencia;
  return null;
}

function baixarDoRegistro(ferramenta: ToolSpec, url: string): string | null {
  const uid = process.getuid?.() ?? 65534;
  const gid = process.getgid?.() ?? 65534;
  const nome = `ork-security-scan-semgrep-registry-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const r = spawnSync('docker', ['run', '--rm', '--name', nome, '--user', `${uid === 0 ? 65534 : uid}:${uid === 0 ? 65534 : gid}`,
    '--network', 'default', '--entrypoint', 'python3', ferramenta.image, '-c', SCRIPT_DO_REGISTRO, url],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) spawnSync('docker', ['rm', '-f', nome], { stdio: 'ignore', timeout: 10_000 });
  return !r.error && r.status === 0 && r.stdout.trim() ? r.stdout : null;
}

/** O conteúdo que o próprio Semgrep extrai da resposta do registro (`rules` direto ou envelope `rule_config`). */
function conteudoResolvido(resposta: string): string {
  try {
    const json = JSON.parse(resposta) as Record<string, unknown>;
    const regras = Object.prototype.hasOwnProperty.call(json, 'rules') ? json : json.rule_config;
    return typeof regras === 'string' ? regras : JSON.stringify(regras);
  } catch { return resposta; }
}

function regraEntreArquivos(conteudo: string): boolean {
  let valor: unknown = conteudo;
  try { valor = JSON.parse(conteudo); } catch { /* YAML: a inspeção textual conservadora vem abaixo */ }
  const visitar = (atual: unknown): boolean => {
    if (Array.isArray(atual)) return atual.some(visitar);
    if (!atual || typeof atual !== 'object') return false;
    return Object.entries(atual as Record<string, unknown>).some(([chave, filho]) => {
      const normal = chave.toLowerCase().replace(/[-_]/g, '');
      if (normal === 'mode' && typeof filho === 'string' && /^(join|interfile|crossfile|multifile)$/i.test(filho)) return true;
      if (['join', 'interfile', 'crossfile', 'multifile'].includes(normal) && filho !== false && filho !== null) return true;
      return visitar(filho);
    });
  };
  return visitar(valor) || /(?:^|[\s{,])(?:mode\s*:\s*)?(?:join|inter[-_ ]?file|cross[-_ ]?file|multi[-_ ]?file)(?:\s*:|\s*$)/im.test(conteudo);
}

function referenciasDasRegras(ferramenta: ToolSpec, unidades: TrabalhoDaFerramenta['units']): string[] {
  const stacks = new Set(unidades.map((u) => u.stack).filter((s): s is NonNullable<typeof s> => !!s));
  const referencias = new Set<string>();
  for (const stack of stacks) {
    const args = ferramenta.argsByStack?.[stack] ?? [];
    for (let i = 0; i < args.length - 1; i++) if (args[i] === '--config' || args[i] === '-f') referencias.add(args[++i]);
  }
  return [...referencias].sort();
}

export function resolverRegrasSemgrep(ferramenta: ToolSpec, unidades: TrabalhoDaFerramenta['units'],
  baixar: (ferramenta: ToolSpec, url: string) => string | null = baixarDoRegistro): NonNullable<TrabalhoDaFerramenta['regrasSemgrep']> {
  const referencias = referenciasDasRegras(ferramenta, unidades);
  if (referencias.length === 0) return { reutilizavel: false, hash: null, motivo: 'regras-sem-referencia', referencias };
  const resolvidas: Array<[string, string]> = [];
  for (const referencia of referencias) {
    const url = urlDoRegistro(referencia);
    if (!url) return { reutilizavel: false, hash: null, motivo: 'referencia-de-regra-nao-resolvivel', referencias };
    const resposta = baixar(ferramenta, url);
    if (!resposta) return { reutilizavel: false, hash: null, motivo: 'registro-indisponivel', referencias };
    const conteudo = conteudoResolvido(resposta);
    if (regraEntreArquivos(conteudo)) return { reutilizavel: false, hash: null, motivo: 'regra-entre-arquivos', referencias };
    resolvidas.push([referencia, conteudo]);
  }
  return { reutilizavel: true, hash: sha256(JSON.stringify(resolvidas)), referencias };
}

/** Só habilita o que tem garantia explícita: Semgrep por arquivo e dependências por lockfile. */
function escopoDaFerramenta(t: ToolSpec, trabalho: TrabalhoDaFerramenta): Escopo | null {
  if (t.name === 'semgrep') {
    // A API direta antecede o trabalhador e continua útil para conferir o retrato por arquivo isoladamente. No caminho
    // real do Agile, `incremental: true` torna obrigatória a identidade das regras resolvidas: ausência, registro
    // indisponível ou regra entre arquivos nunca cai nesta compatibilidade.
    if (trabalho.incremental !== true) return 'arquivo';
    return trabalho.regrasSemgrep?.reutilizavel && trabalho.regrasSemgrep.hash ? 'arquivo' : null;
  }
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
  return sha256(JSON.stringify({ ferramenta, unidades: trabalho.units, configuracao: trabalho.config, base: trabalho.ctx.base,
    regrasSemgrep: trabalho.regrasSemgrep?.hash ?? null }));
}

function localDaEntrada(chave: string): string {
  return path.join(cacheRoot(), 'incremental', `${chave}.json`);
}

export function consultarCacheIncremental(trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec): ConsultaIncremental {
  const escopo = escopoDaFerramenta(ferramenta, trabalho);
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
  const escopo = escopoDaFerramenta(ferramenta, trabalho);
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
