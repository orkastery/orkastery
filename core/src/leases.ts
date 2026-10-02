/**
 * Leases de exclusao mutua entre threads (`.orkastery/leases/<nome>.json`).
 *
 * O lease `main-tree` serializa o SHIP: com N threads paralelas, so uma mergeia por vez.
 * A aquisicao e atomica de verdade (`open` com flag `wx`, que falha se o arquivo existe),
 * nao um "checa e depois escreve" que perde a corrida.
 *
 * O lease tem TTL: sessao morta nao pode travar a fila para sempre. Um lease vencido e
 * tomado, e a tomada vai ao ledger da thread que tomou, com quem estava segurando.
 *
 * Bloco B2: alem do `main-tree`, existem as familias `worktree-write:<thread>`,
 * `path:<glob>`, `board:<card>` e `service:<porta>`, e uma FILA por colisao. Duas threads
 * que pedem a mesma regiao de path nao brigam: a segunda entra na fila em FIFO e recebe
 * o motivo tipado `lease.busy` com a correcao acionavel.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirEstado } from './manifest';
import { raizDoEstado } from './estado-thread';
import { Lease, PedidoNaFila, TipoDeLease } from './types';
import { agora } from './util';
import { formatarDataHora, formatarDesde, legendaDoFuso } from './horario';
import { conducaoDoLease, linhaDeConducao } from './conducao-texto';
import { registrarSeExiste, TIPOS_DE_EVENTO } from './ledger';
import { dirThread, lerThread } from './thread';

/** Nome do lease que serializa o merge na base (visao, paridade 5). */
export const LEASE_MAIN_TREE = 'main-tree';

/** TTL padrao de 30 minutos: um SHIP que passe disso deixou de existir. */
export const TTL_PADRAO_MS = 30 * 60 * 1000;

/** As familias de lease do B2, com o que cada uma protege. */
export const FAMILIAS_DE_LEASE: Readonly<Record<TipoDeLease, string>> = {
  'main-tree': 'a arvore que tem a branch base em check-out (serializa o merge)',
  'worktree-write': 'a escrita na worktree de uma thread',
  path: 'uma regiao de arquivos por glob (colisao entre threads paralelas)',
  board: 'um card do board, para duas threads nao pegarem o mesmo cartao',
  service: 'uma porta de servico local, para dois runs nao subirem no mesmo lugar',
  exec: 'a EXECUCAO na worktree de uma thread (I-36): um condutor por vez, em qualquer canal',
};

/** I-36 (D1): prefixo da familia de execucao, `exec:<thread>`. */
export const PREFIXO_EXEC = 'exec';

/** Diretorio dos leases do projeto. */
export function dirLeases(raiz: string): string {
  return path.join(dirEstado(raiz), 'leases');
}

/**
 * I-36: o lease de execucao mora no estado CANONICO do projeto (o mesmo das threads), nunca no
 * checkout de quem chamou. Um canal que roda da raiz e outro que roda de uma worktree disputam o
 * mesmo arquivo; com o diretorio do checkout, cada um teria o seu e os dois executariam juntos.
 */
export function dirLeasesDeExecucao(raiz: string): string {
  return path.join(dirEstado(raizDoEstado(raiz)), 'leases');
}

/**
 * Nome canonico de um lease de familia tipada: `path:core/src/**`, `service:5173`.
 * `main-tree` nao tem alvo: e um so no projeto.
 */
export function nomeDeLease(tipo: TipoDeLease, alvo?: string): string {
  if (tipo === 'main-tree') return LEASE_MAIN_TREE;
  const limpo = (alvo ?? '').trim();
  if (!limpo) throw new Error(`lease ${tipo} exige um alvo (ex.: ${tipo}:<alvo>)`);
  return `${tipo}:${limpo}`;
}

/** Familia de um nome de lease. Nome fora do catalogo cai em `path` por seguranca. */
export function tipoDoLease(nome: string): TipoDeLease {
  if (nome === LEASE_MAIN_TREE) return 'main-tree';
  const prefixo = nome.split(':')[0];
  if (prefixo === 'worktree-write' || prefixo === 'path' || prefixo === 'board' || prefixo === 'service' ||
      prefixo === PREFIXO_EXEC) {
    return prefixo;
  }
  return 'path';
}

/** Alvo de um lease tipado (o que vem depois dos dois pontos). */
export function alvoDoLease(nome: string): string {
  const corte = nome.indexOf(':');
  return corte < 0 ? '' : nome.slice(corte + 1);
}

/**
 * Caminho do arquivo de um lease. O nome canonico tem `:`, `/` e `*`, entao ele e
 * codificado para virar um nome de arquivo unico e reversivel. `main-tree` fica
 * inalterado, o que preserva os leases gravados pelo bloco B1.
 */
export function caminhoLease(raiz: string, nome: string): string {
  const dir = tipoDoLease(nome) === 'exec' ? dirLeasesDeExecucao(raiz) : dirLeases(raiz);
  return path.join(dir, `${encodeURIComponent(nome)}.json`);
}

/**
 * I-36 (D3): regrava um lease que a propria operacao segura (renovacao do prazo e conversao do
 * dono), por arquivo temporario e rename: quem le nunca ve o arquivo pela metade.
 */
export function regravarLease(raiz: string, lease: Lease): void {
  const caminho = caminhoLease(raiz, lease.nome);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(lease, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporario, caminho);
}

/** Le o lease em disco. Arquivo corrompido conta como lease ausente. */
export function lerLease(raiz: string, nome: string): Lease | null {
  const caminho = caminhoLease(raiz, nome);
  if (!fs.existsSync(caminho)) return null;
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8')) as Lease;
  } catch {
    return null;
  }
}

/** O lease venceu? */
export function expirado(lease: Lease, referencia: Date = new Date()): boolean {
  const fim = Date.parse(lease.expiraEm);
  return Number.isFinite(fim) ? fim <= referencia.getTime() : true;
}

// ---------------------------------------------------------------------------
// Colisao de regiao: glob para regex, e a pergunta "estes dois globs se cruzam?".
// ---------------------------------------------------------------------------

/** Converte um glob de path (`*`, `**`, `?`) na regex equivalente. */
export function globParaRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` atravessa quantos segmentos vierem; `**/` consome a propria barra.
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** O caminho concreto cai dentro do glob? */
export function caminhoBateComGlob(caminho: string, glob: string): boolean {
  return globParaRegex(glob).test(caminho);
}

/** Parte literal do glob, antes do primeiro curinga. */
function prefixoLiteral(glob: string): string {
  const corte = glob.search(/[*?]/);
  return corte < 0 ? glob : glob.slice(0, corte);
}

/** `a` e prefixo de `b` numa fronteira de caminho (evita casar `core/s` com `core/src`). */
function prefixoDeCaminho(a: string, b: string): boolean {
  if (a === '') return false;
  if (!b.startsWith(a)) return false;
  return a.length === b.length || a.endsWith('/') || b[a.length] === '/';
}

/**
 * Dois globs disputam a mesma regiao?
 *
 * Conservador de proposito: na duvida o `ork` prefere serializar duas threads a deixar
 * as duas escreverem no mesmo lugar. Falso positivo custa espera; falso negativo custa
 * conflito de merge no meio do GO.
 */
export function globsColidem(a: string, b: string): boolean {
  if (a === b) return true;
  if (globParaRegex(a).test(b) || globParaRegex(b).test(a)) return true;
  const pa = prefixoLiteral(a);
  const pb = prefixoLiteral(b);
  return prefixoDeCaminho(pa, pb) || prefixoDeCaminho(pb, pa);
}

/**
 * Dois nomes de lease colidem?
 *
 * Familias diferentes nunca colidem. Dentro da familia `path` vale a colisao de glob;
 * nas demais familias o alvo e discreto (uma thread, um card, uma porta) e a colisao
 * e a igualdade exata.
 */
export function leasesColidem(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = tipoDoLease(a);
  const tb = tipoDoLease(b);
  if (ta !== tb) return false;
  if (ta === 'path') return globsColidem(alvoDoLease(a), alvoDoLease(b));
  return false;
}

// ---------------------------------------------------------------------------
// Aquisicao, liberacao e leitura.
// ---------------------------------------------------------------------------

export interface ResultadoDeAquisicao {
  ok: boolean;
  lease: Lease | null;
  /** Preenchido quando o lease ja estava tomado por outra thread. */
  ocupadoPor: Lease | null;
  /** True quando um lease vencido foi tomado desta thread. */
  tomadoDeVencido: boolean;
}

export interface OpcoesDeLease {
  /** Quando false, EEXIST nunca remove lease vencida/corrompida. Default legado: retomar. */
  retomarVencido?: boolean;
  thread: string;
  motivo: string;
  ttlMs?: number;
}

/**
 * Adquire o lease. Retorna `ok: false` com `ocupadoPor` quando outra thread o segura,
 * em vez de esperar: quem decide esperar ou desistir e a fila (`adquirirRegiao`).
 */
export function adquirir(raiz: string, nome: string, opcoes: OpcoesDeLease): ResultadoDeAquisicao {
  const caminho = caminhoLease(raiz, nome);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const ttl = opcoes.ttlMs ?? TTL_PADRAO_MS;
  const lease: Lease = {
    nome,
    thread: opcoes.thread,
    motivo: opcoes.motivo,
    pid: process.pid,
    adquiridoEm: agora(),
    expiraEm: new Date(Date.now() + ttl).toISOString(),
  };
  const corpo = JSON.stringify(lease, null, 2) + '\n';

  for (const tentativa of [1, 2]) {
    try {
      // `wx` falha se o arquivo existe: e a atomicidade do lease, sem corrida.
      fs.writeFileSync(caminho, corpo, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, lease, ocupadoPor: null, tomadoDeVencido: tentativa === 2 };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const atual = lerLease(raiz, nome);
      if (opcoes.retomarVencido === false || (atual && !expirado(atual))) {
        return { ok: false, lease: null, ocupadoPor: atual, tomadoDeVencido: false };
      }
      // Lease vencido ou corrompido: remove e tenta uma unica vez mais.
      try {
        fs.unlinkSync(caminho);
      } catch {
        /* outra thread removeu antes; a segunda tentativa decide */
      }
    }
  }
  const atual = lerLease(raiz, nome);
  return { ok: false, lease: null, ocupadoPor: atual, tomadoDeVencido: false };
}

/**
 * Libera o lease. Sem `forcar`, so a thread que o segura pode liberar: liberar o lease
 * dos outros e exatamente o bug que o lease existe para impedir.
 */
export function liberar(
  raiz: string,
  nome: string,
  thread: string,
  forcar = false
): { ok: boolean; detalhe: string } {
  const atual = lerLease(raiz, nome);
  if (!atual) {
    sairDaFila(raiz, nome, thread);
    return { ok: true, detalhe: `lease ${nome} ja estava livre` };
  }
  if (atual.thread !== thread && !forcar) {
    return {
      ok: false,
      detalhe: `lease ${nome} pertence a thread ${atual.thread}; use --forcar para tomar`,
    };
  }
  fs.unlinkSync(caminhoLease(raiz, nome));
  sairDaFila(raiz, nome, atual.thread);
  const proximo = proximoDaFila(raiz, nome);
  const seguinte = proximo ? `; proximo da fila: thread ${proximo.thread}` : '';
  return { ok: true, detalhe: `lease ${nome} liberado${seguinte}` };
}

/** Todos os leases existentes no projeto, pelo nome canonico gravado no arquivo. */
export function listarLeases(raiz: string): Lease[] {
  const leases: Lease[] = [];
  const ler = (dir: string, soExecucao: boolean): void => {
    if (!fs.existsSync(dir)) return;
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('.json') || arquivo === NOME_ARQUIVO_FILA) continue;
      try {
        const lease = JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8')) as Lease;
        if (!lease || typeof lease.nome !== 'string') continue;
        if (soExecucao && tipoDoLease(lease.nome) !== 'exec') continue;
        leases.push(lease);
      } catch {
        /* arquivo corrompido conta como lease ausente */
      }
    }
  };
  // I-36: os do checkout, mais os de execucao do estado canonico quando ele e outro diretorio.
  const local = dirLeases(raiz), canonico = dirLeasesDeExecucao(raiz);
  const real = (dir: string): string => (fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir));
  ler(local, false);
  if (real(local) !== real(canonico)) ler(canonico, true);
  return leases.sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Leases ativos (nao vencidos) que colidem com o nome pedido. */
export function leasesColidentes(raiz: string, nome: string, thread?: string): Lease[] {
  return listarLeases(raiz).filter(
    (l) => !expirado(l) && l.thread !== thread && leasesColidem(nome, l.nome)
  );
}

/** Leases ativos segurados por uma thread. */
export function leasesDaThread(raiz: string, thread: string): Lease[] {
  return listarLeases(raiz).filter((l) => l.thread === thread && !expirado(l));
}

// ---------------------------------------------------------------------------
// Fila por colisao.
// ---------------------------------------------------------------------------

/** Arquivo da fila de espera, ao lado dos leases. */
export const NOME_ARQUIVO_FILA = 'fila.json';

/** Caminho da fila de espera do projeto. */
export function caminhoFila(raiz: string): string {
  return path.join(dirLeases(raiz), NOME_ARQUIVO_FILA);
}

/** Le a fila inteira, em ordem FIFO. Arquivo corrompido conta como fila vazia. */
export function lerFila(raiz: string): PedidoNaFila[] {
  const caminho = caminhoFila(raiz);
  if (!fs.existsSync(caminho)) return [];
  try {
    const dados = JSON.parse(fs.readFileSync(caminho, 'utf8')) as PedidoNaFila[];
    return Array.isArray(dados) ? dados.sort((a, b) => a.desdeEm.localeCompare(b.desdeEm)) : [];
  } catch {
    return [];
  }
}

function gravarFila(raiz: string, fila: PedidoNaFila[]): void {
  const caminho = caminhoFila(raiz);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(fila, null, 2) + '\n', 'utf8');
}

/** Coloca o pedido na fila (idempotente por thread e nome). Devolve a posicao, 1 = proxima. */
export function enfileirar(
  raiz: string,
  nome: string,
  dados: { thread: string; motivo: string; colidiuCom: string; bloqueadaPor: string }
): number {
  const fila = lerFila(raiz);
  const jaEsta = fila.find((p) => p.nome === nome && p.thread === dados.thread);
  if (!jaEsta) {
    fila.push({
      nome,
      tipo: tipoDoLease(nome),
      thread: dados.thread,
      motivo: dados.motivo,
      desdeEm: agora(),
      colidiuCom: dados.colidiuCom,
      bloqueadaPor: dados.bloqueadaPor,
    });
    gravarFila(raiz, fila);
  }
  return posicaoNaFila(raiz, nome, dados.thread);
}

/** Tira a thread da fila do lease informado. */
export function sairDaFila(raiz: string, nome: string, thread: string): void {
  const fila = lerFila(raiz);
  const restante = fila.filter((p) => !(p.nome === nome && p.thread === thread));
  if (restante.length !== fila.length) gravarFila(raiz, restante);
}

/** Espera da regiao: pedidos na fila cujo nome colide com o nome informado, em FIFO. */
export function esperandoPor(raiz: string, nome: string): PedidoNaFila[] {
  return lerFila(raiz).filter((p) => leasesColidem(nome, p.nome));
}

/** Posicao da thread na fila da regiao (1 = proxima da vez, 0 = fora da fila). */
export function posicaoNaFila(raiz: string, nome: string, thread: string): number {
  const espera = esperandoPor(raiz, nome);
  const i = espera.findIndex((p) => p.thread === thread && p.nome === nome);
  return i < 0 ? 0 : i + 1;
}

/** Quem esta na frente da fila desta regiao. */
export function proximoDaFila(raiz: string, nome: string): PedidoNaFila | null {
  return esperandoPor(raiz, nome)[0] ?? null;
}

export interface ResultadoDeRegiao extends ResultadoDeAquisicao {
  nome: string;
  tipo: TipoDeLease;
  /** True quando a thread ficou na fila em vez de adquirir. */
  esperando: boolean;
  /** 1 = proxima da vez. 0 quando adquiriu. */
  posicaoNaFila: number;
  /** Lease ativo que barrou o pedido (pode ser de outro glob que cruza a regiao). */
  colidiuCom: Lease | null;
  motivo: 'lease.busy' | null;
  detalhe: string;
  correcao: string;
}

/**
 * Adquire uma regiao com fila: se algo colidente estiver ativo, a thread ENTRA NA FILA
 * e recebe `lease.busy` com correcao acionavel, em vez de escrever por cima.
 *
 * A ordem e FIFO pela entrada na fila: quem chegou antes leva, mesmo que a outra thread
 * tente de novo primeiro. Sem isso a fila vira loteria e a thread azarada nunca entra.
 */
export function adquirirRegiao(
  raiz: string,
  nome: string,
  opcoes: OpcoesDeLease
): ResultadoDeRegiao {
  const tipo = tipoDoLease(nome);
  const base = { nome, tipo, lease: null, ocupadoPor: null, tomadoDeVencido: false };
  // A poda e limpeza de estado alheio: erro de E/S nela nunca impede a thread viva de pedir a regiao
  // (achado A1 do CHECK 1); o que nao saiu agora sai no proximo pedido.
  try { podarThreadsFechadas(raiz, nome, opcoes.thread); } catch { /* a regra de colisao abaixo decide */ }

  const colidentes = leasesColidentes(raiz, nome, opcoes.thread);
  if (colidentes.length > 0) {
    const dono = colidentes[0];
    const posicao = enfileirar(raiz, nome, {
      thread: opcoes.thread,
      motivo: opcoes.motivo,
      colidiuCom: dono.nome,
      bloqueadaPor: dono.thread,
    });
    return {
      ...base,
      ok: false,
      ocupadoPor: dono,
      esperando: true,
      posicaoNaFila: posicao,
      colidiuCom: dono,
      motivo: 'lease.busy',
      detalhe:
        `a regiao "${nome}" colide com "${dono.nome}", que esta com a thread ${dono.thread} ` +
        `desde ${dono.adquiridoEm}`,
      correcao:
        `espere a thread ${dono.thread} liberar (posicao ${posicao} na fila), ` +
        `ou reduza o glob da sua regiao, ou libere com: ork lease release "${dono.nome}" --forcar`,
    };
  }

  // Fila vazia para a regiao? Entao adquire. Se ha fila e a vez nao e desta thread,
  // ela espera: e isso que impede a thread que chega depois de furar a fila.
  const espera = esperandoPor(raiz, nome);
  if (espera.length > 0 && espera[0].thread !== opcoes.thread) {
    const frente = espera[0];
    const posicao = enfileirar(raiz, nome, {
      thread: opcoes.thread,
      motivo: opcoes.motivo,
      colidiuCom: frente.nome,
      bloqueadaPor: frente.thread,
    });
    return {
      ...base,
      ok: false,
      ocupadoPor: null,
      esperando: true,
      posicaoNaFila: posicao,
      colidiuCom: null,
      motivo: 'lease.busy',
      detalhe: `a thread ${frente.thread} esta na frente da fila da regiao "${frente.nome}"`,
      correcao: `espere a vez (posicao ${posicao} na fila) ou veja a fila com: ork lease list`,
    };
  }

  const r = adquirir(raiz, nome, opcoes);
  if (!r.ok) {
    const dono = r.ocupadoPor;
    const posicao = enfileirar(raiz, nome, {
      thread: opcoes.thread,
      motivo: opcoes.motivo,
      colidiuCom: nome,
      bloqueadaPor: dono?.thread ?? '(desconhecida)',
    });
    return {
      ...base,
      ok: false,
      ocupadoPor: dono,
      esperando: true,
      posicaoNaFila: posicao,
      colidiuCom: dono,
      motivo: 'lease.busy',
      detalhe: `o lease "${nome}" esta com a thread ${dono?.thread ?? '(desconhecida)'}`,
      correcao: `espere a vez (posicao ${posicao} na fila) ou: ork lease release "${nome}" --forcar`,
    };
  }
  sairDaFila(raiz, nome, opcoes.thread);
  return {
    ...base,
    ok: true,
    lease: r.lease,
    tomadoDeVencido: r.tomadoDeVencido,
    esperando: false,
    posicaoNaFila: 0,
    colidiuCom: null,
    motivo: null,
    detalhe: `lease ${nome} adquirido pela thread ${opcoes.thread}`,
    correcao: '',
  };
}

/** Texto de `ork lease list`: leases ativos, familias e a fila por colisao. */
export function tabelaDeLeases(raiz: string): string {
  const leases = listarLeases(raiz);
  const fila = lerFila(raiz);
  const linhas: string[] = ['Leases do projeto', ''];

  if (leases.length === 0) {
    linhas.push('  Nenhum lease tomado. O merge na base esta liberado.');
  } else {
    for (const l of leases) {
      const situacao = expirado(l) ? 'VENCIDO (tomavel)' : 'ativo';
      linhas.push(
        `  ${l.nome.padEnd(28)} [${tipoDoLease(l.nome)}] thread ${l.thread.padEnd(18)} ${situacao}`
      );
      linhas.push(`    desde ${formatarDataHora(l.adquiridoEm)} ate ${formatarDataHora(l.expiraEm)} (pid ${l.pid})`);
      linhas.push(`    motivo: ${l.motivo}`);
      // I-36: o lease de execucao diz quem conduz, com a mesma linha das outras superficies.
      const conducao = conducaoDoLease(l);
      if (conducao) linhas.push(`    ${linhaDeConducao(conducao)}`);
    }
  }

  linhas.push('');
  const merge = fila.filter((p) => p.tipo === 'main-tree');
  const regiao = fila.filter((p) => p.tipo !== 'main-tree');
  linhas.push(`Fila de merge (lease ${LEASE_MAIN_TREE}): ${merge.length === 0 ? 'vazia' : `${merge.length} na espera`}`);
  merge.forEach((p, i) => {
    linhas.push(`  ${i + 1}. thread ${p.thread} desde ${formatarDesde(p.desdeEm)} (bloqueada por ${p.bloqueadaPor})`);
  });
  linhas.push(`Fila por colisao de regiao: ${regiao.length === 0 ? 'vazia' : `${regiao.length} na espera`}`);
  regiao.forEach((p, i) => {
    linhas.push(
      `  ${i + 1}. thread ${p.thread} quer ${p.nome}, colide com ${p.colidiuCom} ` +
        `(thread ${p.bloqueadaPor}) desde ${formatarDesde(p.desdeEm)}`
    );
  });
  if (leases.length > 0 || fila.length > 0) linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// RM-037 (rm037noite, defeito 2): thread fechada nao segura regiao nem fila.
// ---------------------------------------------------------------------------

/**
 * Thread fechada nesta maquina? So `status: fechada` conta: thread que nao existe aqui (outro
 * perfil, estado apagado) segue contando, porque ninguem prova que ela acabou.
 */
function threadFechada(raiz: string, thread: string): boolean {
  try { return lerThread(raiz, thread).status === 'fechada'; } catch { return false; }
}

/**
 * Tira da thread os leases de escrita e as entradas dela na fila. O `exec:` fica de fora: a
 * conducao tem ciclo proprio e ja trata thread fechada como sem conducao.
 */
export function soltarDaThread(raiz: string, thread: string): { leases: string[]; fila: string[] } {
  const leases: string[] = [];
  for (const lease of listarLeases(raiz)) {
    if (lease.thread !== thread || tipoDoLease(lease.nome) === 'exec') continue;
    // Achado A2 do CHECK 1: rele logo antes de apagar. Outra poda pode ter soltado este lease e uma
    // thread viva pode ter adquirido o mesmo nome no meio; apagar pelo caminho da listagem levaria o
    // lease dela. So sai o arquivo que ainda e o da thread fechada, com o mesmo carimbo.
    const atual = lerLease(raiz, lease.nome);
    if (!atual || atual.thread !== thread || atual.adquiridoEm !== lease.adquiridoEm) continue;
    try {
      fs.unlinkSync(caminhoLease(raiz, lease.nome));
      leases.push(lease.nome);
    } catch { /* outra limpeza chegou antes */ }
  }
  const fila = lerFila(raiz);
  const dela = fila.filter((p) => p.thread === thread);
  if (dela.length > 0) gravarFila(raiz, fila.filter((p) => p.thread !== thread));
  return { leases, fila: dela.map((p) => p.nome) };
}

/**
 * Solta o que a thread fechada deixou e registra no ledger dela: `lease_released` por lease e
 * `lease_dequeued` por entrada de fila, com a origem (o fechamento ou a poda de quem pediu a regiao).
 */
export function soltarThreadFechada(raiz: string, thread: string,
  origem: 'fechamento' | 'poda', pedidaPor?: string): { leases: string[]; fila: string[] } {
  const solto = soltarDaThread(raiz, thread);
  const dir = dirThread(raiz, thread);
  const quem = pedidaPor ? { pedidaPor } : {};
  for (const lease of solto.leases) {
    registrarSeExiste(dir, thread, TIPOS_DE_EVENTO.leaseLiberado,
      { lease, ok: true, detalhe: 'thread fechada: lease solto', origem, ...quem });
  }
  for (const lease of solto.fila) {
    registrarSeExiste(dir, thread, TIPOS_DE_EVENTO.leaseDesenfileirado,
      { lease, detalhe: 'thread fechada: saiu da fila', origem, ...quem });
  }
  return solto;
}

/**
 * Antes de decidir a vez, quem pede a regiao tira da frente o que e de thread ja fechada: o lease
 * colidente e a espera na fila. E a cura do que ficou preso antes de o fechamento soltar sozinho
 * (a ork-companybrai3, fechada, na frente da fila de `path:docs/roadmap/README.md`).
 */
function podarThreadsFechadas(raiz: string, nome: string, quem: string): void {
  const suspeitas = new Set([
    ...listarLeases(raiz).filter((l) => leasesColidem(nome, l.nome)).map((l) => l.thread),
    ...esperandoPor(raiz, nome).map((p) => p.thread),
  ]);
  suspeitas.delete(quem);
  for (const thread of suspeitas) {
    if (threadFechada(raiz, thread)) soltarThreadFechada(raiz, thread, 'poda', quem);
  }
}

/**
 * RM-037 (fatia 3, defeito 4): a mesma poda, para as conferencias previas do MCP. O `ork_git_commit`
 * conferia `lerLease` antes do `adquirirRegiao` e recusava com `lease.busy` o lease que a ork-companybrai3
 * (fechada) deixou, e soltar o lease de outra thread exigia o dono. Lease e fila de thread fechada sao
 * orfaos: saem aqui, com registro no ledger dela. Lease de thread aberta, vencido ou nao, e o da propria
 * thread seguem como estao, e a conferencia de quem chama decide. De melhor esforco, como no `adquirirRegiao`.
 */
export function podarRegioesDeThreadsFechadas(raiz: string, nomes: readonly string[], quem: string): void {
  for (const nome of nomes) {
    try { podarThreadsFechadas(raiz, nome, quem); } catch { /* a conferencia de quem chama decide */ }
  }
}
