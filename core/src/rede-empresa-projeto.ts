/** RM-089 F2: identidade canônica de projeto compartilhada por toda a rede coletiva. */
import { createHash } from 'node:crypto';
import type { Manifesto } from './types';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { resolverForja } from './forja/resolver';
import type { ForjaDaEmpresa, ReferenciaDaForja } from './rede-empresa-contrato';

export interface EspelhoDeProjeto {
  projectKey: string;
  canonico: string;
}

export interface ProjetoNormalizado {
  projectKey: string;
  referencia: ReferenciaDaForja;
  remoto: string;
}

export interface OpcoesDeNormalizacao {
  forja?: Manifesto['forja'];
  espelhos?: readonly EspelhoDeProjeto[];
}

const CHAVE = /^(github|gitlab):([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?)\/([a-z0-9][a-z0-9._/-]*)$/;

function aplicarEspelho(projectKey: string, espelhos: readonly EspelhoDeProjeto[]): string {
  const destinos = new Set(espelhos.filter((e) => e.projectKey === projectKey).map((e) => e.canonico));
  if (destinos.size > 1) throw new Error('rede-empresa.alias-ambiguo');
  const destino = [...destinos][0];
  if (!destino) return projectKey;
  if (!CHAVE.test(destino) || destino === projectKey) {
    if (destino === projectKey) return projectKey;
    throw new Error('rede-empresa.alias-invalido');
  }
  if (espelhos.some((e) => e.projectKey === destino && e.canonico !== destino)) {
    throw new Error('rede-empresa.alias-ambiguo');
  }
  return destino;
}

function remotoDaReferencia(ref: ReferenciaDaForja): string {
  return `https://${ref.host}/${ref.caminho}.git`;
}

/**
 * Converge HTTPS, SSH e SCP usando o parser e o resolvedor únicos da forja.
 * Host e caminho seguem a comparação sem caixa que a F1 já adotava; porta web padrão desaparece.
 */
export function normalizarProjeto(entrada: string | ReferenciaDaForja, opcoes: OpcoesDeNormalizacao = {}): ProjetoNormalizado {
  const remoto = typeof entrada === 'string' ? entrada : remotoDaReferencia(entrada);
  const remotoNormalizado = remoto.replace(/([^:])\/{2,}/g, '$1/');
  const endereco = lerEnderecoDoRemoto(remotoNormalizado);
  if (!endereco) throw new Error('rede-empresa.projeto-invalido');
  const manifesto = typeof entrada === 'string' ? opcoes.forja : { ...(opcoes.forja ?? {}), tipo: entrada.forja };
  const resolvida = resolverForja({ endereco, manifesto, sondas: {} });
  if (!resolvida.ok) throw Object.assign(new Error(resolvida.erro.codigo), { codigo: resolvida.erro.codigo });
  const f = resolvida.valor;
  const host = `${f.host.toLowerCase()}${f.porta === null ? '' : `:${f.porta}`}`;
  const caminho = f.repo.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').replace(/\/+/g, '/').toLowerCase();
  const bruto = `${f.tipo}:${host}/${caminho}`;
  const projectKey = aplicarEspelho(bruto, opcoes.espelhos ?? []);
  const partes = CHAVE.exec(projectKey);
  if (!partes) throw new Error('rede-empresa.projeto-invalido');
  return { projectKey, referencia: { forja: partes[1] as ForjaDaEmpresa, host: partes[2], caminho: partes[3] }, remoto: remotoNormalizado };
}

/** Segmento estável para caminhos da branch coletiva; o payload continua levando a projectKey legível. */
export function segmentoDaProjectKey(projectKey: string): string {
  if (!CHAVE.test(projectKey)) throw new Error('rede-empresa.projeto-invalido');
  return `projeto-${createHash('sha256').update(projectKey, 'utf8').digest('hex').slice(0, 24)}`;
}

export function mesmaProjectKey(a: ReferenciaDaForja, b: ReferenciaDaForja, espelhos: readonly EspelhoDeProjeto[] = []): boolean {
  return normalizarProjeto(a, { espelhos }).projectKey === normalizarProjeto(b, { espelhos }).projectKey;
}
