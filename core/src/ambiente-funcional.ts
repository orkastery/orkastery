/**
 * Ambiente funcional observado pelos testes das lanes e pelas claims que podem reaproveita-las.
 *
 * A lane atravessa `bash` e `npm` antes de chegar ao `test-lanes.cjs`; a claim candidata parte
 * direto do verify. Esta e a unica regra que retira transporte dessas duas rotas, aplica os
 * acrescimos funcionais da rodada e produz a assinatura comparada pelo reaproveitamento.
 */

import { createHash } from 'node:crypto';

/** O PATH anterior a shell/npm, transportado ate o controlador da lane. */
export const ENV_PATH_FUNCIONAL_DA_RODADA = 'ORK_CHECK_PATH_FUNCIONAL_DA_RODADA';

/**
 * Controles consumidos pela orquestracao, nunca pelos testes. PATH e ORK_CHECK_MODO nao sao
 * ignorados: o primeiro e restaurado e o segundo e removido dos dois ambientes efetivos.
 */
const VARIAVEIS_REMOVIDAS: ReadonlySet<string> = new Set([
  'ORK_CHECK_MODO',
  'ORK_CHECK_RELATORIO',
  'ORK_CHECK_CPUS_DA_LANE',
  'ORK_CHECK_CPUS_DA_LANE_APOS_VARREDURA',
  'ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA',
  'ORK_CHECK_RESERVA_DEVOLVIDA',
  'ORK_CHECK_CONTAINERS_DA_LANE',
  'ORK_CHECK_CPUS_DOCKER',
  'ORK_CHECK_TMPDIR_DA_RODADA',
  'ORK_WORKERS',
  ENV_PATH_FUNCIONAL_DA_RODADA,
  'NODE_TEST_CONTEXT',
  // Shell nao interativo pode executar estes arquivos antes do comando. O verify e a lane nao
  // dependem de inicializacao pessoal do chamador.
  'BASH_ENV',
  'ENV',
]);

/** Transporte do npm, do shell e do runner que nao entra no contrato funcional. */
function variavelIgnorada(nome: string): boolean {
  return nome.startsWith('npm_') || nome.startsWith('NPM_')
    || ['COLOR', 'NODE', 'EDITOR', 'NODE_COMPILE_CACHE', 'PWD', 'OLDPWD', 'SHLVL', '_', 'INIT_CWD'].includes(nome);
}

/** Monta o ambiente real dos testes, com as mesmas remocoes e acrescimos nas duas rotas. */
export function ambienteFuncionalDosTestes(base: NodeJS.ProcessEnv,
  acrescimos: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathDaRodada = base[ENV_PATH_FUNCIONAL_DA_RODADA];
  const ambiente = Object.fromEntries(Object.entries(base).filter(([nome, valor]) =>
    valor !== undefined && !VARIAVEIS_REMOVIDAS.has(nome) && !variavelIgnorada(nome)));
  if (pathDaRodada !== undefined) ambiente.PATH = pathDaRodada;
  for (const [nome, valor] of Object.entries(acrescimos)) {
    if (valor !== undefined) ambiente[nome] = valor;
  }
  return ambiente;
}

/**
 * Dados que deixam a lane recuperar o ambiente anterior ao shell/npm. BASH_ENV e ENV vazios
 * impedem inicializacao pessoal antes de o script aplicar a regra unica.
 */
export function transporteDoAmbienteFuncional(base: NodeJS.ProcessEnv): Record<string, string> {
  const pathDaRodada = ambienteFuncionalDosTestes(base).PATH;
  return {
    ...(pathDaRodada === undefined ? {} : { [ENV_PATH_FUNCIONAL_DA_RODADA]: pathDaRodada }),
    BASH_ENV: '',
    ENV: '',
  };
}

/** Assina exatamente o ambiente funcional montado pela regra unica. */
export function assinaturaDoAmbiente(base: NodeJS.ProcessEnv): string {
  const pares = Object.entries(ambienteFuncionalDosTestes(base)).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(pares)).digest('hex');
}
