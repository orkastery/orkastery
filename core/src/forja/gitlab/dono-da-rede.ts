/**
 * Quem e o dono pedido para a casa da rede no GitLab: o namespace (`GET namespaces/:caminho`) e, quando e grupo, o
 * nivel de acesso da pessoa nele, herdado inclusive (`GET groups/:id/members/all/:id-da-pessoa`). Namespace de outro
 * usuario e namespace que nao existe respondem o mesmo 404 a quem nao e admin: os dois saem `forja.nao-achei`. O nivel
 * minimo e decisao da rede, nao daqui.
 */
import type { ChamadorDaApi } from '../api';
import type { ContaNaForja, DonoDaRede, RepositorioPrivadoNaForja, Resultado } from '../contrato';

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const invalida = (detalhe: string): { ok: false; erro: { codigo: 'forja.resposta-invalida'; detalhe: string } } =>
  ({ ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe } });

const naoAchei = (detalhe: string): { ok: false; erro: { codigo: 'forja.nao-achei'; detalhe: string } } =>
  ({ ok: false, erro: { codigo: 'forja.nao-achei', detalhe } });

export function contaAtualGitlab(e: { api: ChamadorDaApi }): Resultado<ContaNaForja> {
  const eu = e.api({ metodo: 'GET', caminho: 'user' });
  if (!eu.ok) return eu;
  const p = eu.valor.corpo;
  if (!obj(p) || !id(p.id) || typeof p.username !== 'string' || !p.username) return invalida('user');
  return { ok: true, valor: { accountId: p.id, login: p.username } };
}

const projetoNaApi = (caminho: string): string => `projects/${encodeURIComponent(caminho)}`;
function projeto(v: unknown, esperado: string): Resultado<RepositorioPrivadoNaForja> {
  if (!obj(v) || typeof v.path_with_namespace !== 'string' || v.path_with_namespace.toLowerCase() !== esperado.toLowerCase()
    || typeof v.http_url_to_repo !== 'string' || !v.http_url_to_repo.startsWith('https://')) return invalida(projetoNaApi(esperado));
  return { ok: true, valor: { caminho: v.path_with_namespace, privado: v.visibility === 'private', urlHttps: v.http_url_to_repo } };
}

export function repositorioPrivadoGitlab(e: { api: ChamadorDaApi; dono: string; nome: string }): Resultado<RepositorioPrivadoNaForja | null> {
  const caminho = `${e.dono}/${e.nome}`;
  const r = e.api({ metodo: 'GET', caminho: projetoNaApi(caminho) });
  if (!r.ok && r.erro.codigo === 'forja.nao-achei') return { ok: true, valor: null };
  if (!r.ok) return r;
  return projeto(r.valor.corpo, caminho);
}

export function criarRepositorioPrivadoGitlab(e: { api: ChamadorDaApi; dono: DonoDaRede; nome: string; descricao: string }): Resultado<RepositorioPrivadoNaForja> {
  const caminho = `${e.dono.caminho}/${e.nome}`;
  const criado = e.api({ metodo: 'POST', caminho: 'projects', corpo: { name: e.nome, path: e.nome, namespace_id: e.dono.namespaceId,
    visibility: 'private', description: e.descricao } });
  if (criado.ok) return projeto(criado.valor.corpo, caminho);
  const relido = repositorioPrivadoGitlab({ api: e.api, dono: e.dono.caminho, nome: e.nome });
  return relido.ok && relido.valor ? { ok: true, valor: relido.valor } : criado;
}

export function donoDaRedeGitlab(e: { api: ChamadorDaApi; dono: string }): Resultado<DonoDaRede> {
  if (!e.dono.trim()) return naoAchei('dono vazio');
  const ns = e.api({ metodo: 'GET', caminho: `namespaces/${encodeURIComponent(e.dono)}` });
  if (!ns.ok) return ns;
  const n = ns.valor.corpo;
  if (!obj(n) || !id(n.id) || (n.kind !== 'user' && n.kind !== 'group') || typeof n.full_path !== 'string') return invalida(`namespaces/${e.dono}`);
  // O GitLab acha o namespace sem diferenciar maiusculas; outro caminho na resposta e outra coisa.
  if (n.full_path.toLowerCase() !== e.dono.toLowerCase()) return invalida(`namespaces/${e.dono}: ${n.full_path}`);
  const eu = e.api({ metodo: 'GET', caminho: 'user' });
  if (!eu.ok) return eu;
  const pessoa = eu.valor.corpo;
  if (!obj(pessoa) || !id(pessoa.id)) return invalida('user');
  if (n.kind === 'user') {
    // Um token de admin le o namespace de qualquer usuario com 200; so o da propria pessoa serve de casa.
    const propria = (typeof pessoa.username === 'string' && pessoa.username.toLowerCase() === n.full_path.toLowerCase()) || pessoa.namespace_id === n.id;
    if (!propria) return naoAchei(`namespaces/${e.dono}: nao e da pessoa logada`);
    return { ok: true, valor: { tipo: 'usuario', caminho: n.full_path, namespaceId: n.id, nivel: null } };
  }
  const membro = e.api({ metodo: 'GET', caminho: `groups/${n.id}/members/all/${pessoa.id}` });
  // Fora do grupo, nem herdado: 404, nivel 0.
  if (!membro.ok && membro.erro.codigo === 'forja.nao-achei') return { ok: true, valor: { tipo: 'grupo', caminho: n.full_path, namespaceId: n.id, nivel: 0 } };
  if (!membro.ok) return membro;
  const m = membro.valor.corpo;
  if (!obj(m) || !Number.isSafeInteger(m.access_level)) return invalida(`groups/${n.id}/members/all`);
  return { ok: true, valor: { tipo: 'grupo', caminho: n.full_path, namespaceId: n.id, nivel: m.access_level as number } };
}
