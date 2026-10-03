/**
 * `ork ship`: merge e push CONTROLADOS e VERIFICADOS (bloco B1, item 5 da paridade).
 *
 * A ordem dos passos e o contrato, e ela nao muda por modo de conducao:
 *
 *   1. autorizacao de push, pelo gate do modo (#Classic usa a
 *      autorizacao antecipada registrada no ledger; #Maestro/#Auto usam a propria #TAG);
 *   2. policies do manifesto no gate `ship` (push_direto_na_base e provider);
 *   3. verificacao independente: `ork verify` reexecuta claims e comandos no HEAD real;
 *   4. lease `main-tree`, que serializa: so uma thread mergeia por vez;
 *   5. `git merge --no-ff`, conferido por `git merge-base --is-ancestor`;
 *   6. push, PROVADO por `git ls-remote` batendo com o sha local (nao pelo codigo de
 *      saida do push, e nunca por `gh api`, que nao e confiavel nesta maquina);
 *   7. `ship_done` no ledger com os dois shas, quem autorizou e a evidencia.
 *
 * Qualquer passo que reprove grava `ship_blocked` com MOTIVO TIPADO e nao avanca.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aprovacoesHumanas, registrarGateBloqueado, registrarGateLiberado } from './gates';
import { adquirirRegiao, esperandoPor, liberar, lerLease, LEASE_MAIN_TREE } from './leases';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirEstado, ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { avaliarPolicies, avisos, bloqueantes, linhasDeAviso, ViolacaoDePolicy } from './policies';
import { dirThread, gravarThread, lerThread } from './thread';
import { Lease, MotivoGate, Thread } from './types';
import { agora, exec, shaCurto } from './util';
import { comandoNoLedger, ExecutorVerify, ResultadoVerify, verificar } from './verify';
import { consultarCi, ExecutorCi, ResultadoCi } from './ci';
import { contratosTocados } from './contrato-publico';
import { cicloSemCheck } from './prova-minima';
import { formatarDataHora, legendaDoFuso, localizarTexto } from './horario';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { branchValida, exigirRemoto, shaValido } from './branch-de-estado';

export interface OpcoesShip {
  /** Revalidação interna confiável; nunca exposta pela CLI/MCP como argumento. */
  retomarLeaseVencido?: boolean;
  revalidarGit?: (etapa: 'preparar' | 'merge' | 'push', arvore?: string) => void;
  /** Executor interno confiável; não é uma opção de CLI nem argumento MCP. */
  executorVerify?: ExecutorVerify;
  /** Executor interno confiável da consulta ao provedor de CI. */
  executorCi?: ExecutorCi;
  /** Branch de destino (`--para main`). */
  para: string;
  /** Branch de origem. Padrao: a base carimbada da thread. */
  de?: string;
  remoto?: string;
  mensagem?: string;
  dryRun?: boolean;
  /** Nome de quem autoriza o push pela linha de comando (a pausa humana do modo). */
  autorizarPush?: string;
  /** Faz o merge local e nao empurra (usado quando nao ha remoto configurado). */
  semPush?: boolean;
  ttlLeaseMs?: number;
}

export interface Autorizacao {
  autorizado: boolean;
  tipo: 'modo' | 'humano-no-cli' | 'humano-antecipado' | 'pendente';
  por: string;
  razao: string;
}

export interface ResultadoShip {
  ok: boolean;
  bloqueado: boolean;
  motivo: MotivoGate | null;
  detalhe: string;
  correcao: string;
  thread: string;
  de: string;
  para: string;
  shaDe: string;
  shaParaAntes: string;
  /**
   * O merge que entregou a thread. RM-037 (fatia 5, A1): com a branch ja incorporada, o commit de primeiro pai da
   * base que a trouxe (`commitQueIncorporou`), e nao a ponta da base.
   */
  mergeSha: string | null;
  /** RM-037 (fatia 5, A1): a ponta do destino depois do SHIP, a que o push prova. Sem jaIncorporado, e o proprio merge. */
  pontaDaBase: string | null;
  jaIncorporado: boolean;
  remoto: string | null;
  shaRemoto: string | null;
  /** True so quando `git ls-remote` devolveu o MESMO sha do destino local (a `pontaDaBase`). */
  pushVerificado: boolean;
  autorizacao: Autorizacao;
  verificacao: ResultadoVerify | null;
  ci: ResultadoCi | null;
  violacoes: ViolacaoDePolicy[];
  lease: Lease | null;
  leaseOcupadoPor: Lease | null;
  /** Comandos realmente executados, na ordem: e a evidencia do ship. */
  passos: string[];
  dryRun: boolean;
}

/**
 * RM-037 (fatia 5, A1): o commit de primeiro pai da base que incorporou o `shaDe`: o merge que trouxe a branch, ou
 * o proprio `shaDe` quando a base avancou por fast-forward ate ele. Com a branch ja incorporada, a ponta da base e
 * outra coisa: no `ship_done` da ork-docsusuarios (27/09/2026), o unico do `ork ship` com `jaIncorporado` nos ledgers
 * deste projeto, ela era o merge de outra thread. O que trouxe a branch e o commit mais velho do primeiro pai da base
 * que descende do `shaDe`. GO-FIX (rodada 1 do CHECK): `--first-parent` junto com `--ancestry-path` so propaga a
 * descendencia pelos commits de primeiro pai, e o merge do PR que recebeu "Update branch" no GitHub (o pai dele e um
 * merge que descende do `shaDe`, nao o `shaDe`) sumia da lista; agora sao duas listas e a intersecao. `null` quando o
 * git nao responde.
 */
export function commitQueIncorporou(raiz: string, shaDe: string, ponta: string, passos: string[] = []): string | null {
  if (shaDe === ponta) return shaDe;
  // `passos` recebe os comandos que de fato rodaram, na ordem: e a evidencia do ship (sugestao da conferencia da rodada 2).
  const curto = (sha: string) => sha.slice(0, 8);
  // As listas crescem com o historico entre a branch e a ponta: o buffer vai alem do 1 MiB padrao do spawnSync.
  const listar = (args: string[]): string[] | null => {
    passos.push(`git ${args.map((a) => a.replace(/^([0-9a-f]{40,64})\.\.([0-9a-f]{40,64})$/, (_, x, y) => `${curto(x)}..${curto(y)}`)).join(' ')}`);
    const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
    return r.status === 0 && !r.error ? r.stdout.split('\n').filter((l) => /^[0-9a-f]{40,64}$/.test(l)) : null;
  };
  const primeiroPai = listar(['rev-list', '--first-parent', `${shaDe}..${ponta}`]);
  const descendentes = listar(['rev-list', '--ancestry-path', `${shaDe}..${ponta}`]);
  if (!primeiroPai || !descendentes) return null;
  const doShaDe = new Set(descendentes);
  // Do mais velho para o mais novo: o primeiro de primeiro pai que descende do `shaDe`.
  const maisVelho = [...primeiroPai].reverse().find((c) => doShaDe.has(c));
  if (!maisVelho) return null;
  // O primeiro pai dele e o proprio `shaDe`: a branch ja estava no primeiro pai da base (fast-forward). Sem a resposta
  // do git, nada e gravado: devolver o mais velho poria no `mergeSha` o filho do `shaDe` (sugestao da rodada 2).
  passos.push(`git rev-parse ${curto(maisVelho)}^1`);
  const pai = exec('git', ['rev-parse', `${maisVelho}^1`], raiz);
  if (!pai.ok) return null;
  return pai.stdout.trim() === shaDe ? shaDe : maisVelho;
}

/** Os caminhos de contrato publico que a entrega traz sobre a base (diff desde o merge-base). */
function contratosDaEntrega(raiz: string, shaPara: string, shaDe: string): string[] {
  const base = exec('git', ['merge-base', shaPara, shaDe], raiz);
  if (!base.ok) return [];
  const diff = exec('git', ['diff', '--name-only', '--no-renames', base.stdout.trim(), shaDe], raiz);
  return diff.ok ? contratosTocados(diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) : [];
}

/** Modos em que a propria #TAG do pedido autoriza o push antecipadamente. */
const MODOS_QUE_AUTORIZAM_PUSH: readonly Thread['modo'][] = ['maestro', 'auto'];

/**
 * Quem autoriza o push desta thread.
 *
 * `#Classic` pausa no gate de evidencias, com autorizacao ANTECIPADA de push: aqui isso
 * e conferido no ledger, nao presumido. `#Maestro` e `#Auto` seguem pela #TAG, que fica
 * registrada.
 *
 * I-43: thread LEGADA em `#Look` ou `#Ork` pausava no proprio SHIP. Ela continua caindo
 * neste mesmo caminho (nao esta em `MODOS_QUE_AUTORIZAM_PUSH`, entao exige autorizacao
 * registrada), e por isso a regra nao precisou de um ramo so para ela.
 */
export function autorizacaoDePush(
  raiz: string,
  thread: Thread,
  opcoes: OpcoesShip
): Autorizacao {
  const tag = tagDoModo(thread.modo);
  if (typeof opcoes.autorizarPush === 'string' && opcoes.autorizarPush.trim() !== '') {
    return {
      autorizado: true,
      tipo: 'humano-no-cli',
      por: opcoes.autorizarPush.trim(),
      razao: `pausa de push do modo ${tag} autorizada na linha de comando`,
    };
  }
  if (MODOS_QUE_AUTORIZAM_PUSH.includes(thread.modo)) {
    return {
      autorizado: true,
      tipo: 'modo',
      por: `#TAG ${tag} no pedido do builder`,
      razao: `o modo ${tag} entrega dentro de um bloco sem pausa: a #TAG e a autorizacao previa`,
    };
  }
  if (thread.modo === 'classic') {
    const antecipada = aprovacoesHumanas(raiz, thread.id).find((e) =>
      /push|evidencia/i.test(String(e.sobre ?? ''))
    );
    if (antecipada) {
      return {
        autorizado: true,
        tipo: 'humano-antecipado',
        por: String(antecipada.autorizadoPor ?? 'humano'),
        razao: `autorizacao antecipada de push registrada no ledger em ${antecipada.ts}`,
      };
    }
  }
  return {
    autorizado: false,
    tipo: 'pendente',
    por: '',
    razao:
      `o modo ${tag} pausa no push e ainda nao ha autorizacao humana registrada. ` +
      `Autorize na entrega: ork ship ${thread.id} --para <branch> --autorizar-push <quem>`,
  };
}

interface ArvoreDeMerge {
  dir: string;
  temporaria: boolean;
}

/** Diretorio temporario onde a arvore de merge e montada quando preciso. */
function dirTemporarioDeShip(raiz: string, para: string): string {
  const seguro = para.replace(/[^A-Za-z0-9._-]/g, '-');
  return path.join(dirEstado(raiz), 'tmp', `ship-${seguro}-${Date.now()}`);
}

/**
 * Diretorio da worktree que tem a branch em check-out, se alguma tiver.
 *
 * O git recusa `worktree add` de uma branch ja em check-out em outro lugar, e com razao:
 * duas arvores na mesma branch e receita de estado inconsistente. Entao o `ork` procura
 * quem a tem antes de tentar montar arvore nova.
 */
export function arvoreComBranch(raiz: string, branch: string): string | null {
  const r = exec('git', ['worktree', 'list', '--porcelain'], raiz);
  if (!r.ok) return null;
  let atual: string | null = null;
  for (const linha of r.stdout.split('\n')) {
    if (linha.startsWith('worktree ')) atual = linha.slice('worktree '.length).trim();
    else if (linha.trim() === `branch refs/heads/${branch}`) return atual;
  }
  return null;
}

/** A arvore tem alteracao nao commitada em arquivo versionado? (arquivo novo nao conta) */
function temAlteracaoNaoCommitada(dir: string): boolean {
  return !exec('git', ['diff', '--quiet'], dir).ok || !exec('git', ['diff', '--cached', '--quiet'], dir).ok;
}

/**
 * Prepara a arvore onde o merge acontece.
 *
 * Se a branch de destino ja esta em check-out em alguma arvore do repositorio (a raiz do
 * projeto ou o check-out principal, quando o `ork` roda de dentro de uma worktree), o
 * merge acontece LA, exigindo arvore limpa: e a unica forma de o resultado do merge nao
 * deixar aquela arvore inconsistente com a propria branch.
 *
 * Se ninguem tem a branch, o `ork` monta uma worktree temporaria e a descarta ao fim:
 * entregar nunca pode trocar a branch em que o builder esta trabalhando.
 */
export function prepararArvore(raiz: string, para: string): ArvoreDeMerge {
  const dona = arvoreComBranch(raiz, para);
  if (dona) {
    if (temAlteracaoNaoCommitada(dona)) {
      throw new Error(
        `a branch de destino "${para}" esta em check-out em ${dona} com alteracoes nao commitadas; ` +
          'commite ou reverta la antes do ship'
      );
    }
    return { dir: dona, temporaria: false };
  }
  const dir = dirTemporarioDeShip(raiz, para);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const r = exec('git', ['worktree', 'add', '--', dir, para], raiz);
  if (!r.ok) {
    throw new Error(
      `nao foi possivel montar a arvore de merge de "${para}": ${(r.stderr || r.stdout).trim()}`
    );
  }
  return { dir, temporaria: true };
}

/** Remove a worktree temporaria do merge (best effort: o lease ja foi liberado). */
function descartarArvore(raiz: string, arvore: ArvoreDeMerge): void {
  if (!arvore.temporaria) return;
  exec('git', ['worktree', 'remove', '--force', arvore.dir], raiz);
  exec('git', ['worktree', 'prune'], raiz);
}

/** sha de uma referencia local, ou null quando ela nao existe. */
export function shaDaRef(dir: string, ref: string): string | null {
  const r = exec('git', ['rev-parse', '--verify', '--quiet', ref], dir);
  const sha = r.stdout.trim();
  return r.ok && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * Le no REMOTO o sha da branch, com `git ls-remote`.
 *
 * E o unico jeito aceito de provar push nesta maquina: `gh api` e imprevisivel aqui, e o
 * codigo de saida do `git push` nao prova que o remoto ficou com o commit certo.
 */
export function shaNoRemoto(dir: string, remoto: string, branch: string): string | null {
  // RM-047: so nome de remoto chega ao git, e depois do `--` (nunca vira opcao nem transporte).
  const r = exec('git', ['ls-remote', '--', exigirRemoto(remoto, 'ship'), `refs/heads/${branch}`], dir, 120000);
  if (!r.ok) return null;
  const linha = r.stdout.split('\n').find((l) => l.trim() !== '');
  if (!linha) return null;
  const sha = linha.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** O remoto esta configurado neste repositorio? */
export function remotoConfigurado(dir: string, remoto: string): boolean {
  return exec('git', ['remote', 'get-url', '--', exigirRemoto(remoto, 'ship')], dir).ok;
}

function baseDoResultado(thread: Thread, de: string, opcoes: OpcoesShip): ResultadoShip {
  return {
    ok: false,
    bloqueado: false,
    motivo: null,
    detalhe: '',
    correcao: '',
    thread: thread.id,
    de,
    para: opcoes.para,
    shaDe: '',
    shaParaAntes: '',
    mergeSha: null,
    pontaDaBase: null,
    jaIncorporado: false,
    remoto: opcoes.remoto ?? 'origin',
    shaRemoto: null,
    pushVerificado: false,
    autorizacao: { autorizado: false, tipo: 'pendente', por: '', razao: '' },
    verificacao: null,
    ci: null,
    violacoes: [],
    lease: null,
    leaseOcupadoPor: null,
    passos: [],
    dryRun: opcoes.dryRun === true,
  };
}

/** Executa o SHIP da thread. Nunca lanca por reprovacao: reprovacao volta tipada. */
/** A reversao encontrada na base, com o sha que a prova. */
export interface ReversaoDaEntrega {
  /** O merge que entregou a thread e depois foi desfeito. */
  mergeSha: string;
  /** O commit de revert, que e a prova: e ele que carrega o marcador do git. */
  revertSha: string;
  /** A base onde o revert foi encontrado: a mesma para onde o `ship_done` entregou. */
  para: string;
}

/**
 * A entrega ja feita por esta thread foi REVERTIDA na base? (I-43, D3, T7)
 *
 * Este era o buraco que tornava o indice de qualidade um numero que nunca muda:
 * `rollback_done` existia na allowlist do ciclo e NAO era escrito por ninguem, e ele
 * e o insumo de maior peso. Sem escritor, 23 das 29 threads entregues ficariam
 * coladas no teto para sempre.
 *
 * A deteccao ancora no marcador que o PROPRIO git escreve. `git revert -m 1 <sha>`
 * poe "This reverts commit <sha>" no corpo do commit, e e isso que se procura no
 * historico da base DEPOIS do merge. Nao se infere reversao por diff de arvore: um
 * arquivo que voltou ao estado anterior pode ser trabalho de outra thread, e chamar
 * isso de reversao seria rebaixar entrega alheia por coincidencia.
 *
 * `para` e OPCIONAL, e isso e o que permite perguntar fora do ship (GO-FIX 1, A1):
 * sem ele, o destino sai do proprio `ship_done`, que ja grava para onde entregou. Quem
 * calcula o indice depois do MASTER nao tem branch de destino na mao, e inventar uma
 * seria pior que nao perguntar.
 *
 * So le git; nao escreve nada. Quem grava o evento e `registrarReversaoDaEntrega`.
 */
export function detectarReversaoDaEntrega(
  raiz: string,
  thread: Thread,
  para?: string
): ReversaoDaEntrega | null {
  const dir = dirThread(raiz, thread.id);
  const entregas = lerLedger(dir)
    .filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido && typeof e.mergeSha === 'string')
    .map((e) => ({ mergeSha: String(e.mergeSha), para: para ?? String(e.para ?? '') }))
    // RM-047 (fronteira de confiança): o ledger pode vir do clone. Só sha hexadecimal e nome de branch
    // chegam ao `git log`; qualquer outro valor viraria opção dele e é ignorado.
    .filter((e) => e.para.length > 0 && shaValido(e.mergeSha) && branchValida(e.para));
  if (entregas.length === 0) return null;

  const perguntados = new Set<string>();
  for (const entrega of [...entregas].reverse()) {
    const intervalo = `${entrega.mergeSha}..${entrega.para}`;
    if (perguntados.has(intervalo)) continue;
    perguntados.add(intervalo);
    // O historico e append-only: o merge continua la, e o revert vem DEPOIS dele.
    const log = exec('git', ['log', '--format=%H%x1f%B%x1e', '--end-of-options', intervalo], raiz, 60000);
    if (!log.ok) continue;
    for (const bruto of log.stdout.split('\x1e')) {
      const [sha, corpo] = bruto.split('\x1f');
      if (!sha || !corpo) continue;
      if (corpo.includes(`This reverts commit ${entrega.mergeSha}`)) {
        return { mergeSha: entrega.mergeSha, revertSha: sha.trim(), para: entrega.para };
      }
    }
  }
  return null;
}

/**
 * Grava `rollback_done` quando a reversao e nova, e devolve o que encontrou.
 *
 * IDEMPOTENTE por `revertSha`: o ledger e append-only e o mesmo revert nao pode
 * rebaixar a thread duas vezes so porque alguem rodou o comando de novo.
 */
export function registrarReversaoDaEntrega(
  raiz: string,
  thread: Thread,
  para?: string
): ReversaoDaEntrega | null {
  const achada = detectarReversaoDaEntrega(raiz, thread, para);
  if (!achada) return null;
  const dir = dirThread(raiz, thread.id);
  const jaRegistrada = lerLedger(dir).some(
    (e) => e.tipo === TIPOS_DE_EVENTO.rollbackConcluido && e.revertSha === achada.revertSha
  );
  if (jaRegistrada) return achada;
  registrar(dir, thread.id, TIPOS_DE_EVENTO.rollbackConcluido, {
    fase: 'SHIP',
    ...achada,
    prova: `git log ${achada.mergeSha.slice(0, 8)}..${achada.para} traz "This reverts commit ${achada.mergeSha}" em ${achada.revertSha.slice(0, 8)}`,
    razao: 'I-43: a entrega foi desfeita na base; e o insumo de maior peso do indice de qualidade',
  });
  return achada;
}

export function ship(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesShip
): ResultadoShip {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const dir = dirThread(raiz, threadId);
  const de = opcoes.de ?? thread.base.branch;
  const para = opcoes.para;
  // RM-047: o `--remoto` vem da linha de comando. Antes de qualquer git (inclusive a leitura da reversao),
  // so nome de remoto passa; o resto recusa com `ship.remoto-invalido`, e o ship nao entrega sem push provado
  // por um remoto que nunca existiu.
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const r = baseDoResultado(thread, de, opcoes);

  // I-43 (T7): antes de qualquer coisa, se a entrega ANTERIOR desta thread foi
  // revertida na base, isso vira `rollback_done`. E o insumo de maior peso do indice
  // de qualidade, e o unico fato que diz sem interpretacao que a entrega nao servia.
  // Idempotente: o mesmo revert nao rebaixa a thread duas vezes.
  try { registrarReversaoDaEntrega(raiz, thread, para); } catch { /* git indisponivel nao barra o ship */ }

  const bloquear = (motivo: MotivoGate, detalhe: string, correcao: string): ResultadoShip => {
    registrarGateBloqueado(dir, threadId, {
      gate: 'ship',
      motivo,
      modo: thread.modo,
      detalhe,
      correcao,
      de,
      para,
      // Fatia 2 do ensaio da 0.5.0 (P2): o gate do ensaio e marcado, e os leitores de estado o ignoram.
      ...(r.dryRun ? { dryRun: true } : {}),
    });
    registrar(dir, threadId, TIPOS_DE_EVENTO.shipBloqueado, {
      de,
      para,
      motivo,
      detalhe,
      correcao,
      modo: thread.modo,
      dryRun: r.dryRun,
    });
    return { ...r, bloqueado: true, ok: false, motivo, detalhe, correcao };
  };

  // 1. Autorizacao de push pelo gate do modo de conducao.
  const autorizacao = autorizacaoDePush(raiz, thread, opcoes);
  r.autorizacao = autorizacao;
  if (!autorizacao.autorizado) {
    return bloquear(
      'human.pending',
      autorizacao.razao,
      `ork ship ${threadId} --para <branch> --autorizar-push <quem>`
    );
  }

  // 2. Policies do manifesto que valem no gate `ship`. RM-008 (fatia 3): a branch da thread
  // atras da base e fato do git, calculado aqui (a ponta da base nao esta contida na branch).
  const pontaDe = shaDaRef(raiz, `refs/heads/${de}`);
  const pontaPara = shaDaRef(raiz, `refs/heads/${para}`);
  const branchAtrasDaBase = pontaDe && pontaPara && de !== para
    ? !exec('git', ['merge-base', '--is-ancestor', pontaPara, pontaDe], raiz).ok
    : undefined;
  // Fatia 2 do ensaio da 0.5.0 (P9): sem delta (a branch da thread ja esta contida na base) e com a base
  // local a frente da ref de rastreio do remoto, o push publicaria a base sem merge de thread. A medida e
  // local, sem rede; sem remoto, sem ref de rastreio ou com --sem-push, o fato nao vem e nada muda.
  // CHECK, rodada 1 (B1): o merge que o proprio ship ja fez e nao chegou ao remoto (push recusado,
  // --sem-push, retomada do MCP) tambem deixa a base a frente sem delta, mas leva a ponta da thread como
  // pai que nao e o primeiro: e entrega de thread, e o retry empurra como antes. Rodada 2 (S-R2-1): so
  // quando a linha principal da base, alem do remoto, e toda de merge; commit direto nela segue barrado.
  const rastreio = pontaDe && pontaPara && de !== para && !opcoes.semPush && remotoConfigurado(raiz, remoto)
    ? shaDaRef(raiz, `refs/remotes/${remoto}/${para}`) : null;
  const mergeDaThreadNaBase = (desde: string): boolean => {
    const diretos = exec('git', ['rev-list', '--first-parent', '--no-merges', `${desde}..${pontaPara}`], raiz);
    return diretos.ok && diretos.stdout.trim() === '' &&
      exec('git', ['rev-list', '--merges', '--parents', `${desde}..${pontaPara}`], raiz).stdout.split('\n')
        .some((linha) => linha.trim().split(' ').slice(2).includes(pontaDe!));
  };
  const semDeltaComBaseAFrente = rastreio
    ? exec('git', ['merge-base', '--is-ancestor', pontaDe!, pontaPara!], raiz).ok &&
      !exec('git', ['merge-base', '--is-ancestor', pontaPara!, rastreio], raiz).ok &&
      !mergeDaThreadNaBase(rastreio)
    : undefined;
  const violacoes = avaliarPolicies(manifesto, {
    gate: 'ship',
    de,
    para,
    baseBranch: manifesto.worktree.base_branch,
    threadId,
    branchAtrasDaBase,
    semDeltaComBaseAFrente,
    remoto,
  });
  r.violacoes = violacoes;
  if (!r.dryRun) {
    for (const v of avisos(violacoes)) {
      registrar(dir, threadId, TIPOS_DE_EVENTO.politicaAviso, { gate: 'ship', de, para,
        policy: v.policy, detalhe: v.detalhe, correcao: v.correcao, modo: thread.modo });
    }
  }
  const bloqueiam = bloqueantes(violacoes);
  if (bloqueiam.length > 0) {
    return bloquear(
      'policy.violation',
      bloqueiam.map((v) => `${v.policy}: ${v.detalhe}`).join('; '),
      bloqueiam.map((v) => v.correcao).join('; ')
    );
  }

  // 3. Verificacao independente: reexecuta claims e comandos no HEAD real da thread.
  const verificacao = verificar(carregado, threadId, { executor: opcoes.executorVerify });
  r.verificacao = verificacao;
  if (!verificacao.ok) {
    const motivo = verificacao.motivos.find((m) => m !== 'claims.unverifiable') as MotivoGate;
    return bloquear(
      motivo,
      `verificacao reprovou no HEAD ${verificacao.commit}: ${verificacao.motivos.join(', ')}`,
      'rode `ork verify ' + threadId + '` e corrija antes de entregar'
    );
  }

  // Referencias locais, resolvidas antes de tomar o lease.
  const shaDe = shaDaRef(raiz, `refs/heads/${de}`);
  const shaPara = shaDaRef(raiz, `refs/heads/${para}`);
  if (!shaDe) {
    return bloquear(
      'artifact.missing',
      `branch de origem "${de}" nao existe neste repositorio`,
      `use --de <branch> ou crie a branch da thread`
    );
  }
  if (!shaPara) {
    return bloquear(
      'artifact.missing',
      `branch de destino "${para}" nao existe neste repositorio`,
      `crie a branch de destino ou informe outra em --para`
    );
  }
  r.shaDe = shaDe;
  r.shaParaAntes = shaPara;

  // I-42 (D7): a fronteira do commit MCP vale tambem na entrega, onde aparece o commit feito
  // por git direto. Ciclo sem PLAN nem CHECK nao entrega contrato publico.
  const tocados = cicloSemCheck(thread) ? contratosDaEntrega(raiz, shaPara, shaDe) : [];
  if (tocados.length > 0) {
    return bloquear(
      'policy.violation',
      `contrato publico em ciclo sem PLAN nem CHECK: ${tocados.join(', ')}`,
      'refaca a mudanca numa thread #Classic, #Maestro ou #Auto'
    );
  }

  // O recibo vem do provedor e pertence ao SHA exato da candidata. Teste local
  // verde ou status de outro commit não libera a entrega.
  const ci = consultarCi(carregado, shaDe, remoto, opcoes.executorCi);
  r.ci = ci;
  if (!ci.ok) {
    return bloquear(
      'ci.failed',
      `${ci.detail} (commit ${shaDe}, contexto ${ci.context})`,
      `publique a branch, aguarde o check ${ci.context} verde no GitHub e repita o SHIP`,
    );
  }

  // 4. Lease `main-tree`: so uma thread mergeia por vez.
  if (r.dryRun) {
    const ocupado = lerLease(raiz, LEASE_MAIN_TREE);
    r.leaseOcupadoPor = ocupado;
    // O ensaio tambem responde ONDE o merge aconteceria e se aquela arvore esta limpa:
    // descobrir isso so na hora do merge real seria descobrir tarde demais.
    const dona = arvoreComBranch(raiz, para);
    const arvoreDoMerge = dona
      ? `${dona} (arvore que tem ${para} em check-out; ${temAlteracaoNaoCommitada(dona) ? 'SUJA, o ship reprovaria com tree.blocked' : 'limpa'})`
      : `worktree temporaria em ${path.join(dirEstado(raiz), 'tmp')} (ninguem tem ${para} em check-out)`;
    r.detalhe = `arvore de merge: ${arvoreDoMerge}`;
    // Ensaio de 03/10 (R5): sem remoto (ou com --sem-push), o ensaio diz o mesmo que o ship real, e nao
    // promete um push e uma prova que nao vao acontecer.
    const semPushNoReal = opcoes.semPush ? 'push nao executado por --sem-push (merge local concluido)'
      : !remotoConfigurado(raiz, remoto) ? `remoto "${remoto}" nao configurado: merge local concluido, sem push a provar` : null;
    r.passos = [
      `arvore de merge: ${arvoreDoMerge}`,
      `git merge --no-ff ${de} -m "<mensagem de ship>"`,
      ...(semPushNoReal ? [`sem push: ${semPushNoReal}`] : [
        `git push ${remoto} ${para}`,
        `git ls-remote ${remoto} refs/heads/${para}   (prova do push)`,
      ]),
    ];
    registrar(dir, threadId, TIPOS_DE_EVENTO.shipIniciado, {
      de,
      para,
      shaDe,
      shaPara,
      modo: thread.modo,
      autorizadoPor: autorizacao.por,
      dryRun: true,
      leaseLivre: ocupado === null,
    });
    return { ...r, ok: true, bloqueado: false };
  }

  // A merge queue do B2: quem nao pega o lease entra na FILA, em vez de sumir. A fila
  // fica visivel em `ork lease list` e em `ork board --all`, e e ela que serializa o
  // merge de N threads paralelas sem ninguem perder a vez.
  const aquisicao = adquirirRegiao(raiz, LEASE_MAIN_TREE, {
    thread: threadId,
    motivo: `ship de ${de} para ${para}`,
    ttlMs: opcoes.ttlLeaseMs,
    retomarVencido: opcoes.retomarLeaseVencido,
  });
  if (!aquisicao.ok) {
    r.leaseOcupadoPor = aquisicao.ocupadoPor;
    const dono = aquisicao.ocupadoPor;
    registrar(dir, threadId, TIPOS_DE_EVENTO.leaseEnfileirado, {
      lease: LEASE_MAIN_TREE,
      posicao: aquisicao.posicaoNaFila,
      naFrente: esperandoPor(raiz, LEASE_MAIN_TREE).length,
      bloqueadaPor: dono?.thread ?? '(desconhecida)',
      motivo: 'lease.busy',
    });
    return bloquear(
      'lease.busy',
      `lease ${LEASE_MAIN_TREE} esta com a thread ${dono?.thread ?? '(desconhecida)'} ` +
        `desde ${dono?.adquiridoEm ?? '?'} (${dono?.motivo ?? 'sem motivo'}); ` +
        `esta thread entrou na merge queue na posicao ${aquisicao.posicaoNaFila}`,
      `espere a vez na fila (ork lease list), ou libere com: ork lease release ${LEASE_MAIN_TREE} --forcar`
    );
  }
  r.lease = aquisicao.lease;
  registrar(dir, threadId, TIPOS_DE_EVENTO.leaseAdquirido, {
    lease: LEASE_MAIN_TREE,
    expiraEm: aquisicao.lease?.expiraEm,
    tomadoDeVencido: aquisicao.tomadoDeVencido,
    motivo: `ship de ${de} para ${para}`,
  });
  registrar(dir, threadId, TIPOS_DE_EVENTO.shipIniciado, {
    de,
    para,
    shaDe,
    shaPara,
    modo: thread.modo,
    autorizadoPor: autorizacao.por,
    tipoDeAutorizacao: autorizacao.tipo,
    verificadoNoCommit: verificacao.commit,
  });

  let arvore: ArvoreDeMerge | null = null;
  try {
    try {
      opcoes.revalidarGit?.('preparar');
      arvore = prepararArvore(raiz, para);
    } catch (e) {
      // Arvore de destino indisponivel e reprovacao tipada, nao excecao vazando pelo CLI.
      return bloquear(
        'tree.blocked',
        (e as Error).message,
        'deixe a arvore da branch de destino limpa (ou libere a branch) e rode o ship de novo'
      );
    }
    const passos: string[] = [];

    opcoes.revalidarGit?.('merge', arvore.dir);
    // 5. Merge --no-ff, conferido no proprio git.
    const jaIncorporado = exec('git', ['merge-base', '--is-ancestor', shaDe, shaPara], raiz).ok;
    r.jaIncorporado = jaIncorporado;
    let mergeSha = shaPara;
    // RM-037 (fatia 5, A1): a ponta que o push prova. Com o merge feito aqui, e ele; com a branch ja incorporada, a
    // ponta de antes, que pode trazer outros merges depois do que entregou esta thread.
    let pontaDaBase = shaPara;
    if (!jaIncorporado) {
      const mensagem =
        opcoes.mensagem ??
        `ship(${threadId}): merge de ${de} em ${para}\n\n` +
          `thread: ${thread.id} (${thread.slug})\n` +
          `modo: ${tagDoModo(thread.modo)}\n` +
          `autorizado por: ${autorizacao.por} (${autorizacao.tipo})\n` +
          `verificado em: HEAD ${verificacao.commit}\n`;
      // RM-047: o merge e do sha verificado, e nao do nome que veio de `--de` (nome nunca vira opcao do git).
      const merge = exec('git', ['merge', '--no-ff', '-m', mensagem, shaDe], arvore.dir, 300000);
      passos.push(`git merge --no-ff ${de}`);
      if (!merge.ok) {
        exec('git', ['merge', '--abort'], arvore.dir);
        r.passos = [...passos, 'git merge --abort'];
        return bloquear(
          'artifact.missing',
          `merge de ${de} em ${para} falhou: ${(merge.stderr || merge.stdout).trim().slice(0, 400)}`,
          'resolva o conflito na branch da thread e rode o ship de novo'
        );
      }
      const novo = shaDaRef(arvore.dir, 'HEAD');
      if (!novo) {
        return bloquear('artifact.missing', 'nao foi possivel ler o HEAD apos o merge', 'confira o repositorio');
      }
      mergeSha = novo;
      pontaDaBase = novo;
      // Verificacao independente do merge: a origem precisa ser ancestral do resultado.
      const incorporou = exec('git', ['merge-base', '--is-ancestor', shaDe, mergeSha], arvore.dir).ok;
      passos.push(`git merge-base --is-ancestor ${shaDe.slice(0, 8)} ${mergeSha.slice(0, 8)}`);
      if (!incorporou) {
        return bloquear(
          'artifact.missing',
          `o commit de ${de} nao aparece como ancestral do merge ${mergeSha}`,
          'nao empurre: investigue o estado do repositorio'
        );
      }
    } else {
      // RM-037 (fatia 5, A1): o merge que trouxe a branch, e nao a ponta da base.
      const incorporadoEm = commitQueIncorporou(raiz, shaDe, shaPara, passos);
      if (!incorporadoEm) {
        return bloquear(
          'artifact.missing',
          `${de} ja e ancestral de ${para}, mas o git nao achou o commit de primeiro pai que o incorporou`,
          'confira o repositorio: o ship_done precisa do merge que entregou a thread'
        );
      }
      mergeSha = incorporadoEm;
      passos.push(`(nada a mergear: ${de} ja e ancestral de ${para}, incorporado em ${mergeSha.slice(0, 8)})`);
    }
    r.mergeSha = mergeSha;
    r.pontaDaBase = pontaDaBase;

    opcoes.revalidarGit?.('push', arvore.dir);
    // 6. Push PROVADO por ls-remote.
    const temRemoto = remotoConfigurado(arvore.dir, remoto);
    r.remoto = temRemoto ? remoto : null;
    if (opcoes.semPush || !temRemoto) {
      r.pushVerificado = false;
      r.detalhe = opcoes.semPush
        ? 'push nao executado por --sem-push (merge local concluido)'
        : `remoto "${remoto}" nao configurado: merge local concluido, sem push a provar`;
    } else {
      const existeNoRemoto = shaNoRemoto(arvore.dir, remoto, para) !== null;
      const argsPush = existeNoRemoto
        ? ['push', '--', remoto, `refs/heads/${para}:refs/heads/${para}`]
        : ['push', '-u', '--', remoto, `refs/heads/${para}:refs/heads/${para}`];
      const push = exec('git', argsPush, arvore.dir, 300000);
      passos.push(`git ${argsPush.join(' ')}`);
      if (!push.ok) {
        r.passos = passos;
        return bloquear(
          'runtime.unavailable',
          `push para ${remoto}/${para} falhou: ${(push.stderr || push.stdout).trim().slice(0, 400)}`,
          'resolva o acesso ao remoto e rode o ship de novo (o merge local ja aconteceu)'
        );
      }
      // A prova: o sha que o REMOTO devolve tem que ser o mesmo do destino local.
      const shaRemoto = shaNoRemoto(arvore.dir, remoto, para);
      passos.push(`git ls-remote ${remoto} refs/heads/${para}`);
      r.shaRemoto = shaRemoto;
      r.pushVerificado = shaRemoto !== null && shaRemoto === pontaDaBase;
      if (!r.pushVerificado) {
        r.passos = passos;
        return bloquear(
          'runtime.unavailable',
          `ls-remote devolveu ${shaRemoto ?? '(nada)'} e o destino local esta em ${pontaDaBase}: ` +
            'o push nao ficou provado',
          'rode o ship de novo e confira o remoto'
        );
      }
    }
    r.passos = passos;

    // 7. Evidencia no ledger e estado da thread.
    registrarGateLiberado(dir, threadId, {
      gate: 'ship',
      modo: thread.modo,
      autorizadoPor: autorizacao.por,
      evidencia: `merge ${mergeSha} verificado; ls-remote ${r.shaRemoto ?? '(sem remoto)'}`,
      tipoDeAutorizacao: autorizacao.tipo,
    });
    registrar(dir, threadId, TIPOS_DE_EVENTO.shipConcluido, {
      de,
      para,
      shaDe,
      shaParaAntes: shaPara,
      mergeSha,
      // RM-037 (fatia 5, A1): a ponta da base vai em campo proprio; o `mergeSha` e o merge que entregou a thread.
      pontaDaBase,
      jaIncorporado,
      remoto: r.remoto,
      shaRemoto: r.shaRemoto,
      pushVerificado: r.pushVerificado,
      fonteDaProva: r.pushVerificado ? `git ls-remote ${remoto} refs/heads/${para}` : null,
      autorizadoPor: autorizacao.por,
      tipoDeAutorizacao: autorizacao.tipo,
      modo: thread.modo,
      tag: tagDoModo(thread.modo),
      evidencia: {
        verificadoNoCommit: verificacao.commit,
        claimsVerificadas: verificacao.claims.filter((c) => c.verificado).map((c) => c.claim.id),
        // I-37 (T9): a mesma evidencia do `verify_run`, com causa, prazo e o teste que caiu.
        comandos: verificacao.comandos.map(comandoNoLedger),
        ci,
        passos,
      },
    });

    publicarEmSegundoPlano(raiz);

    const atualizada = lerThread(raiz, threadId);
    // I-42: ciclo sem SHIP (o `#Fast`) entrega sem trocar de fase; `faseAtual` fica sempre
    // dentro do ciclo, porque board, pulse e prompt resolvem o bloco a partir dela.
    if (!atualizada.fases?.length || atualizada.fases.includes('SHIP')) atualizada.faseAtual = 'SHIP';
    atualizada.leases = [
      ...(atualizada.leases ?? []),
      { nome: LEASE_MAIN_TREE, adquiridoEm: aquisicao.lease?.adquiridoEm ?? agora(), liberadoEm: agora() },
    ];
    gravarThread(raiz, atualizada);

    return { ...r, ok: true, bloqueado: false };
  } finally {
    if (arvore) descartarArvore(raiz, arvore);
    const solto = liberar(raiz, LEASE_MAIN_TREE, threadId);
    registrar(dir, threadId, TIPOS_DE_EVENTO.leaseLiberado, {
      lease: LEASE_MAIN_TREE,
      ok: solto.ok,
      detalhe: solto.detalhe,
    });
  }
}

/** Texto de `ork ship` para o CLI. */
export function textoDoShip(r: ResultadoShip): string {
  const linhas: string[] = [];
  // I-35: horários no fuso do dono, sem rótulo por linha; o fuso é dito uma vez, no fim.
  let comHorario = false;
  const local = (texto: string): string => {
    const localizado = localizarTexto(texto);
    if (localizado !== texto) comHorario = true;
    return localizado;
  };
  const fechar = (): string => (comHorario ? [...linhas, legendaDoFuso()] : linhas).join('\n');
  const cabecalho = r.dryRun ? 'ork ship (--dry-run, nada foi executado)' : 'ork ship';
  linhas.push(`${cabecalho}: thread ${r.thread}`);
  linhas.push(`  de            ${r.de}${r.shaDe ? ` @ ${r.shaDe.slice(0, 8)}` : ''}`);
  linhas.push(`  para          ${r.para}${r.shaParaAntes ? ` @ ${r.shaParaAntes.slice(0, 8)}` : ''}`);
  linhas.push(
    `  autorizacao   ${r.autorizacao.autorizado ? `AUTORIZADO por ${r.autorizacao.por} (${r.autorizacao.tipo})` : 'AGUARDANDO AUTORIZACAO HUMANA'}`
  );
  linhas.push(`                ${local(r.autorizacao.razao)}`);
  if (r.verificacao) {
    const v = r.verificacao;
    linhas.push(
      `  verificacao   ${v.ok ? 'passou' : 'REPROVOU'} no HEAD ${shaCurto(v.commit)} ` +
        `(${v.claims.filter((c) => c.verificado).length}/${v.claims.length} claims, ` +
        `${v.comandos.filter((c) => c.ok).length}/${v.comandos.length} comandos)`
    );
  }
  if (r.ci) {
    linhas.push(
      `  ci            ${r.ci.required ? `${r.ci.state.toUpperCase()} ${r.ci.context} em ${r.ci.sha.slice(0, 8)}` : 'não exigido'}`
    );
  }
  linhas.push(...linhasDeAviso(r.violacoes ?? []));
  if (r.leaseOcupadoPor) {
    comHorario = true;
    linhas.push(
      `  lease         ${LEASE_MAIN_TREE} OCUPADO pela thread ${r.leaseOcupadoPor.thread} (desde ${formatarDataHora(r.leaseOcupadoPor.adquiridoEm)})`
    );
  } else if (r.lease) {
    linhas.push(`  lease         ${LEASE_MAIN_TREE} tomado por ${r.thread} e liberado ao fim`);
  } else if (r.dryRun) {
    linhas.push(`  lease         ${LEASE_MAIN_TREE} livre`);
  }

  if (r.bloqueado) {
    linhas.push('');
    linhas.push(`BLOQUEADO. motivo tipado: ${r.motivo}`);
    linhas.push(`  detalhe   ${local(r.detalhe)}`);
    linhas.push(`  correcao  ${r.correcao}`);
    return fechar();
  }

  if (r.dryRun) {
    linhas.push('');
    linhas.push('Passos que o ship real executaria, nesta ordem:');
    for (const p of r.passos) linhas.push(`  ${p}`);
    return fechar();
  }

  linhas.push('');
  linhas.push(
    r.jaIncorporado
      ? `Nada a mergear: ${r.de} ja estava em ${r.para}, incorporado em ${r.mergeSha}.`
      : `Merge --no-ff concluido: ${r.mergeSha}`
  );
  if (r.pushVerificado) {
    linhas.push(`Push PROVADO: ls-remote de ${r.remoto}/${r.para} devolveu ${r.shaRemoto}`);
    linhas.push(`  e o destino local esta no mesmo sha: ${r.pontaDaBase ?? r.mergeSha}`);
  } else {
    linhas.push(`Push nao provado: ${local(r.detalhe) || 'sem remoto configurado'}`);
  }
  linhas.push('');
  linhas.push('Evidencia (comandos executados):');
  for (const p of r.passos) linhas.push(`  ${p}`);
  linhas.push('');
  linhas.push(`Ledger: ork phase list ${r.thread}  (evento ship_done)`);
  return fechar();
}
