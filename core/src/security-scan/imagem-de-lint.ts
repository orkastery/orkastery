/**
 * RM-072 (D11 da ork-check5x): a imagem de lint pre-montada do Agile Check.
 *
 * O `eslint` do catalogo roda na imagem do node e faz `npm install` do `eslint`, do `typescript-eslint` e do `typescript`
 * a cada execucao, na HEAD e na base. O Agile monta uma vez a imagem local `orkastery-eslint-agil:<hash>` a partir do
 * mesmo digest do node e do mesmo `install` do catalogo (com `--ignore-scripts`), e roda o mesmo script com o
 * `node_modules` da imagem no lugar do `npm install`: as mesmas versoes, a mesma config e as mesmas opcoes, sem rede. O
 * hash junta imagem, `install` e versao, entao catalogo novo gera imagem nova. Sem a imagem, o `eslint` do catalogo.
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import type { ToolSpec } from './types';

export const PREFIXO_DA_IMAGEM_DE_LINT = 'orkastery-eslint-agil';

/** O trecho do script do catalogo que a imagem substitui. */
const INSTALACAO_DO_CATALOGO = 'npm install --prefix /tmp/lint --ignore-scripts --no-audit --no-fund --no-save {install} >&2';
const NODE_MODULES_DA_IMAGEM = 'ln -s /opt/lint/node_modules /tmp/lint/node_modules';
const PRAZO_DA_CONSULTA_MS = 20_000;

/** A tag da imagem local: o hash da imagem do catalogo, do `install` e da versao. */
export function tagDaImagemDeLint(t: ToolSpec): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify({ image: t.image, install: t.install ?? [], version: t.version }))
    .digest('hex').slice(0, 16);
  return `${PREFIXO_DA_IMAGEM_DE_LINT}:${hash}`;
}

/** O Dockerfile da imagem: o node do catalogo, pelo digest, com o `install` do catalogo em /opt/lint. */
export function dockerfileDeLint(t: ToolSpec): string {
  return [`FROM ${t.image}`,
    `RUN mkdir -p /opt/lint && npm install --prefix /opt/lint --ignore-scripts --no-audit --no-fund --no-save ${(t.install ?? []).join(' ')}`,
    ''].join('\n');
}

/** A imagem local presente, ou montada agora; o motivo quando nao deu (sem rede, build que falhou, prazo). */
export function garantirImagemDeLint(t: ToolSpec, prazoMs: number): { tag: string } | { motivo: string } {
  const tag = tagDaImagemDeLint(t);
  const presente = spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore', timeout: PRAZO_DA_CONSULTA_MS });
  if (!presente.error && presente.status === 0) return { tag };
  if (prazoMs <= 0) return { motivo: 'sem prazo para montar a imagem' };
  const build = spawnSync('docker', ['build', '--quiet', '-t', tag, '-'], { input: dockerfileDeLint(t), encoding: 'utf8', timeout: prazoMs,
    killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  if (build.error || build.status !== 0) {
    const ultima = (build.stderr ?? '').split('\n').filter((l) => l.trim()).pop()?.trim().slice(0, 160) ?? '';
    return { motivo: `docker build ${build.error ? (build.error as NodeJS.ErrnoException).code ?? build.error.message : `saiu ${build.status}`}` +
      `${ultima ? `: ${ultima}` : ''}` };
  }
  return { tag };
}

/**
 * O `eslint` com a imagem local: o mesmo script, com o `node_modules` da imagem no lugar do `npm install`, e sem rede.
 * `null` quando o script do catalogo nao tem o trecho esperado (catalogo mudou): o Agile usa o do catalogo.
 */
export function eslintComImagem(t: ToolSpec, tag: string): ToolSpec | null {
  const script = t.args[2];
  if (t.args[0] !== 'sh' || typeof script !== 'string' || !script.includes(INSTALACAO_DO_CATALOGO)) return null;
  return { ...t, image: tag, network: 'none', args: [t.args[0], t.args[1], script.replace(INSTALACAO_DO_CATALOGO, NODE_MODULES_DA_IMAGEM),
    ...t.args.slice(3)] };
}
