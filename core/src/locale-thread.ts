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

const PAUSA_SOBRE_EN: Readonly<Record<string, string>> = {
  objetivo: 'goal', plano: 'plan', implementacao: 'implementation', evidencias: 'evidence', push: 'push', score: 'score',
  premissas: 'assumptions', 'evidencias, com autorizacao antecipada de push': 'evidence, with push authorized in advance',
};
const STATUS_EN: Readonly<Record<string, string>> = { aberta: 'open', pausada: 'paused', fechada: 'closed' };

export const THREAD_PT_BR = {
  /** Largura do rotulo no resumo (`  id        valor`). */
  largura: 9,
  rotulos: { id: 'id', slug: 'slug', nome: 'nome', modo: 'modo', ciclo: 'ciclo', fase: 'fase', status: 'status', base: 'base',
    worktree: 'worktree', conducao: 'conducao', score: 'score' },
  modo: (tag: string, pausas: number) => `${tag} (${pausas} pausas humanas previstas)`,
  cicloPadrao: 'padrao do modo',
  status: (status: string) => status,
  raizDoProjeto: '(raiz do projeto)',
  ninguemConduz: 'ninguem conduz agora',
  validacao: '  validacao CHECK em runtime diferente do GO (exigido pela thread)',
  prontoQuando: (n: number) => `  pronto quando (${n} criterio(s) executaveis)`,
  score: (valor: number, por: string, regime: string, quando: string) => `${valor}/5 por ${por} (${regime}) em ${quando}`,
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
  // ork thread status
  naoEncontrada: (id: string, dir: string) => `thread "${id}" nao encontrada em ${dir}`,
  usoStatus: 'uso: ork thread status <thread-id>',
  nenhumaSessao: '  nenhuma sessao despachada ainda',
  sessoesDespachadas: '  sessoes despachadas (estado real conferido em `ork sessions`)',
  sessao: (verificada: boolean, canal: string) => `verificada no runtime: ${verificada ? 'sim' : 'nao'}  canal: ${canal}`,
  pausasDoModo: (n: number) => `  pausas humanas do modo: ${n}`,
};

export const THREAD_EN: typeof THREAD_PT_BR = {
  largura: 10,
  rotulos: { id: 'id', slug: 'slug', nome: 'name', modo: 'mode', ciclo: 'cycle', fase: 'phase', status: 'status', base: 'base',
    worktree: 'worktree', conducao: 'conduction', score: 'score' },
  modo: (tag, pausas) => `${tag} (${pausas} planned human pause${pausas === 1 ? '' : 's'})`,
  cicloPadrao: 'mode default',
  status: (status) => STATUS_EN[status] ?? status,
  raizDoProjeto: '(project root)',
  ninguemConduz: 'nobody is conducting it now',
  validacao: '  validation CHECK on a runtime other than the GO one (required by the thread)',
  prontoQuando: (n) => `  done when (${n} executable criteri${n === 1 ? 'on' : 'a'})`,
  score: (valor, por, regime, quando) => `${valor}/5 by ${por} (${regime}) on ${quando}`,
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
      ? '`ork ship` blocks the delivery through `push_direto_na_base` (block): there is no thread branch to merge'
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
  naoEncontrada: (id, dir) => `thread "${id}" not found in ${dir}`,
  usoStatus: 'usage: ork thread status <thread-id>',
  nenhumaSessao: '  no session dispatched yet',
  sessoesDespachadas: '  dispatched sessions (real state checked in `ork sessions`)',
  sessao: (verificada, canal) => `verified in the runtime: ${verificada ? 'yes' : 'no'}  channel: ${canal}`,
  pausasDoModo: (n) => `  human pauses of the mode: ${n}`,
};
