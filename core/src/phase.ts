import { comLockHitl } from './hitl-gates';
import { ContextoRuntime, contextoDoProjeto, IdentidadeDeDespacho, novaIdentidadeDeDespacho } from './runtime-context';
/**
 * `ork phase run|list`: despacho de fase pelo runtime adapter e leitura do ledger.
 *
 * O prompt e montado pelo `ork` (nomenclatura das fases + modo de conducao + contexto da
 * thread + pedido do builder), gravado com hash sha256 no diretorio da thread e so entao
 * despachado. Depois do despacho o `ork` RE-VERIFICA no runtime que a sessao existe:
 * self-report de despacho nao vale como evidencia.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { iniciarWatcher, validarFonteWatcher } from './session-watcher';
import { fonteClaudeDoDespacho, headDaWorktree } from './session-watcher-claude';
import { ManifestoCarregado } from './manifest';
import { resolverRuntime, runtimeConhecido } from './runtimes';
import { configDoBloco, lerSetup, limitesDoBloco } from './setup';
import { definicaoDoModo, INVARIANTES } from './modos';
import { registrarGateBloqueado } from './gates';
import { avaliarPolicies, bloqueantes, motivoDominante, ViolacaoDePolicy } from './policies';
import { enfileirar, marcarContaDaFalha } from './ratelimit';
import { conferirAuth as authClaude } from './adapters/claude-bg';
import { conferirAuth as authCodex } from './adapters/codex';
import { abrirMemoria, injecaoDaFase, Memoria } from './memoria';
import { renderizar, templateDaFase } from './prompts';
import { montarSlug, parseSlug, proximaRotacao } from './slug';
import { blocoDaThread, dirThread, gravarThread, lerThread, pausaNaThread } from './thread';
import {
  CanalDeConducao,
  ConducaoAtual,
  ConfigDeBloco,
  Fase,
  FASES,
  InjecaoDeMemoria,
  MotivoGate,
  PedidoDeRetomada,
  SessaoDaThread,
  SinalDeFalhaDeConta,
  Thread,
} from './types';
import { agora, gravar, tabela } from './util';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { vincularEstado } from './estado-thread';
import { formatarDataHora, legendaDoFuso, localizarTexto } from './horario';
import {
  lerPerfisComContas, marcarFalhaDePerfil, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, perfisDoRuntime, POLITICA_PADRAO,
  PoliticaDeRotacao, politicaDeRotacao, proximoPerfilDisponivel, registrarConferenciaInconclusiva, registrarUsoDePerfil,
} from './runtime-profiles';
import { nomeDaMaquina } from './maquina';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import {
  ambienteDaConducao, canalDoProcesso, ConducaoOcupada, ConducaoTomada, conducaoDaThread, esperarConducaoLivre,
  MARGEM_DO_PRAZO_MS, PedidoDeConducao, PRAZO_DE_SESSAO_PADRAO_MS, recusaDeConducao, RecusaDeConducao, registrarConducaoDaSessao,
  registrarRecusa, tomarConducao,
} from './conducao';

/** I-33 (D4): a sessao da thread guarda o perfil que despachou; ausente, o ambiente do processo. */
export type SessaoComPerfil = SessaoDaThread & { perfil?: PerfilDeDespacho };

export interface EscolhaDePerfil {
  perfil: PerfilDeDespacho | null;
  /** Quantos perfis do runtime existem no store (0: despacho pelo ambiente do processo, P8). */
  configurados: number;
  /** Perfis existem, mas nenhum pode receber este despacho agora. */
  erro?: string;
  /** Motivo tipado do `erro`: cota esgotada, auth ausente ou indisponivel. */
  motivo?: MotivoGate;
}

/**
 * I-33 (D2, D4, D14): o perfil do despacho. Sem perfis do runtime no store, nenhum (P8). Com
 * perfis, o pedido explicito ou o perfil da vez na ordem do store pela politica de rotacao do
 * manifesto (sem ela, a padrao da D16); perfil esgotado, sem auth, pago ou desativado nunca
 * recebe despacho.
 */
export function escolherPerfil(raiz: string, runtime: string,
  opcoes: { perfil?: string; excluir?: readonly string[]; agoraMs?: number; politica?: PoliticaDeRotacao } = {}): EscolhaDePerfil {
  // I-49: o despacho enxerga o estado que as outras fabricas viram na mesma conta.
  const store = lerPerfisComContas(raiz, opcoes.agoraMs);
  const doRuntime = perfisDoRuntime(store, runtime);
  if (opcoes.perfil !== undefined) {
    const pedido = doRuntime.find(p => p.id === opcoes.perfil);
    if (!pedido) return { perfil: null, configurados: doRuntime.length, erro: `perfil "${opcoes.perfil}" nao existe para o runtime ${runtime}` };
    if (!perfilDisponivel(pedido, opcoes.agoraMs)) return { perfil: null, configurados: doRuntime.length,
      erro: `perfil "${pedido.id}" esta ${pedido.estado}${pedido.esgotadoAte ? ` ate ${pedido.esgotadoAte}` : ''}` };
    return { perfil: perfilDeDespacho(pedido), configurados: doRuntime.length };
  }
  if (doRuntime.length === 0) return { perfil: null, configurados: 0 };
  const proximo = proximoPerfilDisponivel(store, runtime, opcoes.politica ?? POLITICA_PADRAO, opcoes);
  if (proximo) return { perfil: perfilDeDespacho(proximo), configurados: doRuntime.length };
  const agoraMs = opcoes.agoraMs ?? Date.now();
  // Motivo do bloqueio pelo estado dos perfis: com algum esgotado ha prazo (fila); so sem-auth, login;
  // so provider pago (D13), custo: `cost.violation` nunca recebe retry automatico.
  const motivo: MotivoGate = doRuntime.some(p => p.estado === 'esgotado' && p.esgotadoAte !== null && Date.parse(p.esgotadoAte) > agoraMs)
    ? 'runtime.quota-exhausted' : doRuntime.some(p => p.estado === 'sem-auth') ? 'runtime.auth-missing'
    : doRuntime.some(p => p.estado === 'provider-pago') ? 'cost.violation' : 'runtime.unavailable';
  return { perfil: null, configurados: doRuntime.length, motivo,
    erro: `nenhum perfil disponivel do runtime ${runtime} (${doRuntime.map(p => `${p.id}: ${p.estado}`).join(', ')})` };
}

/**
 * I-33 (D7, D13): preflight de auth antes do despacho. O perfil escolhido tem o login conferido
 * pelo proprio CLI com o env dele; reprovado, vira `sem-auth` no store (ou `provider-pago`, quando
 * o login e por API key, helper, Console ou nuvem), a troca vai ao ledger (`runtime_profile_rotated`)
 * e o proximo perfil do mesmo runtime e conferido. Perfil sem login de assinatura nunca recebe
 * despacho. Sem perfil (ambiente do processo) ou em ensaio, nada e conferido.
 */
export function perfilParaDespacho(carregado: ManifestoCarregado, thread: Thread, fase: Fase, runtime: string,
  opcoes: { perfil?: string; excluir?: readonly string[]; dryRun?: boolean; origem: string }): EscolhaDePerfil {
  const { raiz } = carregado;
  const excluir = [...(opcoes.excluir ?? [])];
  const politica = politicaDeRotacao(carregado.manifesto);
  for (;;) {
    const escolha = escolherPerfil(raiz, runtime, { perfil: opcoes.perfil, excluir, politica });
    if (escolha.erro || !escolha.perfil || opcoes.dryRun) return escolha;
    const auth = runtime === 'claude-bg' ? authClaude(escolha.perfil) : runtime === 'codex' ? authCodex(escolha.perfil)
      : { ok: false, detalhe: `runtime ${runtime} sem conferencia de login` };
    if (auth.ok) return escolha;
    let motivo: MotivoGate, razao: string;
    if (auth.transitorio) {
      // A14: conferencia inconclusiva nao marca sem-auth: o perfil fica fora so deste despacho.
      registrarConferenciaInconclusiva(raiz, escolha.perfil.id, auth.detalhe);
      motivo = 'runtime.unavailable';
      razao = 'a conferencia de login nao concluiu (A14): o perfil fica fora so deste despacho e e conferido de novo no proximo';
    } else if (auth.pago) {
      // D13: login valido, mas cobrado por token. O perfil sai do rodizio com estado proprio e nunca despacha.
      marcarFalhaDePerfil(raiz, escolha.perfil.id, { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: auth.detalhe });
      motivo = 'cost.violation';
      razao = 'o preflight achou login por provider pago (D13): perfil de API key, helper, Console ou nuvem nunca recebe despacho';
    } else {
      const falha: SinalDeFalhaDeConta = { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: auth.detalhe };
      marcarContaDaFalha(carregado, escolha.perfil, falha);
      motivo = falha.motivo;
      razao = 'o preflight de auth reprovou o perfil antes do despacho (D7): perfil sem login nunca recebe despacho';
    }
    excluir.push(escolha.perfil.id);
    const proximo = opcoes.perfil === undefined ? escolherPerfil(raiz, runtime, { excluir, politica }).perfil : null;
    registrar(dirThread(raiz, thread.id), thread.id, TIPOS_DE_EVENTO.perfilRotacionado, {
      fase, motivo, origem: `${opcoes.origem}.preflight`,
      de: { runtime, perfil: escolha.perfil.id }, para: proximo ? { runtime, perfil: proximo.id } : null,
      evidencia: auth.detalhe, razao,
      autorizadoPor: 'politica de rotacao da I-33 (D5, D7, D13), igual em todos os modos',
    });
    if (opcoes.perfil !== undefined) return { perfil: null, configurados: escolha.configurados, motivo,
      erro: `perfil "${opcoes.perfil}" ${auth.transitorio ? 'com conferencia de login inconclusiva' : auth.pago ? 'autenticado por provider pago' : 'sem login conferido'}: ${auth.detalhe}` };
  }
}

/**
 * O CHECK desta thread pode rodar neste runtime? (I-43, D4, viga a)
 *
 * A regra: quem VALIDA nao pode ser quem EXECUTOU. Ela vinha do Objective Envelope,
 * onde valia so na criacao e para tres threads que nunca rodaram nada; aqui ela passa
 * a valer no despacho de qualquer thread que a exija.
 *
 * Compara o runtime do CHECK com os runtimes das sessoes de GO JA REGISTRADAS em
 * `thread.sessoes`, que ja carregam `runtime` e ja aparecem em `ork thread status`.
 * Nenhum dado novo precisa ser coletado: o que faltava era a regra, nao o dado.
 *
 * Sem sessao de GO registrada nao ha o que cruzar, e o despacho passa: inventar
 * impedimento sobre um GO que nao aconteceu seria barrar por suposicao.
 */
export function runtimeCruzadoParaDespacho(
  thread: Thread,
  fase: Fase,
  runtime: string
): string | null {
  if (thread.exigeRuntimeDiferente !== true || fase !== 'CHECK') return null;
  const doGo = [...new Set(thread.sessoes.filter((s) => s.fase === 'GO').map((s) => s.runtime))];
  if (doGo.length === 0) return null;
  if (!doGo.includes(runtime)) return null;
  return `runtime.autoconferencia: o CHECK precisa de runtime diferente do GO, e "${runtime}" `
    + `foi o runtime do GO desta thread (${doGo.join(', ')}). `
    + `Despache o CHECK em outro runtime, ou tire a exigencia da thread.`;
}

/**
 * I-43 (T11): o ramo do Objective Envelope saiu daqui.
 *
 * Ele era a UNICA consulta do produto ao envelope, e dependia de `thread.creationOrigin`.
 * A medida: das 137 threads do projeto, ZERO tinham `creationOrigin`. O ramo nunca
 * disparou para thread nenhuma, e a "unica pausa planejada do #Maestro" nao bloqueava
 * o despacho nem das tres threads que o proprio envelope criou.
 *
 * O que ele PRETENDIA garantir (que ninguem despacha sem validacao combinada) continua
 * garantido, e agora de verdade, por `runtimeCruzadoParaDespacho` logo acima e pelos
 * criterios de pronto executaveis que `ork verify` cobra.
 */
export function estadoParaDespacho(raiz: string, thread: Thread, dryRun = false): string | null {
  if (!thread.worktree) return null;
  try {
    vincularEstado(raiz, thread.id, thread.worktree, dryRun);
    return null;
  } catch(e) { return (e as Error).message; }
}

/** O que cada fase canonica entrega. Vai no cabecalho do prompt de toda sessao. */
export const CONTRATO_DAS_FASES: Readonly<Record<Fase, string>> = {
  GOAL:
    'GOAL (F1): objetivo verificavel, impact map, criterios de sucesso e claims com comando de verificacao. Nao implementa.',
  PLAN:
    'PLAN (F2): plano com tarefas, touch_paths, decisoes D1..Dn com domicilio unico e verify executavel por tarefa. Nao implementa.',
  GO:
    'GO (F3): implementacao slice por slice, um commit atomico por tarefa, dentro da worktree da thread.',
  CHECK:
    'CHECK (F4): verificacao contra a baseline (regressao versus divida pre-existente), review de codigo, testes, seguranca e performance.',
  SHIP:
    'SHIP (F5): merge serializado, push provado por comando, roadmap atualizado e plano de rollback.',
  MASTER:
    'MASTER (F6): MASTER log com postmortem tipado, licoes e o score humano de 0 a 5. Uma entrega sem MASTER log nao aconteceu.',
};

/** As regras de evidencia que valem em toda fase, em todo modo. */
export const REGRAS_DE_EVIDENCIA: readonly string[] = [
  'Nada de self-report: toda alegacao vem com o comando que a comprova e a saida real.',
  'Trabalhe apenas no diretorio de trabalho indicado acima.',
  'Passos irreversiveis (push, merge, delecao) so acontecem quando o modo autoriza.',
];

/**
 * I-42 (D11): as fases que o cabecalho do prompt descreve.
 *
 * Regra por desenho de bloco, nunca por nome de modo: quando o ciclo e um bloco so e esse bloco
 * nao percorre as seis fases, o prompt descreve so as fases dele. As outras cinco linhas seriam
 * cerimonia de um ciclo que a sessao nao vai percorrer. Bloco unico com as seis fases e ciclo de
 * varios blocos continuam com as seis linhas, byte a byte.
 */
export function fasesDoCicloNoPrompt(thread: Pick<Thread, 'blocos'>): readonly Fase[] {
  const [unico, ...resto] = thread.blocos;
  if (unico && resto.length === 0 && unico.fases.length < FASES.length) {
    return FASES.filter((f) => unico.fases.includes(f));
  }
  return FASES;
}

/**
 * Os valores que o template de fase recebe.
 *
 * Tudo que o prompt diz sai daqui, e nada e calculado dentro do template: template e dado,
 * decisao e codigo. E o que permite um projeto reescrever o texto do prompt em
 * `prompts/fase-padrao.md` sem poder mudar o que o `ork` considera verdade.
 */
export function valoresDoPrompt(
  thread: Thread,
  fase: Fase,
  pedido: string,
  memoriaInjetada = ''
): Record<string, string> {
  const def = definicaoDoModo(thread.modo);
  const bloco = blocoDaThread(thread, fase);
  const pausa = pausaNaThread(thread, fase);
  return {
    fase,
    thread: thread.id,
    bloco: bloco.fases.join('-'),
    nome: thread.nome,
    ciclo_canonico: fasesDoCicloNoPrompt(thread).map(
      (f) => `${bloco.fases.includes(f) ? '>' : ' '} ${CONTRATO_DAS_FASES[f]}`
    ).join('\n'),
    tag: def.tag,
    blocos: thread.blocos.map((b) => b.fases.join('-')).join(' / '),
    pausas: String(thread.blocos.filter((b) => b.pausa).length),
    linha_variante: thread.variante ? `Variante de ciclo: ${thread.variante}` : '',
    regra_de_pausa: pausa
      ? `Ao fim deste bloco HA PAUSA humana sobre: ${bloco.pausaSobre}. Pare, apresente a evidencia e espere o veredito.`
      : 'Ao fim deste bloco NAO ha pausa humana: siga com decisao autonoma e registre no ledger quem decidiu, com que evidencia e por que.',
    invariantes: INVARIANTES.map((i) => `- ${i}`).join('\n'),
    slug: thread.slug,
    projeto_nome: thread.projeto.name,
    projeto_abbrev: thread.projeto.abbrev,
    base_branch: thread.base.branch,
    base_commit: thread.base.commit,
    diretorio: thread.worktree ?? '(raiz do projeto)',
    pedido: pedido.trim(),
    // Bloco B6: o bloco de memoria injetada deterministicamente. Vazio em toda thread sem
    // decisao fechada e sem OrkMind, e ai a linha da variavel some do prompt: o texto fica
    // byte a byte igual ao que o B4 ja despachava.
    memoria_injetada: memoriaInjetada,
    regras_de_evidencia: REGRAS_DE_EVIDENCIA.map((r) => `- ${r}`).join('\n'),
  };
}

/**
 * Monta o prompt da fase renderizando o template versionado (bloco B4).
 *
 * Sem `raiz`, ou sem `prompts/` no projeto, vale o template embutido do `ork`. Com um
 * `prompts/fase-padrao.md` (ou `prompts/fase-goal.md` e companhia) versionado no repositorio,
 * vale o do projeto, e `ork prompt lint` e quem garante que ele nao perdeu o contrato.
 */
export function montarPrompt(
  thread: Thread,
  fase: Fase,
  pedido: string,
  raiz?: string,
  memoriaInjetada = ''
): string {
  return renderizar(
    templateDaFase(fase, raiz),
    valoresDoPrompt(thread, fase, pedido, memoriaInjetada)
  );
}

/**
 * Monta o prompt da fase JA com a memoria injetada (bloco B6).
 *
 * Separado de `montarPrompt` de proposito: quem so quer renderizar um template (o
 * `ork prompt render --exemplo`, o lint) nao precisa abrir memoria nenhuma, e quem
 * despacha uma fase de verdade precisa. Em regime `files` a injecao continua acontecendo,
 * com as decisoes fechadas lidas do `thread.json`: a garantia nao depende do OrkMind.
 */
export function montarPromptComMemoria(
  carregado: ManifestoCarregado,
  thread: Thread,
  fase: Fase,
  pedido: string,
  memoria: Memoria
): { prompt: string; injecao: InjecaoDeMemoria } {
  const injecao = injecaoDaFase(carregado, memoria, thread, fase);
  return {
    prompt: montarPrompt(thread, fase, pedido, carregado.raiz, injecao.texto),
    injecao,
  };
}

/** sha256 do prompt, o mesmo hash gravado no `thread.json` e no ledger. */
export function hashDoPrompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function schemaDeClaimsDoPacote(): Record<string, unknown> {
  const candidatos = [
    path.join(__dirname, '..', 'schemas', 'claims.schema.json'),
    path.join(__dirname, '..', '..', 'schemas', 'claims.schema.json'),
  ];
  const arquivo = candidatos.find(c => fs.existsSync(c));
  if (!arquivo) throw new Error('runtime.unavailable: schema de claims nao encontrado no pacote');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
}

/** Slug da sessao que conduz esta fase, rotacionando quando o slug ja foi usado na thread. */
export function slugDaSessao(thread: Thread, fase: Fase): string {
  const bloco = blocoDaThread(thread, fase);
  const base = montarSlug(thread.projeto.abbrev, thread.assunto, bloco.slugFases);
  const usados = thread.sessoes.map((s) => s.slug);
  if (!usados.includes(base)) return base;
  return proximaRotacao(base, usados);
}

/**
 * Runtime, modelo e esforco EFETIVAMENTE usados num despacho, resolvidos numa funcao so.
 *
 * Precedencia (decisao D4 da thread ork-homologarcod): opcao explicita do CLI > setup do
 * bloco (feature #setup, `.orkastery/setup.json`) > runtime do manifesto.
 *
 * Regra do esforco: quem informa SO o modelo esta pedindo o despacho mais capaz que
 * existe, entao o esforco assume `high` em vez de herdar o do setup ou do manifesto.
 * Quem informa o esforco manda. Resolver isso aqui, e nao no ponto de chamada, e o que
 * permite gravar o trio no ledger como FATO: o mesmo valor que foi para o runtime
 * adapter e o que fica carimbado no evento.
 */
export function resolverDespacho(
  manifesto: ManifestoCarregado['manifesto'],
  opcoes: { model?: string; effort?: string; runtime?: string },
  doBloco?: ConfigDeBloco | null
): { runtime: string; model: string; effort: string } {
  const origem = doBloco?.runtime ?? manifesto.runtime.adapter;
  const runtime = opcoes.runtime ?? origem;
  if (runtimeConhecido(runtime) && runtime !== origem && !opcoes.model?.trim())
    throw new Error(`setup.model.required: ao trocar runtime de ${origem} para ${runtime}, informe --runtime ${runtime} --model <modelo> para este despacho; o setup do projeto permanece intacto.`);
  const model = opcoes.model ?? doBloco?.model ?? manifesto.runtime.model;
  if (!model.trim())
    throw new Error(`setup.model.required: modelo pendente para ${runtime}; informe --model <modelo> neste despacho ou complete o bloco em ork setup.`);
  const effort =
    opcoes.effort ??
    (opcoes.model !== undefined ? 'high' : doBloco?.effort ?? manifesto.runtime.effort);
  return { runtime, model, effort };
}

/**
 * Contexto de UM despacho de fase, comum ao caminho normal e a retomada do bloco B3.
 *
 * Existe para que a retomada por rate limit nao reimplemente o registro no ledger nem a
 * gravacao da sessao no `thread.json`. Regra de negocio duplicada e regra de negocio que
 * diverge: a fase retomada precisa entrar na thread exatamente como a fase original.
 */
export interface ContextoDeDespacho {
  identidade?: IdentidadeDeDespacho;
  raiz: string;
  thread: Thread;
  fase: Fase;
  slug: string;
  /** Caminho ABSOLUTO do prompt em disco. */
  promptPath: string;
  promptSha256: string;
  runtime: string;
  cwd: string;
  /** Modelo EFETIVAMENTE despachado (ja resolvido contra o manifesto). Vai ao ledger. */
  model: string;
  /** Esforco EFETIVAMENTE despachado (ja resolvido contra o manifesto). Vai ao ledger. */
  effort: string;
  /** Quem pediu o despacho: `phase.run` ou `retry.rate-limit` (bloco B3). */
  origem: string;
  /** I-33 (D4): perfil de conta do despacho; vai ao ledger e ao registro da sessao. */
  perfil?: PerfilDeDespacho;
  /** I-33 (N1): HEAD da worktree lido ANTES do despacho do GO codex; `null` quando o git nao respondeu. */
  headNoDespacho?: string | null;
  /** I-36 (T10): canal de origem do despacho e a conversa/mensagem que o originou. */
  canal?: CanalDeConducao;
  correlacao?: string | null;
  /** I-36 (T7): a conducao tomada para este despacho; vira a da sessao quando ela existe. */
  conducao?: ConducaoTomada;
  /** I-36 (D3): prazo do lease da sessao, derivado do limite de duracao do bloco. */
  prazoDaSessaoMs?: number;
}

/** O comando com o prompt mascarado pelo hash: o ledger nao guarda o texto inteiro. */
function comandoMascarado(comando: string[], sha: string): string[] {
  return comando.map((c, i) => (i === 2 ? `<prompt:${sha.slice(0, 8)}>` : c));
}

/** Os campos que todo evento de despacho carrega, no caminho normal e na retomada. */
export function dadosDoDespacho(ctx: ContextoDeDespacho, comando: string[]): Record<string, unknown> {
  return {
    fase: ctx.fase,
    slug: ctx.slug,
    modo: ctx.thread.modo,
    bloco: blocoDaThread(ctx.thread, ctx.fase).fases.join('-'),
    pausaAoFim: pausaNaThread(ctx.thread, ctx.fase),
    runtime: ctx.runtime,
    // Fato verificavel: o modelo e o esforco reais do despacho ficam no proprio evento,
    // e nao no relato do agente. `ork phase list` le daqui.
    model: ctx.model,
    effort: ctx.effort,
    cwd: ctx.cwd,
    promptPath: path.relative(ctx.raiz, ctx.promptPath),
    promptSha256: ctx.promptSha256,
    origem: ctx.origem,
    // I-36 (T10): a porta por onde o dono chegou. `runtime` e o motor; `canal` e a porta.
    ...(ctx.canal ? { canal: ctx.canal } : {}),
    ...(ctx.correlacao ? { correlacao: ctx.correlacao } : {}),
    ...(ctx.identidade ? { identidade: ctx.identidade } : {}),
    // I-33 (D4): so identidade e diretorio do perfil; o store guarda o resto e nada e segredo.
    ...(ctx.perfil ? { perfil: ctx.perfil } : {}),
    comando: comandoMascarado(comando, ctx.promptSha256),
  };
}

/**
 * Fecha um despacho BEM SUCEDIDO: ledger, decisao autonoma ou pausa prevista, e a
 * sessao gravada no `thread.json`. Usada pelo `ork phase run` e pela retomada do B3.
 */
export function concluirDespacho(
  ctx: ContextoDeDespacho,
  sessionId: string,
  verificada: boolean,
  comando: string[],
  fonteVerificacao?: string,
  controlador?: string,
  /** Variante histórica do supervisor; a variante do controller não tem log próprio. */
  sensores?: { logPath?: string; processoPath?: string; reciboPath?: string }
): SessaoDaThread {
  const dir = dirThread(ctx.raiz, ctx.thread.id);
  const comum = dadosDoDespacho(ctx, comando);
  const bloco = blocoDaThread(ctx.thread, ctx.fase);
  const pausaAoFim = pausaNaThread(ctx.thread, ctx.fase);

  // I-51 (RM-047): a maquina que despachou. So o evento de conducao; os de HITL nao mudam.
  registrar(dir, ctx.thread.id, TIPOS_DE_EVENTO.faseDespachada, { ...comum, sessionId, ...(controlador ? { controlador } : {}),
    maquina: nomeDaMaquina() });
  registrar(dir, ctx.thread.id, TIPOS_DE_EVENTO.despachoVerificado, {
    fase: ctx.fase,
    slug: ctx.slug,
    sessionId,
    // A fonte e do runtime que despachou: e ela que diz ONDE conferir a sessao depois.
    fonte: fonteVerificacao ?? resolverRuntime(ctx.runtime).fonteVerificacao,
    encontrada: verificada,
  });
  if (!pausaAoFim) {
    const tag = definicaoDoModo(ctx.thread.modo).tag;
    registrar(dir, ctx.thread.id, TIPOS_DE_EVENTO.decisaoAutonoma, {
      fase: ctx.fase,
      slug: ctx.slug,
      sessionId,
      decisao: `bloco ${bloco.fases.join('-')} segue sem pausa humana`,
      // I-41 (GO-FIX 1, D11): o rastro tipado. `autorizadoPor` fica pelo que ja o lia.
      quemDecidiu: `o builder, pela #TAG ${tag} no pedido`,
      autorizadoPor: `#TAG ${tag} no pedido do builder`,
      evidencia: `prompt sha256 ${ctx.promptSha256}`,
      razao: `o modo ${tag} não prevê pausa humana ao fim do bloco ${bloco.fases.join('-')}`,
    });
  } else {
    registrar(dir, ctx.thread.id, TIPOS_DE_EVENTO.pausaHumana, {
      fase: ctx.fase,
      slug: ctx.slug,
      sessionId,
      previstaSobre: bloco.pausaSobre,
      estado: 'prevista ao fim do bloco',
    });
  }

  const sessao: SessaoComPerfil = {
    ...(controlador ? { controlador } : {}),
    slug: ctx.slug,
    fase: ctx.fase,
    bloco: bloco.fases.join('-'),
    sessionId,
    runtime: ctx.runtime,
    despachadaEm: agora(),
    promptPath: path.relative(ctx.raiz, ctx.promptPath),
    promptSha256: ctx.promptSha256,
    verificada,
    ...(ctx.perfil ? { perfil: ctx.perfil } : {}),
    ...(ctx.canal ? { canal: ctx.canal } : {}),
    ...(ctx.correlacao ? { correlacao: ctx.correlacao } : {}),
  };
  ctx.thread.sessoes.push(sessao);
  // `ultimoUso` e informativo: store indisponivel nao desfaz um despacho ja provado.
  if (ctx.perfil) { try { registrarUsoDePerfil(ctx.raiz, ctx.perfil.id, sessao.despachadaEm); } catch { /* informativo */ } }
  ctx.thread.faseAtual = ctx.fase;
  gravarThread(ctx.raiz, ctx.thread);
  // I-36 (T7): a conducao deixa de ser do ato de despachar e passa a ser da janela da sessao.
  vincularConducaoDaSessao(ctx, sessionId);
  // I-51 (RM-047): as outras maquinas veem a fase nova; so com a fabrica compartilhada.
  publicarEmSegundoPlano(ctx.raiz);
  if (ctx.runtime === 'codex' || ctx.runtime === 'claude-bg') registrarObservacao(ctx, sessao, dir, controlador, sensores);
  return sessao;
}

/**
 * I-36 (T7): o lease de execucao sobrevive ao `ork phase run`, porque quem executa e a sessao. Ele
 * so sai quando a fase termina (a prova da I-34 no ledger) ou com prova de abandono (D7).
 */
function vincularConducaoDaSessao(ctx: ContextoDeDespacho, sessionId: string): void {
  const sessao = { sessionId, runtime: ctx.runtime, perfil: ctx.perfil?.id ?? null };
  const prazoMs = ctx.prazoDaSessaoMs ?? PRAZO_DE_SESSAO_PADRAO_MS;
  if (ctx.conducao) { ctx.conducao.converterEmSessao({ ...sessao, prazoMs }); return; }
  try {
    registrarConducaoDaSessao(ctx.raiz, ctx.thread.id, { canal: ctx.canal ?? 'cli', correlacao: ctx.correlacao ?? null,
      operacao: ctx.origem.startsWith('retry') ? 'retry.run' : 'phase.run', fase: ctx.fase, promptSha256: ctx.promptSha256,
      identidade: ctx.identidade?.dispatchId ?? null, prazoMs }, sessao);
  } catch { /* a conducao protege a worktree; um despacho ja provado nao se desfaz por falta dela */ }
}

/** I-36: o prazo do lease de uma sessao do bloco: o limite de duracao dele, ou o padrao. */
export function prazoDaSessao(limites: { duracaoMs: number } | null): number {
  return limites?.duracaoMs ? limites.duracaoMs + MARGEM_DO_PRAZO_MS : PRAZO_DE_SESSAO_PADRAO_MS;
}

/**
 * D4: registro da fonte e arranque do observador no ponto comum a `phase` e `retry`.
 * Sem CLI manual e sem segundo runtime: quem despacha e prova a sessao inicia a observacao.
 */
function registrarObservacao(ctx: ContextoDeDespacho, sessao: SessaoDaThread, dir: string,
  controlador?: string, sensores?: { logPath?: string; processoPath?: string; reciboPath?: string }): void {
  const mesmoDespacho = (e: Record<string, unknown>) => e.sessionId === sessao.sessionId && e.despachoEm === sessao.despachadaEm;
  try {
    // I-34: claude-bg observa pela fonte nativa; no PLAN o registro guarda o sha de base do artefato.
    // I-33 (N1): o GO codex registra o HEAD do despacho, como a fonte claude-bg; sem ele a D11c nao ve commit pelo shell.
    const head = ctx.runtime === 'codex' && ctx.fase === 'GO' ? { head: ctx.headNoDespacho ?? null } : {};
    const fonte = ctx.runtime === 'claude-bg' ? fonteClaudeDoDespacho(ctx.raiz, ctx.thread.id, ctx.fase, ctx.cwd)
      : sensores?.logPath ? { logPath: sensores.logPath, processoPath: sensores.processoPath, reciboPath: sensores.reciboPath, ...head }
      : controlador ? { controlador, cwd: ctx.cwd, ...head } : null;
    if (!fonte) return;
    validarFonteWatcher(ctx.raiz, sessao.sessionId, fonte);
    const eventos = lerLedger(dir);
    if (!eventos.some(e => e.tipo === 'session_sensor_registered' && mesmoDespacho(e))) {
      registrar(dir, ctx.thread.id, 'session_sensor_registered', { fase: ctx.fase,
        sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm, ...fonte, ...(ctx.perfil ? { perfil: ctx.perfil } : {}) });
    }
    // A primitiva verifica identidade/prontidao e ignora registros antigos sem prova.
    iniciarWatcher(ctx.raiz, sessao.sessionId);
  } catch {
    registrar(dir, ctx.thread.id, 'session_watcher_error', { fase: ctx.fase, sessionId: sessao.sessionId,
      despachoEm: sessao.despachadaEm, motivo: 'runtime.unavailable', erro: 'fonte ou prontidao do watcher invalida',
      origem: 'phase.dispatch', ...(controlador ? { controlador } : {}) });
  }
}

export interface OpcoesRun {
  fase: Fase;
  prompt: string;
  /** Runtime explicito (`claude-bg` | `codex`); sem ele vale o setup do bloco, depois o manifesto. */
  runtime?: string;
  model?: string;
  effort?: string;
  dryRun?: boolean;
  /** Memoria ja aberta (testes e chamadas em lote). Sem ela, o `ork` abre a do manifesto. */
  memoria?: Memoria;
  /** I-33: perfil explicito do store; sem ele, o primeiro disponivel do runtime. */
  perfil?: string;
  /** I-36 (D6): canal de origem; sem ele, o que a borda declarou (`canalDoProcesso`). */
  canal?: CanalDeConducao;
  /** I-36 (T10): conversa ou mensagem que originou o pedido. */
  correlacao?: string;
  /** I-36 (D2): espera a vez ate este prazo em vez de recusar na hora. */
  esperarMs?: number;
}

export interface ResultadoRun {
  controlador?: string;
  thread: Thread;
  slug: string;
  promptPath: string;
  promptSha256: string;
  comando: string[];
  sessionId: string | null;
  verificada: boolean;
  pausaAoFim: boolean;
  dryRun: boolean;
  /** Runtime, modelo e esforco EFETIVAMENTE usados (o mesmo trio carimbado no ledger). */
  runtime: string;
  model: string;
  effort: string;
  /** Gate tipado reprovou antes do despacho (bloco B1). */
  bloqueado: boolean;
  motivo: MotivoGate | null;
  violacoes: ViolacaoDePolicy[];
  /** Bloco B3: pedido criado na fila duravel quando o despacho morreu por rate limit. */
  naFila?: PedidoDeRetomada | null;
  erro?: string;
  /** I-36 (T14): mesma fase e mesmo prompt de quem ja conduz: nenhuma sessao nova foi aberta. */
  idempotente?: boolean;
  /** I-36: quem conduz, quando o pedido foi recusado ou atendido pela sessao em andamento. */
  conducao?: ConducaoAtual;
  /** I-36 (T12): a recusa tipada, com as tres acoes e o texto para o humano. */
  recusa?: RecusaDeConducao;
}

/** Despacha a fase pelo runtime adapter e registra tudo no ledger da thread. */
export function rodarFase(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesRun): ResultadoRun {
  const rodar = (): ResultadoRun => opcoes.dryRun ? rodarFaseSobLock(carregado, threadId, opcoes) :
    comLockHitl(carregado.raiz, threadId, () => rodarFaseSobLock(carregado, threadId, opcoes));
  // I-36 (D2): `--esperar` espera a vez FORA do lock HITL (que serializa respostas do dono) e so
  // depois repete o pedido. Sem ele, a recusa sai na hora.
  const prazo = opcoes.esperarMs && opcoes.esperarMs > 0 && !opcoes.dryRun ? Date.now() + opcoes.esperarMs : null;
  for (;;) {
    if (prazo) esperarConducaoLivre(carregado.raiz, threadId, Math.max(0, prazo - Date.now()));
    const r = rodar();
    if (r.motivo !== 'conducao.em-andamento' || !prazo || Date.now() >= prazo) return r;
  }
}

function rodarFaseSobLock(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesRun
): ResultadoRun {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const fase = opcoes.fase;
  const dir = dirThread(raiz, thread.id);
  const slug = slugDaSessao(thread, fase);
  // Resolve UMA vez o trio runtime/modelo/esforco: o mesmo objeto vai ao runtime adapter,
  // ao ledger e a resposta do CLI. Resolver duas vezes e o caminho curto para o ledger
  // dizer um modelo e o runtime receber outro. O setup do bloco (feature #setup) entra
  // aqui: cada bloco de cada modo pode abrir a sessao com runtime/modelo/esforco proprios.
  const setup = lerSetup(raiz);
  const doBloco = configDoBloco(setup, thread.modo, fase);
  const { runtime, model, effort } = resolverDespacho(manifesto, opcoes, doBloco);
  const limites = limitesDoBloco(manifesto, setup, thread.modo, fase);
  const rt = resolverRuntime(runtime);
  // Bloco B6: a memoria entra ANTES do hash. O prompt que o ledger carimba e o mesmo que
  // o agente recebe, memoria injetada inclusa.
  const memoria = opcoes.memoria ?? abrirMemoria(carregado);
  const { prompt, injecao } = montarPromptComMemoria(carregado, thread, fase, opcoes.prompt, memoria);
  const sha = hashDoPrompt(prompt);
  const promptPath = path.join(dir, 'prompts', `${slug}-${fase.toLowerCase()}-${sha.slice(0, 8)}.md`);

  // Gate tipado do bloco B1: as policies do manifesto valem ANTES do despacho, em
  // qualquer modo. Prompt reprovado nem chega a ser gravado em disco: gravar um prompt
  // com credencial e criar um segundo vazamento no proprio repositorio.
  const violacoes = avaliarPolicies(manifesto, { gate: 'phase.dispatch', prompt });
  const bloqueiam = bloqueantes(violacoes);
  if (bloqueiam.length > 0) {
    const detalhe = bloqueiam.map((v) => `${v.policy}: ${v.detalhe}`).join('; ');
    // Bloco B3: violacao de CUSTO sai tipada como tal. E o que permite a politica de
    // retry recusar reexecucao automatica dela sem reabrir o nome da policy aqui.
    const motivoDoLote = motivoDominante(bloqueiam);
    registrarGateBloqueado(dir, thread.id, {
      gate: 'phase.dispatch',
      motivo: motivoDoLote,
      modo: thread.modo,
      detalhe,
      correcao: bloqueiam.map((v) => v.correcao).join('; '),
      fase,
      slug,
      evidencia: `prompt sha256 ${sha} (nao gravado em disco)`,
    });
    return {
      thread,
      slug,
      promptPath,
      promptSha256: sha,
      comando: [],
      sessionId: null,
      verificada: false,
      pausaAoFim: pausaNaThread(thread, fase),
      dryRun: opcoes.dryRun === true,
      runtime,
      model,
      effort,
      bloqueado: true,
      motivo: motivoDoLote,
      violacoes,
      erro: detalhe,
    };
  }
  // I-43 (D4, viga a): a validacao por runtime diferente e cobrada no MESMO portao
  // por onde todo despacho ja passa. Trocar um portao por outro no mesmo lugar e a
  // mudanca que o CHECK consegue conferir lendo um diff.
  const erroDeRuntime = runtimeCruzadoParaDespacho(thread, fase, runtime);
  if (erroDeRuntime) {
    registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'runtime.autoconferencia',
      modo: thread.modo, detalhe: erroDeRuntime, fase, slug,
      correcao: `ork phase run ${thread.id} CHECK --runtime <outro> --prompt "<pedido>"` });
    return { thread, slug, promptPath, promptSha256: sha, comando: [], sessionId: null,
      verificada: false, pausaAoFim: pausaNaThread(thread, fase), dryRun: opcoes.dryRun === true,
      runtime, model, effort, bloqueado: true, motivo: 'runtime.autoconferencia', violacoes, erro: erroDeRuntime };
  }
  const erroDeEstado = estadoParaDespacho(raiz, thread, opcoes.dryRun);
  if (erroDeEstado) {
    registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'tree.blocked',
      modo: thread.modo, detalhe: erroDeEstado, correcao: `ork worktree sync ${thread.id}`, fase, slug });
    return { thread, slug, promptPath, promptSha256: sha, comando: [], sessionId: null,
      verificada: false, pausaAoFim: pausaNaThread(thread, fase), dryRun: opcoes.dryRun === true,
      runtime, model, effort, bloqueado: true, motivo: 'tree.blocked', violacoes, erro: erroDeEstado };
  }
  // I-36 (T7, T14): validado o pedido, a conducao da thread, antes de tocar a worktree. A mesma fase com o
  // mesmo prompt de quem conduz devolve a sessao em andamento sem chamar o adapter; outro pedido recebe a recusa.
  const identidade = novaIdentidadeDeDespacho(thread.id, fase);
  const canal = opcoes.canal ?? canalDoProcesso();
  const pedidoDeConducao: PedidoDeConducao = { canal, correlacao: opcoes.correlacao ?? null, operacao: 'phase.run', fase,
    promptSha256: sha, identidade: identidade.dispatchId, prazoMs: prazoDaSessao(limites) };
  const ocupadaPor = (ocupada: ConducaoOcupada, gravarNoLedger: boolean): ResultadoRun => {
    const base = { thread, slug, promptPath, promptSha256: sha, comando: [] as string[], verificada: false,
      pausaAoFim: pausaNaThread(thread, fase), dryRun: opcoes.dryRun === true, runtime, model, effort, violacoes: [] as ViolacaoDePolicy[] };
    const atual = ocupada.atual;
    if (ocupada.idempotente && atual) {
      if (gravarNoLedger) registrar(dir, thread.id, TIPOS_DE_EVENTO.despachoIdempotente, { fase, promptSha256: sha, canal,
        sessionId: atual.sessao, conducao: { canal: atual.canal, desde: atual.desde },
        razao: 'mesma fase e mesmo prompt de quem ja conduz: a sessao em andamento atende o pedido, sem sessao nova e sem cota' });
      return { ...base, sessionId: atual.sessao, bloqueado: false, motivo: null, idempotente: true, conducao: atual };
    }
    const recusa = recusaDeConducao(thread.id, atual, pedidoDeConducao);
    if (gravarNoLedger) registrarRecusa(raiz, recusa);
    return { ...base, sessionId: null, bloqueado: true, motivo: 'conducao.em-andamento', erro: recusa.texto, recusa,
      ...(atual ? { conducao: atual } : {}) };
  };
  let conducao: ConducaoTomada | null = null;
  if (opcoes.dryRun) {
    // O ensaio nao toma nada, mas diz a verdade: com conducao em andamento, o despacho real seria recusado.
    const atual = conducaoDaThread(raiz, thread.id);
    if (atual) return ocupadaPor({ ok: false, idempotente: atual.fase === fase && atual.promptSha256 === sha, atual }, false);
  } else {
    const tomada = tomarConducao(raiz, thread.id, pedidoDeConducao);
    if (!tomada.ok) return ocupadaPor(tomada, true);
    conducao = tomada;
  }
  try {
    const cwd = thread.worktree ?? raiz;
    let contextoRuntime: ContextoRuntime | undefined;
    try { contextoRuntime = contextoDoProjeto(raiz, runtime, cwd, thread.id); }
    catch (e) {
      const erro = `runtime.unavailable: ${(e as Error).message}`;
      registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: 'runtime.unavailable',
        modo: thread.modo, detalhe: erro, fase, slug });
      return { thread, slug, promptPath, promptSha256: sha, comando: [], sessionId: null,
        verificada: false, pausaAoFim: pausaNaThread(thread, fase), dryRun: opcoes.dryRun === true,
        runtime, model, effort, bloqueado: true, motivo: 'runtime.unavailable', violacoes, erro };
    }
    if (contextoRuntime) contextoRuntime.identidade = identidade;
    gravar(promptPath, prompt);
    // I-33 (D2, D4, D7): o perfil sai do store com o login conferido. Sem perfil disponivel, o
    // despacho nao sai pela conta errada: o prompt ja gravado fica registrado para a rotacao do
    // retry (outro runtime da ordem de fallback, ou a fila), com o motivo tipado.
    let escolha: EscolhaDePerfil;
    try { escolha = perfilParaDespacho(carregado, thread, fase, runtime, { perfil: opcoes.perfil, dryRun: opcoes.dryRun, origem: 'phase.run' }); }
    catch (e) { escolha = { perfil: null, configurados: 0, erro: (e as Error).message }; }
    if (escolha.erro) {
      const motivo = escolha.motivo ?? 'runtime.unavailable';
      const erro = `${motivo}: ${escolha.erro}`;
      if (!opcoes.dryRun) {
        const semPerfil: ContextoDeDespacho = { identidade, raiz, thread, fase, slug, promptPath, promptSha256: sha, runtime, cwd, model, effort,
          origem: 'phase.run', canal, correlacao: opcoes.correlacao ?? null };
        registrar(dir, thread.id, TIPOS_DE_EVENTO.despachoFalhou, { ...dadosDoDespacho(semPerfil, []), erro });
        registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo, modo: thread.modo, detalhe: erro,
          correcao: motivo === 'cost.violation'
            ? 'refaca o login do perfil pela assinatura (claude auth login --claudeai ou codex login com ChatGPT) e rode ork accounts check; perfil de provider pago nunca despacha'
            : 'ork accounts list mostra o estado de cada perfil; ork retry run segue pela ordem de fallback ou pela fila',
          fase, slug, runtime, origem: 'phase.run' });
      }
      return { thread, slug, promptPath, promptSha256: sha, comando: [], sessionId: null,
        verificada: false, pausaAoFim: pausaNaThread(thread, fase), dryRun: opcoes.dryRun === true,
        runtime, model, effort, bloqueado: true, motivo, violacoes, erro };
    }
    const perfil = escolha.perfil ?? undefined;

    // A injecao e evidencia: o ledger diz quantos itens entraram, de que colecao e de onde,
    // para que "o prompt tinha a decisao D2" seja verificavel depois sem reler o prompt.
    if (injecao.itens.length > 0) {
      registrar(dir, thread.id, TIPOS_DE_EVENTO.memoriaInjetada, {
        fase,
        slug,
        regime: injecao.regime,
        decisoes: injecao.decisoes,
        licoes: injecao.licoes,
        regras: injecao.regras,
        itens: injecao.itens.map((i) => `${i.id}:${i.colecao}:${i.location}`),
        promptSha256: sha,
      });
    }
    if (memoria.estado.motivo && memoria.estado.pedido === 'orkmind') {
      registrar(dir, thread.id, TIPOS_DE_EVENTO.memoriaDegradada, {
        fase,
        slug,
        pedido: memoria.estado.pedido,
        efetivo: memoria.estado.efetivo,
        motivo: memoria.estado.motivo,
        detalhe: memoria.estado.detalhe,
        correcao: memoria.estado.correcao,
      });
    }

    const pausaAoFim = pausaNaThread(thread, fase);
    const claimsSchema = fase === 'GO' && runtime === 'codex'
      ? schemaDeClaimsDoPacote()
      : undefined;
    // I-33 (N1): lido antes de a sessao existir; depois dela, um commit rapido ja estaria no HEAD.
    const headNoDespacho = fase === 'GO' && runtime === 'codex' && !opcoes.dryRun ? headDaWorktree(cwd) : undefined;
    const resultado = rt.despachar({
      prompt,
      nome: slug,
      cwd,
      model,
      effort,
      dryRun: opcoes.dryRun,
      sandbox: manifesto.runtime.sandbox,
      logDir: path.join(dir, 'sessoes'),
      vinculo: { thread: thread.id, fase, promptSha256: sha },
      contextoRuntime,
      ...(perfil ? { perfil } : {}),
      ...(fase === 'PLAN' ? { colaboracao: 'plan' as const } : {}),
      ...(claimsSchema ? { outputSchema: claimsSchema } : {}),
      // `thread.base.branch` vira a branch fonte quando a thread ganha worktree
      // (`ork/<slug>`). O review nativo precisa comparar essa fonte com a base de
      // integração do projeto; usar a própria fonte produz um diff vazio.
      ...(fase === 'CHECK' && runtime === 'codex' ? { reviewBaseBranch: manifesto.worktree.base_branch } : {}),
      ...(limites ? { duracaoMaximaMs: limites.duracaoMs } : {}),
      // I-36 (D4): a sessao filha herda a identidade do despacho e o canal; e assim que ela reentra.
      ambienteExtra: ambienteDaConducao(identidade.dispatchId, thread.id, canal),
    });

    const ctx: ContextoDeDespacho = {
      identidade,
      canal,
      correlacao: opcoes.correlacao ?? null,
      ...(conducao ? { conducao } : {}),
      prazoDaSessaoMs: pedidoDeConducao.prazoMs,
      raiz,
      thread,
      fase,
      slug,
      promptPath,
      promptSha256: sha,
      runtime,
      cwd,
      model,
      effort,
      origem: 'phase.run',
      ...(perfil ? { perfil } : {}),
      ...(headNoDespacho !== undefined ? { headNoDespacho } : {}),
    };
    const comum = dadosDoDespacho(ctx, resultado.comando);

    if (opcoes.dryRun) {
      return {
        thread,
        slug,
        promptPath,
        promptSha256: sha,
        comando: resultado.comando,
        sessionId: null,
        verificada: false,
        pausaAoFim,
        dryRun: true,
        // O ensaio NAO toca no ledger (a garantia do B0 continua de pe), mas devolve o
        // par resolvido: e assim que o `--dry-run` mostra o modelo que seria despachado.
        runtime,
        model,
        effort,
        bloqueado: false,
        motivo: null,
        violacoes,
      };
    }

    if (!resultado.ok || !resultado.sessionId) {
      const erro = resultado.erro ?? 'sem sessionId na saida do runtime';
      registrar(dir, thread.id, TIPOS_DE_EVENTO.despachoFalhou, {
        ...comum,
        controlador: resultado.controlador,
        erro,
        stderr: resultado.stderr.slice(0, 500),
      });

      // I-33 (D1, D5): a CONTA recusou o despacho. Nada rodou, entao nada foi produzido: o perfil
      // sai do rodizio e o gate tipado fica para a rotacao do retry, que redespacha o mesmo prompt.
      const falha = resultado.falhaDeConta ?? null;
      if (falha) {
        try { marcarContaDaFalha(carregado, perfil, falha); } catch { /* o gate abaixo continua registrando a falha */ }
        registrarGateBloqueado(dir, thread.id, { gate: 'phase.dispatch', motivo: falha.motivo, modo: thread.modo, detalhe: erro,
          correcao: 'ork retry run rotaciona para o proximo perfil, para o runtime de fallback ou para a fila', fase, slug,
          runtime, origem: 'phase.run', falhaDeConta: falha, ...(perfil ? { perfil } : {}),
          evidencia: 'saida real do runtime adapter no despacho, nao relato do agente' });
        return { thread, slug, promptPath, promptSha256: sha, comando: resultado.comando, controlador: resultado.controlador,
          sessionId: null, verificada: false, pausaAoFim, dryRun: false, runtime, model, effort, bloqueado: false,
          motivo: falha.motivo, violacoes, naFila: null, erro };
      }

      // Bloco B3: rate limit nao e falha seca. A fase morreu com HORA de volta, entao ela
      // vira pedido na fila duravel em vez de virar tarefa da memoria de alguem. O prompt
      // ja esta gravado em disco com o sha256 acima, e e ele que sera redespachado.
      const sinal = resultado.rateLimit ?? null;
      if (sinal) {
        registrar(dir, thread.id, TIPOS_DE_EVENTO.rateLimitDetectado, {
          fase,
          slug,
          fonte: sinal.fonte,
          resetEm: sinal.resetEm,
          trecho: sinal.trecho,
          evidencia: 'stderr real do runtime adapter, nao relato do agente',
        });
        const pedido = enfileirar(carregado, {
          thread: thread.id,
          fase,
          slug,
          promptPath,
          promptSha256: sha,
          cwd,
          model,
          effort,
          sinal,
          detalhe: erro,
        });
        registrar(dir, thread.id, TIPOS_DE_EVENTO.rateLimitEnfileirado, {
          fase,
          slug,
          pedido: pedido.id,
          liberaEm: pedido.liberaEm,
          janelaEstimada: pedido.janelaEstimada,
          fonte: sinal.fonte,
          promptSha256: sha,
          correcao: `ork retry resume (ou aguarde ate ${pedido.liberaEm})`,
        });
        return {
          thread,
          slug,
          promptPath,
          promptSha256: sha,
          comando: resultado.comando,
          controlador: resultado.controlador,
          sessionId: null,
          verificada: false,
          pausaAoFim,
          dryRun: false,
          runtime,
          model,
          effort,
          bloqueado: false,
          motivo: 'runtime.rate-limited',
          violacoes,
          naFila: pedido,
          erro,
        };
      }

      return {
        thread,
        slug,
        promptPath,
        promptSha256: sha,
        comando: resultado.comando,
          controlador: resultado.controlador,
        sessionId: null,
        verificada: false,
        pausaAoFim,
        dryRun: false,
        runtime,
        model,
        effort,
        bloqueado: false,
        motivo: 'runtime.unavailable',
        violacoes,
        naFila: null,
        erro,
      };
    }

    concluirDespacho(ctx, resultado.sessionId, resultado.verificada, resultado.comando, rt.fonteVerificacao,
      resultado.controlador, { logPath: resultado.logPath, processoPath: resultado.processoPath, reciboPath: resultado.reciboPath });

    return {
      thread,
      slug,
      promptPath,
      promptSha256: sha,
      comando: resultado.comando,
      sessionId: resultado.sessionId,
      controlador: resultado.controlador,
      verificada: resultado.verificada,
      pausaAoFim,
      dryRun: false,
      runtime,
      model,
      effort,
      bloqueado: false,
      motivo: null,
      violacoes,
    };
  } finally {
    // Despacho que nao virou sessao devolve a conducao; o que virou ja a entregou a sessao.
    conducao?.liberar();
  }
}

/** Tabela de `ork phase list`: o historico do ledger da thread. */
export function tabelaDoLedger(raiz: string, threadId: string): string {
  // Thread inexistente e erro, nao ledger vazio: o CLI precisa reprovar o id errado.
  lerThread(raiz, threadId);
  const eventos = lerLedger(dirThread(raiz, threadId));
  if (eventos.length === 0) {
    return `Ledger vazio para a thread ${threadId}.`;
  }
  const linhas = eventos.map((e) => {
    const detalhe: string[] = [];
    if (e.fase) detalhe.push(String(e.fase));
    if (e.slug) detalhe.push(String(e.slug));
    if (e.sessionId) detalhe.push(`sessao ${String(e.sessionId).slice(0, 8)}`);
    if (e.decisao) detalhe.push(String(e.decisao));
    if (e.previstaSobre) detalhe.push(`pausa sobre ${String(e.previstaSobre)}`);
    if (e.encontrada !== undefined) detalhe.push(`no runtime: ${e.encontrada ? 'sim' : 'nao'}`);
    // Fato verificavel do despacho: o par modelo/esforco real, lido do proprio evento.
    if (e.model) detalhe.push(`modelo ${String(e.model)}/${String(e.effort ?? '-')}`);
    // Eventos do bloco B1: motivo tipado, veredito e as provas do ship.
    if (e.motivo) detalhe.push(`motivo ${String(e.motivo)}`);
    if (e.claim) detalhe.push(`claim ${String(e.claim)}`);
    if (e.veredito) detalhe.push(`veredito: ${String(e.veredito)}`);
    if (e.fonte && e.ocupacao !== undefined) {
      detalhe.push(`ocupacao ${e.ocupacao === null ? 'nao medivel' : String(e.ocupacao)} (${String(e.fonte)})`);
    }
    if (e.slugSugerido) detalhe.push(`proximo slug ${String(e.slugSugerido)}`);
    if (e.lease) detalhe.push(`lease ${String(e.lease)}`);
    // Eventos do bloco B3: acao de retry, playbook da retomada e rodada de GO-FIX.
    if (e.acao) detalhe.push(`acao ${String(e.acao)}`);
    if (e.playbook) detalhe.push(`playbook ${String(e.playbook)}`);
    if (e.pedido) detalhe.push(`pedido ${String(e.pedido)}`);
    if (e.rodada !== undefined) detalhe.push(`rodada ${String(e.rodada)}`);
    if (e.cobertura) detalhe.push(`cobertura ${String(e.cobertura)}`);
    if (e.liberaEm) detalhe.push(`libera em ${formatarDataHora(String(e.liberaEm))}`);
    if (e.tentativa !== undefined && e.limite !== undefined) {
      detalhe.push(`tentativa ${String(e.tentativa)}/${String(e.limite)}`);
    }
    if (e.mergeSha) detalhe.push(`merge ${String(e.mergeSha).slice(0, 8)}`);
    if (e.shaRemoto) detalhe.push(`remoto ${String(e.shaRemoto).slice(0, 8)}`);
    if (e.pushVerificado !== undefined) detalhe.push(`push provado: ${e.pushVerificado ? 'sim' : 'nao'}`);
    if (e.autorizadoPor) detalhe.push(`autorizado por ${String(e.autorizadoPor)}`);
    if (e.sobre) detalhe.push(`sobre ${String(e.sobre)}`);
    if (e.estado) detalhe.push(String(e.estado));
    if (typeof e.de === 'string' && typeof e.para === 'string') {
      detalhe.push(`${e.de} -> ${e.para}`);
    }
    if (e.dryRun === true) detalhe.push('ensaio (--dry-run)');
    if (e.tipo === TIPOS_DE_EVENTO.worktreeCriada && e.dir) {
      detalhe.push(`${String(e.branch)} em ${String(e.dir)}`);
    }
    if (e.inline !== undefined) {
      detalhe.push(`triagem ${String(e.inline)} inline / ${String(e.pointers)} ponteiros / ${String(e.summaries)} resumos`);
    }
    if (e.location) detalhe.push(`ponteiro ${String(e.location)}`);
    if (e.erro) detalhe.push(`erro: ${String(e.erro)}`);
    if (e.detalhe && !e.decisao) detalhe.push(localizarTexto(String(e.detalhe)).slice(0, 90));
    if (e.modo && !e.fase) detalhe.push(`modo ${String(e.modo)}`);
    return [formatarDataHora(e.ts, { segundos: true }), e.tipo, detalhe.join(' | ')];
  });
  return `${tabela(['QUANDO', 'EVENTO', 'DETALHE'], linhas)}\n${legendaDoFuso()}`;
}

/** Slug legivel por humano de uma sessao (usado nas mensagens do CLI). */
export function descreverSlug(slug: string): string {
  const p = parseSlug(slug);
  if (!p) return slug;
  const rot = p.rotacao ? `, rotacao ${p.rotacao}` : '';
  return `produto "${p.produto}", assunto "${p.assunto}", fases "${p.fases}"${rot}`;
}
