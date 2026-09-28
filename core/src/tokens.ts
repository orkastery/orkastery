/**
 * `ork gate next`: o gate de tokens (guia: docs/guias/memoria-e-handoff.md).
 *
 * Ao fim de cada fase, ANTES de despachar o proximo passo, o `ork` mede a lotacao da
 * janela da sessao atual e decide entre continuar na MESMA sessao ou abrir uma NOVA.
 *
 * Honestidade de medicao, a regra que manda aqui:
 *   - `runtime_reported`: o runtime adapter sabe ler o uso de contexto. O `claude-bg`
 *     HOJE nao sabe (medido na versao 2.1.259), entao esta fonte nao aparece ainda.
 *   - `estimated`: existe transcript em disco; a estimativa e por tamanho, com o metodo
 *     e a janela nominal declarados na propria medida.
 *   - `informada`: o host adaptador (ou o operador) passou a ocupacao explicitamente.
 *   - `unavailable`: nada sabe medir. Nesse caso NAO se rotaciona, porque decidir
 *     rotacao por dado que nao existe e pior do que nao decidir. O veredito sai como
 *     `same-session` com `decididoPor: ausencia-de-medida`, e o ledger diz isso.
 *
 * Numero inventado nao entra aqui em nenhuma hipotese.
 */

import * as fs from 'node:fs';
import * as adapter from './adapters/claude-bg';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { blocoDaFase } from './modos';
import { slugDaSessao } from './phase';
import { dirThread, gravarThread, lerThread } from './thread';
import { Fase, FonteDeMedida, MedidaDeJanela, Thread, VereditoDeTokens } from './types';
import { agora } from './util';

/**
 * Janela nominal usada na estimativa por transcript.
 * Declarada, nao escondida: quem le a medida sabe contra o que ela foi calculada.
 */
export const JANELA_NOMINAL_PADRAO = 200000;

/** Aproximacao classica de tokenizacao para texto tecnico: ~4 bytes por token. */
export const BYTES_POR_TOKEN = 4;

/** Passos pesados: GO e CHECK, e refazer uma fase reprovada (visao, secao 3.6). */
export function passoEhPesado(proximo: Fase | null, refazer: boolean): boolean {
  return refazer || proximo === 'GO' || proximo === 'CHECK';
}

export interface OpcoesGateDeTokens {
  /** Fase do proximo passo. Padrao: a fase atual da thread. */
  proximo?: Fase;
  /** Ocupacao informada pelo host adaptador (0..1). */
  ocupacao?: number;
  /** Fonte declarada para a ocupacao informada. */
  fonte?: FonteDeMedida;
  /** Transcript em disco, para a estimativa por tamanho. */
  transcript?: string;
  /** Janela nominal usada na estimativa. */
  janela?: number;
  /** O proximo passo e refazer uma fase reprovada (passo pesado). */
  refazer?: boolean;
  /** Sessao consultada no runtime quando ele souber reportar contexto. */
  sessao?: string;
}

/** Mede a ocupacao da janela, na ordem de confiabilidade das fontes. */
export function medirOcupacao(thread: Thread, opcoes: OpcoesGateDeTokens): MedidaDeJanela {
  if (typeof opcoes.ocupacao === 'number' && Number.isFinite(opcoes.ocupacao)) {
    const valor = Math.max(0, Math.min(1, opcoes.ocupacao));
    const fonte: FonteDeMedida =
      opcoes.fonte === 'runtime_reported' || opcoes.fonte === 'estimated'
        ? opcoes.fonte
        : 'informada';
    return {
      ocupacao: valor,
      fonte,
      detalhe: `ocupacao ${(valor * 100).toFixed(1)}% declarada pelo chamador como fonte ${fonte}`,
    };
  }

  if (opcoes.transcript) {
    if (!fs.existsSync(opcoes.transcript)) {
      return {
        ocupacao: null,
        fonte: 'unavailable',
        detalhe: `transcript informado nao existe: ${opcoes.transcript}`,
      };
    }
    const bytes = fs.statSync(opcoes.transcript).size;
    const janela = opcoes.janela ?? JANELA_NOMINAL_PADRAO;
    const tokens = bytes / BYTES_POR_TOKEN;
    const valor = Math.max(0, Math.min(1, tokens / janela));
    return {
      ocupacao: valor,
      fonte: 'estimated',
      detalhe:
        `estimativa por tamanho: ${bytes} bytes / ${BYTES_POR_TOKEN} bytes por token = ` +
        `~${Math.round(tokens)} tokens de uma janela nominal de ${janela}`,
    };
  }

  // O runtime adapter e a fonte preferida; hoje ele declara que nao sabe medir.
  const ultima = thread.sessoes[thread.sessoes.length - 1];
  const chave = opcoes.sessao ?? ultima?.sessionId ?? '';
  const doRuntime = chave ? adapter.ocupacaoDeContexto(chave) : null;
  if (doRuntime !== null) {
    return {
      ocupacao: Math.max(0, Math.min(1, doRuntime)),
      fonte: 'runtime_reported',
      detalhe: `uso de contexto lido do runtime para a sessao ${chave}`,
    };
  }
  return {
    ocupacao: null,
    fonte: 'unavailable',
    detalhe:
      'o adapter claude-bg nao expoe uso de contexto nesta versao do runtime; ' +
      'nenhuma outra fonte foi informada (--ocupacao ou --transcript)',
  };
}

/**
 * Roda o gate de tokens: mede, decide e DOCUMENTA no ledger.
 * Nao despacha nada: quem despacha e o `ork phase run`, com o slug que este gate sugere.
 */
export function gateDeTokens(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesGateDeTokens = {}
): VereditoDeTokens {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const proximo = opcoes.proximo ?? thread.faseAtual;
  const refazer = opcoes.refazer === true;
  const pesado = passoEhPesado(proximo, refazer);
  const medida = medirOcupacao(thread, opcoes);
  const limiares = {
    rotate_above: manifesto.handoff.rotate_above,
    force_rotate_above: manifesto.handoff.force_rotate_above,
  };

  let veredito: VereditoDeTokens['veredito'] = 'same-session';
  let decididoPor: VereditoDeTokens['decididoPor'] = 'medicao';
  let razao = '';

  if (medida.ocupacao === null) {
    veredito = 'same-session';
    decididoPor = 'ausencia-de-medida';
    razao =
      'ocupacao da janela nao e medivel (fonte unavailable): a rotacao NAO e decidida por ' +
      'dado inexistente. Siga na mesma sessao e rotacione por decisao explicita se precisar.';
  } else if (medida.ocupacao >= limiares.force_rotate_above) {
    veredito = 'new-session';
    razao =
      `ocupacao ${(medida.ocupacao * 100).toFixed(1)}% >= force_rotate_above ` +
      `(${(limiares.force_rotate_above * 100).toFixed(0)}%): rotaciona sempre, ` +
      'independente do peso do proximo passo.';
  } else if (medida.ocupacao >= limiares.rotate_above && pesado) {
    veredito = 'new-session';
    razao =
      `ocupacao ${(medida.ocupacao * 100).toFixed(1)}% >= rotate_above ` +
      `(${(limiares.rotate_above * 100).toFixed(0)}%) e o proximo passo e pesado ` +
      `(${refazer ? 'refazer fase reprovada' : proximo}): mais janela significa mais acuracia.`;
  } else if (medida.ocupacao >= limiares.rotate_above) {
    razao =
      `ocupacao ${(medida.ocupacao * 100).toFixed(1)}% >= rotate_above, mas o proximo passo ` +
      `(${proximo}) nao e pesado: segue na mesma sessao.`;
  } else {
    razao =
      `ocupacao ${(medida.ocupacao * 100).toFixed(1)}% abaixo de rotate_above ` +
      `(${(limiares.rotate_above * 100).toFixed(0)}%): segue na mesma sessao.`;
  }

  // O slug da proxima sessao: outra parte de fases quando o bloco muda, sufixo de
  // rotacao quando a sessao nova conduz um bloco que a thread ja abriu.
  const slugSugerido = veredito === 'new-session' ? slugDaSessao(thread, proximo) : null;

  const resultado: VereditoDeTokens = {
    thread: threadId,
    medida,
    proximoPasso: proximo,
    passoPesado: pesado,
    veredito,
    decididoPor,
    razao,
    slugSugerido,
    limiares,
    decididoEm: agora(),
  };

  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.gateDeTokens, {
    ocupacao: medida.ocupacao,
    fonte: medida.fonte,
    fonteDetalhe: medida.detalhe,
    proximoPasso: proximo,
    bloco: blocoDaFase(thread.modo, proximo).fases.join('-'),
    passoPesado: pesado,
    veredito,
    decididoPor,
    razao,
    slugSugerido,
    limiares,
  });

  const atualizada = lerThread(raiz, threadId);
  atualizada.ultimoTokenGate = resultado;
  gravarThread(raiz, atualizada);

  return resultado;
}

/** Texto de `ork gate next`. */
export function textoDoGateDeTokens(v: VereditoDeTokens): string {
  const linhas: string[] = [];
  linhas.push(`ork gate next: thread ${v.thread}`);
  linhas.push(
    `  ocupacao       ${v.medida.ocupacao === null ? 'nao medivel' : `${(v.medida.ocupacao * 100).toFixed(1)}%`}`
  );
  linhas.push(`  fonte          ${v.medida.fonte}`);
  linhas.push(`                 ${v.medida.detalhe}`);
  linhas.push(
    `  limiares       rotate_above ${v.limiares.rotate_above} | force_rotate_above ${v.limiares.force_rotate_above}`
  );
  linhas.push(`  proximo passo  ${v.proximoPasso} (${v.passoPesado ? 'pesado' : 'leve'})`);
  linhas.push('');
  linhas.push(`VEREDITO: ${v.veredito}  (decidido por ${v.decididoPor})`);
  linhas.push(`  razao: ${v.razao}`);
  if (v.slugSugerido) {
    linhas.push(`  slug da nova sessao: ${v.slugSugerido}`);
    linhas.push(`  proximo passo: ork handoff export ${v.thread} --proxima-fase ${v.proximoPasso}`);
  }
  linhas.push('');
  linhas.push(`Registrado no ledger como token_gate: ork phase list ${v.thread}`);
  return linhas.join('\n');
}
