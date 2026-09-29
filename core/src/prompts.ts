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

/** Limite duro de um template, o mesmo do manifesto: prosa longa nao vira prompt. */
export const LIMITE_TEMPLATE_BYTES = 16384;

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
    throw new Error(
      `template ${template.id}: variavel sem valor na renderizacao: ${faltando.join(', ')}`
    );
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
    throw new Error(`template em ${origem}: frontmatter ausente (esperado bloco --- ... ---)`);
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

/**
 * Lint de um template. Devolve os problemas; lista vazia quer dizer aprovado.
 *
 * O lint e o que torna "prompt versionado" diferente de "arquivo de texto solto": ele reprova
 * template que perdeu a regra dos modos, que esqueceu o pedido do builder, que declara variavel
 * que nao usa (ou usa variavel que nao declara) e que carrega credencial.
 */
export function lintTemplate(
  t: TemplateDePrompt,
  contrato: ContratoDeTemplate = CONTRATO_DE_FASE
): ProblemaDeTemplate[] {
  const problemas: ProblemaDeTemplate[] = [];
  const erro = (regra: string, detalhe: string): void => {
    problemas.push({ template: t.id || t.origem, regra, gravidade: 'erro', detalhe });
  };
  const aviso = (regra: string, detalhe: string): void => {
    problemas.push({ template: t.id || t.origem, regra, gravidade: 'aviso', detalhe });
  };

  if (!t.id) erro('id', 'frontmatter sem `id`');
  if (t.origem !== 'embutido') {
    const esperado = path.basename(t.origem, '.md');
    if (t.id && t.id !== esperado) {
      erro('id', `o id "${t.id}" nao bate com o nome do arquivo "${esperado}.md"`);
    }
  }
  if (!Number.isInteger(t.versao) || t.versao < 1) {
    erro('versao', `versao "${t.versao}" invalida: esperado inteiro a partir de 1`);
  }
  if (t.descricao.trim() === '') erro('descricao', 'frontmatter sem `descricao`');

  if (contrato.validaFases) {
    for (const fase of t.fases) {
      if (!(FASES as readonly string[]).includes(fase)) {
        erro('fases', `"${fase}" nao e fase do ciclo canonico (${FASES.join(', ')})`);
      }
    }
  }

  const usadas = variaveisUsadas(t.corpo);
  const naoDeclaradas = usadas.filter((v) => !t.variaveis.includes(v));
  if (naoDeclaradas.length > 0) {
    erro('variaveis', `usadas no corpo e nao declaradas: ${naoDeclaradas.join(', ')}`);
  }
  const naoUsadas = t.variaveis.filter((v) => !usadas.includes(v));
  if (naoUsadas.length > 0) {
    erro('variaveis', `declaradas e nao usadas: ${naoUsadas.join(', ')}`);
  }

  for (const secao of contrato.secoes) {
    if (!t.corpo.includes(secao)) erro('secoes', `secao obrigatoria ausente: ${secao}`);
  }
  if (!t.corpo.includes(contrato.regraCentral)) {
    erro('regra-central', `o template perdeu a linha: ${contrato.regraCentral}`);
  }
  if (contrato.variavelObrigatoria && !usadas.includes(contrato.variavelObrigatoria)) {
    erro(
      contrato.variavelObrigatoria,
      `o template nao usa {{${contrato.variavelObrigatoria}}}: despacharia uma ${contrato.nome} sem a demanda do builder`
    );
  }

  for (const achado of procurarSegredos(t.bruto)) {
    erro(
      'segredo',
      `padrao "${achado.nome}" casou na linha ${achado.linha} do template (trecho omitido de proposito)`
    );
  }

  const bytes = Buffer.byteLength(t.bruto, 'utf8');
  if (bytes > LIMITE_TEMPLATE_BYTES) {
    erro('tamanho', `${bytes} bytes acima do limite de ${LIMITE_TEMPLATE_BYTES}`);
  }

  if (t.bruto.includes('—')) {
    aviso('idioma', 'o template usa travessao longo (U+2014); o padrao do projeto e hifen ou virgula');
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
versao: 3
descricao: Prompt canonico de uma fase do ciclo GOAL..MASTER, com nomenclatura, modo de conducao, contexto da thread, memoria injetada e regras de evidencia.
fases: [GOAL, PLAN, GO, CHECK, SHIP, MASTER]
variaveis: [fase, thread, bloco, nome, ciclo_canonico, tag, blocos, pausas, linha_variante, regra_de_pausa, invariantes, slug, projeto_nome, projeto_abbrev, base_branch, base_commit, diretorio, pedido, memoria_injetada, regras_de_evidencia]
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
- estado da thread: .orkastery/threads/{{thread}}/thread.json
- ledger: .orkastery/threads/{{thread}}/ledger.jsonl

## Pedido do builder
{{pedido}}
{{memoria_injetada}}

## Isolamento por sessão

O runtime pode ser o mesmo da condutora e do revisor. A independência exige IDs nativos
distintos e vínculos comprovados pelo núcleo; nome de papel no prompt não é autoridade.
Esta sessão executa o bloco recebido, sem abrir recursão, aprovar gate ou validar o próprio
trabalho. Preserve runtime/modelo/esforço e perfil \`interactive\`/\`worktree\` já configurados.
Falha de autenticação permanece impedimento; não troque provider, sandbox ou identidade.

## Regras de evidencia
{{regras_de_evidencia}}`;

/** Os templates que vem dentro do `ork`, por id. */
export const TEMPLATES_EMBUTIDOS: Readonly<Record<string, string>> = {
  'fase-padrao': TEMPLATE_FASE_PADRAO,
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
    throw new Error(`template "${id}" nao existe (conhecidos: ${ids})`);
  }
  return achado;
}

/**
 * O template que conduz a fase: `fase-<minuscula>` quando o projeto versionou um so para ela,
 * senao o `fase-padrao`. E o unico ponto de resolucao, para nao haver duas regras de escolha.
 */
export function templateDaFase(fase: Fase, raiz?: string): TemplateDePrompt {
  const templates = carregarTemplates(raiz);
  const especifico = templates.find((t) => t.id === `fase-${fase.toLowerCase()}`);
  if (especifico) return especifico;
  const padrao = templates.find((t) => t.id === 'fase-padrao');
  if (!padrao) throw new Error('template `fase-padrao` ausente: o `ork` nao tem prompt de fase');
  return padrao;
}

/** Texto de `ork prompt lint` para a saida do CLI. */
export function textoDoLint(problemas: ProblemaDeTemplate[], quantos: number): string {
  const linhas: string[] = [];
  const erros = problemas.filter((p) => p.gravidade === 'erro');
  const avisos = problemas.filter((p) => p.gravidade === 'aviso');
  for (const p of problemas) {
    linhas.push(`  [${p.gravidade}] ${p.template} :: ${p.regra}`);
    linhas.push(`           ${p.detalhe}`);
  }
  if (problemas.length === 0) {
    linhas.push(`  nenhum problema em ${quantos} template(s)`);
  }
  linhas.push('');
  linhas.push(`templates: ${quantos} | erros: ${erros.length} | avisos: ${avisos.length}`);
  return linhas.join('\n');
}

/** Texto de `ork prompt list`. */
export function tabelaDeTemplates(templates: TemplateDePrompt[]): string {
  const linhas: string[] = ['Templates de prompt (o do projeto sobrescreve o embutido de mesmo id)', ''];
  for (const t of templates) {
    linhas.push(`  ${t.id.padEnd(16)} v${t.versao}  origem: ${t.origem}`);
    linhas.push(`  ${' '.repeat(16)}   fases: ${t.fases.length > 0 ? t.fases.join(' ') : 'todas'}`);
    linhas.push(`  ${' '.repeat(16)}   ${t.descricao}`);
  }
  linhas.push('');
  linhas.push('Para versionar o seu: grave em prompts/<id>.md e rode `ork prompt lint`.');
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
