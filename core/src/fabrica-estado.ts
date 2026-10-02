/**
 * I-51 (RM-047, fatia 2): a fabrica vista de qualquer maquina.
 *
 * Cada maquina publica o retrato das proprias threads em `maquinas/<maquina>.json` (contrato
 * `ork.fabrica-maquina/v1`) na branch `ork/fabrica-estado`, com um `FABRICA.md` legivel no
 * GitHub. `ork board`, `ork fabrica` e o resumo do pulse leem as outras maquinas dali. Cada
 * maquina so escreve o proprio arquivo: push recusado se resolve relendo a ponta.
 *
 * Publicar e empurrar para o remoto do projeto, entao so acontece sozinho com
 * `fabrica.compartilhada: true` no manifesto; `ork fabrica publicar` e o caminho explicito. Nada de
 * credencial, prompt, log ou caminho local sai daqui: so identificadores, fase, status e o assunto
 * da pausa que espera o dono.
 *
 * O retrato conta a verdade do git, nao so a do `thread.json`: thread cujo `ship(<thread>)` ja esta
 * na base e entregue, mesmo que ninguem tenha fechado o MASTER dela.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buscarBranch, git, gravarNaBranch, jsonsDaPonta, pontaLocal } from './branch-de-estado';
import { adquirirLockMonitor } from './monitor-lock';
import { threadsDeTodosOsPerfis } from './board';
import { raizDoEstado } from './estado-thread';
import { ResumoDeMaquina } from './hitl-resumo';
import { formatarDataHora, legendaDoFuso } from './horario';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { montarMonitor } from './orquestracao';
import { esperaDoCondutor } from './parado-no-condutor';
import { quemSouEu, reservasLocais } from './roadmap-reservas';
import { dirThread } from './thread';
import { Thread } from './types';
import { agora as agoraIso } from './util';
import { VERSAO_DO_ORK } from './versao';

export const CONTRATO_MAQUINA = 'ork.fabrica-maquina/v1' as const;
export const BRANCH_DA_FABRICA = 'ork/fabrica-estado';
/** O diretorio dos retratos na branch; a leitura sem clone (RM-054) le o mesmo. */
export const DIR_DA_FABRICA = 'maquinas';
const DIR = DIR_DA_FABRICA;
const PAINEL = 'FABRICA.md';
const PREFIXO = 'fabrica';
const TENTATIVAS = 5;
/** Retrato igual ao ultimo publicado so volta ao remoto depois disto: e o sinal de vida da maquina. */
export const PULSACAO_MS = 60 * 60 * 1000;
/**
 * Maquina sem retrato novo ha mais disto esta sem batida: o mesmo limiar da rede (RM-053, `SEM_BATIDA_MS`).
 * RM-037 (fatia 4): mora aqui, junto da pulsacao, porque o status do roadmap tambem o le; o panorama da
 * rede o reexporta.
 */
export const LIMIAR_SEM_BATIDA_MS = 3 * 60 * 60 * 1000;
const ARQUIVO_DA_MARCA = 'fabrica-publicada.json';
const ARQUIVO_DO_LOG = 'fabrica.log';

export interface ThreadNaFabrica {
  id: string;
  nome: string;
  /** A #TAG do modo. */
  modo: string;
  fase: string;
  status: Thread['status'];
  roadmap: string | null;
  branch: string | null;
  atualizadaEm: string | null;
  /** O merge `ship(<thread>)` na base, quando a entrega ja esta la. */
  entregue: string | null;
  /** Ha pausa humana valendo agora (o monitor sem runtime avisa a mais, nunca a menos). */
  esperaVoce: boolean;
  /** O assunto da pausa, curto. */
  pergunta: string | null;
  paradaDesde: string | null;
  /**
   * RM-037 (rm037noite, defeito 4): o runtime, o modelo e o esforco do ultimo despacho da thread, o
   * trio efetivo que o `phase_dispatch` grava. Opcionais no contrato: retrato de antes nao os tem, e
   * `null` diz que a thread ainda nao despachou fase nenhuma.
   */
  runtime?: string | null;
  modelo?: string | null;
  esforco?: string | null;
}

/** O trio do ultimo `phase_dispatch` do ledger da thread; tudo `null` quando nao ha despacho legivel. */
export function despachoDaThread(dir: string): { runtime: string | null; modelo: string | null; esforco: string | null } {
  let ultimo: Record<string, unknown> | undefined;
  try { ultimo = [...lerLedger(dir)].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada); } catch { ultimo = undefined; }
  const campo = (v: unknown) => (typeof v === 'string' && v.trim() ? curto(v, 40) : null);
  return { runtime: campo(ultimo?.runtime), modelo: campo(ultimo?.model), esforco: campo(ultimo?.effort) };
}

/** `claude-bg opus/xhigh`: o runtime com o modelo e o esforco, para as colunas do texto. */
export function runtimeDaThread(t: Pick<ThreadNaFabrica, 'runtime' | 'modelo' | 'esforco'>): string {
  if (!t.runtime && !t.modelo) return '-';
  return [t.runtime ?? '?', [t.modelo, t.esforco].filter(Boolean).join('/')].filter(Boolean).join(' ');
}

export interface EstadoDaMaquina {
  contrato: typeof CONTRATO_MAQUINA;
  maquina: string;
  por: string;
  projeto: string;
  versaoOrk: string;
  publicadoEm: string;
  threads: ThreadNaFabrica[];
}

export interface PainelDaFabrica {
  maquinas: EstadoDaMaquina[];
  /** A leitura veio do remoto agora (true) ou da ultima copia local (false). */
  atualizado: boolean;
  ponta: string | null;
}

export interface ResultadoDaPublicacao {
  /** `ocupado`: outra publicacao desta maquina estava em andamento; a proxima pega o estado novo. */
  acao: 'publicou' | 'sem-mudanca' | 'ocupado';
  maquina: string;
  threads: number;
  commit: string | null;
  tentativas: number;
}

const curto = (texto: unknown, teto = 120): string => {
  const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/** O nome do arquivo da maquina na branch: so o que o git e o GitHub aceitam sem surpresa. */
export function arquivoDaMaquina(maquina: string): string {
  const nome = maquina.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 64);
  if (!nome) throw new Error(`fabrica.maquina: nome de maquina invalido ("${maquina}"); defina ORK_MAQUINA`);
  return `${nome}.json`;
}

/**
 * As entregas que ja estao na base: `ship(<thread>): ...` e o assunto do merge que o fluxo de
 * entrega usa, o mesmo fato que o `ork docs sincronizar` le. Um `git log` so, para todas.
 */
export function entregasNaBase(raiz: string, base: string, remoto = 'origin'): Map<string, string> {
  // A base vem do manifesto: a ref vai sempre qualificada (`refs/...`), e um valor como
  // `--output=<arquivo>` nunca vira opcao do `git log`, em qualquer versao do git (RM-054, CHECK).
  // Na ordem: a copia remota da base, a branch local, e a base escrita como remota (`origin/main`).
  const candidatas = [`refs/remotes/${remoto}/${base}`, `refs/heads/${base}`, `refs/remotes/${base}`];
  const ref = candidatas.find((c) => git(raiz, ['rev-parse', '--verify', '--quiet', c]).ok) ?? candidatas[1];
  // Regex basica do git: o `(` e literal.
  const r = git(raiz, ['log', ref, '--format=%h%x09%s', '--grep=^ship(']);
  const entregas = new Map<string, string>();
  if (!r.ok) return entregas;
  for (const linha of r.stdout.split('\n')) {
    const m = /^([0-9a-f]+)\tship\(([A-Za-z0-9._-]+)\)/.exec(linha);
    // O log vem do mais novo para o mais velho: a primeira entrega de cada thread e a que vale.
    if (m && !entregas.has(m[2])) entregas.set(m[2], m[1]);
  }
  return entregas;
}

/** O retrato desta maquina: as threads nao fechadas do projeto, com a verdade do git por cima. */
export function retratoDaMaquina(carregado: ManifestoCarregado,
  opcoes: { agora?: string; maquina?: string; por?: string; remoto?: string } = {}): EstadoDaMaquina {
  const quando = opcoes.agora ?? agoraIso();
  const raiz = carregado.raiz;
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const itens = threadsDeTodosOsPerfis(carregado, false).filter((i) => i.thread.status !== 'fechada');
  const monitor = montarMonitor(carregado, { semRuntime: true, agora: quando });
  const linhas = new Map(monitor.linhas.map((l) => [l.thread, l]));
  const entregas = entregasNaBase(raiz, carregado.manifesto.worktree.base_branch, remoto);
  const itemDaThread = new Map(reservasLocais(raiz, remoto).filter((r) => r.thread).map((r) => [r.thread as string, r.item]));
  const threads = itens.map(({ thread: t, raiz: raizDoPerfil }): ThreadNaFabrica => {
    const pausa = linhas.get(t.id)?.pausas[0];
    const entregue = entregas.get(t.id) ?? null;
    // RM-037 (fatia 4): o fim de turno sem pergunta e do condutor; as outras maquinas nao o leem como espera do dono.
    let doCondutor = false;
    try { doCondutor = esperaDoCondutor(t, lerLedger(dirThread(raizDoPerfil, t.id)), quando) !== null; } catch { doCondutor = false; }
    const esperaVoce = !entregue && !doCondutor && linhas.get(t.id)?.precisaDeHumano === true;
    return {
      id: t.id, nome: curto(t.nome, 100), modo: tagDoModo(t.modo), fase: t.faseAtual, status: t.status,
      roadmap: t.roadmap ?? itemDaThread.get(t.id) ?? null, branch: t.base?.branch ?? null,
      atualizadaEm: t.atualizadaEm ?? null, entregue,
      esperaVoce, pergunta: esperaVoce && pausa ? curto(pausa.pausaSobre || pausa.detalhe) : null,
      paradaDesde: esperaVoce && pausa ? pausa.desdeEm : null,
      ...despachoDaThread(dirThread(raizDoPerfil, t.id)),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const eu = quemSouEu(raiz, { por: opcoes.por, maquina: opcoes.maquina });
  return { contrato: CONTRATO_MAQUINA, maquina: eu.maquina, por: eu.por, projeto: carregado.manifesto.project.name,
    versaoOrk: VERSAO_DO_ORK, publicadoEm: quando, threads };
}

/** O que muda o retrato (sem o carimbo de hora): retrato igual nao precisa de push. */
export function assinaturaDoRetrato(e: EstadoDaMaquina): string {
  const { publicadoEm: _publicadoEm, ...resto } = e;
  return createHash('sha256').update(JSON.stringify(resto)).digest('hex');
}

/** O retrato so vale inteiro: e o filtro da leitura pelo clone e pela forja (RM-054). */
export function estadoValido(bruto: unknown): bruto is EstadoDaMaquina {
  const e = bruto as EstadoDaMaquina;
  return !!e && e.contrato === CONTRATO_MAQUINA && typeof e.maquina === 'string' && !!e.maquina.trim() &&
    typeof e.publicadoEm === 'string' && Array.isArray(e.threads) &&
    e.threads.every((t) => !!t && typeof t.id === 'string' && typeof t.fase === 'string');
}

function maquinasDaPonta(raiz: string, ponta: string | null): EstadoDaMaquina[] {
  return jsonsDaPonta(raiz, ponta, DIR, PREFIXO).filter(estadoValido).sort((a, b) => a.maquina.localeCompare(b.maquina));
}

/** `ork fabrica` e `ork board`: todas as maquinas, lidas do remoto (ou da ultima copia, sem rede). */
export function lerFabrica(raiz: string, opcoes: { remoto?: string; semRemoto?: boolean; timeoutMs?: number } = {}): PainelDaFabrica {
  const remoto = opcoes.remoto ?? 'origin';
  if (opcoes.semRemoto) {
    const ponta = pontaLocal(raiz, remoto, BRANCH_DA_FABRICA);
    return { maquinas: maquinasDaPonta(raiz, ponta), atualizado: false, ponta };
  }
  const { ponta, atualizado } = buscarBranch(raiz, remoto, BRANCH_DA_FABRICA, PREFIXO, opcoes.timeoutMs ?? 15000);
  return { maquinas: maquinasDaPonta(raiz, ponta), atualizado, ponta };
}

interface MarcaDePublicacao { assinatura: string; em: string; commit: string; remoto: string; maquina: string }

const dirDoMonitor = (raiz: string) => path.join(raizDoEstado(raiz), '.orkastery', 'monitor');

function lerMarca(raiz: string): MarcaDePublicacao | null {
  try { return JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz), ARQUIVO_DA_MARCA), 'utf8')) as MarcaDePublicacao; }
  catch { return null; }
}

function gravarMarca(raiz: string, marca: MarcaDePublicacao): void {
  const dir = dirDoMonitor(raiz);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ARQUIVO_DA_MARCA), JSON.stringify(marca, null, 2) + '\n', { mode: 0o600 });
}

/**
 * `ork fabrica publicar`: grava o retrato desta maquina na branch. Retrato igual ao ultimo, dentro
 * da pulsacao, nem busca o remoto; `forcar` publica mesmo assim.
 */
export function publicarMaquina(carregado: ManifestoCarregado,
  opcoes: { remoto?: string; forcar?: boolean; agora?: string; maquina?: string; por?: string } = {}): ResultadoDaPublicacao {
  const raiz = carregado.raiz;
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const estado = retratoDaMaquina(carregado, { ...opcoes, remoto });
  const assinatura = assinaturaDoRetrato(estado);
  const marca = lerMarca(raiz);
  if (!opcoes.forcar && marca && marca.assinatura === assinatura && marca.remoto === remoto && marca.maquina === estado.maquina &&
      Date.parse(estado.publicadoEm) - Date.parse(marca.em) < PULSACAO_MS) {
    return { acao: 'sem-mudanca', maquina: estado.maquina, threads: estado.threads.length, commit: marca.commit, tentativas: 0 };
  }
  const arquivo = `${DIR}/${arquivoDaMaquina(estado.maquina)}`;
  // I-57: uma publicacao por vez nesta maquina. Rajada de eventos (lote, fases em paralelo) nao
  // vira N pushes disputando a mesma branch; quem chega depois sai, e a proxima batida publica.
  fs.mkdirSync(dirDoMonitor(raiz), { recursive: true });
  const trava = adquirirLockMonitor(path.join(dirDoMonitor(raiz), 'fabrica.lock'));
  if (!trava.ok) return { acao: 'ocupado', maquina: estado.maquina, threads: estado.threads.length, commit: null, tentativas: 0 };
  try {
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = buscarBranch(raiz, remoto, BRANCH_DA_FABRICA, PREFIXO, 30000);
    if (!atualizado) throw new Error(`fabrica.sem-remoto: nao consegui ler ${BRANCH_DA_FABRICA} em ${remoto}; publicar exige rede`);
    const todas = [...maquinasDaPonta(raiz, ponta).filter((m) => m.maquina !== estado.maquina), estado]
      .sort((a, b) => a.maquina.localeCompare(b.maquina));
    const commit = gravarNaBranch(raiz, remoto, BRANCH_DA_FABRICA, ponta, [
      { caminho: arquivo, conteudo: JSON.stringify(estado, null, 2) + '\n' },
      { caminho: PAINEL, conteudo: painelDaFabricaEmMarkdown(todas) },
    ], `fabrica: ${estado.maquina} publicou ${estado.threads.length} thread(s)`, PREFIXO);
    if (commit) {
      gravarMarca(raiz, { assinatura, em: estado.publicadoEm, commit, remoto, maquina: estado.maquina });
      return { acao: 'publicou', maquina: estado.maquina, threads: estado.threads.length, commit, tentativas: tentativa };
    }
  }
  throw new Error(`fabrica.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
  } finally { trava.liberar(); }
}

/** `ork fabrica sair`: tira o retrato desta maquina da branch. `null` quando nao havia retrato. */
export function removerMaquina(carregado: ManifestoCarregado, opcoes: { remoto?: string; maquina?: string } = {}): string | null {
  const raiz = carregado.raiz;
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const maquina = quemSouEu(raiz, { maquina: opcoes.maquina }).maquina;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = buscarBranch(raiz, remoto, BRANCH_DA_FABRICA, PREFIXO, 30000);
    if (!atualizado) throw new Error(`fabrica.sem-remoto: nao consegui ler ${BRANCH_DA_FABRICA} em ${remoto}; sair exige rede`);
    const todas = maquinasDaPonta(raiz, ponta);
    if (!todas.some((m) => m.maquina === maquina)) return null;
    const restantes = todas.filter((m) => m.maquina !== maquina);
    const commit = gravarNaBranch(raiz, remoto, BRANCH_DA_FABRICA, ponta, [
      { caminho: `${DIR}/${arquivoDaMaquina(maquina)}`, conteudo: null },
      { caminho: PAINEL, conteudo: painelDaFabricaEmMarkdown(restantes) },
    ], `fabrica: ${maquina} saiu`, PREFIXO);
    if (commit) {
      try { fs.rmSync(path.join(dirDoMonitor(raiz), ARQUIVO_DA_MARCA), { force: true }); } catch { /* marca local */ }
      return commit;
    }
  }
  throw new Error(`fabrica.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

/** Uma linha JSON por publicacao em segundo plano: quem publica sozinho precisa deixar rastro. */
export function registrarPublicacao(raiz: string, registro: Record<string, unknown>): void {
  try {
    const dir = dirDoMonitor(raiz);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, ARQUIVO_DO_LOG), JSON.stringify({ ts: agoraIso(), ...registro }) + '\n', { mode: 0o600 });
  } catch { /* o log e informativo */ }
}

const ativas = (e: EstadoDaMaquina) => e.threads.filter((t) => !t.entregue);

/** O que o resumo do pulse mostra das outras maquinas: so ativas, e quem espera o dono. */
export function resumoDasOutrasMaquinas(p: PainelDaFabrica, eu: string): ResumoDeMaquina[] {
  return p.maquinas.filter((m) => m.maquina !== eu).map((m) => ({
    maquina: m.maquina, publicadoEm: m.publicadoEm, ativas: ativas(m).length,
    esperando: ativas(m).filter((t) => t.esperaVoce).map((t) => ({ thread: t.id, fase: t.fase, pergunta: t.pergunta,
      desdeEm: t.paradaDesde })),
  })).filter((m) => m.ativas > 0);
}

function tabela(cabecalho: string[], linhas: string[][]): string[] {
  const largura = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => l[i].length)));
  const linha = (l: string[]) => '  ' + l.map((c, i) => c.padEnd(largura[i])).join('  ').trimEnd();
  return [linha(cabecalho), linha(largura.map((n) => '-'.repeat(n))), ...linhas.map(linha)];
}

function blocoDaMaquina(m: EstadoDaMaquina, eu: string): string[] {
  const vivas = ativas(m), entregues = m.threads.length - vivas.length;
  const cabeca = `${m.maquina}${m.maquina === eu ? ' (esta maquina)' : ''}, ${m.por}, publicado ${formatarDataHora(m.publicadoEm)}: ` +
    `${vivas.length} thread(s) ativa(s)` + (entregues ? `, ${entregues} entregue(s) sem MASTER` : '');
  if (vivas.length === 0) return [cabeca];
  return [cabeca, ...tabela(['THREAD', 'MODO', 'FASE', 'RUNTIME', 'ITEM', 'ESPERA VOCE'], vivas.map((t) => [
    t.id, t.modo, t.fase, runtimeDaThread(t), t.roadmap ?? '-', t.esperaVoce ? `sim: ${curto(t.pergunta ?? 'veredito', 40)}` : '-',
  ]))];
}

/** `ork fabrica`: todas as maquinas. */
export function textoDaFabrica(p: PainelDaFabrica, eu: string): string {
  const linhas: string[] = [];
  if (!p.atualizado) linhas.push('AVISO: sem leitura nova do remoto; esta e a ultima copia lida nesta maquina.', '');
  if (p.maquinas.length === 0) {
    linhas.push(`Nenhuma maquina publicou ainda em ${BRANCH_DA_FABRICA}. Publique esta com: ork fabrica publicar`);
    return linhas.join('\n');
  }
  for (const m of p.maquinas) linhas.push(...blocoDaMaquina(m, eu), '');
  linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

/** A secao de `ork board` com as outras maquinas. */
export function textoDasOutrasMaquinas(p: PainelDaFabrica, eu: string): string {
  const outras = p.maquinas.filter((m) => m.maquina !== eu);
  const origem = p.atualizado ? 'lido agora' : 'ultima copia local';
  if (outras.length === 0) return `Outras maquinas (${BRANCH_DA_FABRICA}, ${origem}): nenhuma publicou ainda.`;
  const linhas = [`Outras maquinas (${BRANCH_DA_FABRICA}, ${origem}):`];
  for (const m of outras) linhas.push(...blocoDaMaquina(m, eu).map((l, i) => (i === 0 ? `  ${l}` : l)));
  return linhas.join('\n');
}

/** O `FABRICA.md` da branch: o mesmo retrato, para quem abre o GitHub. */
export function painelDaFabricaEmMarkdown(maquinas: readonly EstadoDaMaquina[]): string {
  const linhas = [
    '# Fábrica',
    '',
    'O que cada máquina está conduzindo agora. Gerado pelo `ork fabrica publicar`; não edite à mão.',
    'Antes de pegar um item do roadmap: `ork roadmap reservas`.',
    '',
    '| Máquina | Thread | Modo | Fase | Runtime | Item | Espera você | Publicado |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const vivas = maquinas.flatMap((m) => ativas(m).map((t) => ({ m, t })));
  if (vivas.length === 0) linhas.push('| — | nenhuma thread ativa | — | — |  | — | — | — |');
  for (const { m, t } of vivas) {
    const pergunta = t.esperaVoce ? `sim: ${curto(t.pergunta ?? 'veredito', 60).replace(/\|/g, '/')}` : '—';
    // RM-037 (sugestao 6 do CHECK 1): a celula sem despacho diz isso, sem travessao novo.
    const runtime = t.runtime || t.modelo ? runtimeDaThread(t).replace(/\|/g, '/') : 'sem despacho';
    linhas.push(`| ${m.maquina} | ${t.id} | ${t.modo} | ${t.fase} | ${runtime} | ${t.roadmap ?? '—'} | ${pergunta} | ${formatarDataHora(m.publicadoEm)} |`);
  }
  return [...linhas, '', legendaDoFuso(), ''].join('\n');
}
