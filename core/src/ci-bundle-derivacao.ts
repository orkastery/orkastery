/** Contrato leve da origem local do bundle, sem importar o runner ou o grafo do MCP. */
export const CONTRATO_DERIVACAO_BUNDLE_CI = 'ork.ci-bundle-derivacao/v1' as const;

export interface DerivacaoDoBundleCi {
  contrato: typeof CONTRATO_DERIVACAO_BUNDLE_CI;
  thread: string;
  head: string;
  verifyRun: string;
}
