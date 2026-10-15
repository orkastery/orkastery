/**
 * Os transportes do `ork_ship` do MCP. `github-ssh` e o SSH do GitHub de sempre; `bare-local`, um repositorio bare
 * fisico; `forja-ssh` e `forja-https` sao fixados na instalacao (`mcp-ship-transporte.ts`). Sem dependencia: o CLI
 * valida o argumento sem carregar o MCP.
 */
export const TRANSPORTES_SHIP_MCP = ['github-ssh', 'forja-ssh', 'forja-https', 'bare-local'] as const;
export type TransporteShipMcp = (typeof TRANSPORTES_SHIP_MCP)[number];
export type TransporteFixado = 'forja-ssh' | 'forja-https';

export function ehTransporteShipMcp(v: unknown): v is TransporteShipMcp {
  return typeof v === 'string' && (TRANSPORTES_SHIP_MCP as readonly string[]).includes(v);
}

export function ehTransporteFixado(v: unknown): v is TransporteFixado {
  return v === 'forja-ssh' || v === 'forja-https';
}
