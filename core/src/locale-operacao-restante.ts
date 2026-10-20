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
  gate: {
    usoContext: 'uso: ork gate context <thread> <pedido> [--native-offer-stdin]',
    requestThread: 'gate request exige thread',
    formato: 'gate request: --formato telegram|terminal',
    answer: 'gate answer exige thread, pedido e --resposta-stdin',
    usoNext: 'uso: ork gate next <thread-id> [--proximo FASE] [--ocupacao 0..1]',
    approveAposentado: 'gate approve aposentado: aprovação sem pedido é recusada. Use ork gate request <thread-id> e responda pelo ingresso humano autenticado.',
    registrado: (thread: string) => `Autorizacao humana registrada no ledger da thread ${thread}.`,
    sobre: (valor: string) => `  sobre          ${valor}`,
    autorizado: (valor: string) => `  autorizado por ${valor}`,
    quando: (valor: string) => `  quando         ${valor}`,
    desconhecido: (sub: string | undefined) => `subcomando desconhecido: gate ${sub}`,
    tokens: {
      titulo: (thread: string) => `ork gate next: thread ${thread}`,
      ocupacao: (valor: string) => `  ocupacao       ${valor}`,
      naoMedivel: 'nao medivel',
      fonte: (valor: string) => `  fonte          ${valor}`,
      detalhe: (valor: string) => `                 ${valor}`,
      limiares: (rotate: number, force: number) =>
        `  limiares       rotate_above ${rotate} | force_rotate_above ${force}`,
      proximo: (fase: string | null, peso: string) => `  proximo passo  ${fase} (${peso})`,
      pesado: 'pesado', leve: 'leve',
      veredito: (valor: string, fonte: string) => `VEREDITO: ${valor}  (decidido por ${fonte})`,
      razao: (valor: string) => `  razao: ${valor}`,
      slug: (valor: string) => `  slug da nova sessao: ${valor}`,
      handoff: (thread: string, fase: string | null) => `  proximo passo: ork handoff export ${thread} --proxima-fase ${fase}`,
      ledger: (thread: string) => `Registrado no ledger como token_gate: ork phase list ${thread}`,
      localizarDetalhe: (_fonte: string, valor: string) => valor,
      localizarRazao: (_ocupacao: number | null, _rotate: number, _force: number, _pesado: boolean,
        _refazer: boolean, _proximo: string | null, valor: string) => valor,
    },
  },
  fix: {
    semCorrecoes: (thread: string) => `Thread ${thread}: o CHECK PASSOU no HEAD real, nao ha correcao a abrir.\n` +
      '  (nenhum motivo tipado bloqueante em `ork verify`)',
    aberto: (thread: string, rodada: number) => `GO-FIX aberto na thread ${thread} (rodada ${rodada})`,
    veredito: (valor: string) => `  veredito do CHECK   ${valor}`,
    motivos: (valor: string) => `  motivos tipados     ${valor}`,
    reexecucao: (tipoB: boolean) => `  reexecucao          ${tipoB ? 'COMPLETA obrigatoria (ha correcao tipo B)' : 'parcial permitida (rodada so de tipo A)'}`,
    colunas: ['ID', 'TIPO', 'MOTIVO', 'ALVO', 'JULGADO POR'] as readonly string[],
    verifyCompleto: '(verify completo)',
    spec: 'Spec exata despachada ao GO-FIX:',
    reverify: (thread: string, rodada: number) => `CHECK-REVERIFY da thread ${thread} (rodada ${rodada})`,
    cobertura: (valor: string) => `  cobertura   ${valor}`,
    rodadas: (rodadas: number, limite: number) => `  rodadas     ${rodadas} de ${limite} antes da escalacao`,
    porCorrecao: 'Veredito por correcao:',
    correcao: (id: string, tipo: string, aprovada: boolean, alvo: string) =>
      `  ${id}  tipo ${tipo}  ${aprovada ? 'APROVADA' : 'REPROVADA'}  ${alvo}`,
    origem: (valor: string) => `      motivo de origem: ${valor}`,
    execucao: (ok: boolean, comando: string) => `      ${ok ? 'ok  ' : 'FALHOU'} ${comando}`,
    verify: (commit: string, ok: boolean, motivos: string) =>
      `Verify completo no HEAD ${commit}: ${ok ? 'verde' : `reprovado (${motivos})`}`,
    final: (valor: string) => `Veredito final: ${valor}`,
    escalado: '  ESCALADO PARA HUMANO: esta pausa vale em qualquer modo, inclusive #Auto.',
    vereditos: { PASSOU: 'PASSOU', 'PRECISA DE MUDANCA': 'PRECISA DE MUDANCA', BLOQUEADO: 'BLOQUEADO' } as Record<string, string>,
    coberturas: { completa: 'completa', parcial: 'parcial' } as Record<string, string>,
  },
  handoff: {
    exportado: (thread: string, memory: string) => `Handoff exportado da thread ${thread} (regime memory: ${memory})`,
    de: (slug: string, fase: string | null) => `  de    ${slug} (fase ${fase})`,
    para: (slug: string, fase: string | null) => `  para  ${slug} (fase ${fase})`,
    arquivo: (caminho: string) => `  arquivo ${caminho}`,
    critico: (total: number) => `CRITICO (${total} item(ns), vao inline no prompt da nova sessao):`,
    proveniencia: (local: string, sha: string) => `        proveniencia: ${local} (sha256 ${sha})`,
    importante: (total: number) => `IMPORTANTE (${total} ponteiro(s), recuperados sob demanda):`,
    quando: (valor: string) => `        quando:   ${valor}`,
    recuperar: (valor: string) => `        recuperar: ${valor}`,
    noMomento: (thread: string, quando: string) => `        no momento: ork recall ${thread} --fase ${quando}`,
    resumivel: (total: number) => `RESUMIVEL (${total} resumo(s), com proveniencia declarada):`,
  },
  recall: {
    titulo: (thread: string, momento: string, regime: string, handoff: string) =>
      `Recall da thread ${thread} no momento ${momento} (regime efetivo ${regime}, handoff escrito em regime ${handoff})`,
    todos: '(todos)',
    resolvidos: (total: number) => `RESOLVIDOS (${total}, entram no contexto agora):`,
    via: (via: string | null, metodo: string) => `        via       ${via} (${metodo})`,
    location: (valor: string) => `        location  ${valor}`,
    quando: (valor: string) => `        quando    ${valor}`,
    adiados: (total: number) => `ADIADOS (${total}, existem e NAO entram agora):`,
    onde: (valor: string) => `        onde      ${valor}`,
    recuperar: (thread: string, fase: string) => `        recuperar ork recall ${thread} --fase ${fase}`,
    falhas: (total: number) => `FALHAS (${total}):`,
    motivo: (valor: string) => `        motivo    ${valor}`,
    detalhe: (valor: string) => `        detalhe   ${valor}`,
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
  gate: {
    usoContext: 'usage: ork gate context <thread> <request> [--native-offer-stdin]',
    requestThread: 'gate request requires a thread',
    formato: 'gate request: --formato telegram|terminal',
    answer: 'gate answer requires thread, request, and --resposta-stdin',
    usoNext: 'usage: ork gate next <thread-id> [--proximo PHASE] [--ocupacao 0..1]',
    approveAposentado: 'gate approve is retired: approval without a request is refused. Use ork gate request <thread-id> and answer through authenticated human ingress.',
    registrado: (thread) => `Human authorization recorded in the ledger of thread ${thread}.`,
    sobre: (value) => `  subject       ${value}`,
    autorizado: (value) => `  authorized by ${value}`,
    quando: (value) => `  when          ${value}`,
    desconhecido: (sub) => `unknown subcommand: gate ${sub}`,
    tokens: {
      titulo: (thread) => `ork gate next: thread ${thread}`,
      ocupacao: (value) => `  occupancy     ${value}`,
      naoMedivel: 'not measurable',
      fonte: (value) => `  source        ${value}`,
      detalhe: (value) => `                 ${value}`,
      limiares: (rotate, force) =>
        `  thresholds     rotate_above ${rotate} | force_rotate_above ${force}`,
      proximo: (phase, weight) => `  next step     ${phase} (${weight})`,
      pesado: 'heavy', leve: 'light',
      veredito: (value, source) => `VERDICT: ${value}  (decided by ${source})`,
      razao: (value) => `  reason: ${value}`,
      slug: (value) => `  new session slug: ${value}`,
      handoff: (thread, phase) => `  next step: ork handoff export ${thread} --proxima-fase ${phase}`,
      ledger: (thread) => `Recorded in the ledger as token_gate: ork phase list ${thread}`,
      localizarDetalhe: (source, value) => {
        if (source === 'unavailable' && value.startsWith('transcript informado nao existe: '))
          return value.replace('transcript informado nao existe: ', 'provided transcript does not exist: ');
        if (source === 'estimated') return value
          .replace(/^estimativa por tamanho: /, 'size estimate: ')
          .replace(/ bytes por token = ~/, ' bytes per token = ~')
          .replace(/ tokens de uma janela nominal de /, ' tokens in a nominal window of ');
        if (source === 'runtime_reported') return value.replace(/^uso de contexto lido do runtime para a sessao /,
          'context usage read from the runtime for session ');
        if (source === 'informada') return value.replace(/^ocupacao ([\d.]+)% declarada pelo chamador como fonte /,
          '$1% occupancy declared by the caller as source ');
        return value.replace('o adapter claude-bg nao expoe uso de contexto nesta versao do runtime; nenhuma outra fonte foi informada',
          'the claude-bg adapter does not expose context usage in this runtime version; no other source was provided');
      },
      localizarRazao: (occupancy, rotate, force, heavy, redo, next, value) => {
        if (occupancy === null) return 'window occupancy is not measurable (source unavailable): rotation is NOT decided from ' +
          'missing data. Continue in the same session and rotate by explicit decision if needed.';
        const pct = (occupancy * 100).toFixed(1);
        if (occupancy >= force) return `occupancy ${pct}% >= force_rotate_above (${(force * 100).toFixed(0)}%): ` +
          'always rotate, regardless of the weight of the next step.';
        if (occupancy >= rotate && heavy) return `occupancy ${pct}% >= rotate_above (${(rotate * 100).toFixed(0)}%) and the next step is heavy ` +
          `(${redo ? 'redo failed phase' : next}): more window means more accuracy.`;
        if (occupancy >= rotate) return `occupancy ${pct}% >= rotate_above, but the next step (${next}) is not heavy: continue in the same session.`;
        if (Number.isFinite(occupancy)) return `occupancy ${pct}% below rotate_above (${(rotate * 100).toFixed(0)}%): continue in the same session.`;
        return value;
      },
    },
  },
  fix: {
    semCorrecoes: (thread) => `Thread ${thread}: CHECK PASSED on the real HEAD; there is no fix to open.\n` +
      '  (no blocking typed reason in `ork verify`)',
    aberto: (thread, round) => `GO-FIX opened for thread ${thread} (round ${round})`,
    veredito: (value) => `  CHECK verdict       ${value}`,
    motivos: (value) => `  typed reasons       ${value}`,
    reexecucao: (typeB) => `  rerun               ${typeB ? 'FULL required (there is a type B fix)' : 'partial allowed (type A-only round)'}`,
    colunas: ['ID', 'TYPE', 'REASON', 'TARGET', 'JUDGED BY'],
    verifyCompleto: '(full verify)',
    spec: 'Exact spec dispatched to GO-FIX:',
    reverify: (thread, round) => `CHECK-REVERIFY for thread ${thread} (round ${round})`,
    cobertura: (value) => `  coverage    ${value}`,
    rodadas: (rounds, limit) => `  rounds      ${rounds} of ${limit} before escalation`,
    porCorrecao: 'Verdict by fix:',
    correcao: (id, type, approved, target) => `  ${id}  type ${type}  ${approved ? 'APPROVED' : 'FAILED'}  ${target}`,
    origem: (value) => `      source reason: ${value}`,
    execucao: (ok, command) => `      ${ok ? 'ok  ' : 'FAILED'} ${command}`,
    verify: (commit, ok, reasons) => `Full verify on HEAD ${commit}: ${ok ? 'green' : `failed (${reasons})`}`,
    final: (value) => `Final verdict: ${value}`,
    escalado: '  ESCALATED TO A HUMAN: this pause applies in every mode, including #Auto.',
    vereditos: { PASSOU: 'PASSED', 'PRECISA DE MUDANCA': 'NEEDS CHANGES', BLOQUEADO: 'BLOCKED' },
    coberturas: { completa: 'full', parcial: 'partial' },
  },
  handoff: {
    exportado: (thread, memory) => `Handoff exported from thread ${thread} (memory regime: ${memory})`,
    de: (slug, phase) => `  from  ${slug} (phase ${phase})`,
    para: (slug, phase) => `  to    ${slug} (phase ${phase})`,
    arquivo: (file) => `  file  ${file}`,
    critico: (total) => `CRITICAL (${total} item(s), included inline in the new session prompt):`,
    proveniencia: (location, sha) => `        provenance: ${location} (sha256 ${sha})`,
    importante: (total) => `IMPORTANT (${total} pointer(s), retrieved on demand):`,
    quando: (value) => `        when:      ${value}`,
    recuperar: (value) => `        retrieve:  ${value}`,
    noMomento: (thread, when) => `        at that time: ork recall ${thread} --fase ${when}`,
    resumivel: (total) => `SUMMARIZABLE (${total} summary item(s), with declared provenance):`,
  },
  recall: {
    titulo: (thread, moment, regime, handoff) =>
      `Recall for thread ${thread} at ${moment} (effective regime ${regime}, handoff written under regime ${handoff})`,
    todos: '(all)',
    resolvidos: (total) => `RESOLVED (${total}, entering context now):`,
    via: (via, method) => `        via       ${via} (${method})`,
    location: (value) => `        location  ${value}`,
    quando: (value) => `        when      ${value}`,
    adiados: (total) => `DEFERRED (${total}, they exist and do NOT enter now):`,
    onde: (value) => `        where     ${value}`,
    recuperar: (thread, phase) => `        retrieve  ork recall ${thread} --fase ${phase}`,
    falhas: (total) => `FAILURES (${total}):`,
    motivo: (value) => `        reason    ${value}`,
    detalhe: (value) => `        detail    ${value}`,
  },
};
