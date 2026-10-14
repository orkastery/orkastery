import { z } from 'zod';
import type { ChamadorDaApi } from '../api';
import type { Resultado, VersaoDoServidor } from '../contrato';

const META = z.object({ verifiable_password_authentication: z.boolean(), installed_version: z.string().optional() });

/** `GET /meta`: o GitHub Enterprise Server diz a versao (`installed_version`); o github.com, nenhuma. */
export function metadadosGithub(e: { api: ChamadorDaApi }): Resultado<VersaoDoServidor> {
  const r = e.api({ metodo: 'GET', caminho: 'meta' });
  if (!r.ok) return r;
  const lido = META.safeParse(r.valor.corpo);
  if (!lido.success) return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: 'meta: verifiable_password_authentication' } };
  return { ok: true, valor: { versao: lido.data.installed_version ?? null, edicao: null } };
}
