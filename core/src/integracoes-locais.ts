/**
 * I-53 (RM-037, D17): a lista unica dos testes que exigem integracao local.
 *
 * Sao os arquivos que dependem de recurso deliberadamente ausente no runner hospedado do GitHub
 * (Docker, OrkMind instalado, sessao de runtime). Antes a lista vivia duplicada em `ci.ts` e em
 * `scripts/test-ci.js`, e as duas copias podiam divergir sem ninguem ver. Agora `ci.ts` importa
 * daqui, e o script le o mesmo modulo ja compilado em `dist/` (o `test:ci` compila antes).
 */
export const TESTES_DE_INTEGRACAO_LOCAL: ReadonlySet<string> = new Set([
  'codex-controller-sensor.test.js', 'consulta-restrita-nativa.test.js', 'decision-identity.test.js', 'embedding-ponte.test.js',
  'mcp-git.test.js', 'mcp-server.test.js', 'mcp-ship.test.js', 'mcp-verify.test.js',
  'memory-native-preparation.test.js', 'memory-native-schema.test.js', 'memory-prospective.test.js',
  'memory-publication-profile.test.js', 'native-fixture.test.js', 'orkmind-transport.test.js', 'verify-sandbox.test.js',
  // RM-037 (fatia 3): o worker do ork_git_commit e o sandbox do verify de verdade, como no mcp-git.test.js.
  'rm037-fatia3-lease-mcp-git.test.js',
]);
