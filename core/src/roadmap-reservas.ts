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
import { buscarBranch, git, gravarNaBranch, jsonsDaPonta, pontaLocal } from './branch-de-estado';
import { formatarDataHora, legendaDoFuso } from './horario';
import { nomeDaMaquina } from './maquina';
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
}

export interface ResultadoDeReserva {
  acao: 'pegou' | 'renovou' | 'tomou' | 'soltou' | 'nada';
  item: string;
  reserva: ReservaDeItem | null;
  commit: string | null;
  tentativas: number;
}

export interface PainelDeReservas {
  reservas: ReservaDeItem[];
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
function buscar(raiz: string, remoto: string): { ponta: string | null; atualizado: boolean } {
  return buscarBranch(raiz, remoto, BRANCH_DE_RESERVAS, PREFIXO);
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
export function listarReservas(raiz: string, opcoes: Pick<OpcoesDeReserva, 'remoto'> = {}): PainelDeReservas {
  const { ponta, atualizado } = buscar(raiz, opcoes.remoto ?? REMOTO_PADRAO);
  return { reservas: lerDaPonta(raiz, ponta), atualizado, ponta };
}

/** O `RESERVAS.md` da branch: a mesma lista, para quem abre o GitHub. */
export function painelEmMarkdown(reservas: readonly ReservaDeItem[]): string {
  const linhas = [
    '# Reservas do roadmap',
    '',
    'Quem está com cada item agora. Gerado pelo `ork roadmap pegar` e pelo `ork roadmap soltar`;',
    'não edite à mão. Antes de começar um item: `ork roadmap reservas`.',
    '',
  ];
  if (reservas.length === 0) return [...linhas, 'Nenhum item reservado.', ''].join('\n');
  linhas.push('| Item | Com quem | Máquina | Thread | Desde | Nota |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of reservas) {
    linhas.push(`| ${r.item} | ${r.por} | ${r.maquina} | ${r.thread ?? '—'} | ${formatarDataHora(r.desdeEm)} | ${r.nota ?? '—'} |`);
  }
  return [...linhas, '', legendaDoFuso(), ''].join('\n');
}

/** Grava a reserva (ou a remocao dela) e o painel numa versao nova da branch. Recusa volta `false`. */
function gravar(raiz: string, remoto: string, ponta: string | null, mudanca: { item: string; reserva: ReservaDeItem | null },
  todas: ReservaDeItem[], mensagem: string): string | false {
  return gravarNaBranch(raiz, remoto, BRANCH_DE_RESERVAS, ponta, [
    { caminho: `${DIR}/${mudanca.item}.json`, conteudo: mudanca.reserva ? JSON.stringify(mudanca.reserva, null, 2) + '\n' : null },
    { caminho: PAINEL, conteudo: painelEmMarkdown(todas) },
  ], mensagem, PREFIXO);
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
    const { ponta, atualizado } = buscar(raiz, remoto);
    if (!atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS} em ${remoto}; reservar exige rede`);
    const todas = lerDaPonta(raiz, ponta);
    const atual = todas.find((r) => r.item === id) ?? null;
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
    const commit = gravar(raiz, remoto, ponta, { item: id, reserva }, novas, mensagem);
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
    const { ponta, atualizado } = buscar(raiz, remoto);
    if (!atualizado) throw new Error(`roadmap.sem-remoto: nao consegui ler ${BRANCH_DE_RESERVAS} em ${remoto}; soltar exige rede`);
    const todas = lerDaPonta(raiz, ponta);
    const atual = todas.find((r) => r.item === id);
    if (!atual) return { acao: 'nada', item: id, reserva: null, commit: null, tentativas: tentativa };
    let motivo = '';
    if (!ehMinha(atual, eu)) {
      if (!opcoes.forcar) throw new Error(`roadmap.reservado: ${descrever(atual)}; so quem pegou solta, ou --forcar --motivo`);
      motivo = `: ${exigirMotivo(opcoes)}`;
    }
    const restantes = todas.filter((r) => r.item !== id);
    const mensagem = `reserva: ${id} solta por ${eu.por} em ${eu.maquina}${motivo}`;
    const commit = gravar(raiz, remoto, ponta, { item: id, reserva: null }, restantes, mensagem);
    if (commit) return { acao: 'soltou', item: id, reserva: atual, commit, tentativas: tentativa };
  }
  throw new Error(`roadmap.concorrencia: ${TENTATIVAS} pushes recusados seguidos; tente de novo em instantes`);
}

/** O texto de `ork roadmap reservas` para o terminal, no fuso do dono. */
export function textoDasReservas(p: PainelDeReservas): string {
  const linhas: string[] = [];
  if (!p.atualizado) linhas.push('AVISO: sem acesso ao remoto; esta e a ultima copia lida nesta maquina.', '');
  if (p.reservas.length === 0) {
    linhas.push('Nenhum item do roadmap reservado.');
    return linhas.join('\n');
  }
  linhas.push('ITEM     COM QUEM            MAQUINA         THREAD             DESDE');
  for (const r of p.reservas) {
    linhas.push(`${r.item.padEnd(8)} ${r.por.slice(0, 19).padEnd(19)} ${r.maquina.slice(0, 15).padEnd(15)} ` +
      `${(r.thread ?? '-').slice(0, 18).padEnd(18)} ${formatarDataHora(r.desdeEm)}` + (r.nota ? `  ${r.nota}` : ''));
  }
  linhas.push('', legendaDoFuso());
  return linhas.join('\n');
}
