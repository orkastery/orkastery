/**
 * I-47: reservas de item do roadmap entre maquinas, como documentacao em codigo.
 *
 * Mais de um computador (ou builder) trabalha no mesmo repositorio. Sem reserva, dois pegam o
 * mesmo item e so descobrem no PR. A reserva e um arquivo por item (`reservas/RM-042.json`,
 * contrato `ork.roadmap-reserva/v1`) numa branch propria, `ork/roadmap-reservas`, ao lado de um
 * `RESERVAS.md` legivel no GitHub. Ela nao passa por PR nem por CI e nao mexe na `main`.
 *
 * A atomicidade vem do proprio git: a nova versao da branch e um commit em cima da ponta lida, e
 * o push nunca e forcado. Se outra maquina gravou antes, o push e recusado, a leitura e refeita e
 * a regra roda de novo sobre o estado novo. O primeiro push vence; o segundo ve a reserva do
 * primeiro e recusa com `roadmap.reservado`, dizendo com quem esta o item.
 *
 * Nada aqui toca a arvore de trabalho nem o indice do repositorio: blobs, arvore e commit sao
 * montados com um indice temporario, e a branch local de reservas nunca e criada. A mecanica e a
 * de `branch-de-estado.ts`, a mesma do estado compartilhado da fabrica (I-51).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buscarBranch, git, gravarNaBranch, jsonsDaPonta, OpcoesDeGit, pontaLocal } from './branch-de-estado';
import { formatarDataHora, legendaDoFuso } from './horario';
import { registrarSeExiste, TIPOS_DE_EVENTO } from './ledger';
import { nomeDaMaquina } from './maquina';
import { dirThread, lerThread, listarIds } from './thread';
import { Thread } from './types';
import { agora as agoraIso } from './util';

export const CONTRATO_RESERVA = 'ork.roadmap-reserva/v1' as const;
export const BRANCH_DE_RESERVAS = 'ork/roadmap-reservas';
export const REMOTO_PADRAO = 'origin';
/** O diretorio das reservas na branch; a leitura sem clone (RM-054) le o mesmo. */
export const DIR_DE_RESERVAS = 'reservas';
const DIR = DIR_DE_RESERVAS;
const PAINEL = 'RESERVAS.md';
const TENTATIVAS = 5;
const ITEM = /^RM-\d{3}$/;

export interface ReservaDeItem {
  contrato: typeof CONTRATO_RESERVA;
  item: string;
  por: string;
  maquina: string;
  thread: string | null;
  nota: string | null;
  desdeEm: string;
  atualizadaEm: string;
  /** Quando a reserva foi tomada de outra maquina com `--forcar`: de quem e por que. */
  tomadaDe?: { por: string; maquina: string; motivo: string };
}

export interface OpcoesDeReserva {
  remoto?: string;
  por?: string;
  maquina?: string;
  thread?: string | null;
  nota?: string | null;
  /** Tomar ou soltar a reserva de outra maquina. Exige `motivo`. */
  forcar?: boolean;
  motivo?: string;
  agora?: string;
  /** Prazo e ambiente do fetch e do push (o fechamento usa `REDE_DO_FECHAMENTO`). */
  rede?: OpcoesDeGit;
  /**
   * RM-037 (achado A5 do CHECK 1): so mexe se a reserva lida agora ainda aponta para esta thread.
   * Entre a leitura e a gravacao alguem pode ter reapontado o item; a mudanca entao nao acontece.
   */
  threadEsperada?: string | null;
}

/**
 * O fechamento nao pode ficar parado na rede (achado A3 do CHECK 1): prazo curto por chamada e git
 * sem pergunta no terminal. O `GIT_SSH_COMMAND` de quem ja o definiu vale; senao, ssh em modo lote.
 */
export const REDE_DO_FECHAMENTO: OpcoesDeGit = {
  timeoutMs: 15000,
  env: { GIT_TERMINAL_PROMPT: '0', ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) },
};

export interface ResultadoDeReserva {
  acao: 'pegou' | 'renovou' | 'tomou' | 'soltou' | 'nada';
  item: string;
  reserva: ReservaDeItem | null;
  commit: string | null;
  tentativas: number;
}

export interface PainelDeReservas {
  reservas: ReservaDeItem[];
  /** RM-037 (rm037noite, defeito 6): os numeros de FEAT ja reservados, do mais velho ao mais novo. */
  feats?: ReservaDeFeat[];
  /** A leitura veio do remoto agora (true) ou da ultima copia local (false, sem rede). */
  atualizado: boolean;
  ponta: string | null;
}

const PREFIXO = 'roadmap';

/** O item precisa existir no roadmap do projeto (`docs/roadmap/RM-NNN-*.md`). */
export function exigirItem(raiz: string, item: string): string {
  const id = item.trim().toUpperCase();
  if (!ITEM.test(id)) throw new Error(`roadmap.item: "${item}" nao e um item do roadmap (esperado RM-NNN)`);
  const dir = path.join(raiz, 'docs', 'roadmap');
  const doItem = (f: string) => path.basename(f).startsWith(`${id}-`) && f.endsWith('.md');
  const naArvore = fs.existsSync(dir) && fs.readdirSync(dir).some(doItem);
  // O checkout pode estar numa branch antiga, sem o item: vale tambem o que a main ja tem.
  const naBase = !naArvore && ['main', 'origin/main'].some((ref) =>
    git(raiz, ['ls-tree', '--name-only', ref, '--', 'docs/roadmap/']).stdout.split('\n').some(doItem));
  if (!naArvore && !naBase) throw new Error(`roadmap.item: ${id} nao existe em docs/roadmap`);
  return id;
}

/** Quem esta pegando: `--por`, senao o `user.name` do git, senao o usuario do sistema. */
export function quemSouEu(raiz: string, opcoes: OpcoesDeReserva = {}): { por: string; maquina: string } {
  const doGit = git(raiz, ['config', 'user.name']).stdout.trim();
  const por = (opcoes.por ?? '').trim() || doGit || os.userInfo().username;
  return { por, maquina: nomeDaMaquina(opcoes.maquina) };
}

/** Traz a ponta da branch de reservas. `null` quando ela ainda nao existe no remoto. */
function buscar(raiz: string, remoto: string, rede: OpcoesDeGit = {}): { ponta: string | null; atualizado: boolean } {
  return buscarBranch(raiz, remoto, BRANCH_DE_RESERVAS, PREFIXO, rede.timeoutMs, rede.env);
}

function lerDaPonta(raiz: string, ponta: string | null): ReservaDeItem[] {
  return (jsonsDaPonta(raiz, ponta, DIR, PREFIXO) as ReservaDeItem[])
    .filter((r) => r.contrato === CONTRATO_RESERVA)
    .sort((a, b) => a.item.localeCompare(b.item));
}

/** RM-054: a reserva lida de fora do `ork` desta maquina (forja, outra copia) so vale inteira. */
export function reservaValida(bruto: unknown): bruto is ReservaDeItem {
  const r = bruto as ReservaDeItem;
  return !!r && typeof r === 'object' && r.contrato === CONTRATO_RESERVA && typeof r.item === 'string' && ITEM.test(r.item) &&
    typeof r.por === 'string' && typeof r.maquina === 'string' && typeof r.desdeEm === 'string';
}

/** As reservas da ultima copia lida nesta maquina, sem rede (I-51: o retrato da fabrica usa). */
export function reservasLocais(raiz: string, remoto: string = REMOTO_PADRAO): ReservaDeItem[] {
  try { return lerDaPonta(raiz, pontaLocal(raiz, remoto, BRANCH_DE_RESERVAS)); } catch { return []; }
}

/** `ork roadmap reservas`: quem esta com cada item, lido do remoto (ou da ultima copia, sem rede). */
export function listarReservas(raiz: string, opcoes: Pick<OpcoesDeReserva, 'remoto' | 'rede'> = {}): PainelDeReservas {
  const { ponta, atualizado } = buscar(raiz, opcoes.remoto ?? REMOTO_PADRAO, opcoes.rede);
  return { reservas: lerDaPonta(raiz, ponta), feats: featsDaPonta(raiz, ponta), atualizado, ponta };
}

// ---------------------------------------------------------------------------
// RM-037 (rm037noite, defeito 6): o numero da FEAT nova tambem e reservado.
// ---------------------------------------------------------------------------

/**
 * A RM-052, a RM-026 e a RM-051 criaram a FEAT-030 cada uma, em maquinas e threads diferentes: o numero
 * saia do `ls docs/produto` de cada branch. Agora ele sai de `ork roadmap feat`, na mesma branch de
 * reservas e pela mesma atomicidade do item (o primeiro push vence; o segundo rele e leva o seguinte).
 * A reserva de numero e para sempre: numero queimado nao volta, e por isso nunca colide.
 */
export const CONTRATO_FEAT = 'ork.feat-reserva/v1' as const;
export const DIR_DE_FEATS = 'feats';
const NUMERO_DE_FEAT = /^FEAT-(\d{3})$/;
const ARQUIVO_DE_FEAT = /^FEAT-(\d{3})-/;

export interface ReservaDeFeat {
  contrato: typeof CONTRATO_FEAT;
  feat: string;
  por: string;
  maquina: string;
  thread: string | null;
  nota: string | null;
  em: string;
}

export interface ResultadoDaFeat {
  feat: string;
  reserva: ReservaDeFeat;
  commit: string;
  tentativas: number;
}

function featsDaPonta(raiz: string, ponta: string | null): ReservaDeFeat[] {
  return (jsonsDaPonta(raiz, ponta, DIR_DE_FEATS, PREFIXO) as ReservaDeFeat[])
    .filter((r) => r && r.contrato === CONTRATO_FEAT && typeof r.feat === 'string' && NUMERO_DE_FEAT.test(r.feat))
    .sort((a, b) => a.feat.localeCompare(b.feat));
}

const numeroDaFeat = (feat: string): number => Number(NUMERO_DE_FEAT.exec(feat)?.[1] ?? 0);

/** O maior numero de FEAT que o projeto ja conhece: a arvore de trabalho, a `main` e a `origin/main`. */
export function maiorFeatConhecida(raiz: string): number {
  const nomes: string[] = [];
  const dir = path.join(raiz, 'docs', 'produto');
  if (fs.existsSync(dir)) nomes.push(...fs.readdirSync(dir));
  for (const ref of ['main', 'origin/main']) {
    const r = git(raiz, ['ls-tree', '--name-only', ref, '--', 'docs/produto/']);
    if (r.ok) nomes.push(...r.stdout.split('\n').map((n) => path.posix.basename(n)));
  }
  return nomes.reduce((maior, nome) => Math.max(maior, Number(ARQUIVO_DE_FEAT.exec(nome)?.[1] ?? 0)), 0);
}

/** `ork roadmap feat`: reserva o proximo numero de FEAT para esta maquina, por push atomico. */
export function reservarFeat(raiz: string, opcoes: OpcoesDeReserva = {}): ResultadoDaFeat {
  const remoto = opcoes.remoto ?? REMOTO_PADRAO;
  const eu = quemSouEu(raiz, opcoes);
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = buscar(raiz, remoto);
    if (!atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS} em ${remoto}; reservar exige rede`);
    const feats = featsDaPonta(raiz, ponta);
    const proximo = Math.max(maiorFeatConhecida(raiz), ...feats.map((r) => numeroDaFeat(r.feat))) + 1;
    if (proximo > 999) throw new Error('roadmap.feat: os numeros de FEAT de tres digitos acabaram');
    const feat = `FEAT-${String(proximo).padStart(3, '0')}`;
    const reserva: ReservaDeFeat = { contrato: CONTRATO_FEAT, feat, por: eu.por, maquina: eu.maquina,
      thread: opcoes.thread ?? null, nota: opcoes.nota ?? null, em: opcoes.agora ?? agoraIso() };
    const commit = gravarNaBranch(raiz, remoto, BRANCH_DE_RESERVAS, ponta, [
      { caminho: `${DIR_DE_FEATS}/${feat}.json`, conteudo: JSON.stringify(reserva, null, 2) + '\n' },
      { caminho: PAINEL, conteudo: painelEmMarkdown(lerDaPonta(raiz, ponta), [...feats, reserva]) },
    ], `reserva: ${feat} para ${eu.por} em ${eu.maquina}${reserva.thread ? ` (thread ${reserva.thread})` : ''}`, PREFIXO);
    if (commit) return { feat, reserva, commit, tentativas: tentativa };
  }
  throw new Error(`roadmap.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

/** O `RESERVAS.md` da branch: a mesma lista, para quem abre o GitHub. */
export function painelEmMarkdown(reservas: readonly ReservaDeItem[], feats: readonly ReservaDeFeat[] = []): string {
  const linhas = [
    '# Reservas do roadmap',
    '',
    'Quem está com cada item agora. Gerado pelo `ork roadmap pegar` e pelo `ork roadmap soltar`;',
    'não edite à mão. Antes de começar um item: `ork roadmap reservas`.',
    '',
  ];
  const numeros = feats.length === 0 ? [] : ['', '## Números de FEAT reservados', '',
    'O número da FEAT nova sai de `ork roadmap feat`; número reservado não volta.', '',
    '| FEAT | Com quem | Máquina | Thread | Em |', '| --- | --- | --- | --- | --- |',
    ...feats.map((f) => `| ${f.feat} | ${f.por} | ${f.maquina} | ${f.thread ?? '—'} | ${formatarDataHora(f.em)} |`)];
  if (reservas.length === 0) return [...linhas, 'Nenhum item reservado.', ...numeros, ''].join('\n');
  linhas.push('| Item | Com quem | Máquina | Thread | Desde | Nota |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of reservas) {
    linhas.push(`| ${r.item} | ${r.por} | ${r.maquina} | ${r.thread ?? '—'} | ${formatarDataHora(r.desdeEm)} | ${r.nota ?? '—'} |`);
  }
  return [...linhas, ...numeros, '', legendaDoFuso(), ''].join('\n');
}

/** Grava a reserva (ou a remocao dela) e o painel numa versao nova da branch. Recusa volta `false`. */
function gravar(raiz: string, remoto: string, ponta: string | null, mudanca: { item: string; reserva: ReservaDeItem | null },
  todas: ReservaDeItem[], mensagem: string, rede: OpcoesDeGit = {}): string | false {
  return gravarNaBranch(raiz, remoto, BRANCH_DE_RESERVAS, ponta, [
    { caminho: `${DIR}/${mudanca.item}.json`, conteudo: mudanca.reserva ? JSON.stringify(mudanca.reserva, null, 2) + '\n' : null },
    { caminho: PAINEL, conteudo: painelEmMarkdown(todas, featsDaPonta(raiz, ponta)) },
  ], mensagem, PREFIXO, rede);
}

function ehMinha(r: ReservaDeItem, eu: { por: string; maquina: string }): boolean {
  return r.por === eu.por && r.maquina === eu.maquina;
}

function descrever(r: ReservaDeItem): string {
  return `${r.item} esta com ${r.por} em ${r.maquina} desde ${formatarDataHora(r.desdeEm)}` +
    (r.thread ? ` (thread ${r.thread})` : '');
}

function exigirMotivo(opcoes: OpcoesDeReserva): string {
  const motivo = (opcoes.motivo ?? '').trim();
  if (!motivo) throw new Error('roadmap.forcar: --forcar exige --motivo (tomar a reserva de outra maquina e decisao registrada)');
  return motivo;
}

/**
 * `ork roadmap pegar`: reserva o item para esta maquina. Renovar a propria reserva e idempotente
 * (atualiza thread, nota e carimbo); a de outra maquina so sai com `--forcar --motivo`.
 */
export function pegarItem(raiz: string, item: string, opcoes: OpcoesDeReserva = {}): ResultadoDeReserva {
  const id = exigirItem(raiz, item);
  const remoto = opcoes.remoto ?? REMOTO_PADRAO;
  const eu = quemSouEu(raiz, opcoes);
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = buscar(raiz, remoto, opcoes.rede);
    if (!atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS} em ${remoto}; reservar exige rede`);
    const todas = lerDaPonta(raiz, ponta);
    const atual = todas.find((r) => r.item === id) ?? null;
    if (opcoes.threadEsperada !== undefined && (atual?.thread ?? null) !== opcoes.threadEsperada) {
      return { acao: 'nada', item: id, reserva: atual, commit: null, tentativas: tentativa };
    }
    const quando = opcoes.agora ?? agoraIso();
    let acao: ResultadoDeReserva['acao'] = 'pegou';
    let tomadaDe: ReservaDeItem['tomadaDe'];
    if (atual && ehMinha(atual, eu)) acao = 'renovou';
    else if (atual) {
      if (!opcoes.forcar) throw new Error(`roadmap.reservado: ${descrever(atual)}. Escolha outro item ou combine com quem esta nele`);
      tomadaDe = { por: atual.por, maquina: atual.maquina, motivo: exigirMotivo(opcoes) };
      acao = 'tomou';
    }
    const reserva: ReservaDeItem = {
      contrato: CONTRATO_RESERVA, item: id, por: eu.por, maquina: eu.maquina,
      thread: opcoes.thread !== undefined ? opcoes.thread : (acao === 'renovou' ? atual!.thread : null),
      nota: opcoes.nota !== undefined ? opcoes.nota : (acao === 'renovou' ? atual!.nota : null),
      desdeEm: acao === 'renovou' ? atual!.desdeEm : quando,
      atualizadaEm: quando,
      ...(tomadaDe ? { tomadaDe } : {}),
    };
    const novas = [...todas.filter((r) => r.item !== id), reserva].sort((a, b) => a.item.localeCompare(b.item));
    const mensagem = acao === 'tomou'
      ? `reserva: ${id} tomada por ${eu.por} em ${eu.maquina} (de ${tomadaDe!.por} em ${tomadaDe!.maquina}): ${tomadaDe!.motivo}`
      : `reserva: ${id} ${acao === 'renovou' ? 'renovada' : 'pega'} por ${eu.por} em ${eu.maquina}`;
    const commit = gravar(raiz, remoto, ponta, { item: id, reserva }, novas, mensagem, opcoes.rede);
    if (commit) return { acao, item: id, reserva, commit, tentativas: tentativa };
  }
  throw new Error(`roadmap.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

/** `ork roadmap soltar`: devolve o item. Soltar a reserva de outra maquina exige `--forcar --motivo`. */
export function soltarItem(raiz: string, item: string, opcoes: OpcoesDeReserva = {}): ResultadoDeReserva {
  const id = exigirItem(raiz, item);
  const remoto = opcoes.remoto ?? REMOTO_PADRAO;
  const eu = quemSouEu(raiz, opcoes);
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { ponta, atualizado } = buscar(raiz, remoto, opcoes.rede);
    if (!atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS} em ${remoto}; soltar exige rede`);
    const todas = lerDaPonta(raiz, ponta);
    const atual = todas.find((r) => r.item === id);
    if (!atual) return { acao: 'nada', item: id, reserva: null, commit: null, tentativas: tentativa };
    if (opcoes.threadEsperada !== undefined && (atual.thread ?? null) !== opcoes.threadEsperada) {
      return { acao: 'nada', item: id, reserva: atual, commit: null, tentativas: tentativa };
    }
    let motivo = '';
    if (!ehMinha(atual, eu)) {
      if (!opcoes.forcar) throw new Error(`roadmap.reservado: ${descrever(atual)}; so quem pegou solta, ou --forcar --motivo`);
      motivo = `: ${exigirMotivo(opcoes)}`;
    }
    const restantes = todas.filter((r) => r.item !== id);
    const mensagem = `reserva: ${id} solta por ${eu.por} em ${eu.maquina}${motivo}`;
    const commit = gravar(raiz, remoto, ponta, { item: id, reserva: null }, restantes, mensagem, opcoes.rede);
    if (commit) return { acao: 'soltou', item: id, reserva: atual, commit, tentativas: tentativa };
  }
  throw new Error(`roadmap.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

// ---------------------------------------------------------------------------
// RM-037 (rm037noite, defeito 3): reserva presa em thread fechada.
// ---------------------------------------------------------------------------

/** Reserva desta maquina cuja thread, aqui, ja fechou; `sucessora` e outra thread aberta do mesmo item. */
export interface ReservaOrfa {
  reserva: ReservaDeItem;
  sucessora: string | null;
}

export interface ResultadoDaSoltura {
  item: string;
  thread: string;
  /** `intocada`: entre a leitura e a gravacao a reserva mudou de dono, e ficou como estava. */
  acao: 'solta' | 'reapontada' | 'pendente' | 'intocada';
  /** A thread que ficou com o item, quando a reserva foi reapontada. */
  para: string | null;
  commit: string | null;
  detalhe: string;
}

function threadsLocais(raiz: string): Thread[] {
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) {
    try { threads.push(lerThread(raiz, id)); } catch { /* thread ilegivel nao decide reserva */ }
  }
  return threads;
}

/** A outra thread aberta do item nesta maquina, a mais recente, que herda a reserva. */
function sucessoraDoItem(threads: readonly Thread[], item: string, fora: string): string | null {
  const abertas = threads.filter((t) => t.id !== fora && t.status !== 'fechada' && t.roadmap === item)
    .sort((a, b) => String(b.atualizadaEm ?? '').localeCompare(String(a.atualizadaEm ?? '')));
  return abertas[0]?.id ?? null;
}

/**
 * As reservas orfas: desta maquina, apontando para thread que existe aqui e esta fechada. Thread que
 * nao existe aqui nao prova nada (pode ser de outra copia), e reserva de outra maquina so sai com
 * `--forcar`, pelo contrato da I-47.
 */
export function reservasOrfas(raiz: string, reservas: readonly ReservaDeItem[], opcoes: OpcoesDeReserva = {}): ReservaOrfa[] {
  const eu = quemSouEu(raiz, opcoes);
  const threads = threadsLocais(raiz);
  const status = new Map(threads.map((t) => [t.id, t.status]));
  return reservas.filter((r) => r.thread && ehMinha(r, eu) && status.get(r.thread) === 'fechada')
    .map((reserva) => ({ reserva, sucessora: sucessoraDoItem(threads, reserva.item, reserva.thread as string) }));
}

/** Solta a reserva orfa, ou a reaponta para a sucessora, e registra no ledger da thread fechada. */
function soltarOrfa(raiz: string, orfa: ReservaOrfa, origem: 'fechamento' | 'orfas', opcoes: OpcoesDeReserva): ResultadoDaSoltura {
  const thread = orfa.reserva.thread as string, item = orfa.reserva.item;
  const comparando = { ...opcoes, threadEsperada: thread };
  const r = orfa.sucessora
    ? pegarItem(raiz, item, { ...comparando, thread: orfa.sucessora })
    : soltarItem(raiz, item, comparando);
  // A reserva mudou de dono no meio (ou ja tinha saido): nada foi gravado e nada vai ao ledger como soltura.
  if (r.acao === 'nada') {
    return { item, thread, acao: 'intocada', para: null, commit: null,
      detalhe: `${item} mudou de dono entre a leitura e a gravacao; ficou como estava` };
  }
  const acao = orfa.sucessora ? 'reapontada' : 'solta';
  const detalhe = orfa.sucessora ? `${item} passou para a thread ${orfa.sucessora}, aberta no mesmo item` : `${item} devolvido`;
  registrarSeExiste(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.reservaLiberada,
    { item, acao, para: orfa.sucessora, commit: r.commit, origem, detalhe });
  return { item, thread, acao, para: orfa.sucessora, commit: r.commit, detalhe };
}

/** A pendencia vai ao ledger da thread fechada, com a correcao; o registro tambem e de melhor esforco. */
function pendenteDaThread(raiz: string, thread: string, item: string | null, detalhe: string): ResultadoDaSoltura {
  try {
    registrarSeExiste(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.reservaPendente,
      { item, detalhe, correcao: 'ork roadmap reservas --soltar-orfas' });
  } catch { /* sem ledger gravavel, o resultado ainda diz a pendencia */ }
  return { item: item ?? '', thread, acao: 'pendente', para: null, commit: null, detalhe };
}

const primeiraLinha = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);

/**
 * `ork thread close` e `ork master`: a thread que fecha solta a reserva do item dela, ou a passa para
 * outra thread aberta do mesmo item nesta maquina. De melhor esforco: sem rede ou com a reserva em
 * outra maquina, o fechamento segue e o ledger guarda a pendencia com a correcao. So vai a rede
 * quando ha o que soltar: a thread tem item ou a ultima copia lida das reservas aponta para ela.
 */
export function soltarReservaDaThread(raiz: string, threadId: string, opcoes: OpcoesDeReserva = {}): ResultadoDaSoltura[] {
  let item: string | null = null;
  try { item = lerThread(raiz, threadId).roadmap ?? null; } catch { return []; }
  const remoto = opcoes.remoto ?? REMOTO_PADRAO;
  const naCopia = reservasLocais(raiz, remoto).find((r) => r.thread === threadId);
  if (!item && !naCopia) return [];
  const rede = { ...REDE_DO_FECHAMENTO, ...opcoes.rede };
  const comRede = { ...opcoes, rede };
  const oItem = item ?? naCopia?.item ?? null;
  let painel: PainelDeReservas;
  try { painel = listarReservas(raiz, { remoto, rede }); }
  catch (e) { return [pendenteDaThread(raiz, threadId, oItem, primeiraLinha(e))]; }
  if (!painel.atualizado) {
    return [pendenteDaThread(raiz, threadId, oItem, `sem leitura de ${BRANCH_DE_RESERVAS} em ${remoto}; a reserva fica para depois`)];
  }
  const dela = painel.reservas.filter((r) => r.thread === threadId);
  const orfas = reservasOrfas(raiz, dela, opcoes);
  const saida: ResultadoDaSoltura[] = [];
  // Sugestao 1 do CHECK 1: toda reserva da thread, nao so a primeira; a de outra maquina fica pendente.
  for (const r of dela.filter((x) => !orfas.some((o) => o.reserva.item === x.item))) {
    saida.push(pendenteDaThread(raiz, threadId, r.item, `${descrever(r)}; so quem pegou solta, ou --forcar --motivo`));
  }
  for (const orfa of orfas) {
    try { saida.push(soltarOrfa(raiz, orfa, 'fechamento', comRede)); }
    catch (e) { saida.push(pendenteDaThread(raiz, threadId, orfa.reserva.item, primeiraLinha(e))); }
  }
  return saida;
}

/**
 * `ork roadmap reservas --soltar-orfas`: a mesma regra do fechamento, para toda reserva orfa desta
 * maquina. Uma orfa que falha vira pendencia no ledger dela e nao para as outras (sugestao 2 do CHECK 1).
 */
export function soltarReservasOrfas(raiz: string, opcoes: OpcoesDeReserva = {}): ResultadoDaSoltura[] {
  const painel = listarReservas(raiz, { remoto: opcoes.remoto, rede: opcoes.rede });
  if (!painel.atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS}; soltar exige rede`);
  return reservasOrfas(raiz, painel.reservas, opcoes).map((orfa) => {
    try { return soltarOrfa(raiz, orfa, 'orfas', opcoes); }
    catch (e) { return pendenteDaThread(raiz, orfa.reserva.thread as string, orfa.reserva.item, primeiraLinha(e)); }
  });
}

/** O texto de `ork roadmap reservas` para o terminal, no fuso do dono. */
export function textoDasReservas(p: PainelDeReservas, orfas: readonly ReservaOrfa[] = []): string {
  const linhas: string[] = [];
  if (!p.atualizado) linhas.push('AVISO: sem acesso ao remoto; esta e a ultima copia lida nesta maquina.', '');
  const feats = p.feats ?? [];
  const numeros = feats.length === 0 ? [] : ['', `Números de FEAT reservados (${feats.length}), os últimos: ` +
    feats.slice(-5).map((f) => `${f.feat} (${f.thread ?? f.maquina})`).join(', ') + '. O próximo sai de: ork roadmap feat'];
  if (p.reservas.length === 0) {
    linhas.push('Nenhum item do roadmap reservado.', ...numeros);
    return linhas.join('\n');
  }
  linhas.push('ITEM     COM QUEM            MAQUINA         THREAD             DESDE');
  const orfaDoItem = new Map(orfas.map((o) => [o.reserva.item, o]));
  for (const r of p.reservas) {
    const orfa = orfaDoItem.get(r.item);
    const marca = orfa ? `  ÓRFÃ: thread fechada${orfa.sucessora ? `, passa para ${orfa.sucessora}` : ''}` : '';
    linhas.push(`${r.item.padEnd(8)} ${r.por.slice(0, 19).padEnd(19)} ${r.maquina.slice(0, 15).padEnd(15)} ` +
      `${(r.thread ?? '-').slice(0, 18).padEnd(18)} ${formatarDataHora(r.desdeEm)}` + (r.nota ? `  ${r.nota}` : '') + marca);
  }
  if (orfas.length > 0) linhas.push('', `${orfas.length} reserva(s) órfã(s) desta máquina. Para soltar: ork roadmap reservas --soltar-orfas`);
  linhas.push(...numeros, '', legendaDoFuso());
  return linhas.join('\n');
}
