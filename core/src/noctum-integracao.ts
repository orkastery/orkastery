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
 * que integra é de quem chama (no teste, merge e push no remoto de fixture; na N5, o caminho do SHIP), e o contrato dela é
 * a cerca da base: o merge tem a base provada como primeiro pai (ou é a própria fonte, por avanço rápido), com push sem
 * força, e o push de quem perdeu a vez é recusado se outro integrou. O núcleo confere no remoto que a fonte entrou na base
 * por esse merge e grava a entrega e o fim da vez no mesmo commit. A fonte que entrou por um merge fora da base provada
 * nunca vira entrega: `noctum.integracao.base-nao-provada`, e o trabalho espera a inspeção, sem ser refeito em outra
 * máquina. Sem a fonte na base, `noctum.integracao.nao-provada`, e a vez fica até a reconciliação, que acha o merge provado
 * na base (e registra a entrega sem integrar de novo) ou solta a vez. Um registro de entrega por trabalho: a segunda
 * tentativa recebe `ja-entregue`.
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

/**
 * Quem integra de fato: recebe o destino e o candidato já revalidados e devolve o commit que ficou na base. O contrato é a
 * cerca da base (B-R2A-1 da rodada 2): o merge tem `candidato.base` como primeiro pai e a fonte como segundo, ou é a própria
 * `candidato.fonte` (avanço rápido), e vai à base por push sem força. O merge sobre a base de agora, como o botão de uma
 * forja faria, não é provado e não vira entrega.
 */
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

/**
 * O candidato conferido e reduzido aos quatro campos do contrato (B1 da rodada 2): o campo a mais que quem chama trouxer
 * nunca vai ao ramo, onde o leitor o reprovaria.
 */
function conferirCandidato(c: CandidatoDeIntegracao): CandidatoDeIntegracao {
  if (!c || !branchValida(c.branch) || !sha(c.fonte) || !sha(c.base) || typeof c.provas !== 'string' || !/^[0-9a-f]{64}$/.test(c.provas)) {
    throw recusa('noctum.envelope.invalido', 'o candidato traz a branch, a fonte e a base (sha) e o sha256 das provas');
  }
  return { branch: c.branch, fonte: c.fonte, base: c.base, provas: c.provas };
}

/** O destino do pedido, só com o repositório e a base: o resto (as permissões do envelope, por exemplo) não vai ao ramo. */
function conferirDestino(d: { repositorio: string; base: string }): { repositorio: string; base: string } {
  if (!d || typeof d.repositorio !== 'string' || !d.repositorio || typeof d.base !== 'string' || !d.base) {
    throw recusa('noctum.envelope.invalido', 'o destino traz o repositório e a base');
  }
  return { repositorio: d.repositorio, base: d.base };
}

const mesmoCandidato = (a: CandidatoDeIntegracao, b: CandidatoDeIntegracao): boolean =>
  a.branch === b.branch && a.fonte === b.fonte && a.base === b.base && a.provas === b.provas;

/** Grava o fim da vez desta máquina; idempotente. Falha de rede aqui não esconde a recusa que veio antes. */
function encerrarVez(carregado: ManifestoCarregado, arco: string, chave: string, n: number,
  fim: { desfecho: 'invalidado' | 'desistiu' | 'sem-prova'; motivo: string; merge?: string }, opcoes: OpcoesDaCoordenacao): void {
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const vez = derivarCoordenacao(leitura).vezes.get(chave)?.find(v => v.n === n);
    if (!vez || vez.fim) return { novos: [], resultado: null };
    return { novos: [{ tipo: 'vez-fim', chave, n, desfecho: fim.desfecho, motivo: fim.motivo.slice(0, 300).replace(/[\r\n]+/g, ' '),
      merge: fim.merge ?? null }], resultado: null };
  });
}

function encerrarSemEsconder(carregado: ManifestoCarregado, arco: string, chave: string, n: number,
  fim: { desfecho: 'invalidado' | 'desistiu' | 'sem-prova'; motivo: string; merge?: string }, opcoes: OpcoesDaCoordenacao): void {
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
  const candidato = conferirCandidato(pedido.candidato);
  const alvo = conferirDestino(pedido.destino);
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const trava = travaDaIntegracao(carregado.raiz, arco);
  if (trava === null) throw recusa('noctum.integracao.ocupada', 'outro processo desta máquina integra neste arco agora');
  try {
    const chave = chaveDoDestino(alvo);
    // 1. A vez, por troca atômica sobre a leitura nova, depois da conferência da N1 (a janela e a revogação antes de tudo).
    const tomada = gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
      const estado = derivarCoordenacao(leitura);
      const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
      conferirMerge(carregado, arco, vigente.envelopeSha256, alvo, opcoes.quando);
      exigirNaoRevogada(estado);
      const o = estado.ordens.get(pedido.ordem);
      if (!o || o.maquina !== eu.nome || o.estado !== 'aceita') {
        throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${pedido.ordem} não é uma ordem aceita e viva desta máquina`);
      }
      if (o.envelopeSha256 !== vigente.envelopeSha256) throw recusa('noctum.efeito.hash-antigo', `a ordem ${pedido.ordem} é de outra versão do envelope`);
      if (estado.entregas.has(o.trabalho) || estado.trabalhos.get(o.trabalho)?.estado === 'entregue') {
        throw recusa('noctum.integracao.ja-entregue', `o trabalho ${o.trabalho} já foi entregue neste arco; nada é integrado de novo`);
      }
      const destino = vigente.conteudo.destinos.find(d => d.repositorio.toLowerCase() === alvo.repositorio.toLowerCase());
      if (!destino || destino.base !== alvo.base || !destino.permissoes.includes('merge')) {
        throw recusa('noctum.efeito.fora-do-destino', `merge em ${alvo.repositorio}, base ${alvo.base}, fora do envelope`);
      }
      const ativa = ativaDo(estado, chave);
      if (ativa) {
        if (ativa.maquina === eu.nome && ativa.ordem === o.ordem && mesmoCandidato(ativa.candidato, candidato)) {
          return { novos: [], resultado: { n: ativa.n, trabalho: o.trabalho } };
        }
        throw recusa('noctum.integracao.ocupada', `a vez de integrar em ${destino.repositorio}, base ${destino.base}, está com a máquina ${ativa.maquina} ` +
          `(trabalho ${ativa.trabalho}); espere ela soltar e repita as provas sobre a base nova`);
      }
      const n = proximaDo(estado, chave);
      return { novos: [{ tipo: 'vez', chave, n, destino: { repositorio: destino.repositorio, base: destino.base }, ordem: o.ordem,
        trabalho: o.trabalho, candidato }], resultado: { n, trabalho: o.trabalho } };
    }).resultado;
    const { n, trabalho } = tomada;
    // 2. Os HEADs, relidos do remoto depois de ter a vez.
    let cabecas: Map<string, string | null>;
    try { cabecas = cabecasNoRemoto(carregado, [alvo.base, candidato.branch], opcoes); }
    catch (e) {
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'desistiu', motivo: 'os HEADs não se leram no remoto' }, opcoes);
      throw e;
    }
    const base = cabecas.get(alvo.base) ?? null, fonte = cabecas.get(candidato.branch) ?? null;
    if (base !== candidato.base) {
      // A1 da rodada 2: a base que andou com o próprio merge (a repetição depois de um `nao-provada` cujo push chegou) não
      // invalida o candidato: a fonte já está nela, e a entrega é registrada sem integrar de novo, como na reconciliação.
      const prova = base ? provaDoMerge(carregado, remoto, alvo.base, candidato, opcoes) : null;
      if (prova?.situacao === 'provado') {
        registrarEntrega(carregado, arco, { chave, n, trabalho, ordem: pedido.ordem, destino: alvo, fonte: candidato.fonte,
          base: candidato.base, merge: prova.merge }, opcoes);
        return { trabalho, vez: n, merge: prova.merge };
      }
      if (prova?.situacao === 'sem-prova') semProva(carregado, arco, chave, n, alvo, candidato, prova.ponta, opcoes);
      const motivo = `a base ${alvo.base} está em ${base?.slice(0, 12) ?? 'nada'}, e o candidato foi provado sobre ${candidato.base.slice(0, 12)}`;
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'invalidado', motivo: `base-mudou: ${motivo}` }, opcoes);
      throw recusa('noctum.integracao.base-mudou', `${motivo}: o candidato foi invalidado; atualize, resolva os conflitos e repita as provas`);
    }
    if (fonte !== candidato.fonte) {
      const motivo = `a branch ${candidato.branch} está em ${fonte?.slice(0, 12) ?? 'nada'}, e o candidato é ${candidato.fonte.slice(0, 12)}`;
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'invalidado', motivo: `fonte-mudou: ${motivo}` }, opcoes);
      throw recusa('noctum.integracao.fonte-mudou', `${motivo}: o candidato foi invalidado; as provas se repetem no SHA novo`);
    }
    // 3. A conferência da N1 e a ordem, logo antes do efeito.
    try {
      const estado = lerCoordenacao(carregado, arco, opcoes);
      conferirMerge(carregado, arco, estado.vigente.envelopeSha256, alvo, opcoes.quando);
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
    try { merge = integrar({ remoto, destino: { ...alvo }, candidato: { ...candidato } }).merge; }
    catch (e) { throw recusa('noctum.integracao.nao-provada', `a integração falhou ou ficou incerta (${primeiraLinha(e)}); a vez fica até a reconciliação`); }
    // 5. A prova no remoto (B-R2A-1 da rodada 2): a fonte entrou na base por um merge sobre a base provada.
    const prova = provaDoMerge(carregado, remoto, alvo.base, candidato, opcoes);
    if (prova?.situacao === 'sem-prova') semProva(carregado, arco, chave, n, alvo, candidato, prova.ponta, opcoes);
    if (prova?.situacao !== 'provado') {
      throw recusa('noctum.integracao.nao-provada', `a base ${alvo.base} não tem a fonte pelo merge ${String(merge).slice(0, 12)}; a vez fica até a reconciliação`);
    }
    registrarEntrega(carregado, arco, { chave, n, trabalho, ordem: pedido.ordem, destino: alvo, fonte: candidato.fonte,
      base: candidato.base, merge: prova.merge }, opcoes);
    return { trabalho, vez: n, merge: prova.merge };
  } finally { fs.closeSync(trava); }
}

/** Quantos commits da história de primeiro pai da base a prova percorre, no máximo, atrás da base provada. */
const TETO_DA_HISTORIA = 10000;

export type ProvaDoMerge = { situacao: 'provado'; merge: string } | { situacao: 'sem-prova'; ponta: string } | { situacao: 'ausente'; ponta: string };

/**
 * B-R2A-1 da rodada 2: a fonte entrou na base por um merge sobre a base provada? Busca a base e procura, entre a base
 * provada e a ponta, o merge cujos pais são exatamente a base provada e a fonte, ou a própria fonte na história de primeiro
 * pai da ponta, acima da base provada (o avanço rápido). Achou: `provado`, com o commit. A fonte na base por outro caminho,
 * como o merge sobre a base de agora que o botão de uma forja faria, é `sem-prova`; a base sem a fonte é `ausente`; `null`
 * quando a base não se lê.
 */
export function provaDoMerge(carregado: ManifestoCarregado, remoto: string, base: string, candidato: { base: string; fonte: string },
  opcoes: OpcoesDaCoordenacao): ProvaDoMerge | null {
  const { raiz } = carregado;
  let lida: { ponta: string | null; atualizado: boolean };
  try { lida = buscarBranch(raiz, remoto, base, 'noctum', opcoes.rede?.timeoutMs, opcoes.rede?.env); } catch { return null; }
  if (!lida.atualizado || !lida.ponta) return null;
  if (!git(raiz, ['merge-base', '--is-ancestor', candidato.fonte, lida.ponta]).ok) return { situacao: 'ausente', ponta: lida.ponta };
  const merges = git(raiz, ['rev-list', '--ancestry-path', '--parents', `--max-count=${TETO_DA_HISTORIA}`, `${candidato.base}..${lida.ponta}`]);
  const primeiros = git(raiz, ['rev-list', '--first-parent', `--max-count=${TETO_DA_HISTORIA}`, lida.ponta]);
  if (!merges.ok || !primeiros.ok) return null;
  for (const linha of merges.stdout.split('\n')) {
    const [commit, ...pais] = linha.trim().split(' ');
    if (commit && pais.length === 2 && pais[0] === candidato.base && pais[1] === candidato.fonte) return { situacao: 'provado', merge: commit };
  }
  // O avanço rápido: a própria fonte foi ponta da base, e ela contém a base provada (a branch atualizada com a base também).
  for (const commit of primeiros.stdout.split('\n').map(x => x.trim())) {
    if (commit === candidato.fonte) {
      return git(raiz, ['merge-base', '--is-ancestor', candidato.base, candidato.fonte]).ok ? { situacao: 'provado', merge: candidato.fonte }
        : { situacao: 'sem-prova', ponta: lida.ponta };
    }
    if (commit === candidato.base) break;
  }
  return { situacao: 'sem-prova', ponta: lida.ponta };
}

/**
 * A fonte chegou à base sem prova: a vez desta máquina, quando ainda é dela, termina `sem-prova` (o destino volta a andar), e
 * nada vira entrega. O trabalho não é refeito em outra máquina: a ordem fica, e a inspeção é do dono.
 */
function semProva(carregado: ManifestoCarregado, arco: string, chave: string, n: number, alvo: { base: string },
  candidato: CandidatoDeIntegracao, ponta: string, opcoes: OpcoesDaCoordenacao): never {
  const motivo = `a fonte ${candidato.fonte.slice(0, 12)} chegou à base ${alvo.base} por um merge fora da base provada ${candidato.base.slice(0, 12)}`;
  encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'sem-prova', motivo: `base-nao-provada: ${motivo}`, merge: ponta }, opcoes);
  throw recusa('noctum.integracao.base-nao-provada', `${motivo}: nada foi registrado como entrega, e o trabalho espera a inspeção do dono, sem ser refeito`);
}

/** A entrega e o fim da vez no mesmo commit. Vale também com a ordem cancelada depois do merge: é a conta do que já foi feito. */
function registrarEntrega(carregado: ManifestoCarregado, arco: string, e: { chave: string; n: number; trabalho: string; ordem: string;
  destino: { repositorio: string; base: string }; fonte: string; base: string; merge: string }, opcoes: OpcoesDaCoordenacao): void {
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const vez = estado.vezes.get(e.chave)?.find(v => v.n === e.n);
    const ja = estado.entregas.get(e.trabalho);
    const novos = [];
    if (!ja) novos.push({ tipo: 'entrega' as const, trabalho: e.trabalho, ordem: e.ordem, destino: { repositorio: e.destino.repositorio, base: e.destino.base }, fonte: e.fonte, base: e.base, merge: e.merge });
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
  /** As vezes desta máquina cuja fonte chegou à base por um merge fora da base provada (`chave/n`): nada vira entrega. */
  semProva: string[];
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
  const r: ReconciliacaoDaIntegracao = { registradas: [], soltas: [], emCurso: [], semProva: [], abandonadasConferidas: [] };
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
      // B-R2A-1 e S-R2A-4 da rodada 2: só o merge sobre a base provada vira entrega, com o commit dele, nunca a ponta da base.
      const prova = provaDoMerge(carregado, remoto, v.destino.base, v.candidato, opcoes);
      if (prova === null) continue;
      if (prova.situacao === 'provado') {
        registrarEntrega(carregado, arco, { chave: v.chave, n: v.n, trabalho: v.trabalho, ordem: v.ordem, destino: v.destino,
          fonte: v.candidato.fonte, base: v.candidato.base, merge: prova.merge }, opcoes);
        r.registradas.push({ trabalho: v.trabalho, merge: prova.merge });
        continue;
      }
      if (prova.situacao === 'sem-prova') {
        if (!v.fim) {
          encerrarVez(carregado, arco, v.chave, v.n, { desfecho: 'sem-prova', motivo: 'base-nao-provada: reconciliação: a fonte chegou à base por ' +
            'um merge fora da base provada', merge: prova.ponta }, opcoes);
        }
        r.semProva.push(`${v.chave}/${v.n}`);
        continue;
      }
      if (v.fim) { r.abandonadasConferidas.push(`${v.chave}/${v.n}`); continue; }
      encerrarVez(carregado, arco, v.chave, v.n, { desfecho: 'desistiu', motivo: 'reconciliação: a fonte não está na base; o candidato será provado de novo' }, opcoes);
      r.soltas.push(`${v.chave}/${v.n}`);
    }
  } finally { fs.closeSync(trava); }
  return r;
}
