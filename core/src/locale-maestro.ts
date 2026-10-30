/** RM-061 F3e: moldura humana do panorama Maestro; o snapshot JSON continua canônico. */
export const MAESTRO_PT_BR = {
  help: 'ork maestro [--json] [--thread ID] [--section NOME --offset N]\nConsulta sem criar ou despachar trabalho. Na conversa, diga: orkastery maestro.',
  origem: {
    installation: 'fixado na instalação', cwd: 'pelo diretório atual', worktree: 'pela worktree da thread',
    selection: 'pedido explicitamente (--projeto ou ORK_PROJETO)',
  } as Record<string, string>,
  titulo: (projeto: string) => `${projeto} · panorama Maestro`,
  consulta: (data: string) => `• Consulta: ${data}`,
  projeto: (nome: string, raiz: string, remoto: string | undefined, origem: string) =>
    `• Projeto consultado: ${nome}${raiz ? ` · ${raiz}` : ''}${remoto === undefined ? '' : ` · ${remoto}`} · ${origem}`,
  semRemoto: 'sem remoto',
  naoLido: (itens: string) => `• Não lido: ${itens}`,
  secao: (nome: string, estado: string, retornados: number, total: number | null, mais: boolean) =>
    `• ${nome}: ${estado} · ${retornados}/${total ?? '?'}${mais ? ' · mais itens disponíveis' : ''}`,
  thread: (titulo: string, fase: string, estado: string) => `  ${titulo}: ${fase} · ${estado}`,
  recomendacao: (conflitos: number, lacunas: number) => `• Recomendo: ${conflitos ? 'reler as fontes em conflito'
    : lacunas ? 'conferir as lacunas antes de agir' : 'escolher uma thread para ver o detalhe'}.`,
  final: 'Use ork maestro --json para cobertura e ações; --thread ID consulta o detalhe nativo.',
};

export const MAESTRO_EN: typeof MAESTRO_PT_BR = {
  help: 'ork maestro [--json] [--thread ID] [--section NAME --offset N]\nRead without creating or dispatching work. In the conversation, say: orkastery maestro.',
  origem: {
    installation: 'fixed by the installation', cwd: 'from the current directory', worktree: 'from the thread worktree',
    selection: 'explicitly selected (--projeto or ORK_PROJETO)',
  },
  titulo: (project) => `${project} · Maestro overview`,
  consulta: (date) => `• Read at: ${date.replace('(horário de Brasília)', '(Brasilia time)')}`,
  projeto: (name, root, remote, origin) => `• Project read: ${name}${root ? ` · ${root}` : ''}${remote === undefined ? '' : ` · ${remote}`} · ${origin}`,
  semRemoto: 'no remote',
  naoLido: (items) => `• Not read: ${items}`,
  secao: (name, state, returned, total, more) =>
    `• ${name}: ${state} · ${returned}/${total ?? '?'}${more ? ' · more items available' : ''}`,
  thread: (title, phase, state) => `  ${title}: ${phase} · ${state}`,
  recomendacao: (conflicts, gaps) => `• Recommendation: ${conflicts ? 'reread the conflicting sources'
    : gaps ? 'check the gaps before acting' : 'choose a thread to read its details'}.`,
  final: 'Use ork maestro --json for coverage and actions; --thread ID reads the native details.',
};

export type TextosDoMaestro = typeof MAESTRO_PT_BR;
