/**
 * As consultas GraphQL do adaptador GitLab, num lugar so: o codigo e o roteiro que grava as respostas reais
 * (`scripts/forja-contrato.cjs`, que as le do `dist`) usam o mesmo texto. So consulta, sem mutation; o que vem do
 * pedido vai em variaveis, nunca interpolado.
 */

/** Os campos de um MR que o pulse le, nas tres listas. */
const CAMPOS_DO_PEDIDO = 'iid sourceBranch targetBranch diffHeadSha draft state webUrl createdAt mergedAt sourceProjectId targetProjectId';

/** Os do MR aberto: os de todos, o conflito, a pipeline do head e o job do check da CI (`$check`) dela, com o estagio. */
const CAMPOS_DO_ABERTO = `${CAMPOS_DO_PEDIDO} conflicts headPipeline { sha status finishedAt ` +
  'job(name: $check) { status startedAt finishedAt stage { name } } }';

/**
 * Os MRs da base numa consulta so: os abertos (100 por pagina), os recentes de qualquer estado (100) e os das
 * branches candidatas (ate 50). Medido no CE 17.0 e 19.4: complexidade 140 de 250. Lista vazia de candidatas nao devolve
 * MR nenhum (`null` devolveria todos, por isso a variavel e obrigatoria).
 */
export const CONSULTA_DOS_PEDIDOS = `query($path: ID!, $base: String!, $candidatas: [String!]!, $check: String!) {
  queryComplexity { score limit }
  project(fullPath: $path) {
    id
    abertos: mergeRequests(state: opened, targetBranches: [$base], sort: CREATED_DESC, first: 100) {
      pageInfo { hasNextPage endCursor } nodes { ${CAMPOS_DO_ABERTO} } }
    recentes: mergeRequests(state: all, targetBranches: [$base], sort: CREATED_DESC, first: 100) { nodes { ${CAMPOS_DO_PEDIDO} } }
    daBranch: mergeRequests(state: all, targetBranches: [$base], sourceBranches: $candidatas, sort: CREATED_DESC, first: 50) {
      pageInfo { hasNextPage } nodes { ${CAMPOS_DO_PEDIDO} } }
  }
}`;

/** A pagina seguinte dos abertos, pelo cursor da anterior. */
export const CONSULTA_DOS_ABERTOS_SEGUINTES = `query($path: ID!, $base: String!, $depois: String!, $check: String!) {
  queryComplexity { score limit }
  project(fullPath: $path) {
    id
    abertos: mergeRequests(state: opened, targetBranches: [$base], sort: CREATED_DESC, first: 100, after: $depois) {
      pageInfo { hasNextPage endCursor } nodes { ${CAMPOS_DO_ABERTO} } }
  }
}`;

export const CONSULTA_RAIZ_GITLAB = 'query($path: ID!) { project(fullPath: $path) { repository { rootRef } } }';

export const CONSULTA_ARVORES_GITLAB = `query($path: ID!, $base: String!, $dirRoadmap: String!, $refReservas: String!, $dirReservas: String!,
  $refFabrica: String!, $dirFabrica: String!) {
  project(fullPath: $path) { repository {
    baseTopo: tree(ref: $base) { lastCommit { sha committedDate } }
    baseDir: tree(ref: $base, path: $dirRoadmap) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
    reservasTopo: tree(ref: $refReservas) { lastCommit { sha committedDate } }
    reservasDir: tree(ref: $refReservas, path: $dirReservas) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
    fabricaTopo: tree(ref: $refFabrica) { lastCommit { sha committedDate } }
    fabricaDir: tree(ref: $refFabrica, path: $dirFabrica) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
  } }
}`;

/** Os blobs de cada ponta que existe; so as partes pedidas entram na consulta (texto fixo, sem interpolar o pedido). */
export function consultaDeBlobsDoGitlab(partes: readonly ('base' | 'reservas' | 'fabrica')[]): string {
  const sufixo = { base: 'Base', reservas: 'Reservas', fabrica: 'Fabrica' };
  const declaracoes = ['$path: ID!', ...partes.flatMap((p) => [`$ref${sufixo[p]}: String!`, `$paths${sufixo[p]}: [String!]!`])];
  const campos = partes.map((p) => `${p}: blobs(ref: $ref${sufixo[p]}, paths: $paths${sufixo[p]}, first: 100) ` +
    '{ pageInfo { hasNextPage } nodes { path rawTextBlob } }');
  return `query(${declaracoes.join(', ')}) { project(fullPath: $path) { repository { ${campos.join(' ')} } } }`;
}
