/**
 * O dono da casa da rede no GitHub, como a rede sempre fez: so o proprio login (`GET user`), comparado exatamente como
 * a rede compara hoje; organizacao nao e dono. Qualquer outro dono sai `forja.nao-achei`.
 */
import type { ChamadorDaApi } from '../api';
import type { ContaNaForja, DonoDaRede, RepositorioPrivadoNaForja, Resultado } from '../contrato';

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const invalida = (detalhe: string) => ({ ok: false as const,
  erro: { codigo: 'forja.resposta-invalida' as const, detalhe } });
const segmento = (v: string): string => encodeURIComponent(v);

function conta(v: unknown): Resultado<ContaNaForja> {
  if (!obj(v) || !id(v.id) || typeof v.login !== 'string' || !v.login) return invalida('user');
  return { ok: true, valor: { accountId: v.id, login: v.login } };
}

function repositorio(v: unknown, esperado: string): Resultado<RepositorioPrivadoNaForja> {
  if (!obj(v) || typeof v.full_name !== 'string' || v.full_name.toLowerCase() !== esperado.toLowerCase()
    || typeof v.clone_url !== 'string' || !v.clone_url.startsWith('https://')) return invalida(`repos/${esperado}`);
  const privado = typeof v.visibility === 'string' ? v.visibility === 'private' : v.private === true;
  return { ok: true, valor: { caminho: v.full_name, privado, urlHttps: v.clone_url } };
}

export function contaAtualGithub(e: { api: ChamadorDaApi }): Resultado<ContaNaForja> {
  const r = e.api({ metodo: 'GET', caminho: 'user' });
  return r.ok ? conta(r.valor.corpo) : r;
}

export function repositorioPrivadoGithub(e: { api: ChamadorDaApi; dono: string; nome: string }): Resultado<RepositorioPrivadoNaForja | null> {
  const caminho = `${e.dono}/${e.nome}`;
  const r = e.api({ metodo: 'GET', caminho: `repos/${segmento(e.dono)}/${segmento(e.nome)}` });
  if (!r.ok && r.erro.codigo === 'forja.nao-achei') return { ok: true, valor: null };
  if (!r.ok) return r;
  return repositorio(r.valor.corpo, caminho);
}

export function criarRepositorioPrivadoGithub(e: { api: ChamadorDaApi; dono: DonoDaRede; nome: string; descricao: string }): Resultado<RepositorioPrivadoNaForja> {
  const caminho = `${e.dono.caminho}/${e.nome}`;
  const rota = e.dono.tipo === 'grupo' ? `orgs/${segmento(e.dono.caminho)}/repos` : 'user/repos';
  const criado = e.api({ metodo: 'POST', caminho: rota, corpo: { name: e.nome, description: e.descricao, private: true,
    has_issues: false, has_wiki: false } });
  if (criado.ok) return repositorio(criado.valor.corpo, caminho);
  const relido = repositorioPrivadoGithub({ api: e.api, dono: e.dono.caminho, nome: e.nome });
  return relido.ok && relido.valor ? { ok: true, valor: relido.valor } : criado;
}

export function donoDaRedeGithub(e: { api: ChamadorDaApi; dono: string }): Resultado<DonoDaRede> {
  if (!e.dono.trim()) return { ok: false, erro: { codigo: 'forja.nao-achei', detalhe: 'dono vazio' } };
  const eu = e.api({ metodo: 'GET', caminho: 'user' });
  if (!eu.ok) return eu;
  const atual = conta(eu.valor.corpo);
  if (!atual.ok) return atual;
  if (atual.valor.login === e.dono) {
    return { ok: true, valor: { tipo: 'usuario', caminho: atual.valor.login, namespaceId: atual.valor.accountId, nivel: null } };
  }
  return { ok: false, erro: { codigo: 'forja.nao-achei', detalhe: `dono ${e.dono} não é a pessoa logada` } };
}

/** A rede coletiva também pode criar no owner de uma organização, sem ampliar a casa da rede pessoal. */
export function donoDaRedeColetivaGithub(e: { api: ChamadorDaApi; dono: string }): Resultado<DonoDaRede> {
  const pessoal = donoDaRedeGithub(e);
  if (pessoal.ok || pessoal.erro.codigo !== 'forja.nao-achei' || !e.dono.trim()) return pessoal;
  const org = e.api({ metodo: 'GET', caminho: `orgs/${segmento(e.dono)}` });
  if (!org.ok) return org;
  const p = org.valor.corpo;
  if (!obj(p) || !id(p.id) || typeof p.login !== 'string' || p.login.toLowerCase() !== e.dono.toLowerCase()) return invalida(`orgs/${e.dono}`);
  return { ok: true, valor: { tipo: 'grupo', caminho: p.login, namespaceId: p.id, nivel: null } };
}
