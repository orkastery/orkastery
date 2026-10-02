/**
 * GO-FIX e CHECK-REVERIFY automatizados (bloco B3).
 *
 * O melhor sub-loop do metodo era, ate aqui, manual: o CHECK reprovava, um humano lia o
 * relatorio, escrevia a spec da correcao, mandava de volta ao GO e depois lembrava de
 * reexecutar o CHECK inteiro. O B3 transforma esse ciclo em codigo, sem afrouxar nada:
 *
 *   - A spec do GO-FIX nasce do resultado REAL do `ork verify`, nao de prosa. Cada
 *     correcao carrega o motivo tipado que a originou, o alvo exato (claim, comando ou
 *     artefato), o comando que a julga e a saida real que provou a reprovacao.
 *   - A classificacao A/B segue a regra do metodo (DoD 10, skill `check-quality`):
 *     tipo A e uma linha ou equivalente e reexecuta so o que foi afetado; tipo B devolve
 *     a tarefa ao GO, e o CHECK seguinte e reexecucao COMPLETA. Rodada com um unico tipo
 *     B RECUSA reverify parcial, porque "parcial depois de tipo B nao e CHECK".
 *   - O veredito e POR CORRECAO, alem do veredito final da rodada.
 *
 * Onde o humano continua entrando: no LIMITE DE ESCALACAO. Estouradas as tentativas do
 * manifesto, a rodada sai `BLOQUEADO` e sobe para o humano, pausando QUALQUER modo,
 * inclusive `#Auto`. Ate esse limite, `#Maestro` e `#Auto` atravessam sozinhos.
 *
 * Este modulo nao reimplementa verificacao: quem diz a verdade continua sendo o
 * `ork verify` do B1, reexecutado no HEAD real.
 */

import * as path from 'node:path';
import { registrarGateBloqueado } from './gates';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { blocoDaThread, dirThread, lerThread } from './thread';
import {
  Correcao,
  MotivoGate,
  ResultadoDeComando,
  RodadaDeFix,
  Thread,
  TipoDeCorrecao,
} from './types';
import { agora, anexarJsonl, lerJsonl, proximoIdSequencial, shaCurto, tabela } from './util';
import { ConducaoDoVerify, cwdDaThread, executar, ResultadoVerify, verificar } from './verify';
import { canalDoProcesso, comConducao, identidadeDoAmbiente, prazoDaVerificacao } from './conducao';

/** Veredito de UMA correcao no CHECK-REVERIFY. */
export interface VereditoDeCorrecao {
  correcao: Correcao;
  aprovada: boolean;
  execucoes: ResultadoDeComando[];
  detalhe: string;
}

/** Resultado completo do CHECK-REVERIFY de uma rodada. */
export interface ResultadoDoReverify {
  thread: string;
  rodada: number;
  /** `completa` sempre que houver tipo B; `parcial` so quando a rodada inteira e tipo A. */
  cobertura: 'completa' | 'parcial';
  vereditos: VereditoDeCorrecao[];
  /** O `ork verify` completo, quando a cobertura exigiu. */
  verify: ResultadoVerify | null;
  veredito: 'PASSOU' | 'PRECISA DE MUDANCA' | 'BLOQUEADO';
  rodadas: number;
  limite: number;
  /** True quando o veredito subiu para o humano (pausa qualquer modo). */
  escalado: boolean;
  motivos: MotivoGate[];
  razao: string;
}

/** Armazem append-only das correcoes da thread. */
export function caminhoDosFixes(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'fixes.jsonl');
}

/** Todas as correcoes ja registradas na thread (a ultima gravacao de um id vence). */
export function lerCorrecoes(raiz: string, threadId: string): Correcao[] {
  return lerJsonl<Correcao>(caminhoDosFixes(raiz, threadId));
}

/** Correcoes de uma rodada especifica. */
export function correcoesDaRodada(raiz: string, threadId: string, rodada: number): Correcao[] {
  return lerCorrecoes(raiz, threadId).filter((c) => c.rodada === rodada);
}

/** Numero da ultima rodada de GO-FIX aberta na thread (0 quando nao houve nenhuma). */
export function ultimaRodada(raiz: string, threadId: string): number {
  return lerCorrecoes(raiz, threadId).reduce((max, c) => Math.max(max, c.rodada), 0);
}

/**
 * A classificacao A/B derivada do MOTIVO TIPADO, nao de julgamento de tamanho.
 *
 * O nucleo nao sabe medir "uma linha ou equivalente", entao ele nao finge saber: o
 * padrao e o CONSERVADOR (tipo B, devolve ao GO e exige reexecucao completa). O unico
 * caso que nasce tipo A e a alegacao sem comando de verificacao, em que a correcao E
 * literalmente anexar o comando (`ork claims verificar`), sem tocar em codigo.
 */
export function tipoDoMotivo(motivo: MotivoGate): TipoDeCorrecao {
  return motivo === 'claims.unverifiable' ? 'A' : 'B';
}

/**
 * Deriva as correcoes dirigidas do resultado REAL do `ork verify`.
 *
 * Uma correcao por item reprovado, nunca uma correcao guarda-chuva: "o CHECK reprovou"
 * nao e spec, e o GO-FIX precisa saber exatamente o que consertar e o que sera
 * reexecutado para julga-lo.
 */
export function derivarCorrecoes(
  thread: Thread,
  rodada: number,
  resultado: ResultadoVerify,
  idsUsados: string[]
): Correcao[] {
  const correcoes: Correcao[] = [];
  const ids = [...idsUsados];
  const proximo = (): string => {
    const id = proximoIdSequencial(ids, 'FX');
    ids.push(id);
    return id;
  };
  const nascer = (
    origem: MotivoGate,
    alvo: string,
    spec: string,
    verificar: string[],
    evidencia: string
  ): void => {
    correcoes.push({
      id: proximo(),
      thread: thread.id,
      rodada,
      tipo: tipoDoMotivo(origem),
      origem,
      alvo,
      spec,
      verificar,
      evidencia,
      estado: 'aberta',
      vereditoEm: null,
      detalheDoVeredito: '',
      criadaEm: agora(),
    });
  };

  for (const c of resultado.claims) {
    if (c.verificado || c.motivo === null) continue;
    const falhou = c.execucoes.find((e) => !e.ok);
    if (c.motivo === 'claims.unverifiable') {
      nascer(
        c.motivo,
        `claim ${c.claim.id}`,
        `A alegacao ${c.claim.id} sobre ${c.claim.arquivo} ("${c.claim.alegacao}") nao tem comando ` +
          'de verificacao. Anexe o comando que a comprova no HEAD real, ou retire a alegacao com ' +
          `motivo: ork claims verificar ${thread.id} ${c.claim.id} --comando "<comando>"`,
        [],
        c.detalhe
      );
      continue;
    }
    nascer(
      c.motivo,
      `claim ${c.claim.id}`,
      `A alegacao ${c.claim.id} sobre ${c.claim.arquivo} ("${c.claim.alegacao}") REPROVOU na ` +
        `reexecucao no HEAD real. ${c.detalhe}. Corrija o artefato ate o comando passar, ou ` +
        'retire a alegacao com motivo. Nao edite o comando para faze-lo passar.',
      c.claim.verificar,
      falhou ? `${falhou.comando} saiu com codigo ${falhou.code}:\n${falhou.resumo}` : c.detalhe
    );
  }

  for (const cmd of resultado.regressoes) {
    nascer(
      'verify.regression',
      `comando ${cmd.nome}`,
      `REGRESSAO: "${cmd.comando}" passava na baseline gravada antes do GO (commit ` +
        `${resultado.baseline ? shaCurto(resultado.baseline.commit) : 'desconhecido'}) e falha agora. Este defeito ` +
        'e desta thread, nao divida pre-existente. Corrija ate o comando voltar a passar.',
      [cmd.comando],
      `codigo ${cmd.code}:\n${cmd.resumo}`
    );
  }

  for (const cmd of resultado.falhasSemBaseline) {
    nascer(
      'verify.failed',
      `comando ${cmd.nome}`,
      `"${cmd.comando}" falha e NAO ha baseline para separar regressao de divida pre-existente. ` +
        'Corrija a falha, ou grave a baseline antes do GO com `ork verify <thread> --baseline` ' +
        'para que a proxima rodada saiba de quem e a culpa.',
      [cmd.comando],
      `codigo ${cmd.code}:\n${cmd.resumo}`
    );
  }

  return correcoes;
}

/** A spec EXATA que vai no prompt do GO-FIX. Sai dos dados, nunca de prosa livre. */
export function specDoGoFix(thread: Thread, rodada: number, correcoes: Correcao[]): string {
  const temTipoB = correcoes.some((c) => c.tipo === 'B');
  const linhas: string[] = [];
  linhas.push(`GO-FIX da thread ${thread.id}, rodada ${rodada}.`);
  linhas.push('');
  linhas.push(
    'O CHECK reprovou. Abaixo esta a spec EXATA de cada correcao, derivada do resultado real ' +
      'de `ork verify` no HEAD, com o comando que vai julgar cada uma no CHECK-REVERIFY.'
  );
  linhas.push('');
  for (const c of correcoes) {
    linhas.push(`${c.id} (tipo ${c.tipo}, motivo tipado ${c.origem}) alvo: ${c.alvo}`);
    linhas.push(`  o que fazer: ${c.spec}`);
    linhas.push(
      `  como sera julgado: ${c.verificar.length > 0 ? c.verificar.join(' && ') : '(sem comando proprio: o verify completo julga)'}`
    );
    linhas.push('  evidencia da reprovacao:');
    for (const l of c.evidencia.split('\n').slice(-6)) linhas.push(`    | ${l}`);
    linhas.push('');
  }
  linhas.push('Regras desta rodada:');
  linhas.push('- Corrija o ARTEFATO. Editar o comando de verificacao para faze-lo passar e fraude de gate.');
  linhas.push('- Um commit atomico por correcao, citando o id da correcao na mensagem.');
  linhas.push(
    temTipoB
      ? '- Ha correcao tipo B nesta rodada: o CHECK seguinte e reexecucao COMPLETA, nunca parcial.'
      : '- Rodada so de tipo A: o CHECK seguinte reexecuta as verificacoes afetadas.'
  );
  linhas.push('- Nao ha pausa humana dentro deste sub-loop; o veredito final e que sobe.');
  return linhas.join('\n');
}

export interface OpcoesAbrirRodada {
  /** Nao roda os comandos do manifesto, so as claims (verificacao rapida). */
  soClaims?: boolean;
  /** I-36 (T5): canal, identidade e espera da conducao da rodada. */
  conducao?: ConducaoDoVerify;
}

/**
 * I-36 (T5): o GO-FIX e o CHECK-REVERIFY executam na worktree, entao seguram a conducao da thread
 * do comeco ao fim. O `verificar` de dentro reentra no mesmo processo.
 */
function sobConducao<T>(carregado: ManifestoCarregado, threadId: string, operacao: 'fix.open' | 'fix.reverify',
  conducao: ConducaoDoVerify, executar: () => T): T {
  return comConducao(carregado.raiz, threadId, {
    canal: conducao.canal ?? canalDoProcesso(),
    correlacao: conducao.correlacao ?? null,
    operacao,
    identidade: conducao.identidade ?? identidadeDoAmbiente(threadId, process.env, carregado.raiz),
    prazoMs: prazoDaVerificacao(carregado.manifesto.verify.timeout_ms ?? 10 * 60 * 1000, 8),
    esperarMs: conducao.esperarMs,
  }, executar);
}

/**
 * Abre a rodada de GO-FIX a partir de um CHECK reprovado.
 *
 * A verdade vem do `ork verify` reexecutado agora: a rodada nao acredita em relatorio de
 * CHECK nenhum, nem no do proprio agente que acabou de rodar.
 */
export function abrirRodada(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesAbrirRodada = {}
): RodadaDeFix {
  return sobConducao(carregado, threadId, 'fix.open', opcoes.conducao ?? {}, () => abrirRodadaSobConducao(carregado, threadId, opcoes));
}

function abrirRodadaSobConducao(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesAbrirRodada
): RodadaDeFix {
  const { raiz } = carregado;
  const thread = lerThread(raiz, threadId);
  const resultado = verificar(carregado, threadId, { soClaims: opcoes.soClaims });
  const rodada = ultimaRodada(raiz, threadId) + 1;

  if (resultado.ok && resultado.motivos.length === 0) {
    return {
      thread: threadId,
      rodada: rodada - 1,
      veredito: 'PASSOU',
      correcoes: [],
      temTipoB: false,
      spec: '',
      motivos: [],
      abertaEm: agora(),
    };
  }

  const idsUsados = lerCorrecoes(raiz, threadId).map((c) => c.id);
  const correcoes = derivarCorrecoes(thread, rodada, resultado, idsUsados);
  for (const c of correcoes) anexarJsonl(caminhoDosFixes(raiz, threadId), c);

  const temTipoB = correcoes.some((c) => c.tipo === 'B');
  const spec = specDoGoFix(thread, rodada, correcoes);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.fixAberto, {
    fase: 'CHECK',
    rodada,
    veredito: 'PRECISA DE MUDANCA',
    correcoes: correcoes.map((c) => ({ id: c.id, tipo: c.tipo, origem: c.origem, alvo: c.alvo })),
    temTipoB,
    motivos: resultado.motivos,
    commit: resultado.commit,
    evidencia: `ork verify reexecutado no HEAD ${resultado.commit} em ${resultado.cwd}`,
    reexecucaoCompletaObrigatoria: temTipoB,
  });

  return {
    thread: threadId,
    rodada,
    veredito: 'PRECISA DE MUDANCA',
    correcoes,
    temTipoB,
    spec,
    motivos: resultado.motivos,
    abertaEm: agora(),
  };
}

/** Regrava uma correcao com o veredito do reverify. */
function carimbar(raiz: string, correcao: Correcao, aprovada: boolean, detalhe: string): Correcao {
  const atualizada: Correcao = {
    ...correcao,
    estado: aprovada ? 'aprovada' : 'reprovada',
    vereditoEm: agora(),
    detalheDoVeredito: detalhe,
  };
  anexarJsonl(caminhoDosFixes(raiz, correcao.thread), atualizada);
  return atualizada;
}

export interface OpcoesReverify {
  /** Rodada a rever. Padrao: a ultima aberta. */
  rodada?: number;
  /**
   * Pedido explicito de reexecucao PARCIAL (so os comandos das correcoes).
   * Recusado quando a rodada tem correcao tipo B: parcial depois de tipo B nao e CHECK.
   */
  parcial?: boolean;
  /** I-36 (T5): canal, identidade e espera da conducao do CHECK-REVERIFY. */
  conducao?: ConducaoDoVerify;
}

/**
 * CHECK-REVERIFY: veredito POR CORRECAO mais o veredito final da rodada.
 *
 * A cobertura nao e escolha de gosto. Rodada com tipo B e sempre `completa`; pedir
 * `--parcial` nela LANCA, em vez de degradar em silencio para uma verificacao mais
 * frouxa do que o metodo manda.
 */
export function reverificar(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesReverify = {}
): ResultadoDoReverify {
  return sobConducao(carregado, threadId, 'fix.reverify', opcoes.conducao ?? {}, () => reverificarSobConducao(carregado, threadId, opcoes));
}

function reverificarSobConducao(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesReverify
): ResultadoDoReverify {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const rodada = opcoes.rodada ?? ultimaRodada(raiz, threadId);
  if (rodada === 0) {
    throw new Error(
      `a thread ${threadId} nao tem rodada de GO-FIX aberta (abra com: ork fix open ${threadId})`
    );
  }
  const correcoes = correcoesDaRodada(raiz, threadId, rodada);
  if (correcoes.length === 0) {
    throw new Error(`rodada ${rodada} nao existe na thread ${threadId}`);
  }
  const temTipoB = correcoes.some((c) => c.tipo === 'B');
  if (opcoes.parcial && temTipoB) {
    throw new Error(
      `a rodada ${rodada} tem correcao tipo B (${correcoes
        .filter((c) => c.tipo === 'B')
        .map((c) => c.id)
        .join(', ')}): o CHECK seguinte e reexecucao COMPLETA. ` +
        'Parcial depois de tipo B nao e CHECK (DoD 10).'
    );
  }
  const cobertura: 'completa' | 'parcial' = opcoes.parcial && !temTipoB ? 'parcial' : 'completa';
  const cwd = cwdDaThread(raiz, thread);

  const vereditos: VereditoDeCorrecao[] = correcoes.map((c) => {
    if (c.verificar.length === 0) {
      // Sem comando proprio a correcao nao se julga sozinha: quem decide e o verify
      // completo. Chamar isso de "aprovada" seria self-report com outro nome.
      return {
        correcao: c,
        aprovada: false,
        execucoes: [],
        detalhe: 'sem comando proprio de verificacao: o veredito depende do verify completo',
      };
    }
    const execucoes = c.verificar.map((cmd, i) => executar(`${c.id}.${i + 1}`, cmd, cwd));
    const falhou = execucoes.find((e) => !e.ok);
    return {
      correcao: c,
      aprovada: !falhou,
      execucoes,
      detalhe: falhou
        ? `"${falhou.comando}" ainda sai com codigo ${falhou.code}`
        : `${execucoes.length} comando(s) reexecutado(s) com sucesso no HEAD real`,
    };
  });

  const verify = cobertura === 'completa' ? verificar(carregado, threadId) : null;

  for (const v of vereditos) {
    // Correcao sem comando proprio herda o veredito do verify completo, e so quando ele
    // roda: sem ele, ela continua aberta em vez de virar aprovada por conveniencia.
    const aprovada = v.correcao.verificar.length === 0 ? (verify?.ok ?? false) : v.aprovada;
    v.aprovada = aprovada;
    carimbar(raiz, v.correcao, aprovada, v.detalhe);
  }

  const rodadas = rodada;
  const limite = manifesto.retry.max_tentativas;
  const todasAprovadas = vereditos.every((v) => v.aprovada);
  const verifyOk = verify === null ? true : verify.ok;
  const motivos: MotivoGate[] = verify ? verify.motivos : [];

  let veredito: ResultadoDoReverify['veredito'];
  let escalado = false;
  let razao: string;
  if (todasAprovadas && verifyOk) {
    veredito = 'PASSOU';
    razao =
      `${vereditos.length} correcao(oes) aprovada(s) por comando reexecutado no HEAD real` +
      (verify ? `, com o verify completo verde no commit ${shaCurto(verify.commit)}` : '');
  } else if (rodadas >= limite) {
    veredito = 'BLOQUEADO';
    escalado = true;
    razao =
      `limite de escalacao atingido: ${rodadas} rodada(s) de GO-FIX para o limite de ${limite} ` +
      'do manifesto. Escalacao tipada pausa QUALQUER modo, inclusive #Auto.';
  } else {
    veredito = 'PRECISA DE MUDANCA';
    razao =
      `${vereditos.filter((v) => !v.aprovada).length} correcao(oes) ainda reprovada(s); ` +
      `rodada ${rodadas} de ${limite} antes da escalacao.`;
  }

  const dir = dirThread(raiz, threadId);
  registrar(dir, threadId, TIPOS_DE_EVENTO.reverifyConcluido, {
    fase: 'CHECK',
    rodada,
    cobertura,
    veredito,
    modo: thread.modo,
    bloco: blocoDaThread(thread, 'CHECK').fases.join('-'),
    vereditos: vereditos.map((v) => ({
      correcao: v.correcao.id,
      tipo: v.correcao.tipo,
      origem: v.correcao.origem,
      aprovada: v.aprovada,
      detalhe: v.detalhe,
    })),
    verify: verify ? { commit: verify.commit, ok: verify.ok, motivos: verify.motivos } : null,
    escalado,
    razao,
    evidencia: 'comandos reexecutados no HEAD real, um veredito por correcao',
  });

  if (escalado) {
    registrarGateBloqueado(dir, threadId, {
      gate: 'verify',
      motivo: 'human.pending',
      modo: thread.modo,
      detalhe: razao,
      evidencia: `rodada ${rodada} de GO-FIX/CHECK-REVERIFY na thread ${threadId}`,
      correcao: `ork gate request ${threadId}`,
      rodada,
      limite,
      pausaQualquerModo: true,
    });
    registrar(dir, threadId, TIPOS_DE_EVENTO.retryEscalado, {
      fase: 'CHECK',
      motivo: 'human.pending',
      origem: 'check.reverify',
      rodada,
      limite,
      modo: thread.modo,
      razao,
    });
  }

  return {
    thread: threadId,
    rodada,
    cobertura,
    vereditos,
    verify,
    veredito,
    rodadas,
    limite,
    escalado,
    motivos,
    razao,
  };
}

/** Quantas rodadas de GO-FIX a thread ja gastou (para o limite de escalacao). */
export function rodadasGastas(raiz: string, threadId: string): number {
  return lerLedger(dirThread(raiz, threadId)).filter((e) => e.tipo === TIPOS_DE_EVENTO.fixAberto)
    .length;
}

/** Texto de `ork fix open`. */
export function textoDaRodada(r: RodadaDeFix): string {
  if (r.correcoes.length === 0) {
    return (
      `Thread ${r.thread}: o CHECK PASSOU no HEAD real, nao ha correcao a abrir.\n` +
      '  (nenhum motivo tipado bloqueante em `ork verify`)'
    );
  }
  const linhas: string[] = [];
  linhas.push(`GO-FIX aberto na thread ${r.thread} (rodada ${r.rodada})`);
  linhas.push(`  veredito do CHECK   ${r.veredito}`);
  linhas.push(`  motivos tipados     ${r.motivos.join(', ')}`);
  linhas.push(
    `  reexecucao          ${r.temTipoB ? 'COMPLETA obrigatoria (ha correcao tipo B)' : 'parcial permitida (rodada so de tipo A)'}`
  );
  linhas.push('');
  linhas.push(
    tabela(
      ['ID', 'TIPO', 'MOTIVO', 'ALVO', 'JULGADO POR'],
      r.correcoes.map((c) => [
        c.id,
        c.tipo,
        c.origem,
        c.alvo,
        c.verificar.join(' && ') || '(verify completo)',
      ])
    )
  );
  linhas.push('');
  linhas.push('Spec exata despachada ao GO-FIX:');
  linhas.push('');
  for (const l of r.spec.split('\n')) linhas.push(`  ${l}`);
  return linhas.join('\n');
}

/** Texto de `ork fix reverify`. */
export function textoDoReverify(r: ResultadoDoReverify): string {
  const linhas: string[] = [];
  linhas.push(`CHECK-REVERIFY da thread ${r.thread} (rodada ${r.rodada})`);
  linhas.push(`  cobertura   ${r.cobertura}`);
  linhas.push(`  rodadas     ${r.rodadas} de ${r.limite} antes da escalacao`);
  linhas.push('');
  linhas.push('Veredito por correcao:');
  for (const v of r.vereditos) {
    linhas.push(
      `  ${v.correcao.id}  tipo ${v.correcao.tipo}  ${v.aprovada ? 'APROVADA' : 'REPROVADA'}  ${v.correcao.alvo}`
    );
    linhas.push(`      motivo de origem: ${v.correcao.origem}`);
    linhas.push(`      ${v.detalhe}`);
    for (const e of v.execucoes) {
      linhas.push(`      ${e.ok ? 'ok  ' : 'FALHOU'} ${e.comando}`);
    }
  }
  if (r.verify) {
    linhas.push('');
    linhas.push(
      `Verify completo no HEAD ${shaCurto(r.verify.commit)}: ${r.verify.ok ? 'verde' : `reprovado (${r.verify.motivos.join(', ')})`}`
    );
  }
  linhas.push('');
  linhas.push(`Veredito final: ${r.veredito}`);
  linhas.push(`  ${r.razao}`);
  if (r.escalado) {
    linhas.push('  ESCALADO PARA HUMANO: esta pausa vale em qualquer modo, inclusive #Auto.');
  }
  return linhas.join('\n');
}
