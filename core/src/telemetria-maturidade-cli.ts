/** RM-090 F5: leitura local dos indicadores do maestro, independente de opt-in e rede. */
import * as fs from 'node:fs';
import { caminhoLedger } from './ledger';
import { msg } from './locale';
import { raizDoEstado } from './estado-thread';
import { calcularMaturidade, EventoAnalitico, JanelaAnalitica } from './telemetria-maturidade';
import { calcularDora } from './telemetria-maturidade-dora';
import { dirThread, listarIds } from './thread';

export const CONTRATO_CLI_MATURIDADE = 'ork.telemetria-maturidade-cli/v1' as const;

export interface EntradaMaturidadeCli {
  raiz: string;
  desde?: string;
  ate?: string;
  json?: boolean;
  escrever?: (texto: string) => void;
  dependencias?: Partial<DependenciasMaturidadeCli>;
}

export interface DependenciasMaturidadeCli {
  eventos(raiz: string): EventoAnalitico[];
}

function eventosPadrao(raiz: string): EventoAnalitico[] {
  // A resolução da raiz segue a mesma política do estado; não abre endpoint nem configuração de telemetria.
  raizDoEstado(raiz);
  const eventos: EventoAnalitico[] = [];
  for (const thread of listarIds(raiz)) {
    const arquivo = caminhoLedger(dirThread(raiz, thread));
    if (!fs.existsSync(arquivo)) continue;
    for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
      if (!linha.trim()) continue;
      let valor: unknown;
      try { valor = JSON.parse(linha); } catch { continue; }
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) eventos.push(valor as EventoAnalitico);
    }
  }
  return eventos;
}

function janela(desde?: string, ate?: string): JanelaAnalitica {
  if (!desde || !ate || !Number.isFinite(Date.parse(desde)) || !Number.isFinite(Date.parse(ate))
    || Date.parse(desde) >= Date.parse(ate)) throw new Error(msg().telemetria.uso);
  return { desde: new Date(desde).toISOString(), ate: new Date(ate).toISOString() };
}

const DEPENDENCIAS: DependenciasMaturidadeCli = { eventos: eventosPadrao };

export function comandoMaturidade(entrada: EntradaMaturidadeCli): { codigo: number; resposta: Record<string, unknown> } {
  const intervalo = janela(entrada.desde, entrada.ate);
  const d = { ...DEPENDENCIAS, ...entrada.dependencias } as DependenciasMaturidadeCli;
  const analytics = calcularMaturidade(d.eventos(entrada.raiz), intervalo);
  const dora = calcularDora([], []);
  const resposta = { schema: CONTRATO_CLI_MATURIDADE, command: 'maturidade', window: intervalo,
    analytics, dora, doraSource: 'fatos externos não disponíveis na leitura local' };
  const escrever = entrada.escrever ?? ((texto: string) => console.log(texto));
  if (entrada.json) escrever(JSON.stringify(resposta, null, 2));
  else {
    escrever(msg().telemetria.maturidadeJanela(intervalo.desde, intervalo.ate));
    for (const indicador of analytics.indicadores) {
      const series = indicador.series.map((item) => `${item.id}=${JSON.stringify(item.valor)}`).join('; ');
      escrever(msg().telemetria.maturidadeIndicador(indicador.id, series,
        indicador.cobertura.confirmados, indicador.cobertura.total));
    }
    escrever(msg().telemetria.maturidadeDora);
  }
  return { codigo: 0, resposta };
}
