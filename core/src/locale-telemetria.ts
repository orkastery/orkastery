/** Texto humano da telemetria. O JSON do comando permanece independente de locale. */
export const TELEMETRIA_PT_BR = {
  uso: 'uso: ork telemetria status|ligar|desligar|enviar [--dry-run] [--json]',
  status: (ligada: boolean, origem: string, motivo: string) =>
    `Telemetria: ${ligada ? 'ligada' : 'desligada'} (${origem}: ${motivo}).`,
  destino: (valor: string | null) => `Destino: ${valor ?? 'não configurado'}.`,
  pendencias: (threads: number, bytes: number) => `Pendências: ${threads} thread(s), ${bytes} byte(s).`,
  alterada: (ligada: boolean) => `Telemetria ${ligada ? 'ligada' : 'desligada'} na configuração privada.`,
  envioDesligado: 'Telemetria desligada: nenhum ledger, cabeçalho ou transporte foi aberto.',
  resultado: (thread: string, estado: string, registros: number) =>
    `${thread}: ${estado}; ${registros} LogRecord(s).`,
  payload: (thread: string) => `Payload de ${thread}:`,
};

export const TELEMETRIA_EN: typeof TELEMETRIA_PT_BR = {
  uso: 'usage: ork telemetria status|ligar|desligar|enviar [--dry-run] [--json]',
  status: (enabled, source, reason) => `Telemetry: ${enabled ? 'enabled' : 'disabled'} (${source}: ${reason}).`,
  destino: (value) => `Destination: ${value ?? 'not configured'}.`,
  pendencias: (threads, bytes) => `Pending: ${threads} thread(s), ${bytes} byte(s).`,
  alterada: (enabled) => `Telemetry ${enabled ? 'enabled' : 'disabled'} in the private configuration.`,
  envioDesligado: 'Telemetry is disabled: no ledger, header or transport was opened.',
  resultado: (thread, state, records) => `${thread}: ${state}; ${records} LogRecord(s).`,
  payload: (thread) => `Payload for ${thread}:`,
};
