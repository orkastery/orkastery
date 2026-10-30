/** RM-061 F3c: texto dos prompts de fase e da familia `ork prompt`. PT-BR e a fonte tipada. */

import { PAUSA_SOBRE_EN } from './locale-thread';

export interface MensagensDePrompts {
  contratoDasFases: Readonly<Record<'GOAL' | 'PLAN' | 'GO' | 'CHECK' | 'SHIP' | 'MASTER', string>>;
  invariantes: readonly string[];
  variante: (variante: string) => string;
  pausaSobre: (sobre: string) => string;
  pausa: (sobre: string) => string;
  semPausa: string;
  raizDoProjeto: string;
  regrasDeEvidencia: readonly string[];
  regraDasEsperas: string;
  /** RM-016: o rito de saida do GO, igual em Claude Code e Codex, na lingua do prompt. */
  fechoDoGo: (thread: string) => string;
  contextoDoGrafo: (thread: string) => string;
  memoria: {
    titulo: (regime: string) => string;
    explicacao: string;
    decisaoFechada: (id: string, por: string) => string;
    decisaoSemantica: (id: string) => string;
    decisaoSemId: string;
    licaoDaThread: (thread: string) => string;
    licoesDoProduto: string;
    regraMandatoria: (titulo: string) => string;
    grupos: Readonly<Record<'decision' | 'learning' | 'rule' | 'handoff' | 'roadmap', string>>;
    mandatory: string;
    origem: (location: string) => string;
  };
  secoesObrigatorias: readonly string[];
  regraCentral: string;
  cli: {
    variavelSemValor: (id: string, variaveis: string) => string;
    frontmatterAusente: (origem: string) => string;
    idAusente: string;
    idDiverge: (id: string, esperado: string) => string;
    versaoInvalida: (versao: number) => string;
    descricaoAusente: string;
    faseInvalida: (fase: string, fases: string) => string;
    variaveisNaoDeclaradas: (variaveis: string) => string;
    variaveisNaoUsadas: (variaveis: string) => string;
    secaoAusente: (secao: string) => string;
    regraCentralAusente: (regra: string) => string;
    pedidoAusente: (variavel: string, contrato: string) => string;
    segredo: (nome: string, linha: number) => string;
    tamanho: (bytes: number, limite: number) => string;
    hitlTextoLivre: (linha: number, oQue: string) => string;
    travessao: string;
    templateNaoExiste: (id: string, ids: string) => string;
    templatePadraoAusente: string;
    semParIngles: (id: string) => string;
    gravidades: Readonly<Record<'erro' | 'aviso', string>>;
    semProblema: (quantos: number) => string;
    resumoLint: (quantos: number, erros: number, avisos: number) => string;
    tituloLista: string;
    origem: (origem: string) => string;
    fases: (fases: string) => string;
    todas: string;
    comoVersionar: string;
    lintTitulo: (raiz: string | null) => string;
    somenteEmbutidos: string;
    pedidoExemplo: string;
    cabecalhoTemplate: (id: string, versao: number, origem: string) => string;
    cabecalhoExemplo: (modo: string, sha: string) => string;
    cabecalhoThread: (thread: string, fase: string, sha: string) => string;
    pedidoGuardado: (sha: string) => string;
    usoRenderThread: string;
    usoRenderExemplo: string;
    subcomandoDesconhecido: (sub: string) => string;
    faseForaDoCiclo: (fase: string, fases: string) => string;
  };
}

export const PROMPTS_PT_BR: MensagensDePrompts = {
  contratoDasFases: {
    GOAL: 'GOAL (F1): objetivo verificavel, impact map, criterios de sucesso e claims com comando de verificacao. Nao implementa.',
    PLAN: 'PLAN (F2): plano com tarefas, touch_paths, decisoes D1..Dn com domicilio unico e verify executavel por tarefa. Nao implementa.',
    GO: 'GO (F3): implementacao slice por slice, um commit atomico por tarefa, dentro da worktree da thread.',
    CHECK: 'CHECK (F4): verificacao contra a baseline (regressao versus divida pre-existente), review de codigo, testes, seguranca e performance; ' +
      'o parecer diz o modo do CHECK da rodada (Agile Check ou Classic Check, da linha `check` do `ork verify`).',
    SHIP: 'SHIP (F5): merge serializado, push provado por comando, roadmap atualizado e plano de rollback.',
    MASTER: 'MASTER (F6): MASTER log com postmortem tipado, licoes e o score humano de 0 a 5. Uma entrega sem MASTER log nao aconteceu.',
  },
  invariantes: [
    'Claims, verify e policies rodam identicos em todos os modos.',
    'Policy `block` pausa qualquer modo, inclusive #Auto.',
    'Escalacao tipada para humano pausa qualquer modo, inclusive #Auto.',
    'Toda entrega fecha com indice derivado do ledger; a nota humana, quando vier, sobrescreve.',
    'Toda decisao autonoma vai ao ledger com quem decidiu, evidencia e razao.',
  ],
  variante: (v) => `Variante de ciclo: ${v}`,
  pausaSobre: (s) => s,
  pausa: (sobre) => `Ao fim deste bloco HA PAUSA humana sobre: ${sobre}. Pare, apresente a evidencia e espere o veredito.`,
  semPausa: 'Ao fim deste bloco NAO ha pausa humana: siga com decisao autonoma e registre no ledger quem decidiu, com que evidencia e por que.',
  raizDoProjeto: '(raiz do projeto)',
  regrasDeEvidencia: [
    'Nada de self-report: toda alegacao vem com o comando que a comprova e a saida real.',
    'Trabalhe apenas no diretorio de trabalho indicado acima.',
    'Passos irreversiveis (push, merge, delecao) so acontecem quando o modo autoriza.',
  ],
  regraDasEsperas: 'Esperas: nunca dispare verify, build ou suite com `&` dentro do comando, porque o processo se perde e a sessao ' +
    'espera um aviso que nunca vem; prefira `ork_verify` assíncrono e consulte `ork_verify_status` a cada 30–60 s; sem essa ' +
    'ferramenta, rode o `ork verify` em primeiro plano, com `timeout` (ele espera a vez na fila de recursos pesados), ou use a execucao em segundo plano do host, que avisa quando termina; nunca espere com ' +
    '`pgrep -f` cujo padrao aparece no proprio comando, porque o laco acha a si mesmo e nao termina: espere pelo ' +
    'arquivo de saida com prazo, ou pelo PID guardado.',
  fechoDoGo: (t) => [
    '## Fecho obrigatório do GO',
    '',
    `Antes de encerrar o bloco com GO, use \`ork_verify\` e aguarde o veredito verde por \`ork_verify_status\`; sem a consulta assíncrona, rode \`ork verify ${t}\` em primeiro plano. Rode também o build declarado no manifesto em primeiro plano.`,
    `Com o veredito verde, gere o bundle com \`ork ci prepare ${t}\`, faça o commit atômico final \`ci(${t}): bundle ...\` e siga para CHECK e SHIP conforme os gates.`,
    `Grave \`.orkastery/threads/${t}/pr-body.md\` curto, no idioma do projeto, com o modo do CHECK da rodada (Agile Check ou Classic Check, da linha \`check\` do \`ork verify\`); ` +
      'se o perfil não puder gravá-lo pelo transporte autorizado, devolva o corpo completo no resumo final.',
    'O rito é idêntico em Claude Code e Codex. Ele fecha o GO, mas não autoriza SHIP, push, PR ou merge.',
  ].join('\n'),
  contextoDoGrafo: (thread) => '\n\n## Contexto do grafo (opcional)\n' +
    `Consulte ork_grafo_contexto {threadId: "${thread}"} ou ork grafo contexto ${thread} --json para o pacote da thread com evidencias e teto em bytes.\n` +
    'As tools ork_grafo_vizinhos, ork_grafo_chamadores, ork_grafo_importadores e ork_grafo_caminho permitem aprofundar. ' +
    'Sem indice do HEAD, rode ork grafo indexar. O grafo e parcial e descreve o HEAD; ' +
    'aresta com arvore: modificada vem de fonte que mudou depois dele: confira o arquivo antes de usar.\n',
  memoria: {
    titulo: (regime) => `## Memoria injetada (regime ${regime})`,
    explicacao: 'Recuperacao deterministica por tag. Todo item declara de onde veio: nada entra neste prompt sem proveniencia. ' +
      'O que NAO esta aqui esta nos ponteiros do handoff, recuperavel por `ork recall`.',
    decisaoFechada: (id, por) => `Decisao ${id} (fechada por ${por})`,
    decisaoSemantica: (id) => `Decisao ${id} (memoria semantica)`,
    decisaoSemId: 'Decisao fechada (memoria semantica)',
    licaoDaThread: (thread) => `Licao da thread ${thread}`,
    licoesDoProduto: 'Licoes das threads fechadas deste produto (POSTMORTEM e MASTER)',
    regraMandatoria: (titulo) => `Regra mandatoria: ${titulo}`,
    grupos: { decision: 'Decisoes fechadas desta thread (entram em TODA fase)', learning: 'Licoes de threads anteriores deste produto',
      rule: 'Regras mandatorias do ecossistema', handoff: 'Handoffs anteriores', roadmap: 'Roadmap' },
    mandatory: ' [MANDATORY]',
    origem: (location) => `origem: ${location}`,
  },
  secoesObrigatorias: ['## Ciclo canonico', '## Modo de conducao', '## Contexto da thread', '## Pedido do builder', '## Regras de evidencia'],
  regraCentral: 'REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.',
  cli: {
    variavelSemValor: (id, v) => `template ${id}: variavel sem valor na renderizacao: ${v}`,
    frontmatterAusente: (o) => `template em ${o}: frontmatter ausente (esperado bloco --- ... ---)`,
    idAusente: 'frontmatter sem `id`', idDiverge: (id, e) => `o id "${id}" nao bate com o nome do arquivo "${e}.md"`,
    versaoInvalida: (v) => `versao "${v}" invalida: esperado inteiro a partir de 1`, descricaoAusente: 'frontmatter sem `descricao`',
    faseInvalida: (f, fs) => `"${f}" nao e fase do ciclo canonico (${fs})`,
    variaveisNaoDeclaradas: (v) => `usadas no corpo e nao declaradas: ${v}`, variaveisNaoUsadas: (v) => `declaradas e nao usadas: ${v}`,
    secaoAusente: (s) => `secao obrigatoria ausente: ${s}`, regraCentralAusente: (r) => `o template perdeu a linha: ${r}`,
    pedidoAusente: (v, c) => `o template nao usa {{${v}}}: despacharia uma ${c} sem a demanda do builder`,
    segredo: (n, l) => `padrao "${n}" casou na linha ${l} do template (trecho omitido de proposito)`,
    tamanho: (b, l) => `${b} bytes acima do limite de ${l}`,
    hitlTextoLivre: (l, o) => `linha ${l} pede ${o}; HITL de conducao e selecao de 3 a 5 alternativas com uma Recomendacao (RM-057)`,
    travessao: 'o template usa travessao longo (U+2014); o padrao do projeto e hifen ou virgula',
    templateNaoExiste: (id, ids) => `template "${id}" nao existe (conhecidos: ${ids})`,
    templatePadraoAusente: 'template `fase-padrao` ausente: o `ork` nao tem prompt de fase',
    semParIngles: (id) => `o dono fala ingles e o template ${id} do projeto nao tem o par ${id}.en: essa fase sai em pt-BR`,
    gravidades: { erro: 'erro', aviso: 'aviso' }, semProblema: (n) => `  nenhum problema em ${n} template(s)`,
    resumoLint: (n, e, a) => `templates: ${n} | erros: ${e} | avisos: ${a}`,
    tituloLista: 'Templates de prompt (o do projeto sobrescreve o embutido de mesmo id)', origem: (o) => `origem: ${o}`,
    fases: (f) => `fases: ${f}`, todas: 'todas', comoVersionar: 'Para versionar o seu: grave em prompts/<id>.md e rode `ork prompt lint`.',
    lintTitulo: (r) => `Lint dos templates de prompt${r ? ` (projeto ${r})` : ' (somente embutidos)'}`, somenteEmbutidos: 'somente embutidos',
    pedidoExemplo: '<pedido do builder>', cabecalhoTemplate: (id, v, o) => `# template ${id} v${v} (origem: ${o})`,
    cabecalhoExemplo: (m, s) => `# thread de EXEMPLO (nada foi gravado), modo ${m}, sha256 ${s}`,
    cabecalhoThread: (t, f, s) => `# thread ${t}, fase ${f}, sha256 ${s}`,
    pedidoGuardado: (s) => `# pedido guardado na criacao da thread (sha256 ${s})`,
    usoRenderThread: 'uso: ork prompt render <thread-id> <FASE> --pedido "<texto>"',
    usoRenderExemplo: '     ork prompt render --exemplo --fase GOAL --modo auto --pedido "<texto>"',
    subcomandoDesconhecido: (s) => `subcomando desconhecido: prompt ${s}`,
    faseForaDoCiclo: (f, fs) => `fase "${f}" fora do ciclo canonico (${fs})`,
  },
};

export const PROMPTS_EN: MensagensDePrompts = {
  contratoDasFases: {
    GOAL: 'GOAL (F1): verifiable objective, impact map, success criteria, and claims with verification commands. Does not implement.',
    PLAN: 'PLAN (F2): sliced tasks, queryable touch_paths, D1..Dn decisions with one home, and executable verify per task. Does not implement.',
    GO: 'GO (F3): implement slice by slice, one atomic commit per task, inside the thread worktree.',
    CHECK: 'CHECK (F4): verify against the baseline (regressions versus pre-existing debt), then review code, tests, security, and performance; ' +
      'the verdict names the CHECK mode of the round (Agile Check or Classic Check, from the `check` line of `ork verify`).',
    SHIP: 'SHIP (F5): serialized merge, command-proven push, updated roadmap, and rollback plan.',
    MASTER: 'MASTER (F6): typed POSTMORTEM, MASTER log, lessons, and a human score from 0 to 5. A delivery without a MASTER log did not happen.',
  },
  invariantes: [
    'Claims, verify, and policies run identically in every mode.',
    'A `block` policy pauses every mode, including #Auto.',
    'A typed human escalation pauses every mode, including #Auto.',
    'Every delivery closes with an index derived from the ledger; a later human score overrides it.',
    'Every autonomous decision goes to the ledger with who decided, evidence, and rationale.',
  ],
  variante: (v) => `Cycle variant: ${v}`,
  pausaSobre: (s) => PAUSA_SOBRE_EN[s] ?? s,
  pausa: (s) => `At the end of this block, PAUSE for a human verdict about: ${s}. Stop, present the evidence, and wait for the verdict.`,
  semPausa: 'At the end of this block there is NO human pause: continue autonomously and record who decided, the evidence, and why in the ledger.',
  raizDoProjeto: '(project root)',
  regrasDeEvidencia: [
    'No self-report: every claim includes the command that proves it and its real output.',
    'Work only in the working directory shown above.',
    'Irreversible steps (push, merge, deletion) happen only when the mode authorizes them.',
  ],
  regraDasEsperas: 'Waiting: never start verify, build, or a test suite with `&` inside the command; the process may be lost while the session ' +
    'waits for a notice that never comes. Prefer asynchronous `ork_verify` and query `ork_verify_status` every 30–60 seconds; without that ' +
    'tool, run `ork verify` in the foreground with `timeout` (it waits for the heavy-resource queue), or use the host background execution that reports completion. Never wait with `pgrep -f` when its pattern appears in the command itself; ' +
    'the loop finds itself and never ends. Wait for an output file with a deadline, or for a stored PID.',
  fechoDoGo: (t) => [
    '## Mandatory GO closing',
    '',
    `Before ending a block that includes GO, use \`ork_verify\` and wait for its green verdict through \`ork_verify_status\`; without the asynchronous query, run \`ork verify ${t}\` in the foreground. Also run the manifest build in the foreground.`,
    `After the green verdict, generate the bundle with \`ork ci prepare ${t}\`, make the final atomic commit \`ci(${t}): bundle ...\`, and continue to CHECK and SHIP as their gates allow.`,
    `Write a short \`.orkastery/threads/${t}/pr-body.md\` in the project language, naming the CHECK mode of the round (Agile Check or Classic Check, from the \`check\` line of \`ork verify\`); ` +
      'if the profile cannot write it through the authorized transport, return the full body in the final summary.',
    'The ritual is identical in Claude Code and Codex. It closes GO, but it does not authorize SHIP, push, PR, or merge.',
  ].join('\n'),
  contextoDoGrafo: (thread) => '\n\n## Graph context (optional)\n' +
    `Use ork_grafo_contexto {threadId: "${thread}"} or ork grafo contexto ${thread} --json for the thread package with evidence and a byte limit.\n` +
    'The ork_grafo_vizinhos, ork_grafo_chamadores, ork_grafo_importadores, and ork_grafo_caminho tools allow deeper queries. ' +
    'If HEAD has no index, run ork grafo indexar. The graph is partial and describes HEAD; an edge marked arvore: modificada comes from a source ' +
    'that changed after HEAD, so inspect the file before using it.\n',
  memoria: {
    titulo: (regime) => `## Injected memory (${regime} regime)`,
    explicacao: 'Deterministic retrieval by tag. Every item declares its source: nothing enters this prompt without provenance. ' +
      'What is NOT here remains in the handoff pointers and can be retrieved with `ork recall`.',
    decisaoFechada: (id, por) => `Decision ${id} (closed by ${por})`,
    decisaoSemantica: (id) => `Decision ${id} (semantic memory)`,
    decisaoSemId: 'Closed decision (semantic memory)',
    licaoDaThread: (thread) => `Lesson from thread ${thread}`,
    licoesDoProduto: 'Lessons from closed threads in this product (POSTMORTEM and MASTER)',
    regraMandatoria: (titulo) => `Mandatory rule: ${titulo}`,
    grupos: { decision: 'Closed decisions from this thread (included in EVERY phase)', learning: 'Lessons from previous product threads',
      rule: 'Mandatory ecosystem rules', handoff: 'Previous handoffs', roadmap: 'Roadmap' },
    mandatory: ' [MANDATORY]',
    origem: (location) => `source: ${location}`,
  },
  secoesObrigatorias: ['## Canonical cycle', '## Conduction mode', '## Thread context', '## Builder request', '## Evidence rules'],
  regraCentral: 'CENTRAL RULE: the mode relaxes the pause, NEVER verification.',
  cli: {
    variavelSemValor: (id, v) => `template ${id}: missing render value for variable: ${v}`,
    frontmatterAusente: (o) => `template at ${o}: missing frontmatter (expected a --- ... --- block)`,
    idAusente: 'frontmatter has no `id`', idDiverge: (id, e) => `id "${id}" does not match file name "${e}.md"`,
    versaoInvalida: (v) => `invalid version "${v}": expected an integer starting at 1`, descricaoAusente: 'frontmatter has no `descricao`',
    faseInvalida: (f, fs) => `"${f}" is not a canonical phase (${fs})`,
    variaveisNaoDeclaradas: (v) => `used in the body but not declared: ${v}`, variaveisNaoUsadas: (v) => `declared but not used: ${v}`,
    secaoAusente: (s) => `missing required section: ${s}`, regraCentralAusente: (r) => `template lost the line: ${r}`,
    pedidoAusente: (v, c) => `template does not use {{${v}}}: it would dispatch a ${c} without the builder request`,
    segredo: (n, l) => `pattern "${n}" matched template line ${l} (excerpt intentionally omitted)`,
    tamanho: (b, l) => `${b} bytes exceeds the ${l}-byte limit`,
    hitlTextoLivre: (l, _o) => `line ${l} asks for free-form text; conduction HITL is a selection of 3 to 5 choices with one Recommendation (RM-057)`,
    travessao: 'template uses an em dash (U+2014); the project standard is a hyphen or comma',
    templateNaoExiste: (id, ids) => `template "${id}" does not exist (known: ${ids})`,
    templatePadraoAusente: 'missing `fase-padrao` template: `ork` has no phase prompt',
    semParIngles: (id) => `the owner speaks English and the project template ${id} has no ${id}.en counterpart: that phase is rendered in pt-BR`,
    gravidades: { erro: 'error', aviso: 'warning' }, semProblema: (n) => `  no problem in ${n} template(s)`,
    resumoLint: (n, e, a) => `templates: ${n} | errors: ${e} | warnings: ${a}`,
    tituloLista: 'Prompt templates (the project template overrides the built-in template with the same id)',
    origem: (o) => `source: ${o === 'embutido' ? 'built-in' : o}`,
    fases: (f) => `phases: ${f}`, todas: 'all', comoVersionar: 'To version yours, write prompts/<id>.md and run `ork prompt lint`.',
    lintTitulo: (r) => `Prompt template lint${r ? ` (project ${r})` : ' (built-ins only)'}`, somenteEmbutidos: 'built-ins only',
    pedidoExemplo: '<builder request>',
    cabecalhoTemplate: (id, v, o) => `# template ${id} v${v} (source: ${o === 'embutido' ? 'built-in' : o})`,
    cabecalhoExemplo: (m, s) => `# EXAMPLE thread (nothing was written), mode ${m}, sha256 ${s}`,
    cabecalhoThread: (t, f, s) => `# thread ${t}, phase ${f}, sha256 ${s}`,
    pedidoGuardado: (s) => `# request stored when the thread was created (sha256 ${s})`,
    usoRenderThread: 'usage: ork prompt render <thread-id> <PHASE> --pedido "<text>"',
    usoRenderExemplo: '       ork prompt render --exemplo --fase GOAL --modo auto --pedido "<text>"',
    subcomandoDesconhecido: (s) => `unknown subcommand: prompt ${s}`,
    faseForaDoCiclo: (f, fs) => `phase "${f}" is outside the canonical cycle (${fs})`,
  },
};
