/**
 * RM-089 F1: criação e leitura da rede coletiva pela porta neutra da RM-065.
 * O consumidor não conhece argv de gh/glab e nunca recebe credencial.
 */
import type { ChamadorDaApi } from './forja/api';
import { adaptadorDaForja, donoDaRedeColetiva, exigirCapacidade } from './forja/registro';
import type { ContaNaForja, DonoDaRede, ForjaResolvida, RepositorioPrivadoNaForja, Resultado } from './forja/contrato';

const PARTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DONO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){0,19}$/;

export interface RedeColetivaNaForja {
  conta: ContaNaForja;
  dono: DonoDaRede;
  repositorio: RepositorioPrivadoNaForja;
  criada: boolean;
}

const falha = (detalhe: string): Resultado<never> => ({ ok: false, erro: { codigo: 'forja.pedido-recusado', detalhe } });

function entrada(dono: string, nome: string): Resultado<true> {
  if (!DONO.test(dono)) return falha('rede-empresa.dono-invalido');
  if (!PARTE.test(nome)) return falha('rede-empresa.repositorio-invalido');
  return { ok: true, valor: true };
}

function exigirPrivado(r: RepositorioPrivadoNaForja): Resultado<RepositorioPrivadoNaForja> {
  if (!r.privado) return falha('rede-empresa.repositorio-publico');
  if (!r.urlHttps.startsWith('https://')) return falha('rede-empresa.repositorio-sem-https');
  return { ok: true, valor: r };
}

/** Cria no owner pedido ou relê a casa privada que já existe. */
export function criarRedeColetiva(forja: Pick<ForjaResolvida, 'tipo'>, api: ChamadorDaApi, donoPedido: string, nome: string,
  descricao = 'Orkastery company network'): Resultado<RedeColetivaNaForja> {
  const valida = entrada(donoPedido, nome);
  if (!valida.ok) return valida;
  const adaptador = adaptadorDaForja(forja.tipo);
  const conta = exigirCapacidade(adaptador, 'contaAtual')({ api });
  if (!conta.ok) return conta;
  const dono = donoDaRedeColetiva(forja.tipo, { api, dono: donoPedido });
  if (!dono.ok) return dono;
  const ler = exigirCapacidade(adaptador, 'repositorioPrivado');
  const atual = ler({ api, dono: dono.valor.caminho, nome });
  if (!atual.ok) return atual;
  if (atual.valor) {
    const privado = exigirPrivado(atual.valor);
    return privado.ok ? { ok: true, valor: { conta: conta.valor, dono: dono.valor, repositorio: privado.valor, criada: false } } : privado;
  }
  const criado = exigirCapacidade(adaptador, 'criarRepositorioPrivado')({ api, dono: dono.valor, nome, descricao });
  if (!criado.ok) return criado;
  const privado = exigirPrivado(criado.valor);
  return privado.ok ? { ok: true, valor: { conta: conta.valor, dono: dono.valor, repositorio: privado.valor, criada: true } } : privado;
}

/** Lê sem criar; ausência é distinta de indisponibilidade. */
export function lerRedeColetiva(forja: Pick<ForjaResolvida, 'tipo'>, api: ChamadorDaApi, dono: string, nome: string): Resultado<RepositorioPrivadoNaForja | null> {
  const valida = entrada(dono, nome);
  if (!valida.ok) return valida;
  const r = exigirCapacidade(adaptadorDaForja(forja.tipo), 'repositorioPrivado')({ api, dono, nome });
  if (!r.ok || !r.valor) return r;
  return exigirPrivado(r.valor);
}
