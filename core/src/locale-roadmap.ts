/**
 * RM-061, fatia F2b: a familia `roadmap` do catalogo de mensagens (`ork roadmap status` em texto; o `--json`
 * nao muda). O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * Sai como veio: o titulo e o que esta em aberto de cada item (dado do `docs/roadmap`), a pergunta que espera
 * o dono (dado do pedido HITL), o estado e o proximo passo da entrega (familia de entregas, G5) e o bloco
 * `Projeto consultado:` / `Não lido:` do RM-052, que os hosts leem e fica igual nas duas linguas (D14 da F2a).
 * O titulo do grupo e dado do contrato e so se traduz na impressao, pelo id. Data em ingles em ISO (D2 da RM-061).
 */

export const ROADMAP_PT_BR = {
  titulo: (projeto: string, p: { ano: string; mes: string; dia: string; hora: string; minuto: string }) =>
    `Roadmap do ${projeto} (${p.dia}/${p.mes}, ${p.hora}:${p.minuto})`,
  /** O titulo de cada grupo pelo id (o `--json` guarda o titulo pt-BR). */
  grupos: { concluidos: 'Concluídos', disponiveis: 'Disponíveis com algo em aberto', hoje: 'Entregue hoje', piloto: 'Piloto',
    desenvolvimento: 'Em desenvolvimento', refinamento: 'Refinamento', proposto: 'Proposto', descontinuado: 'Descontinuado' } as Record<string, string>,
  eMais: (n: number) => `• e mais ${n}`,
  precisaDeVoce: 'O que precisa de você',
  responda: (codigo: string, letra: string) => ` Responda ${codigo} ${letra} (ou outra letra).`,
  chegaNoResumo: ' A pergunta chega no próximo resumo.',
  nadaAgora: '• Nada agora.',
  foraDoRoadmap: (n: number) => `• Fora do roadmap: ${n} thread(s) esperam você (ork pulse).`,
  hitlDeConducao: (abertas: number, mediana: string) => `• HITL de condução: ${abertas} aberta(s); ${mediana}.`,
  emSeguida: 'O que eu faço em seguida',
  nadaEmAndamento: '• Nada em andamento; sigo o que você priorizar.',
  prLido: (hora: string) => ` (PR lido às ${hora})`,
  sigoComEstado: (item: string, thread: string, fase: string, maquina: string, estado: string, leitura: string) =>
    `• ${item}: sigo ${thread} na fase ${fase}${maquina}; ${estado}${leitura}.`,
  comEstado: (item: string, thread: string, fase: string, maquina: string, estado: string, leitura: string) =>
    `• ${item}: ${thread} na fase ${fase}${maquina}, ${estado}${leitura}.`,
  sigo: (item: string, thread: string, fase: string, maquina: string) => `• ${item}: sigo ${thread} na fase ${fase}${maquina}.`,
  /** RM-063 (F2): a thread sem sessao viva verificada no runtime: desde quando e por que (o estado da entrega, quando ha). */
  parada: (item: string, thread: string, maquina: string, desde: string | null, motivo: string, estado: string | null) =>
    `• ${item}: ${thread}${maquina} parada${desde ? ` desde ${desde}` : ''}: ${motivo}${estado ? `; ${estado}` : ''}.`,
  semSessaoVerificada: (item: string, thread: string, fase: string, maquina: string) =>
    `• ${item}: ${thread} na fase ${fase}${maquina}, sem sessão verificada no runtime.`,
  /** RM-063 (F2): a fila do `ork pulse` no fecho. */
  filaNaoLida: (detalhe: string | null) => `• Fila do pulse não lida inteira${detalhe ? ` (${detalhe})` : ''}: confira com ork pulse.`,
  responder: (comando: string) => ` Responder: ${comando}`,
  sessaoSemThread: (id: string) => `sessão ${id}`,
  /** RM-063 (F2): por que a thread parou, pelo tipo; o detalhe e dado (o ledger, o runtime). */
  motivoDaParada: {
    nenhumaSessao: (fase: string) => `nenhuma sessão despachada na fase ${fase}`,
    despachoFalhou: (fase: string | null, detalhe: string) => `despacho${fase ? ` de ${fase}` : ''} falhou (${detalhe})`,
    sessaoCaiu: (sessao: string, motivo: string) => `sessão ${sessao} caiu (${motivo})`,
    runtimeSemResposta: (runtime: string, detalhe: string | null, sessao: string) =>
      `runtime ${runtime} sem resposta${detalhe ? ` (${detalhe})` : ''}; a sessão ${sessao} não foi verificada`,
    naoAparece: (sessao: string) => `sessão ${sessao} não aparece no runtime`,
    fantasma: (sessao: string) => `sessão ${sessao} sem processo (fantasma)`,
    encerrada: (sessao: string, estado: string) => `sessão ${sessao} encerrada (${estado})`,
    naoLida: (detalhe: string) => `vida da sessão não lida (${detalhe})`,
    semAtividade: (sessao: string, minutos: number) => `sessão ${sessao} sem atividade no rollout há ${minutos} min`,
    retratoVelho: (minutos: number) => `retrato da máquina sem atualização há ${minutos} min; a sessão não foi reverificada`,
  },
  fabricaNaoLida: (motivo: string) => `Fábrica: não lido (${motivo}).`,
  fabricaSemCopia: (branch: string) => `esta máquina não tem cópia local de ${branch}`,
  fabricaClone: (branch: string) => `clone parcial: a cópia local de ${branch} não é lida sem rede`,
  fabricaIlegivel: (branch: string) => `a cópia local de ${branch} está ilegível`,
  fabricaVelha: (branch: string, ultimo: string | null) => `Fábrica: a cópia local de ${branch} está velha (${ultimo
    ? `esta máquina publicou nela por último em ${ultimo}` : 'esta máquina não aparece nela'}); não dá para dizer quem está sem batida.`,
  semBatida: (maquina: string, idade: string, retrato: string) => `${maquina} sem batida há ${idade} (último retrato ${retrato})`,
  fabricaSemBatida: (maquinas: string, branch: string) => `Fábrica: ${maquinas}, pela cópia local de ${branch}.`,
};

export const ROADMAP_EN: typeof ROADMAP_PT_BR = {
  titulo: (projeto, p) => `${projeto} roadmap (${p.ano}-${p.mes}-${p.dia} ${p.hora}:${p.minuto})`,
  grupos: { concluidos: 'Done', disponiveis: 'Available with something open', hoje: 'Shipped today', piloto: 'Pilot',
    desenvolvimento: 'In development', refinamento: 'Refinement', proposto: 'Proposed', descontinuado: 'Discontinued' },
  eMais: (n) => `• and ${n} more`,
  precisaDeVoce: 'What needs you',
  responda: (codigo, letra) => ` Reply ${codigo} ${letra} (or another letter).`,
  chegaNoResumo: ' The question comes in the next summary.',
  nadaAgora: '• Nothing right now.',
  foraDoRoadmap: (n) => `• Outside the roadmap: ${n} thread(s) waiting for you (\`ork pulse\`).`,
  hitlDeConducao: (abertas, mediana) => `• Conduction HITL: ${abertas} open; ${mediana}.`,
  emSeguida: 'What I do next',
  nadaEmAndamento: '• Nothing in progress; next is whatever you prioritize.',
  prLido: (hora) => ` (PR read at ${hora})`,
  sigoComEstado: (item, thread, fase, maquina, estado, leitura) => `• ${item}: I continue with ${thread} in phase ${fase}${maquina}; ${estado}${leitura}.`,
  comEstado: (item, thread, fase, maquina, estado, leitura) => `• ${item}: ${thread} in phase ${fase}${maquina}, ${estado}${leitura}.`,
  sigo: (item, thread, fase, maquina) => `• ${item}: I continue with ${thread} in phase ${fase}${maquina}.`,
  parada: (item, thread, maquina, desde, motivo, estado) =>
    `• ${item}: ${thread}${maquina} stopped${desde ? ` since ${desde}` : ''}: ${motivo}${estado ? `; ${estado}` : ''}.`,
  semSessaoVerificada: (item, thread, fase, maquina) => `• ${item}: ${thread} in phase ${fase}${maquina}, no session verified in the runtime.`,
  filaNaoLida: (detalhe) => `• Pulse queue not fully read${detalhe ? ` (${detalhe})` : ''}: check \`ork pulse\`.`,
  responder: (comando) => ` Reply: ${comando}`,
  sessaoSemThread: (id) => `session ${id}`,
  motivoDaParada: {
    nenhumaSessao: (fase) => `no session dispatched in phase ${fase}`,
    despachoFalhou: (fase, detalhe) => `dispatch${fase ? ` of ${fase}` : ''} failed (${detalhe})`,
    sessaoCaiu: (sessao, motivo) => `session ${sessao} went down (${motivo})`,
    runtimeSemResposta: (runtime, detalhe, sessao) => `runtime ${runtime} not responding${detalhe ? ` (${detalhe})` : ''}; session ${sessao} was not verified`,
    naoAparece: (sessao) => `session ${sessao} does not appear in the runtime`,
    fantasma: (sessao) => `session ${sessao} with no process (ghost)`,
    encerrada: (sessao, estado) => `session ${sessao} ended (${estado})`,
    naoLida: (detalhe) => `session liveness not read (${detalhe})`,
    semAtividade: (sessao, minutos) => `session ${sessao} with no rollout activity for ${minutos} min`,
    retratoVelho: (minutos) => `machine snapshot not updated for ${minutos} min; the session was not re-verified`,
  },
  fabricaNaoLida: (motivo) => `Factory: not read (${motivo}).`,
  fabricaSemCopia: (branch) => `this machine has no local copy of ${branch}`,
  fabricaClone: (branch) => `partial clone: the local copy of ${branch} is not read without network`,
  fabricaIlegivel: (branch) => `the local copy of ${branch} is unreadable`,
  fabricaVelha: (branch, ultimo) => `Factory: the local copy of ${branch} is stale (${ultimo
    ? `this machine last published to it at ${ultimo}` : 'this machine does not appear in it'}); there is no telling which machine has no heartbeat.`,
  semBatida: (maquina, idade, retrato) => `${maquina} with no heartbeat for ${idade} (last snapshot ${retrato})`,
  fabricaSemBatida: (maquinas, branch) => `Factory: ${maquinas}, from the local copy of ${branch}.`,
};
