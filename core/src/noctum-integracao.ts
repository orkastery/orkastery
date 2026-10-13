/**
 * RM-058, fatia N3 (D13 da ork-rm058n3): a vez de integrar por destino, válida entre as máquinas de um arco #Noctum.
 *
 * O `main-tree` do `ork ship` é um lease da raiz de estado, e não vale entre máquinas: a página da RM-058 pede coordenação
 * compartilhada, com os HEADs revalidados depois de adquirir o direito de integrar. Aqui a vez é um registro do ramo de
 * coordenação, por arco e destino (repositório e base), tomada por troca atômica com o candidato (branch, fonte, base e o
 * hash das provas). Um integrador por destino: o outro recebe `noctum.integracao.ocupada`.
 *
 * Depois de tomar a vez, a base e a branch são relidas do remoto (`git ls-remote`): base ou fonte diferente do candidato o
 * invalida (`noctum.integracao.base-mudou` ou `noctum.integracao.fonte-mudou`), a vez é solta e as provas se repetem sobre o
 * candidato novo. Logo antes do efeito vêm a conferência da N1 com `merge` e a ordem relida, viva e não cancelada. A função
 * que integra é de quem chama (no teste, merge e push no remoto de fixture; na N5, o caminho do SHIP); o núcleo confere no
 * remoto que a base aponta para o merge e contém a fonte, e grava a entrega e o fim da vez no mesmo commit. Sem essa prova,
 * `noctum.integracao.nao-provada`, e a vez fica até a reconciliação, que acha o merge na base (e registra a entrega sem
 * integrar de novo) ou solta a vez. Um registro de entrega por trabalho: a segunda tentativa recebe `ja-entregue`.
 *
 * A vez é por arco: dois arcos no mesmo destino ao mesmo tempo não se veem por ela (limite dito na página). A vez da
 * máquina que não dá sinal há mais de 15 min é abandonada pela autoridade (A7 da revisão), e o destino volta a andar; na
 * volta, a reconciliação dela registra a entrega se o merge tiver chegado à base, e o trabalho não muda de máquina sem prova.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { branchValida, buscarBranch, git } from './branch-de-estado';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { tentarTravaExclusiva } from './fila-pesada';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { conferirAntesDoEfeito } from './noctum-arco';
import {
  CandidatoDeIntegracao, chaveDoDestino, derivarCoordenacao, EstadoDaCoordenacao, gravarNaCoordenacao, lerCoordenacao, OpcoesDaCoordenacao,
  VezDerivada,
} from './noctum-coordenacao';
import { ID_DO_ARCO, RecusaDoArco } from './noctum-envelope';
import { cabecasNoRemoto, euNaVersaoVigente } from './noctum-transporte';

export interface PedidoDeIntegracao {
  /** A ordem aceita desta máquina para o trabalho que vai ser integrado. */
  ordem: string;
  destino: { repositorio: string; base: string };
  candidato: CandidatoDeIntegracao;
}

/** Quem integra de fato: recebe o destino e o candidato já revalidados e devolve o commit que ficou na base. */
export type Integrador = (c: { remoto: string; destino: { repositorio: string; base: string }; candidato: CandidatoDeIntegracao }) => { merge: string };

export interface IntegracaoFeita { trabalho: string; vez: number; merge: string }

const recusa = (motivo: ConstructorParameters<typeof RecusaDoArco>[0], detalhe: string) => new RecusaDoArco(motivo, detalhe);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v);
const primeiraLinha = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);

/** A trava local da integração do arco: a reconciliação desta máquina não mexe numa vez que um processo dela segura. */
function travaDaIntegracao(raiz: string, arco: string): number | null {
  if (!ID_DO_ARCO.test(arco)) throw recusa('noctum.envelope.invalido', 'identificador de arco inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum', 'arcos', arco]);
  const dir = path.join(principal, '.orkastery', 'noctum', 'arcos', arco);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return tentarTravaExclusiva(path.join(dir, 'integracao.lock'));
}

/** A vez ativa do destino, quando há uma. */
const ativaDo = (estado: EstadoDaCoordenacao, chave: string): VezDerivada | null => estado.vezes.get(chave)?.find(v => !v.fim) ?? null;
const proximaDo = (estado: EstadoDaCoordenacao, chave: string): number => (estado.vezes.get(chave)?.length ?? 0) + 1;

function conferirCandidato(c: CandidatoDeIntegracao): void {
  if (!c || !branchValida(c.branch) || !sha(c.fonte) || !sha(c.base) || typeof c.provas !== 'string' || !/^[0-9a-f]{64}$/.test(c.provas)) {
    throw recusa('noctum.envelope.invalido', 'o candidato traz a branch, a fonte e a base (sha) e o sha256 das provas');
  }
}

/** Grava o fim da vez desta máquina; idempotente. Falha de rede aqui não esconde a recusa que veio antes. */
function encerrarVez(carregado: ManifestoCarregado, arco: string, chave: string, n: number,
  fim: { desfecho: 'invalidado' | 'desistiu'; motivo: string }, opcoes: OpcoesDaCoordenacao): void {
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const vez = derivarCoordenacao(leitura).vezes.get(chave)?.find(v => v.n === n);
    if (!vez || vez.fim) return { novos: [], resultado: null };
    return { novos: [{ tipo: 'vez-fim', chave, n, desfecho: fim.desfecho, motivo: fim.motivo.slice(0, 300).replace(/[\r\n]+/g, ' '), merge: null }], resultado: null };
  });
}

function encerrarSemEsconder(carregado: ManifestoCarregado, arco: string, chave: string, n: number,
  fim: { desfecho: 'invalidado' | 'desistiu'; motivo: string }, opcoes: OpcoesDaCoordenacao): void {
  try { encerrarVez(carregado, arco, chave, n, fim, opcoes); } catch { /* a vez fica ativa até a reconciliação; a recusa original sobe */ }
}

/** A conferência da N1 do merge no destino, com o hash vigente: a janela, a revogação e a permissão (S4 da revisão). */
function conferirMerge(carregado: ManifestoCarregado, arco: string, envelopeSha256: string, destino: { repositorio: string; base: string },
  quando: string | undefined): void {
  conferirAntesDoEfeito(carregado.raiz, { arco, envelopeSha256, acao: 'merge', repositorio: destino.repositorio, branch: destino.base }, quando);
}

/** A revogação gravada no ramo por outra máquina do arco também segura o merge (A8 da revisão). */
function exigirNaoRevogada(estado: EstadoDaCoordenacao): void {
  if (estado.revogada) {
    throw recusa('noctum.coordenacao.revogada', `o arco foi revogado na máquina ${estado.revogada.por}; nenhuma vez nova de integrar sai`);
  }
}

/**
 * Integra o candidato no destino com a vez do arco: confere o envelope (N1, `merge`), toma a vez (troca atômica), relê a
 * base e a fonte do remoto, confere a N1 e a ordem de novo logo antes do efeito, chama `integrar`, prova o merge no remoto e
 * grava a entrega e o fim da vez juntos. Lança a recusa tipada; a vez é solta em toda recusa de antes do efeito.
 */
export function integrarComVez(carregado: ManifestoCarregado, arco: string, pedido: PedidoDeIntegracao, integrar: Integrador,
  opcoes: OpcoesDaCoordenacao = {}): IntegracaoFeita {
  conferirCandidato(pedido.candidato);
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const trava = travaDaIntegracao(carregado.raiz, arco);
  if (trava === null) throw recusa('noctum.integracao.ocupada', 'outro processo desta máquina integra neste arco agora');
  try {
    const chave = chaveDoDestino(pedido.destino);
    // 1. A vez, por troca atômica sobre a leitura nova, depois da conferência da N1 (a janela e a revogação antes de tudo).
    const tomada = gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
      const estado = derivarCoordenacao(leitura);
      const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
      conferirMerge(carregado, arco, vigente.envelopeSha256, pedido.destino, opcoes.quando);
      exigirNaoRevogada(estado);
      const o = estado.ordens.get(pedido.ordem);
      if (!o || o.maquina !== eu.nome || o.estado !== 'aceita') {
        throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${pedido.ordem} não é uma ordem aceita e viva desta máquina`);
      }
      if (o.envelopeSha256 !== vigente.envelopeSha256) throw recusa('noctum.efeito.hash-antigo', `a ordem ${pedido.ordem} é de outra versão do envelope`);
      if (estado.entregas.has(o.trabalho) || estado.trabalhos.get(o.trabalho)?.estado === 'entregue') {
        throw recusa('noctum.integracao.ja-entregue', `o trabalho ${o.trabalho} já foi entregue neste arco; nada é integrado de novo`);
      }
      const destino = vigente.conteudo.destinos.find(d => d.repositorio.toLowerCase() === pedido.destino.repositorio.toLowerCase());
      if (!destino || destino.base !== pedido.destino.base || !destino.permissoes.includes('merge')) {
        throw recusa('noctum.efeito.fora-do-destino', `merge em ${pedido.destino.repositorio}, base ${pedido.destino.base}, fora do envelope`);
      }
      const ativa = ativaDo(estado, chave);
      if (ativa) {
        if (ativa.maquina === eu.nome && ativa.ordem === o.ordem && JSON.stringify(ativa.candidato) === JSON.stringify(pedido.candidato)) {
          return { novos: [], resultado: { n: ativa.n, trabalho: o.trabalho } };
        }
        throw recusa('noctum.integracao.ocupada', `a vez de integrar em ${destino.repositorio}, base ${destino.base}, está com a máquina ${ativa.maquina} ` +
          `(trabalho ${ativa.trabalho}); espere ela soltar e repita as provas sobre a base nova`);
      }
      const n = proximaDo(estado, chave);
      return { novos: [{ tipo: 'vez', chave, n, destino: { repositorio: destino.repositorio, base: destino.base }, ordem: o.ordem,
        trabalho: o.trabalho, candidato: { ...pedido.candidato } }], resultado: { n, trabalho: o.trabalho } };
    }).resultado;
    const { n, trabalho } = tomada;
    // 2. Os HEADs, relidos do remoto depois de ter a vez.
    let cabecas: Map<string, string | null>;
    try { cabecas = cabecasNoRemoto(carregado, [pedido.destino.base, pedido.candidato.branch], opcoes); }
    catch (e) {
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'desistiu', motivo: 'os HEADs não se leram no remoto' }, opcoes);
      throw e;
    }
    const base = cabecas.get(pedido.destino.base) ?? null, fonte = cabecas.get(pedido.candidato.branch) ?? null;
    if (base !== pedido.candidato.base) {
      const motivo = `a base ${pedido.destino.base} está em ${base?.slice(0, 12) ?? 'nada'}, e o candidato foi provado sobre ${pedido.candidato.base.slice(0, 12)}`;
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'invalidado', motivo: `base-mudou: ${motivo}` }, opcoes);
      throw recusa('noctum.integracao.base-mudou', `${motivo}: o candidato foi invalidado; atualize, resolva os conflitos e repita as provas`);
    }
    if (fonte !== pedido.candidato.fonte) {
      const motivo = `a branch ${pedido.candidato.branch} está em ${fonte?.slice(0, 12) ?? 'nada'}, e o candidato é ${pedido.candidato.fonte.slice(0, 12)}`;
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'invalidado', motivo: `fonte-mudou: ${motivo}` }, opcoes);
      throw recusa('noctum.integracao.fonte-mudou', `${motivo}: o candidato foi invalidado; as provas se repetem no SHA novo`);
    }
    // 3. A conferência da N1 e a ordem, logo antes do efeito.
    try {
      const estado = lerCoordenacao(carregado, arco, opcoes);
      conferirMerge(carregado, arco, estado.vigente.envelopeSha256, pedido.destino, opcoes.quando);
      exigirNaoRevogada(estado);
      const o = estado.ordens.get(pedido.ordem);
      const vez = ativaDo(estado, chave);
      if (!o || o.estado !== 'aceita') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${pedido.ordem} deixou de valer (${o?.estado ?? 'sumiu'}) antes do merge`);
      if (!vez || vez.n !== n || vez.maquina !== nomeDaMaquina(opcoes.maquina)) throw recusa('noctum.integracao.ocupada', 'a vez de integrar mudou de mão antes do merge');
    } catch (e) {
      if (e instanceof RecusaDoArco) encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'desistiu', motivo: `${e.motivo} antes do merge` }, opcoes);
      throw e;
    }
    // 4. O efeito. Falha aqui deixa o resultado incerto: a vez fica, e a reconciliação decide pela base.
    let merge: string;
    try { merge = integrar({ remoto, destino: { ...pedido.destino }, candidato: { ...pedido.candidato } }).merge; }
    catch (e) { throw recusa('noctum.integracao.nao-provada', `a integração falhou ou ficou incerta (${primeiraLinha(e)}); a vez fica até a reconciliação`); }
    // 5. A prova no remoto: a base aponta para o merge e o merge contém a fonte.
    const provada = mergeNaBase(carregado, remoto, pedido.destino.base, pedido.candidato.fonte, opcoes);
    if (!provada || provada !== merge) {
      throw recusa('noctum.integracao.nao-provada', `a base ${pedido.destino.base} não aponta para o merge ${String(merge).slice(0, 12)} com a fonte; a vez fica até a reconciliação`);
    }
    registrarEntrega(carregado, arco, { chave, n, trabalho, ordem: pedido.ordem, destino: pedido.destino, fonte: pedido.candidato.fonte,
      base: pedido.candidato.base, merge }, opcoes);
    return { trabalho, vez: n, merge };
  } finally { fs.closeSync(trava); }
}

/**
 * A cabeça da base no remoto quando ela contém a fonte; `null` quando não contém, ou quando a base não se lê. Busca a base
 * antes, para o `merge-base` ter os objetos.
 */
function mergeNaBase(carregado: ManifestoCarregado, remoto: string, base: string, fonte: string, opcoes: OpcoesDaCoordenacao): string | null {
  let lida: { ponta: string | null; atualizado: boolean };
  try { lida = buscarBranch(carregado.raiz, remoto, base, 'noctum', opcoes.rede?.timeoutMs, opcoes.rede?.env); } catch { return null; }
  if (!lida.atualizado || !lida.ponta) return null;
  return git(carregado.raiz, ['merge-base', '--is-ancestor', fonte, lida.ponta]).ok ? lida.ponta : null;
}

/** A entrega e o fim da vez no mesmo commit. Vale também com a ordem cancelada depois do merge: é a conta do que já foi feito. */
function registrarEntrega(carregado: ManifestoCarregado, arco: string, e: { chave: string; n: number; trabalho: string; ordem: string;
  destino: { repositorio: string; base: string }; fonte: string; base: string; merge: string }, opcoes: OpcoesDaCoordenacao): void {
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const vez = estado.vezes.get(e.chave)?.find(v => v.n === e.n);
    const ja = estado.entregas.get(e.trabalho);
    const novos = [];
    if (!ja) novos.push({ tipo: 'entrega' as const, trabalho: e.trabalho, ordem: e.ordem, destino: { ...e.destino }, fonte: e.fonte, base: e.base, merge: e.merge });
    if (vez && !vez.fim) novos.push({ tipo: 'vez-fim' as const, chave: e.chave, n: e.n, desfecho: 'entregue', motivo: 'merge provado no remoto', merge: e.merge });
    return { novos, resultado: null };
  });
}

export interface ReconciliacaoDaIntegracao {
  /** As vezes desta máquina cuja fonte já estava na base: a entrega foi registrada sem integrar de novo. */
  registradas: Array<{ trabalho: string; merge: string }>;
  /** As vezes soltas porque a fonte não chegou à base. */
  soltas: string[];
  /** As vezes que um processo desta máquina ainda segura. */
  emCurso: string[];
  /**
   * As vezes desta máquina abandonadas pela autoridade, sem entrega, cuja base se leu agora sem a fonte (`chave/n`): só a
   * ordem com todas elas conferidas pode terminar (A7 da revisão). Sem essa leitura, o merge pode ter chegado à base.
   */
  abandonadasConferidas: string[];
}

/**
 * A reconciliação das vezes desta máquina que ninguém daqui segura: a fonte na base vira entrega registrada (sem integrar
 * de novo); fora dela, a vez é solta e o candidato terá de ser provado de novo. Sem leitura da base, a vez fica. A vez que a
 * autoridade abandonou passa pela mesma conferência: a fonte na base vira a entrega que faltava.
 */
export function reconciliarIntegracao(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): ReconciliacaoDaIntegracao {
  const r: ReconciliacaoDaIntegracao = { registradas: [], soltas: [], emCurso: [], abandonadasConferidas: [] };
  const eu = nomeDaMaquina(opcoes.maquina);
  const estado = lerCoordenacao(carregado, arco, opcoes);
  const todas = [...estado.vezes.values()].flat().filter(v => v.maquina === eu);
  const minhas = todas.filter(v => !v.fim);
  const abandonadas = todas.filter(v => v.fim?.desfecho === 'abandonada' && !estado.entregas.has(v.trabalho) &&
    ['aceita', 'isolada'].includes(estado.ordens.get(v.ordem)?.estado ?? ''));
  if (!minhas.length && !abandonadas.length) return r;
  const trava = travaDaIntegracao(carregado.raiz, arco);
  if (trava === null) { r.emCurso.push(...[...minhas, ...abandonadas].map(v => `${v.chave}/${v.n}`)); return r; }
  try {
    const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
    for (const v of [...minhas, ...abandonadas]) {
      const naBase = mergeNaBase(carregado, remoto, v.destino.base, v.candidato.fonte, opcoes);
      if (naBase) {
        registrarEntrega(carregado, arco, { chave: v.chave, n: v.n, trabalho: v.trabalho, ordem: v.ordem, destino: v.destino,
          fonte: v.candidato.fonte, base: v.candidato.base, merge: naBase }, opcoes);
        r.registradas.push({ trabalho: v.trabalho, merge: naBase });
        continue;
      }
      if (!cabecaDaBaseLida(carregado, remoto, v.destino.base, opcoes)) continue;
      if (v.fim) { r.abandonadasConferidas.push(`${v.chave}/${v.n}`); continue; }
      encerrarVez(carregado, arco, v.chave, v.n, { desfecho: 'desistiu', motivo: 'reconciliação: a fonte não está na base; o candidato será provado de novo' }, opcoes);
      r.soltas.push(`${v.chave}/${v.n}`);
    }
  } finally { fs.closeSync(trava); }
  return r;
}

/** A base se lê no remoto agora? Sem leitura, a reconciliação não solta a vez: não sabe se o merge chegou. */
function cabecaDaBaseLida(carregado: ManifestoCarregado, remoto: string, base: string, opcoes: OpcoesDaCoordenacao): boolean {
  try { return !!cabecasNoRemoto(carregado, [base], { ...opcoes, remoto }).get(base); } catch { return false; }
}
