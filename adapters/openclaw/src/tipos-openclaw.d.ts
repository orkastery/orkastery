/**
 * Tipos minimos do SDK de plugins do OpenClaw usados por este adapter.
 *
 * O modulo real e resolvido em runtime pelo proprio loader do OpenClaw (alias
 * `openclaw/plugin-sdk/*`); esta declaracao existe so para o tsc compilar sem
 * depender do pacote openclaw no repositorio. As formas espelham
 * `docs/plugins/tool-plugins.md` do OpenClaw 2026.7.1.
 */
declare module 'openclaw/plugin-sdk/tool-plugin' {
  /** Schema JSON literal: objeto simples, sem dependencia de typebox (decisao D1). */
  export type SchemaJson = Record<string, unknown>;

  export interface ContextoDaTool {
    signal?: AbortSignal;
    toolCallId?: string;
    onUpdate?: (atualizacao: unknown) => void;
    api?: unknown;
  }

  // Inspeção do SDK instalado, hook-types-DQ9eTy2x.d.ts: campos de inbound_claim.
  // Opcionais no SDK; ingresso nativo exige presença e igualdade com o binding.
  export interface IdentidadeInboundClaim {
    sessionKey?: string;
    commandAuthorized?: boolean;
    senderIsOwner?: boolean;
    accountId?: string;
    senderId?: string;
    conversationId?: string;
    messageId?: string;
  }

  export interface DefinicaoDeTool {
    name: string;
    label?: string;
    description: string;
    parameters?: SchemaJson;
    optional?: boolean;
    execute?: (
      params: Record<string, unknown>,
      config: Record<string, unknown>,
      contexto: ContextoDaTool
    ) => unknown | Promise<unknown>;
    factory?: (contexto: { api: unknown; config: unknown; toolContext: unknown }) => unknown;
  }

  export type FabricaDeTool = (definicao: DefinicaoDeTool) => DefinicaoDeTool;

  export interface DefinicaoDoPlugin {
    id: string;
    name: string;
    description: string;
    configSchema?: SchemaJson;
    activation?: { onStartup?: boolean };
    tools: (tool: FabricaDeTool) => DefinicaoDeTool[];
  }

  export function defineToolPlugin(definicao: DefinicaoDoPlugin): unknown;
}
