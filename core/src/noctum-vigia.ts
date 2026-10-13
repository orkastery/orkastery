/**
 * RM-058, fatia N4 (D3 a D6, D15 e D19 da ork-rm058n4): o condutor e o vigia do arco, numa máquina.
 *
 * O condutor (`conduzirArco`) é o laço que chama o passo do arco na cadência que a fila pede; o vigia (`vigiarArco`) é um
 * tique, chamado a cada 5 min (D3 do dono) por quem liga o modo (cron, serviço ou o transporte), independente do condutor
 * e do runtime que ele observa: lê só o disco, o kernel e a listagem do runtime, e nunca espera nenhum deles.
 *
 * A prova de vida é a trava do kernel (D3): o condutor segura `condutor.lock` pela vida inteira, e o vigia segura
 * `vigia.lock` durante o tique. Trava livre prova que o dono anterior não existe mais. Com a trava do condutor livre, o
 * vigia assume a condução (D5): grava a geração dele, com essa prova, e dá um passo por tique; o condutor que volta toma
 * uma geração nova, e o que perdeu a geração sai sem despachar (D4). Sem tique do vigia dentro do limite, o condutor não
 * despacha nada novo (D6); o tique que ficou aberto quando o vigia morreu é registrado pelo seguinte, e tiques interrompidos
 * em série no limite param o arco.
 *
 * Toda recuperação passa pelo passo da N2 (D8): o vigia reconcilia (`noctum-reconciliacao.ts`) e autoriza; o passo despacha
 * com a trava de despacho, a conferência do envelope sob o lock do arco, a reserva e a capacidade. Nenhuma linha nova vai ao
 * log do arco além do desfecho das reservas: o envelope não é renovado, emendado nem prorrogado por nada aqui, e o despacho
 * só sai por conta do envelope (D13 e D14).
 *
 * Nada aqui liga o modo (D19): nenhum comando, ferramenta ou gateway chama o vigia ou o condutor nesta fatia.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { formatarDataHora } from './horario';
import { lerLedger, registrar } from './ledger';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { concluirDespacho, EstadoDoArco, lerArco, SituacaoDoArco } from './noctum-arco';
import { LeituraDeSessoes } from './noctum-capacidade';
import { envelopeComTrabalhos } from './noctum-envelope';
import { OpcoesDoPasso, passoDoArco, ResultadoDoPasso } from './noctum-execucao';
import { DecisoesDaSupervisao } from './noctum-fila';
import { decidirPedidos, decidirReservas, decidirSessoes, efeitosAbertos, LeitorDoRemoto, ParadaDeSessao, paradaPorAmbiente, provaDaSessao,
  reconciliarEfeito, recusaDeAmbiente } from './noctum-reconciliacao';
import { alvosDaFase, ConteudoV2, contasDoArco, dirDaSupervisao, EstadoDaSupervisao, EventoDaSupervisao, gravarNaSupervisao, Instancia,
  lerSupervisao, MotivoDaRetomada, observarContas, parametrosDoArco, ParametrosDaSupervisao, retomadasDe } from './noctum-supervisao';
import { raizDoEstado } from './estado-thread';
import { cancelarPedido } from './retry';
import { ambienteDoPerfil } from './adapters/claude-bg';
import { lerPerfis, lerPerfisComContas, perfilDeDespacho, StoreDePerfis } from './runtime-profiles';
import { consultarContas } from './sessoes-contas';
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
  /** Testes: chamado logo depois do tique iniciado, para simular o vigia que morre no meio. */
  depoisDeIniciar?: () => void;
}

export type ResultadoConduzido = ResultadoDoPasso
  | { acao: 'parado'; motivo: string; detalhe: string }
  | { acao: 'geracao-vencida'; detalhe: string };

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

/** As retomadas autorizadas que nenhum despacho da thread atendeu ainda: a mais nova de cada trabalho. */
function retomadasPendentes(raiz: string, sup: EstadoDaSupervisao): Map<string, { fase: EstadoDaSupervisao['retomadas'][number]['fase']; tentativa: number;
  motivo: string }> {
  const pendentes = new Map<string, { fase: EstadoDaSupervisao['retomadas'][number]['fase']; tentativa: number; motivo: string }>();
  const despachos = new Map<string, number>();
  for (const r of sup.retomadas) {
    if (!despachos.has(r.thread)) {
      let eventos: EventoLedger[] = [];
      try { eventos = lerLedger(dirThread(raiz, r.thread)); } catch { /* sem ledger, a autorização espera */ }
      despachos.set(r.thread, Math.max(...eventos.filter(e => e.tipo === 'phase_dispatch').map(e => Date.parse(e.ts)), -Infinity));
    }
    if (Date.parse(r.em) > despachos.get(r.thread)!) pendentes.set(r.trabalho, { fase: r.fase, tentativa: r.tentativa, motivo: r.motivo });
    else pendentes.delete(r.trabalho);
  }
  return pendentes;
}

/** As decisões da supervisão que a fila respeita. */
function decisoesDaSupervisao(raiz: string, sup: EstadoDaSupervisao): DecisoesDaSupervisao {
  return { isolados: new Map([...sup.isolados].map(([t, i]) => [t, `${i.motivo}: ${i.detalhe}`] as const)), retomadas: retomadasPendentes(raiz, sup) };
}

const v2 = (estado: EstadoDoArco | null): ConteudoV2 | null =>
  estado?.conteudo && envelopeComTrabalhos(estado.conteudo) ? estado.conteudo as ConteudoV2 : null;

/**
 * Um passo do arco com a supervisão (D5, D6, D13 a D15): para o arco parado, sai da geração vencida, espera o vigia
 * ausente (só o condutor exige: o vigia que dá o passo está presente), e chama o passo da N2 com as contas e os alvos do
 * arco e as decisões da supervisão. A recusa de ambiente fica no log e, repetida, para o arco.
 */
export function passoConduzido(carregado: ManifestoCarregado, arco: string, quem: Instancia, opcoes: OpcoesDoVigia = {}): ResultadoConduzido {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? new Date().toISOString();
  const agora = Date.parse(quando);
  const parametros = parametrosDoArco(carregado, arco, quando);
  const sup = lerSupervisao(raiz, arco);
  if (sup.parada) return { acao: 'parado', motivo: sup.parada.motivo, detalhe: sup.parada.detalhe };
  const daGeracao = quem.papel === 'vigia' ? sup.geracao?.quem.papel === 'vigia' : sup.geracao?.quem.instancia === quem.instancia;
  if (!daGeracao) {
    return { acao: 'geracao-vencida', detalhe: `a geração ${sup.geracao?.numero ?? 0} é de ${sup.geracao?.quem.papel ?? 'ninguém'} ` +
      `${sup.geracao?.quem.instancia ?? ''}; esta instância não despacha mais` };
  }
  const cadencia = new Date(agora + parametros.cadenciaMs).toISOString();
  if (quem.papel === 'condutor') {
    const vigia = sup.batidas.vigia;
    if (!vigia || agora - Date.parse(vigia.em) > parametros.vigiaAusenteMs) {
      return { acao: 'aguardar', ate: cadencia, motivo: 'vigia-ausente', fila: null,
        detalhe: vigia ? `o último tique do vigia foi em ${formatarDataHora(vigia.em)}, há mais de ${Math.round(parametros.vigiaAusenteMs / 60000)} min: nada novo sai sem supervisão`
          : 'o vigia ainda não deu nenhum tique neste arco: nada novo sai sem supervisão' };
    }
  }
  const estado = lerArco(raiz, arco, quando);
  const conteudo = v2(estado);
  const store = (opcoes.lerStore ?? storePadrao(raiz))();
  const visao = conteudo && estado ? contasDoArco(conteudo, estado, sup, store, quando) : null;
  if (visao?.parada) {
    gravarNaSupervisao(carregado, arco, [{ tipo: 'parada', motivo: visao.parada.motivo, detalhe: visao.parada.detalhe }], quando);
    return { acao: 'parado', motivo: visao.parada.motivo, detalhe: visao.parada.detalhe };
  }
  const r = passoDoArco(carregado, arco, { ...opcoes.passo, quando, maquina: opcoes.maquina ?? opcoes.passo?.maquina,
    ...(visao ? { perfis: () => visao.perfis } : {}),
    ...(conteudo && estado ? { alvos: (fase, runtime, modo) => alvosDaFase(carregado, conteudo, estado, fase, runtime, modo) } : {}),
    supervisao: decisoesDaSupervisao(raiz, sup) } as OpcoesDoPasso);
  if (r.acao === 'recusado' && recusaDeAmbiente(r.detalhe)) {
    const depois = gravarNaSupervisao(carregado, arco, [{ tipo: 'recusa_de_ambiente', trabalho: r.trabalho, thread: r.thread,
      detalhe: r.detalhe.slice(0, 300) }], quando);
    const parada = paradaPorAmbiente(depois, lerArco(raiz, arco, quando)!);
    if (parada) gravarNaSupervisao(carregado, arco, [{ tipo: 'parada', motivo: parada.motivo, detalhe: parada.detalhe }], quando);
  }
  return r;
}

/** Grava `sessao_morta` no ledger da thread, uma vez por sessão: é o que solta a condução e a vaga (D10). */
function registrarMorte(raiz: string, thread: string, m: { sessionId: string; fase: string | null; runtime: string; perfil: string | null }, prova: string): void {
  const dir = dirThread(raiz, thread);
  let eventos: EventoLedger[] = [];
  try { eventos = lerLedger(dir); } catch { return; }
  if (eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === m.sessionId)) return;
  // A fase da sessão é a do despacho dela (ou da falha que disse o id).
  const daSessao = [...eventos].reverse().find(e => (e.tipo === 'phase_dispatch' || e.tipo === 'phase_dispatch_failed') && e.sessionId === m.sessionId);
  const fase = m.fase ?? (typeof daSessao?.fase === 'string' ? daSessao.fase : null);
  registrar(dir, thread, 'sessao_morta', { fase, sessionId: m.sessionId, runtime: m.runtime, ...(m.perfil ? { perfilId: m.perfil } : {}),
    origem: 'noctum.vigia', evidencia: prova.slice(0, 300),
    razao: 'o vigia do arco provou o fim da sessão pelo runtime: solta a condução e a vaga para a retomada pelo passo do arco' });
}

/**
 * Um tique do vigia (D3 a D6). Com a trava do vigia: registra o tique anterior que ficou aberto, reconcilia as reservas
 * pendentes (com a trava de despacho livre), as contas, as sessões, os pedidos do limite de uso e os efeitos incertos,
 * aplica as paradas e, com a trava do condutor livre, assume a condução e dá um passo. Lança só o erro que não é decisão
 * (disco, log adulterado); o tique que lança fica aberto, e o seguinte o registra como interrompido.
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
    const antes = lerSupervisao(raiz, arco);
    const inicio: EventoDaSupervisao[] = [];
    const interrompido = antes.tiqueAberto && antes.tiqueAberto.quem.instancia !== quem.instancia ? antes.tiqueAberto.quem.instancia : null;
    if (interrompido) {
      inicio.push({ tipo: 'vigia_interrompido', interrompido,
        prova: `a trava do vigia estava livre: a instância ${interrompido} (pid ${antes.tiqueAberto!.quem.pid}) não a segura mais` });
    }
    inicio.push({ tipo: 'tique_iniciado', quem });
    let sup = gravarNaSupervisao(carregado, arco, inicio, quando);
    opcoes.depoisDeIniciar?.();
    const lacunas: string[] = [];
    const contagem = { reservas: 0, retomadas: 0, isolados: 0, contas: 0 };
    if (sup.interrupcoesSeguidas >= parametros.interrupcoesQueParam && !sup.parada) {
      sup = gravarNaSupervisao(carregado, arco, [{ tipo: 'parada', motivo: 'supervisor-falhou',
        detalhe: `${sup.interrupcoesSeguidas} tiques do vigia interrompidos em série (o limite é ${parametros.interrupcoesQueParam})` }], quando);
    }
    const estado = lerArco(raiz, arco, quando)!;
    const conteudo = v2(estado);
    if (conteudo) {
      const leitura = (opcoes.consultarRuntime ?? runtimePadrao(raiz, carregado.manifesto.concurrency.stale_after_min))();
      lacunas.push(...leitura.fontes.filter(f => !f.ok).map(f => `${f.origem}: ${f.detalhe}`));
      contagem.reservas = reconciliarReservasDoArco(carregado, arco, conteudo, estado, leitura, parametros, quando, lacunas, contagem);
      sup = aplicarContas(carregado, arco, conteudo, quando, contagem);
      aplicarSessoes(carregado, arco, conteudo, leitura, quando, opcoes, lacunas, contagem);
      aplicarPedidos(carregado, arco, conteudo, quando, contagem);
      for (const id of efeitosAbertos(lerSupervisao(raiz, arco))) {
        const r = reconciliarEfeito(carregado, arco, id, { lerRemoto: opcoes.lerRemoto, quando });
        if (r.isolado) contagem.isolados += 1;
        if (r.desfecho === 'sem-leitura') lacunas.push(`efeito ${id}: ${r.prova}`);
      }
      const ambiente = paradaPorAmbiente(lerSupervisao(raiz, arco), lerArco(raiz, arco, quando)!);
      if (ambiente && !lerSupervisao(raiz, arco).parada) gravarNaSupervisao(carregado, arco, [{ tipo: 'parada', ...ambiente }], quando);
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
          if (sup.geracao?.quem.papel !== 'vigia') {
            gravarNaSupervisao(carregado, arco, [{ tipo: 'conducao_assumida', geracao: (sup.geracao?.numero ?? 0) + 1, quem,
              prova: sup.geracao ? `a trava do condutor estava livre: a geração ${sup.geracao.numero} (${sup.geracao.quem.papel} ` +
                `${sup.geracao.quem.instancia}, pid ${sup.geracao.quem.pid}) não a segura mais` : 'a trava do condutor estava livre: primeira condução do arco' }], quando);
          }
          condutor = 'assumido';
          passo = passoConduzido(carregado, arco, quem, { ...opcoes, quando });
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

/** D7: as reservas pendentes, só com a trava de despacho livre (nenhum passo no meio); a trava fica com o vigia até o fim. */
function reconciliarReservasDoArco(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, estado: EstadoDoArco, leitura: LeituraDeSessoes,
  parametros: ParametrosDaSupervisao, quando: string, lacunas: string[], contagem: { isolados: number }): number {
  const { raiz } = carregado;
  if (!estado.despachos.some(d => d.desfecho === 'pendente')) return 0;
  const noctum = path.join(raizDoEstado(raiz), '.orkastery', 'noctum');
  const fd = tentarTravaExclusiva(path.join(noctum, 'despacho.lock'));
  if (fd === null) { lacunas.push('um passo segura a trava de despacho: as reservas pendentes ficam para o próximo tique'); return 0; }
  let feitas = 0;
  try {
    for (const d of decidirReservas(raiz, arco, conteudo, estado, leitura, parametros, quando)) {
      if (d.acao === 'concluir') {
        concluirDespacho(raiz, arco, d.seq, { thread: d.thread ?? '', sessionId: d.sessionId, idempotente: d.idempotente }, quando);
        if (d.morta && d.thread) registrarMorte(raiz, d.thread, d.morta, d.prova);
        feitas += 1;
      } else if (d.acao === 'devolver') {
        concluirDespacho(raiz, arco, d.seq, { motivo: d.motivo! }, quando);
        feitas += 1;
      } else if (d.acao === 'aguardar') lacunas.push(`reserva ${d.seq} do trabalho ${d.trabalho}: ${d.prova}`);
      if (d.isolamento) {
        gravarNaSupervisao(carregado, arco, [{ tipo: 'isolado', trabalho: d.trabalho, thread: d.thread, motivo: d.isolamento.motivo,
          detalhe: d.isolamento.detalhe }], quando);
        contagem.isolados += 1;
      }
    }
  } finally { fs.closeSync(fd); }
  return feitas;
}

/** D13 e D15: as contas que os despachos do arco provaram fora, e a parada por custo. */
function aplicarContas(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, quando: string, contagem: { contas: number }): EstadoDaSupervisao {
  const { raiz } = carregado;
  const o = observarContas(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, lerSupervisao(raiz, arco));
  const linhas: EventoDaSupervisao[] = [...o.eventos];
  if (o.parada && !lerSupervisao(raiz, arco).parada) linhas.push({ tipo: 'parada', motivo: o.parada.motivo, detalhe: o.parada.detalhe });
  contagem.contas += o.eventos.length;
  return linhas.length ? gravarNaSupervisao(carregado, arco, linhas, quando) : lerSupervisao(raiz, arco);
}

/**
 * D10 a D12 e D16: aplica as decisões das sessões. A sessão viva é parada pelo controle do runtime e conferida na listagem
 * seguinte; sem confirmação, a parada fica no log como não confirmada e nada é autorizado (no teto das tentativas, o
 * trabalho é isolado). Confirmada, ou já morta, a sessão vira `sessao_morta` no ledger da thread e a retomada é autorizada.
 */
function aplicarSessoes(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, leitura: LeituraDeSessoes, quando: string,
  opcoes: OpcoesDoVigia, lacunas: string[], contagem: { retomadas: number; isolados: number }): void {
  const { raiz } = carregado;
  const sup = lerSupervisao(raiz, arco);
  const parametros = sup.parametros!;
  const parar = opcoes.pararSessao ?? pararPadrao(raiz);
  const consultar = opcoes.consultarRuntime ?? runtimePadrao(raiz, carregado.manifesto.concurrency.stale_after_min);
  /** Para a sessão e confere: a prova, ou `null` quando o runtime não confirmou. */
  const pararEConferir = (p: ParadaDeSessao, motivo: MotivoDaRetomada, trabalho: string): string | null => {
    const pedido = parar(p);
    const depois = provaDaSessao(consultar(), p.sessionId, p.perfil, p.runtime);
    const confirmada = pedido.ok && depois.estado === 'morta';
    const prova = `${pedido.detalhe}; depois: ${depois.detalhe}`;
    gravarNaSupervisao(carregado, arco, [{ tipo: 'sessao_parada', trabalho, thread: p.thread, sessionId: p.sessionId, motivo, confirmada, prova }], quando);
    if (confirmada) registrarMorte(raiz, p.thread, { sessionId: p.sessionId, fase: null, runtime: p.runtime, perfil: p.perfil }, prova);
    return confirmada ? prova : null;
  };
  for (const d of decidirSessoes(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, sup, leitura, quando)) {
    if (d.acao === 'aguardar') { lacunas.push(`${d.thread}: ${d.detalhe}`); continue; }
    if (d.acao === 'isolar') {
      if (d.parar) pararEConferir(d.parar, d.motivo === 'sem-primeiro-turno' ? 'sem-primeiro-turno' : 'sem-avanco', d.trabalho);
      gravarNaSupervisao(carregado, arco, [{ tipo: 'isolado', trabalho: d.trabalho, thread: d.thread, motivo: d.motivo, detalhe: d.detalhe.slice(0, 300) }], quando);
      contagem.isolados += 1;
      continue;
    }
    let prova: string | null = null;
    if (d.parar) {
      prova = pararEConferir(d.parar, d.motivo, d.trabalho);
      if (!prova) {
        const falhas = lerSupervisao(raiz, arco).sessoesParadas.filter(x => x.sessionId === d.parar!.sessionId && !x.confirmada).length;
        if (falhas >= parametros.tetoDeRetomadas) {
          gravarNaSupervisao(carregado, arco, [{ tipo: 'isolado', trabalho: d.trabalho, thread: d.thread, motivo: 'sessao-presa',
            detalhe: `a sessão ${d.parar.sessionId} não parou pelo controle do runtime em ${falhas} tentativa(s): o dono a encerra` }], quando);
          contagem.isolados += 1;
        } else lacunas.push(`${d.thread}: a parada da sessão ${d.parar.sessionId} não foi confirmada pelo runtime`);
        continue;
      }
    }
    if (d.morta) registrarMorte(raiz, d.thread, { ...d.morta, fase: null }, d.prova);
    gravarNaSupervisao(carregado, arco, [{ tipo: 'retomada_autorizada', trabalho: d.trabalho, thread: d.thread, fase: d.fase, tentativa: d.tentativa,
      motivo: d.motivo, sessao: d.sessao, prova: (prova ? `${d.prova}; parada confirmada: ${prova}` : d.prova).slice(0, 400) }], quando);
    contagem.retomadas += 1;
  }
}

/** D17: os pedidos do limite de uso do arco: a retomada da fase pelo passo do arco, ou o pedido fora da fila com o motivo. */
function aplicarPedidos(carregado: ManifestoCarregado, arco: string, conteudo: ConteudoV2, quando: string,
  contagem: { retomadas: number; isolados: number }): void {
  const { raiz } = carregado;
  const sup = lerSupervisao(raiz, arco);
  for (const d of decidirPedidos(raiz, arco, conteudo, lerArco(raiz, arco, quando)!, sup)) {
    if (d.acao === 'cancelar') {
      cancelarPedido(carregado, d.pedido, d.motivo);
      gravarNaSupervisao(carregado, arco, [{ tipo: 'pedido_tratado', pedido: d.pedido, thread: d.thread, acao: 'cancelado', motivo: d.motivo.slice(0, 200) }], quando);
      continue;
    }
    if (retomadasDe(sup, d.trabalho, d.fase) >= sup.parametros!.tetoDeRetomadas) {
      gravarNaSupervisao(carregado, arco, [{ tipo: 'isolado', trabalho: d.trabalho, thread: d.thread, motivo: 'retomadas-esgotadas',
        detalhe: `o pedido ${d.pedido} do limite de uso chegou ao teto de retomadas da fase ${d.fase}` }], quando);
      contagem.isolados += 1;
      continue;
    }
    gravarNaSupervisao(carregado, arco, [
      { tipo: 'retomada_autorizada', trabalho: d.trabalho, thread: d.thread, fase: d.fase, tentativa: d.tentativa, motivo: 'limite-de-uso',
        sessao: null, prova: d.prova },
      { tipo: 'pedido_tratado', pedido: d.pedido, thread: d.thread, acao: 'retomada-autorizada', motivo: d.prova.slice(0, 200) },
    ], quando);
    contagem.retomadas += 1;
  }
}

export type ResultadoDoCondutor =
  | { acao: 'sem-kernel' | 'outro-condutor' | 'sem-arco'; detalhe: string }
  | { acao: 'saiu'; instancia: string; geracao: number; passos: number; ultimo: ResultadoConduzido | null };

/**
 * O condutor do arco (D4 e D6): segura a trava do condutor pela vida inteira, grava a geração nova com a prova, bate a
 * cada passo e chama o passo supervisionado na cadência que a fila pede (nunca além da cadência). Sai quando o arco
 * encerra ou para, quando perde a geração, ou no fim dos passos que lhe deram (os testes). `dormir` é dependência.
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
    const anterior = lerSupervisao(raiz, arco).geracao;
    const geracao = (anterior?.numero ?? 0) + 1;
    gravarNaSupervisao(carregado, arco, [{ tipo: 'conducao_assumida', geracao, quem,
      prova: anterior ? `a trava do condutor estava livre: a geração ${anterior.numero} (${anterior.quem.papel} ${anterior.quem.instancia}) não a segura mais`
        : 'a trava do condutor estava livre: primeira condução do arco' }], relogio());
    let ultimo: ResultadoConduzido | null = null, passos = 0;
    for (; passos < (opcoes.maxPassos ?? Number.POSITIVE_INFINITY); passos++) {
      const quando = relogio();
      gravarNaSupervisao(carregado, arco, [{ tipo: 'batida', quem, geracao }], quando);
      ultimo = passoConduzido(carregado, arco, quem, { ...opcoes, quando });
      if (ultimo.acao === 'encerrar' || ultimo.acao === 'parado' || ultimo.acao === 'geracao-vencida') { passos += 1; break; }
      const ate = ultimo.acao === 'aguardar' ? Date.parse(ultimo.ate) : Date.parse(quando);
      dormir(Math.max(0, Math.min(ate - Date.parse(quando), parametros.cadenciaMs)));
    }
    return { acao: 'saiu', instancia: quem.instancia, geracao, passos, ultimo };
  } finally { fs.closeSync(fd); }
}
