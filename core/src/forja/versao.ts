/**
 * A versao e a edicao do servidor da forja, e a faixa de compromisso dela: `testada` (as minors em que a bateria de
 * contrato roda antes de cada release), `compativel` (do piso em diante; funciona, com degradacao explicita onde
 * faltar recurso) e `abaixo-do-piso` (recusa clara, nunca comportamento parcial). A leitura fica 24 h no cache da forja
 * (`forja/cache.ts`), por host.
 */
import { chamadorDaApi, ChamadorDaApi, RodarCli } from './api';
import { gravarNoCache, lerDoCache } from './cache';
import { AlvoDaCli, hostDaApi } from './cli';
import type { ErroDaForja, Resultado, TipoDeForja, VersaoDoServidor } from './contrato';
import { adaptadorDaForja } from './registro';
import { deFora } from './texto';

export { VALIDADE_DO_CACHE_MS } from './cache';

/**
 * A janela testada e o piso de cada forja com faixas. A janela sao as tres minors mantidas pelo GitLab na data da
 * release do ork: atualize a lista a cada release, depois de a bateria de contrato passar nelas.
 */
export const FAIXAS: Readonly<Partial<Record<TipoDeForja, { testadas: readonly string[]; piso: string }>>> = {
  gitlab: { testadas: ['19.4', '19.3', '19.2'], piso: '17.0' },
};

export type FaixaDaVersao = 'testada' | 'compativel' | 'abaixo-do-piso' | 'sem-faixa';
export interface MetadadosDaForja extends VersaoDoServidor { faixa: FaixaDaVersao; lidoEm: string; doCache: boolean }

const minor = (v: string): [number, number] | null => {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const comparar = (a: [number, number], b: [number, number]): number => a[0] - b[0] || a[1] - b[1];

export function faixaDaVersao(tipo: TipoDeForja, versao: string | null): FaixaDaVersao {
  const f = FAIXAS[tipo];
  const v = versao ? minor(versao) : null;
  if (!f || !v) return 'sem-faixa';
  if (comparar(v, minor(f.piso)!) < 0) return 'abaixo-do-piso';
  return f.testadas.some((t) => comparar(v, minor(t)!) === 0) ? 'testada' : 'compativel';
}

/**
 * O erro de quem nao opera abaixo do piso; `null` na faixa. Na forja com faixas, a versao ilegivel (a do cache com
 * `versao: null` ou fora de `N.N`) tambem recusa: sem saber a versao, o piso nao esta provado.
 */
export function recusaAbaixoDoPiso(tipo: TipoDeForja, m: Pick<MetadadosDaForja, 'versao' | 'faixa'>): ErroDaForja | null {
  if (m.faixa === 'abaixo-do-piso') return { codigo: 'forja.versao-abaixo-do-piso', detalhe: `${tipo} ${m.versao} < ${FAIXAS[tipo]?.piso}` };
  if (m.faixa === 'sem-faixa' && FAIXAS[tipo]) {
    return { codigo: 'forja.versao-abaixo-do-piso', detalhe: `${tipo}: versão ilegível (${m.versao === null ? 'nula' : deFora(m.versao)})` };
  }
  return null;
}

export interface OpcoesDosMetadados { cache: string | null; agoraMs?: number; api?: ChamadorDaApi; rodar?: RodarCli }

/** A versao, a edicao e a faixa da forja; do cache quando ele tem menos de 24 h. */
export function lerMetadados(f: AlvoDaCli, o: OpcoesDosMetadados): Resultado<MetadadosDaForja> {
  const agora = o.agoraMs ?? Date.now();
  const chave = `metadados ${f.tipo} ${hostDaApi(f)}${f.caminhoBase}`;
  const g = lerDoCache(o.cache, chave, agora);
  if (g && (g.versao === null || typeof g.versao === 'string') && (g.edicao === null || g.edicao === 'ce' || g.edicao === 'ee')) {
    const versao = g.versao as string | null;
    return { ok: true, valor: { versao, edicao: g.edicao as VersaoDoServidor['edicao'], lidoEm: String(g.lidoEm),
      faixa: faixaDaVersao(f.tipo, versao), doCache: true } };
  }
  const capacidade = adaptadorDaForja(f.tipo).metadados;
  if (!capacidade) return { ok: false, erro: { codigo: 'forja.sem-capacidade', detalhe: `${f.tipo} metadados` } };
  const lido = capacidade({ api: o.api ?? chamadorDaApi(f, { rodar: o.rodar }) });
  if (!lido.ok) return lido;
  gravarNoCache(o.cache, chave, { ...lido.valor }, agora);
  return { ok: true, valor: { ...lido.valor, lidoEm: new Date(agora).toISOString(), faixa: faixaDaVersao(f.tipo, lido.valor.versao), doCache: false } };
}
