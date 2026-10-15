import { z } from 'zod';
import type { ChamadorDaApi } from '../api';
import type { Resultado, VersaoDoServidor } from '../contrato';

const METADATA = z.object({ version: z.string().regex(/^\d+\.\d+/), enterprise: z.boolean() });

/** `GET /metadata`: a versao e a edicao da instancia. Responde tambem abaixo do piso (16.11 gravada), e a recusa e de quem le. */
export function metadadosGitlab(e: { api: ChamadorDaApi }): Resultado<VersaoDoServidor> {
  const r = e.api({ metodo: 'GET', caminho: 'metadata' });
  if (!r.ok) return r;
  const lido = METADATA.safeParse(r.valor.corpo);
  if (!lido.success) return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: 'metadata: version, enterprise' } };
  return { ok: true, valor: { versao: lido.data.version, edicao: lido.data.enterprise ? 'ee' : 'ce' } };
}
