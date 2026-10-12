/**
 * RM-061, fatia F2a: a familia `phase` do catalogo de mensagens (`ork phase list` e o resumo de
 * `ork phase run`). O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O que o despacho grava e dado e sai como foi gravado: o erro do ledger, a recusa de conducao
 * registrada, o detalhe e a correcao de uma policy avaliada, a decisao autonoma, o estado e o
 * veredito de um evento. O catalogo traduz a moldura que o comando monta em volta deles.
 */

export const PHASE_PT_BR = {
  // ork phase list
  ledgerVazio: (id: string) => `Ledger vazio para a thread ${id}.`,
  colunas: ['QUANDO', 'EVENTO', 'DETALHE'] as readonly string[],
  sessao: (id: string) => `sessao ${id}`,
  pausaSobre: (sobre: string) => `pausa sobre ${sobre}`,
  noRuntime: (encontrada: boolean) => `no runtime: ${encontrada ? 'sim' : 'nao'}`,
  modelo: (modelo: string, esforco: string) => `modelo ${modelo}/${esforco}`,
  motivo: (motivo: string) => `motivo ${motivo}`,
  veredito: (veredito: string) => `veredito: ${veredito}`,
  ocupacao: (ocupacao: string | null, fonte: string) => `ocupacao ${ocupacao === null ? 'nao medivel' : ocupacao} (${fonte})`,
  proximoSlug: (slug: string) => `proximo slug ${slug}`,
  acao: (acao: string) => `acao ${acao}`,
  pedido: (pedido: string) => `pedido ${pedido}`,
  rodada: (rodada: string) => `rodada ${rodada}`,
  cobertura: (cobertura: string) => `cobertura ${cobertura}`,
  liberaEm: (quando: string) => `libera em ${quando}`,
  tentativa: (tentativa: string, limite: string) => `tentativa ${tentativa}/${limite}`,
  remoto: (sha: string) => `remoto ${sha}`,
  pushProvado: (provado: boolean) => `push provado: ${provado ? 'sim' : 'nao'}`,
  autorizadoPor: (quem: string) => `autorizado por ${quem}`,
  sobre: (sobre: string) => `sobre ${sobre}`,
  ensaio: 'ensaio (--dry-run)',
  worktreeEm: (branch: string, dir: string) => `${branch} em ${dir}`,
  triagem: (inline: string, ponteiros: string, resumos: string) => `triagem ${inline} inline / ${ponteiros} ponteiros / ${resumos} resumos`,
  ponteiro: (local: string) => `ponteiro ${local}`,
  erro: (erro: string) => `erro: ${erro}`,
  modo: (modo: string) => `modo ${modo}`,
  usoList: 'uso: ork phase list <thread-id>',
  // ork phase run
  usoRun: 'uso: ork phase run <thread-id> <FASE> --prompt "<texto>"',
  canalUso: 'uso: --canal <claude-code|hermes|openclaw|codex|mcp|cli>',
  esperarUso: 'uso: --esperar [minutos], de 1 a 1440 (sem valor, 30)',
  aviso: (aviso: string) => `aviso: ${aviso}`,
  /** Rotulo do resumo (`  slug da sessao : valor`), na largura de 14. */
  rotulos: { slug: 'slug da sessao', prompt: 'prompt', sha256: 'sha256', pausaAoFim: 'pausa ao fim', runtime: 'runtime',
    modelo: 'modelo/esforco', comando: 'comando', sessionId: 'sessionId' },
  simulacao: 'Simulacao (--dry-run), nada foi despachado.',
  simNao: (sim: boolean): string => sim ? 'sim' : 'nao',
  despachada: (fase: string) => `Fase ${fase} despachada como background agent.`,
  modeloGravado: (modelo: string, esforco: string) => `${modelo}/${esforco} (gravado no ledger, veja \`ork phase list\`)`,
  verificada: (sim: boolean) => `  verificada no runtime: ${sim ? 'sim' : 'NAO (confira `ork sessions`)'}`,
  pausaNoFim: (sim: boolean) => `  pausa ao fim do bloco: ${sim ? 'sim' : 'nao (decisao autonoma no ledger)'}`,
  acompanheClaude: (sessao: string, id: string) => `Acompanhe: claude attach ${sessao}  |  ork phase list ${id}`,
  acompanhe: (id: string) => `Acompanhe: ork phase list ${id} (eventos do despacho no log da thread)`,
  vagaRecusada: (ocupam: number, limite: number) => `Despacho recusado: concurrency.limite. O projeto ja tem ${ocupam} sessao(oes) viva(s) ` +
    `em outras threads e o limite e ${limite} (concurrency.max_parallel_threads).`,
  despachoEmCurso: 'despacho em curso',
  desde: (quando: string) => `desde ${quando}`,
  correcao: (correcao: string) => `  correcao: ${correcao}`,
  vagaEnsaio: '  ensaio (--dry-run): nada foi gravado.',
  vagaLedger: (id: string) => `  evento slot_refused no ledger de ${id}; nenhuma sessao aberta.`,
  recusado: (erro: string) => `Despacho recusado: ${erro}`,
  baselinePendente: '  nenhuma sessao aberta; o ledger nao ganhou gate_blocked',
  bloqueado: (motivo: string) => `Despacho BLOQUEADO pelo gate tipado: ${motivo}`,
  violacaoCorrecao: (correcao: string) => `           correcao: ${correcao}`,
  promptNaoGravado: (id: string) => `  o prompt nao foi gravado em disco; evento gate_blocked no ledger de ${id}`,
  falhou: (erro: string) => `Despacho falhou: ${erro}`,
  falhouLedger: (id: string) => `  evento registrado no ledger de ${id}`,
  repetido: (fase: string, id: string, sha: string, desde: string) =>
    `Pedido ja em andamento: a fase ${fase} da thread ${id} roda com este mesmo prompt ` +
    `(sha256 ${sha}) desde ${desde}. Nenhuma sessao nova foi aberta e nenhuma cota foi gasta.`,
  acompanhar: (comando: string) => `  acompanhar: ${comando}`,
  /** Aviso de policy em `warn` (policies.ts): o detalhe e a correcao sao dado da policy avaliada. */
  avisoDaPolicy: (recuo: string, policy: string, detalhe: string) => `${recuo}aviso da policy ${policy}: ${detalhe}`,
  avisoCorrecao: (recuo: string, correcao: string) => `${recuo}  correcao: ${correcao}`,
  // thread.ts
  faseInvalida: (bruto: string, fases: string) => `fase invalida: "${bruto}" (esperado uma de ${fases})`,
  /** D14: erros de argumento de `phase run` que nascem no escopo pt-BR do despacho (`ErroDoCatalogo`). */
  runtimeDesconhecido: (nome: string, homologados: string) => `runtime de despacho desconhecido: "${nome}" (homologados: ${homologados})`,
  modeloAoTrocarRuntime: (origem: string, runtime: string) => `setup.model.required: ao trocar runtime de ${origem} para ${runtime}, ` +
    `informe --runtime ${runtime} --model <modelo> para este despacho; o setup do projeto permanece intacto.`,
  modeloPendente: (runtime: string) =>
    `setup.model.required: modelo pendente para ${runtime}; informe --model <modelo> neste despacho ou complete o bloco em ork setup.`,
};

export const PHASE_EN: typeof PHASE_PT_BR = {
  ledgerVazio: (id) => `Empty ledger for thread ${id}.`,
  colunas: ['WHEN', 'EVENT', 'DETAIL'],
  sessao: (id) => `session ${id}`,
  pausaSobre: (sobre) => `pause on ${sobre}`,
  noRuntime: (encontrada) => `in the runtime: ${encontrada ? 'yes' : 'no'}`,
  modelo: (modelo, esforco) => `model ${modelo}/${esforco}`,
  motivo: (motivo) => `reason ${motivo}`,
  veredito: (veredito) => `verdict: ${veredito}`,
  ocupacao: (ocupacao, fonte) => `occupancy ${ocupacao === null ? 'not measurable' : ocupacao} (${fonte})`,
  proximoSlug: (slug) => `next slug ${slug}`,
  acao: (acao) => `action ${acao}`,
  pedido: (pedido) => `request ${pedido}`,
  rodada: (rodada) => `round ${rodada}`,
  cobertura: (cobertura) => `coverage ${cobertura}`,
  liberaEm: (quando) => `released at ${quando}`,
  tentativa: (tentativa, limite) => `attempt ${tentativa}/${limite}`,
  remoto: (sha) => `remote ${sha}`,
  pushProvado: (provado) => `push proven: ${provado ? 'yes' : 'no'}`,
  autorizadoPor: (quem) => `authorized by ${quem}`,
  sobre: (sobre) => `about ${sobre}`,
  ensaio: 'dry run (--dry-run)',
  worktreeEm: (branch, dir) => `${branch} at ${dir}`,
  triagem: (inline, ponteiros, resumos) => `triage ${inline} inline / ${ponteiros} pointers / ${resumos} summaries`,
  ponteiro: (local) => `pointer ${local}`,
  erro: (erro) => `error: ${erro}`,
  modo: (modo) => `mode ${modo}`,
  usoList: 'usage: ork phase list <thread-id>',
  usoRun: 'usage: ork phase run <thread-id> <PHASE> --prompt "<text>"',
  canalUso: 'usage: --canal <claude-code|hermes|openclaw|codex|mcp|cli>',
  esperarUso: 'usage: --esperar [minutes], from 1 to 1440 (no value: 30)',
  aviso: (aviso) => `warning: ${aviso}`,
  rotulos: { slug: 'session slug', prompt: 'prompt', sha256: 'sha256', pausaAoFim: 'pause at end', runtime: 'runtime',
    modelo: 'model/effort', comando: 'command', sessionId: 'sessionId' },
  simulacao: 'Dry run (--dry-run): nothing was dispatched.',
  simNao: (sim) => sim ? 'yes' : 'no',
  despachada: (fase) => `Phase ${fase} dispatched as a background agent.`,
  modeloGravado: (modelo, esforco) => `${modelo}/${esforco} (recorded in the ledger, see \`ork phase list\`)`,
  verificada: (sim) => `  verified in the runtime: ${sim ? 'yes' : 'NO (check `ork sessions`)'}`,
  pausaNoFim: (sim) => `  pause at block end: ${sim ? 'yes' : 'no (autonomous decision in the ledger)'}`,
  acompanheClaude: (sessao, id) => `Follow: claude attach ${sessao}  |  ork phase list ${id}`,
  acompanhe: (id) => `Follow: ork phase list ${id} (dispatch events in the thread log)`,
  vagaRecusada: (ocupam, limite) => `Dispatch refused: concurrency.limite. The project already has ${ocupam} live session(s) ` +
    `in other threads and the limit is ${limite} (\`concurrency.max_parallel_threads\`).`,
  despachoEmCurso: 'dispatch in progress',
  desde: (quando) => `since ${quando}`,
  correcao: (correcao) => `  fix: ${correcao}`,
  vagaEnsaio: '  dry run (--dry-run): nothing was written.',
  vagaLedger: (id) => `  slot_refused event in the ${id} ledger; no session opened.`,
  recusado: (erro) => `Dispatch refused: ${erro}`,
  baselinePendente: '  no session opened; the ledger did not get gate_blocked',
  bloqueado: (motivo) => `Dispatch BLOCKED by the typed gate: ${motivo}`,
  violacaoCorrecao: (correcao) => `           fix: ${correcao}`,
  promptNaoGravado: (id) => `  the prompt was not written to disk; gate_blocked event in the ${id} ledger`,
  falhou: (erro) => `Dispatch failed: ${erro}`,
  falhouLedger: (id) => `  event recorded in the ${id} ledger`,
  repetido: (fase, id, sha, desde) =>
    `Request already in progress: phase ${fase} of thread ${id} runs with this same prompt ` +
    `(sha256 ${sha}) since ${desde}. No new session was opened and no quota was spent.`,
  acompanhar: (comando) => `  follow: ${comando}`,
  avisoDaPolicy: (recuo, policy, detalhe) => `${recuo}policy ${policy} warning: ${detalhe}`,
  avisoCorrecao: (recuo, correcao) => `${recuo}  fix: ${correcao}`,
  faseInvalida: (bruto, fases) => `invalid phase: "${bruto}" (expected one of ${fases})`,
  runtimeDesconhecido: (nome, homologados) => `unknown dispatch runtime: "${nome}" (supported: ${homologados})`,
  modeloAoTrocarRuntime: (origem, runtime) => `setup.model.required: switching the runtime from ${origem} to ${runtime} needs a model; ` +
    `pass \`--runtime ${runtime} --model <model>\` for this dispatch. The project setup stays as it is.`,
  modeloPendente: (runtime) =>
    `setup.model.required: no model set for ${runtime}; pass \`--model <model>\` in this dispatch or complete the block with \`ork setup\`.`,
};
