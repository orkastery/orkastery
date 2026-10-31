/**
 * RM-058 (N3): o apoio comum dos testes entre máquinas. Chaves, contas, máquinas e pedidos são SIMULADOS; as "máquinas"
 * são raízes de estado de teste, e nada toca remoto, reserva ou raiz de verdade.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { buscarBranch, gravarNaBranch } from '../src/branch-de-estado';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { CONTRATO_ENVELOPE_V3 } from '../src/noctum-envelope';
import { BRANCH_DE_COORDENACAO, identidadeDaMaquina } from '../src/noctum-transporte';
import { registrarConducaoDaSessao } from '../src/conducao';
import { registrar } from '../src/ledger';
import { OpcoesDoPasso } from '../src/noctum-execucao';
import { OpcoesDoVigia } from '../src/noctum-vigia';
import { ResultadoRun } from '../src/phase';
import { dirThread } from '../src/thread';
import { gravarNaSupervisao, Instancia } from '../src/noctum-supervisao';
import { exec } from '../src/util';
import { commitar, copiadorDeProjetoDeTeste, dirTemporario, projetoTemporario } from './apoio';
import { abrirComBaseline, autorizarPedido, OpcoesDoArco, pedidoV2, TrabalhoSimulado } from './noctum-apoio';
import { opcoesSimuladas } from './noctum-supervisao-apoio';

/** Uma chave pública Ed25519 SIMULADA e estável, derivada só do nome dado (SPKI DER em base64). */
export function chaveSimulada(semente: string): string {
  const seed = createHash('sha256').update(`chave-SIMULADA-do-teste:${semente}`).digest();
  const privada = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8' });
  return createPublicKey(privada).export({ format: 'der', type: 'spki' }).toString('base64');
}

export interface OpcoesDoArcoV3 extends OpcoesDoArco {
  trabalhos: Array<TrabalhoSimulado & { maquina?: string }>;
  maquinas: Array<{ nome: string; chave: string }>;
  /** As permissões no destino `exemplo/produto`; sem elas, push, PR e merge (o merge só com a vez de integrar). */
  permissoes?: string[];
  /** O limite de cada conta somando as máquinas; sem ele, o mesmo de cada máquina (o mais apertado que o contrato aceita). */
  global?: Array<{ conta: string; sessoes: number }>;
}

/** O pedido de abertura `v3`: o `v2` do apoio da N2 mais as máquinas e o limite global. Os trabalhos vêm como dados. */
export function pedidoV3(arco: string, o: OpcoesDoArcoV3): Record<string, unknown> {
  const v2 = pedidoV2(arco, o);
  const capacidade = v2.capacidade as { porConta: Array<{ conta: string; sessoes: number }> };
  return { ...v2, contrato: CONTRATO_ENVELOPE_V3, maquinas: o.maquinas.map(m => ({ ...m })),
    destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: o.permissoes ?? ['push', 'pr', 'merge'] }],
    capacidadeGlobal: { porConta: o.global ?? capacidade.porConta.map(c => ({ conta: c.conta, sessoes: c.sessoes })) } };
}

// ---------------------------------------------------------------------------
// Duas máquinas: dois clones do mesmo remoto de fixture, cada um com a própria raiz de estado.
// ---------------------------------------------------------------------------

export const MAQUINA_A = 'maquina-a';
export const MAQUINA_B = 'maquina-b';

export interface MaquinaDeTeste { nome: string; dir: string; carregado: ManifestoCarregado }

export interface DuasMaquinas {
  a: MaquinaDeTeste;
  b: MaquinaDeTeste;
  /** O repositório bare que serve de `origin` aos dois clones. */
  remoto: string;
  arco: string;
  /** O hash do envelope que o dono autorizou nas duas raízes. */
  hash: string;
  /** O pedido de abertura, para uma emenda no teste. */
  pedido: Record<string, unknown>;
  limpar: () => void;
}

const projetosDuasMaquinas = copiadorDeProjetoDeTeste(() => projetoTemporario('noctum-maquinas-modelo', true));
export const totalDeModelosDuasMaquinas = (): number => projetosDuasMaquinas.totalDeModelos();

/** O segundo clone ganha identidade de git própria e a pasta de estado que o `ork init` criaria (ela não vai ao git). */
export function cloneDoRemoto(remoto: string, nome: string, usuario: string): string {
  const dir = path.join(dirTemporario(nome), 'clone');
  exec('git', ['clone', '-q', remoto, dir]);
  exec('git', ['config', 'user.email', `${usuario.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@orkastery.local`], dir);
  exec('git', ['config', 'user.name', usuario], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.mkdirSync(path.join(dir, '.orkastery', 'threads'), { recursive: true });
  return dir;
}

/**
 * O projeto com os itens do roadmap no remoto, a máquina A (o clone que criou) e a máquina B (outro clone), e o mesmo
 * envelope `v3` autorizado pelo ingresso simulado nas duas raízes. Nada sai da pasta temporária.
 */
export function duasMaquinas(nome: string, o: Omit<OpcoesDoArcoV3, 'maquinas'> & { arco?: string; semPagina?: string[] }): DuasMaquinas {
  const p = projetosDuasMaquinas.copiar(nome);
  // `semPagina`: itens do envelope sem página no roadmap do remoto (o teste a põe só no clone que deve tê-la).
  const itens = [...new Set(o.trabalhos.map(t => t.item))].filter(i => !(o.semPagina ?? []).includes(i));
  for (const item of itens) commitar(p.dir, `docs/roadmap/${item}-simulado.md`, `# ${item} SIMULADO\n`, `roadmap: ${item}`);
  // O manifesto vai junto: a outra máquina clona um projeto do ork.
  const versionados = ['orkastery.yaml', 'AGENTS.md'].filter(f => fs.existsSync(path.join(p.dir, f)));
  assert.ok(exec('git', ['add', '--', ...versionados], p.dir).ok);
  assert.ok(exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir).ok);
  assert.ok(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok);
  const b = cloneDoRemoto(p.remoto as string, `${nome}-b`, 'Builder B');
  const arco = o.arco ?? 'arco-n3';
  const maquinas = [identidadeDaMaquina(p.dir, MAQUINA_A), identidadeDaMaquina(b, MAQUINA_B)];
  const pedido = pedidoV3(arco, { ...o, maquinas });
  const hash = autorizarPedido(p.dir, arco, pedido);
  assert.equal(autorizarPedido(b, arco, pedido), hash, 'o mesmo envelope nas duas raízes');
  return {
    a: { nome: MAQUINA_A, dir: p.dir, carregado: exigirManifesto(p.dir) },
    b: { nome: MAQUINA_B, dir: b, carregado: exigirManifesto(b) },
    remoto: p.remoto as string, arco, hash, pedido,
    limpar: () => { p.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
}

/** Um condutor simulado com vigia presente, pronto para chamar `passoConduzido` nesta raiz. */
export function condutorDaMaquinaSimulado(m: MaquinaDeTeste, arco: string, trabalhos: Array<{ item: string }>, registro: string[] = [], n = 1):
  { quem: Instancia; opcoes: OpcoesDoVigia } {
  const quem: Instancia = { papel: 'condutor', instancia: `condutor-${n}-SIMULADO`, pid: process.pid, maquina: m.nome };
  const vigia: Instancia = { papel: 'vigia', instancia: `vigia-${n}-SIMULADO`, pid: process.pid, maquina: m.nome };
  gravarNaSupervisao(m.carregado, arco, [{ tipo: 'conducao_assumida', geracao: 1, quem, prova: 'SIMULADO: condutor da máquina' },
    { tipo: 'tique_iniciado', quem: vigia }, { tipo: 'tique_concluido', quem: vigia, resumo: 'SIMULADO: vigia presente' }]);
  const n2 = n2Simulada(registro);
  return { quem, opcoes: opcoesSimuladas(m.dir, trabalhos.map(t => t.item), registro,
    { maquina: m.nome, coordenacao: { remoto: 'origin' }, passo: { ...n2, maquina: m.nome } }) };
}

/** Grava no ramo de coordenação sem passar pelo núcleo: é o que um agente com push faria à mão. */
export function gravarCru(dir: string, mudancas: Array<{ caminho: string; conteudo: string | null }>, mensagem = 'SIMULADO: escrita à mão'): string {
  const { ponta } = buscarBranch(dir, 'origin', BRANCH_DE_COORDENACAO, 'teste');
  const commit = gravarNaBranch(dir, 'origin', BRANCH_DE_COORDENACAO, ponta, mudancas, mensagem, 'teste');
  assert.ok(commit, 'a escrita à mão entrou no ramo');
  return commit;
}

/** O conteúdo de um registro do ramo, lido do remoto agora. */
export function registroCru(dir: string, caminho: string): string {
  buscarBranch(dir, 'origin', BRANCH_DE_COORDENACAO, 'teste');
  return exec('git', ['show', `refs/remotes/origin/${BRANCH_DE_COORDENACAO}:${caminho}`], dir).stdout;
}

// ---------------------------------------------------------------------------
// Branches de trabalho e a integração por avanço, no remoto de fixture.
// ---------------------------------------------------------------------------

/** Uma branch de trabalho em cima da `main` do remoto, com um arquivo, publicada no remoto. Devolve a fonte e a base. */
export function branchDeTrabalho(dir: string, branch: string, arquivo: string, conteudo: string): { branch: string; fonte: string; base: string } {
  assert.ok(exec('git', ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main'], dir).ok);
  assert.ok(exec('git', ['checkout', '-q', '-B', branch, 'refs/remotes/origin/main'], dir).ok);
  fs.mkdirSync(path.dirname(path.join(dir, arquivo)), { recursive: true });
  fs.writeFileSync(path.join(dir, arquivo), conteudo);
  assert.ok(exec('git', ['add', '--', arquivo], dir).ok);
  assert.ok(exec('git', ['commit', '-q', '-m', `trabalho SIMULADO: ${arquivo}`], dir).ok);
  assert.ok(exec('git', ['push', '-q', 'origin', `${branch}:refs/heads/${branch}`], dir).ok);
  const fonte = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  const base = exec('git', ['rev-parse', 'refs/remotes/origin/main'], dir).stdout.trim();
  assert.ok(exec('git', ['checkout', '-q', 'main'], dir).ok);
  return { branch, fonte, base };
}

/** Mais um commit em cima da branch de trabalho, publicado: a fonte muda depois das provas. */
export function maisUmCommit(dir: string, branch: string, arquivo: string, conteudo: string): string {
  assert.ok(exec('git', ['checkout', '-q', branch], dir).ok);
  fs.writeFileSync(path.join(dir, arquivo), conteudo);
  assert.ok(exec('git', ['add', '--', arquivo], dir).ok);
  assert.ok(exec('git', ['commit', '-q', '-m', `mais trabalho SIMULADO: ${arquivo}`], dir).ok);
  assert.ok(exec('git', ['push', '-q', 'origin', `${branch}:refs/heads/${branch}`], dir).ok);
  const fonte = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  assert.ok(exec('git', ['checkout', '-q', 'main'], dir).ok);
  return fonte;
}

/** Atualiza a branch de trabalho com a `main` nova do remoto (merge sem conflito) e publica: o candidato novo. */
export function atualizarBranch(dir: string, branch: string): { branch: string; fonte: string; base: string } {
  assert.ok(exec('git', ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main'], dir).ok);
  assert.ok(exec('git', ['checkout', '-q', branch], dir).ok);
  assert.ok(exec('git', ['merge', '-q', '--no-edit', 'refs/remotes/origin/main'], dir).ok);
  assert.ok(exec('git', ['push', '-q', 'origin', `${branch}:refs/heads/${branch}`], dir).ok);
  const fonte = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  const base = exec('git', ['rev-parse', 'refs/remotes/origin/main'], dir).stdout.trim();
  assert.ok(exec('git', ['checkout', '-q', 'main'], dir).ok);
  return { branch, fonte, base };
}

/** O integrador do teste: avança a base do remoto até a fonte, sem forçar (só passa se a base for ancestral dela). */
export function integradorPorAvanco(dir: string): (c: { remoto: string; destino: { base: string }; candidato: { fonte: string } }) => { merge: string } {
  return ({ remoto, destino, candidato }) => {
    const r = exec('git', ['push', '-q', remoto, `${candidato.fonte}:refs/heads/${destino.base}`], dir);
    if (!r.ok) throw new Error(`push recusado: ${r.stderr.trim().split('\n').pop() ?? ''}`);
    return { merge: candidato.fonte };
  };
}

/** O sha256 SIMULADO das provas de um candidato. */
export const provasSimuladas = (rotulo: string): string => createHash('sha256').update(`provas SIMULADAS ${rotulo}`).digest('hex');

// ---------------------------------------------------------------------------
// O passo da N2 simulado: sessões, perfis, despacho e abertura de thread sem runtime de verdade.
// ---------------------------------------------------------------------------

export const SEM_SESSOES = () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (SIMULADO)', ok: true, detalhe: '' }],
  contas: [{ runtime: 'claude-bg' as const, perfil: null }] });

let despachos = 0;
/** O despacho simulado: a condução de sessão e o `phase_dispatch` que o `phase run` deixaria. O id leva o pid do processo. */
export function despachoSimulado(registro: string[] = []): NonNullable<OpcoesDoPasso['despachar']> {
  return (carregado, threadId, o) => {
    despachos += 1;
    const sessionId = `00000000-0000-4000-8000-${String(process.pid % 1000000).padStart(6, '0')}${String(despachos).padStart(6, '0')}`;
    registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
    registrar(dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: 'claude-bg', pausaAoFim: false });
    registro.push(`${threadId}:${o.fase}:${o.perfil}:${sessionId}`);
    return { sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
  };
}

/** As opções do passo da N2 sem runtime: sem sessões de fora, o perfil `perfil-a`, o despacho simulado e thread sem worktree. */
export function n2Simulada(registro: string[] = []) {
  return {
    consultarSessoes: SEM_SESSOES,
    perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }],
    despachar: despachoSimulado(registro),
    // RM-058, integração (D6): a thread aberta pelo passo já tem a baseline SIMULADA do condutor.
    abrirThread: abrirComBaseline as NonNullable<OpcoesDoPasso['abrirThread']>,
  };
}

/** A sessão simulada da thread acabou: o `phase_result` e a entrega, como a sessão do bloco inteiro deixaria. */
export function entregarThread(raiz: string, threadId: string, sessionId: string): void {
  registrar(dirThread(raiz, threadId), threadId, 'phase_result', { fase: 'GOAL', sessionId, classificacao: 'fase_concluida', ok: true });
  registrar(dirThread(raiz, threadId), threadId, 'ship_done', { origem: 'pr', pr: 1, simulado: true });
}
