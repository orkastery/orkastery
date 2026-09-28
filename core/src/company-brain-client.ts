import { spawnSync } from 'node:child_process';
import { ManifestoCarregado } from './manifest';
import { memoryState } from './project-state';
import { CONTRACT_HASH, validateContract } from './company-brain-contract';
export const BRAIN_API = 'orkmind.company-brain-api/v1';
export type BrainOperation = 'capabilities' | 'ingest' | 'get' | 'query' | 'receipts' | 'head';
export interface BrainRequest { schema: typeof BRAIN_API; operation: BrainOperation; payload?: unknown; }
export interface BrainResponse { schema: typeof BRAIN_API; state: 'ok'|'empty'|'unknown'|'unavailable'|'withheld'|'forbidden'|'conflict'; error?: string; [key: string]: unknown; }
export type BrainTransport = (request: BrainRequest) => BrainResponse;
export function validateRequest(value: any): BrainRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== BRAIN_API ||
      Object.keys(value).some(k => !['schema','operation','payload'].includes(k)) ||
      !['capabilities','ingest','get','query','receipts','head'].includes(value.operation)) throw Error('brain.api.invalid');
  if (['ingest','query'].includes(value.operation)) {
    const body = validateContract<any>(value.payload);
    if (body.schema !== `orkmind.company-brain-${value.operation === 'ingest' ? 'event' : 'selection'}/v1`) throw Error('brain.api.invalid');
  }
  if (['get','receipts','head'].includes(value.operation)) {
    const keys = ['tenant_id',value.operation === 'receipts' ? 'event_id' : 'id'];
    if (!value.payload || Object.keys(value.payload).length !== 2 || keys.some(k => typeof value.payload[k] !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value.payload[k]))) throw Error('brain.api.invalid');
  }
  return JSON.parse(JSON.stringify(value));
}
export function brainClient(loaded: ManifestoCarregado, execute: typeof spawnSync = spawnSync): BrainTransport {
  const context = memoryState(loaded), config = context.loaded.manifesto.memory;
  return raw => {
    const request = validateRequest(raw);
    const unavailable = (error: string): BrainResponse => ({ schema:BRAIN_API,state:'unavailable',error });
    const dsn = config.database_url_env ? process.env[config.database_url_env] : undefined;
    if (config.mode !== 'orkmind' || (!dsn && request.operation !== 'capabilities')) return unavailable('brain.configuration.missing');
    const payload = request.payload as any;
    if (payload?.tenant_id !== undefined && payload.tenant_id !== config.tenant) return {schema:BRAIN_API,state:'forbidden',error:'brain.tenant.mismatch'};
    const result = execute(config.cli, ['brain','request'], { cwd: loaded.raiz, encoding:'utf8', timeout:Math.min(config.timeout_ms,15000),
      maxBuffer:2*1024*1024, input:JSON.stringify(request), shell:false,
      env:{ PATH:process.env.PATH ?? '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE:'1',
        ORKMIND_DATABASE_URL:dsn ?? '', ORKMIND_BRAIN_TENANT:config.tenant } });
    if (result.error || result.signal) return unavailable('brain.transport.unavailable');
    try {
      const response = JSON.parse(String(result.stdout));
      if (response.schema !== BRAIN_API || !['ok','empty','unknown','unavailable','withheld','forbidden','conflict'].includes(response.state)) throw Error();
      if (response.state === 'ok' && result.status !== 0) throw Error();
      if (request.operation === 'capabilities' && response.state === 'ok' && response.contract_hash !== CONTRACT_HASH) return unavailable('brain.contract.mismatch');
      if (response.error && !/^brain\.[a-z0-9.-]+$/.test(response.error)) return unavailable('brain.transport.invalid');
      return response;
    } catch { return unavailable('brain.transport.invalid'); }
  };
}
