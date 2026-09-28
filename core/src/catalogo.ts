/**
 * Onde mora o catalogo do produto (bloco B4).
 *
 * O `ork` roda de dentro de `core/dist`, de `core/dist-test` e, instalado, de qualquer lugar
 * do PATH, mas o catalogo de skills, as checklists normativas e os adaptadores de host sao
 * arquivos do produto, nao codigo compilado. Este modulo resolve essa raiz uma unica vez, em
 * um lugar so, para nao existirem duas regras de "onde estao as skills" divergindo em
 * silencio (que e exatamente o defeito que os proprios evals cacam nas skills).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** O que precisa existir para um diretorio ser a raiz do catalogo. */
const MARCAS = ['skills', 'references', 'eval'];

function ehRaizDoCatalogo(dir: string): boolean {
  return MARCAS.every((m) => fs.existsSync(path.join(dir, m)));
}

function subirProcurando(inicial: string): string | null {
  let atual = path.resolve(inicial);
  for (;;) {
    if (ehRaizDoCatalogo(atual)) return atual;
    const pai = path.dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

/**
 * A raiz do catalogo: o diretorio que tem `skills/`, `references/` e `eval/`.
 *
 * Procura a partir do diretorio informado (ou do cwd) e depois a partir do proprio codigo,
 * que e o caminho que vale quando o `ork` roda instalado, fora do repositorio do produto.
 */
export function raizDoCatalogo(inicial?: string): string | null {
  return subirProcurando(inicial ?? process.cwd()) ?? subirProcurando(__dirname);
}

/** A raiz do catalogo, com erro tipado quando o `ork` nao consegue achar o produto. */
export function exigirCatalogo(inicial?: string): string {
  const raiz = raizDoCatalogo(inicial);
  if (!raiz) {
    throw new Error(
      'catalogo do Orkastery nao encontrado (esperado um diretorio com skills/, references/ e eval/)'
    );
  }
  return raiz;
}

export interface SkillDoCatalogo {
  nome: string;
  bucket: string;
  caminho: string;
  /** Caminho relativo a raiz do catalogo, o mesmo que vai para o manifesto do plugin. */
  relativo: string;
}

/** Os buckets do catalogo, na ordem em que o README os apresenta. */
export const BUCKETS: readonly string[] = [
  'core',
  'phases',
  'reviewers',
  'governance',
  'observability',
];

/** Todas as skills do catalogo, varridas do disco (nunca de uma lista escrita a mao). */
/**
 * O CLI que um canario chama. No repositorio ele fica em `core/dist/`; no pacote npm o catalogo e
 * a propria raiz do pacote e o CLI e o que esta rodando, ao lado deste arquivo compilado.
 */
export function cliDoCatalogo(catalogo: string): string {
  const doRepositorio = path.join(catalogo, 'core', 'dist', 'index.js');
  return fs.existsSync(doRepositorio) ? doRepositorio : path.join(__dirname, 'index.js');
}

export function skillsDoCatalogo(raiz: string): SkillDoCatalogo[] {
  const achadas: SkillDoCatalogo[] = [];
  for (const bucket of BUCKETS) {
    const dirBucket = path.join(raiz, 'skills', bucket);
    if (!fs.existsSync(dirBucket)) continue;
    for (const nome of fs.readdirSync(dirBucket).sort()) {
      const caminho = path.join(dirBucket, nome, 'SKILL.md');
      if (!fs.existsSync(caminho)) continue;
      achadas.push({
        nome,
        bucket,
        caminho,
        relativo: path.join('skills', bucket, nome, 'SKILL.md'),
      });
    }
  }
  return achadas;
}

/** As 5 checklists normativas citaveis por item (`DoD 4`, `SEC 5`). */
export function referenciasDoCatalogo(raiz: string): string[] {
  const dir = path.join(raiz, 'references');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((a) => a.endsWith('.md'))
    .sort()
    .map((a) => path.join(dir, a));
}
