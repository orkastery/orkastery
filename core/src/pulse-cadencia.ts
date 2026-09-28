/**
 * I-50 (RM-039): a cadencia do resumo do pulse, trocada pelo dono em conversa com uma tag.
 *
 * As tags sao as que o dono definiu:
 *   `#OrkPulseOff`      de 8 em 8 horas, ancorado as 08h do fuso dono (08h, 16h e 00h);
 *   `#OrkPulseOn`       de 2 em 2 horas;
 *   `#OrkPulseOn-15m`, `-30m` e `-60m`: de 15, 30 ou 60 minutos.
 *
 * O cron bate em intervalo curto e quem decide se ESTA batida entrega e o nucleo, lendo a
 * cadencia duravel em `.orkastery/monitor/pulse-cadencia.json`. Assim a troca de tag vale na
 * proxima batida, sem editar o crontab. A cadencia governa o status periodico; pergunta de
 * verdade ao dono nao espera janela nenhuma e sai na hora.
 *
 * Cada cadencia divide o dia do dono em janelas ancoradas (15m em :00, :15, :30 e :45; 2h nas
 * horas pares; 8h as 08h, 16h e 00h). Entrega-se no maximo uma vez por janela.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatarDataHoraRotulada, fusoDoDono, partesLocais } from './horario';
import { raizDoEstado } from './estado-thread';

export const CONTRATO_CADENCIA = 'ork.pulse-cadencia/v1' as const;
const ARQUIVO_CADENCIA = 'pulse-cadencia.json';
const ARQUIVO_ULTIMO_RESUMO = 'pulse-ultimo-resumo.json';

export type TagDoPulse = '#OrkPulseOff' | '#OrkPulseOn' | '#OrkPulseOn-15m' | '#OrkPulseOn-30m' | '#OrkPulseOn-60m';

export interface DefinicaoDeCadencia {
  tag: TagDoPulse;
  janelaMin: number;
  /** Minuto do dia, no fuso do dono, em que a primeira janela comeca. */
  ancoraMin: number;
  descricao: string;
}

export const CADENCIAS: Readonly<Record<TagDoPulse, DefinicaoDeCadencia>> = {
  '#OrkPulseOff': { tag: '#OrkPulseOff', janelaMin: 480, ancoraMin: 8 * 60, descricao: 'de 8 em 8 horas, as 08h, 16h e 00h' },
  '#OrkPulseOn': { tag: '#OrkPulseOn', janelaMin: 120, ancoraMin: 0, descricao: 'de 2 em 2 horas' },
  '#OrkPulseOn-15m': { tag: '#OrkPulseOn-15m', janelaMin: 15, ancoraMin: 0, descricao: 'de 15 em 15 minutos' },
  '#OrkPulseOn-30m': { tag: '#OrkPulseOn-30m', janelaMin: 30, ancoraMin: 0, descricao: 'de 30 em 30 minutos' },
  '#OrkPulseOn-60m': { tag: '#OrkPulseOn-60m', janelaMin: 60, ancoraMin: 0, descricao: 'de hora em hora' },
};

/** Sem tag gravada, vale a hora cheia: o pedido do dono em 20/09/2026. */
export const CADENCIA_PADRAO: TagDoPulse = '#OrkPulseOn-60m';

export interface CadenciaGravada {
  contrato: typeof CONTRATO_CADENCIA;
  tag: TagDoPulse;
  por: string;
  canal: string;
  em: string;
}

/** A primeira tag de pulse do texto, em qualquer canal; `null` quando nao ha. */
export function extrairTagDoPulse(texto: unknown): TagDoPulse | null {
  if (typeof texto !== 'string') return null;
  const m = /#OrkPulse(On|Off)(?:-(15|30|60)m)?(?![\w-])/i.exec(texto);
  if (!m) return null;
  if (m[1].toLowerCase() === 'off') return m[2] ? null : '#OrkPulseOff';
  return m[2] ? (`#OrkPulseOn-${m[2]}m` as TagDoPulse) : '#OrkPulseOn';
}

const dirDoMonitor = (raiz: string, estadoDir?: string) => estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor');

/** A cadencia em vigor: a gravada pelo dono, ou a padrao. Arquivo ilegivel vale a padrao. */
export function lerCadencia(raiz: string, estadoDir?: string): DefinicaoDeCadencia & { gravada: CadenciaGravada | null } {
  try {
    const bruto = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz, estadoDir), ARQUIVO_CADENCIA), 'utf8')) as CadenciaGravada;
    if (bruto.contrato === CONTRATO_CADENCIA && Object.hasOwn(CADENCIAS, bruto.tag)) return { ...CADENCIAS[bruto.tag], gravada: bruto };
  } catch { /* sem cadencia gravada: vale a padrao */ }
  return { ...CADENCIAS[CADENCIA_PADRAO], gravada: null };
}

/** Grava a tag do dono. `por` e quem mandou (o remetente autenticado do canal, ou o operador). */
export function gravarCadencia(raiz: string, tag: TagDoPulse, origem: { por: string; canal: string; em?: string },
  estadoDir?: string): CadenciaGravada {
  if (!Object.hasOwn(CADENCIAS, tag)) throw new Error(`pulse.cadencia: tag desconhecida ${tag}`);
  const por = origem.por.trim();
  if (!por) throw new Error('pulse.cadencia: informe quem trocou a cadencia');
  const gravada: CadenciaGravada = { contrato: CONTRATO_CADENCIA, tag, por, canal: origem.canal, em: origem.em ?? new Date().toISOString() };
  const dir = dirDoMonitor(raiz, estadoDir);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${ARQUIVO_CADENCIA}.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(gravada, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, path.join(dir, ARQUIVO_CADENCIA));
  return gravada;
}

/** O numero da janela de um instante: minutos locais desde a ancora, divididos pela janela. */
export function janelaDoInstante(def: Pick<DefinicaoDeCadencia, 'janelaMin' | 'ancoraMin'>, quando: string | number,
  fuso: string = fusoDoDono().fuso): number {
  const p = partesLocais(quando, fuso);
  const localMin = Date.UTC(Number(p.ano), Number(p.mes) - 1, Number(p.dia), Number(p.hora), Number(p.minuto)) / 60000;
  return Math.floor((localMin - def.ancoraMin) / def.janelaMin);
}

/** Quando a proxima janela comeca, em ISO: para dizer ao dono a hora do proximo resumo. */
export function inicioDaProximaJanela(def: Pick<DefinicaoDeCadencia, 'janelaMin' | 'ancoraMin'>, quando: string,
  fuso: string = fusoDoDono().fuso): string {
  const atual = janelaDoInstante(def, quando, fuso);
  let t = Date.parse(quando);
  // Avanca minuto a minuto no maximo uma janela: simples e sem aritmetica de fuso.
  for (let i = 0; i <= def.janelaMin; i++) {
    t += 60_000;
    if (janelaDoInstante(def, t, fuso) > atual) {
      const d = new Date(t);
      d.setUTCSeconds(0, 0);
      return d.toISOString();
    }
  }
  return new Date(t).toISOString();
}

export function lerUltimoResumo(raiz: string, estadoDir?: string): string | null {
  try {
    const bruto = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz, estadoDir), ARQUIVO_ULTIMO_RESUMO), 'utf8')) as { em?: unknown };
    return typeof bruto.em === 'string' && Number.isFinite(Date.parse(bruto.em)) ? bruto.em : null;
  } catch { return null; }
}

export function gravarUltimoResumo(raiz: string, em: string, estadoDir?: string): void {
  const dir = dirDoMonitor(raiz, estadoDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ARQUIVO_ULTIMO_RESUMO), JSON.stringify({ em }) + '\n', { mode: 0o600 });
}

/**
 * Esta batida do cron pode entregar o status periodico? So quando a janela mudou desde o ultimo
 * resumo entregue. Pergunta nova ao dono nao passa por aqui: ela sai na hora.
 */
export function janelaAberta(def: Pick<DefinicaoDeCadencia, 'janelaMin' | 'ancoraMin'>, ultimoResumoEm: string | null,
  quando: string, fuso: string = fusoDoDono().fuso): boolean {
  if (!ultimoResumoEm) return true;
  return janelaDoInstante(def, quando, fuso) > janelaDoInstante(def, ultimoResumoEm, fuso);
}

/** A confirmacao que volta ao dono pelo mesmo canal, no fuso dele. */
export function textoDaCadencia(def: DefinicaoDeCadencia, quando: string): string {
  return `Pulse ${def.descricao} (${def.tag}). Pergunta para você continua saindo na hora. ` +
    `Próximo resumo com novidade a partir de ${formatarDataHoraRotulada(inicioDaProximaJanela(def, quando))}.`;
}
