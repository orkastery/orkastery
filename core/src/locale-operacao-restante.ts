/**
 * RM-061, F3d: mensagens das familias operacionais que ainda estavam fora do catalogo.
 *
 * Os valores vindos do runtime, do ledger ou de outro processo continuam dados: este
 * catalogo traduz somente a moldura que o CLI monta para uma pessoa.
 */

export const OPERACAO_RESTANTE_PT_BR = {
  sessions: {
    atencao: (valor: string) => `--atencao espera minutos (inteiro >= 0), recebeu "${valor}"`,
    usoWatch: 'uso: ork sessions watch --thread T [--sessao ID] [--once]',
    sessaoDaThread: 'sessão não pertence à thread',
    usoEvent: 'uso: ork sessions event --tipo <tipo> --sessao <id> < payload.json (máximo 16384 bytes)',
    eventoRecusado: (detalhe: string) => `evento recusado: ${detalhe}`,
    exigeProjeto: 'ork sessions limpar-fantasmas precisa de um projeto (orkastery.yaml)',
    request: 'sessions request exige thread, UUID, --fase e --runtime; --pergunta só confere o conteúdo nativo',
    answer: 'sessions answer exige thread, pedido e envelope autenticado em --stdin',
    reconcile: 'sessions reconcile exige thread e pedido',
    supersede: 'sessions supersede exige thread, UUID, --fase e --runtime',
    usoSub: (sub: string) => `uso: ork sessions ${sub} <sessao>`,
    desconhecido: (sub: string | undefined) => `subcomando desconhecido: sessions ${sub}`,
    inventario: {
      abertura: (global: boolean, usuario: string, historico: boolean) =>
        `Inventário ${global ? 'global' : 'do projeto'} da conta ${usuario}; histórico: ${historico ? 'incluído' : 'omitido'}.`,
      fontes: (valor: string) => `Fontes: ${valor}`,
      fonteEstado: { ausente: 'ausente', ok: 'ok', falha: 'FALHA' } as Record<string, string>,
      resumo: (total: number, semThread: number, ambiguas: number, fantasmas: number, ok: boolean) =>
        `Total: ${total}; sem thread: ${semThread}; ambíguas: ${ambiguas}; fantasmas: ${fantasmas}; consulta: ${ok ? 'válida' : 'INCOMPLETA'}.`,
      colunas: ['ID', 'RUNTIME', 'PERFIL', 'ESTADO', 'THREAD/FASE'] as readonly string[],
      processo: 'processo', desconhecido: 'unknown', fantasma: 'fantasma', fora: '(fora do ork)',
      explicacaoFantasma: 'Fantasma: registro sem processo vivo, não ocupa vaga; `ork sessions limpar-fantasmas` solta o vínculo do ork sem tocar no runtime.',
      falha: (detalhe: string) => `Falha: ${detalhe}`,
      ausente: (detalhe: string, correcao: string | null) => `Ausente: ${detalhe}${correcao ? `; correção: ${correcao}` : ''}`,
    },
    localizar: {
      ambigua: (chave: string, contas: string) => `sessao "${chave}" encontrada em mais de uma conta: ${contas}; use o id completo`,
      ausente: (chave: string, falhas: string) => `sessao "${chave}" nao encontrada no runtime${falhas ? `; contas sem resposta: ${falhas}` : ''}`,
      parada: (id: string, perfil: string | null) => `sessao ${id} parada${perfil ? ` (perfil ${perfil})` : ''}`,
    },
    limpeza: {
      nenhuma: (parcial: boolean) => `Nenhuma sessão fantasma${parcial ? ' nas contas que responderam' : ''}.`,
      falha: (detalhe: string) => `Falha: ${detalhe}`,
      acoes: {
        soltaria: 'soltaria (sessao_morta no ledger)', solto: 'solto: sessao_morta no ledger',
        jaSolto: 'já encerrada no ledger', semThread: 'fora do ork: nada a soltar',
        outroProjeto: 'vínculo de outro projeto: rode lá',
      },
      abertura: (ensaio: boolean) =>
        `Sessões fantasma (sem pid e sem processo)${ensaio ? ', ensaio: nada foi gravado' : ''}. O runtime não foi tocado.`,
      colunas: ['ID', 'PERFIL', 'THREAD/FASE', 'AÇÃO'] as readonly string[],
      processo: 'processo',
    },
    radar: {
      titulo: (total: number) => `Radar de sessoes do runtime (${total} sessao(oes) na maquina)`,
      resumo: (humanas: number, hitl: number, abandonadas: number, falhas: number, desconhecidas: number, trabalhando: number, fora: number) =>
        `  precisam de humano: ${humanas} (HITL vivo ${hitl}, abandonada ${abandonadas}, falha ${falhas}, ` +
        `estado desconhecido ${desconhecidas}) | trabalhando: ${trabalhando} | fora do ork: ${fora}`,
      limite: (minutos: number, acima: number) => `  limite de atencao: ${minutos} min (${acima} parada(s) acima, marcadas com !)`,
      falha: (detalhe: string) => `  [fail] ${detalhe}: NAO da para saber quem esta parado`,
      semLogs: '  [warn] --sem-logs: o radar diz QUEM esta parado, mas nao O QUE cada sessao pergunta',
      nenhuma: '  Nenhuma sessao na varredura.',
      colunas: ['ID', 'NOME', 'CLASSE', 'ESTADO', 'TIPO', 'DIRETORIO', 'THREAD', 'IDADE'] as readonly string[],
      vazio: '(vazio)', fora: 'fora do ork', nenhumaEsperando: '  Nenhuma sessao esperando o humano.',
      vivas: 'Esperando o HUMANO agora, com o job VIVO (responder destrava na hora):',
      mortas: 'MORRERAM esperando resposta (job ja saiu: nao adianta responder, o trabalho parou):',
      onde: 'onde', porque: 'por que', pergunta: 'pergunta', log: 'log', opcao: 'opcao',
      parada: 'parada ha', viva: 'viva ha', ver: 'ver', responder: 'responder', recomendo: 'recomendo',
      thread: (id: string, fase: string) => `thread ${id}, fase ${fase}`,
      sessaoFora: 'sessao fora do ork',
      paradaDesconhecida: 'desconhecido; registre com --registrar',
      desdeObservacao: 'desde a primeira observação', idade: 'idade da sessao', desdeInicio: 'desde que a sessao comecou',
    },
  },
};

export const OPERACAO_RESTANTE_EN: typeof OPERACAO_RESTANTE_PT_BR = {
  sessions: {
    atencao: (value) => `--atencao expects minutes (integer >= 0), received "${value}"`,
    usoWatch: 'usage: ork sessions watch --thread T [--sessao ID] [--once]',
    sessaoDaThread: 'session does not belong to the thread',
    usoEvent: 'usage: ork sessions event --tipo <type> --sessao <id> < payload.json (maximum 16384 bytes)',
    eventoRecusado: (detail) => `event rejected: ${detail}`,
    exigeProjeto: 'ork sessions limpar-fantasmas requires a project (orkastery.yaml)',
    request: 'sessions request requires thread, UUID, --fase, and --runtime; --pergunta only checks the native content',
    answer: 'sessions answer requires thread, request, and an authenticated envelope on --stdin',
    reconcile: 'sessions reconcile requires thread and request',
    supersede: 'sessions supersede requires thread, UUID, --fase, and --runtime',
    usoSub: (sub) => `usage: ork sessions ${sub} <session>`,
    desconhecido: (sub) => `unknown subcommand: sessions ${sub}`,
    inventario: {
      abertura: (global, user, history) =>
        `${global ? 'Global' : 'Project'} inventory for account ${user}; history: ${history ? 'included' : 'omitted'}.`,
      fontes: (value) => `Sources: ${value}`,
      fonteEstado: { ausente: 'missing', ok: 'ok', falha: 'FAILED' },
      resumo: (total, unbound, ambiguous, ghosts, ok) =>
        `Total: ${total}; without thread: ${unbound}; ambiguous: ${ambiguous}; ghosts: ${ghosts}; query: ${ok ? 'valid' : 'INCOMPLETE'}.`,
      colunas: ['ID', 'RUNTIME', 'PROFILE', 'STATE', 'THREAD/PHASE'],
      processo: 'process', desconhecido: 'unknown', fantasma: 'ghost', fora: '(outside ork)',
      explicacaoFantasma: 'Ghost: record without a live process; it occupies no slot. `ork sessions limpar-fantasmas` releases the ork link without touching the runtime.',
      falha: (detail) => `Failure: ${detail}`,
      ausente: (detail, fix) => `Missing: ${detail}${fix ? `; fix: ${fix}` : ''}`,
    },
    localizar: {
      ambigua: (key, accounts) => `session "${key}" found in more than one account: ${accounts}; use the full id`,
      ausente: (key, failures) => `session "${key}" not found in the runtime${failures ? `; accounts without a response: ${failures}` : ''}`,
      parada: (id, profile) => `session ${id} stopped${profile ? ` (profile ${profile})` : ''}`,
    },
    limpeza: {
      nenhuma: (partial) => `No ghost session${partial ? ' in the accounts that responded' : ''}.`,
      falha: (detail) => `Failure: ${detail}`,
      acoes: {
        soltaria: 'would release (sessao_morta in the ledger)', solto: 'released: sessao_morta in the ledger',
        jaSolto: 'already closed in the ledger', semThread: 'outside ork: nothing to release',
        outroProjeto: 'linked to another project: run it there',
      },
      abertura: (dryRun) =>
        `Ghost sessions (no pid and no process)${dryRun ? ', dry run: nothing was written' : ''}. The runtime was not touched.`,
      colunas: ['ID', 'PROFILE', 'THREAD/PHASE', 'ACTION'],
      processo: 'process',
    },
    radar: {
      titulo: (total) => `Runtime session radar (${total} session(s) on this machine)`,
      resumo: (human, hitl, abandoned, failures, unknown, working, outside) =>
        `  need a human: ${human} (live HITL ${hitl}, abandoned ${abandoned}, failure ${failures}, ` +
        `unknown state ${unknown}) | working: ${working} | outside ork: ${outside}`,
      limite: (minutes, above) => `  attention threshold: ${minutes} min (${above} stopped above it, marked with !)`,
      falha: (detail) => `  [fail] ${detail}: cannot tell who is stopped`,
      semLogs: '  [warn] --sem-logs: the radar says WHO is stopped, but not WHAT each session is asking',
      nenhuma: '  No session in this scan.',
      colunas: ['ID', 'NAME', 'CLASS', 'STATE', 'TYPE', 'DIRECTORY', 'THREAD', 'AGE'],
      vazio: '(empty)', fora: 'outside ork', nenhumaEsperando: '  No session is waiting for a human.',
      vivas: 'Waiting for a HUMAN now, with the job LIVE (answering unblocks it immediately):',
      mortas: 'DIED waiting for an answer (the job exited; answering no longer helps and the work stopped):',
      onde: 'where', porque: 'why', pergunta: 'question', log: 'log', opcao: 'option',
      parada: 'stopped for', viva: 'alive for', ver: 'view', responder: 'answer', recomendo: 'recommend',
      thread: (id, phase) => `thread ${id}, phase ${phase}`,
      sessaoFora: 'session outside ork',
      paradaDesconhecida: 'unknown; record with --registrar',
      desdeObservacao: 'since the first observation', idade: 'session age', desdeInicio: 'since the session started',
    },
  },
};
