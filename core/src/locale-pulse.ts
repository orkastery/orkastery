/**
 * RM-061, fatia F2b: a familia `pulse` do catalogo de mensagens (`ork pulse` em texto; o `--json` nao muda).
 * O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O pulse junta dado de muitas fontes. Sai como veio: a pergunta e as opcoes de um pedido HITL, a tela de
 * uma sessao, o detalhe e a correcao de um gate no ledger, o codigo e o erro de um diagnostico, e o proximo
 * passo de uma thread parada no condutor (G5 da F2b). A pergunta que o proprio pulse monta (fase sem
 * heartbeat) e o detalhe do runtime nascem em pt-BR (o `--json` os guarda) e saem remontados (G2).
 */

export const PULSE_PT_BR = {
  cabecalho: (contrato: string, quando: string) => `Pulse (${contrato}) ${quando}`,
  precisaDeHumano: (n: number) => `Precisa de humano agora: ${n}`,
  semNota: (n: number) => `${n} entrega(s) sem nota, aceitas por padrão com registro`,
  diagnostico: (detalhe: string) => `[diagnostico] ${detalhe}`,
  consultaIncompleta: (detalhe: string) => `[consulta incompleta] ${detalhe}`,
  item: (quem: string, classe: string, minutos: string) => `${quem} [${classe}] ${minutos} min`,
  desconhecido: 'desconhecido',
  menosDeUm: 'menos de 1',
  opcao: (opcao: string) => `  opção: ${opcao}`,
  recomendacao: (texto: string) => `Recomendação: ${texto}`,
  responder: (comando: string) => `Responder: ${comando}`,
  log: (linha: string) => `  log: ${linha}`,
  conduzidas: (n: number) => `Conduzidas agora: ${n}`,
  conducao: (thread: string, linha: string) => `${thread}: ${linha}`,
  paradoNoCondutor: (n: number) => `Parado no condutor: ${n}`,
  /** A linha do condutor (hitl-resumo.ts): a mesma frase no pulse, no resumo e no status do roadmap. */
  linhaDoCondutor: (thread: string, desde: string, proximoPasso: string) => `${thread} parado no condutor desde ${desde}: ${proximoPasso}`,
  hitlDeConducao: (abertas: number, mediana: string) => `HITL de condução: ${abertas} aberta(s); ${mediana}`,
  /** hitl-tempo-parado.ts: a mediana dos 7 dias e a pergunta de conducao parada. */
  medianaSemResposta: 'mediana de 7 dias sem resposta medida',
  mediana: (minutos: string, dentro: boolean | null, respondidos: number) =>
    `mediana de 7 dias ${minutos} (${dentro ? 'dentro' : 'acima'} da meta de 5 min, ${respondidos} resposta(s))`,
  perguntaParada: (thread: string, fase: string, ha: string, desde: string) => `${thread} (${fase}) parada há ${ha}, desde ${desde}`,
  automaticas: (n: number) => `Ações automáticas pendentes: ${n}`,
  automatica: (thread: string, motivo: string, comando: string) => `${thread}: ${motivo}; ${comando}`,
  // pulse.ts: o que o proprio pulse monta (vai ao --json)
  semHeartbeat: (fase: string, desde: string) => `Fase ${fase} sem heartbeat desde ${desde}.`,
  semRuntime: 'runtime não consultado por --sem-runtime',
  telasAdiadas: (n: number) => `radar.orcamento: ${n} tela(s) de sessão ficaram para a próxima varredura`,
};

export const PULSE_EN: typeof PULSE_PT_BR = {
  cabecalho: (contrato, quando) => `Pulse (${contrato}) ${quando}`,
  precisaDeHumano: (n) => `Needs a human now: ${n}`,
  semNota: (n) => `${n} delivery(ies) without a score, accepted by default with a record`,
  diagnostico: (detalhe) => `[diagnostic] ${detalhe}`,
  consultaIncompleta: (detalhe) => `[incomplete query] ${detalhe}`,
  item: (quem, classe, minutos) => `${quem} [${classe}] ${minutos} min`,
  desconhecido: 'unknown',
  menosDeUm: 'less than 1',
  opcao: (opcao) => `  option: ${opcao}`,
  recomendacao: (texto) => `Recommendation: ${texto}`,
  responder: (comando) => `Reply: ${comando}`,
  log: (linha) => `  log: ${linha}`,
  conduzidas: (n) => `Conducted now: ${n}`,
  conducao: (thread, linha) => `${thread}: ${linha}`,
  paradoNoCondutor: (n) => `Parked at the conductor: ${n}`,
  linhaDoCondutor: (thread, desde, proximoPasso) => `${thread} parked at the conductor since ${desde}: ${proximoPasso}`,
  hitlDeConducao: (abertas, mediana) => `Conduction HITL: ${abertas} open; ${mediana}`,
  medianaSemResposta: '7-day median with no measured answer',
  mediana: (minutos, dentro, respondidos) =>
    `7-day median ${minutos} (${dentro ? 'within' : 'above'} the 5 min target, ${respondidos} answer(s))`,
  perguntaParada: (thread, fase, ha, desde) => `${thread} (${fase}) stopped for ${ha}, since ${desde}`,
  automaticas: (n) => `Pending automatic actions: ${n}`,
  automatica: (thread, motivo, comando) => `${thread}: ${motivo}; ${comando}`,
  semHeartbeat: (fase, desde) => `Phase ${fase} with no heartbeat since ${desde}.`,
  semRuntime: 'runtime not queried because of --sem-runtime',
  telasAdiadas: (n) => `radar.orcamento: ${n} session screen(s) left for the next scan`,
};
