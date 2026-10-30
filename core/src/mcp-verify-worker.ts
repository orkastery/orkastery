/** Processo destacado do verify MCP. Toda autoridade vem do estado criado pelo servidor. */
import { executarVerifyMcpWorker } from './mcp-verify-async';

if (require.main === module) {
  const [raiz, threadId, rodadaId, ...resto] = process.argv.slice(2);
  if (!raiz || !threadId || !rodadaId || resto.length) process.exitCode = 2;
  else {
    try { executarVerifyMcpWorker(raiz, threadId, rodadaId); }
    catch { process.exitCode = 1; }
  }
}
