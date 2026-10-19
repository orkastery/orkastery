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
import { spawnSync } from 'node:child_process';
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
  ordemDaRaiz, VezDerivada,
} from './noctum-coordenacao';
import { ID_DO_ARCO, RecusaDoArco } from './noctum-envelope';
import { cabecasNoRemoto, euNaVersaoVigente, identidadeDaMaquina } from './noctum-transporte';

export interface PedidoDeIntegracao {
  /** A ordem aceita desta máquina para o trabalho que vai ser integrado. */
  ordem: string;
  destino: { repositorio: string; base: string };
  candidato: CandidatoDeIntegracao;
}

/**
 * Quem integra de fato: recebe o destino e o candidato já revalidados e devolve o merge que levou a fonte à base. O contrato é
 * a cerca da base (B-R2A-1 da rodada 2): o merge tem `candidato.base` como primeiro pai e a fonte como segundo, ou é a própria
 * `candidato.fonte` (avanço rápido), e vai à base por push sem força. O merge sobre a base de agora, como o botão de uma
 * forja faria, não é provado e não vira entrega. Push recusado é falha (B-R3A-1 da rodada 3): o integrador nunca mescla a
 * base nova no merge e empurra de novo. O commit devolvido é o merge, mesmo quando o push leva algo por cima dele, como os
 * docs derivados da N5 (A-R3D-1 da R3-D): a ponta da base não é o que se devolve. Por cima do merge, no mesmo push, só vão
 * os docs derivados da página do item; o que for por cima não passa pela prova, e só o contrato o limita (S-G6-3 da R3-D).
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
      const posteriores = entreguesDoDestino(estado, chave);
      const ativa = ativaDo(estado, chave);
      if (ativa) {
        if (ativa.maquina === eu.nome && ativa.ordem === o.ordem && mesmoCandidato(ativa.candidato, candidato)) {
          return { novos: [], resultado: { n: ativa.n, trabalho: o.trabalho, posteriores, repeticao: true } };
        }
        throw recusa('noctum.integracao.ocupada', `a vez de integrar em ${destino.repositorio}, base ${destino.base}, está com a máquina ${ativa.maquina} ` +
          `(trabalho ${ativa.trabalho}); espere ela soltar e repita as provas sobre a base nova`);
      }
      const n = proximaDo(estado, chave);
      return { novos: [{ tipo: 'vez', chave, n, destino: { repositorio: destino.repositorio, base: destino.base }, ordem: o.ordem,
        trabalho: o.trabalho, candidato }], resultado: { n, trabalho: o.trabalho, posteriores, repeticao: false } };
    }).resultado;
    const { n, trabalho, posteriores, repeticao } = tomada;
    // 2. Os HEADs, relidos do remoto depois de ter a vez.
    let cabecas: Map<string, string | null>;
    try { cabecas = cabecasNoRemoto(carregado, [alvo.base, candidato.branch], opcoes); }
    catch (e) {
      if (repeticao) {
        throw recusa('noctum.integracao.nao-provada', `os HEADs não se leram no remoto durante a repetição (${primeiraLinha(e)}); ` +
          'o merge anterior pode ter chegado, e a vez fica até a reconciliação');
      }
      encerrarSemEsconder(carregado, arco, chave, n, { desfecho: 'desistiu', motivo: 'os HEADs não se leram no remoto' }, opcoes);
      throw e;
    }
    const base = cabecas.get(alvo.base) ?? null, fonte = cabecas.get(candidato.branch) ?? null;
    if (base !== candidato.base) {
      // A1 da rodada 2: a base que andou com o próprio merge (a repetição depois de um `nao-provada` cujo push chegou) não
      // invalida o candidato: a fonte já está nela, e a entrega é registrada sem integrar de novo, como na reconciliação.
      const prova = base ? provaDoMerge(carregado, remoto, alvo.base, candidato, opcoes, posteriores) : null;
      if (prova?.situacao === 'provado') {
        registrarEntrega(carregado, arco, { chave, n, trabalho, ordem: pedido.ordem, destino: alvo, fonte: candidato.fonte,
          base: candidato.base, merge: prova.merge }, opcoes);
        return { trabalho, vez: n, merge: prova.merge };
      }
      if (prova?.situacao === 'sem-prova') semProva(carregado, arco, chave, n, alvo, candidato, prova.ponta, opcoes);
      if (base && prova === null && repeticao) {
        // S-R3D-3 da R3-D: na repetição, o merge desta vez pode ser o que fez a base andar, e a história que não se lê (rede,
        // buffer ou prazo) não diz; a vez fica até a reconciliação, como no passo 5 (D45), em vez de invalidar o candidato.
        throw recusa('noctum.integracao.nao-provada', `a base ${alvo.base} andou, e ela ou a história dela não se leram (rede, buffer ou prazo): ` +
          'a prova não sabe se o merge desta vez chegou, e a vez fica até a reconciliação');
      }
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
    // 5. A prova no remoto (B-R2A-1 da rodada 2): a fonte entrou na base por um merge sobre a base provada, e esse merge é o
    // commit que o integrador devolveu (B-R3A-1 da rodada 3): o merge da base nova por cima de um push recusado não vira entrega.
    // As entregas do destino, relidas depois do efeito: com a vez abandonada, outra máquina pode ter integrado no meio.
    let depoisDoEfeito: string[];
    try { depoisDoEfeito = entreguesDoDestino(lerCoordenacao(carregado, arco, opcoes), chave, n); }
    catch (e) { throw recusa('noctum.integracao.nao-provada', `o ramo de coordenação não se leu depois do merge (${primeiraLinha(e)}); a vez fica até a reconciliação`); }
    const prova = provaDoMerge(carregado, remoto, alvo.base, candidato, opcoes, [...new Set([...posteriores, ...depoisDoEfeito])]);
    if (prova === null) {
      // S-R3C-5 da R3-C: a base ou a história dela não se leram (rede, buffer ou prazo); a prova não sabe, e a vez espera.
      throw recusa('noctum.integracao.nao-provada', `a base ${alvo.base} ou a história dela não se leram (rede, buffer ou prazo): a prova não sabe, e a vez fica até a reconciliação`);
    }
    if (prova.situacao === 'sem-prova') semProva(carregado, arco, chave, n, alvo, candidato, prova.ponta, opcoes);
    if (prova.situacao !== 'provado') {
      throw recusa('noctum.integracao.nao-provada', `a base ${alvo.base} não tem a fonte pelo merge ${String(merge).slice(0, 12)}; a vez fica até a reconciliação`);
    }
    const devolvido = commitDevolvido(carregado.raiz, merge);
    if (!devolvido.lido) {
      // S-R3D-2 da R3-D: o git não rodou (prazo, sinal ou falha ao abrir o processo); a prova não sabe, e a vez fica até a
      // reconciliação (D45), em vez de terminar com o motivo de que o integrador não devolveu um commit.
      throw recusa('noctum.integracao.nao-provada', 'o commit que o integrador devolveu não se conferiu neste clone (o git não rodou): ' +
        'a vez fica até a reconciliação');
    }
    if (devolvido.commit === null) {
      // S-R3C-1 da R3-C: sem o commit devolvido, o merge provado não se confere; o motivo diz o que houve, sem acusar a fonte.
      fimSemProva(carregado, arco, chave, n, prova.ponta, opcoes, `o integrador não devolveu um commit que se resolva neste clone, e o merge ` +
        `${prova.merge.slice(0, 12)} que leva a fonte ${candidato.fonte.slice(0, 12)} à base ${alvo.base} não se confere por ele`);
    }
    if (devolvido.commit !== prova.merge) {
      // B-R3A-1 da rodada 3, A-R3D-1 e S-R3D-1 da R3-D: o merge provado está na base, mas o commit devolvido é outro (o merge
      // da base nova por cima de um push recusado, a ponta com algo por cima do merge, um commit novo sobre a fonte que já era
      // a base); o motivo diz isso, sem dizer que a fonte chegou à base por fora.
      const merge = candidato.fonte === candidato.base
        ? `a fonte ${candidato.fonte.slice(0, 12)} já era a base provada, sem o que integrar`
        : `o merge provado ${prova.merge.slice(0, 12)} leva a fonte ${candidato.fonte.slice(0, 12)} à base ${alvo.base}`;
      fimSemProva(carregado, arco, chave, n, prova.ponta, opcoes,
        `o commit que o integrador devolveu não é o merge provado: ele devolveu ${devolvido.commit.slice(0, 12)}, e ${merge}`);
    }
    registrarEntrega(carregado, arco, { chave, n, trabalho, ordem: pedido.ordem, destino: alvo, fonte: candidato.fonte,
      base: candidato.base, merge: prova.merge }, opcoes);
    return { trabalho, vez: n, merge: prova.merge };
  } finally { fs.closeSync(trava); }
}

export type ProvaDoMerge = { situacao: 'provado'; merge: string; ponta: string } | { situacao: 'sem-prova'; ponta: string } |
  { situacao: 'ausente'; ponta: string };

/** O buffer do git da prova pela história; a saída com os pais dos merges passa fácil de 1 MiB, o padrão do `spawnSync`. */
export const BUFFER_DA_HISTORIA = 256 * 1024 * 1024;

/**
 * O git da prova pela história (S-R3A-2 da rodada 3): a busca lê a história inteira entre a base provada e a ponta, sem
 * corte por contagem. Estourado o buffer ou o prazo, a prova não sabe (`null`), e a vez espera.
 */
function gitDaHistoria(raiz: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: BUFFER_DA_HISTORIA, timeout: 120_000 });
  return { ok: r.status === 0 && !r.error, stdout: (r.stdout ?? '').toString() };
}

const ancestral = (raiz: string, de: string, para: string): boolean => git(raiz, ['merge-base', '--is-ancestor', de, para]).ok;

/** Os merges das vezes entregues deste destino no arco: as integrações que a prova de outra vez tem de respeitar. */
function entreguesDoDestino(estado: EstadoDaCoordenacao, chave: string, fora?: number): string[] {
  const dasVezes = (estado.vezes.get(chave) ?? []).filter(v => v.n !== fora && v.fim?.desfecho === 'entregue' && typeof v.fim.merge === 'string')
    .map(v => v.fim!.merge as string);
  const registradas = [...estado.entregas.values()].filter((d) => {
    const destino = d.destino as { repositorio?: unknown; base?: unknown } | undefined;
    return destino && typeof destino.repositorio === 'string' && typeof destino.base === 'string' && chaveDoDestino({
      repositorio: destino.repositorio, base: destino.base,
    }) === chave && typeof d.merge === 'string';
  }).map(d => d.merge as string);
  return [...new Set([...dasVezes, ...registradas])];
}

/**
 * O commit que o integrador devolveu, resolvido no clone desta máquina; `commit: null` quando não é um commit daqui. O SHA vem
 * aparado e em minúsculas (S-R3C-1 da R3-C): a saída do `git rev-parse` sem `trim` e o SHA em maiúsculas são o mesmo
 * commit. Nome de ref não vale: resolvido aqui, diria o commit deste clone, não o que chegou à base. `lido: false` quando o
 * git não rodou ou morreu por erro dele (S-R3D-2 e S-G6-2 da R3-D): prazo, sinal, falha ao abrir o processo ou a saída 128
 * não dizem nada do valor.
 */
function commitDevolvido(raiz: string, merge: unknown): { lido: true; commit: string | null } | { lido: false } {
  const valor = typeof merge === 'string' ? merge.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{7,64}$/.test(valor)) return { lido: true, commit: null };
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${valor}^{commit}`], { cwd: raiz, encoding: 'utf8', timeout: 60_000 });
  // S-G6-2 da R3-D: o valor que o git recusa sai 1; o git que morre por erro dele sai 128 e também não diz nada do valor.
  if (r.error || (r.status !== 0 && r.status !== 1)) return { lido: false };
  return { lido: true, commit: r.status === 0 ? (r.stdout ?? '').trim() : null };
}

/**
 * B-R2A-1 da rodada 2: a fonte entrou na base por um merge sobre a base provada? Busca a base e procura, entre a base
 * provada e a ponta, o merge cujos pais são exatamente a base provada e a fonte, ou a própria fonte na história de primeiro
 * pai da ponta, acima da base provada (o avanço rápido). B-R3A-1 da rodada 3: o merge achado tem de estar na mesma linha de
 * cada entrega do destino posterior à base provada (`posteriores`); o merge que chegou à base dentro de outro merge, depois
 * de uma integração seguinte, não se prova. Achou: `provado`, com o commit. A fonte na base por outro caminho, como o merge
 * sobre a base de agora que o botão de uma forja faria, é `sem-prova`; a base sem a fonte é `ausente`; `null` quando a base
 * ou a história não se leem.
 */
export function provaDoMerge(carregado: ManifestoCarregado, remoto: string, base: string, candidato: { base: string; fonte: string },
  opcoes: OpcoesDaCoordenacao, posteriores: readonly string[] = []): ProvaDoMerge | null {
  const { raiz } = carregado;
  let lida: { ponta: string | null; atualizado: boolean };
  try { lida = buscarBranch(raiz, remoto, base, 'noctum', opcoes.rede?.timeoutMs, opcoes.rede?.env); } catch { return null; }
  if (!lida.atualizado || !lida.ponta) return null;
  const ponta = lida.ponta;
  if (!ancestral(raiz, candidato.fonte, ponta)) return { situacao: 'ausente', ponta };
  const merges = gitDaHistoria(raiz, ['rev-list', '--ancestry-path', '--parents', `${candidato.base}..${ponta}`]);
  const primeiros = gitDaHistoria(raiz, ['rev-list', '--first-parent', `${candidato.base}..${ponta}`]);
  if (!merges.ok || !primeiros.ok) return null;
  let merge: string | null = null;
  for (const linha of merges.stdout.split('\n')) {
    const [commit, ...pais] = linha.trim().split(' ');
    if (commit && pais.length === 2 && pais[0] === candidato.base && pais[1] === candidato.fonte) { merge = commit; break; }
  }
  // O avanço rápido: a própria fonte foi ponta da base, acima da base provada, e ela contém a base provada (a branch
  // atualizada com a base também).
  if (!merge && primeiros.stdout.split('\n').some(x => x.trim() === candidato.fonte)) {
    if (!ancestral(raiz, candidato.base, candidato.fonte)) return { situacao: 'sem-prova', ponta };
    merge = candidato.fonte;
  }
  // O avanço rápido vazio (S-R3C-8 da R3-C): a fonte é a própria base provada, a branch sem commit próprio, e não há o que
  // integrar; a entrega fica com a base, como a branch já incorporada do `ork ship`.
  if (!merge && candidato.fonte === candidato.base) merge = candidato.base;
  if (!merge) return { situacao: 'sem-prova', ponta };
  for (const x of posteriores) {
    if (x === candidato.base || !ancestral(raiz, candidato.base, x)) continue;
    if (!ancestral(raiz, merge, x) && !ancestral(raiz, x, merge)) return { situacao: 'sem-prova', ponta };
  }
  return { situacao: 'provado', merge, ponta };
}

/**
 * A fonte chegou à base sem prova: a vez desta máquina, quando ainda é dela, termina `sem-prova` (o destino volta a andar), e
 * nada vira entrega. O trabalho não é refeito em outra máquina: a ordem fica, e a inspeção é do dono.
 */
function semProva(carregado: ManifestoCarregado, arco: string, chave: string, n: number, alvo: { base: string },
  candidato: CandidatoDeIntegracao, ponta: string, opcoes: OpcoesDaCoordenacao): never {
  return fimSemProva(carregado, arco, chave, n, ponta, opcoes, `a fonte ${candidato.fonte.slice(0, 12)} chegou à base ${alvo.base} ` +
    `por um merge fora da base provada ${candidato.base.slice(0, 12)}`);
}

/** O fim `sem-prova` da vez com o motivo que quem chama montou, e a recusa que diz que o trabalho espera a inspeção. */
function fimSemProva(carregado: ManifestoCarregado, arco: string, chave: string, n: number, ponta: string, opcoes: OpcoesDaCoordenacao,
  motivo: string): never {
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
  const eu = identidadeDaMaquina(carregado.raiz, opcoes.maquina);
  const estado = lerCoordenacao(carregado, arco, opcoes);
  // G8-6: a vez da ordem que só outra chave da máquina pode fechar (a da raiz nova) fica para ela.
  const todas = [...estado.vezes.values()].flat().filter(v => v.maquina === eu.nome && ordemDaRaiz(estado, estado.ordens.get(v.ordem)!, eu));
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
      const prova = provaDoMerge(carregado, remoto, v.destino.base, v.candidato, opcoes, entreguesDoDestino(estado, v.chave, v.n));
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
