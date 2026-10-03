/**
 * RM-040 (B7): `ork accounts esgotamentos`, a medida da metrica do item.
 *
 * A metrica da RM-040 e "zero despacho numa conta que outro projeto do mesmo usuario ja viu
 * esgotada, dentro do prazo dela". Este relatorio so le: as marcas do registro compartilhado
 * (`~/.orkastery/private/contas.json`) e os `phase_dispatch` com perfil dos ledgers de cada projeto
 * registrado nesta maquina (`~/.orkastery/projetos.json`). Conta o despacho que caiu na conta de
 * uma marca, dentro da janela dela, vindo de projeto diferente do que marcou.
 *
 * A saida nunca leva diretorio de conta: a conta vira um id opaco (sha256 da chave, 12 hex), o
 * projeto sai pelo nome registrado e o perfil, pelo id.
 *
 * Limite declarado: o registro so guarda as marcas vivas. Uso bem sucedido, login reconferido e
 * prazo vencido apagam a marca na gravacao seguinte; por isso o numero e um piso, e a leitura vale
 * enquanto a marca existe.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { formatarDataHora, legendaDoFuso } from './horario';
import { lerLedger } from './ledger';
import { parsePeriodo } from './ledger-stats';
import { listarProjetos } from './projeto-alvo';
import { chaveDaConta, ContaCompartilhada, lerContasCompartilhadas, validarPerfilDeDespacho } from './runtime-profiles';
import { dirThread, listarIds } from './thread';
import { tabela } from './util';

export const CONTRATO_ESGOTAMENTOS = 'ork.esgotamentos/v1';

export const LIMITE_DO_RELATORIO = 'o registro guarda so as marcas vivas (uso bem sucedido, login reconferido e prazo vencido ' +
  'apagam a marca): o total e um piso, valido enquanto a marca existe';

export interface MarcaDeConta {
  /** Id opaco da conta: os 12 primeiros hex do sha256 de `<runtime>:<diretorio real>`. */
  conta: string;
  runtime: string;
  estado: ContaCompartilhada['estado'];
  motivo: string;
  em: string;
  esgotadoAte: string | null;
  /** Nome do projeto que viu a falha, ou `nao registrado`. */
  projeto: string;
}

export interface DespachoEmContaMarcada {
  em: string;
  projeto: string;
  thread: string;
  fase: string | null;
  runtime: string;
  perfil: string;
  conta: string;
  marcadaPor: string;
}

export interface ProjetoLido {
  nome: string;
  presente: boolean;
  despachosComPerfil: number;
}

export interface RelatorioDeEsgotamentos {
  contrato: typeof CONTRATO_ESGOTAMENTOS;
  periodo: { desde: string; ate: string; intervalo: '[desde,ate)' };
  marcas: MarcaDeConta[];
  projetos: ProjetoLido[];
  despachos: DespachoEmContaMarcada[];
  total: number;
  limite: string;
}

export interface OpcoesDeEsgotamentos {
  desde?: string | number;
  agoraMs?: number;
}

export const NAO_REGISTRADO = 'nao registrado';

export function contaOpaca(chave: string): string {
  return createHash('sha256').update(chave).digest('hex').slice(0, 12);
}

function caminhoReal(p: string): string {
  try { return fs.realpathSync(p); } catch { return p; }
}

/** Fim da janela da marca: o prazo para cota esgotada; sem prazo (login, credencial paga), aberta. */
export function fimDaJanela(m: Pick<ContaCompartilhada, 'estado' | 'esgotadoAte'>): number {
  if (m.estado !== 'esgotado') return Number.POSITIVE_INFINITY;
  const ate = m.esgotadoAte === null ? NaN : Date.parse(m.esgotadoAte);
  return Number.isFinite(ate) ? ate : Number.NEGATIVE_INFINITY;
}

export function relatorioDeEsgotamentos(opcoes: OpcoesDeEsgotamentos = {}): RelatorioDeEsgotamentos {
  const agoraMs = opcoes.agoraMs ?? Date.now();
  const desdeMs = parsePeriodo(opcoes.desde ?? '7d', agoraMs);
  if (desdeMs >= agoraMs) throw Error('ledger.period.order');

  // Um projeto por raiz real: o registro pode trazer a mesma copia por dois caminhos.
  const vistos = new Set<string>();
  const projetos = listarProjetos().filter((p) => {
    const real = caminhoReal(p.raiz);
    if (vistos.has(real)) return false;
    vistos.add(real);
    return true;
  }).map((p) => ({ ...p, real: caminhoReal(p.raiz) }));
  const nomeDaRaiz = (raiz: string) => projetos.find((p) => p.real === caminhoReal(raiz))?.nome ?? NAO_REGISTRADO;

  const contas = lerContasCompartilhadas();
  const marcas = contas.map((c) => ({ c, real: caminhoReal(c.projeto), inicio: Date.parse(c.em), fim: fimDaJanela(c) }));

  const despachos: DespachoEmContaMarcada[] = [];
  const lidos: ProjetoLido[] = [];
  for (const p of projetos) {
    let comPerfil = 0;
    let ids: string[] = [];
    try { ids = p.presente ? listarIds(p.raiz) : []; } catch { ids = []; }
    for (const id of ids) {
      let eventos: ReturnType<typeof lerLedger> = [];
      try { eventos = lerLedger(dirThread(p.raiz, id)); } catch { continue; }
      for (const e of eventos) {
        if (e.tipo !== 'phase_dispatch' || e.perfil === undefined || e.perfil === null) continue;
        const t = Date.parse(String(e.ts));
        if (!Number.isFinite(t) || t < desdeMs || t >= agoraMs) continue;
        let perfil, chave: string;
        try { perfil = validarPerfilDeDespacho(e.perfil); chave = chaveDaConta(perfil); } catch { continue; }
        comPerfil++;
        const marca = marcas.find((m) => m.c.chave === chave && m.real !== p.real && t >= m.inicio && t < m.fim);
        if (!marca) continue;
        despachos.push({ em: new Date(t).toISOString(), projeto: p.nome, thread: String(e.thread ?? id),
          fase: typeof e.fase === 'string' ? e.fase : null, runtime: perfil.runtime, perfil: perfil.id,
          conta: contaOpaca(chave), marcadaPor: nomeDaRaiz(marca.c.projeto) });
      }
    }
    lidos.push({ nome: p.nome, presente: p.presente, despachosComPerfil: comPerfil });
  }
  despachos.sort((a, b) => a.em.localeCompare(b.em));

  return {
    contrato: CONTRATO_ESGOTAMENTOS,
    periodo: { desde: new Date(desdeMs).toISOString(), ate: new Date(agoraMs).toISOString(), intervalo: '[desde,ate)' },
    marcas: contas.map((c) => ({ conta: contaOpaca(c.chave), runtime: c.chave.slice(0, c.chave.indexOf(':')), estado: c.estado,
      motivo: c.motivo, em: c.em, esgotadoAte: c.esgotadoAte, projeto: nomeDaRaiz(c.projeto) })),
    projetos: lidos,
    despachos,
    total: despachos.length,
    limite: LIMITE_DO_RELATORIO,
  };
}

/** Texto para o terminal, com o horario do dono e o fuso uma vez no fim. */
export function textoDosEsgotamentos(r: RelatorioDeEsgotamentos): string {
  const linhas = [
    `Esgotamentos de conta  ${formatarDataHora(r.periodo.desde)} ate ${formatarDataHora(r.periodo.ate)} ${r.periodo.intervalo}`,
    `  marcas vivas no registro: ${r.marcas.length}`,
  ];
  for (const m of r.marcas) {
    const ate = m.estado === 'esgotado' ? `ate ${formatarDataHora(m.esgotadoAte)}` : 'sem prazo';
    linhas.push(`    conta ${m.conta}  ${m.runtime}  ${m.estado} desde ${formatarDataHora(m.em)}, ${ate}  visto em ${m.projeto} (${m.motivo})`);
  }
  linhas.push(`  projetos lidos: ${r.projetos.length === 0 ? 'nenhum registrado'
    : r.projetos.map((p) => `${p.nome} (${p.presente ? `${p.despachosComPerfil} despacho(s) com perfil` : 'fora do disco'})`).join(', ')}`);
  linhas.push(`  despachos em conta marcada por outro projeto: ${r.total}`);
  if (r.despachos.length > 0) {
    linhas.push(tabela(['QUANDO', 'PROJETO', 'THREAD', 'FASE', 'PERFIL', 'CONTA', 'MARCADA POR'],
      r.despachos.map((d) => [formatarDataHora(d.em), d.projeto, d.thread, d.fase ?? '-', d.perfil, d.conta, d.marcadaPor]))
      .split('\n').map((l) => `    ${l}`).join('\n'));
  }
  linhas.push(`  limite: ${r.limite}`);
  linhas.push(legendaDoFuso());
  return linhas.join('\n');
}
