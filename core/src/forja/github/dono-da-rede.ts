/**
 * O dono da casa da rede no GitHub, como a rede sempre fez: so o proprio login (`GET user`), comparado exatamente como
 * a rede compara hoje; organizacao nao e dono. Qualquer outro dono sai `forja.nao-achei`.
 */
import type { ChamadorDaApi } from '../api';
import type { DonoDaRede, Resultado } from '../contrato';

export function donoDaRedeGithub(e: { api: ChamadorDaApi; dono: string }): Resultado<DonoDaRede> {
  if (!e.dono.trim()) return { ok: false, erro: { codigo: 'forja.nao-achei', detalhe: 'dono vazio' } };
  const eu = e.api({ metodo: 'GET', caminho: 'user' });
  if (!eu.ok) return eu;
  const c = eu.valor.corpo;
  const p = c && typeof c === 'object' && !Array.isArray(c) ? c as Record<string, unknown> : null;
  if (!p || typeof p.login !== 'string' || !Number.isSafeInteger(p.id) || (p.id as number) <= 0) {
    return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: 'user' } };
  }
  if (p.login !== e.dono) return { ok: false, erro: { codigo: 'forja.nao-achei', detalhe: `${e.dono}: nao e o login ${p.login}` } };
  return { ok: true, valor: { tipo: 'usuario', caminho: p.login, namespaceId: p.id as number, nivel: null } };
}
