/**
 * RM-058, bloco B (D4): a projeção somente leitura do ramo de coordenação.
 *
 * Consumidores recebem uma visão serializável e conservadora. Uma recusa do transporte vira lacuna tipada; ela nunca é
 * confundida com uma rede vazia. Envelopes v1/v2 não consultam o ramo e voltam marcados como locais.
 */
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { lerArco } from './noctum-arco';
import {
  batidaRecente, EstadoDaCoordenacao, EstadoDaOrdem, EstadoDoTrabalhoNaRede, lerCoordenacao, OpcoesDaCoordenacao, ordemViva,
} from './noctum-coordenacao';
import { envelopeMultimaquina, MotivoDeRecusaDoArco, RecusaDoArco } from './noctum-envelope';

export const CONTRATO_REDE_DO_ARCO = 'ork.noctum-rede/v1' as const;

export interface LacunaDaRede {
  motivo: MotivoDeRecusaDoArco;
  detalhe: string;
}

export interface OrdemNaRede {
  ordem: string;
  numero: number;
  maquina: string;
  estado: EstadoDaOrdem;
  emitidaEm: string;
}

export interface EntregaNaRede {
  em: string;
  maquina: string;
  merge: string;
}

export interface TrabalhoNaRede {
  id: string;
  estado: EstadoDoTrabalhoNaRede;
  maquina: string | null;
  ordem: OrdemNaRede | null;
  maquinaPresa: string | null;
  entrega: EntregaNaRede | null;
}

export interface MaquinaNaRede {
  nome: string;
  ultimoSinal: string | null;
  sinalRecente: boolean;
  ordensVivas: string[];
  vagasAtivas: string[];
  vezesAtivas: string[];
  consumo: number;
}

export interface ObrigacoesNaRede {
  ordens: string[];
  vagas: string[];
  vezes: string[];
}

export interface RedeDoArco {
  contrato: typeof CONTRATO_REDE_DO_ARCO;
  arco: string;
  multimaquina: boolean;
  maquina: string;
  envelopeSha256: string | null;
  lidaEm: string;
  autoridade: { maquina: string; geracao: number; desde: string } | null;
  revogada: EstadoDaCoordenacao['revogada'];
  maquinas: MaquinaNaRede[];
  trabalhos: TrabalhoNaRede[];
  consumo: EstadoDaCoordenacao['consumo'];
  obrigacoes: ObrigacoesNaRede;
  lacuna: LacunaDaRede | null;
}

export interface CoordenacaoProjetadaDaFila {
  trabalhos: ReadonlySet<string>;
  entregues: ReadonlyMap<string, string>;
  encerrados: ReadonlySet<string>;
  emOutraMaquina: ReadonlySet<string>;
  ordens: ReadonlyMap<string, { ordem: string; numero: number }>;
}

const consumoVazio = (): EstadoDaCoordenacao['consumo'] => ({ arco: 0, porConta: {}, porRuntime: {} });

function vazia(arco: string, maquina: string, multimaquina: boolean, envelopeSha256: string | null, lidaEm: string,
  lacuna: LacunaDaRede | null): RedeDoArco {
  return { contrato: CONTRATO_REDE_DO_ARCO, arco, multimaquina, maquina, envelopeSha256, lidaEm, autoridade: null, revogada: null,
    maquinas: [], trabalhos: [], consumo: consumoVazio(), obrigacoes: { ordens: [], vagas: [], vezes: [] }, lacuna };
}

function ordemProjetada(o: EstadoDaCoordenacao['ordens'] extends Map<string, infer O> ? O : never): OrdemNaRede {
  return { ordem: o.ordem, numero: o.n, maquina: o.maquina, estado: o.estado, emitidaEm: o.emitidaEm };
}

function projetar(estado: EstadoDaCoordenacao, maquina: string, quando: string): RedeDoArco {
  const conteudo = estado.vigente.conteudo;
  if (!envelopeMultimaquina(conteudo)) return vazia(estado.arco, maquina, false, estado.vigente.envelopeSha256, estado.lidoEm, null);
  const vezes = [...estado.vezes.values()].flat();
  const maquinas = conteudo.maquinas.map(({ nome }) => ({
    nome,
    ultimoSinal: estado.sinais.get(nome) ?? null,
    sinalRecente: batidaRecente(estado, nome, maquina, quando),
    ordensVivas: [...estado.ordens.values()].filter(o => o.maquina === nome && ordemViva(o)).map(o => o.ordem).sort(),
    vagasAtivas: estado.vagas.filter(v => v.maquina === nome && !v.solta).map(v => v.vaga).sort(),
    vezesAtivas: vezes.filter(v => v.maquina === nome && !v.fim).map(v => `${v.chave}/${v.n}`).sort(),
    consumo: estado.vagas.filter(v => v.maquina === nome && (!v.solta || v.solta.consumiu)).length,
  }));
  const trabalhos = conteudo.trabalhos.map(t => {
    const situacao = estado.trabalhos.get(t.id)!;
    const ordem = situacao.ordem ? ordemProjetada(situacao.ordem) : null;
    const registro = estado.entregas.get(t.id);
    const entrega = registro ? { em: registro.em, maquina: registro.por, merge: String(registro.merge) } : null;
    return { id: t.id, estado: situacao.estado, maquina: ordem?.maquina ?? null, ordem, maquinaPresa: t.maquina ?? null, entrega };
  });
  return {
    contrato: CONTRATO_REDE_DO_ARCO,
    arco: estado.arco,
    multimaquina: true,
    maquina,
    envelopeSha256: estado.vigente.envelopeSha256,
    lidaEm: estado.lidoEm,
    autoridade: estado.autoridade ? { maquina: estado.autoridade.maquina, geracao: estado.autoridade.geracao, desde: estado.autoridade.desde } : null,
    revogada: estado.revogada,
    maquinas,
    trabalhos,
    consumo: estado.consumo,
    obrigacoes: {
      ordens: [...estado.ordens.values()].filter(o => o.maquina === maquina && ordemViva(o)).map(o => o.ordem).sort(),
      vagas: estado.vagas.filter(v => v.maquina === maquina && !v.solta).map(v => v.vaga).sort(),
      vezes: vezes.filter(v => v.maquina === maquina && !v.fim).map(v => `${v.chave}/${v.n}`).sort(),
    },
    lacuna: null,
  };
}

/** Lê a rede de um v3. Em v1/v2 não toca o remoto; recusa tipada vira lacuna, sem inventar estado. */
export function lerRede(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): RedeDoArco {
  const quando = opcoes.quando ?? new Date().toISOString();
  const maquina = nomeDaMaquina(opcoes.maquina);
  const local = lerArco(carregado.raiz, arco, quando);
  if (!local?.conteudo || !envelopeMultimaquina(local.conteudo)) {
    return vazia(arco, maquina, false, local?.envelopeSha256 ?? null, quando, null);
  }
  try {
    return projetar(lerCoordenacao(carregado, arco, { ...opcoes, quando }), maquina, quando);
  } catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    return vazia(arco, maquina, true, local.envelopeSha256, quando, { motivo: e.motivo, detalhe: e.message });
  }
}

/** Adapta a projeção íntegra para a fila. Rede local ou ilegível não vira coordenação vazia. */
export function coordenacaoDaFila(rede: RedeDoArco): CoordenacaoProjetadaDaFila | null {
  if (!rede.multimaquina || rede.lacuna) return null;
  const trabalhos = new Set<string>();
  const entregues = new Map<string, string>();
  const encerrados = new Set<string>();
  const emOutraMaquina = new Set<string>();
  const ordens = new Map<string, { ordem: string; numero: number }>();
  for (const t of rede.trabalhos) {
    if (t.entrega) entregues.set(t.id, t.entrega.em);
    else if (t.estado === 'entregue') entregues.set(t.id, t.ordem?.emitidaEm ?? rede.lidaEm);
    if (t.estado === 'encerrado') encerrados.add(t.id);
    if (t.ordem?.maquina === rede.maquina && t.ordem.estado === 'aceita') {
      trabalhos.add(t.id);
      ordens.set(t.id, { ordem: t.ordem.ordem, numero: t.ordem.numero });
    } else if (t.ordem && ['emitida', 'aceita', 'isolada'].includes(t.ordem.estado) && t.ordem.maquina !== rede.maquina) {
      emOutraMaquina.add(t.id);
    }
  }
  return { trabalhos, entregues, encerrados, emOutraMaquina, ordens };
}
