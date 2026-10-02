/**
 * RM-031 KG2 (D8): leitura do repositorio Git local para o extrator. E a unica borda de E/S do
 * KG2: lista os arquivos rastreados, le os bytes da arvore de trabalho e fixa a revisao. Nao
 * executa shell nem texto vindo do repositorio; o Git roda com argumentos fixos. O KG3 usa daqui a
 * identidade da leitura e a revisao da arvore limpa, sem ler os arquivos.
 *
 * Fica fora e declarado: link simbolico, submodulo, arquivo em conflito, arquivo rastreado que
 * sumiu da arvore, arquivo cujo caminho real sai da raiz e caminho que nao e UTF-8. A revisao so e
 * o HEAD quando nada rastreado mudou e os bytes lidos sao os blobs do indice (sem filtro do Git).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EntradaDeExtracao, Exclusao, FonteDoRepositorio } from './intelligence-graph-extract';
import { lerYaml } from './yaml';

export interface OpcoesDeLeitura {
  tenant_id?: string;
  /** Padrao: `project.name` do `orkastery.yaml` da raiz. */
  repository_id?: string;
  /** Padrao: uma referencia de leitura do repositorio, `repo:<repositorio>:leitura`. */
  acl_refs?: readonly string[];
}

export const TENANT_PADRAO = 'local';
const ID_DE_REPOSITORIO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Git com argumentos fixos; o fsmonitor do repositorio nao roda (seria comando externo configurado nele). */
function git(raiz: string, args: string[]): { ok: boolean; saida: Buffer } {
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: raiz, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return { ok: r.status === 0, saida: r.stdout ?? Buffer.alloc(0) };
}

function obrigatorio(raiz: string, args: string[]): Buffer {
  const r = git(raiz, args);
  if (!r.ok) throw new Error(`extracao.repositorio.git-falhou em git ${args[0]}`);
  return r.saida;
}

const utf8 = (b: Buffer): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
};

/** Nome do projeto no `orkastery.yaml`, quando ha um valido na raiz. */
function nomeDoProjeto(raiz: string): string | null {
  const arquivo = path.join(raiz, 'orkastery.yaml');
  if (!fs.existsSync(arquivo)) return null;
  try {
    const dados = lerYaml(fs.readFileSync(arquivo, 'utf8'));
    const projeto = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados.project : null;
    const nome = projeto && typeof projeto === 'object' && !Array.isArray(projeto) ? projeto.name : null;
    return typeof nome === 'string' && ID_DE_REPOSITORIO.test(nome) ? nome : null;
  } catch {
    return null;
  }
}

/** Repositorio, tenant e ACL da leitura: os informados, ou os padroes (D8). */
export function identidadeDaLeitura(raiz: string, opcoes: OpcoesDeLeitura = {}): { repository_id: string; tenant_id: string; acl_refs: string[] } {
  const repositorio = opcoes.repository_id ?? nomeDoProjeto(raiz);
  if (!repositorio || !ID_DE_REPOSITORIO.test(repositorio)) throw new Error('extracao.repositorio.sem-id');
  return { repository_id: repositorio, tenant_id: opcoes.tenant_id ?? TENANT_PADRAO, acl_refs: [...(opcoes.acl_refs ?? [`repo:${repositorio}:leitura`])] };
}

export interface RevisaoDaArvore {
  raiz: string;
  /** O HEAD, tambem com a arvore modificada; `null` sem commit. */
  head: string | null;
  /** `null` com a arvore limpa nos rastreados; senao o motivo de nao haver revisao. */
  motivo: 'sem-commit' | 'working-tree-modified' | null;
}

/**
 * RM-031 KG3 (D3): o HEAD e se a arvore esta limpa nos rastreados, sem ler arquivo nenhum. O filtro
 * do Git (eol, LFS) so aparece lendo os bytes: quem indexa confere a revisao do `lerRepositorio`.
 */
export function revisaoDaArvore(diretorio: string): RevisaoDaArvore {
  const raiz = obrigatorio(diretorio, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const head = git(raiz, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (!head.ok) return { raiz, head: null, motivo: 'sem-commit' };
  const sujo = obrigatorio(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).length > 0;
  return { raiz, head: head.saida.toString('utf8').trim(), motivo: sujo ? 'working-tree-modified' : null };
}

/**
 * RM-031 KG3 (CHECK rodada 1, A6): o HEAD de cada arvore do repositorio (a principal e as worktrees),
 * pelo `git worktree list --porcelain`. O estado do indice e compartilhado entre elas.
 */
export function headsDasArvores(diretorio: string): string[] {
  const saida = obrigatorio(diretorio, ['worktree', 'list', '--porcelain']).toString('utf8');
  return [...new Set(saida.split('\n').filter((l) => /^HEAD [0-9a-f]{40,64}$/.test(l)).map((l) => l.slice(5)))].sort();
}

/**
 * RM-031 KG4 (D1): o HEAD e as revisoes ancestrais dele (`git rev-list`), da mais recente para a mais
 * antiga, ate o limite. Sem commit, ou com o Git falhando, nao ha ancestral.
 */
export function revisoesAncestrais(diretorio: string, limite: number): string[] {
  const raiz = obrigatorio(diretorio, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const r = git(raiz, ['rev-list', `--max-count=${Math.max(1, Math.floor(limite))}`, 'HEAD']);
  return r.ok ? r.saida.toString('utf8').split('\n').filter((l) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(l)) : [];
}

/** Le o repositorio que contem `diretorio` e devolve a entrada do extrator. */
export function lerRepositorio(diretorio: string, opcoes: OpcoesDeLeitura = {}): EntradaDeExtracao {
  const raiz = obrigatorio(diretorio, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const { repository_id: repositorio, tenant_id, acl_refs } = identidadeDaLeitura(raiz, opcoes);

  // `-s` traz modo e estagio: 120000 e link simbolico, 160000 e submodulo, estagio > 0 e conflito.
  const registros = obrigatorio(raiz, ['ls-files', '-z', '-s', '--full-name']);
  const porCaminho = new Map<string, { modo: string; objeto: string; estagios: number }>(), excluidas: Exclusao[] = [];
  let inicio = 0;
  for (let i = 0; i < registros.length; i++) {
    if (registros[i] !== 0) continue;
    const registro = registros.subarray(inicio, i);
    inicio = i + 1;
    const tab = registro.indexOf(0x09);
    if (tab < 0) continue;
    const [modo, objeto, estagio] = registro.subarray(0, tab).toString('latin1').split(' ');
    const caminho = utf8(registro.subarray(tab + 1));
    if (caminho === null) {
      excluidas.push({ path: registro.subarray(tab + 1).toString('latin1'), motivo: 'caminho-nao-utf8' });
      continue;
    }
    const atual = porCaminho.get(caminho);
    porCaminho.set(caminho, { modo, objeto, estagios: (atual?.estagios ?? 0) + (estagio === '0' ? 0 : 1) });
  }

  const fontes: FonteDoRepositorio[] = [], raizReal = fs.realpathSync(raiz);
  let filtrado = false;
  for (const [caminho, { modo, objeto, estagios }] of porCaminho) {
    if (estagios > 0) excluidas.push({ path: caminho, motivo: 'conflito-de-merge' });
    else if (modo === '120000') excluidas.push({ path: caminho, motivo: 'link-simbolico' });
    else if (modo === '160000') excluidas.push({ path: caminho, motivo: 'submodulo' });
    else {
      const absoluto = path.join(raiz, caminho);
      const st = fs.lstatSync(absoluto, { throwIfNoEntry: false });
      if (!st) excluidas.push({ path: caminho, motivo: 'ausente-na-arvore' });
      else if (!st.isFile()) excluidas.push({ path: caminho, motivo: 'nao-e-arquivo' });
      // Pasta do caminho trocada por link simbolico levaria a leitura para fora do repositorio.
      else if (!fs.realpathSync(absoluto).startsWith(raizReal + path.sep)) excluidas.push({ path: caminho, motivo: 'fora-do-repositorio' });
      else {
        const bytes = fs.readFileSync(absoluto);
        if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== objeto) filtrado = true;
        fontes.push({ path: caminho, bytes });
      }
    }
  }

  const head = git(raiz, ['rev-parse', '--verify', '-q', 'HEAD']);
  const sujo = obrigatorio(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).length > 0;
  const revisao = head.ok ? head.saida.toString('utf8').trim() : null;
  // A5: filtro do Git (eol, LFS) deixa o status limpo com bytes que nao sao o blob da revisao.
  const motivo = !revisao ? 'sem-commit' : sujo ? 'working-tree-modified' : filtrado ? 'filtro-do-git' : null;
  return {
    tenant_id,
    repository_id: repositorio,
    revision: motivo === null ? revisao : null,
    revision_unavailable_reason: motivo,
    acl_refs,
    fontes,
    excluidas,
  };
}
