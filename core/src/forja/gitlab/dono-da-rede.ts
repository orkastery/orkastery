/**
 * Quem e o dono pedido para a casa da rede no GitLab: o namespace (`GET namespaces/:caminho`) e, quando e grupo, o
 * nivel de acesso da pessoa nele, herdado inclusive (`GET groups/:id/members/all/:id-da-pessoa`). Namespace de outro
 * usuario e namespace que nao existe respondem o mesmo 404 a quem nao e admin: os dois saem `forja.nao-achei`. O nivel
 * minimo e decisao da rede, nao daqui.
 */
import type { ChamadorDaApi } from '../api';
import type { DonoDaRede, Resultado } from '../contrato';

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const invalida = (detalhe: string): { ok: false; erro: { codigo: 'forja.resposta-invalida'; detalhe: string } } =>
  ({ ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe } });

export function donoDaRedeGitlab(e: { api: ChamadorDaApi; dono: string }): Resultado<DonoDaRede> {
  const ns = e.api({ metodo: 'GET', caminho: `namespaces/${encodeURIComponent(e.dono)}` });
  if (!ns.ok) return ns;
  const n = ns.valor.corpo;
  if (!obj(n) || !id(n.id) || (n.kind !== 'user' && n.kind !== 'group') || typeof n.full_path !== 'string') return invalida(`namespaces/${e.dono}`);
  // O GitLab acha o namespace sem diferenciar maiusculas; outro caminho na resposta e outra coisa.
  if (n.full_path.toLowerCase() !== e.dono.toLowerCase()) return invalida(`namespaces/${e.dono}: ${n.full_path}`);
  if (n.kind === 'user') return { ok: true, valor: { tipo: 'usuario', caminho: n.full_path, namespaceId: n.id, nivel: null } };
  const eu = e.api({ metodo: 'GET', caminho: 'user' });
  if (!eu.ok) return eu;
  const pessoa = eu.valor.corpo;
  if (!obj(pessoa) || !id(pessoa.id)) return invalida('user');
  const membro = e.api({ metodo: 'GET', caminho: `groups/${n.id}/members/all/${pessoa.id}` });
  // Fora do grupo, nem herdado: 404, nivel 0.
  if (!membro.ok && membro.erro.codigo === 'forja.nao-achei') return { ok: true, valor: { tipo: 'grupo', caminho: n.full_path, namespaceId: n.id, nivel: 0 } };
  if (!membro.ok) return membro;
  const m = membro.valor.corpo;
  if (!obj(m) || !Number.isSafeInteger(m.access_level)) return invalida(`groups/${n.id}/members/all`);
  return { ok: true, valor: { tipo: 'grupo', caminho: n.full_path, namespaceId: n.id, nivel: m.access_level as number } };
}
