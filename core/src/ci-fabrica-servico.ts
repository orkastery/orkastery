/** RM-089 F7: serviço determinístico da fábrica. O evento só dispara a releitura dos fatos. */
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
}

export interface DecisaoDaFabrica {
  contrato: typeof CONTRATO_DECISAO_DA_FABRICA;
  eventoId: string;
  nivel: PoliticaDeReciboCi;
  estado: 'liberado' | 'diagnostico' | 'bloqueado';
  head: string | null;
  codigo?: CodigoDaFabrica;
  resultadoForteSha256?: string;
}

export interface PortasDoServicoDaFabrica {
  reler(): RegistrosParaDecisaoDaFabrica;
  avaliarDestino?(prova: Extract<ResultadoDosRegistrosDaFabrica, { ok: true }>['prova']): CodigoDaFabrica | null;
  emitirResultado?(prova: ProvaDosRegistrosDaFabrica): { sha256: string };
  persistir(decisao: DecisaoDaFabrica): void;
  publicar(decisao: DecisaoDaFabrica): void;
  jaProcessado?(eventoId: string): DecisaoDaFabrica | null;
}

const instante = (valor: string): number => Date.parse(valor);
const decisaoDeFalha = (eventoId: string, nivel: PoliticaDeReciboCi, codigo: CodigoDaFabrica,
  head: string | null): DecisaoDaFabrica => ({ contrato: CONTRATO_DECISAO_DA_FABRICA, eventoId, nivel,
  estado: nivel === 'exigir' ? 'bloqueado' : 'diagnostico', head, codigo });

/** Persistir sempre antecede publicação. Reentrega idêntica retorna o registro existente sem novo efeito. */
export function processarEventoDaFabrica(evento: EventoDaFabrica, nivel: PoliticaDeReciboCi,
  portas: PortasDoServicoDaFabrica, janelaMs = 300_000): DecisaoDaFabrica {
  const existente = portas.jaProcessado?.(evento.id);
  if (existente) return existente;
  const recebido = instante(evento.recebidoEm), emitido = instante(evento.emitidoEm);
  let decisao: DecisaoDaFabrica;
  if (!evento.assinaturaValida || !Number.isFinite(recebido) || !Number.isFinite(emitido)
      || emitido > recebido || recebido - emitido > janelaMs) {
    decisao = decisaoDeFalha(evento.id, nivel, 'ci.fabrica.prova-ausente', null);
  } else {
    try {
      const registros = portas.reler();
      const conferido = conferirRegistrosDaFabrica(registros);
      if (!conferido.ok) decisao = decisaoDeFalha(evento.id, nivel, conferido.codigo, registros.head);
      else {
        const codigo = portas.avaliarDestino?.(conferido.prova) ?? null;
        if (codigo) decisao = decisaoDeFalha(evento.id, nivel, codigo, registros.head);
        else {
          const resultado = portas.emitirResultado?.(conferido.prova);
          decisao = { contrato: CONTRATO_DECISAO_DA_FABRICA, eventoId: evento.id, nivel,
            estado: nivel === 'exigir' ? 'liberado' : 'diagnostico', head: registros.head,
            ...(resultado ? { resultadoForteSha256: resultado.sha256 } : {}) };
        }
      }
    } catch (erro) {
      const nome = (erro as Error).name;
      decisao = decisaoDeFalha(evento.id, nivel,
        nome === 'TimeoutError' ? 'ci.fabrica.prazo-excedido' : 'ci.fabrica.indisponivel', null);
    }
  }
  portas.persistir(decisao);
  portas.publicar(decisao);
  return decisao;
}
