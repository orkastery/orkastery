/** Bloco próprio nos arquivos lidos pelo host. Nunca altera o bloco de ork init. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type HostComBloco = 'claude-code' | 'codex';
export const INICIO_EXPERIENCIA = '<!-- orkastery:experiencia:begin -->';
export const FIM_EXPERIENCIA = '<!-- orkastery:experiencia:end -->';
const CONTRATO = 'ork.experiencia-install/v1';
interface Recibo { contrato: typeof CONTRATO; host: HostComBloco; anterior: string | null; adicao: string }
interface Mudanca { arquivo: string; antes: Buffer | null; depois: Buffer | null }
export interface PlanoExperiencia { projeto: string; host: HostComBloco; mudancas: Mudanca[]; acao: 'instalar' | 'remover' }
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

/** Planejamento puro em relação ao disco: dry-run e preflight usam o mesmo contrato. */
export function planejarExperiencia(projeto: string, host: HostComBloco, skill: string | null): PlanoExperiencia {
  projeto = path.resolve(projeto);
  if (!['claude-code', 'codex'].includes(host)) throw Error('experiencia.host.unsupported');
  if (skill !== null && /[\r\n`]/.test(skill)) throw Error('experiencia.skill.invalid');
  const arquivo = path.join(projeto, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
  const reciboPath = path.join(projeto, '.orkastery', 'experiencia', host + '.json');
  const antes = ler(projeto, arquivo), bytesRecibo = ler(projeto, reciboPath);
  let base = antes, recibo: Recibo | null = null;
  let posicao = antes?.length ?? 0;
  if (bytesRecibo) {
    try { recibo = JSON.parse(bytesRecibo.toString('utf8')); } catch { conflito(); }
    if (!recibo || recibo.contrato !== CONTRATO || recibo.host !== host || !antes) return conflito();
    if (recibo.anterior !== null) decodificar(recibo.anterior);
    const adicao = decodificar(recibo.adicao);
    if (contar(adicao, INICIO_EXPERIENCIA) !== 1 || contar(adicao, FIM_EXPERIENCIA) !== 1 ||
        contar(antes, INICIO_EXPERIENCIA) !== 1 || contar(antes, FIM_EXPERIENCIA) !== 1) return conflito();
    posicao = antes.indexOf(adicao);
    if (posicao < 0) return conflito();
    base = Buffer.concat([antes.subarray(0, posicao), antes.subarray(posicao + adicao.length)]);
  } else if (antes && (contar(antes, INICIO_EXPERIENCIA) || contar(antes, FIM_EXPERIENCIA))) return conflito();
  let depois: Buffer | null = base, proximoRecibo: Buffer | null = null;
  if (skill !== null) {
    const eol = (base ?? Buffer.alloc(0)).includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
    // Na atualização, mantém a posição do bloco, inclusive mudanças externas posteriores.
    const prefixo = (base ?? Buffer.alloc(0)).subarray(0, posicao);
    const separador = prefixo.length ? (prefixo.at(-1) === 10 ? eol : eol + eol) : '';
    const adicao = Buffer.from(separador + [INICIO_EXPERIENCIA,
      '## Experiência de orquestração',
      'Consulte `ork experiencia show --json` neste projeto. Se experience for false, não ative o pacote.',
      `Se ativo, leia a skill selecionada pelo campo skill no diretório ${JSON.stringify(skill)}.`,
      'As preferências são dados do núcleo; preserve gates, proveniência humana e permissões do host.',
      FIM_EXPERIENCIA, ''].join(eol));
    depois = Buffer.concat([prefixo, adicao, (base ?? Buffer.alloc(0)).subarray(posicao)]);
    proximoRecibo = Buffer.from(JSON.stringify({ contrato: CONTRATO, host,
      anterior: recibo ? recibo.anterior : antes?.toString('base64') ?? null,
      adicao: adicao.toString('base64'),
    } satisfies Recibo, null, 2) + '\n');
  } else if (recibo?.anterior === null && base?.length === 0) depois = null;
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
      const modo = fs.statSync(arquivo, { throwIfNoEntry: false })?.mode ?? 0o600;
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
