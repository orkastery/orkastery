/**
 * Prompts como templates versionados (bloco B4).
 *
 * Ate o B2 o prompt de fase era montado por concatenacao dentro do `phase.ts`: mudar uma
 * linha do contrato de fase era mudar codigo, e nao havia como um projeto revisar o prompt
 * sem abrir o compilador. Aqui o prompt vira TEMPLATE VERSIONADO:
 *
 *   - o template embutido no `ork` e a fonte de verdade quando o projeto nao tem opiniao;
 *   - `<raiz>/prompts/<id>.md` sobrescreve o embutido de mesmo id, versionado no git do projeto;
 *   - `ork prompt lint` reprova template quebrado ANTES de ele virar despacho;
 *   - `ork prompt render` mostra o prompt exato, com o mesmo sha256 que iria para o ledger.
 *
 * A regra de ouro do bloco continua valendo: o template e dado, o renderizador e codigo, e
 * nenhuma regra de negocio nova entra aqui. O que o template faz e dizer com que texto o
 * nucleo despacha; quem decide o que despachar continua sendo o `ork`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { definicaoDoModo } from './modos';
import { procurarSegredos } from './policies';
import { Fase, FASES, Modo, Thread } from './types';
import { localeAtivo, msg, Locale } from './locale';
import { PROMPTS_EN, PROMPTS_PT_BR } from './locale-prompts';

/** Limite duro de um template, o mesmo do manifesto: prosa longa nao vira prompt. */
export const LIMITE_TEMPLATE_BYTES = 16384;

/**
 * KG5 fatia 2: dica opt-in no pedido; desligada preserva o texto byte a byte. Fatia 5: a dica diz o que
 * a marca `arvore: modificada` quer dizer na aresta.
 */
export function pedidoComDicaDoGrafo(pedido: string, thread: string, ligado: boolean, locale: Locale = localeAtivo()): string {
  if (!ligado) return pedido;
  return pedido.trimEnd() + (locale === 'en' ? PROMPTS_EN : PROMPTS_PT_BR).contextoDoGrafo(thread);
}

/** Onde um projeto guarda os templates que sobrescrevem os embutidos. */
export function dirDeTemplates(raiz: string): string {
  return path.join(raiz, 'prompts');
}

export interface TemplateDePrompt {
  id: string;
  versao: number;
  descricao: string;
  /** Fases que este template atende. Lista vazia quer dizer "todas". */
  fases: Fase[];
  /** Variaveis declaradas no frontmatter, na ordem em que foram declaradas. */
  variaveis: string[];
  /** O corpo, sem o frontmatter. */
  corpo: string;
  /** `embutido` ou o caminho do arquivo que o projeto versionou. */
  origem: string;
  /** O arquivo inteiro, frontmatter incluso, como ele existe em disco. */
  bruto: string;
}

/** Uma regra de lint que reprovou (ou avisou) sobre um template. */
export interface ProblemaDeTemplate {
  template: string;
  regra: string;
  gravidade: 'erro' | 'aviso';
  detalhe: string;
}

/** Toda `{{variavel}}` usada no corpo, sem repeticao, na ordem de aparicao. */
export function variaveisUsadas(corpo: string): string[] {
  const achadas: string[] = [];
  const regex = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
  let casado: RegExpExecArray | null;
  while ((casado = regex.exec(corpo)) !== null) {
    if (!achadas.includes(casado[1])) achadas.push(casado[1]);
  }
  return achadas;
}

/**
 * Renderiza o template com os valores informados.
 *
 * Duas regras, ambas deterministicas e testadas:
 *  1. variavel usada e nao informada e ERRO, nunca string vazia silenciosa;
 *  2. linha cujo conteudo inteiro e uma unica variavel que resolveu vazio SOME, para que um
 *     campo opcional (a variante de ciclo, por exemplo) nao deixe linha em branco no prompt.
 */
export function renderizar(template: TemplateDePrompt, valores: Record<string, string>): string {
  const faltando = variaveisUsadas(template.corpo).filter((v) => !(v in valores));
  if (faltando.length > 0) {
    throw new Error(msg().prompts.cli.variavelSemValor(template.id, faltando.join(', ')));
  }
  const linhas = template.corpo.split('\n');
  const saida: string[] = [];
  for (const linha of linhas) {
    const soUmaVariavel = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/.exec(linha);
    if (soUmaVariavel && valores[soUmaVariavel[1]] === '') continue;
    saida.push(linha.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_, nome: string) => valores[nome]));
  }
  return saida.join('\n');
}

function parseListaInline(bruto: string): string[] {
  const limpo = bruto.trim();
  if (limpo === '' || limpo === '[]') return [];
  const interno = limpo.startsWith('[') && limpo.endsWith(']') ? limpo.slice(1, -1) : limpo;
  return interno
    .split(',')
    .map((p) => p.trim().replace(/^["']|["']$/g, ''))
    .filter((p) => p.length > 0);
}

/**
 * Le o frontmatter e o corpo de um template.
 *
 * O parser aceita o subconjunto que os templates usam (`chave: valor` e lista inline), e
 * reprova em vez de adivinhar: frontmatter ausente e erro, nao template sem metadados.
 */
export function parseTemplate(bruto: string, origem: string): TemplateDePrompt {
  const casado = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(bruto);
  if (!casado) {
    throw new Error(msg().prompts.cli.frontmatterAusente(origem));
  }
  const campos: Record<string, string> = {};
  for (const linha of casado[1].split('\n')) {
    if (linha.trim() === '' || linha.trimStart().startsWith('#')) continue;
    const sep = linha.indexOf(':');
    if (sep < 0) continue;
    campos[linha.slice(0, sep).trim()] = linha
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  const versao = Number(campos.versao ?? '0');
  return {
    id: campos.id ?? '',
    versao: Number.isFinite(versao) ? versao : 0,
    descricao: campos.descricao ?? '',
    fases: parseListaInline(campos.fases ?? '') as Fase[],
    variaveis: parseListaInline(campos.variaveis ?? ''),
    corpo: casado[2].replace(/\n$/, ''),
    origem,
    bruto,
  };
}

/** Secoes que todo template de fase precisa carregar para o prompt continuar sendo um prompt. */
export const SECOES_OBRIGATORIAS: readonly string[] = [
  '## Ciclo canonico',
  '## Modo de conducao',
  '## Contexto da thread',
  '## Pedido do builder',
  '## Regras de evidencia',
];

/** A frase que nenhum template pode perder, porque ela e o contrato de todo modo. */
export const REGRA_CENTRAL = 'REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.';
export const SECOES_OBRIGATORIAS_EN: readonly string[] = PROMPTS_EN.secoesObrigatorias;
export const REGRA_CENTRAL_EN = PROMPTS_EN.regraCentral;

/**
 * O que um template precisa carregar para continuar sendo aquele tipo de template.
 *
 * O contrato e dado, o lint e codigo: e o que permite o prompt de FASE e o prompt de
 * AUDITORIA (bloco B5) passarem pelo MESMO lint sem duas implementacoes. Duas
 * implementacoes divergem, e a que divergiu foi justamente a de auditoria, que nascera sem
 * o limite de bytes e sem o aviso de idioma.
 */
export interface ContratoDeTemplate {
  /** Nome do contrato, usado na mensagem de erro do lint. */
  nome: string;
  secoes: readonly string[];
  regraCentral: string;
  /** Variavel sem a qual o template nao cumpre o seu papel (`pedido` na fase). */
  variavelObrigatoria: string | null;
  /** Se true, o campo `fases` do frontmatter e validado contra o ciclo canonico. */
  validaFases: boolean;
}

/** O contrato do prompt de fase (o do B4). */
export const CONTRATO_DE_FASE: ContratoDeTemplate = {
  nome: 'fase',
  secoes: SECOES_OBRIGATORIAS,
  regraCentral: REGRA_CENTRAL,
  variavelObrigatoria: 'pedido',
  validaFases: true,
};
export const CONTRATO_DE_FASE_EN: ContratoDeTemplate = {
  nome: 'phase', secoes: SECOES_OBRIGATORIAS_EN, regraCentral: REGRA_CENTRAL_EN,
  variavelObrigatoria: 'pedido', validaFases: true,
};

/**
 * RM-057: os jeitos de um template pedir ao dono texto livre ou texto colado. Lista fechada, como o
 * vocabulario do pulse: acrescentar um padrao e decisao de contrato, com teste. Casa sobre a linha
 * em minusculas e sem acento.
 */
export const PADROES_DE_HITL_EM_TEXTO_LIVRE: readonly { oQue: string; padrao: RegExp }[] = Object.freeze([
  { oQue: 'que o dono cole texto', padrao: /\b(cole|colar|colem)\b[^.\n]{0,60}\b(texto|aqui|mensagem|pedido|resposta|saida|conteudo)\b/ },
  { oQue: 'que o dono cole texto', padrao: /\bpaste\b/ },
  { oQue: 'confirmacao em texto livre', padrao: /\b(responda|digite|escreva|confirme|responder|digitar|escrever)\b[^.\n]{0,40}(\bconfirmo\b|texto livre|\bem texto\b)/ },
  { oQue: 'confirmacao em texto livre', padrao: /\b(peca|peco|pedir|solicite|solicitar)\b[^.\n]{0,30}\bconfirmacao\b[^.\n]{0,20}\b(por escrito|em texto|textual)\b/ },
]);

export function procurarHitlEmTextoLivre(corpo: string): { linha: number; oQue: string }[] {
  const achados: { linha: number; oQue: string }[] = [];
  corpo.split('\n').forEach((bruta, i) => {
    const linha = bruta.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const casou = PADROES_DE_HITL_EM_TEXTO_LIVRE.find(p => p.padrao.test(linha));
    if (casou) achados.push({ linha: i + 1, oQue: casou.oQue });
  });
  return achados;
}

/**
 * Lint de um template. Devolve os problemas; lista vazia quer dizer aprovado.
 *
 * O lint e o que torna "prompt versionado" diferente de "arquivo de texto solto": ele reprova
 * template que perdeu a regra dos modos, que esqueceu o pedido do builder, que declara variavel
 * que nao usa (ou usa variavel que nao declara) e que carrega credencial.
 */
export function lintTemplate(
  t: TemplateDePrompt,
  contrato?: ContratoDeTemplate
): ProblemaDeTemplate[] {
  contrato ??= t.id.endsWith('.en') ? CONTRATO_DE_FASE_EN : CONTRATO_DE_FASE;
  const mc = msg().prompts.cli;
  const problemas: ProblemaDeTemplate[] = [];
  const erro = (regra: string, detalhe: string): void => {
    problemas.push({ template: t.id || t.origem, regra, gravidade: 'erro', detalhe });
  };
  const aviso = (regra: string, detalhe: string): void => {
    problemas.push({ template: t.id || t.origem, regra, gravidade: 'aviso', detalhe });
  };

  if (!t.id) erro('id', mc.idAusente);
  if (t.origem !== 'embutido') {
    const esperado = path.basename(t.origem, '.md');
    if (t.id && t.id !== esperado) {
      erro('id', mc.idDiverge(t.id, esperado));
    }
  }
  if (!Number.isInteger(t.versao) || t.versao < 1) {
    erro('versao', mc.versaoInvalida(t.versao));
  }
  if (t.descricao.trim() === '') erro('descricao', mc.descricaoAusente);

  if (contrato.validaFases) {
    for (const fase of t.fases) {
      if (!(FASES as readonly string[]).includes(fase)) {
        erro('fases', mc.faseInvalida(fase, FASES.join(', ')));
      }
    }
  }

  const usadas = variaveisUsadas(t.corpo);
  const naoDeclaradas = usadas.filter((v) => !t.variaveis.includes(v));
  if (naoDeclaradas.length > 0) {
    erro('variaveis', mc.variaveisNaoDeclaradas(naoDeclaradas.join(', ')));
  }
  const naoUsadas = t.variaveis.filter((v) => !usadas.includes(v));
  if (naoUsadas.length > 0) {
    erro('variaveis', mc.variaveisNaoUsadas(naoUsadas.join(', ')));
  }

  for (const secao of contrato.secoes) {
    if (!t.corpo.includes(secao)) erro('secoes', mc.secaoAusente(secao));
  }
  if (!t.corpo.includes(contrato.regraCentral)) {
    erro('regra-central', mc.regraCentralAusente(contrato.regraCentral));
  }
  if (contrato.variavelObrigatoria && !usadas.includes(contrato.variavelObrigatoria)) {
    erro(
      contrato.variavelObrigatoria,
      mc.pedidoAusente(contrato.variavelObrigatoria, contrato.nome)
    );
  }

  for (const achado of procurarSegredos(t.bruto)) {
    erro(
      'segredo',
      mc.segredo(achado.nome, achado.linha)
    );
  }

  const bytes = Buffer.byteLength(t.bruto, 'utf8');
  if (bytes > LIMITE_TEMPLATE_BYTES) {
    erro('tamanho', mc.tamanho(bytes, LIMITE_TEMPLATE_BYTES));
  }

  for (const achado of procurarHitlEmTextoLivre(t.corpo)) {
    erro('hitl-texto-livre', mc.hitlTextoLivre(achado.linha, achado.oQue));
  }

  if (t.bruto.includes('—')) {
    aviso('idioma', mc.travessao);
  }

  return problemas;
}

/**
 * O template embutido da fase.
 *
 * Ele e a fonte de verdade do prompt do `ork` e a copia versionada em `prompts/fase-padrao.md`
 * precisa ser identica byte a byte (ha teste que prova isso). Renderizado, ele produz
 * o contrato distribuido a projetos sem override; mudar o texto exige sincronizar a copia.
 */
export const TEMPLATE_FASE_PADRAO = `---
id: fase-padrao
versao: 5
descricao: Prompt canonico de uma fase do ciclo GOAL..MASTER, com nomenclatura, modo de conducao, contexto da thread, memoria injetada e regras de evidencia.
fases: [GOAL, PLAN, GO, CHECK, SHIP, MASTER]
variaveis: [fase, thread, bloco, nome, ciclo_canonico, tag, blocos, pausas, linha_variante, regra_de_pausa, invariantes, slug, projeto_nome, projeto_abbrev, base_branch, base_commit, diretorio, trabalho, pedido, fecho_go, memoria_injetada, regras_de_evidencia]
---
# Orkastery, fase {{fase}} da thread {{thread}}

Voce conduz o bloco {{bloco}} da thread "{{nome}}". {{fase}} e a fase de entrada, nao uma nova orquestracao.
Execute as fases deste bloco na ordem canonica, respeitando o escopo de cada fase e os gates do nucleo; GOAL nao implementa antes de GO.
Nao abra outra thread nem redespache a si mesmo. Se houver MCP do projeto, prefira suas ferramentas para estado e operacoes suportadas.
No Claude com servidor \`orkastery\`, use nomes completos expostos: \`ToolSearch\` com \`select:mcp__orkastery__ork_thread_status,mcp__orkastery__ork_artifact_read\` descobre essas leituras; para outra ferramenta, selecione seu nome completo. Nao busque \`select:ork_thread_status\`. Outros hosts usam seu namespace descoberto.
Quando disponiveis, use ork_artifact_read/write para objetivo, plano e parecer, e ork_claims_list/ork_claim_add para claims; nao escreva ledger nem estado canonico diretamente.
Decisao que voce tomar sem perguntar ao dono vai ao ledger por \`ork decisao registrar <thread>\` (no MCP, \`ork_decision_record\`, pois o sandbox do codex nao grava o ledger), com o que foi decidido, o porque, como mudar, o custo de reverter agora e depois, o criterio escrito, quem decidiu e a evidencia; e assim que ela chega ao dono no resumo, em vez de sumir na conversa.
Artefato de autoria do agente nao e recibo oficial; cadastrar claim nao significa verifica-la.
Para registrar produto, prefira ork_git_commit com HEAD atual e paths com claims; use ork_verify para verificacao real e ork_ship com HEADs fonte/destino conferidos para entrega. Commit local nao e SHIP; retorno incomplete exige reconciliar estado e remoto antes de repetir. Permissao para consultar nao concede essas operacoes: respeite a autorizacao nativa e os gates.
Quando o MCP expuser \`ork_verify_status\`, chame \`ork_verify\` uma vez, guarde o \`rodadaId\` e consulte a mesma rodada a cada 30–60 s. Enquanto ela estiver na fila ou rodando, retenha apenas estado e lane atuais no contexto; nao repita o pedido nem copie payloads intermediarios. So avance com o veredito terminal verde; falha tipada ou veredito vermelho bloqueia o ciclo.
Decisao do dono deve ser apresentada pela sessao condutora ao host; a sessao filha nao responde nem assume a identidade do dono.
Preserve o perfil filho configurado: \`interactive\` concede consultas; \`worktree\` exige opt-in da instalacao e autoriza ferramentas exatas na WT validada, sem aprovar gates ou assumir o dono. Nao mude configuracao para contornar bloqueio.
Consulte \`ork_git_status\` para HEADs reais e estado Git; use \`ork_git_commit\`, \`ork_verify\` e \`ork_ship\` pelos contratos do nucleo, sem Bash Git nem inventar SHAs. Use \`source.head\` como \`expectedHead\` do commit; consulte novamente apos commit e use \`source.head\`/\`destination.head\` como \`expectedSource\`/\`expectedDestination\` do SHIP. Base historica nao substitui a consulta atual. As regras Edit/deny sao permissoes nativas de ferramentas, nao sandbox de processos.
Permissao nativa ou operacao sem transporte suportado continua um impedimento real, nunca motivo para alterar o sandbox.

## Ciclo canonico
{{ciclo_canonico}}

## Modo de conducao: {{tag}}
Blocos desta thread: {{blocos}}
Pausas humanas desta thread: {{pausas}}
{{linha_variante}}
{{regra_de_pausa}}

REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.
{{invariantes}}

## Contexto da thread
- thread: {{thread}} (slug {{slug}})
- projeto: {{projeto_nome}} (abbrev {{projeto_abbrev}})
- base carimbada: {{base_branch}} @ {{base_commit}}
- diretorio de trabalho: {{diretorio}}
- trabalho retomavel: {{trabalho}} (rascunhos de check e PR, pareceres e listas de prova)
- estado da thread: .orkastery/threads/{{thread}}/thread.json
- ledger: .orkastery/threads/{{thread}}/ledger.jsonl

## Pedido do builder
{{pedido}}
{{memoria_injetada}}
{{fecho_go}}

## Isolamento por sessão

O runtime pode ser o mesmo da condutora e do revisor. A independência exige IDs nativos
distintos e vínculos comprovados pelo núcleo; nome de papel no prompt não é autoridade.
Esta sessão executa o bloco recebido, sem abrir recursão, aprovar gate ou validar o próprio
trabalho. Preserve runtime/modelo/esforço e perfil \`interactive\`/\`worktree\` já configurados.
Falha de autenticação permanece impedimento; não troque provider, sandbox ou identidade.

## Regras de evidencia
{{regras_de_evidencia}}`;

/** English counterpart of the canonical phase prompt. The pt-BR template above remains the source contract. */
export const TEMPLATE_FASE_PADRAO_EN = `---
id: fase-padrao.en
versao: 5
descricao: Canonical prompt for a GOAL..MASTER cycle phase, with naming, conduction mode, thread context, injected memory, and evidence rules.
fases: [GOAL, PLAN, GO, CHECK, SHIP, MASTER]
variaveis: [fase, thread, bloco, nome, ciclo_canonico, tag, blocos, pausas, linha_variante, regra_de_pausa, invariantes, slug, projeto_nome, projeto_abbrev, base_branch, base_commit, diretorio, trabalho, pedido, fecho_go, memoria_injetada, regras_de_evidencia]
---
# Orkastery, {{fase}} phase of thread {{thread}}

You conduct block {{bloco}} of thread "{{nome}}". {{fase}} is the entry phase, not a new orchestration.
Run the phases in this block in canonical order, respecting each phase scope and the core gates; GOAL does not implement before GO.
Do not open another thread or redispatch yourself. If the project has an MCP server, prefer its tools for supported state and operations.
In Claude with the \`orkastery\` server, use the exposed full names: \`ToolSearch\` with \`select:mcp__orkastery__ork_thread_status,mcp__orkastery__ork_artifact_read\` discovers those reads; select the full name for any other tool. Do not search for \`select:ork_thread_status\`. Other hosts use their discovered namespace.
When available, use ork_artifact_read/write for the goal, plan, and review, and ork_claims_list/ork_claim_add for claims; do not write the ledger or canonical state directly.
Record every decision you make without asking the owner in the ledger with \`ork decisao registrar <thread>\` (or \`ork_decision_record\` in MCP because the Codex sandbox cannot write the ledger), including what was decided, why, how to change it, reversal cost now and later, the written criterion, who decided, and the evidence. This is how it reaches the owner in the summary instead of disappearing in the conversation.
An agent-authored artifact is not an official receipt; registering a claim does not verify it.
To record product changes, prefer ork_git_commit with the current HEAD and paths with claims; use ork_verify for real verification and ork_ship with checked source/destination HEADs for delivery. A local commit is not SHIP; an incomplete result requires reconciling state and remote before retrying. Permission to query does not grant those operations: respect native authorization and gates.
When MCP exposes \`ork_verify_status\`, call \`ork_verify\` once, keep its \`rodadaId\`, and query that same round every 30–60 seconds. While queued or running, retain only the current state and lane in context; do not repeat the request or copy intermediate payloads. Continue only after a terminal green verdict; a typed failure or red verdict blocks the cycle.
The conducting session presents an owner decision to the host; a child session neither answers nor assumes the owner's identity.
Preserve the configured child profile: \`interactive\` grants queries; \`worktree\` requires installation opt-in and authorizes exact tools in the validated worktree, without approving gates or assuming the owner. Do not change configuration to bypass a block.
Query \`ork_git_status\` for real HEADs and Git state; use \`ork_git_commit\`, \`ork_verify\`, and \`ork_ship\` through the core contracts, without Bash Git or invented SHAs. Use \`source.head\` as the commit \`expectedHead\`; query again after the commit and use \`source.head\`/\`destination.head\` as SHIP \`expectedSource\`/\`expectedDestination\`. A historical base does not replace the current query. Edit/deny rules are native tool permissions, not process sandbox rules.
A native permission failure or an operation without supported transport remains a real blocker, never a reason to alter the sandbox.

## Canonical cycle
{{ciclo_canonico}}

## Conduction mode: {{tag}}
Blocks in this thread: {{blocos}}
Human pauses in this thread: {{pausas}}
{{linha_variante}}
{{regra_de_pausa}}

CENTRAL RULE: the mode relaxes the pause, NEVER verification.
{{invariantes}}

## Thread context
- thread: {{thread}} (slug {{slug}})
- project: {{projeto_nome}} (abbrev {{projeto_abbrev}})
- stamped base: {{base_branch}} @ {{base_commit}}
- working directory: {{diretorio}}
- resumable work: {{trabalho}} (check and PR drafts, reviews and proof lists)
- thread state: .orkastery/threads/{{thread}}/thread.json
- ledger: .orkastery/threads/{{thread}}/ledger.jsonl

## Builder request
{{pedido}}
{{memoria_injetada}}
{{fecho_go}}

## Session isolation

The runtime may be the same for the conductor and reviewer. Independence requires distinct native IDs
and links proven by the core; a role name in the prompt is not authority. This session executes the
received block without opening recursion, approving a gate, or validating its own work. Preserve the
configured runtime/model/effort and \`interactive\`/\`worktree\` profile. Authentication failure remains
a blocker; do not change provider, sandbox, or identity.

## Evidence rules
{{regras_de_evidencia}}`;

/** Os templates que vem dentro do `ork`, por id. */
export const TEMPLATES_EMBUTIDOS: Readonly<Record<string, string>> = {
  'fase-padrao': TEMPLATE_FASE_PADRAO,
  'fase-padrao.en': TEMPLATE_FASE_PADRAO_EN,
};

/**
 * Carrega templates de um conjunto de embutidos, sobrescritos pelos `.md` de um diretorio.
 *
 * Parametrizada por diretorio para que os prompts de FASE (`prompts/`) e os prompts de
 * AUDITORIA (`auditors/`, bloco B5) usem a mesma carga, com a mesma precedencia e a mesma
 * regra de README, em vez de duas implementacoes que divergem com o tempo.
 */
export function carregarTemplatesDe(
  embutidos: Readonly<Record<string, string>>,
  dir?: string
): TemplateDePrompt[] {
  const porId = new Map<string, TemplateDePrompt>();
  for (const [id, bruto] of Object.entries(embutidos)) {
    porId.set(id, parseTemplate(bruto, 'embutido'));
  }
  if (dir && fs.existsSync(dir)) {
    for (const arquivo of fs.readdirSync(dir).sort()) {
      if (!arquivo.endsWith('.md')) continue;
      // O README do diretorio documenta os templates; ele nao e um deles. Qualquer OUTRO
      // `.md` sem frontmatter continua sendo erro, para template quebrado nao virar arquivo
      // silenciosamente ignorado.
      if (arquivo === 'README.md') continue;
      const caminho = path.join(dir, arquivo);
      const t = parseTemplate(fs.readFileSync(caminho, 'utf8'), caminho);
      porId.set(t.id || path.basename(arquivo, '.md'), t);
    }
  }
  return [...porId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Todos os templates que valem para este projeto: os embutidos, sobrescritos por
 * `<raiz>/prompts/<id>.md` quando o projeto versiona o seu proprio.
 */
export function carregarTemplates(raiz?: string): TemplateDePrompt[] {
  return carregarTemplatesDe(TEMPLATES_EMBUTIDOS, raiz ? dirDeTemplates(raiz) : undefined);
}

/** Um template por id, com erro tipado quando ele nao existe. */
export function exigirTemplate(id: string, raiz?: string): TemplateDePrompt {
  const achado = carregarTemplates(raiz).find((t) => t.id === id);
  if (!achado) {
    const ids = carregarTemplates(raiz).map((t) => t.id).join(', ');
    throw new Error(msg().prompts.cli.templateNaoExiste(id, ids));
  }
  return achado;
}

/**
 * O template que conduz a fase: `fase-<minuscula>` quando o projeto versionou um so para ela,
 * senao o `fase-padrao`. E o unico ponto de resolucao, para nao haver duas regras de escolha.
 *
 * RM-061 F3c: com o dono em ingles, o template do projeto vence o embutido e o da fase vence o padrao; no mesmo
 * nivel, o `.en` vem antes. O projeto que versionou o proprio prompt nunca o perde porque o dono fala ingles: sem o
 * par `.en`, a fase sai em pt-BR, e o `ork prompt lint` avisa (`avisosDeLingua`).
 */
export function templateDaFase(fase: Fase, raiz?: string, locale: Locale = localeAtivo()): TemplateDePrompt {
  const templates = carregarTemplates(raiz);
  const achar = (id: string, soDoProjeto = false) => templates.find((t) => t.id === id && (!soDoProjeto || t.origem !== 'embutido'));
  const especifico = `fase-${fase.toLowerCase()}`;
  const candidatos = locale === 'en'
    ? [achar(`${especifico}.en`), achar(especifico), achar('fase-padrao.en', true), achar('fase-padrao', true), achar('fase-padrao.en')]
    : [achar(especifico), achar('fase-padrao')];
  const escolhido = candidatos.find((t): t is TemplateDePrompt => t !== undefined);
  if (!escolhido) throw new Error(msg().prompts.cli.templatePadraoAusente);
  return escolhido;
}

/** RM-061 F3c: a lingua de um template de fase, pelo sufixo do id; os valores do prompt falam a mesma. */
export function idiomaDoTemplate(t: Pick<TemplateDePrompt, 'id'>): Locale {
  return t.id.endsWith('.en') ? 'en' : 'pt-BR';
}

/**
 * RM-061 F3c: com o dono em ingles, o template de fase do projeto sem o par `.en` do projeto vale como esta, em
 * pt-BR. O lint avisa, para a troca de lingua nunca ser silenciosa; em pt-BR nao ha o que avisar.
 */
export function avisosDeLingua(templates: readonly TemplateDePrompt[], lingua: Locale): ProblemaDeTemplate[] {
  if (lingua !== 'en') return [];
  const doProjeto = new Set(templates.filter((t) => t.origem !== 'embutido').map((t) => t.id));
  return templates
    .filter((t) => t.origem !== 'embutido' && t.id.startsWith('fase-') && !t.id.endsWith('.en') && !doProjeto.has(`${t.id}.en`))
    .map((t) => ({ template: t.id, regra: 'idioma', gravidade: 'aviso' as const, detalhe: msg().prompts.cli.semParIngles(t.id) }));
}

/** Texto de `ork prompt lint` para a saida do CLI. */
export function textoDoLint(problemas: ProblemaDeTemplate[], quantos: number): string {
  const m = msg().prompts.cli;
  const linhas: string[] = [];
  const erros = problemas.filter((p) => p.gravidade === 'erro');
  const avisos = problemas.filter((p) => p.gravidade === 'aviso');
  for (const p of problemas) {
    linhas.push(`  [${m.gravidades[p.gravidade]}] ${p.template} :: ${p.regra}`);
    linhas.push(`           ${p.detalhe}`);
  }
  if (problemas.length === 0) {
    linhas.push(m.semProblema(quantos));
  }
  linhas.push('');
  linhas.push(m.resumoLint(quantos, erros.length, avisos.length));
  return linhas.join('\n');
}

/** Texto de `ork prompt list`. */
export function tabelaDeTemplates(templates: TemplateDePrompt[]): string {
  const m = msg().prompts.cli;
  const linhas: string[] = [m.tituloLista, ''];
  for (const t of templates) {
    linhas.push(`  ${t.id.padEnd(16)} v${t.versao}  ${m.origem(t.origem)}`);
    linhas.push(`  ${' '.repeat(16)}   ${m.fases(t.fases.length > 0 ? t.fases.join(' ') : m.todas)}`);
    linhas.push(`  ${' '.repeat(16)}   ${t.descricao}`);
  }
  linhas.push('');
  linhas.push(m.comoVersionar);
  return linhas.join('\n');
}

/**
 * Uma thread de exemplo, em memoria, para `ork prompt render --exemplo`.
 *
 * Ela existe para que o builder possa ver o prompt exato de um modo ANTES de criar thread
 * nenhuma, e para que o lint tenha um alvo de renderizacao sem depender de estado em disco.
 * Nada aqui e gravado: o exemplo nunca vira thread.
 */
export function threadDeExemplo(modo: Modo, fase: Fase, projeto?: { name: string; abbrev: string }): Thread {
  const def = definicaoDoModo(modo);
  const p = projeto ?? { name: 'exemplo', abbrev: 'exe' };
  const agora = '1970-01-01T00:00:00.000Z';
  return {
    id: `${p.abbrev}-exemplo`,
    slug: `${p.abbrev}-exemplo-${def.blocos[0].slugFases}`,
    nome: 'exemplo de prompt',
    assunto: 'exemplo',
    modo,
    // I-42: as fases saem dos blocos do modo; no `#Fast` e so a GO.
    fases: def.blocos.flatMap((b) => b.fases),
    blocos: def.blocos,
    faseAtual: fase,
    status: 'aberta',
    criadaEm: agora,
    atualizadaEm: agora,
    projeto: p,
    base: { branch: 'main', commit: '0'.repeat(40) },
    worktree: null,
    sessoes: [],
    decisoes: [],
    claims: [],
    leases: [],
    baseline: null,
    variante: null,
  };
}
