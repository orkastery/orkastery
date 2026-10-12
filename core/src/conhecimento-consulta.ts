/**
 * RM-026 K7 (fatia 2): as consultas do conhecimento escrito, a porta pública do contrato `ork.conhecimento/v1`. A CLI
 * (`ork conhecimento listar|mostrar|colecoes|verificar`) e as tools MCP (`ork_conhecimento_*`) chamam
 * `consultarConhecimento` e devolvem o mesmo JSON (D11).
 *
 * Só leitura. O id do Brain referenciado confere por `get` no Company Brain (D12), só onde a resposta mostra
 * referência: o `mostrar` (as do documento pedido) e o `verificar` (as de todos). `listar` e `colecoes` não abrem o
 * Brain e não mostram referência nem lacuna de referência. Id inexistente, retido e Brain fora do ar são lacunas
 * distintas, nunca resposta. O transporte do Brain é o do `ork brain get` (`memory.cli` conferido no manifesto, cwd
 * fora do clone), na fronteira da RM-047. Contrato: docs/referencia/contratos/conhecimento-rm026.md.
 */
import { BRAIN_API, brainClient, BrainResponse, BrainTransport } from './company-brain-client';
import { BrainEntity, validateContract } from './company-brain-contract';
import {
  compararLacunas, CONTRATO_CONHECIMENTO, DecisaoCitada, detalheDoConhecimento, DocumentoDeConhecimento, ID_DE_DOCUMENTO,
  LacunaDoConhecimento, lacunaDoConhecimento, lerConhecimento, LimitesDoConhecimento, LIMITES_DO_CONHECIMENTO, NOME_DE_COLECAO,
} from './conhecimento';
import { ManifestoCarregado } from './manifest';
import { memoryState } from './project-state';
import { emUmaLinha } from './saida-segura';

export type ConsultaDoConhecimento = 'listar' | 'mostrar' | 'colecoes' | 'verificar';
export const CONSULTAS_DO_CONHECIMENTO: readonly ConsultaDoConhecimento[] = ['listar', 'mostrar', 'colecoes', 'verificar'];

export type PedidoDoConhecimento =
  | { consulta: 'listar'; colecao?: string }
  | { consulta: 'mostrar'; id: string }
  | { consulta: 'colecoes' }
  | { consulta: 'verificar' };

/** D12: quantos ids do Brain uma consulta confere por `get`; cada `get` é um processo do `memory.cli`. */
export const LIMITE_DE_GET_DO_CONHECIMENTO = 100;

/** O id do Brain conferido por `get`: o tipo, o título e a versão da entidade, com a fonte e o hash que o Brain guarda. */
export interface ReferenciaDoBrain {
  id: string;
  kind: BrainEntity['kind'];
  titulo: string;
  versao: number;
  /** O `source_ref` da entidade no Brain, como `portfolio.json#proj-portal-rh`. */
  fonte: string;
  /** O `source_hash` da entidade no Brain. */
  sha256: string;
}

/** O documento com as referências conferidas: as decisões no ledger canônico e os ids do Brain por `get`. */
export interface DocumentoConferido {
  id: string;
  titulo: string;
  colecoes: string[];
  referencias: { brain: ReferenciaDoBrain[]; decisoes: DecisaoCitada[] };
  arquivo: string;
  bytes: number;
  sha256: string;
}
/** O documento na listagem: sem referência, que o `listar` não confere. */
export type ResumoDoDocumento = Pick<DocumentoDeConhecimento, 'id' | 'titulo' | 'colecoes' | 'arquivo' | 'bytes' | 'sha256'>;
export interface ColecaoDoConhecimento { nome: string; documentos: string[] }

interface Comum { contrato: typeof CONTRATO_CONHECIMENTO; dir: string | null }
export type RespostaDoConhecimento =
  | (Comum & { consulta: 'listar'; colecao: string | null; documentos: ResumoDoDocumento[]; lacunas: LacunaDoConhecimento[] })
  | (Comum & { consulta: 'mostrar'; id: string; documento: (DocumentoConferido & { corpo: string }) | null; lacunas: LacunaDoConhecimento[] })
  | (Comum & { consulta: 'colecoes'; colecoes: ColecaoDoConhecimento[]; lacunas: LacunaDoConhecimento[] })
  | (Comum & { consulta: 'verificar'; documentos: DocumentoConferido[]; colecoes: ColecaoDoConhecimento[]; lacunas: LacunaDoConhecimento[] });

/** O Brain de uma consulta: o transporte e o tenant da configuração de memória. */
export interface BrainDaConsulta { transporte: BrainTransport; tenant: string }

/**
 * O Brain do projeto, como o `ork brain get` o abre: a configuração de memória vem da árvore principal também numa
 * worktree (`memoryState`), e o tenant do pedido é o dela.
 */
export function brainDoProjeto(c: ManifestoCarregado): BrainDaConsulta {
  const contexto = memoryState(c);
  return { transporte: brainClient(contexto.loaded), tenant: contexto.loaded.manifesto.memory.tenant };
}

const comparar = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const t = detalheDoConhecimento;
/** Lacuna da pasta: nada foi lido, e nenhuma consulta responde. */
const daPasta = (l: LacunaDoConhecimento) => l.codigo.startsWith('conhecimento.');

type CodigoDoBrain = 'referencia.brain-inexistente' | 'referencia.brain-retido' | 'referencia.brain-indisponivel';
type Conferencia = ReferenciaDoBrain | { codigo: CodigoDoBrain; detalhe: string };

/** O código de erro do Brain, só quando tem a forma de um; texto alheio não chega ao detalhe. */
const erroDoBrain = (e: unknown): string | null => typeof e === 'string' && /^brain\.[a-z0-9.-]{1,80}$/.test(e) ? e : null;
/** O código de uma exceção na abertura do Brain (`project-state.memory.unavailable`), só quando tem a forma de um. */
const codigoDaExcecao = (e: unknown): string | null => {
  const m = e instanceof Error ? e.message : '';
  return /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){1,4}$/.test(m) && m.length <= 80 ? m : null;
};

/** D12: a resposta `ok` do `get` vale só no contrato da entidade, com o id e o tenant pedidos. */
function referenciaDoBrain(r: BrainResponse, id: string, tenant: string): ReferenciaDoBrain | null {
  let e: BrainEntity;
  try { e = validateContract<BrainEntity>((r as { entity?: unknown }).entity); } catch { return null; }
  if (e.schema !== 'orkmind.company-brain-entity/v1' || e.id !== id || e.tenant_id !== tenant) return null;
  return { id, kind: e.kind, titulo: emUmaLinha(e.title), versao: e.version, fonte: e.source.source_ref, sha256: e.source.source_hash };
}

/**
 * D12: um `get` por id distinto, em ordem, até o teto da consulta. O Brain que não responde (fora do ar, sem
 * configuração, recusa) para a conferência: nenhum `get` sai depois, e o resto leva o mesmo detalhe.
 */
function conferirNoBrain(ids: readonly string[], abrir: () => BrainDaConsulta): Map<string, Conferencia> {
  const conferidas = new Map<string, Conferencia>();
  const naoConferida = (detalhe: string): Conferencia => ({ codigo: 'referencia.brain-indisponivel', detalhe });
  let brain: BrainDaConsulta | null = null, parada: string | null = null, gets = 0;
  for (const id of [...new Set(ids)].sort(comparar)) {
    if (parada === null && gets >= LIMITE_DE_GET_DO_CONHECIMENTO) parada = t((l) => l.brainTeto(LIMITE_DE_GET_DO_CONHECIMENTO));
    if (parada !== null) { conferidas.set(id, naoConferida(parada)); continue; }
    if (brain === null) {
      try { brain = abrir(); }
      catch (e) {
        const codigo = codigoDaExcecao(e);
        parada = t((l) => l.brainSemConfiguracao(codigo));
        conferidas.set(id, naoConferida(parada));
        continue;
      }
    }
    gets++;
    let r: BrainResponse;
    try { r = brain.transporte({ schema: BRAIN_API, operation: 'get', payload: { tenant_id: brain.tenant, id } }); }
    catch (e) {
      const codigo = erroDoBrain(codigoDaExcecao(e));
      parada = t((l) => l.brainNaoRespondeu('unavailable', codigo));
      conferidas.set(id, naoConferida(parada));
      continue;
    }
    if (r.state === 'ok') conferidas.set(id, referenciaDoBrain(r, id, brain.tenant) ?? naoConferida(t((l) => l.brainForaDoContrato)));
    else if (r.state === 'unknown') conferidas.set(id, { codigo: 'referencia.brain-inexistente', detalhe: t((l) => l.brainInexistente) });
    else if (r.state === 'withheld') conferidas.set(id, { codigo: 'referencia.brain-retido', detalhe: t((l) => l.brainRetido) });
    else {
      const estado = typeof r.state === 'string' && /^[a-z]{1,20}$/.test(r.state) ? r.state : 'unavailable', erro = erroDoBrain(r.error);
      parada = t((l) => l.brainNaoRespondeu(estado, erro));
      conferidas.set(id, naoConferida(parada));
    }
  }
  return conferidas;
}

/** As referências do Brain conferidas; a que não confere vira lacuna, e o documento segue sem ela (D4). */
function conferirDocumentos(docs: readonly DocumentoDeConhecimento[], abrir: () => BrainDaConsulta,
  lacunas: LacunaDoConhecimento[]): DocumentoConferido[] {
  const conferencias = conferirNoBrain(docs.flatMap((d) => d.referencias.brain), abrir);
  return docs.map((d) => {
    const brain: ReferenciaDoBrain[] = [];
    for (const id of d.referencias.brain) {
      const r = conferencias.get(id)!;
      if ('codigo' in r) lacunas.push(lacunaDoConhecimento(r.codigo, r.detalhe, { arquivo: d.arquivo, documento: d.id, referencia: id }));
      else brain.push(r);
    }
    return { id: d.id, titulo: d.titulo, colecoes: d.colecoes, referencias: { brain, decisoes: d.referencias.decisoes },
      arquivo: d.arquivo, bytes: d.bytes, sha256: d.sha256 };
  });
}

const resumo = (d: DocumentoDeConhecimento): ResumoDoDocumento =>
  ({ id: d.id, titulo: d.titulo, colecoes: d.colecoes, arquivo: d.arquivo, bytes: d.bytes, sha256: d.sha256 });

/**
 * A consulta pedida, no contrato `ork.conhecimento/v1`. Nunca lança por causa do conteúdo do repositório nem do Brain:
 * o que não vale vira lacuna. O pedido fora da forma (id de documento, nome de coleção) é erro de quem chama; a CLI e
 * as tools o recusam antes.
 */
export function consultarConhecimento(c: ManifestoCarregado, pedido: PedidoDoConhecimento,
  abrirBrain: () => BrainDaConsulta = () => brainDoProjeto(c), limites: LimitesDoConhecimento = LIMITES_DO_CONHECIMENTO): RespostaDoConhecimento {
  if (pedido.consulta === 'mostrar' && !ID_DE_DOCUMENTO.test(pedido.id)) throw new Error('conhecimento.pedido-invalido: id de documento');
  if (pedido.consulta === 'listar' && pedido.colecao !== undefined && !NOME_DE_COLECAO.test(pedido.colecao)) {
    throw new Error('conhecimento.pedido-invalido: nome de coleção');
  }
  const k = lerConhecimento(c, limites, pedido.consulta === 'mostrar' ? { corpoDe: pedido.id } : {});
  const base = { contrato: CONTRATO_CONHECIMENTO, consulta: pedido.consulta, dir: k.dir };
  // D12: quem não mostra referência não mostra a lacuna dela.
  const semReferencia = () => k.lacunas.filter((l) => !l.codigo.startsWith('referencia.'));
  switch (pedido.consulta) {
    case 'listar': {
      const colecao = pedido.colecao ?? null;
      return { ...base, consulta: 'listar', colecao,
        documentos: k.documentos.filter((d) => colecao === null || d.colecoes.includes(colecao)).map(resumo), lacunas: semReferencia() };
    }
    case 'colecoes':
      return { ...base, consulta: 'colecoes', colecoes: k.colecoes, lacunas: semReferencia() };
    case 'mostrar': {
      const comum = { ...base, consulta: 'mostrar' as const, id: pedido.id };
      if (k.lacunas.some(daPasta)) return { ...comum, documento: null, lacunas: k.lacunas };
      const lacunas = k.lacunas.filter((l) => l.documento === pedido.id);
      const doc = k.documentos.find((d) => d.id === pedido.id);
      if (!doc) {
        // D13: o id que nenhum documento válido tem; os arquivos que viraram lacuna antes de o id ser lido entram na conta.
        if (!lacunas.length) {
          const semId = k.lacunas.filter((l) => l.arquivo !== null && l.documento === null).length;
          lacunas.push(lacunaDoConhecimento('documento.inexistente', t((l) => l.documentoInexistente(pedido.id, semId)),
            { documento: pedido.id }));
        }
        return { ...comum, documento: null, lacunas };
      }
      const [conferido] = conferirDocumentos([doc], abrirBrain, lacunas);
      return { ...comum, documento: { ...conferido, corpo: doc.corpo ?? '' }, lacunas: lacunas.sort(compararLacunas) };
    }
    case 'verificar': {
      const lacunas = [...k.lacunas];
      const documentos = conferirDocumentos(k.documentos, abrirBrain, lacunas);
      return { ...base, consulta: 'verificar', documentos, colecoes: k.colecoes, lacunas: lacunas.sort(compararLacunas) };
    }
  }
}

/**
 * D13: a consulta respondeu? `listar` e `colecoes`, quando a pasta foi lida; `mostrar`, quando o documento veio;
 * `verificar`, sem nenhuma lacuna. É a saída 0 da CLI e a tool sem `isError`.
 */
export function consultaRespondeu(r: RespostaDoConhecimento): boolean {
  if (r.consulta === 'verificar') return r.lacunas.length === 0;
  if (r.consulta === 'mostrar') return r.documento !== null;
  return !r.lacunas.some(daPasta);
}
