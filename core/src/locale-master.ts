/**
 * RM-061, fatia F2b: a familia `master` do catalogo de mensagens (`ork master`, o indice das entregas;
 * `ork master [<thread>] --aceitar-omissao`; e `ork master pedir`). O pt-BR e a fonte; o ingles e tipado
 * por ele. Sem import do nucleo.
 *
 * O MASTER log, o POSTMORTEM e o registro da omissao sao dado e nascem em pt-BR, no escopo da gravacao; o
 * catalogo traduz o que o comando imprime em volta deles. A nota pedida pelo canal segue o formato de
 * resposta `<codigo> <0 a 5> <porque>` nas duas linguas (o leitor do canal so olha o codigo e o numero).
 */

export const MASTER_PT_BR = {
  // ork master: o indice
  semEntregaTodas: 'Nenhuma thread aberta sem score.',
  semEntrega: 'Nenhuma entrega esperando decisao. Para ver tambem as que ainda nao entregaram: ork master --todas',
  entregas: (n: number) => `Entregas (${n}) com o indice ja derivado do ledger. O numero nao foi digitado por ninguem.`,
  colunas: ['ID', 'SLUG', 'MODO', 'FASE', 'STATUS', 'ENTREGOU', 'INDICE', 'DE ONDE VEIO'] as readonly string[],
  simNao: (sim: boolean): string => sim ? 'sim' : 'nao',
  semTropeco: 'sem tropeco',
  entregueEAceito: 'ENTREGUE E ACEITO, a menos que voce diga o contrario.',
  aceitarEsta: '  ork master <id> --aceitar-omissao     aceita so esta entrega, com o indice e os insumos no ledger',
  aceitarTodas: '  ork master --aceitar-omissao          aceita TODAS as entregues da lista (--dry-run mostra quais, sem gravar)',
  reclamar: '  ork master <id> --score <0-5> --justificativa "<por que>" --por <humano>   se quiser reclamar',
  classesFixas: (classes: string) => `Classes fixas: ${classes}`,
  aceitasTitulo: (n: number) => `Aceitas por omissao (${n}): o que passou sem voce olhar.`,
  colunasAceitas: ['ID', 'INDICE', 'SCORE GRAVADO', 'ACEITA EM'] as readonly string[],
  caiuDepois: (n: number, threads: string) => `ATENCAO: ${n} entrega(s) cairam DEPOIS de aceitas: ${threads}.`,
  caiuDepoisLinha1: '  O MASTER log e contrato congelado e nao se reescreve sozinho. Pontue para o',
  caiuDepoisLinha2: '  registro humano alcancar o fato; o registro da omissao permanece no ledger.',
  discordouDeAlguma: 'Discordou de alguma? A nota humana sobrescreve, e o registro da omissao permanece:',
  pontuar: '  ork master <thread-id> --score <0-5> --justificativa "<por que>" --por <humano>',
  // ork master --aceitar-omissao
  usoOmissao: 'uso: ork master <thread-id> --aceitar-omissao [--dry-run] [--json]   (ou --thread <thread-id>, uma thread so)',
  ensaio: 'Ensaio (--dry-run): nada foi gravado.',
  nadaEsperando: 'Nenhuma entrega esperando decisao.',
  fecharia: (n: number) => `Fecharia por omissao: ${n}.`,
  linhaDoIndice: (thread: string, valor: number, base: number) => `  ${thread.padEnd(20)} indice ${valor}/${base}`,
  aceitas: (n: number) => `Aceitas por omissao: ${n}. O indice e os insumos foram ao ledger.`,
  discordou: 'Discordou? A nota humana sobrescreve, e o registro da omissao permanece.',
  foraAdmin: (id: string, motivo: string) => `a thread ${id} foi fechada administrativamente (${motivo}); nao ha entrega para aceitar.`,
  foraJaFechada: (id: string) => `a thread ${id} ja tem MASTER registrado; nada a aceitar.`,
  foraSemEntrega: (id: string) =>
    `a thread ${id} ainda nao entregou (sem ship_done no ledger); registre a entrega antes: ork ship registrar-pr ${id}`,
  avisoSemThread: (marca: string, ensaio: boolean, n: number) => `aviso: master.omissao-sem-thread: processo de agente (${marca}) ` +
    `${ensaio ? 'fecharia' : 'fechou'} ${n} threads, inclusive as de outras frentes paralelas.`,
  avisoSoASua: (propria: string, ensaio: boolean) => `  Para fechar so a sua: ork master ${propria} --aceitar-omissao` +
    (ensaio ? '' : '  (a nota humana sobrescreve o aceite de quem nao era seu)'),
  /** A marca de host do processo, como `marcaDeHost` a nomeia. */
  marcaDespachada: 'sessão despachada (ORK_DISPATCH_ID)',
  // ork master pedir
  usoPedir: 'uso: ork master pedir <thread> [--formato telegram|terminal|json]',
  notaTitulo: (telegram: boolean, thread: string, nome: string) => `${telegram ? '🧾 ' : ''}Nota da entrega ${thread} (${nome})`,
  notaSemNota: (telegram: boolean) => `${telegram ? '• ' : '- '}Sem nota, vale a aceita por omissão, com o índice derivado do ledger ao lado.`,
  notaResponda: (telegram: boolean, codigo: string) =>
    `${telegram ? '↩️ ' : ''}Responda: ${codigo} <0 a 5> <porquê>, por exemplo: ${codigo} 4 entregou o que pedi.`,
  // thread-close.ts: a entrega que o MASTER exige
  encerradaAdmin: 'thread encerrada administrativamente não pode receber MASTER',
  exigeEntrega: 'MASTER exige entrega: ship_done ou artefato existente com hash verificado',
};

export const MASTER_EN: typeof MASTER_PT_BR = {
  semEntregaTodas: 'No open thread without a score.',
  semEntrega: 'No delivery waiting for a decision. To also see the ones that have not shipped yet: `ork master --todas`',
  entregas: (n) => `Deliveries (${n}), with the index already derived from the ledger. Nobody typed the number.`,
  colunas: ['ID', 'SLUG', 'MODE', 'PHASE', 'STATUS', 'SHIPPED', 'INDEX', 'WHERE IT CAME FROM'],
  simNao: (sim) => sim ? 'yes' : 'no',
  semTropeco: 'no setbacks',
  entregueEAceito: 'SHIPPED AND ACCEPTED, unless you say otherwise.',
  aceitarEsta: '  ork master <id> --aceitar-omissao     accepts only this delivery, with the index and its inputs in the ledger',
  aceitarTodas: '  ork master --aceitar-omissao          accepts ALL shipped deliveries in the list (`--dry-run` shows which, without writing)',
  reclamar: '  ork master <id> --score <0-5> --justificativa "<why>" --por <human>   if you want to dispute it',
  classesFixas: (classes) => `Fixed classes: ${classes}`,
  aceitasTitulo: (n) => `Accepted by default (${n}): what went through without you looking.`,
  colunasAceitas: ['ID', 'INDEX', 'RECORDED SCORE', 'ACCEPTED AT'],
  caiuDepois: (n, threads) => `WARNING: ${n} delivery(ies) dropped AFTER being accepted: ${threads}.`,
  caiuDepoisLinha1: '  The MASTER log is a frozen contract and does not rewrite itself. Score it so the',
  caiuDepoisLinha2: '  human record reaches the fact; the record of the default acceptance stays in the ledger.',
  discordouDeAlguma: 'Disagree with any? A human score overrides it, and the record of the default acceptance stays:',
  pontuar: '  ork master <thread-id> --score <0-5> --justificativa "<why>" --por <human>',
  usoOmissao: 'usage: ork master <thread-id> --aceitar-omissao [--dry-run] [--json]   (or --thread <thread-id>, a single thread)',
  ensaio: 'Dry run (--dry-run): nothing was written.',
  nadaEsperando: 'No delivery waiting for a decision.',
  fecharia: (n) => `Would close by default: ${n}.`,
  linhaDoIndice: (thread, valor, base) => `  ${thread.padEnd(20)} index ${valor}/${base}`,
  aceitas: (n) => `Accepted by default: ${n}. The index and its inputs went to the ledger.`,
  discordou: 'Disagree? A human score overrides it, and the record of the default acceptance stays.',
  foraAdmin: (id, motivo) => `thread ${id} was closed administratively (${motivo}); there is no delivery to accept.`,
  foraJaFechada: (id) => `thread ${id} already has a MASTER recorded; nothing to accept.`,
  foraSemEntrega: (id) =>
    `thread ${id} has not shipped yet (no ship_done in the ledger); record the delivery first: ork ship registrar-pr ${id}`,
  avisoSemThread: (marca, ensaio, n) => `warning: master.omissao-sem-thread: an agent process (${marca}) ` +
    `${ensaio ? 'would close' : 'closed'} ${n} threads, including those of other parallel workstreams.`,
  avisoSoASua: (propria, ensaio) => `  To close only yours: ork master ${propria} --aceitar-omissao` +
    (ensaio ? '' : '  (a human score overrides the acceptance of what was not yours)'),
  marcaDespachada: 'dispatched session (ORK_DISPATCH_ID)',
  usoPedir: 'usage: ork master pedir <thread> [--formato telegram|terminal|json]',
  notaTitulo: (telegram, thread, nome) => `${telegram ? '🧾 ' : ''}Score for delivery ${thread} (${nome})`,
  notaSemNota: (telegram) => `${telegram ? '• ' : '- '}With no score, the default acceptance stands, with the index derived from the ledger next to it.`,
  notaResponda: (telegram, codigo) =>
    `${telegram ? '↩️ ' : ''}Reply: ${codigo} <0 to 5> <why>, for example: ${codigo} 4 delivered what I asked for.`,
  encerradaAdmin: 'a thread closed administratively cannot receive a MASTER',
  exigeEntrega: 'MASTER needs a delivery: ship_done or an existing artifact with a verified hash',
};
