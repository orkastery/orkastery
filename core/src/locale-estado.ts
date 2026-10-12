/**
 * RM-061, fatia F3b: a familia `estado` do catalogo de mensagens, os erros de estado e de procedencia
 * (`estado-thread.ts`, `procedencia.ts`, `manifest.ts` e a postura local) e a conferencia do estado unico que o `ork worktree
 * audit` mostra. O pt-BR e a
 * fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * Os erros nascem por `ErroDoCatalogo` no locale ativo: no escopo pt-BR da gravacao, no servidor MCP e no cron, em pt-BR
 * como sempre; a entrada do CLI os remonta no locale do comando. O motivo tipado do comeco da mensagem (`estado.link`,
 * `estado.rastreado`, `transporte.rastreado`, `ponteiro.fora-da-raiz`) e o mesmo nas duas linguas: ha codigo que o le.
 */

export const ESTADO_PT_BR = {
  gitInvalido: (local: string) => `.git inválido em ${local}`,
  arvorePrincipal: (comum: string) => `árvore principal não resolvida pelo git-common-dir: ${comum}`,
  idInvalido: 'id de thread inválido',
  link: (rel: string) => `estado.link: ${rel} é link simbólico; o estado do ork fica em ` +
    'pastas de verdade dentro da raiz (um link versionado levaria a escrita para fora dela). Remova o link.',
  legadoComLink: (nome: string) => `estado legado contém link: ${nome}`,
  legadoEspecial: (nome: string) => `estado legado contém arquivo especial: ${nome}`,
  foraDaArvore: 'worktree não pertence à árvore principal',
  indiceIndisponivel: (saida: string) => `índice da worktree indisponível: ${saida}`,
  naoPreservou: (saida: string) => `não foi possível preservar o estado versionado no índice: ${saida}`,
  threadsVinculado: 'diretório de threads inesperadamente vinculado',
  linkOutroDestino: (local: string) => `link de estado aponta para outro destino: ${local}`,
  dividido: (nome: string, local: string, alvo: string) => `estado dividido: ${nome} diverge entre ${local} e ${alvo}; reconcilie antes do sync`,
  linkQuebrado: (local: string) => `link de estado quebrado: ${local}`,
  preparacaoFalhou: (saida: string) => `preparação do estado para Git falhou: ${saida}`,
  alteradoDuranteGit: (local: string) => `estado local alterado durante operação Git: ${local}; cópia e main preservadas para reconciliação`,
  /** O detalhe do check `estado-unico` do audit: vai ao ledger em pt-BR e a impressao o remonta. */
  estadoUnico: (ok: boolean, main: number, local: number, caminho: string) =>
    `${ok ? 'mesmo estado' : 'estado dividido'}: main=${main} eventos, worktree=${local} eventos; ${caminho}`,
  estadoUnicoCorrecao: (id: string) => `ork worktree sync ${id}; divergências exigem reconciliação preservando evidências`,
  // procedencia.ts
  rastreado: (rel: string) => `estado.rastreado: ${rel} está versionado no git, e estado versionado ` +
    'não escolhe onde o ork roda (ele pode ter vindo de outro repositório). Tire o estado do índice ' +
    '(git rm -r --cached .orkastery e .orkastery/ no .gitignore) e rode o comando de novo.',
  worktreeNaoRegistrada: (dir: string, id: string) => `estado.worktree-nao-registrada: ${dir} não aparece em ` +
    'git worktree list deste repositório, e o ork só roda git e agente na raiz do projeto ou numa worktree ' +
    `registrada. Recrie a worktree da thread com ork worktree ensure ${id}.`,
  transporteRastreado: (arquivo: string) => `transporte.rastreado: ${arquivo} está versionado no git, e o transporte do ` +
    'pulse e do digest só vale do arquivo local desta máquina. Tire-o do índice (git rm --cached) e grave-o ' +
    'de novo nesta máquina.',
  transporteNaoComum: (arquivo: string) => `transporte.rastreado: ${arquivo} precisa ser um arquivo comum desta máquina, ` +
    'não link nem diretório.',
  ponteiroForaDaRaiz: (origem: string) => `ponteiro.fora-da-raiz: ${origem} aponta para fora da raiz do ` +
    'projeto e da worktree registrada da thread (também por link simbólico). Um ponteiro guardado no estado só lê ' +
    'arquivo de dentro do projeto. Exporte o handoff de novo (ork handoff export) ou copie o arquivo para dentro do projeto.',
  // manifest.ts (o diretorio de estado da raiz) e postura-local.ts (a pasta privada da confirmacao local)
  dirEstadoLink: (dir: string) => `estado.link: ${dir} é link simbólico; o estado do ork fica numa pasta de verdade dentro da raiz. Remova o link.`,
  posturaEstadoLink: 'estado.link: .orkastery precisa ser pasta de verdade',
  posturaPrivadaLink: 'estado.link: .orkastery/private precisa ser pasta de verdade',
  posturaRastreada: (nome: string) => `estado.rastreado: ${nome} está versionado no git; tire-o do índice (git rm --cached) antes de confirmar`,
  // branch-de-estado.ts: o remoto que nunca vai ao git (`<prefixo>` e de quem usa: ship, roadmap, fabrica, ci)
  remotoInvalido: (prefixo: string, remoto: string) => `${prefixo}.remoto-invalido: o remoto ${remoto} não é nome de remoto do git ` +
    '(letras, dígitos, ".", "_", "-" e "/" entre partes, cada parte começando por letra ou dígito, sem URL); nada foi passado ao git. ' +
    'Corrija fabrica.remoto no orkastery.yaml ou --remoto (padrão: origin).',
};

export type MensagensDeEstado = typeof ESTADO_PT_BR;

export const ESTADO_EN: MensagensDeEstado = {
  gitInvalido: (local) => `invalid \`.git\` in ${local}`,
  arvorePrincipal: (comum) => `main tree not resolved from git-common-dir: ${comum}`,
  idInvalido: 'invalid thread id',
  link: (rel) => `estado.link: ${rel} is a symbolic link; ork state lives in real folders inside the root ` +
    '(a versioned link would send writes outside it). Remove the link.',
  legadoComLink: (nome) => `legacy state contains a link: ${nome}`,
  legadoEspecial: (nome) => `legacy state contains a special file: ${nome}`,
  foraDaArvore: 'the worktree does not belong to the main tree',
  indiceIndisponivel: (saida) => `worktree index unavailable: ${saida}`,
  naoPreservou: (saida) => `could not keep the versioned state in the index: ${saida}`,
  threadsVinculado: 'threads directory unexpectedly linked',
  linkOutroDestino: (local) => `state link points to another target: ${local}`,
  dividido: (nome, local, alvo) => `split state: ${nome} differs between ${local} and ${alvo}; reconcile before the sync`,
  linkQuebrado: (local) => `broken state link: ${local}`,
  preparacaoFalhou: (saida) => `preparing the state for Git failed: ${saida}`,
  alteradoDuranteGit: (local) => `local state changed during a Git operation: ${local}; copy and main kept for reconciliation`,
  estadoUnico: (ok, main, local, caminho) => `${ok ? 'same state' : 'split state'}: main=${main} events, worktree=${local} events; ${caminho}`,
  estadoUnicoCorrecao: (id) => `ork worktree sync ${id}; divergences need a reconciliation that keeps the evidence`,
  rastreado: (rel) => `estado.rastreado: ${rel} is versioned in git, and versioned state does not choose where ork runs ` +
    '(it may have come from another repository). Remove the state from the index ' +
    '(`git rm -r --cached .orkastery` and `.orkastery/` in `.gitignore`) and run the command again.',
  worktreeNaoRegistrada: (dir, id) => `estado.worktree-nao-registrada: ${dir} does not show up in this repository's ` +
    '`git worktree list`, and ork only runs git and agents at the project root or in a registered worktree. ' +
    `Recreate the thread worktree with \`ork worktree ensure ${id}\`.`,
  transporteRastreado: (arquivo) => `transporte.rastreado: ${arquivo} is versioned in git, and the pulse and digest transport ` +
    'only counts from this machine\'s local file. Remove it from the index (`git rm --cached`) and write it again on this machine.',
  transporteNaoComum: (arquivo) => `transporte.rastreado: ${arquivo} must be a regular file on this machine, not a link or a directory.`,
  ponteiroForaDaRaiz: (origem) => `ponteiro.fora-da-raiz: ${origem} points outside the project root and the thread's registered ` +
    'worktree (also through a symbolic link). A pointer kept in the state only reads files inside the project. ' +
    'Export the handoff again (`ork handoff export`) or copy the file into the project.',
  dirEstadoLink: (dir) => `estado.link: ${dir} is a symbolic link; ork state lives in a real folder inside the root. Remove the link.`,
  posturaEstadoLink: 'estado.link: .orkastery must be a real folder',
  posturaPrivadaLink: 'estado.link: .orkastery/private must be a real folder',
  posturaRastreada: (nome) => `estado.rastreado: ${nome} is versioned in git; take it out of the index (\`git rm --cached\`) before confirming`,
  remotoInvalido: (prefixo, remoto) => `${prefixo}.remoto-invalido: remote ${remoto} is not a git remote name ` +
    '(letters, digits, ".", "_", "-" and "/" between parts, each part starting with a letter or digit, no URL); nothing was passed to git. ' +
    'Fix `fabrica.remoto` in `orkastery.yaml` or `--remoto` (default: origin).',
};
