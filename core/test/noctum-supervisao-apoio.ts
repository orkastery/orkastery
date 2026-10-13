/**
 * RM-058 (N4): o apoio comum dos testes da supervisão, da reconciliação e do vigia. Contas, sessões, provas, pedidos e
 * remotos são SIMULADOS; o arco é o da N2, autorizado pelo ingresso simulado do Telegram (`noctum-apoio.ts`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { chaveLocal } from '../src/hitl-local-receipt';
import { LeituraDeSessoes } from '../src/noctum-capacidade';
import { CONTRATO_SUPERVISAO, dirDaSupervisao, Instancia, ParametrosDaSupervisao, parametrosPadrao } from '../src/noctum-supervisao';
import { ManifestoCarregado } from '../src/manifest';
import { CONTRATO_PERFIS, EstadoDePerfil, PerfilDeDespacho, StoreDePerfis } from '../src/runtime-profiles';
import { SessaoDaConta } from '../src/sessoes-contas';
import { registrarConducaoDaSessao } from '../src/conducao';
import { registrar } from '../src/ledger';
import { OpcoesDoPasso } from '../src/noctum-execucao';
import { OpcoesDoVigia } from '../src/noctum-vigia';
import { OpcoesRun, ResultadoRun } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';

export const MAQUINA = 'maquina-simulada';

/** Uma instância SIMULADA de condutor ou vigia deste processo de teste. */
export function instancia(papel: Instancia['papel'], n = 1): Instancia {
  return { papel, instancia: `${papel}-${n}-SIMULADO`, pid: process.pid, maquina: MAQUINA };
}

const arquivo = (raiz: string, arco: string) => path.join(dirDaSupervisao(raiz, arco), 'supervisao.jsonl');

/** As linhas cruas do log da supervisão, para os testes de adulteração. */
export function linhasDoLog(raiz: string, arco: string): string[] {
  return fs.readFileSync(arquivo(raiz, arco), 'utf8').split('\n').filter(Boolean);
}

/** Regrava o log com as linhas dadas, privado como o núcleo grava. */
export function regravarLog(raiz: string, arco: string, linhas: string[], cauda = ''): void {
  fs.writeFileSync(arquivo(raiz, arco), linhas.map(l => `${l}\n`).join('') + cauda, { mode: 0o600 });
  fs.chmodSync(arquivo(raiz, arco), 0o600);
}

/** Assina dados como a supervisão assina, ou noutro domínio (o do log do arco), para provar que a subchave é própria. */
export function assinar(raiz: string, dados: unknown, dominio: string = CONTRATO_SUPERVISAO): string {
  const chave = createHmac('sha256', chaveLocal(raiz, false)).update(dominio).digest();
  return JSON.stringify({ dados, mac: createHmac('sha256', chave).update(JSON.stringify(dados)).digest('hex') });
}

const fonte = (ok: boolean, perfil: string | null) => ({ origem: `claude agents --json --all (${perfil ? `perfil ${perfil}` : 'conta do processo'}, SIMULADO)`,
  ok, detalhe: ok ? '' : 'SIMULADO: claude agents falhou' });
const perfilDe = (id: string): PerfilDeDespacho => ({ id, runtime: 'claude-bg', configDir: `/contas/${id}` });

/** A leitura do runtime nas contas dadas (perfis do envelope), com as sessões dadas; todas as fontes respondem. */
export function runtimeCom(sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>, perfis: string[] = ['perfil-a']): LeituraDeSessoes {
  return {
    sessoes: sessoes.map(s => ({ runtime: 'claude-bg', perfil: perfis[0] ?? null, fantasma: false, viva: true, state: 'working', ...s })),
    fontes: perfis.map(p => fonte(true, p)),
    contas: perfis.map(p => ({ runtime: 'claude-bg' as const, perfil: perfilDe(p) })),
  };
}

/**
 * Fixa os parâmetros do arco na primeira linha do log, com os valores dados por cima dos de partida: os prazos curtos dos
 * testes do vigia, sem deslocar o relógio (o ledger das threads grava a hora de agora). Só no log ainda vazio.
 */
export function parametrosDoTeste(carregado: ManifestoCarregado, arco: string, parcial: Partial<ParametrosDaSupervisao>): ParametrosDaSupervisao {
  if (fs.existsSync(arquivo(carregado.raiz, arco))) throw new Error('parametrosDoTeste: o log da supervisão já tem a primeira linha');
  const parametros = { ...parametrosPadrao(carregado.manifesto), ...parcial };
  regravarLog(carregado.raiz, arco, [assinar(carregado.raiz, { contrato: CONTRATO_SUPERVISAO, arco, seq: 1, anterior: '0'.repeat(64),
    em: new Date().toISOString(), evento: { tipo: 'parametros', parametros } })]);
  return parametros;
}

/** O runtime que não respondeu: a leitura tem lacuna e nada é provado. */
export function runtimeSemLeitura(perfis: string[] = ['perfil-a']): LeituraDeSessoes {
  return { sessoes: [], fontes: perfis.map(p => fonte(false, p)), contas: perfis.map(p => ({ runtime: 'claude-bg' as const, perfil: perfilDe(p) })) };
}

/** Espera alguns milissegundos sem ocupar a CPU. */
export function esperar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** O store de perfis SIMULADO, montado na mão (a leitura da supervisão é pura sobre ele). */
export function storeCom(perfis: Array<{ id: string; runtime?: 'claude-bg' | 'codex'; estado?: EstadoDePerfil; esgotadoAte?: string | null }>): StoreDePerfis {
  return { contrato: CONTRATO_PERFIS, perfis: perfis.map(p => ({ id: p.id, runtime: p.runtime ?? 'claude-bg',
    ...(p.runtime === 'codex' ? { codexHome: `/contas/${p.id}` } : { configDir: `/contas/${p.id}` }),
    estado: p.estado ?? 'ativo', esgotadoAte: p.esgotadoAte ?? null, ultimaFalha: null, ultimoUso: null, criadoEm: '2026-01-01T00:00:00.000Z' })) };
}

/**
 * O runtime SIMULADO do arco, num arquivo que o processo do teste e os filhos dividem: cada despacho simulado registra a
 * sessão (com o perfil), e a leitura devolve o último estado de cada uma, nas contas dadas, com todas as fontes lidas.
 */
export function runtimeSimulado(dir: string, perfis: string[] = ['perfil-a', 'perfil-b']) {
  const arquivo = path.join(dir, '.simulado-sessoes.tsv');
  return {
    arquivo,
    registrar: (sessionId: string, perfil: string | null) => fs.appendFileSync(arquivo, `${sessionId}\t${perfil ?? ''}\tworking\n`),
    estado: (sessionId: string, state: string) => fs.appendFileSync(arquivo, `${sessionId}\t\t${state}\n`),
    leitura: (): LeituraDeSessoes => {
      const porSessao = new Map<string, { perfil: string | null; state: string }>();
      const texto = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '';
      for (const linha of texto.split('\n').filter(Boolean)) {
        const [sessionId, perfil, state] = linha.split('\t');
        const atual = porSessao.get(sessionId);
        porSessao.set(sessionId, { perfil: perfil || atual?.perfil || null, state });
      }
      return runtimeCom([...porSessao].map(([sessionId, s]) => ({ sessionId, perfil: s.perfil, state: s.state,
        viva: !['done', 'completed', 'exited', 'stopped', 'failed'].includes(s.state) })), perfis);
    },
  };
}

let sessoesSimuladas = 0;
/**
 * O despacho simulado do arco: o que o `phase run` real deixa quando abre a sessão (o lease de sessão e o `phase_dispatch`
 * com a correlação e o perfil), e a sessão no runtime simulado. `falha`, quando devolve um resultado, faz o papel do
 * núcleo que recusou ou do runtime que falhou (a cota, o login), sem abrir sessão.
 */
export function despachoSimuladoDoArco(dir: string, registro: string[] = [],
  falha?: (raiz: string, threadId: string, o: OpcoesRun) => ResultadoRun | null): NonNullable<OpcoesDoPasso['despachar']> {
  const runtime = runtimeSimulado(dir);
  return (carregado, threadId, o) => {
    const recusa = falha?.(carregado.raiz, threadId, o);
    if (recusa) { registro.push(`${threadId}:${o.fase}:${o.perfil}:falhou`); return recusa; }
    sessoesSimuladas += 1;
    const sessionId = `00000000-0000-4000-9000-${String(process.pid * 1000 + sessoesSimuladas).padStart(12, '0')}`;
    registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
      { sessionId, runtime: o.runtime ?? 'claude-bg', perfil: o.perfil ?? null });
    registrar(dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: o.runtime ?? 'claude-bg',
      pausaAoFim: false, correlacao: o.correlacao, ...(o.perfil ? { perfil: { id: o.perfil, runtime: o.runtime ?? 'claude-bg' } } : {}) });
    runtime.registrar(sessionId, o.perfil ?? null);
    registro.push(`${threadId}:${o.fase}:${o.perfil}`);
    return { sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
  };
}

/** As dependências SIMULADAS do vigia e do condutor: o runtime e o store simulados, e o despacho do arco simulado. */
export function opcoesSimuladas(dir: string, itens: string[], registro: string[] = [], extra: Partial<OpcoesDoVigia> = {},
  falha?: Parameters<typeof despachoSimuladoDoArco>[2]): OpcoesDoVigia {
  const runtime = runtimeSimulado(dir);
  return {
    maquina: MAQUINA,
    consultarRuntime: runtime.leitura,
    lerStore: () => storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]),
    pararSessao: (s) => { runtime.estado(s.sessionId, 'stopped'); return { ok: true, detalhe: 'claude stop SIMULADO' }; },
    lerRemoto: () => ({ ok: true, sha: null }),
    ...extra,
    passo: { maquina: MAQUINA, consultarSessoes: runtime.leitura, despachar: despachoSimuladoDoArco(dir, registro, falha),
      lerReservas: () => ({ leitura: 'copia-local' as const, reservas: itens.map(item => ({ item, maquina: MAQUINA, thread: null })) }),
      abrirThread: (k, o) => novaThread(k, { ...o, criarWorktree: false }).thread, ...extra.passo },
  };
}
