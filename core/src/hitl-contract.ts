/** D1: contrato de pedido, independente do host. Expiração nunca autoriza. */
import { MODOS_LEGADOS } from './modos';
import { Fase, FASES, Modo, ModoLegado, MotivoGate } from './types';
import { ErroDoCatalogo, msg } from './locale';

export const CONTRATO_HITL = 'ork.hitl/v1' as const;
export type ProfundidadeHitl = 'resumo' | 'detalhada' | 'profunda';
export interface PedidoHitl {
  contrato: typeof CONTRATO_HITL;
  id: string;
  thread: string;
  fase: Fase;
  /** Leitor: recibo ja assinado em modo aposentado continua valido para sempre. */
  modo: ModoLegado;
  alvo: { tipo: 'gate'; sobre: string } | { tipo: 'session'; sessionId: string; runtime: string };
  motivo: string;
  pergunta: string;
  opcoes: { numero: number; texto: string; acao: 'aprovar' | 'recusar' | 'responder' | 'esperar' }[];
  recomendacao: string;
  criadoEm: string;
  prazo: string;
  acaoPadraoAoExpirar: 'esperar' | 'escalar';
  respostaAceita: { tipo: 'opcao' | 'texto'; maxCaracteres: number };
  profundidade: ProfundidadeHitl;
}

/**
 * D5: a lista FECHADA de atos que nao se desfazem. Ela mora no nucleo, congelada, e nao no
 * manifesto: `owner.timezone` pode ser configuracao, "nao gaste meu dinheiro sozinho" nao pode.
 * Uma lista de seguranca que a configuracao do projeto afrouxa deixa de ser seguranca.
 */
export const ATOS_IRREVERSIVEIS = ['dinheiro', 'publicacao-externa', 'apagar-dado', 'push-base-protegida'] as const;
export type AtoIrreversivel = typeof ATOS_IRREVERSIVEIS[number];

/**
 * D16: qual ato irreversivel um motivo tipado autoriza. O mapa e PARCIAL de proposito. A maioria
 * dos motivos nao autoriza ato nenhum, e inventar um ato para cada motivo transformaria a lista
 * congelada em decoracao. Sob `ork.hitl/v2` a fonte autoritativa passa a ser o proprio pedido,
 * que declara qual dos quatro; este mapa e o que responde por um pedido `ork.hitl/v1`, que nao
 * tem onde declarar. Ausencia aqui significa "nao se sabe que seja irreversivel", nunca
 * "reversivel provado": e por isso que ele nunca libera nada, so acende a marca de critico.
 */
export const ATO_IRREVERSIVEL_DO_MOTIVO: Readonly<Partial<Record<MotivoGate, AtoIrreversivel>>> =
  Object.freeze({ 'cost.violation': 'dinheiro' } as Partial<Record<MotivoGate, AtoIrreversivel>>);

/**
 * I-41 (GO-FIX 1, A1): o ato que APROVAR uma pausa autoriza, lido do que a pausa declara.
 *
 * Ate aqui `criticos` era zero por construcao: o mapa por motivo tem uma entrada so, e nenhum
 * emissor declarava ato. Mas a pausa ja diz sobre o que ela e, e isso e dado do nucleo
 * (`modos.ts`), nao texto do agente. A pausa do `#Classic` sobre "evidencias, com autorizacao
 * antecipada de push" e a do `#Look` e do `#Ork` sobre "push" liberam o push na base protegida:
 * o SHIP le exatamente essa aprovacao como autorizacao (`autorizacaoDePush`). Aprovar uma delas
 * e ato sem volta, e o resumo precisa dizer isso em vez de mostrar zero.
 */
export function atoDaPausa(motivo: string, pausaSobre: string): AtoIrreversivel | undefined {
  const doMotivo = ATO_IRREVERSIVEL_DO_MOTIVO[motivo as MotivoGate];
  if (doMotivo) return doMotivo;
  return motivo === 'human.pending' && /\bpush\b/i.test(pausaSobre) ? 'push-base-protegida' : undefined;
}

export interface VereditoGate {
  fase: Fase;
  sobre: string;
  estado: 'aprovado' | 'recusado' | 'aguardando';
  opcao: number | null;
}

const identificador = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v);
const texto = (v: unknown, limite: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= limite && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace('.000Z', 'Z') === v.replace('.000Z', 'Z');

/**
 * Profundidade derivada do modo do pedido.
 *
 * I-43 alargou SO a assinatura, de `Modo` para `ModoLegado`, e nao encostou no corpo:
 * um pedido `ork.hitl/v1` gravado com `modo: look` precisa continuar devolvendo
 * `profunda`, senao o recibo historico deixa de bater com o que ele diz.
 *
 * COSTURA COM A I-41: e a I-41 que torna a profundidade propriedade do PEDIDO, e e
 * esta funcao inteira que ela substitui. O mapa abaixo fica intacto de proposito, para
 * que o merge das duas threads nao escolha um mapa e perca o outro em silencio; quando
 * a I-41 chegar, ele vira o fallback de leitura de recibo antigo.
 */
export function profundidadeDoModo(modo: ModoLegado): ProfundidadeHitl {
  return modo === 'look' ? 'profunda' : modo === 'classic' || modo === 'ork' ? 'detalhada' : 'resumo';
}

/**
 * D1/T6: a profundidade com que um pedido NASCE.
 *
 * Sob `ork.hitl/v2` ela e escolha do PEDIDO e vale nos cinco modos: `profundidadeDoModo` continua
 * sendo o default sugerido, nao mais criterio de validacao. GOAL e PLAN sobem para `profunda`
 * porque e ali que se decide premissa, e premissa sem artefato e sem diff e decidida no escuro.
 * Em 20/09 um pedido de PLAN sobre premissas saiu em `resumo` (sem artefato, sem diff) porque o
 * modo mandava; o modo nao sabe sobre o que se esta perguntando, a fase sabe.
 *
 * Isto governa somente o BLOCO DE EVIDENCIA. A pergunta, as alternativas, as consequencias e a
 * recomendada saem identicas nas tres profundidades.
 */
export function profundidadeDoPedido(fase: Fase, modo: ModoLegado): ProfundidadeHitl {
  return fase === 'GOAL' || fase === 'PLAN' ? 'profunda' : profundidadeDoModo(modo);
}

/**
 * D1: o validador de `ork.hitl/v1`, CONGELADO.
 *
 * Ele e o que era `validarPedidoHitl` ate a I-41, movido sem alterar uma regra, e continua sendo
 * a unica coisa que julga um pedido v1. Tres recibos v1 estao gravados em disco e pode haver
 * pedido em voo; um validador compartilhado faria qualquer aperto futuro em v2 mudar o
 * comportamento sobre eles. Congelar v1 em funcao propria e o que torna a promessa "v1 lido para
 * sempre" verificavel por diff, e nao por intencao.
 *
 * Erros não ecoam o conteúdo recebido, que pode conter credencial.
 */
export function validarPedidoHitlV1(v: unknown): asserts v is PedidoHitl {
  if (!objeto(v) || v.contrato !== CONTRATO_HITL || !identificador(v.id) || !identificador(v.thread) ||
      !FASES.includes(v.fase as Fase) || !(MODOS_LEGADOS as readonly string[]).includes(v.modo as string) ||
      !texto(v.motivo, 100) || !texto(v.pergunta, 2000) || !texto(v.recomendacao, 1000)) {
    throw new Error('pedido HITL: identificação, modo ou pergunta inválidos');
  }
  if (!iso(v.criadoEm) || !iso(v.prazo) || Date.parse(v.prazo) <= Date.parse(v.criadoEm) ||
      !['esperar', 'escalar'].includes(v.acaoPadraoAoExpirar as string)) {
    throw new Error('pedido HITL: prazo ou ação de expiração inválidos');
  }
  const alvo = v.alvo;
  if (!objeto(alvo) || !(alvo.tipo === 'gate' && texto(alvo.sobre, 100) ||
      alvo.tipo === 'session' && identificador(alvo.sessionId) && ['claude-bg', 'codex'].includes(alvo.runtime as string))) {
    throw new Error('pedido HITL: alvo inválido');
  }
  const aceita = v.respostaAceita;
  if (!objeto(aceita) || !['opcao', 'texto'].includes(aceita.tipo as string) ||
      !Number.isInteger(aceita.maxCaracteres) || Number(aceita.maxCaracteres) < 1 || Number(aceita.maxCaracteres) > 4096 ||
      alvo.tipo === 'gate' && aceita.tipo !== 'opcao') throw new Error('pedido HITL: resposta aceita inválida');
  if (!Array.isArray(v.opcoes) || v.opcoes.length > 12 || (aceita.tipo === 'opcao' && v.opcoes.length < 1) ||
      v.opcoes.some((o, i) => !objeto(o) || o.numero !== i + 1 || !texto(o.texto, 200) ||
        !['aprovar', 'recusar', 'responder', 'esperar'].includes(o.acao as string))) {
    throw new Error('pedido HITL: opções devem ser numeradas, consecutivas e explícitas');
  }
  if (v.profundidade !== profundidadeDoModo(v.modo as ModoLegado)) throw new Error('pedido HITL: profundidade incompatível com o modo');
}

export function estadoDoPedido(pedido: PedidoHitlQualquer, quando = new Date().toISOString()): 'aberto' | AcaoAoExpirar {
  validarPedidoHitl(pedido);
  if (!iso(quando)) throw new Error('instante de consulta HITL inválido');
  if (Date.parse(quando) < Date.parse(pedido.criadoEm)) throw new Error('pedido HITL ainda não criado');
  const prazo = prazoDoPedido(pedido), expiracao = expiracaoDoPedido(pedido);
  // Fato consumado não tem relógio: ele não expira, não escala e não avança.
  if (prazo === undefined || expiracao === undefined) return 'aberto';
  return Date.parse(quando) >= Date.parse(prazo) ? expiracao : 'aberto';
}

/** A forma de resposta que o pedido aceita. `decidido` não aceita nenhuma. */
export function respostaAceitaDoPedido(p: PedidoHitlQualquer): PedidoHitl['respostaAceita'] | undefined {
  return ehV2(p) ? (p.classe === 'pergunta' ? p.respostaAceita : undefined) : p.respostaAceita;
}

export function validarRespostaHitl(pedido: PedidoHitlQualquer, resposta: unknown, quando?: string): PedidoHitl['opcoes'][number] | null {
  if (estadoDoPedido(pedido, quando) !== 'aberto') throw new Error('pedido HITL expirado; nenhuma autorização concedida');
  const aceita = respostaAceitaDoPedido(pedido);
  // Responder a um fato consumado não é recusa de conteúdo: é não haver o que responder.
  if (!aceita) throw new Error('decisão informada não aceita resposta');
  if (!texto(resposta, aceita.maxCaracteres)) throw new Error('resposta HITL inválida');
  if (aceita.tipo === 'texto') return null;
  const digitado = resposta.trim().toLowerCase();
  const escolhas = escolhasDoPedido(pedido);
  // No v2 o dono digita a LETRA; o número continua aceito porque recusá-lo não protege nada e
  // quem lê a mensagem antiga do terminal digitaria o número sem saber que mudou.
  const opcao = escolhas.find((o, i) =>
    chaveDaEscolha(pedido, i + 1).toLowerCase() === digitado || String(o.numero) === digitado);
  if (!opcao) throw new Error('resposta HITL deve escolher uma opção explícita');
  return opcao;
}

/** Deriva todos os campos da decisão que podem alimentar memória humana. */
export function vereditoDoGate(pedido: PedidoHitlQualquer, opcao: PedidoHitl['opcoes'][number] | null): VereditoGate {
  validarPedidoHitl(pedido);
  const alvo = alvoDoPedido(pedido);
  if (!alvo) throw new Error('decisão informada não tem gate: ela não pede nada');
  if (alvo.tipo !== 'gate') throw new Error('pedido destina-se à sessão, não ao gate');
  const motivo = ehV2(pedido) ? (pedido.classe === 'pergunta' ? pedido.motivo : '') : pedido.motivo;
  return {
    fase: pedido.fase,
    sobre: alvo.sobre,
    estado: opcao?.acao === 'aprovar' && motivo === 'human.pending'
      ? 'aprovado' : opcao?.acao === 'recusar' ? 'recusado' : 'aguardando',
    opcao: opcao?.numero ?? null,
  };
}

// ---------------------------------------------------------------------------
// I-41 (D1): `ork.hitl/v2`. v1 continua sendo LIDO para sempre; v2 e o que passa a ser ESCRITO.
//
// O caminho e este e nao "v1 com campos opcionais" porque campo opcional que todo mundo precisa
// preencher e ambiguidade que vira bug: nove arquivos de teste constroem pedido literal e nenhum
// deles saberia quais opcionais sao obrigatorios na pratica.
//
// A uniao e discriminada por `classe`, e a diferenca entre as duas nao e de grau:
//
//   `decidido` e fato consumado. Nao tem prazo, nao tem identificador para colar, nao tem
//   caminho de resposta, e nao segura fase nenhuma. Trazer campo de gate e RECUSA.
//   `pergunta` e o unico que pode segurar, e o unico que o dono precisa responder.
// ---------------------------------------------------------------------------

export const CONTRATO_HITL_V2 = 'ork.hitl/v2' as const;

export type ClasseHitl = 'decidido' | 'pergunta';
export type LetraDeAlternativa = 'a' | 'b' | 'c' | 'd' | 'e';
/** RM-057: ate cinco alternativas, de a a e. A leitura aceita as de duas do historico. */
export const LETRAS_DE_ALTERNATIVA: readonly LetraDeAlternativa[] = ['a', 'b', 'c', 'd', 'e'];
export type TipoDeResposta = 'objetiva' | 'aberta';

/**
 * De onde sai o criterio que sustenta uma decisao informada (D2).
 *
 * `manifesto` e `ledger` o nucleo RESOLVE de verdade: le a chave ou o evento e confere que
 * existe. `medicao` o nucleo so confere na FORMA, porque executar o comando durante a validacao
 * transformaria abrir um pedido em executar comando arbitrario, e `registrarPedidoHitl` roda sob
 * lock: comando lento travaria a thread inteira. O buraco fica dito aqui e fechado no CHECK, que
 * executa os comandos citados. A validacao impede citar NADA; o CHECK impede citar MENTIRA.
 */
export type TipoDeCriterio = 'manifesto' | 'ledger' | 'medicao';

/** D5: `seguir-recomendada` e o valor que AVANCA. Ato irreversivel nunca o aceita. */
export type AcaoAoExpirar = 'esperar' | 'escalar' | 'seguir-recomendada';

/** D13: tetos com origem na maior medida ja gravada nos catorze pedidos do historico. */
export const TETOS_HITL_V2 = Object.freeze({
  pergunta: 200, alternativaTexto: 140, consequencia: 140, porque: 140,
  corpoLinha: 200, corpoLinhas: 8, campoDaDecisao: 200, custo: 140, traducao: 120,
});

export interface AlternativaHitlV2 {
  letra: LetraDeAlternativa;
  texto: string;
  /**
   * O que a escolha EXECUTA. E o par de maquina da `consequencia`, que e o par humano.
   *
   * Sem ele o gate nao consegue virar veredito, e `vereditoDoGate` e o que `retry` e `ship` leem
   * para saber se o dono aprovou. Alternativa que nao diz o que faz nao da para executar.
   */
  acao: 'aprovar' | 'recusar' | 'responder' | 'esperar';
  /** O que acontece se escolher, em uma linha. Alternativa sem ela e escolha no escuro. */
  consequencia: string;
  /** Exatamente UMA alternativa do pedido traz isto, e quem traz precisa dizer o porque. */
  recomendada?: true;
  porque?: string;
}

interface ComumV2 {
  contrato: typeof CONTRATO_HITL_V2;
  id: string;
  thread: string;
  fase: Fase;
  modo: Modo;
  criadoEm: string;
  /** D1/T6: escolha do PEDIDO, valida nos cinco modos. Governa so o bloco de evidencia. */
  profundidade: ProfundidadeHitl;
}

/** Fato consumado. Chega ao dono para ele saber, nunca para ele agir. */
export interface DecisaoInformada extends ComumV2 {
  classe: 'decidido';
  /** O que foi decidido, pelo efeito no produto. */
  decidido: string;
  /** O porque, em uma linha. */
  porque: string;
  /** Como mudar, se ele quiser mudar. */
  comoMudar: string;
  /** Quanto custa reverter AGORA contra DEPOIS. Sem os dois lados, "voce pode ajustar" e mentira. */
  custoDeReverter: { agora: string; depois: string };
  /** O criterio ja escrito que sustenta a escolha. Sem ele, a decisao nao existe. */
  criterio: { tipo: TipoDeCriterio; referencia: string };
}

/** O unico item que pode segurar uma fase. */
export interface PerguntaAoDono extends ComumV2 {
  classe: 'pergunta';
  alvo: PedidoHitl['alvo'];
  motivo: string;
  /** Uma frase, sem quebra de linha e sem paragrafo. */
  pergunta: string;
  alternativas: AlternativaHitlV2[];
  /** Corpo topificado: lista de linhas, nunca prosa corrida. */
  corpo: string[];
  tipoDeResposta: TipoDeResposta;
  irreversivel: boolean;
  /** Qual dos atos congelados, quando `irreversivel`. */
  ato?: AtoIrreversivel;
  /** O codigo curto que o dono digita. O identificador longo continua em `id`. */
  codigo: string;
  prazo: string;
  acaoPadraoAoExpirar: AcaoAoExpirar;
  respostaAceita: { tipo: 'opcao' | 'texto'; maxCaracteres: number };
  /**
   * RM-057: a unica porta para pedir texto ao dono. So existe quando a fabrica nao consegue seguir
   * sozinha com os runtimes que tem e o dono precisa rodar um comando no terminal (um login
   * interativo, por exemplo). Traz o comando exato, pronto para copiar, e o porque em uma linha.
   */
  dependenciaTecnica?: DependenciaTecnica;
}

export interface DependenciaTecnica {
  comando: string;
  porque: string;
}

export type PedidoHitlV2 = DecisaoInformada | PerguntaAoDono;
/** O que um leitor que aceita as duas versoes recebe. */
export type PedidoHitlQualquer = PedidoHitl | PedidoHitlV2;

/** Campos de gate que um `decidido` NAO pode trazer. Trazer qualquer um e recusa. */
export const CAMPOS_DE_GATE = ['prazo', 'acaoPadraoAoExpirar', 'respostaAceita', 'opcoes', 'alternativas', 'codigo'] as const;

const linhaUnica = (v: unknown, limite: number): v is string =>
  texto(v, limite) && !/[\r\n]/.test(v as string);

function validarComumV2(v: Record<string, unknown>): void {
  if (!identificador(v.id) || !identificador(v.thread) || !FASES.includes(v.fase as Fase) ||
      !(MODOS_LEGADOS as readonly string[]).includes(v.modo as string) || !iso(v.criadoEm) ||
      !['resumo', 'detalhada', 'profunda'].includes(v.profundidade as string)) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoComumInvalido);
  }
}

/**
 * RM-037 (rm037defeito, defeito 4): o que esta errado num campo de linha unica, ou null. A recusa diz
 * o campo e o motivo real: texto presente e acima do teto respondia "exige o que foi decidido", e quem
 * mandou os tres campos nao tinha como saber que o problema era o tamanho.
 */
function problemaDaLinha(campo: string, v: unknown, teto: number): { ausente: boolean; texto: string } | null {
  const m = msg().decisao;
  if (typeof v !== 'string' || !v.trim()) return { ausente: true, texto: m.linhaFalta(campo) };
  if (/[\r\n]/.test(v)) return { ausente: false, texto: m.linhaQuebrada(campo) };
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(v)) return { ausente: false, texto: m.linhaControle(campo) };
  if (v.length > teto) return { ausente: false, texto: m.linhaLonga(campo, v.length, teto) };
  return null;
}

/**
 * Os campos da decisao informada como cada superficie os mostra (achado S4 do CHECK): a recusa do contrato
 * usa o nome interno, e quem digitou `--como-mudar` ou mandou `custoAgora` precisa ler o nome que usou.
 */
export const CAMPOS_DA_DECISAO_NO_CLI: Readonly<Record<string, string>> = Object.freeze({
  decidido: '--decidido', porque: '--porque', comoMudar: '--como-mudar', 'custoDeReverter.agora': '--custo-agora',
  'custoDeReverter.depois': '--custo-depois', 'criterio.referencia': '--criterio',
});
export const CAMPOS_DA_DECISAO_NO_MCP: Readonly<Record<string, string>> = Object.freeze({
  decidido: 'decidido', porque: 'porque', comoMudar: 'comoMudar', 'custoDeReverter.agora': 'custoAgora',
  'custoDeReverter.depois': 'custoDepois', 'criterio.referencia': 'criterio.referencia',
});

/** Troca o nome interno do campo, onde a recusa o cita, pelo nome da superficie. */
export function recusaNaSuperficie(mensagem: string, nomes: Readonly<Record<string, string>>): string {
  return mensagem.replace(/(falta |missing |: )(decidido|porque|comoMudar|custoDeReverter\.agora|custoDeReverter\.depois|criterio\.referencia)(?=\)| tem | has )/g,
    (_, antes: string, campo: string) => `${antes}${nomes[campo] ?? campo}`);
}

function validarDecidido(v: Record<string, unknown>): void {
  for (const campo of CAMPOS_DE_GATE) {
    if (v[campo] !== undefined) throw new ErroDoCatalogo((m) => m.decisao.contratoCampoDeGate(campo));
  }
  for (const campo of ['decidido', 'porque', 'comoMudar'] as const) {
    const problema = problemaDaLinha(campo, v[campo], TETOS_HITL_V2.campoDaDecisao);
    if (problema?.ausente) throw new ErroDoCatalogo((m) => m.decisao.contratoCamposObrigatorios(problema.texto));
    if (problema) throw new ErroDoCatalogo((m) => m.decisao.contratoCampoInvalido(problema.texto));
  }
  const custo = v.custoDeReverter;
  const problemasDoCusto = (['agora', 'depois'] as const)
    .map(lado => problemaDaLinha(`custoDeReverter.${lado}`, objeto(custo) ? custo[lado] : undefined, TETOS_HITL_V2.custo));
  if (problemasDoCusto.some(p => p?.ausente)) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoCustoObrigatorio);
  }
  const doCusto = problemasDoCusto.find(p => p !== null);
  if (doCusto) throw new ErroDoCatalogo((m) => m.decisao.contratoCustoInvalido(doCusto.texto));
  const criterio = v.criterio;
  const daReferencia = objeto(criterio) ? problemaDaLinha('criterio.referencia', criterio.referencia, 300) : null;
  if (!objeto(criterio) || !['manifesto', 'ledger', 'medicao'].includes(criterio.tipo as string) || daReferencia?.ausente) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoCriterioObrigatorio);
  }
  if (daReferencia) throw new ErroDoCatalogo((m) => m.decisao.contratoCriterioInvalido(daReferencia.texto));
  // R1, porta fechada: ato irreversivel nunca se qualifica como decisao informada.
  if (v.irreversivel === true) throw new ErroDoCatalogo((m) => m.decisao.contratoIrreversivel);
}

function validarAlternativas(v: Record<string, unknown>): void {
  const alternativas = v.alternativas;
  if (!Array.isArray(alternativas) || alternativas.length < 2 || alternativas.length > LETRAS_DE_ALTERNATIVA.length) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoAlternativas);
  }
  let recomendadas = 0;
  alternativas.forEach((bruta, i) => {
    if (!objeto(bruta) || bruta.letra !== LETRAS_DE_ALTERNATIVA[i]) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoAlternativas);
    }
    if (!linhaUnica(bruta.texto, TETOS_HITL_V2.alternativaTexto)) throw new ErroDoCatalogo((m) => m.decisao.contratoAlternativaSemTexto);
    if (!['aprovar', 'recusar', 'responder', 'esperar'].includes(bruta.acao as string)) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoAlternativaSemAcao);
    }
    if (!linhaUnica(bruta.consequencia, TETOS_HITL_V2.consequencia)) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoAlternativaSemConsequencia);
    }
    if (bruta.recomendada === undefined) {
      if (bruta.porque !== undefined) throw new ErroDoCatalogo((m) => m.decisao.contratoPorqueSoRecomendada);
      return;
    }
    if (bruta.recomendada !== true) throw new ErroDoCatalogo((m) => m.decisao.contratoRecomendadaBoolean);
    if (!linhaUnica(bruta.porque, TETOS_HITL_V2.porque)) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoRecomendadaSemPorque);
    }
    recomendadas++;
  });
  if (recomendadas !== 1) throw new ErroDoCatalogo((m) => m.decisao.contratoUmaRecomendada);
}

function validarPergunta(v: Record<string, unknown>): void {
  if (!linhaUnica(v.pergunta, TETOS_HITL_V2.pergunta)) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoPerguntaFrase);
  }
  if (!texto(v.motivo, 100)) throw new ErroDoCatalogo((m) => m.decisao.contratoMotivoInvalido);
  validarAlternativas(v);
  if (!Array.isArray(v.corpo) || v.corpo.length > TETOS_HITL_V2.corpoLinhas ||
      v.corpo.some(l => !linhaUnica(l, TETOS_HITL_V2.corpoLinha))) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoCorpoLinhas);
  }
  if (!['objetiva', 'aberta'].includes(v.tipoDeResposta as string)) throw new ErroDoCatalogo((m) => m.decisao.contratoTipoRespostaInvalido);
  if (!/^[0-9A-Za-z]{3,8}$/.test(String(v.codigo ?? ''))) throw new ErroDoCatalogo((m) => m.decisao.contratoCodigoInvalido);

  const alvo = v.alvo;
  if (!objeto(alvo) || !(alvo.tipo === 'gate' && texto(alvo.sobre, 100) ||
      alvo.tipo === 'session' && identificador(alvo.sessionId) && ['claude-bg', 'codex'].includes(alvo.runtime as string))) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoAlvoInvalido);
  }
  const aceita = v.respostaAceita;
  if (!objeto(aceita) || !['opcao', 'texto'].includes(aceita.tipo as string) ||
      !Number.isInteger(aceita.maxCaracteres) || Number(aceita.maxCaracteres) < 1 || Number(aceita.maxCaracteres) > 4096) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoRespostaInvalida);
  }
  if (!iso(v.prazo) || Date.parse(v.prazo as string) <= Date.parse(v.criadoEm as string) ||
      !['esperar', 'escalar', 'seguir-recomendada'].includes(v.acaoPadraoAoExpirar as string)) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoPrazoInvalido);
  }
  if (v.dependenciaTecnica !== undefined) {
    const d = v.dependenciaTecnica;
    if (!objeto(d) || !linhaUnica(d.comando, TETOS_HITL_V2.campoDaDecisao) || !linhaUnica(d.porque, TETOS_HITL_V2.porque)) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoDependenciaInvalida);
    }
  }
  if (typeof v.irreversivel !== 'boolean') throw new ErroDoCatalogo((m) => m.decisao.contratoIrreversivelAusente);
  if (v.irreversivel) {
    if (!(ATOS_IRREVERSIVEIS as readonly string[]).includes(String(v.ato))) {
      throw new ErroDoCatalogo((m) => m.decisao.contratoAtoIrreversivelInvalido);
    }
    // D5, primeira das quatro barreiras: a combinacao nao chega a existir.
    if (v.acaoPadraoAoExpirar === 'seguir-recomendada') {
      throw new ErroDoCatalogo((m) => m.decisao.contratoIrreversivelExpira);
    }
  } else if (v.ato !== undefined) {
    throw new ErroDoCatalogo((m) => m.decisao.contratoAtoSoIrreversivel);
  }
}

// ---------------------------------------------------------------------------
// RM-057: o HITL de conducao que parte do ork e uma SELECAO.
//
// Na noite de 01 para 02/10/2026 a conducao parou mais de dez horas esperando um "confirmo" em
// texto livre. A regra do dono (02/10) e que todo pedido que o PROPRIO ork abre ao maestro sai com
// de 3 a 5 alternativas, exatamente uma com o selo "Recomendação", e nunca depende de o dono
// escrever ou colar texto. A unica excecao e a dependencia tecnica tipada: o dono roda um comando
// no terminal que a fabrica nao consegue rodar sozinha.
//
// A regra vale na CRIACAO (`registrarPedidoHitl`), nunca na leitura: o ledger guarda pedidos de
// duas alternativas que continuam legiveis para sempre, e a pergunta nativa de uma sessao do host
// (v1) traz as opcoes do host, que nao sao do ork.
// ---------------------------------------------------------------------------

export const MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO = 3;
export const MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO = 5;

/** Os motivos tipados de recusa de um pedido de conducao fora da forma de selecao. */
export type MotivoDeSelecaoRecusada =
  | 'hitl.selecao.versao'
  | 'hitl.selecao.fora-da-faixa'
  | 'hitl.selecao.recomendada'
  | 'hitl.selecao.texto-livre';

export class SelecaoRecusada extends Error {
  constructor(readonly motivo: MotivoDeSelecaoRecusada, detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'SelecaoRecusada';
  }
}

/**
 * RM-057: confere que um pedido que o ork vai ABRIR e uma selecao. Decisao informada (`decidido`)
 * nao pergunta nada e passa. Recusa com motivo tipado, nunca corta nem completa em silencio.
 */
export function exigirSelecaoDeConducao(pedido: PedidoHitlQualquer): void {
  if (!ehV2(pedido)) {
    throw new SelecaoRecusada('hitl.selecao.versao', msg().decisao.selecaoVersao);
  }
  if (pedido.classe === 'decidido') return;
  const n = pedido.alternativas.length;
  if (n < MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO || n > MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO) {
    throw new SelecaoRecusada('hitl.selecao.fora-da-faixa',
      msg().decisao.selecaoFaixa(MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO, MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO, n));
  }
  const recomendadas = pedido.alternativas.filter(a => a.recomendada).length;
  if (recomendadas !== 1) {
    throw new SelecaoRecusada('hitl.selecao.recomendada', msg().decisao.selecaoRecomendada(recomendadas));
  }
  const pedeTexto = pedido.tipoDeResposta === 'aberta' || pedido.respostaAceita.tipo === 'texto';
  if (pedeTexto && !pedido.dependenciaTecnica) {
    throw new SelecaoRecusada('hitl.selecao.texto-livre',
      msg().decisao.selecaoTextoLivre);
  }
}

/** Valida `ork.hitl/v2`. Nunca aceita um v1: quem julga v1 e o validador congelado. */
export function validarPedidoHitlV2(v: unknown): asserts v is PedidoHitlV2 {
  if (!objeto(v) || v.contrato !== CONTRATO_HITL_V2) throw new ErroDoCatalogo((m) => m.decisao.contratoDesconhecido);
  validarComumV2(v);
  if (v.classe === 'decidido') return validarDecidido(v);
  if (v.classe === 'pergunta') return validarPergunta(v);
  throw new ErroDoCatalogo((m) => m.decisao.contratoClasseInvalida);
}

/**
 * O leitor das duas versoes. Despacha por contrato: v1 pelo validador congelado, v2 pelo novo.
 *
 * Os predicados basicos (`texto`, `iso`, `identificador`, `objeto`) sao compartilhados; so as
 * regras de FORMA diferem, que e justamente o que mudou entre as versoes.
 */
export function validarPedidoHitl(v: unknown): asserts v is PedidoHitlQualquer {
  if (objeto(v) && v.contrato === CONTRATO_HITL_V2) return validarPedidoHitlV2(v);
  validarPedidoHitlV1(v);
}

/** `true` para pedido `ork.hitl/v2`, para quem precisa escolher caminho sem repetir a string. */
export function ehV2(p: PedidoHitlQualquer): p is PedidoHitlV2 {
  return p.contrato === CONTRATO_HITL_V2;
}

/**
 * D2: o teste de "óbvia", no NUCLEO e nao no julgamento do agente.
 *
 * Decide-se e informa-se so quando as QUATRO sao verdadeiras. Falhou uma, e `pergunta`. A funcao
 * e pura e devolve o motivo junto com a classe, porque "foi obvia" sem motivo e a mesma coisa que
 * decidir em silencio com uma palavra bonita na frente.
 *
 * O maior risco desta thread e "obvia" virar desculpa para decidir tudo sozinho, e ele nao se
 * resolve com boa intencao: aqui a escolha deixa de ser opiniao e passa a ser ponteiro para algo
 * escrito. Um criterio ausente e um criterio que aponta para nada valem a mesma coisa.
 */
export interface SinaisDaDecisao {
  /** (a) o critério já escrito que sustenta a escolha. Ausente é causa de `pergunta`. */
  criterio?: { tipo: TipoDeCriterio; referencia: string };
  /** (b) as alternativas são estritamente piores POR ESSE critério. */
  alternativasEstritamentePiores: boolean;
  /** (c) dá para desfazer antes da entrega. */
  reversivelAntesDaEntrega: boolean;
  /** (d) errar sai barato E o erro aparece. Barato mas invisível não conta. */
  erroBaratoEDetectavel: boolean;
  /** Ato da lista congelada. Fecha a porta antes das quatro condições. */
  irreversivel?: boolean;
  /** Gasta dinheiro. */
  gastaDinheiro?: boolean;
  /** Muda escopo ou produto: aí a decisão é do dono, por mais óbvia que pareça. */
  mudaEscopoOuProduto?: boolean;
}

export interface ResultadoDaClassificacao {
  classe: ClasseHitl;
  /** Uma linha: por que decidiu sozinho, ou qual das condições falhou. */
  motivo: string;
}

export function classificarDecisao(sinais: SinaisDaDecisao): ResultadoDaClassificacao {
  const pergunta = (motivo: string): ResultadoDaClassificacao => ({ classe: 'pergunta', motivo });
  // As portas fechadas vêm primeiro: nenhuma quantidade de evidência as abre.
  if (sinais.irreversivel) return pergunta('o ato é irreversível');
  if (sinais.gastaDinheiro) return pergunta('o ato gasta dinheiro');
  if (sinais.mudaEscopoOuProduto) return pergunta('o ato muda escopo ou produto');
  // Depois as quatro condições, na ordem em que o GOAL as escreveu.
  const referencia = sinais.criterio?.referencia;
  if (!sinais.criterio || typeof referencia !== 'string' || !referencia.trim()) {
    return pergunta('não há critério escrito que sustente a escolha');
  }
  if (!sinais.alternativasEstritamentePiores) return pergunta('as alternativas não são estritamente piores pelo critério');
  if (!sinais.reversivelAntesDaEntrega) return pergunta('não dá para desfazer antes da entrega');
  if (!sinais.erroBaratoEDetectavel) return pergunta('errar não sai barato, ou o erro não apareceria');
  return { classe: 'decidido', motivo: `as quatro condições valem, pelo critério ${sinais.criterio.tipo}` };
}

/**
 * D10: a recusa de FORMA do contrato v2 vira o motivo tipado `hitl.formato`.
 *
 * Ela existe para que quem emite um pedido malformado receba um motivo do catalogo, e nao uma
 * string solta. `hitl.formato` tem politica de retry propria: `corrigir-dirigido` e automatica,
 * porque o defeito e de quem escreveu o pedido. Escalar formato para o dono seria pedir que ele
 * revise a sintaxe do robo.
 *
 * Recusa que nao e de forma (por exemplo contrato desconhecido) devolve `null`: inventar
 * `hitl.formato` para tudo tornaria o motivo tao generico quanto a string que ele substitui.
 */
export function motivoDaRecusaDeFormato(erro: unknown): MotivoGate | null {
  // RM-061 F3c: a recusa do catalogo e classificada pelo texto pt-BR, a fonte, em qualquer lingua de quem a leu.
  const mensagem = erro instanceof ErroDoCatalogo ? erro.montar(msg('pt-BR')) : erro instanceof Error ? erro.message : String(erro);
  return mensagem.startsWith('pedido HITL v2: ') && !mensagem.includes('contrato inválido')
    ? 'hitl.formato' : null;
}

// ---------------------------------------------------------------------------
// I-41 (T4): a leitura COMUM as duas versoes.
//
// Quem consome um pedido (apresentacao, pulse, gate, sessao) nao deveria precisar saber qual
// contrato ele usa. Estas funcoes dao a visao uniforme, e por isso `validarRespostaHitl` e
// `vereditoDoGate` seguem com a mesma assinatura de antes: o que muda e o que elas aceitam.
// ---------------------------------------------------------------------------

/** As escolhas do pedido na forma que o resto do nucleo ja consome. `decidido` nao tem nenhuma. */
export function escolhasDoPedido(p: PedidoHitlQualquer): PedidoHitl['opcoes'] {
  if (!ehV2(p)) return p.opcoes;
  if (p.classe === 'decidido') return [];
  return p.alternativas.map((a, i) => ({ numero: i + 1, texto: a.texto, acao: a.acao }));
}

/**
 * O que o dono DIGITA para escolher a n-esima alternativa (1-based).
 *
 * No v1 e o numero; no v2 e a letra. E esta a unica diferenca que o humano percebe entre as
 * duas versoes, e ela existe porque letra dentro de um lote e o que o ponto (9) pede.
 */
export function chaveDaEscolha(p: PedidoHitlQualquer, numero: number): string {
  return ehV2(p) ? (LETRAS_DE_ALTERNATIVA[numero - 1] ?? String(numero)) : String(numero);
}

/** O prazo do pedido, ou `undefined` quando ele nao tem um. Fato consumado nao tem prazo. */
export function prazoDoPedido(p: PedidoHitlQualquer): string | undefined {
  return ehV2(p) ? (p.classe === 'pergunta' ? p.prazo : undefined) : p.prazo;
}

/** A acao ao expirar, ou `undefined` quando o pedido nao expira. */
export function expiracaoDoPedido(p: PedidoHitlQualquer): AcaoAoExpirar | undefined {
  return ehV2(p) ? (p.classe === 'pergunta' ? p.acaoPadraoAoExpirar : undefined) : p.acaoPadraoAoExpirar;
}

/** O alvo do pedido, ou `undefined` para `decidido`, que nao se dirige a gate nem a sessao. */
export function alvoDoPedido(p: PedidoHitlQualquer): PedidoHitl['alvo'] | undefined {
  return ehV2(p) ? (p.classe === 'pergunta' ? p.alvo : undefined) : p.alvo;
}

/** A frase que o dono le. Para `decidido`, o que foi decidido; para `pergunta`, a pergunta. */
export function textoDoPedido(p: PedidoHitlQualquer): string {
  return ehV2(p) ? (p.classe === 'decidido' ? p.decidido : p.pergunta) : p.pergunta;
}

/**
 * Tudo que o dono pode digitar para escolher a n-esima alternativa (1-based).
 *
 * No v1 e so o numero. No v2 e a letra E o numero: recusar o numero nao protege nada, e quem le
 * uma mensagem antiga do terminal digitaria o numero sem saber que a forma mudou. Quem confere
 * recibo precisa da lista inteira, senao uma resposta legitima deixaria de bater com o pedido.
 */
export function chavesAceitas(p: PedidoHitlQualquer, numero: number): string[] {
  const chave = chaveDaEscolha(p, numero);
  return chave === String(numero) ? [chave] : [chave, String(numero)];
}

/**
 * A recomendacao em texto, nas duas versoes.
 *
 * No v1 e o campo livre `recomendacao`, que e justamente o que esta thread conserta. No v2 ela e
 * DERIVADA da alternativa marcada: o texto dela mais o porque em uma linha. Derivar em vez de
 * guardar um campo livre e o que impede a recomendacao de voltar a nao apontar alternativa
 * nenhuma, como "Confira artefatos, claims e riscos antes de responder." nao apontava.
 */
export function recomendacaoDoPedido(p: PedidoHitlQualquer): string {
  if (!ehV2(p)) return p.recomendacao;
  if (p.classe === 'decidido') return p.porque;
  const escolhida = p.alternativas.find(a => a.recomendada);
  return escolhida ? `${escolhida.letra}) ${escolhida.texto}: ${escolhida.porque ?? ''}`.trim() : '';
}

/** O motivo tipado do pedido, ou string vazia para `decidido`, que nao tem gate. */
/**
 * Os contratos que um recibo de pedido pode carregar, e SO eles.
 *
 * Um evento `human_gate` copia o contrato do pedido que respondeu. Quem confere autoria precisa
 * aceitar as duas versoes, senao uma aprovacao legitima sob v2 vira autoria ambigua e o dono
 * deixa de conseguir liberar a propria fase. Aceitar por lista fechada, e nao por prefixo, e o
 * que mantem contrato desconhecido recusado: a promessa e ler v1 para sempre, nao ler qualquer
 * coisa que comece com "ork.hitl".
 */
export const CONTRATOS_DE_PEDIDO = [CONTRATO_HITL, CONTRATO_HITL_V2] as const;
export function ehContratoDePedido(v: unknown): v is typeof CONTRATOS_DE_PEDIDO[number] {
  return (CONTRATOS_DE_PEDIDO as readonly unknown[]).includes(v);
}

export function motivoDoPedido(p: PedidoHitlQualquer): string {
  return ehV2(p) ? (p.classe === 'pergunta' ? p.motivo : '') : p.motivo;
}
