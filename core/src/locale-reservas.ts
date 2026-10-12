/**
 * RM-061, fatia F3b: a familia `reservas` do catalogo de mensagens (`ork roadmap reservas|pegar|soltar|feat`), o painel
 * das reservas no terminal e as recusas de `roadmap-reservas.ts`. O pt-BR e a fonte; o ingles e tipado por ele. Sem
 * import do nucleo.
 *
 * O item, quem reservou, a maquina, a thread e a nota sao dado e saem iguais. O detalhe da soltura de uma reserva orfa
 * vai ao ledger e ao `--json` em pt-BR e so a impressao o remonta. O painel em Markdown da branch de reservas e a
 * mensagem de commit nao mudam com a lingua; o bloco `Projeto consultado:` e `Não lido:` do RM-052 sai igual nas duas.
 */

export const RESERVAS_PT_BR = {
  // O painel no terminal
  semRemoto: (projeto: string | null, remoto: string, branch: string) =>
    `Reservas do roadmap: ${projeto ? `o projeto ${projeto}` : 'o projeto'} não tem o remoto ${remoto}; nada foi lido de ${branch}.`,
  semCopia: (remoto: string, branch: string) =>
    `Reservas do roadmap: o remoto ${remoto} não respondeu e esta máquina não tem cópia de ${branch}; nada foi lido.`,
  copiaLocal: 'AVISO: sem acesso ao remoto; esta e a ultima copia lida nesta maquina.',
  nenhuma: 'Nenhum item do roadmap reservado.',
  numerosDeFeat: (n: number, ultimos: string) => `Números de FEAT reservados (${n}), os últimos: ${ultimos}. O próximo sai de: ork roadmap feat`,
  cabecalho: 'ITEM     COM QUEM            MAQUINA         THREAD             DESDE',
  orfa: (sucessora: string | null) => `  ÓRFÃ: thread fechada${sucessora ? `, passa para ${sucessora}` : ''}`,
  orfas: (n: number) => `${n} reserva(s) órfã(s) desta máquina. Para soltar: ork roadmap reservas --soltar-orfas`,
  // ork roadmap reservas --soltar-orfas
  nenhumaOrfa: 'Nenhuma reserva órfã desta máquina.',
  soltura: (item: string, detalhe: string, thread: string) => `${item}: ${detalhe} (thread fechada ${thread})`,
  mudouDeDono: (item: string) => `${item} mudou de dono entre a leitura e a gravacao; ficou como estava`,
  passouPara: (item: string, sucessora: string) => `${item} passou para a thread ${sucessora}, aberta no mesmo item`,
  devolvido: (item: string) => `${item} devolvido`,
  semLeituraPendente: (branch: string, remoto: string) => `sem leitura de ${branch} em ${remoto}; a reserva fica para depois`,
  soQuemPegou: (descricao: string) => `${descricao}; so quem pegou solta, ou --forcar --motivo`,
  // ork roadmap feat
  feat: (feat: string, thread: string | null) => `${feat}: reservado para esta maquina${thread ? `, thread ${thread}` : ''}.`,
  crieAPagina: (feat: string) => `  crie docs/produto/${feat}-<assunto>.md; o numero nao volta, mesmo que a feature nao saia`,
  branch: (commit: string) => `  branch ork/roadmap-reservas em ${commit}`,
  // ork roadmap pegar e soltar
  acao: (acao: string) => ({ pegou: 'reservado para esta maquina', renovou: 'reserva renovada', tomou: 'reserva TOMADA de outra maquina',
    soltou: 'devolvido', nada: 'ja estava livre' } as Record<string, string>)[acao] ?? acao,
  itemAcao: (item: string, acao: string) => `${item}: ${acao}.`,
  com: (por: string, maquina: string, thread: string | null) => `  com ${por} em ${maquina}${thread ? `, thread ${thread}` : ''}`,
  uso: 'uso: ork roadmap status [--json] | reservas [--soltar-orfas] | pegar <RM-NNN> [--thread T] [--nota N] | ' +
    'soltar <RM-NNN> [--forcar --motivo M] | feat [--thread T] [--nota N]',
  // As recusas (roadmap-reservas.ts)
  descricao: (item: string, por: string, maquina: string, desde: string, thread: string | null) =>
    `${item} esta com ${por} em ${maquina} desde ${desde}${thread ? ` (thread ${thread})` : ''}`,
  semRemotoParaReservar: (branch: string, remoto: string) => `roadmap.sem-remoto: nao consegui ler ${branch} em ${remoto}; reservar exige rede`,
  semRemotoParaSoltar: (branch: string, remoto: string) => `roadmap.sem-remoto: nao consegui ler ${branch} em ${remoto}; soltar exige rede`,
  semRemotoParaOrfas: (branch: string) => `roadmap.sem-remoto: nao consegui ler ${branch}; soltar exige rede`,
  featsAcabaram: 'roadmap.feat: os numeros de FEAT de tres digitos acabaram',
  concorrencia: (n: number) => `roadmap.concorrencia: ${n} pushes recusados seguidos; tente de novo em instantes`,
  forcarSemMotivo: 'roadmap.forcar: --forcar exige --motivo (tomar a reserva de outra maquina e decisao registrada)',
  reservadoAoPegar: (descricao: string) => `roadmap.reservado: ${descricao}. Escolha outro item ou combine com quem esta nele`,
  reservadoAoSoltar: (descricao: string) => `roadmap.reservado: ${descricao}; so quem pegou solta, ou --forcar --motivo`,
};

export type MensagensDeReservas = typeof RESERVAS_PT_BR;

export const RESERVAS_EN: MensagensDeReservas = {
  semRemoto: (projeto, remoto, branch) =>
    `Roadmap reservations: ${projeto ? `project ${projeto}` : 'the project'} has no remote ${remoto}; nothing was read from ${branch}.`,
  semCopia: (remoto, branch) => `Roadmap reservations: remote ${remoto} did not answer and this machine has no copy of ${branch}; nothing was read.`,
  copiaLocal: 'WARNING: no access to the remote; this is the last copy read on this machine.',
  nenhuma: 'No roadmap item reserved.',
  numerosDeFeat: (n, ultimos) => `FEAT numbers reserved (${n}), the latest: ${ultimos}. The next one comes from: ork roadmap feat`,
  cabecalho: 'ITEM     WITH                MACHINE         THREAD             SINCE',
  orfa: (sucessora) => `  ORPHAN: closed thread${sucessora ? `, goes to ${sucessora}` : ''}`,
  orfas: (n) => `${n} orphan reservation(s) on this machine. To release them: ork roadmap reservas --soltar-orfas`,
  nenhumaOrfa: 'No orphan reservation on this machine.',
  soltura: (item, detalhe, thread) => `${item}: ${detalhe} (closed thread ${thread})`,
  mudouDeDono: (item) => `${item} changed owner between the read and the write; it was left as it was`,
  passouPara: (item, sucessora) => `${item} went to thread ${sucessora}, open on the same item`,
  devolvido: (item) => `${item} released`,
  semLeituraPendente: (branch, remoto) => `no read of ${branch} in ${remoto}; the reservation is left for later`,
  soQuemPegou: (descricao) => `${descricao}; only whoever took it releases it, or \`--forcar --motivo\``,
  feat: (feat, thread) => `${feat}: reserved for this machine${thread ? `, thread ${thread}` : ''}.`,
  crieAPagina: (feat) => `  create \`docs/produto/${feat}-<subject>.md\`; the number does not come back, even if the feature never ships`,
  branch: (commit) => `  branch ork/roadmap-reservas at ${commit}`,
  acao: (acao) => ({ pegou: 'reserved for this machine', renovou: 'reservation renewed', tomou: 'reservation TAKEN from another machine',
    soltou: 'released', nada: 'was already free' } as Record<string, string>)[acao] ?? acao,
  itemAcao: (item, acao) => `${item}: ${acao}.`,
  com: (por, maquina, thread) => `  with ${por} on ${maquina}${thread ? `, thread ${thread}` : ''}`,
  uso: 'usage: ork roadmap status [--json] | reservas [--soltar-orfas] | pegar <RM-NNN> [--thread T] [--nota N] | ' +
    'soltar <RM-NNN> [--forcar --motivo M] | feat [--thread T] [--nota N]',
  descricao: (item, por, maquina, desde, thread) => `${item} is with ${por} on ${maquina} since ${desde}${thread ? ` (thread ${thread})` : ''}`,
  semRemotoParaReservar: (branch, remoto) => `roadmap.sem-remoto: could not read ${branch} in ${remoto}; reserving needs the network`,
  semRemotoParaSoltar: (branch, remoto) => `roadmap.sem-remoto: could not read ${branch} in ${remoto}; releasing needs the network`,
  semRemotoParaOrfas: (branch) => `roadmap.sem-remoto: could not read ${branch}; releasing needs the network`,
  featsAcabaram: 'roadmap.feat: the three-digit FEAT numbers ran out',
  concorrencia: (n) => `roadmap.concorrencia: ${n} pushes refused in a row; try again in a moment`,
  forcarSemMotivo: 'roadmap.forcar: `--forcar` needs `--motivo` (taking another machine\'s reservation is a recorded decision)',
  reservadoAoPegar: (descricao) => `roadmap.reservado: ${descricao}. Pick another item or talk to whoever is on it`,
  reservadoAoSoltar: (descricao) => `roadmap.reservado: ${descricao}; only whoever took it releases it, or \`--forcar --motivo\``,
};
