/**
 * RM-061, fatia F2a: a familia `thread` do catalogo de mensagens (`ork thread new` e `ork thread
 * status`, o resumo da thread, a linha de conducao, a worktree e os avisos da criacao). O pt-BR e a
 * fonte; o ingles e tipado por ele. Sem import do nucleo: o que vem do estado entra por parametro.
 *
 * Dado gravado sai como foi gravado: nome e assunto da thread, criterio e comando de pronto, o
 * regime do score. Valor fechado que o texto mostra (status da thread, `pausaSobre` de um bloco,
 * nome da operacao de conducao) so e traduzido na impressao; `thread.json` nao muda.
 */

/** O aviso de thread sem worktree, por caso; quem escolhe o caso e `avisoDeThreadSemWorktree`. */
export type CasoSemWorktree =
  | { caso: 'sem-commit' }
  | { caso: 'head' }
  | { caso: 'outra'; branch: string }
  | { caso: 'base'; base: string; policy: string | undefined };

/** O assunto da pausa de cada bloco (`modos.ts`) em ingles: um mapa so, para o `thread` e para o prompt de fase. */
export const PAUSA_SOBRE_EN: Readonly<Record<string, string>> = {
  objetivo: 'goal', plano: 'plan', implementacao: 'implementation', evidencias: 'evidence', push: 'push', score: 'score',
  premissas: 'assumptions', 'evidencias, com autorizacao antecipada de push': 'evidence, with push authorized in advance',
};
const STATUS_EN: Readonly<Record<string, string>> = { aberta: 'open', pausada: 'paused', fechada: 'closed' };

export const THREAD_PT_BR = {
  /** Largura do rotulo no resumo (`  id        valor`). */
  largura: 9,
  rotulos: { id: 'id', slug: 'slug', nome: 'nome', modo: 'modo', ciclo: 'ciclo', fase: 'fase', status: 'status', base: 'base',
    worktree: 'worktree', conducao: 'conducao', score: 'score', check: 'check' },
  modo: (tag: string, pausas: number) => `${tag} (${pausas} pausas humanas previstas)`,
  cicloPadrao: 'padrao do modo',
  status: (status: string) => status,
  raizDoProjeto: '(raiz do projeto)',
  ninguemConduz: 'ninguem conduz agora',
  validacao: '  validacao CHECK em runtime diferente do GO (exigido pela thread)',
  prontoQuando: (n: number) => `  pronto quando (${n} criterio(s) executaveis)`,
  score: (valor: number, por: string, regime: string, quando: string) => `${valor}/5 por ${por} (${regime}) em ${quando}`,
  /** RM-072 (D17): o modo do ultimo `verify_run`; o nome de produto ("Agile Check", "Classic Check") e o mesmo nas duas linguas. */
  check: (nome: string, origem: 'opcao' | 'manifesto' | 'padrao', quando: string, sha: string) =>
    `${nome}, ${origem === 'opcao' ? 'pela opcao --check' : origem === 'manifesto' ? 'pelo manifesto' : 'pelo padrao'}, ` +
    `no verify de ${quando} (${sha})`,
  blocosPrevistos: '  blocos previstos',
  pausaPrevista: (sobre: string) => `pausa prevista: ${sobre}`,
  pausaSobre: (sobre: string) => sobre,
  semPausa: 'sem pausa humana prevista',
  /** `produto "loc", assunto "x", fases "full"`: o slug de 3 partes descrito. */
  slug: (produto: string, assunto: string, fases: string, rotacao: number | null) =>
    `produto "${produto}", assunto "${assunto}", fases "${fases}"${rotacao ? `, rotacao ${rotacao}` : ''}`,
  /** Linha unica de quem conduz (conducao-texto.ts). */
  conduzido: (canal: string, quem: string, fase: string, desde: string) => `conduzido agora por ${canal}, ${quem}, fase ${fase}, desde ${desde}`,
  quemSessao: (id: string) => `sessao ${id}`,
  quemProcesso: (pid: number, operacao: string) => `processo ${pid} (${operacao})`,
  quemReserva: (por: string) => `reserva de ${por}`,
  operacoes: {
    'phase.run': 'despacho de fase',
    'retry.run': 'retomada de fase',
    verify: 'ork verify',
    baseline: 'ork verify --baseline',
    'fix.open': 'ork fix open',
    'fix.reverify': 'ork fix reverify',
    'mcp.verify': 'ork_verify (MCP)',
    handoff: 'reserva de quem assumiu',
    'branch.atualizar': 'merge da base na branch',
  } as Record<string, string>,
  // ork thread new
  criada: 'Thread criada.',
  simulacao: 'Simulacao (--dry-run), nada foi gravado.',
  roadmapReservado: (item: string, maquina: string | undefined) => `  roadmap: ${item} reservado para esta maquina (${maquina})`,
  slugEm3Partes: (descrito: string) => `  slug em 3 partes: ${descrito}`,
  estado: (id: string) => `  estado: .orkastery/threads/${id}/thread.json`,
  proximoPasso: (id: string, fase: string) => `Proximo passo: ork phase run ${id} ${fase} --prompt "<pedido>"`,
  usoNew: 'uso: ork thread new <nome> --modo <MODO>',
  doneSemComando: (entrada: string) => `done.sem-comando: "${entrada}" nao traz comando. ` +
    'Use --done "<criterio> :: <comando que o prova>"; criterio sem comando e prosa, nao criterio de pronto.',
  doneIncompleto: (entrada: string) => `done.incompleto: "${entrada}" precisa de criterio E comando`,
  varianteInvalida: (bruto: string, variantes: string) => `variante de ciclo invalida: "${bruto}". Use uma de: ${variantes}`,
  cicloExigeWorktree: (variante: string) =>
    `uso: o ciclo ${variante} exige worktree isolada: crie a thread sem --sem-worktree ou escolha outro ciclo`,
  worktreeVazia: 'uso: --worktree pede auto ou um diretório que já existe',
  semWorktreeComValor: (valor: string) => `uso: --sem-worktree não leva valor (recebeu "${valor}")`,
  worktreeESemWorktree: 'uso: --worktree e --sem-worktree se excluem; use um dos dois',
  worktreeChave: (gravada: boolean) => `  worktree: ${gravada ? 'criada' : 'seria criada'} pela chave worktree.por_thread do ` +
    'orkastery.yaml; para criar sem ela, use --sem-worktree',
  worktreeFlag: (gravada: boolean) => `  worktree: ${gravada ? 'criada' : 'seria criada'} pelo --worktree auto`,
  worktreeCiclo: (gravada: boolean, variante: string | null) =>
    `  worktree: ${gravada ? 'criada' : 'seria criada'} pelo ciclo ${variante ?? 'da thread'}, que exige worktree isolada`,
  avisoSemWorktree: (id: string, gravada: boolean, c: CasoSemWorktree) => {
    const inicio = gravada
      ? `Aviso: thread ${id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto`
      : `Aviso: sem worktree (--sem-worktree), a thread ${id} trabalharia na raiz do projeto`;
    const ensure = `Antes do GO, ork worktree ensure ${id} cria a worktree e a branch da thread`;
    if (c.caso === 'sem-commit') {
      return `${inicio}, num repositório ainda sem commit, fora de qualquer branch, e o ork ship não tem branch de origem ` +
        'para entregar. Faça o primeiro commit e siga o aviso de thread sem base.';
    }
    if (c.caso === 'head') {
      return `${inicio}, com o HEAD destacado, fora de qualquer branch, e o ork ship não tem branch de origem para entregar. ${ensure}.`;
    }
    if (c.caso === 'outra') {
      return `${inicio}, na branch ${c.branch}, e o ork ship entrega essa branch como estiver, com o que mais entrar nela; ` +
        `com --para ${c.branch}, a entrega vira push direto, que a policy push_direto_na_base confere. ${ensure}.`;
    }
    const efeito = c.policy === 'block'
      ? 'o ork ship barra a entrega por push_direto_na_base (block): não há branch de thread para mergear'
      : c.policy === undefined || c.policy === 'off'
        ? 'o ork ship empurra a base direto, sem branch de thread (push_direto_na_base desligada)'
        : `o ork ship avisa push_direto_na_base (${c.policy}) e empurra a base direto, sem branch de thread`;
    return `${inicio}, na branch base ${c.base}, e ${efeito}. ${ensure}; depois do GO, os commits já estão na base e o ship não os separa.`;
  },
  worktreeFalharia: (motivo: string, dir: string, branch: string, peloCiclo: boolean) => {
    const semWorktree = peloCiclo ? '' : ' ou crie com --sem-worktree';
    if (motivo === 'pasta-existe') {
      return `Aviso: a pasta ${dir} já existe, e a criação de verdade recusaria a worktree da thread: tire a pasta${semWorktree}.`;
    }
    if (motivo === 'branch-existe') {
      return `Aviso: a branch ${branch} já existe, e a criação de verdade recusaria a worktree da thread: tire a branch${semWorktree}.`;
    }
    return 'Aviso: o repositório ainda não tem commit, e a criação de verdade recusaria a worktree da thread no git worktree add: ' +
      'faça o primeiro commit antes.';
  },
  chaveSemCommit: (gravada: boolean) => 'Aviso: worktree.por_thread pede a worktree da thread, mas o repositório ainda não tem commit: ' +
    `a thread ${gravada ? 'nasceu' : 'nasceria'} na raiz do projeto, sem worktree.`,
  semBase: (id: string, gravada: boolean) => gravada
    ? `Aviso: o repositório ainda não tem commit, e a thread ${id} nasceu sem base: o ship não tem de onde partir. ` +
      `Faça o primeiro commit, feche esta com ork thread close ${id} --motivo engano --por <quem> ` +
      '--justificativa "aberta antes do primeiro commit" e abra outra.'
    : 'Aviso: o repositório ainda não tem commit, e a thread nasceria sem base: faça o primeiro commit antes de abrir a primeira thread.',
  roadmapNoNome: (item: string) => `Aviso: ${item} no nome não associa a thread ao roadmap. No terminal, consulte ork roadmap reservas ` +
    `e ork fabrica; para associar e reservar, use --roadmap ${item} em ork thread new. Nenhuma reserva foi criada por este aviso.`,
  modoDesconhecido: (entrada: string, tags: string) => `modo.desconhecido: "${entrada}" nao e um modo de conducao. Use um de: ${tags}.`,
  modoAposentado: (motivo: string, tag: string, substitutos: readonly string[]) =>
    `${motivo}: ${tag} foi aposentado e nao abre trabalho novo. Use ${substitutos.join(' ou ')}. ` +
    `Thread ja gravada em ${tag} continua abrindo normalmente.`,
  publicacaoPendente: (motivo: string) => `Memoria: publicacao pendente (${motivo}); ativacao explicita necessaria.`,
  memoriaGravada: (tenant: string, gravados: string) => `Memoria (orkmind, tenant ${tenant}): ${gravados}.`,
  nadaAGravar: 'nada a gravar',
  gravacoesFalhas: (n: number) => `  ${n} gravacao(oes) nao concluida(s); veja ork memory status.`,
  // ork thread new --from-finding. IDs, códigos, claims e valores do achado continuam dados.
  fromFinding: {
    achadoNaoExiste: (id: string, board: string) => `achado "${id}" nao existe no board de divida (${board}). Veja: ork audit divida`,
    recusada: (id: string) => `Thread a partir do achado ${id} RECUSADA.`,
    descricaoDoMotivo: (_motivo: string, descricao: string) => descricao,
    motivoTipado: (motivo: string | null) => `  motivo tipado: ${motivo}`,
    detalhe: (detalhe: string) => `  detalhe: ${detalhe}`,
    correcao: (correcao: string) => `  correcao: ${correcao}`,
    criada: (id: string) => `Thread criada a partir do achado ${id}.`,
    simulacao: 'Simulacao (--dry-run), nada foi gravado.',
    origemDoGoal: (id: string) => `  origem do GOAL: .orkastery/threads/${id}/achado.json`,
    pedidoMontado: 'Pedido de GOAL ja montado a partir do achado:',
    proximoPasso: 'Proximo passo:',
    comandoDoProximoPasso: (id: string) =>
      `  ork phase run ${id} GOAL --prompt "$(cat .orkastery/threads/${id}/pedido-goal.md)"`,
    jaVirouThread: (achado: string, thread: string) => `o achado ${achado} ja originou a thread ${thread}`,
    continueNaThread: (thread: string) => `continue naquela thread: ork thread status ${thread}`,
    claimPendente: (claim: string) => `a claim ${claim} do achado ainda nao foi reexecutada no HEAD real: ` +
      'o auditor nao tem direito a self-report',
    proveOAchado: (rodada: string) => `prove o achado antes de abrir trabalho: ork audit verify ${rodada}`,
    claimReprovada: (claim: string) => `a claim ${claim} do achado REPROVOU na reexecucao no HEAD real`,
    descarteOAchado: 'o achado nao se sustenta: corrija a evidencia na rodada, ou descarte o achado, em vez de abrir thread sobre ele',
    simulacaoDetalhe: 'simulacao (--dry-run): nenhuma thread e nenhum carimbo no board foram gravados',
    claimSemComando: (claim: string) => `AVISO: a claim ${claim} do achado nao tem comando de verificacao ` +
      '(motivo tipado claims.unverifiable, que avisa e nao bloqueia)',
    achadoAberto: (achado: string, thread: string) => `achado ${achado} aberto como thread ${thread}, com a evidencia e a claim junto`,
    achadoCabecalho: (id: string, severidade: string, pack: string, regra: string, titulo: string) =>
      `  ${id}  [${severidade}] ${pack}/${regra}  ${titulo}`,
    evidencia: (valor: string) => `      evidencia   ${valor}`,
    descricao: (valor: string) => `      descricao   ${valor}`,
    claim: (id: string, estado: string, alegacao: string) => `      claim       ${id} [${estado}] ${alegacao}`,
    verificar: (comando: string) => `      verificar   ${comando}`,
    semComando: '(sem comando: o auditor nao comprovou o achado)',
    impacto: (valor: string) => `      impacto     ${valor}`,
    fix: (valor: string) => `      fix         ${valor}`,
    irreversivel: (valor: string) => `      irreversivel ${valor}`,
    estimativa: (valor: string) => `      estimativa  ${valor}`,
    destino: (destino: string, regime: string) => `      destino     ${destino} (regime ${regime})`,
    estado: (estado: string, thread: string | null) => `      estado      ${estado}${thread ? ` (thread ${thread})` : ''}`,
    pedidoCabecalho: (id: string, pack: string, regra: string, severidade: string) =>
      `Achado de auditoria ${id} (pack ${pack}, regra ${regra}, severidade ${severidade}).`,
    pedidoTitulo: (titulo: string) => `Titulo: ${titulo}`,
    pedidoEvidencia: (evidencia: string) => `Evidencia: ${evidencia}`,
    pedidoDescricao: (descricao: string) => `Descricao: ${descricao}`,
    pedidoClaim: (id: string, estado: string, alegacao: string) =>
      `Alegacao do auditor (claim ${id}, estado ${estado}): ${alegacao}`,
    pedidoVerificar: (comando: string) => `Como reexecutar a evidencia: ${comando}`,
    naoDeclarado: '(nao declarado pelo auditor)',
    proposta: 'Proposta de ajuste levantada pela rodada:',
    propostaImpacto: (valor: string) => `  impacto       ${valor}`,
    propostaFix: (valor: string) => `  fix sugerido  ${valor}`,
    propostaIrreversivel: (valor: string) => `  irreversivel  ${valor}`,
    propostaEstimativa: (valor: string) => `  estimativa    ${valor}`,
    origem: (rodada: string, produto: string, estagio: string, postura: string) =>
      `Origem: rodada ${rodada}, produto ${produto}, estagio ${estagio}, postura ${postura}.`,
    propostaNaoDecisao: 'O fix acima e proposta do auditor, nao decisao: valide no GOAL antes de implementar.',
  },
  // ork thread status
  naoEncontrada: (id: string, dir: string) => `thread "${id}" nao encontrada em ${dir}`,
  usoStatus: 'uso: ork thread status <thread-id>',
  /** D14: erros de argumento de `thread new` que nascem no escopo pt-BR da gravacao (`ErroDoCatalogo`). */
  slugInvalido: (slug: string, regex: string) => `slug invalido: "${slug}" (regex canonica: ${regex})`,
  roadmapItemInvalido: (item: string) => `roadmap.item: "${item}" nao e um item do roadmap (esperado RM-NNN)`,
  roadmapItemInexistente: (id: string) => `roadmap.item: ${id} nao existe em docs/roadmap`,
  /** RM-059 (T6.0) no thread new: o pedido do builder guardado ao lado do thread.json. */
  usoPedido: 'uso: --pedido "<texto do pedido do builder>"',
  /** D14: os demais erros de argumento de `thread new`, lancados no escopo pt-BR da criacao. */
  varianteIncompativel: (variante: string, tag: string, fases: string) => `o ciclo ${variante} redesenha os blocos e o modo ${tag} ` +
    `tem um bloco so (${fases}): crie a thread sem --ciclo ou escolha um modo de ciclo completo`,
  modoNaoPermitido: (tag: string, permitidos: string) => `modo ${tag} fora de conduction.allowed_modes (permitidos: ${permitidos})`,
  nomeSemAssunto: (nome: string) => `nome "${nome}" nao produz assunto valido (esperado [a-z0-9])`,
  cicloExigeBranch: (variante: string) => `o ciclo ${variante} parte de uma branch que ja existe: informe --branch <branch>`,
  branchInexistente: (branch: string) => `branch "${branch}" nao existe neste repositorio`,
  branchSemCiclo: '--branch so vale com --ciclo merge-branch',
  ocupadaPelaChave: (pasta: boolean, alvo: string) => `${pasta ? 'a pasta' : 'a branch'} ${alvo} já existe, e a chave ` +
    'worktree.por_thread pede a worktree da thread: tire-a ou crie com --sem-worktree',
  usoComMotivo: (motivo: string) => `uso: ${motivo}`,
  pedidoVazio: 'thread.pedido.invalido: o pedido esta vazio',
  pedidoGrande: (bytes: number, teto: number) => `thread.pedido.invalido: o pedido tem ${bytes} bytes, e o teto e ${teto}`,
  pedidoGuardado: (gravada: boolean, caminho: string, sha: string, bytes: number) =>
    `  pedido: ${gravada ? 'guardado em' : 'seria guardado em'} ${caminho} (sha256 ${sha}, ${bytes} bytes); o ork prompt render o usa quando falta --pedido`,
  nenhumaSessao: '  nenhuma sessao despachada ainda',
  sessoesDespachadas: '  sessoes despachadas (estado real conferido em `ork sessions`)',
  sessao: (verificada: boolean, canal: string) => `verificada no runtime: ${verificada ? 'sim' : 'nao'}  canal: ${canal}`,
  pausasDoModo: (n: number) => `  pausas humanas do modo: ${n}`,
  // F3b (D1): ork thread list, close e entrega
  colunasDaLista: ['ID', 'SLUG', 'MODO', 'FASE', 'STATUS', 'PAUSAS', 'SESSOES'],
  listaVazia: (todas: boolean, modo: string) => `${todas ? 'Nenhuma thread em .orkastery/threads.'
    : 'Nenhuma thread aberta ou pausada (use --todas para ver as fechadas).'} Crie uma com: ork thread new "<nome>" --modo ${modo}`,
  fechadasOmitidas: (n: number) => `  ${n} fechada(s) omitida(s). Use --todas para ver todas.`,
  informeOId: 'informe o id da thread',
  /** D14: as recusas de `thread close` e `thread entrega` (`thread-close.ts`), por `ErroDoCatalogo`. */
  sha256Invalido: 'sha256 inválido',
  artefatoForaDoProjeto: 'artefato deve estar dentro do projeto',
  artefatoNaoRegular: 'artefato deve ser arquivo regular',
  artefatoDiverge: 'hash do artefato diverge',
  artefatoExige: 'artefato exige thread aberta e autoria explícita',
  motivoDoFechamento: 'motivo deve ser orfa, engano ou superada',
  fechamentoExige: 'fechamento exige autoria e justificativa',
  encerradaPorOutroMotivo: 'thread já encerrada por outro motivo',
  entregueExigeMaster: 'thread entregue ou pontuada exige MASTER, não fechamento administrativo',
};

export const THREAD_EN: typeof THREAD_PT_BR = {
  largura: 10,
  rotulos: { id: 'id', slug: 'slug', nome: 'name', modo: 'mode', ciclo: 'cycle', fase: 'phase', status: 'status', base: 'base',
    worktree: 'worktree', conducao: 'conduction', score: 'score', check: 'check' },
  modo: (tag, pausas) => `${tag} (${pausas} planned human pause${pausas === 1 ? '' : 's'})`,
  cicloPadrao: 'default for the mode',
  status: (status) => STATUS_EN[status] ?? status,
  raizDoProjeto: '(project root)',
  ninguemConduz: 'nobody right now',
  validacao: '  validation CHECK on a runtime other than the GO one (required by the thread)',
  prontoQuando: (n) => `  done when (${n} executable criteri${n === 1 ? 'on' : 'a'})`,
  score: (valor, por, regime, quando) => `${valor}/5 by ${por} (${regime}) on ${quando}`,
  check: (nome, origem, quando, sha) => `${nome}, ${origem === 'opcao' ? 'by the --check option' : origem === 'manifesto'
    ? 'by the manifest' : 'by default'}, in the verify of ${quando} (${sha})`,
  blocosPrevistos: '  planned blocks',
  pausaPrevista: (sobre) => `planned pause: ${sobre}`,
  pausaSobre: (sobre) => PAUSA_SOBRE_EN[sobre] ?? sobre,
  semPausa: 'no planned human pause',
  slug: (produto, assunto, fases, rotacao) =>
    `product "${produto}", subject "${assunto}", phases "${fases}"${rotacao ? `, rotation ${rotacao}` : ''}`,
  conduzido: (canal, quem, fase, desde) => `conducted now by ${canal}, ${quem}, phase ${fase}, since ${desde}`,
  quemSessao: (id) => `session ${id}`,
  quemProcesso: (pid, operacao) => `process ${pid} (${operacao})`,
  quemReserva: (por) => `reserved by ${por}`,
  operacoes: {
    'phase.run': 'phase dispatch',
    'retry.run': 'phase retry',
    verify: 'ork verify',
    baseline: 'ork verify --baseline',
    'fix.open': 'ork fix open',
    'fix.reverify': 'ork fix reverify',
    'mcp.verify': 'ork_verify (MCP)',
    handoff: 'reservation of whoever took over',
    'branch.atualizar': 'merge of the base into the branch',
  },
  criada: 'Thread created.',
  simulacao: 'Dry run (--dry-run): nothing was written.',
  roadmapReservado: (item, maquina) => `  roadmap: ${item} reserved for this machine (${maquina})`,
  slugEm3Partes: (descrito) => `  3-part slug: ${descrito}`,
  estado: (id) => `  state: .orkastery/threads/${id}/thread.json`,
  proximoPasso: (id, fase) => `Next step: \`ork phase run ${id} ${fase} --prompt "<request>"\``,
  usoNew: 'usage: ork thread new <name> --modo <MODE>',
  doneSemComando: (entrada) => `done.sem-comando: "${entrada}" has no command. ` +
    'Use `--done "<criterion> :: <command that proves it>"`; a criterion without a command is prose, not a done criterion.',
  doneIncompleto: (entrada) => `done.incompleto: "${entrada}" needs a criterion AND a command`,
  varianteInvalida: (bruto, variantes) => `invalid cycle variant: "${bruto}". Use one of: ${variantes}`,
  cicloExigeWorktree: (variante) =>
    `usage: the ${variante} cycle requires an isolated worktree: create the thread without \`--sem-worktree\` or pick another cycle`,
  worktreeVazia: 'usage: `--worktree` takes `auto` or a directory that already exists',
  semWorktreeComValor: (valor) => `usage: \`--sem-worktree\` takes no value (got "${valor}")`,
  worktreeESemWorktree: 'usage: `--worktree` and `--sem-worktree` exclude each other; use one of them',
  worktreeChave: (gravada) => `  worktree: ${gravada ? 'created' : 'would be created'} by the \`worktree.por_thread\` key in ` +
    'orkastery.yaml; to create without it, use `--sem-worktree`',
  worktreeFlag: (gravada) => `  worktree: ${gravada ? 'created' : 'would be created'} by \`--worktree auto\``,
  worktreeCiclo: (gravada, variante) => `  worktree: ${gravada ? 'created' : 'would be created'} by ` +
    `${variante ? `the ${variante} cycle` : 'the thread cycle'}, which requires an isolated worktree`,
  avisoSemWorktree: (id, gravada, c) => {
    const inicio = gravada
      ? `Warning: thread ${id} has no worktree (\`--sem-worktree\`): it works at the project root`
      : `Warning: without a worktree (\`--sem-worktree\`), thread ${id} would work at the project root`;
    const ensure = `Before GO, \`ork worktree ensure ${id}\` creates the thread worktree and branch`;
    if (c.caso === 'sem-commit') {
      return `${inicio}, in a repository with no commit yet, outside any branch, and \`ork ship\` has no source branch ` +
        'to deliver. Make the first commit and follow the warning about a thread without a base.';
    }
    if (c.caso === 'head') {
      return `${inicio}, with a detached HEAD, outside any branch, and \`ork ship\` has no source branch to deliver. ${ensure}.`;
    }
    if (c.caso === 'outra') {
      return `${inicio}, on branch ${c.branch}, and \`ork ship\` delivers that branch as it is, with whatever else lands on it; ` +
        `with \`--para ${c.branch}\`, the delivery becomes a direct push, which the \`push_direto_na_base\` policy checks. ${ensure}.`;
    }
    const efeito = c.policy === 'block'
      ? '`ork ship` refuses the delivery under `push_direto_na_base` (block): there is no thread branch to merge'
      : c.policy === undefined || c.policy === 'off'
        ? '`ork ship` pushes the base directly, without a thread branch (`push_direto_na_base` off)'
        : `\`ork ship\` warns about \`push_direto_na_base\` (${c.policy}) and pushes the base directly, without a thread branch`;
    return `${inicio}, on the base branch ${c.base}, and ${efeito}. ${ensure}; after GO, the commits are already on the base and ` +
      'ship does not separate them.';
  },
  worktreeFalharia: (motivo, dir, branch, peloCiclo) => {
    const semWorktree = peloCiclo ? '' : ' or create it with `--sem-worktree`';
    if (motivo === 'pasta-existe') {
      return `Warning: the folder ${dir} already exists, and the real creation would refuse the thread worktree: remove the folder${semWorktree}.`;
    }
    if (motivo === 'branch-existe') {
      return `Warning: the branch ${branch} already exists, and the real creation would refuse the thread worktree: remove the branch${semWorktree}.`;
    }
    return 'Warning: the repository has no commit yet, and the real creation would refuse the thread worktree in `git worktree add`: ' +
      'make the first commit first.';
  },
  chaveSemCommit: (gravada) => 'Warning: `worktree.por_thread` asks for the thread worktree, but the repository has no commit yet: ' +
    `the thread ${gravada ? 'was created' : 'would be created'} at the project root, without a worktree.`,
  semBase: (id, gravada) => gravada
    ? `Warning: the repository has no commit yet, and thread ${id} was created without a base: ship has nowhere to start from. ` +
      `Make the first commit, close this one with \`ork thread close ${id} --motivo engano --por <who> ` +
      '--justificativa "opened before the first commit"` and open another.'
    : 'Warning: the repository has no commit yet, and the thread would be created without a base: make the first commit before opening the first thread.',
  roadmapNoNome: (item) => `Warning: ${item} in the name does not link the thread to the roadmap. In the terminal, check ` +
    `\`ork roadmap reservas\` and \`ork fabrica\`; to link and reserve it, use \`--roadmap ${item}\` in \`ork thread new\`. ` +
    'No reservation was created by this warning.',
  modoDesconhecido: (entrada, tags) => `modo.desconhecido: "${entrada}" is not a conduction mode. Use one of: ${tags}.`,
  modoAposentado: (motivo, tag, substitutos) =>
    `${motivo}: ${tag} was retired and opens no new work. Use ${substitutos.join(' or ')}. ` +
    `A thread already recorded in ${tag} keeps opening normally.`,
  publicacaoPendente: (motivo) => `Memory: publication pending (${motivo}); explicit activation required.`,
  memoriaGravada: (tenant, gravados) => `Memory (orkmind, tenant ${tenant}): ${gravados}.`,
  nadaAGravar: 'nothing to write',
  gravacoesFalhas: (n) => `  ${n} write(s) not completed; see \`ork memory status\`.`,
  fromFinding: {
    achadoNaoExiste: (id, board) => `finding "${id}" does not exist on the debt board (${board}). See: \`ork audit divida\``,
    recusada: (id) => `Thread from finding ${id} REFUSED.`,
    descricaoDoMotivo: (motivo) => ({
      'claims.failed': 'the finding claim has no passing proof on the real HEAD',
      'claims.unverifiable': 'the finding claim has no executable verification command',
      'achado.ja-virou-thread': 'the finding already opened a thread and cannot open another one',
    } as Record<string,string>)[motivo] ?? 'the typed audit rule refused the finding',
    motivoTipado: (motivo) => `  typed reason: ${motivo}`,
    detalhe: (detalhe) => `  detail: ${detalhe}`,
    correcao: (correcao) => `  fix: ${correcao}`,
    criada: (id) => `Thread created from finding ${id}.`,
    simulacao: 'Dry run (--dry-run): nothing was written.',
    origemDoGoal: (id) => `  GOAL source: .orkastery/threads/${id}/achado.json`,
    pedidoMontado: 'GOAL request already assembled from the finding:',
    proximoPasso: 'Next step:',
    comandoDoProximoPasso: (id) => `  ork phase run ${id} GOAL --prompt "$(cat .orkastery/threads/${id}/pedido-goal.md)"`,
    jaVirouThread: (achado, thread) => `finding ${achado} already opened thread ${thread}`,
    continueNaThread: (thread) => `continue in that thread: \`ork thread status ${thread}\``,
    claimPendente: (claim) => `finding claim ${claim} has not been rerun on the real HEAD: the auditor cannot self-report`,
    proveOAchado: (rodada) => `prove the finding before opening work: \`ork audit verify ${rodada}\``,
    claimReprovada: (claim) => `finding claim ${claim} FAILED when rerun on the real HEAD`,
    descarteOAchado: 'the finding is not supported: fix the evidence in the audit run or discard the finding instead of opening a thread',
    simulacaoDetalhe: 'dry run: no thread or board stamp was written',
    claimSemComando: (claim) => `WARNING: finding claim ${claim} has no verification command ` +
      '(typed reason claims.unverifiable, which warns and does not block)',
    achadoAberto: (achado, thread) => `finding ${achado} opened as thread ${thread}, with its evidence and claim`,
    achadoCabecalho: (id, severidade, pack, regra, titulo) => `  ${id}  [${severidade}] ${pack}/${regra}  ${titulo}`,
    evidencia: (valor) => `      evidence    ${valor}`,
    descricao: (valor) => `      description ${valor}`,
    claim: (id, estado, alegacao) => `      claim       ${id} [${estado}] ${alegacao}`,
    verificar: (comando) => `      verify      ${comando}`,
    semComando: '(no command: the auditor did not prove the finding)',
    impacto: (valor) => `      impact      ${valor}`,
    fix: (valor) => `      fix         ${valor}`,
    irreversivel: (valor) => `      irreversible ${valor}`,
    estimativa: (valor) => `      estimate    ${valor}`,
    destino: (destino, regime) => `      destination ${destino} (${regime} regime)`,
    estado: (estado, thread) => `      state       ${estado}${thread ? ` (thread ${thread})` : ''}`,
    pedidoCabecalho: (id, pack, regra, severidade) =>
      `Audit finding ${id} (pack ${pack}, rule ${regra}, severity ${severidade}).`,
    pedidoTitulo: (titulo) => `Title: ${titulo}`,
    pedidoEvidencia: (evidencia) => `Evidence: ${evidencia}`,
    pedidoDescricao: (descricao) => `Description: ${descricao}`,
    pedidoClaim: (id, estado, alegacao) => `Auditor claim (${id}, state ${estado}): ${alegacao}`,
    pedidoVerificar: (comando) => `How to rerun the evidence: ${comando}`,
    naoDeclarado: '(not declared by the auditor)',
    proposta: 'Adjustment proposed by the audit run:',
    propostaImpacto: (valor) => `  impact        ${valor}`,
    propostaFix: (valor) => `  suggested fix ${valor}`,
    propostaIrreversivel: (valor) => `  irreversible ${valor}`,
    propostaEstimativa: (valor) => `  estimate      ${valor}`,
    origem: (rodada, produto, estagio, postura) =>
      `Source: run ${rodada}, product ${produto}, stage ${estagio}, stance ${postura}.`,
    propostaNaoDecisao: 'The fix above is the auditor\'s proposal, not a decision: validate it in GOAL before implementing.',
  },
  naoEncontrada: (id, dir) => `thread "${id}" not found in ${dir}`,
  usoStatus: 'usage: ork thread status <thread-id>',
  slugInvalido: (slug, regex) => `invalid slug: "${slug}" (canonical regex: ${regex})`,
  roadmapItemInvalido: (item) => `roadmap.item: "${item}" is not a roadmap item (expected RM-NNN)`,
  roadmapItemInexistente: (id) => `roadmap.item: ${id} does not exist in \`docs/roadmap\``,
  usoPedido: 'usage: --pedido "<builder request text>"',
  varianteIncompativel: (variante, tag, fases) => `the ${variante} cycle redraws the blocks, and mode ${tag} has a single block ` +
    `(${fases}): create the thread without \`--ciclo\` or pick a full-cycle mode`,
  modoNaoPermitido: (tag, permitidos) => `mode ${tag} is not in \`conduction.allowed_modes\` (allowed: ${permitidos})`,
  nomeSemAssunto: (nome) => `name "${nome}" does not produce a valid subject (expected [a-z0-9])`,
  cicloExigeBranch: (variante) => `the ${variante} cycle starts from a branch that already exists: pass \`--branch <branch>\``,
  branchInexistente: (branch) => `branch "${branch}" does not exist in this repository`,
  branchSemCiclo: '`--branch` only applies with `--ciclo merge-branch`',
  ocupadaPelaChave: (pasta, alvo) => `${pasta ? 'the folder' : 'the branch'} ${alvo} already exists, and \`worktree.por_thread\` ` +
    'asks for the thread worktree: remove it or create the thread with `--sem-worktree`',
  usoComMotivo: (motivo) => `usage: ${motivo}`,
  pedidoVazio: 'thread.pedido.invalido: the request is empty',
  pedidoGrande: (bytes, teto) => `thread.pedido.invalido: the request has ${bytes} bytes, above the ${teto}-byte limit`,
  pedidoGuardado: (gravada, caminho, sha, bytes) => `  request: ${gravada ? 'saved to' : 'would be saved to'} ${caminho} (sha256 ${sha}, ` +
    `${bytes} bytes); \`ork prompt render\` uses it when \`--pedido\` is missing`,
  nenhumaSessao: '  no session dispatched yet',
  sessoesDespachadas: '  dispatched sessions (real state checked in `ork sessions`)',
  sessao: (verificada, canal) => `verified in the runtime: ${verificada ? 'yes' : 'no'}  channel: ${canal}`,
  pausasDoModo: (n) => `  planned human pauses in this mode: ${n}`,
  colunasDaLista: ['ID', 'SLUG', 'MODE', 'PHASE', 'STATUS', 'PAUSES', 'SESSIONS'],
  listaVazia: (todas, modo) => `${todas ? 'No thread in `.orkastery/threads`.'
    : 'No open or paused thread (use `--todas` to see the closed ones).'} Create one with \`ork thread new "<name>" --modo ${modo}\`.`,
  fechadasOmitidas: (n) => `  ${n} closed thread(s) hidden. Use \`--todas\` to see all.`,
  informeOId: 'pass the thread id',
  sha256Invalido: 'invalid sha256',
  artefatoForaDoProjeto: 'the artifact must be inside the project',
  artefatoNaoRegular: 'the artifact must be a regular file',
  artefatoDiverge: 'the artifact hash does not match',
  artefatoExige: 'an artifact needs an open thread and an explicit author',
  motivoDoFechamento: 'the reason must be `orfa`, `engano` or `superada`',
  fechamentoExige: 'closing needs an author and a justification',
  encerradaPorOutroMotivo: 'the thread was already closed for another reason',
  entregueExigeMaster: 'a delivered or scored thread needs MASTER, not an administrative close',
};
