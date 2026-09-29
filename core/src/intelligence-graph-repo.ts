/**
 * RM-031 KG2 (D8): leitura do repositorio Git local para o extrator. E a unica borda de E/S do
 * KG2: lista os arquivos rastreados, le os bytes da arvore de trabalho e fixa a revisao. Nao
 * executa shell nem texto vindo do repositorio; o Git roda com argumentos fixos.
 *
 * Fica fora e declarado: link simbolico, submodulo, arquivo em conflito, arquivo rastreado que
 * sumiu da arvore e caminho que nao e UTF-8. A revisao so e o HEAD quando nada rastreado mudou.
 */
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

function git(raiz: string, args: string[]): { ok: boolean; saida: Buffer } {
  const r = spawnSync('git', args, { cwd: raiz, maxBuffer: 512 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
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

/** Le o repositorio que contem `diretorio` e devolve a entrada do extrator. */
export function lerRepositorio(diretorio: string, opcoes: OpcoesDeLeitura = {}): EntradaDeExtracao {
  const raiz = obrigatorio(diretorio, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const repositorio = opcoes.repository_id ?? nomeDoProjeto(raiz);
  if (!repositorio || !ID_DE_REPOSITORIO.test(repositorio)) throw new Error('extracao.repositorio.sem-id');

  // `-s` traz modo e estagio: 120000 e link simbolico, 160000 e submodulo, estagio > 0 e conflito.
  const registros = obrigatorio(raiz, ['ls-files', '-z', '-s', '--full-name']);
  const porCaminho = new Map<string, { modo: string; estagios: number }>(), excluidas: Exclusao[] = [];
  let inicio = 0;
  for (let i = 0; i < registros.length; i++) {
    if (registros[i] !== 0) continue;
    const registro = registros.subarray(inicio, i);
    inicio = i + 1;
    const tab = registro.indexOf(0x09);
    if (tab < 0) continue;
    const [modo, , estagio] = registro.subarray(0, tab).toString('latin1').split(' ');
    const caminho = utf8(registro.subarray(tab + 1));
    if (caminho === null) {
      excluidas.push({ path: registro.subarray(tab + 1).toString('latin1'), motivo: 'caminho-nao-utf8' });
      continue;
    }
    const atual = porCaminho.get(caminho);
    porCaminho.set(caminho, { modo, estagios: (atual?.estagios ?? 0) + (estagio === '0' ? 0 : 1) });
  }

  const fontes: FonteDoRepositorio[] = [];
  for (const [caminho, { modo, estagios }] of porCaminho) {
    if (estagios > 0) excluidas.push({ path: caminho, motivo: 'conflito-de-merge' });
    else if (modo === '120000') excluidas.push({ path: caminho, motivo: 'link-simbolico' });
    else if (modo === '160000') excluidas.push({ path: caminho, motivo: 'submodulo' });
    else {
      const absoluto = path.join(raiz, caminho);
      const st = fs.lstatSync(absoluto, { throwIfNoEntry: false });
      if (!st) excluidas.push({ path: caminho, motivo: 'ausente-na-arvore' });
      else if (!st.isFile()) excluidas.push({ path: caminho, motivo: 'nao-e-arquivo' });
      else fontes.push({ path: caminho, bytes: fs.readFileSync(absoluto) });
    }
  }

  const head = git(raiz, ['rev-parse', '--verify', '-q', 'HEAD']);
  const sujo = obrigatorio(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).length > 0;
  const revisao = head.ok ? head.saida.toString('utf8').trim() : null;
  return {
    tenant_id: opcoes.tenant_id ?? TENANT_PADRAO,
    repository_id: repositorio,
    revision: revisao && !sujo ? revisao : null,
    revision_unavailable_reason: !revisao ? 'sem-commit' : sujo ? 'working-tree-modified' : null,
    acl_refs: opcoes.acl_refs ?? [`repo:${repositorio}:leitura`],
    fontes,
    excluidas,
  };
}
