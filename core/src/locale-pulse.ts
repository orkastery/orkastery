/**
 * RM-061, fatia F2b: a familia `pulse` do catalogo de mensagens (`ork pulse` em texto; o `--json` nao muda).
 * O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O pulse junta dado de muitas fontes. Sai como veio: a pergunta e as opcoes de um pedido HITL, a tela de
 * uma sessao, o detalhe e a correcao que outro processo gravou num gate do ledger, o codigo e o erro de um
 * diagnostico, e o proximo passo de uma thread parada no condutor (G5 da F2b). O que o proprio processo monta
 * (a pergunta de fase sem heartbeat, as paradas do monitor, o estado da sessao no radar, o detalhe da consulta
 * do runtime e a descricao de reserva do motivo) nasce em pt-BR (o `--json` o guarda) e sai remontado (G2).
 * A descricao por motivo tipado tem a fonte aqui: `DESCRICAO_DO_MOTIVO` (gates.ts) le o pt-BR.
 */

/** A classe da sessao no radar (`ClasseDeSessao`) e a da fase orfa, pelo id; `hitl` e `thread` sao iguais. */
const CLASSES_EN: Readonly<Record<string, string>> = {
  abandonada: 'abandoned', falha: 'failed', trabalhando: 'working', concluida: 'done', interrompida: 'stopped',
  interativa: 'interactive', desconhecida: 'unknown', fase_orfa: 'orphan phase', score_pendente: 'pending score',
  // RM-063 (F5): o item de uma acao da varredura.
  varredura: 'sweep',
};

/** As alternativas do pedido curto do impedimento do despacho (`impedimento.ts`), pelo texto que ele grava. */
const ALTERNATIVAS_DO_IMPEDIMENTO_EN: Readonly<Record<string, string>> = {
  'Rodei o comando': 'I ran the command', 'Trocar o runtime do bloco': 'Switch the block runtime', 'Deixar parada': 'Leave it stopped',
  // RM-063 (F4): a alternativa recomendada da escada de recuperacao que acabou.
  'Conferir o runtime e despachar de novo com o mesmo pedido': 'Check the runtime and dispatch again with the same request',
};

export const PULSE_PT_BR = {
  cabecalho: (contrato: string, quando: string) => `Pulse (${contrato}) ${quando}`,
  precisaDeHumano: (n: number) => `Precisa de humano agora: ${n}`,
  semNota: (n: number) => `${n} entrega(s) sem nota, aceitas por padrão com registro`,
  diagnostico: (detalhe: string) => `[diagnostico] ${detalhe}`,
  consultaIncompleta: (detalhe: string) => `[consulta incompleta] ${detalhe}`,
  item: (quem: string, classe: string, minutos: string) => `${quem} [${classe}] ${minutos} min`,
  /** A classe do item (`ItemPulse.classe`), dado do `--json`: o ingles a traduz pelo id na impressao (D4). */
  classe: (classe: string): string => classe,
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
  // orquestracao.ts: as paradas que o monitor monta (pergunta e correcao do item do pulse)
  pausaTrabalhando: (sessao: string) => `a sessao ${sessao} do bloco ainda esta trabalhando no runtime: a pausa chega quando ela terminar`,
  pausaBloqueada: (sessao: string) =>
    `a sessao ${sessao} do bloco esta BLOQUEADA no runtime esperando acao humana (prompt, permissao ou credencial): veja \`ork sessions hitl\``,
  blocoFechado: (fase: string, sobre: string) => `bloco fechado em ${fase}: espera o veredito humano sobre ${sobre}`,
  aPausaDoBloco: 'a pausa do bloco',
  responderSessao: (curta: string, sessao: string) => `ork sessions logs ${curta} para ver o que a sessao pede, e claude attach ${sessao} para responder`,
  threadPausada: (fase: string) => `thread carimbada como pausada na fase ${fase}`,
  naFilaDoLease: (nome: string, atras: string, colide: string) => `na fila de ${nome}, atras da thread ${atras} (colide com ${colide})`,
  espereOLease: (atras: string, regiao: string, dono: string) =>
    `espere a thread ${atras} liberar (ork lease release ${regiao} --thread ${dono}), ou reduza a regiao pedida`,
  /** `quando` e o ISO de `liberaEm`: o JSON do monitor o guarda cru e `linhaDaParada` o localiza. */
  naFilaDeRateLimit: (id: string, falta: string, quando: string, estimada: boolean) =>
    `pedido ${id} na fila de rate limit, libera ${falta} (${quando}, ${estimada ? 'janela estimada' : 'hora dita pelo runtime'})`,
  // hitl.ts: o estado da sessao no radar (vira a pergunta do item quando a sessao nao pergunta nada)
  sessao: { blocked: 'sessao parada esperando acao humana (prompt, permissao ou credencial)',
    failed: 'sessao terminou em erro: alguem decide entre retomar, corrigir ou abandonar',
    working: 'sessao em execucao', done: 'sessao concluiu', stopped: 'sessao parada por decisao humana (`claude stop`)',
    idle: 'sessao interativa ociosa, conduzida por um humano no terminal' } as Record<string, string>,
  sessaoSemEstado: 'runtime nao informou estado desta sessao: tratada como possivel parada',
  sessaoEstadoForaDoCatalogo: (estado: string) => `estado "${estado}" nao esta no catalogo do ork: tratado como possivel parada`,
  // a consulta do runtime (claude-bg.ts e hitl.ts): o detalhe do pulse quando ela falha
  adapterIndisponivel: 'runtime adapter indisponivel nesta maquina (`claude` fora do PATH)',
  claudeForaDoPath: 'binário `claude` fora do PATH',
  claudeAgentsFalhou: (codigo: number | null) => `claude agents falhou (código ${codigo})`,
  // hitl.ts (`recomendarPara`): a recomendacao unica que o radar monta para cada tipo de parada
  recomendacaoDoRadar: {
    abandonada: 'nao responda: o job ja saiu. Confira o que ficou na worktree da sessao e redespache so o resto do trabalho.',
    falha: (id: string) => `leia \`ork sessions logs ${id}\` e decida entre retomar, corrigir a causa ou abandonar a sessao.`,
    desconhecida: (id: string) => `estado fora do catalogo: confirme no \`ork sessions logs ${id}\` se a sessao esta mesmo parada.`,
    credencial: (id: string) => `entregue o segredo agora (\`claude attach ${id}\`) para nao segurar a entrega; ` +
      'se este mesmo bloqueio ja se repetiu, troque por credencial de automacao e ele nao volta.',
    permissao: (id: string) => `responda o prompt (\`claude attach ${id}\`); se o comando e rotineiro nesse projeto, ` +
      'coloque-o na allowlist de permissoes para nao parar de novo pelo mesmo motivo.',
    pergunta: (id: string) => `abra a sessao (\`claude attach ${id}\`) e escolha entre as opcoes que ela listou.`,
    outra: (id: string) => `veja o que a sessao pede com \`ork sessions logs ${id}\` antes de responder.`,
  },
  /** O texto da alternativa do impedimento do despacho (RM-055), como `impedimento.ts` o grava; o ingles traduz. */
  alternativaDoImpedimento: (texto: string): string => texto,
  // board.ts: a correcao das vagas que o escalonador devolve e o pulse mostra nas acoes automaticas
  vagaStaleCorrecao: (thread: string, fase: string) => `redespache com ork phase run ${thread} --fase ${fase}, ou feche com ork master ${thread}`,
  limiteCorrecao: 'espere uma thread liberar, ou suba concurrency.max_parallel_threads no orkastery.yaml',
  /**
   * RM-063 (F5): as acoes da varredura que age (`varredura-acoes.ts`) e a autorizacao duravel. O que vai ao `--json` nasce
   * em pt-BR; a impressao remonta no locale.
   */
  varredura: {
    oQue: {
      limpar: (sessao: string) => `soltar a sessão ${sessao}, que não tem mais processo (fantasma) e ainda segura a condução ` +
        'e a vaga da thread; o runtime não é tocado',
      registrar: (merge: string, branch: string, base: string) => `registrar a entrega: o merge ${merge} da branch ${branch} já ` +
        `está em ${base}, e o ledger não tem o ship_done`,
      master: 'fechar a thread pelo MASTER por omissão: a entrega está registrada, ninguém deu nota e nada anda nela; o índice ' +
        'do ledger vira a nota, e a sua nota, quando vier, vale',
    },
    bloqueios: {
      conduzida: 'alguém conduz a thread agora',
      trabalhoNovo: 'a thread recebeu trabalho novo depois do merge, e o registro mudaria a fase dela',
      branchComCommits: 'a branch tem commits depois da entrega',
      gitSemResposta: 'o git não respondeu sobre a branch',
    },
    comBloqueio: (oQue: string, bloqueio: string) => `${oQue}. A varredura não faz isso sozinha agora: ${bloqueio}`,
    comRecusa: (oQue: string, detalhe: string) => `${oQue}. A varredura tentou e não fez: ${detalhe}`,
    daVarredura: (por: string, ate: string) => `a varredura faz isso na próxima batida, pela autorização durável de ${por} até ${ate}`,
    doDono: (acao: string) => `rode o comando; para a varredura fazer isso sozinha, autorize a ação ${acao} na autorização ` +
      'durável desta máquina (ork.autorizacao-duravel/v1)',
    autorizacaoValida: (por: string, ate: string, pode: string) => `Varredura: autorização durável de ${por} até ${ate} (pode: ${pode})`,
    autorizacaoAusente: 'Varredura: sem autorização durável; as ações dela ficam na fila do dono, com o comando pronto',
    autorizacaoInvalida: (motivo: string, detalhe: string) =>
      `Varredura: autorização durável sem valor (${motivo}: ${detalhe}); as ações dela ficam na fila do dono`,
    feitas: (n: number) => `A varredura fez sozinha nos últimos 7 dias: ${n}`,
    feita: (thread: string, acao: string, detalhe: string) => `  ${thread}: ${acao}; ${detalhe}`,
  },
  /** A descricao de cada motivo tipado: a fonte de `DESCRICAO_DO_MOTIVO` (reserva do detalhe da parada). */
  motivos: {
    'artifact.missing': 'artefato exigido pela fase nao existe no disco',
    'claims.failed': 'alegacao verificavel reprovou na reexecucao no HEAD real',
    'claims.unverifiable': 'alegacao sem comando de verificacao declarado',
    'policy.violation': 'policy do manifesto com severidade block foi violada',
    'runtime.autoconferencia': 'o CHECK foi despachado no mesmo runtime que fez o GO, e a thread exige validacao cruzada',
    'verify.regression': 'comando que passava na baseline falha agora',
    'verify.failed': 'comando de verificacao falhou (sem baseline para separar divida pre-existente)',
    'verify.timeout': 'comando de verificacao estourou o prazo antes de terminar: nao ha veredito sobre ele',
    'verify.sem-veredito': 'a rodada nao produziu veredito valido: comando que nao chegou a rodar, ou produto alterado entre o preparo e o fim',
    'ci.failed': 'CHECK independente ausente, pendente ou reprovado no commit candidato',
    'runtime.unavailable': 'runtime adapter indisponivel para o despacho',
    'runtime.silencio': 'fase despachada sem heartbeat dentro do limite de liveness',
    'runtime.rate-limited': 'o runtime bateu o limite de uso da assinatura e a fase morreu antes de terminar (bloco B3: entra na fila duravel e e retomada na janela seguinte)',
    'runtime.quota-exhausted': 'a cota ou os creditos da conta do runtime acabaram (I-33: o perfil sai do rodizio e a fase segue em outro perfil, outro runtime ou na fila)',
    'runtime.auth-missing': 'a conta do runtime nao esta autenticada (I-33: o perfil nunca recebe despacho ate o login ser refeito pelo proprio CLI)',
    'runtime.model-unavailable': 'o modelo pedido nao existe ou a conta nao tem acesso a ele (RM-037: o perfil segue no rodizio e a fase vai a outro perfil com o mesmo modelo ou ao fallback do bloco)',
    'runtime.profile-invalid': 'o perfil pedido no despacho (--perfil) nao existe no store ou e de outro runtime (RM-056: o despacho nunca troca de perfil sozinho)',
    'runtime.workspace-untrusted': 'o runtime nao confia no diretorio da worktree e recusou o despacho (RM-055: so o dono aceita a confianca no terminal; depois o ork re-despacha o mesmo prompt)',
    'runtime.consent-pending': 'o runtime espera o dono aceitar termos novos e recusou o despacho (RM-055: so o dono aceita no terminal; depois o ork re-despacha o mesmo prompt)',
    'cost.violation': 'o despacho seria redirecionado para provider pago (violacao de custo: e o unico motivo que NUNCA recebe retry automatico)',
    'tree.blocked': 'a arvore de destino nao esta disponivel para o merge (branch em check-out com alteracao nao commitada, ou worktree que nao pode ser montada)',
    'lease.busy': 'lease ocupado por outra thread',
    'lease.resume-unavailable': 'retomada indisponivel; libere o lease explicitamente com --forcar',
    'conducao.em-andamento': 'outra conducao ja executa na worktree da thread (I-36): o pedido foi recusado com quem conduz e as tres acoes (esperar, acompanhar, assumir)',
    'hitl.formato': 'o pedido HITL saiu fora do formato obrigatorio (pergunta em uma frase, de 3 a 5 alternativas rotuladas com consequencia, exatamente uma com o selo Recomendacao e o porque, corpo em lista; texto livre so com dependencia tecnica tipada)',
    'human.pending': 'gate humano do modo de conducao ainda nao autorizou',
  },
};

export const PULSE_EN: typeof PULSE_PT_BR = {
  cabecalho: (contrato, quando) => `Pulse (${contrato}) ${quando}`,
  precisaDeHumano: (n) => `Needs a human now: ${n}`,
  semNota: (n) => `${n} delivery(ies) without a score, accepted by default with a record`,
  diagnostico: (detalhe) => `[diagnostic] ${detalhe}`,
  consultaIncompleta: (detalhe) => `[incomplete query] ${detalhe}`,
  item: (quem, classe, minutos) => `${quem} [${classe}] ${minutos} min`,
  classe: (classe) => CLASSES_EN[classe] ?? classe,
  desconhecido: 'unknown',
  menosDeUm: 'less than 1',
  opcao: (opcao) => `  option: ${opcao}`,
  recomendacao: (texto) => `Recommendation: ${texto}`,
  responder: (comando) => `Reply: ${comando}`,
  log: (linha) => `  log: ${linha}`,
  conduzidas: (n) => `Conducted now: ${n}`,
  conducao: (thread, linha) => `${thread}: ${linha}`,
  paradoNoCondutor: (n) => `Waiting on the conductor: ${n}`,
  linhaDoCondutor: (thread, desde, proximoPasso) => `${thread} waiting on the conductor since ${desde}: ${proximoPasso}`,
  hitlDeConducao: (abertas, mediana) => `Conduction HITL: ${abertas} open; ${mediana}`,
  medianaSemResposta: '7-day median with no measured answer',
  mediana: (minutos, dentro, respondidos) =>
    `7-day median ${minutos} (${dentro ? 'within' : 'above'} the 5 min target, ${respondidos} answer(s))`,
  perguntaParada: (thread, fase, ha, desde) => `${thread} (${fase}) stopped for ${ha}, since ${desde}`,
  automaticas: (n) => `Pending automatic actions: ${n}`,
  automatica: (thread, motivo, comando) => `${thread}: ${motivo}; ${comando}`,
  semHeartbeat: (fase, desde) => `Phase ${fase} with no heartbeat since ${desde}.`,
  semRuntime: 'runtime not queried because of `--sem-runtime`',
  telasAdiadas: (n) => `radar.orcamento: ${n} session screen(s) left for the next scan`,
  pausaTrabalhando: (sessao) => `session ${sessao} of the block is still working in the runtime: the pause comes when it finishes`,
  pausaBloqueada: (sessao) =>
    `session ${sessao} of the block is BLOCKED in the runtime waiting for human action (prompt, permission or credential): see \`ork sessions hitl\``,
  blocoFechado: (fase, sobre) => `block closed at ${fase}: waiting for the human verdict on ${sobre}`,
  aPausaDoBloco: 'the block pause',
  responderSessao: (curta, sessao) => `\`ork sessions logs ${curta}\` to see what the session asks, and \`claude attach ${sessao}\` to answer`,
  threadPausada: (fase) => `thread marked as paused in phase ${fase}`,
  naFilaDoLease: (nome, atras, colide) => `in the ${nome} queue, behind thread ${atras} (collides with ${colide})`,
  espereOLease: (atras, regiao, dono) =>
    `wait for thread ${atras} to release it (\`ork lease release ${regiao} --thread ${dono}\`), or narrow the requested region`,
  naFilaDeRateLimit: (id, falta, quando, estimada) =>
    `request ${id} in the rate limit queue, released ${falta} (${quando}, ${estimada ? 'estimated window' : 'time given by the runtime'})`,
  sessao: { blocked: 'session stopped waiting for human action (prompt, permission or credential)',
    failed: 'session ended in an error: someone decides whether to resume, fix or drop it',
    working: 'session running', done: 'session finished', stopped: 'session stopped by a human decision (`claude stop`)',
    idle: 'idle interactive session, driven by a human in the terminal' },
  sessaoSemEstado: 'the runtime did not report a state for this session: treated as possibly stopped',
  sessaoEstadoForaDoCatalogo: (estado) => `state "${estado}" is not in the ork catalog: treated as possibly stopped`,
  adapterIndisponivel: 'runtime adapter unavailable on this machine (`claude` not on PATH)',
  claudeForaDoPath: '`claude` binary not on PATH',
  claudeAgentsFalhou: (codigo) => `\`claude agents\` failed (exit ${codigo})`,
  recomendacaoDoRadar: {
    abandonada: 'do not answer: the job has already exited. Check what was left in the session worktree and re-dispatch only the rest of the work.',
    falha: (id) => `read \`ork sessions logs ${id}\` and decide whether to resume, fix the cause or drop the session.`,
    desconhecida: (id) => `state not in the catalog: confirm in \`ork sessions logs ${id}\` that the session is really stopped.`,
    credencial: (id) => `hand over the secret now (\`claude attach ${id}\`) so the delivery is not held up; ` +
      'if this same block has happened before, switch to an automation credential and it will not come back.',
    permissao: (id) => `answer the prompt (\`claude attach ${id}\`); if the command is routine in this project, ` +
      'add it to the permissions allowlist so it does not stop again for the same reason.',
    pergunta: (id) => `open the session (\`claude attach ${id}\`) and choose among the options it listed.`,
    outra: (id) => `see what the session asks with \`ork sessions logs ${id}\` before answering.`,
  },
  alternativaDoImpedimento: (texto) => ALTERNATIVAS_DO_IMPEDIMENTO_EN[texto] ?? texto,
  vagaStaleCorrecao: (thread, fase) => `re-dispatch with \`ork phase run ${thread} --fase ${fase}\`, or close it with \`ork master ${thread}\``,
  limiteCorrecao: 'wait for a thread to free its slot, or raise `concurrency.max_parallel_threads` in `orkastery.yaml`',
  varredura: {
    oQue: {
      limpar: (sessao) => `release session ${sessao}, which has no process anymore (a ghost) and still holds the thread ` +
        'conduction and slot; the runtime is not touched',
      registrar: (merge, branch, base) => `record the delivery: merge ${merge} of branch ${branch} is already in ${base}, and the ` +
        'ledger has no ship_done',
      master: 'close the thread through MASTER by default: the delivery is recorded, nobody scored it and nothing runs on it; the ' +
        'ledger index becomes the score, and your score, when it comes, wins',
    },
    bloqueios: {
      conduzida: 'someone conducts the thread now',
      trabalhoNovo: 'the thread got new work after the merge, and recording would change its phase',
      branchComCommits: 'the branch has commits after the delivery',
      gitSemResposta: 'git did not answer about the branch',
    },
    comBloqueio: (oQue, bloqueio) => `${oQue}. The sweep does not do this on its own now: ${bloqueio}`,
    comRecusa: (oQue, detalhe) => `${oQue}. The sweep tried and did not do it: ${detalhe}`,
    daVarredura: (por, ate) => `the sweep does this at the next beat, under the durable authorization of ${por} until ${ate}`,
    doDono: (acao) => `run the command; for the sweep to do this on its own, authorize the action ${acao} in this machine's ` +
      'durable authorization (ork.autorizacao-duravel/v1)',
    autorizacaoValida: (por, ate, pode) => `Sweep: durable authorization of ${por} until ${ate} (may: ${pode})`,
    autorizacaoAusente: 'Sweep: no durable authorization; its actions stay in the owner queue, with the command ready',
    autorizacaoInvalida: (motivo, detalhe) => `Sweep: durable authorization without effect (${motivo}: ${detalhe}); its actions stay in the owner queue`,
    feitas: (n) => `The sweep did on its own in the last 7 days: ${n}`,
    feita: (thread, acao, detalhe) => `  ${thread}: ${acao}; ${detalhe}`,
  },
  motivos: {
    'artifact.missing': 'an artifact the phase requires does not exist on disk',
    'claims.failed': 'a verifiable claim failed when rerun on the real HEAD',
    'claims.unverifiable': 'a claim with no verification command declared',
    'policy.violation': 'a manifest policy with block severity was violated',
    'runtime.autoconferencia': 'CHECK was dispatched on the same runtime that did GO, and the thread requires cross-validation',
    'verify.regression': 'a command that passed in the baseline fails now',
    'verify.failed': 'a verification command failed (no baseline to tell existing debt apart)',
    'verify.timeout': 'a verification command ran past its deadline before finishing: there is no verdict on it',
    'verify.sem-veredito': 'the run produced no valid verdict: a command that never ran, or a product changed between prepare and the end',
    'ci.failed': 'independent CHECK missing, pending or failed on the candidate commit',
    'runtime.unavailable': 'runtime adapter unavailable for the dispatch',
    'runtime.silencio': 'phase dispatched with no heartbeat within the liveness limit',
    'runtime.rate-limited': 'the runtime hit the subscription usage limit and the phase died before finishing (block B3: it enters the durable queue and resumes in the next window)',
    'runtime.quota-exhausted': 'the quota or credits of the runtime account ran out (I-33: the profile leaves the rotation and the phase goes on in another profile, another runtime or the queue)',
    'runtime.auth-missing': 'the runtime account is not authenticated (I-33: the profile gets no dispatch until the login is redone through the CLI itself)',
    'runtime.model-unavailable': 'the requested model does not exist or the account has no access to it (RM-037: the profile stays in the rotation and the phase goes to another profile with the same model or to the block fallback)',
    'runtime.profile-invalid': 'the profile requested in the dispatch (`--perfil`) does not exist in the store or belongs to another runtime (RM-056: the dispatch never switches profiles on its own)',
    'runtime.workspace-untrusted': 'the runtime does not trust the worktree directory and refused the dispatch (RM-055: only the owner accepts trust in the terminal; then ork dispatches the same prompt again)',
    'runtime.consent-pending': 'the runtime waits for the owner to accept new terms and refused the dispatch (RM-055: only the owner accepts in the terminal; then ork dispatches the same prompt again)',
    'cost.violation': 'the dispatch would be redirected to a paid provider (a cost violation: the only reason that NEVER gets an automatic retry)',
    'tree.blocked': 'the target tree is not available for the merge (branch checked out with uncommitted changes, or a worktree that cannot be set up)',
    'lease.busy': 'lease held by another thread',
    'lease.resume-unavailable': 'resume unavailable; release the lease explicitly with `--forcar`',
    'conducao.em-andamento': 'another conduction already runs on the thread worktree (I-36): the request was refused with who conducts and the three actions (wait, follow, take over)',
    'hitl.formato': 'the HITL request came out of the required format (question in one sentence, 3 to 5 labeled alternatives with a consequence each, exactly one with the Recommendation seal and the reason, body as a list; free text only with a typed technical dependency)',
    'human.pending': 'the human gate of the conduction mode has not authorized yet',
  },
};
