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
  // A forja sem leitura de pedidos (parado-no-condutor): o estado dela, dito uma vez por remoto e host.
  forjaSemLogin: (cli: string, host: string, remoto: string) => `o ${cli} não está autenticado em ${host}, a forja de ${remoto}`,
  /** Nem o `gh` nem o `glab` tem login no host proprio: a frase do gh de sempre, e o glab junto. */
  forjaSemLoginNasDuas: (host: string, remoto: string) => `o gh não está autenticado em ${host}, a forja de ${remoto}, e o glab também não`,
  forjaSemPedidos: (tipo: string, host: string, remoto: string) =>
    `a forja de ${remoto} (${host}, ${tipo}) não tem a leitura de pedidos abertos no ork`,
  forjaNaoResolvida: (remoto: string, motivo: string) => `a forja de ${remoto} não se resolveu: ${motivo}`,
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
    idle: 'sessao interativa ociosa, conduzida por um humano no terminal',
    // RM-063 (fatia 3, achado a): `busy` e `running` sao a sessao trabalhando num turno, como o observador ja os le.
    busy: 'sessao ocupada, executando um turno', running: 'sessao em execucao' } as Record<string, string>,
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
      // RM-063 (F7): a batida da conducao (`conducao-batida.ts`).
      merge: (pr: number, branch: string, base: string) => `mesclar o PR #${pr} (${branch}) em ${base}, com os checks obrigatórios ` +
        'verdes e o PR limpo',
      atualizar: (pr: number, branch: string, base: string) => `trazer ${base} para a branch ${branch} do PR #${pr}, que ficou para trás ` +
        'ou em conflito só no CHANGELOG',
      despachar: (fase: string) => `despachar a fase ${fase} com o pedido guardado na criação da thread`,
      retomar: (fase: string) => `retomar a fase ${fase} pelo retry, com o mesmo prompt gravado`,
    },
    bloqueios: {
      'conduzida': 'alguém conduz a thread agora',
      'sessao-viva': 'há sessão viva trabalhando na worktree da thread',
      'sessoes-sem-leitura': 'sem a leitura das sessões vivas do runtime agora, não dá para provar a worktree parada',
      'worktree-suja': 'a worktree da thread tem alteração não commitada',
      'branch-com-commits': 'a branch tem commits depois do head do PR mesclado',
      'trabalho-novo': 'a thread recebeu trabalho novo depois do PR, e a ação mudaria a fase dela',
      'git-sem-resposta': 'o git não respondeu sobre a branch',
      'pr-rascunho': 'o PR está em rascunho',
      'checks-vermelhos': 'um check obrigatório do PR falhou',
      'sem-checks-obrigatorios': 'a base não exige check nenhum, e merge sem check obrigatório verde fica com você',
      'pr-bloqueado': 'o GitHub bloqueia o merge mesmo com os checks obrigatórios verdes (revisão ou regra da base)',
      'pr-instavel': 'há check não obrigatório vermelho, e o PR não está limpo',
      'conflito-em-codigo': 'o merge da base na branch conflita em código, e conflito em código nunca é resolvido sozinho',
      'branch-nao-publicada': 'a branch local tem commits que o PR ainda não tem',
      'sem-prompt-gravado': 'a thread não tem o pedido guardado na criação (ork thread new --pedido), e sem ele não há prompt',
      'check-pendente': 'o CHECK da thread não passou (veredito PASSOU) depois do último commit de produto do PR',
      'pendencia-do-dono': 'a thread espera você (pausada, pausa prevista, pergunta ou escalação aberta)',
      'espera-longa': 'a batida espera há mais de 2 h (check obrigatório pendente ou o GitHub sem o estado do merge)',
      'thread-do-arco': 'a thread é trabalho de um arco #Noctum: a entrega e o MASTER dela são do passo da entrega do arco',
    },
    comBloqueio: (oQue: string, bloqueio: string) => `${oQue}. A varredura não faz isso sozinha agora: ${bloqueio}`,
    comBloqueioRecomendacao: (thread: string, comando: string) =>
      `veja a thread antes (ork thread status ${thread}); quando o trabalho nela parar, o comando é ${comando}`,
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
  /** RM-063 (F6): a maquina ociosa (`maquina-ociosa.ts`): o passo de cada sugestao e as linhas do pulse. */
  ociosa: {
    despachar: (fase: string) => `despachar a fase ${fase} com o pedido guardado da thread`,
    retomar: 'retomar a fase pelo retry, com o mesmo prompt',
    verAThread: (fase: string) => `ver por que a thread parou na fase ${fase}`,
    abrir: 'abrir a thread do item, que ainda não tem uma',
    linha: (maquina: string, livres: number, limite: number, reservados: number) => `Máquina ociosa: ${maquina} com ${livres} de ` +
      `${limite} vagas livres e ${reservados} item(ns) do roadmap reservado(s) para ela sem ninguém trabalhando`,
    sugerida: (item: string, onde: string, passo: string, comando: string) => `  ${item} (${onde}): ${passo}; ${comando}`,
    semThread: 'sem thread',
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
    'concurrency.lease-indeterminado': 'a vida do dono do lease nao pode ser provada deste host ou namespace; desconhecido nunca e orfao',
    'conducao.em-andamento': 'outra conducao ja executa na worktree da thread (I-36): o pedido foi recusado com quem conduz e as tres acoes (esperar, acompanhar, assumir)',
    'conducao.acao-necessaria': 'a sessao parou de proposito e deixou um comando exato para a conducao executar fora do sandbox',
    'hitl.formato': 'o pedido HITL saiu fora do formato obrigatorio (pergunta em uma frase, de 3 a 5 alternativas rotuladas com consequencia, exatamente uma com o selo Recomendacao e o porque, corpo em lista; texto livre so com dependencia tecnica tipada)',
    'human.pending': 'gate humano do modo de conducao ainda nao autorizou',
  },
};

export const PULSE_EN: typeof PULSE_PT_BR = {
  cabecalho: (contrato, quando) => `Pulse (${contrato}) ${quando}`,
  precisaDeHumano: (n) => `Needs a human now: ${n}`,
  semNota: (n) => `${n} delivery(ies) without a score, accepted by default with a record`,
  diagnostico: (detalhe) => `[diagnostic] ${detalhe}`,
  forjaSemLogin: (cli, host, remoto) => `${cli} is not logged in to ${host}, the forge of ${remoto}`,
  forjaSemLoginNasDuas: (host, remoto) => `gh is not logged in to ${host}, the forge of ${remoto}, and neither is glab`,
  forjaSemPedidos: (tipo, host, remoto) => `the forge of ${remoto} (${host}, ${tipo}) has no open-request reading in ork`,
  forjaNaoResolvida: (remoto, motivo) => `the forge of ${remoto} did not resolve: ${motivo}`,
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
    idle: 'idle interactive session, driven by a human in the terminal',
    busy: 'session busy, running a turn', running: 'session running' },
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
      merge: (pr, branch, base) => `merge PR #${pr} (${branch}) into ${base}, with the required checks green and the PR clean`,
      atualizar: (pr, branch, base) => `bring ${base} into branch ${branch} of PR #${pr}, which fell behind or conflicts only in ` +
        'the CHANGELOG',
      despachar: (fase) => `dispatch phase ${fase} with the request stored when the thread was created`,
      retomar: (fase) => `resume phase ${fase} through the retry, with the same recorded prompt`,
    },
    bloqueios: {
      'conduzida': 'someone conducts the thread now',
      'sessao-viva': 'a live session works in the thread worktree',
      'sessoes-sem-leitura': 'without a reading of the runtime live sessions now, the worktree cannot be proven idle',
      'worktree-suja': 'the thread worktree has uncommitted changes',
      'branch-com-commits': 'the branch has commits after the head of the merged PR',
      'trabalho-novo': 'the thread got new work after the PR, and the action would change its phase',
      'git-sem-resposta': 'git did not answer about the branch',
      'pr-rascunho': 'the PR is a draft',
      'checks-vermelhos': 'a required check of the PR failed',
      'sem-checks-obrigatorios': 'the base requires no check at all, and a merge without a green required check stays with you',
      'pr-bloqueado': 'GitHub blocks the merge even with the required checks green (review or base rule)',
      'pr-instavel': 'a non-required check is red, and the PR is not clean',
      'conflito-em-codigo': 'merging the base into the branch conflicts in code, and a code conflict is never resolved on its own',
      'branch-nao-publicada': 'the local branch has commits the PR does not have yet',
      'sem-prompt-gravado': 'the thread has no request stored at creation (ork thread new --pedido), and without it there is no prompt',
      'check-pendente': 'the thread CHECK did not pass (verdict PASSOU) after the last product commit of the PR',
      'pendencia-do-dono': 'the thread waits for you (paused, planned pause, open question or escalation)',
      'espera-longa': 'the beat has been waiting for more than 2 h (a required check pending, or GitHub without the merge state)',
      'thread-do-arco': 'the thread is work of a #Noctum arc: its delivery and MASTER belong to the arc delivery step',
    },
    comBloqueio: (oQue, bloqueio) => `${oQue}. The sweep does not do this on its own now: ${bloqueio}`,
    comBloqueioRecomendacao: (thread, comando) =>
      `look at the thread first (ork thread status ${thread}); once the work in it stops, the command is ${comando}`,
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
  ociosa: {
    despachar: (fase) => `dispatch phase ${fase} with the thread's stored request`,
    retomar: 'resume the phase through the retry, with the same prompt',
    verAThread: (fase) => `see why the thread stopped in phase ${fase}`,
    abrir: 'open the thread of the item, which has none yet',
    linha: (maquina, livres, limite, reservados) => `Idle machine: ${maquina} with ${livres} of ${limite} free slots and ` +
      `${reservados} roadmap item(s) reserved for it with nobody working`,
    sugerida: (item, onde, passo, comando) => `  ${item} (${onde}): ${passo}; ${comando}`,
    semThread: 'no thread',
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
    'concurrency.lease-indeterminado': 'the lease owner life cannot be proven from this host or namespace; unknown is never orphaned',
    'conducao.em-andamento': 'another conduction already runs on the thread worktree (I-36): the request was refused with who conducts and the three actions (wait, follow, take over)',
    'conducao.acao-necessaria': 'the session stopped on purpose and left an exact command for the conductor to run outside the sandbox',
    'hitl.formato': 'the HITL request came out of the required format (question in one sentence, 3 to 5 labeled alternatives with a consequence each, exactly one with the Recommendation seal and the reason, body as a list; free text only with a typed technical dependency)',
    'human.pending': 'the human gate of the conduction mode has not authorized yet',
  },
};
