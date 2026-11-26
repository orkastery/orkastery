/** RM-089 F7: serviço determinístico da fábrica. O evento só dispara a releitura dos fatos. */
import { createHash } from 'node:crypto';
import { conferirRegistrosDaFabrica, type RegistrosParaDecisaoDaFabrica,
  type ProvaDosRegistrosDaFabrica, type ResultadoDosRegistrosDaFabrica } from './ci-fabrica-registros';
import type { PoliticaDeReciboCi } from './types';

export const CONTRATO_DECISAO_DA_FABRICA = 'ork.ci-fabrica-decisao/v1' as const;
export type CodigoDaFabrica = 'ci.fabrica.prova-ausente' | 'ci.fabrica.indisponivel'
  | 'ci.fabrica.prazo-excedido' | 'ci.fabrica.regra-destino-invalida'
  | 'ci.fabrica.maintainer-adicional' | 'ci.fabrica.nome-colidente' | 'ci.fabrica.publicacao-recusada';

export interface EventoDaFabrica {
  id: string;
  assinaturaValida: boolean;
  recebidoEm: string;
  emitidoEm: string;
  /** Dado não autoritativo, usado para provar que o evento nunca substitui a releitura. */
  headInformado?: string;
}

export interface DecisaoDaFabrica {
  contrato: typeof CONTRATO_DECISAO_DA_FABRICA;
  eventoId: string;
  nivel: PoliticaDeReciboCi;
  estado: 'liberado' | 'diagnostico' | 'bloqueado';
  head: string | null;
  codigo?: CodigoDaFabrica;
  resultadoForteSha256?: string;
  digestCanonico: string | null;
  fatosRelidos: RegistrosParaDecisaoDaFabrica | null;
}

export interface PortasDoServicoDaFabrica {
  reler(): RegistrosParaDecisaoDaFabrica;
  avaliarDestino?(prova: Extract<ResultadoDosRegistrosDaFabrica, { ok: true }>['prova']): CodigoDaFabrica | null;
  emitirResultado?(prova: ProvaDosRegistrosDaFabrica): { sha256: string };
  revalidarAntesDoEfeito?(prova: ProvaDosRegistrosDaFabrica): boolean;
  persistir(decisao: DecisaoDaFabrica): void;
  publicar(decisao: DecisaoDaFabrica): void;
  jaProcessado?(eventoId: string, digestCanonico: string): DecisaoDaFabrica | null;
}

const instante = (valor: string): number => Date.parse(valor);
const decisaoDeFalha = (eventoId: string, nivel: PoliticaDeReciboCi, codigo: CodigoDaFabrica,
  fatosRelidos: RegistrosParaDecisaoDaFabrica | null, digestCanonico: string | null): DecisaoDaFabrica =>
  ({ contrato: CONTRATO_DECISAO_DA_FABRICA, eventoId, nivel,
    estado: nivel === 'exigir' ? 'bloqueado' : 'diagnostico', head: fatosRelidos?.head ?? null, codigo,
    digestCanonico, fatosRelidos });

const canonico = (valor: unknown): unknown => Array.isArray(valor) ? valor.map(canonico)
  : valor && typeof valor === 'object' ? Object.fromEntries(Object.entries(valor as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([chave, item]) => [chave, canonico(item)])) : valor;
export const digestCanonicoDosFatos = (fatos: RegistrosParaDecisaoDaFabrica): string =>
  createHash('sha256').update(JSON.stringify(canonico(fatos))).digest('hex');

/** Persistir sempre antecede publicação. Reentrega idêntica retorna o registro existente sem novo efeito. */
export function processarEventoDaFabrica(evento: EventoDaFabrica,
  portas: PortasDoServicoDaFabrica, janelaMs = 300_000): DecisaoDaFabrica {
  const recebido = instante(evento.recebidoEm), emitido = instante(evento.emitidoEm);
  let decisao: DecisaoDaFabrica;
  let registros: RegistrosParaDecisaoDaFabrica | null = null;
  let digestCanonico: string | null = null;
  let nivel: PoliticaDeReciboCi = 'exigir';
  try {
    registros = portas.reler();
    nivel = registros.nivelDoDestino;
    digestCanonico = digestCanonicoDosFatos(registros);
    const existente = portas.jaProcessado?.(evento.id, digestCanonico);
    if (existente?.digestCanonico === digestCanonico) return existente;
    if (!evento.assinaturaValida || !Number.isFinite(recebido) || !Number.isFinite(emitido)
        || emitido > recebido || recebido - emitido > janelaMs) {
      decisao = decisaoDeFalha(evento.id, nivel, 'ci.fabrica.prova-ausente', registros, digestCanonico);
    } else {
      const conferido = conferirRegistrosDaFabrica(registros);
      if (!conferido.ok) decisao = decisaoDeFalha(evento.id, nivel, conferido.codigo, registros, digestCanonico);
      else {
        if (nivel === 'exigir' && !portas.avaliarDestino) {
          decisao = decisaoDeFalha(evento.id, nivel, 'ci.fabrica.prova-ausente', registros, digestCanonico);
        } else {
          const codigo = portas.avaliarDestino?.(conferido.prova) ?? null;
          if (codigo) {
            decisao = decisaoDeFalha(evento.id, nivel, codigo, registros, digestCanonico);
          } else if (nivel === 'exigir' && (!portas.revalidarAntesDoEfeito || !portas.emitirResultado)) {
            decisao = decisaoDeFalha(evento.id, nivel, 'ci.fabrica.prova-ausente', registros, digestCanonico);
          } else if (portas.revalidarAntesDoEfeito && !portas.revalidarAntesDoEfeito(conferido.prova)) {
            decisao = decisaoDeFalha(evento.id, nivel, codigo ?? 'ci.fabrica.prova-ausente', registros, digestCanonico);
          } else if (portas.emitirResultado) {
            try {
              const resultado = portas.emitirResultado(conferido.prova);
              decisao = { contrato: CONTRATO_DECISAO_DA_FABRICA, eventoId: evento.id, nivel,
                estado: nivel === 'exigir' ? 'liberado' : 'diagnostico', head: registros.head,
                resultadoForteSha256: resultado.sha256, digestCanonico, fatosRelidos: registros };
            } catch {
              decisao = decisaoDeFalha(evento.id, nivel, 'ci.fabrica.prova-ausente', registros, digestCanonico);
            }
          } else {
            decisao = { contrato: CONTRATO_DECISAO_DA_FABRICA, eventoId: evento.id, nivel,
              estado: 'diagnostico', head: registros.head, digestCanonico, fatosRelidos: registros };
          }
        }
      }
    }
  } catch (erro) {
    const nome = (erro as Error).name;
    decisao = decisaoDeFalha(evento.id, nivel,
      nome === 'TimeoutError' ? 'ci.fabrica.prazo-excedido' : 'ci.fabrica.indisponivel', registros, digestCanonico);
  }
  portas.persistir(decisao);
  portas.publicar(decisao);
  return decisao;
}
