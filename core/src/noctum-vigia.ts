/**
 * RM-058, fatia N4 (D3 a D6, D15 e D19 da ork-rm058n4): o condutor e o vigia do arco, numa máquina.
 *
 * O condutor (`conduzirArco`) é o laço que chama o passo do arco na cadência que a fila pede; o vigia (`vigiarArco`) é um
 * tique, chamado a cada 5 min (D3 do dono) por quem liga o modo (cron, serviço ou o transporte), independente do condutor
 * e do runtime que ele observa: lê só o disco, o kernel e a listagem do runtime, e nunca espera nenhum deles (a baseline
 * que um despacho pede nunca roda dentro do tique: ela fica para o condutor).
 *
 * A prova de vida é a trava do kernel (D3): o condutor segura `condutor.lock` pela vida inteira, e o vigia segura
 * `vigia.lock` durante o tique. Trava livre prova que o dono anterior não existe mais. Com a trava do condutor livre, o
 * vigia assume a condução (D5): grava a geração dele, lida sob a trava do log, com essa prova, e dá um passo por tique; o
 * condutor que volta toma uma geração nova, e o que perdeu a geração sai sem despachar (D4). Sem tique do vigia dentro do
 * limite, o condutor não despacha nada novo (D6); o tique que ficou aberto quando o vigia morreu é registrado pelo
 * seguinte, e tiques interrompidos em série no limite param o arco.
 *
 * A reconciliação das reservas e das sessões roda com a trava de despacho na mão (nenhum passo no meio), e a listagem do
 * runtime é lida sob ela, com o instante da leitura: a sessão despachada depois não morre por ausência (B3 do CHECK). Toda
 * recuperação passa pelo passo da N2 (D8): o vigia reconcilia (`noctum-reconciliacao.ts`) e autoriza; o passo despacha
 * com a trava de despacho, a conferência do envelope sob o lock do arco, a reserva e a capacidade. Com o arco revogado,
 * expirado ou parado, o vigia só fecha a contabilidade do que estava em voo: não para sessão nem autoriza retomada. Nenhuma
 * linha nova vai ao log do arco além do desfecho das reservas: o envelope não é renovado, emendado nem prorrogado por nada
 * aqui, e o despacho só sai por conta do envelope (D13 e D14).
 *
 * Nada aqui liga o modo (D19): nenhum comando, ferramenta ou gateway chama o vigia ou o condutor nesta fatia. RM-058,
 * integração (ork-rm058integra): o tique do arco chama o vigia (D7), o `ork noctum conduzir` roda o condutor (D9), e o passo
 * supervisionado chama a entrega da N5 depois do despacho, sob a mesma geração (D8); no tique do vigia, nada espera a fila
 * pesada, e o verify do SHA e o da atualização ficam para o condutor.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErroDaFilaPesada, kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { formatarDataHora } from './horario';
import { lerLedger, registrar } from './ledger';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { concluirDespacho, EstadoDoArco, lerArco, SituacaoDoArco } from './noctum-arco';
import { LeituraDeSessoes } from './noctum-capacidade';
import { envelopeComTrabalhos, envelopeMultimaquina } from './noctum-envelope';
import { MOTIVO_DA_BASELINE_FALHA, OpcoesDoPasso, passoDoArco, ResultadoDoPasso } from './noctum-execucao';
import { DecisoesDaSupervisao } from './noctum-fila';
import { OpcoesDoPassoDaMaquina, passoDaMaquina, RelatorioDaMaquina } from './noctum-maquinas';
import { OpcoesDaEntrega, passoDaEntrega, ResultadoDaEntrega } from './noctum-entrega';
import { decidirPedidos, decidirReservas, decidirSessoes, efeitosAbertos, LeitorDoRemoto, LeituraDoRuntime, listagemCompleta, ParadaDeSessao,
  paradaPorAmbiente, provaDaSessao, reconciliarEfeito, recusaDeAmbiente, retomadaPendente } from './noctum-reconciliacao';
import { alvosDaFase, assumirConducao, ConteudoV2, contasDoArco, dirDaSupervisao, EstadoDaSupervisao, gravarComEstado,
  gravarNaSupervisao, Instancia, lerSupervisao, MotivoDaRetomada, MotivoDoIsolamento, MotivoDoPassoEmEspera, observarContas, parametrosDoArco,
  ParametrosDaSupervisao } from './noctum-supervisao';
import { raizDoEstado } from './estado-thread';
import { cancelarPedido } from './retry';
import { ambienteDoPerfil } from './adapters/claude-bg';
import { lerPerfis, lerPerfisComContas, perfilDeDespacho, StoreDePerfis } from './runtime-profiles';
import { consultarContas } from './sessoes-contas';
import { sessoesEmVooDoArco } from './noctum-sessoes-em-voo';
import { dirThread } from './thread';
import { EventoLedger } from './types';
import { exec } from './util';

/** As dependências do vigia e do condutor; em produção, as leituras e os controles reais. */
export interface OpcoesDoVigia {
  quando?: string;
  maquina?: string;
  /** A instância deste processo (um uuid novo por chamada sem ela). */
  instancia?: string;
  /** A listagem do runtime em todas as contas, com as sessões paradas (`--all`); padrão `consultarContas`. */
  consultarRuntime?: () => LeituraDeSessoes;
  /** O store de perfis com o registro compartilhado; `null` é store ilegível. */
  lerStore?: () => StoreDePerfis | null;
  /** Para a sessão pelo controle suportado do runtime; a confirmação vem da listagem seguinte. */
  pararSessao?: (s: ParadaDeSessao) => { ok: boolean; detalhe: string };
  lerRemoto?: LeitorDoRemoto;
  /** As dependências do passo da N2 (os testes injetam o despacho e as leituras). */
  passo?: OpcoesDoPasso;
  /** O remoto e as opções de rede do ramo de coordenação; fixtures podem apontar para um remoto local. */
  coordenacao?: Pick<OpcoesDoPassoDaMaquina, 'remoto' | 'rede'>;
  /** RM-058, integração (T4, D8): as dependências do passo da entrega da N5 (a forja, o CI, o despacho do CHECK, o verify). */
  entrega?: OpcoesDaEntrega;
  /** O passo da entrega; em produção, `passoDaEntrega`. */
  entregar?: (carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaEntrega) => ResultadoDaEntrega;
  /** Testes: chamado logo depois do tique iniciado, para simular o vigia que morre no meio. */
  depoisDeIniciar?: () => void;
}

/**
 * RM-058, integração (T4, D8): a entrega que o passo supervisionado chamou depois do despacho, quando chamou; e a exceção
 * dela, que no tique vira lacuna e no condutor não derruba o laço.
 */
export interface EntregaDoPasso { entrega?: ResultadoDaEntrega | null; falhaDaEntrega?: string }

export type ResultadoConduzido = (ResultadoDoPasso
  | { acao: 'parado'; motivo: string; detalhe: string }
  | { acao: 'geracao-vencida'; detalhe: string }) & EntregaDoPasso & { maquina?: RelatorioDaMaquina };

export interface ResultadoDoTique {
  acao: 'tique';
  instancia: string;
  situacao: SituacaoDoArco | null;
  /** A instância do vigia anterior cujo tique ficou aberto, quando havia. */
  interrompido: string | null;
  reservas: number;
  retomadas: number;
  isolados: number;
  contas: number;
  parada: string | null;
  /** `vivo`: outro processo conduz; `assumido`: este tique deu o passo; `sem-passo`: arco parado ou fora da janela. */
  condutor: 'vivo' | 'assumido' | 'sem-passo';
  passo: ResultadoConduzido | null;
  lacunas: string[];
}

export type ResultadoDoVigia = ResultadoDoTique | { acao: 'sem-kernel' | 'outro-vigia' | 'sem-arco'; detalhe: string };

const ARQUIVO_DO_CONDUTOR = 'condutor.lock';
const ID_DE_SESSAO = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ARQUIVO_DO_VIGIA = 'vigia.lock';

function quemSou(papel: Instancia['papel'], opcoes: OpcoesDoVigia): Instancia {
  return { papel, instancia: opcoes.instancia ?? randomUUID(), pid: process.pid, maquina: nomeDaMaquina(opcoes.maquina) };
}

/** A leitura padrão do runtime: todas as contas, com as paradas, e o prazo da RM-063 por conta. */
function runtimePadrao(raiz: string, staleMin: number): () => LeituraDeSessoes {
  return () => consultarContas(raiz, { todas: true, staleMin, prazoMs: 30_000 });
}

function storePadrao(raiz: string): () => StoreDePerfis | null {
  return () => { try { return lerPerfisComContas(raiz); } catch { return null; } };
}

/**
 * A parada padrão (D12): `claude stop` com o ambiente do perfil da sessão, sem shell e com prazo. O codex só para pelo
 * controller vinculado, que o vigia não infere: sem ele, a parada não é confirmada e o trabalho segue para o teto.
 */
function pararPadrao(raiz: string): (s: ParadaDeSessao) => { ok: boolean; detalhe: string } {
  return (s) => {
    if (s.runtime !== 'claude-bg') return { ok: false, detalhe: `o vigia só para sessão claude-bg; ${s.runtime} exige o controller vinculado` };
    // O id vem do ledger: só um UUID vai à linha de comando do runtime.
    if (!ID_DE_SESSAO.test(s.sessionId)) return { ok: false, detalhe: 'id de sessão fora do formato: nada foi parado' };
    try {
      const p = s.perfil ? lerPerfis(raiz).perfis.find(x => x.id === s.perfil) : undefined;
      if (s.perfil && !p) return { ok: false, detalhe: `o perfil ${s.perfil} não está no store` };
      const r = exec('claude', ['stop', s.sessionId], undefined, 15_000, ambienteDoPerfil(p ? perfilDeDespacho(p) : null));
      return { ok: r.ok, detalhe: r.ok ? 'claude stop aceito' : `claude stop saiu ${r.code}` };
    } catch (e) { return { ok: false, detalhe: (e as Error).message.slice(0, 160) }; }
  };
}

/**
 * B1 do CHECK: as retomadas autorizadas que nenhuma reserva do arco atendeu ainda, a mais nova de cada trabalho; a fila
 * as trata como despacháveis na fase delas.
 */
function decisoesDaSupervisao(sup: EstadoDaSupervisao, estado: EstadoDoArco | null): DecisoesDaSupervisao {
  const retomadas = new Map<string, { fase: EstadoDaSupervisao['retomadas'][number]['fase']; tentativa: number; motivo: string }>();
  for (const trabalho of new Set(sup.retomadas.map(r => r.trabalho))) {
    const r = estado ? retomadaPendente(sup, estado, trabalho) : null;
    if (r) retomadas.set(trabalho, { fase: r.fase, tentativa: r.tentativa, motivo: r.motivo });
  }
  return { isolados: new Map([...sup.isolados].map(([t, i]) => [t, `${i.motivo}: ${i.detalhe}`] as const)), retomadas };
}

const v2 = (estado: EstadoDoArco | null): ConteudoV2 | null =>
  estado?.conteudo && envelopeComTrabalhos(estado.conteudo) ? estado.conteudo as ConteudoV2 : null;

/** Depois de uma recusa, o condutor não volta na hora ao mesmo candidato (B4 do CHECK). */
export const PAUSA_DEPOIS_DA_RECUSA_MS = 60_000;

/**
 * As recusas do núcleo que dependem da conta, da vaga, da condução ou da baseline, a do orçamento esgotado na reserva do
 * arco, e as que o próprio vigia gravou: passam, e não contam para isolar o trabalho. As outras (a árvore bloqueada, a
 * policy, o runtime indisponível no portão, o erro de contexto da thread, o erro antes de lançar) contam (RA2 da rodada 3:
 * o runtime indisponível não passa sozinho). No arco entre máquinas (A1 da rodada 3 da ork-rm058n3), a vaga global ocupada,
 * o ramo de coordenação sem leitura e a corrida perdida por ele também passam, como a vaga local.
 */
const RECUSAS_PASSAGEIRAS = ['runtime.quota-exhausted', 'runtime.auth-missing', 'runtime.rate-limited', 'concurrency.limite',
  'conducao.em-andamento', 'baseline.pendente', 'noctum.orcamento.esgotado',
  'noctum.coordenacao.vaga-global', 'noctum.coordenacao.sem-remoto', 'noctum.coordenacao.concorrencia'];
export const passageira = (motivo: string | null): boolean => !motivo || RECUSAS_PASSAGEIRAS.includes(motivo) || motivo.startsWith('noctum.reconciliacao.');

/**
 * As recusas seguidas do trabalho, das mais novas para trás, que não passam (B4 do CHECK), e o instante da reserva da
 * primeira delas: a série precisa durar uma cadência para isolar (aviso da rodada 4).
 */
export function recusasSeguidas(estado: EstadoDoArco, trabalho: string): { n: number; motivo: string | null; desde: string | null } {
  let n = 0, motivo: string | null = null, desde: string | null = null;
  for (const d of estado.despachos.filter(x => x.trabalho === trabalho).sort((a, b) => b.seq - a.seq)) {
    if (d.desfecho !== 'recusado' || passageira(d.motivo)) break;
    n += 1;
    motivo ??= d.motivo;
    desde = d.reservadoEm;
  }
  return { n, motivo, desde };
}

/** O vigia não roda a baseline dentro do tique (A6 do CHECK): ela fica para o condutor, e o passo espera por ela. */
function baselineFicaParaOCondutor(_carregado: ManifestoCarregado, thread: string): void {
  throw new ErroDaFilaPesada({ contrato: 'ork.fila-pesada-recusa/v1', motivo: 'fila-pesada.ocupada', operacao: 'verify.baseline', thread,
    slots: 0, esperouMs: 0, ocupantes: [], texto: `o vigia não roda a baseline da thread ${thread} dentro do tique: ela fica para o condutor do arco` });
}

/**
 * RM-058, integração (T4, D8): o vigia também não roda o verify do SHA nem o da atualização no tique; a entrega espera o
 * condutor com o mesmo motivo da baseline. O MASTER por omissão, a reconciliação, a publicação e a integração com as provas
 * prontas seguem no tique.
 */
function verifyFicaParaOCondutor(_carregado: ManifestoCarregado, thread: string): { ok: boolean } {
  throw new ErroDaFilaPesada({ contrato: 'ork.fila-pesada-recusa/v1', motivo: 'fila-pesada.ocupada', operacao: 'verify', thread,
    slots: 0, esperouMs: 0, ocupantes: [], texto: `o vigia não roda o verify da thread ${thread} dentro do tique: ele fica para o condutor do arco` });
}

/** A entrega fez um efeito (ou tentou um de resultado incerto)? A espera, o bloqueio e o nada não contam. */
const fezEfeito = (e: ResultadoDaEntrega | null | undefined): boolean => !!e && e.acao !== 'aguardar' && e.acao !== 'bloqueado' && e.acao !== 'nada';

/** A instância ainda tem a geração do arco? O vigia, pela geração de qualquer vigia; o condutor, pela dele (D4). */
function daGeracaoDe(sup: EstadoDaSupervisao, quem: Instancia): boolean {
  return quem.papel === 'vigia' ? sup.geracao?.quem.papel === 'vigia' : sup.geracao?.quem.instancia === quem.instancia;
}

/** O log público da supervisão nunca recebe o texto livre devolvido pelo adaptador ou pelo runtime. */
function detalheSeguroDaRecusa(motivo: string): string {
  if (motivo === 'noctum.origem.sem-prova') {
    return 'a prova do dono não pode ser reconferida neste processo: falta a chave ou o verificador público do canal';
  }
  if (motivo === 'noctum.efeito.sem-autorizacao') return 'o envelope não tem autorização vigente do dono';
  if (motivo.startsWith('noctum.envelope.')) return 'o núcleo recusou o envelope do arco';
  return `o núcleo recusou o passo antes do despacho (${motivo})`;
}

/** Registra só a transição da espera ou da recusa; repetição do mesmo motivo não cresce o log a cada cadência. */
function gravarEstadoDoPasso(carregado: ManifestoCarregado, arco: string, quem: Instancia, resultado: ResultadoConduzido,
  quando: string): void {
  gravarComEstado(carregado, arco, (s) => {
    if (resultado.acao === 'aguardar') {
      if (s.espera?.motivo === resultado.motivo) return [];
      return [{ tipo: 'passo_em_espera', papel: quem.papel, motivo: resultado.motivo as MotivoDoPassoEmEspera,
        ocupantes: resultado.ocupantes ?? [] }];
    }
    if (resultado.acao === 'recusado') {
      if (s.recusaDoPasso?.motivo === resultado.motivo) return [];
      return [{ tipo: 'passo_recusado', papel: quem.papel, trabalho: resultado.trabalho, motivo: resultado.motivo,
        detalhe: detalheSeguroDaRecusa(resultado.motivo) }];
    }
    if ((s.espera || s.recusaDoPasso) && ['despachou', 'encerrar'].includes(resultado.acao)) {
      return [{ tipo: 'passo_retomado', papel: quem.papel }];
    }
    return [];
  }, quando);
}

/**
 * Um passo do arco com a supervisão (D5, D6, D13 a D15): para o arco parado, sai da geração vencida, espera o vigia
 * ausente (só o condutor exige: o vigia que dá o passo está presente), e chama o passo da N2 com as contas e os alvos do
 * arco e as decisões da supervisão. A recusa de ambiente fica no log e, repetida, para o arco; a parada pelo teto do arco
 * ou pela violação de custo também.
 */
export function passoConduzido(carregado: ManifestoCarregado, arco: string, quem: Instancia, opcoes: OpcoesDoVigia = {}): ResultadoConduzido {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? new Date().toISOString();
  const agora = Date.parse(quando);
  const parametros = parametrosDoArco(carregado, arco, quando);
  const sup = lerSupervisao(raiz, arco);
  if (sup.parada) return { acao: 'parado', motivo: sup.parada.motivo, detalhe: sup.parada.detalhe };
  if (!daGeracaoDe(sup, quem)) {
    return { acao: 'geracao-vencida', detalhe: `a geração ${sup.geracao?.numero ?? 0} é de ${sup.geracao?.quem.papel ?? 'ninguém'} ` +
      `${sup.geracao?.quem.instancia ?? ''}; esta instância não despacha mais` };
  }
  const cadencia = new Date(agora + parametros.cadenciaMs).toISOString();
  if (quem.papel === 'condutor') {
    const vigia = sup.batidas.vigia;
    if (!vigia || agora - Date.parse(vigia.em) > parametros.vigiaAusenteMs) {
      const espera: ResultadoConduzido = { acao: 'aguardar', ate: cadencia, motivo: 'vigia-ausente', fila: null,
        detalhe: vigia ? `o último tique do vigia foi em ${formatarDataHora(vigia.em)}, há mais de ${Math.round(parametros.vigiaAusenteMs / 60000)} min: ` +
          'nada novo sai sem supervisão' : 'o vigia ainda não deu nenhum tique neste arco: nada novo sai sem supervisão' };
      gravarEstadoDoPasso(carregado, arco, quem, espera, quando);
      return espera;
    }
  }
  const estado = lerArco(raiz, arco, quando);
  const conteudo = v2(estado);
  const store = (opcoes.lerStore ?? storePadrao(raiz))();
  const visao = conteudo && estado ? contasDoArco(conteudo, estado, sup, store, quando) : null;
  if (visao?.parada) {
    gravarComEstado(carregado, arco, (s) => s.parada ? [] : [{ tipo: 'parada', motivo: visao.parada!.motivo, detalhe: visao.parada!.detalhe }], quando);
    return { acao: 'parado', motivo: visao.parada.motivo, detalhe: visao.parada.detalhe };
  }
  const opcoesDaN2: OpcoesDoPasso = { ...opcoes.passo, quando, maquina: opcoes.maquina ?? opcoes.passo?.maquina,
    ...(visao ? { perfis: () => visao.perfis } : {}),
    ...(conteudo && estado ? { alvos: (fase, runtime, modo) => alvosDaFase(carregado, conteudo, estado, fase, runtime, modo) } : {}),
    supervisao: decisoesDaSupervisao(sup, estado) };
  let r: ResultadoConduzido;
  if (estado?.conteudo && envelopeMultimaquina(estado.conteudo)) {
    const daMaquina = passoDaMaquina(carregado, arco, { ...opcoes.coordenacao, quando, maquina: opcoesDaN2.maquina,
      consultarSessoes: opcoesDaN2.consultarSessoes ?? opcoes.consultarRuntime, n2: opcoesDaN2 });
    if (daMaquina.acao === 'aguardar') {
      r = { acao: 'aguardar', ate: cadencia, motivo: daMaquina.motivo, fila: null, detalhe: daMaquina.detalhe, maquina: daMaquina.relatorio };
    } else {
      r = { ...daMaquina.passo, ...(daMaquina.acao === 'passo' ? { maquina: daMaquina.relatorio } : {}) };
    }
  } else {
    r = passoDoArco(carregado, arco, opcoesDaN2);
  }
  gravarEstadoDoPasso(carregado, arco, quem, r, quando);
  // N1 do CHECK 2: a baseline do trabalho que falhou sem ser espera isola o trabalho, com a causa: os outros seguem, e o
  // tique e o relatório dizem por quê.
  if (r.acao === 'recusado' && r.motivo === MOTIVO_DA_BASELINE_FALHA) isolar(carregado, arco, r.trabalho, r.thread, 'baseline-falhou', r.detalhe, quando);
  if (r.acao === 'recusado' && recusaDeAmbiente(r.detalhe)) {
    const depois = gravarNaSupervisao(carregado, arco, [{ tipo: 'recusa_de_ambiente', trabalho: r.trabalho, thread: r.thread,
      detalhe: r.detalhe.slice(0, 300) }], quando);
    const parada = paradaPorAmbiente(depois, lerArco(raiz, arco, quando)!);
    if (parada) gravarComEstado(carregado, arco, (s) => s.parada ? [] : [{ tipo: 'parada', motivo: parada.motivo, detalhe: parada.detalhe }], quando);
  }
  // RM-058, integração (T4, D8): a entrega depois do despacho, no máximo um efeito, relida a supervisão: com a parada ou a
  // geração que outro tomou entre os dois, nada é entregue por esta instância. Roda também no passo que encerra: a fila
  // vazia ainda deve o MASTER por omissão da última entrega do arco.
  const relida = lerSupervisao(raiz, arco);
  if (relida.parada || !daGeracaoDe(relida, quem)) return r;
  try {
    const entrega = (opcoes.entregar ?? passoDaEntrega)(carregado, arco, { maquina: opcoes.maquina ?? opcoes.passo?.maquina,
      lerReservas: opcoes.passo?.lerReservas, consultarSessoes: opcoes.passo?.consultarSessoes, ...(visao ? { perfis: () => visao.perfis } : {}),
      remoto: opcoes.coordenacao?.remoto, redeDaCoordenacao: opcoes.coordenacao?.rede, ...opcoes.entrega, quando });
    return { ...r, entrega };
  } catch (e) {
    return { ...r, entrega: null, falhaDaEntrega: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200) };
  }
}

/**
 * M1 do CHECK 3: sob a parada pelo teto, cada sessão do arco em voo que o runtime prova morta, passada a carência desde a
 * última atividade dela, vira `sessao_morta`, seja qual for o trabalho (isolado, com as retomadas esgotadas ou na fase da
 * entrega): a decisão de retomar não importa com o arco parado.
 */
function registrarMortesSobAParada(raiz: string, estado: EstadoDoArco, leitura: LeituraDoRuntime, parametros: ParametrosDaSupervisao,
  quando: string): void {
  for (const s of sessoesEmVooDoArco(raiz, estado)) {
    if (!s.sessionId || !s.thread) continue;
    let eventos: EventoLedger[];
    try { eventos = lerLedger(dirThread(raiz, s.thread)); } catch { continue; }
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === s.sessionId).at(-1);
    if (!despacho) continue;
    const p = provaDaSessao(leitura, s.sessionId, s.conta, s.runtime, despacho.ts, parametros.ausenciaMinimaMs);
    const ultimaAtividade = Math.max(...eventos.filter(e => e.sessionId === s.sessionId).map(e => Date.parse(e.ts)).filter(Number.isFinite));
    if (p.estado !== 'morta' || Date.parse(quando) - ultimaAtividade < parametros.carenciaMs) continue;
    registrarMorte(raiz, s.thread, { sessionId: s.sessionId, runtime: s.runtime, perfil: s.conta },
      `a sessão ${s.sessionId} acabou sem resultado com o arco parado pelo teto: ${p.detalhe}`);
  }
}

/** Grava `sessao_morta` no ledger da thread, uma vez por sessão: é o que solta a condução e a vaga (D10). */
function registrarMorte(raiz: string, thread: string, m: { sessionId: string; runtime: string; perfil: string | null }, prova: string): void {
  const dir = dirThread(raiz, thread);
  let eventos: EventoLedger[] = [];
  try { eventos = lerLedger(dir); } catch { return; }
  if (eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === m.sessionId)) return;
  // A fase da sessão é a do despacho dela (ou da falha que disse o id).
  const daSessao = [...eventos].reverse().find(e => (e.tipo === 'phase_dispatch' || e.tipo === 'phase_dispatch_failed') && e.sessionId === m.sessionId);
  registrar(dir, thread, 'sessao_morta', { fase: typeof daSessao?.fase === 'string' ? daSessao.fase : null, sessionId: m.sessionId,
    runtime: m.runtime, ...(m.perfil ? { perfilId: m.perfil } : {}), origem: 'noctum.vigia', evidencia: prova.slice(0, 300),
    razao: 'o vigia do arco provou o fim da sessão pelo runtime: solta a condução e a vaga para a retomada pelo passo do arco' });
}

/** Isola o trabalho uma vez (S1 do CHECK): o primeiro isolamento vale, e o tique seguinte não o regrava. */
function isolar(carregado: ManifestoCarregado, arco: string, trabalho: string, thread: string | null, motivo: MotivoDoIsolamento, detalhe: string,
  quando: string): boolean {
  let gravou = false;
  gravarComEstado(carregado, arco, (s) => {
    if (s.isolados.has(trabalho)) return [];
    gravou = true;
    return [{ tipo: 'isolado', trabalho, thread, motivo, detalhe: detalhe.slice(0, 300) }];
  }, quando);
  return gravou;
}

/**
 * Um tique do vigia (D3 a D6). Com a trava do vigia: registra o tique anterior que ficou aberto, observa as contas, e com
 * a trava de despacho na mão (nenhum passo no meio) lê o runtime e reconcilia as reservas pendentes e as sessões; tira da
 * fila durável os pedidos do arco já atendidos, relê os efeitos incertos, aplica as paradas e, com a trava do condutor
 * livre e o arco vigente, assume a condução e dá um passo. A exceção do passo vira lacuna do tique; a de antes dele (disco,
 * log adulterado) sobe, o tique fica aberto e o seguinte o registra como interrompido.
 */
export function vigiarArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoVigia = {}): ResultadoDoVigia {
  const { raiz } = carregado;
  if (!kernelDisponivel()) return { acao: 'sem-kernel', detalhe: 'o vigia exige /usr/bin/flock: sem a trava do kernel, nada prova a vida de ninguém' };
  if (!lerArco(raiz, arco)) return { acao: 'sem-arco', detalhe: `o arco ${arco} não tem proposta` };
  const dir = dirDaSupervisao(raiz, arco);
  const fdVigia = tentarTravaExclusiva(path.join(dir, ARQUIVO_DO_VIGIA));
  if (fdVigia === null) return { acao: 'outro-vigia', detalhe: 'outro vigia deste arco está no meio de um tique' };
  try {
    const quando = opcoes.quando ?? new Date().toISOString();
    const quem = quemSou('vigia', opcoes);
    const parametros = parametrosDoArco(carregado, arco, quando);
    // S6 do CHECK: com a trava do vigia na mão, todo tique aberto é de um vigia que morreu, até de uma instância de mesmo nome.
    let interrompido: string | null = null;
    let sup = gravarComEstado(carregado, arco, (s) => {
      interrompido = s.tiqueAberto?.quem.instancia ?? null;
      return [...(s.tiqueAberto ? [{ tipo: 'vigia_interrompido' as const, interrompido: s.tiqueAberto.quem.instancia,
        prova: `a trava do vigia estava livre: a instância ${s.tiqueAberto.quem.instancia} (pid ${s.tiqueAberto.quem.pid}) não a segura mais` }] : []),
        { tipo: 'tique_iniciado' as const, quem }];
    }, quando);
    opcoes.depoisDeIniciar?.();
    const lacunas: string[] = [];
    const contagem = { reservas: 0, retomadas: 0, isolados: 0, contas: 0 };
    if (sup.interrupcoesSeguidas >= parametros.interrupcoesQueParam && !sup.parada) {
      sup = gravarComEstado(carregado, arco, (s) => s.parada ? [] : [{ tipo: 'parada', motivo: 'supervisor-falhou',
        detalhe: `${s.interrupcoesSeguidas} tiques do vigia interrompidos em série (o limite é ${parametros.interrupcoesQueParam})` }], quando);
    }
    const estado = lerArco(raiz, arco, quando)!;
    const conteudo = v2(estado);
    if (conteudo) {
      const store = (opcoes.lerStore ?? storePadrao(raiz))();
      aplicarContas(carregado, arco, conteudo, store, quando, contagem);
      reconciliarSobATravaDeDespacho(carregado, arco, conteudo, parametros, quando, opcoes, lacunas, contagem);
      for (const d of decidirPedidos(raiz, arco, lerArco(raiz, arco, quando)!)) {
        cancelarPedido(carregado, d.pedido, d.motivo);
        gravarNaSupervisao(carregado, arco, [{ tipo: 'pedido_tratado', pedido: d.pedido, thread: d.thread, acao: 'cancelado', motivo: d.motivo.slice(0, 200) }], quando);
      }
      for (const id of efeitosAbertos(lerSupervisao(raiz, arco))) {
        const r = reconciliarEfeito(carregado, arco, id, { lerRemoto: opcoes.lerRemoto, quando });
        if (r.isolado) contagem.isolados += 1;
        if (r.desfecho === 'sem-leitura') lacunas.push(`efeito ${id}: ${r.prova}`);
      }
      const ambiente = paradaPorAmbiente(lerSupervisao(raiz, arco), lerArco(raiz, arco, quando)!);
      if (ambiente) gravarComEstado(carregado, arco, (s) => s.parada ? [] : [{ tipo: 'parada', ...ambiente }], quando);
    }
    sup = lerSupervisao(raiz, arco);
    // D5: com a trava do condutor livre, este tique conduz: a geração do vigia, com a prova, e um passo.
    let condutor: ResultadoDoTique['condutor'] = 'sem-passo';
    let passo: ResultadoConduzido | null = null;
    const vigente = lerArco(raiz, arco, quando)!.situacao === 'vigente';
    if (!sup.parada && vigente && conteudo) {
      const fdCondutor = tentarTravaExclusiva(path.join(dir, ARQUIVO_DO_CONDUTOR));
      if (fdCondutor === null) {
        condutor = 'vivo';
        const batida = sup.batidas.condutor;
        if (!batida || Date.parse(quando) - Date.parse(batida.em) > 3 * parametros.cadenciaMs) {
          lacunas.push(`o condutor segura a trava sem batida desde ${batida ? formatarDataHora(batida.em) : 'nunca'}: vivo, sem prova de ausência, ele não é substituído`);
        }
      } else {
        try {
          // A4 do CHECK: a geração é lida sob a trava do log, depois de tomar a trava do condutor.
          gravarComEstado(carregado, arco, (s) => s.geracao?.quem.papel === 'vigia' ? [] : [{ tipo: 'conducao_assumida' as const,
            geracao: (s.geracao?.numero ?? 0) + 1, quem,
            prova: s.geracao ? `a trava do condutor estava livre: a geração ${s.geracao.numero} (${s.geracao.quem.papel} ${s.geracao.quem.instancia}, ` +
              `pid ${s.geracao.quem.pid}) não a segura mais` : 'a trava do condutor estava livre: primeira condução do arco' }], quando);
          condutor = 'assumido';
          try {
            passo = passoConduzido(carregado, arco, quem, { ...opcoes, quando,
              passo: { ...opcoes.passo, gravarBaseline: (k, thread) => baselineFicaParaOCondutor(k, thread) },
              // RM-058, integração (T4, D8): no tique, nada espera a fila pesada nem a trava de despacho, e o verify fica para o condutor.
              entrega: { ...opcoes.entrega, esperarMs: 0, verificar: (k, thread) => verifyFicaParaOCondutor(k, thread) } });
            if (passo.falhaDaEntrega) lacunas.push(`a entrega lançou: ${passo.falhaDaEntrega}`);
          } catch (e) {
            // S7 do CHECK: o passo que lança (o adaptador do runtime, por exemplo) é lacuna do tique, e não queda do vigia.
            lacunas.push(`o passo lançou: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
          }
        } finally { fs.closeSync(fdCondutor); }
      }
    }
    const resumo = `reservas ${contagem.reservas}, retomadas ${contagem.retomadas}, isolados ${contagem.isolados}, contas ${contagem.contas}, ` +
      `condutor ${condutor}${passo ? `, passo ${passo.acao}` : ''}`;
    sup = gravarNaSupervisao(carregado, arco, [{ tipo: 'tique_concluido', quem, resumo }], quando);
    return { acao: 'tique', instancia: quem.instancia, situacao: lerArco(raiz, arco, quando)!.situacao, interrompido,
      ...contagem, parada: sup.parada?.motivo ?? null, condutor, passo, lacunas };
  } finally { fs.closeSync(fdVigia); }
}

/**
 * D7 e D10 a D12, com a trava de despacho na mão (nenhum passo no meio, B3 do CHECK): a listagem do runtime é lida sob ela,
 * com o instante da leitura; as reservas pendentes são decididas sobre o arco relido sob a trava (A3); e, com o arco
 * vigente e sem parada (A5), as sessões e as recusas repetidas. Com a trava ocupada, tudo fica para o tique seguinte.
 */
function reconciliarSobATravaDeDespacho(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, parametros: ParametrosDaSupervisao,
  quando: string, opcoes: OpcoesDoVigia, lacunas: string[], contagem: { reservas: number; retomadas: number; isolados: number }): void {
  const { raiz } = carregado;
  const noctum = path.join(raizDoEstado(raiz), '.orkastery', 'noctum');
  const fd = tentarTravaExclusiva(path.join(noctum, 'despacho.lock'));
  if (fd === null) { lacunas.push('um passo segura a trava de despacho: reservas e sessões ficam para o próximo tique'); return; }
  try {
    const consultar = opcoes.consultarRuntime ?? runtimePadrao(raiz, carregado.manifesto.concurrency.stale_after_min);
    const leitura: LeituraDoRuntime = { ...consultar(), lidaEm: quando };
    lacunas.push(...leitura.fontes.filter(f => !f.ok || f.ausente).map(f => `${f.origem}: ${f.ok ? 'ausente' : f.detalhe}`));
    for (const d of decidirReservas(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, leitura, parametros, quando)) {
      if (d.acao === 'concluir') {
        concluirDespacho(raiz, arco, d.seq, { thread: d.thread ?? '', sessionId: d.sessionId, idempotente: d.idempotente }, quando);
        if (d.morta && d.thread) registrarMorte(raiz, d.thread, d.morta, d.prova);
        contagem.reservas += 1;
      } else if (d.acao === 'devolver') {
        concluirDespacho(raiz, arco, d.seq, { motivo: d.motivo! }, quando);
        contagem.reservas += 1;
      } else if (d.acao === 'aguardar') lacunas.push(`reserva ${d.seq} do trabalho ${d.trabalho}: ${d.prova}`);
      if (d.isolamento && isolar(carregado, arco, d.trabalho, d.thread, d.isolamento.motivo, d.isolamento.detalhe, quando)) contagem.isolados += 1;
    }
    const estado = lerArco(raiz, arco, quando)!;
    const sup = lerSupervisao(raiz, arco);
    // N2 do CHECK 2: com a parada pelo teto, o arco espera as sessões admitidas. A que o runtime prova morta sem resultado no
    // ledger vira `sessao_morta`, sem retomada nem parada, e o fechamento pelo teto não fica preso a ela até a hora.
    if (estado.situacao === 'vigente' && sup.parada?.motivo === 'teto-do-arco') {
      registrarMortesSobAParada(raiz, estado, leitura, sup.parametros!, quando);
      return;
    }
    if (estado.situacao !== 'vigente' || sup.parada) return;
    aplicarSessoes(carregado, arco, conteudo, leitura, quando, opcoes, lacunas, contagem, consultar);
    // B4 do CHECK: o trabalho que o núcleo recusa seguidas vezes pelo mesmo tipo de motivo (a árvore, a policy, o erro
    // antes de lançar) não volta a noite toda: no teto, e com a série durando ao menos uma cadência, é isolado. O soluço
    // mais curto que a cadência (a conferência de login inconclusiva da A14, que o núcleo refaz a cada despacho) não isola.
    const depois = lerArco(raiz, arco, quando)!;
    for (const t of conteudo.trabalhos) {
      const r = recusasSeguidas(depois, t.id);
      if (r.n >= parametros.tetoDeRetomadas && r.desde !== null && Date.parse(quando) - Date.parse(r.desde) >= parametros.cadenciaMs &&
          isolar(carregado, arco, t.id, null, r.motivo === 'noctum.despacho.erro' ? 'erro-repetido' : 'recusas-repetidas',
            `${r.n} despachos seguidos recusados pelo núcleo (${String(r.motivo)}): o dono decide`, quando)) contagem.isolados += 1;
    }
  } finally { fs.closeSync(fd); }
}

/** D13 e D15: as contas que os despachos do arco e o store provaram fora, e a parada por custo. */
function aplicarContas(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, store: StoreDePerfis | null, quando: string,
  contagem: { contas: number }): void {
  const { raiz } = carregado;
  const o = observarContas(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, lerSupervisao(raiz, arco), store, quando);
  if (o.eventos.length) gravarNaSupervisao(carregado, arco, o.eventos, quando);
  if (o.parada) gravarComEstado(carregado, arco, (s) => s.parada ? [] : [{ tipo: 'parada', motivo: o.parada!.motivo, detalhe: o.parada!.detalhe }], quando);
  contagem.contas += o.eventos.length;
}

/**
 * D10 a D12 e D16: aplica as decisões das sessões. A sessão viva é parada pelo controle do runtime e conferida numa
 * listagem nova; sem confirmação, a parada fica no log como não confirmada e nada é autorizado (no teto das tentativas, o
 * trabalho é isolado). Confirmada, ou já morta, a sessão vira `sessao_morta` no ledger da thread e a retomada é autorizada.
 */
function aplicarSessoes(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, leitura: LeituraDoRuntime, quando: string,
  opcoes: OpcoesDoVigia, lacunas: string[], contagem: { retomadas: number; isolados: number }, consultar: () => LeituraDeSessoes): void {
  const { raiz } = carregado;
  const sup = lerSupervisao(raiz, arco);
  const parametros = sup.parametros!;
  const parar = opcoes.pararSessao ?? pararPadrao(raiz);
  /** Para a sessão e confere numa listagem nova: a prova, ou `null` quando o runtime não confirmou. */
  const pararEConferir = (p: ParadaDeSessao, motivo: MotivoDaRetomada, trabalho: string): string | null => {
    const pedido = parar(p);
    // A listagem nova depois do pedido: aqui a sessão já existia antes, e a ausência na listagem completa prova o fim.
    const listagem: LeituraDoRuntime = consultar();
    const depois = listagemCompleta(listagem) || listagem.sessoes.some(x => x.sessionId === p.sessionId)
      ? provaDaSessao(listagem, p.sessionId, p.perfil, p.runtime) : { estado: 'desconhecida' as const, detalhe: 'a listagem depois da parada não veio completa' };
    const confirmada = pedido.ok && depois.estado === 'morta';
    const prova = `${pedido.detalhe}; depois: ${depois.detalhe}`;
    gravarNaSupervisao(carregado, arco, [{ tipo: 'sessao_parada', trabalho, thread: p.thread, sessionId: p.sessionId, motivo, confirmada, prova }], quando);
    if (confirmada) registrarMorte(raiz, p.thread, p, prova);
    return confirmada ? prova : null;
  };
  for (const d of decidirSessoes(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, sup, leitura, quando)) {
    if (d.acao === 'aguardar') { lacunas.push(`${d.thread}: ${d.detalhe}`); continue; }
    if (d.acao === 'isolar') {
      if (d.parar) pararEConferir(d.parar, d.motivo === 'sem-primeiro-turno' ? 'sem-primeiro-turno' : 'sem-avanco', d.trabalho);
      if (isolar(carregado, arco, d.trabalho, d.thread, d.motivo, d.detalhe, quando)) contagem.isolados += 1;
      continue;
    }
    let prova: string | null = null;
    if (d.parar) {
      prova = pararEConferir(d.parar, d.motivo, d.trabalho);
      if (!prova) {
        const falhas = lerSupervisao(raiz, arco).sessoesParadas.filter(x => x.sessionId === d.parar!.sessionId && !x.confirmada).length;
        if (falhas >= parametros.tetoDeRetomadas) {
          if (isolar(carregado, arco, d.trabalho, d.thread, 'sessao-presa',
            `a sessão ${d.parar.sessionId} não parou pelo controle do runtime em ${falhas} tentativa(s): o dono a encerra`, quando)) contagem.isolados += 1;
        } else lacunas.push(`${d.thread}: a parada da sessão ${d.parar.sessionId} não foi confirmada pelo runtime`);
        continue;
      }
    }
    if (d.morta) registrarMorte(raiz, d.thread, d.morta, d.prova);
    gravarNaSupervisao(carregado, arco, [{ tipo: 'retomada_autorizada', trabalho: d.trabalho, thread: d.thread, fase: d.fase, tentativa: d.tentativa,
      motivo: d.motivo, sessao: d.sessao, prova: (prova ? `${d.prova}; parada confirmada: ${prova}` : d.prova).slice(0, 400),
      aposReserva: d.aposReserva }], quando);
    contagem.retomadas += 1;
  }
}

export type ResultadoDoCondutor =
  | { acao: 'sem-kernel' | 'outro-condutor' | 'sem-arco'; detalhe: string }
  | { acao: 'saiu'; instancia: string; geracao: number; passos: number; ultimo: ResultadoConduzido | null };

/**
 * O condutor do arco (D4 e D6): segura a trava do condutor pela vida inteira, grava a geração nova (lida sob a trava do
 * log) com a prova, bate a cada passo e chama o passo supervisionado na cadência que a fila pede, nunca além da cadência;
 * depois de uma recusa, espera `PAUSA_DEPOIS_DA_RECUSA_MS` (B4 do CHECK), ou a cadência inteira na recusa que passa. Sai
 * quando o arco encerra (a fila vazia, com a entrega sem efeito no passo) ou para, quando perde a geração, ou no fim dos
 * passos que lhe deram (os testes). `dormir` é dependência.
 */
export function conduzirArco(carregado: ManifestoCarregado, arco: string,
  opcoes: OpcoesDoVigia & { maxPassos?: number; dormir?: (ms: number) => void; relogio?: () => string } = {}): ResultadoDoCondutor {
  const { raiz } = carregado;
  if (!kernelDisponivel()) return { acao: 'sem-kernel', detalhe: 'o condutor exige /usr/bin/flock' };
  if (!lerArco(raiz, arco)) return { acao: 'sem-arco', detalhe: `o arco ${arco} não tem proposta` };
  const fd = tentarTravaExclusiva(path.join(dirDaSupervisao(raiz, arco), ARQUIVO_DO_CONDUTOR));
  if (fd === null) return { acao: 'outro-condutor', detalhe: 'outro processo conduz este arco agora (ou o vigia está no passo dele)' };
  const dormir = opcoes.dormir ?? ((ms: number) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(ms)); });
  try {
    const relogio = opcoes.relogio ?? (() => new Date().toISOString());
    const quem = quemSou('condutor', opcoes);
    const parametros = parametrosDoArco(carregado, arco, relogio());
    const geracao = assumirConducao(carregado, arco, quem, (anterior) => anterior
      ? `a trava do condutor estava livre: a geração ${anterior.numero} (${anterior.quem.papel} ${anterior.quem.instancia}) não a segura mais`
      : 'a trava do condutor estava livre: primeira condução do arco', relogio());
    let ultimo: ResultadoConduzido | null = null, passos = 0;
    for (; passos < (opcoes.maxPassos ?? Number.POSITIVE_INFINITY); passos++) {
      const quando = relogio();
      gravarNaSupervisao(carregado, arco, [{ tipo: 'batida', quem, geracao }], quando);
      ultimo = passoConduzido(carregado, arco, quem, { ...opcoes, quando });
      // RM-058, integração (D8): a fila vazia só tira o condutor quando a entrega também não fez efeito no passo.
      if ((ultimo.acao === 'encerrar' && !fezEfeito(ultimo.entrega)) || ultimo.acao === 'parado' || ultimo.acao === 'geracao-vencida') {
        passos += 1;
        break;
      }
      // A recusa que passa (a conta, a vaga, a condução, o orçamento esgotado na reserva) espera a cadência, que é quando
      // o vigia relê as contas; a que conta (a árvore, a policy) volta depois da pausa, e repetida isola o trabalho (RA2 da
      // rodada 3).
      // A5 do CHECK: o passo que acabou de gravar a baseline volta já; o `ate` dele é o relógio depois da suíte, e medir a
      // espera do começo da iteração faria o condutor dormir a cadência inteira antes de despachar.
      const doPasso = ultimo.acao === 'aguardar' ? (ultimo.motivo === 'baseline-gravada' ? Date.parse(quando) : Date.parse(ultimo.ate))
        : ultimo.acao === 'recusado' ? Date.parse(quando) + (passageira(ultimo.motivo) ? parametros.cadenciaMs : PAUSA_DEPOIS_DA_RECUSA_MS)
        : Date.parse(quando);
      // RM-058, integração (D8): o menor `ate` do despacho e da entrega; a entrega que fez um efeito volta já, e a que não tem
      // nada a entregar (ou bloqueou) não adianta o laço.
      const e = ultimo.entrega;
      const daEntrega = !e ? Number.POSITIVE_INFINITY : e.acao === 'aguardar' ? Date.parse(e.ate)
        : e.acao === 'nada' || e.acao === 'bloqueado' ? Number.POSITIVE_INFINITY : Date.parse(quando);
      dormir(Math.max(0, Math.min(Math.min(doPasso, daEntrega) - Date.parse(quando), parametros.cadenciaMs)));
    }
    return { acao: 'saiu', instancia: quem.instancia, geracao, passos, ultimo };
  } finally { fs.closeSync(fd); }
}
