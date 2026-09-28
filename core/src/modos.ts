/**
 * Modos de conducao por #TAG (guia: docs/guias/modos.md).
 *
 * Regra central, nao negociavel: o modo afrouxa a PAUSA, nunca a VERIFICACAO.
 * Claims, verify, policies e gates tipados rodam identicos em todos os modos;
 * o que muda e se o veredito espera o humano ou segue sozinho com registro no ledger.
 */

import { BlocoDeLoop, DIGITO_DA_FASE, DefinicaoDeModo, Fase, FASES, Modo, ModoAposentado, ModoLegado } from './types';

/** Invariantes que valem em TODOS os modos, inclusive `#Auto`. */
export const INVARIANTES: readonly string[] = [
  'Claims, verify e policies rodam identicos em todos os modos.',
  'Policy `block` pausa qualquer modo, inclusive #Auto.',
  'Escalacao tipada para humano pausa qualquer modo, inclusive #Auto.',
  'Toda entrega fecha com indice derivado do ledger; a nota humana, quando vier, sobrescreve.',
  'Toda decisao autonoma vai ao ledger com quem decidiu, evidencia e razao.',
];

/** Monta a parte 3 do slug para um conjunto de fases (visao, secao 3.4). */
export function slugDasFases(fases: Fase[]): string {
  if (fases.length === 0) throw new Error('bloco de loop sem fases');
  if (fases.length === FASES.length) return 'full';
  if (fases.length === 1) return fases[0].toLowerCase();
  return 'f' + fases.map((f) => DIGITO_DA_FASE[f]).join('');
}

function bloco(fases: Fase[], pausaSobre: string): BlocoDeLoop {
  return {
    fases,
    pausa: pausaSobre.length > 0,
    pausaSobre,
    slugFases: slugDasFases(fases),
  };
}

const SEM_PAUSA = '';

/**
 * A matriz dos modos, do mais HITL ao mais autonomo.
 *
 * I-43: ela guarda tambem os aposentados, de proposito. Quem encolhe e
 * `ORDEM_DOS_MODOS`, que alimenta todo ESCRITOR. Se `look` saisse daqui,
 * `tagDoModo` devolveria `#?look` para a thread `ork-smokeb0` de 02/09 e o
 * board passaria a mostrar lixo no lugar da tag de uma thread que existe.
 */
export const MODOS: Readonly<Record<ModoLegado, DefinicaoDeModo>> = {
  look: {
    modo: 'look',
    tag: '#Look',
    blocos: [
      bloco(['GOAL'], 'objetivo'),
      bloco(['PLAN'], 'plano'),
      bloco(['GO'], 'implementacao'),
      bloco(['CHECK'], 'evidencias'),
      bloco(['SHIP'], 'push'),
      bloco(['MASTER'], 'score'),
    ],
    pausas: 6,
    recomendadoPara: 'Risco alto, passos irreversiveis, dominio novo, produto com usuarios reais',
  },
  ork: {
    modo: 'ork',
    tag: '#Ork',
    blocos: [
      bloco(['GOAL', 'PLAN'], 'premissas'),
      bloco(['GO'], 'implementacao'),
      bloco(['CHECK'], 'evidencias'),
      bloco(['SHIP'], 'push'),
      bloco(['MASTER'], 'score'),
    ],
    pausas: 5,
    recomendadoPara: 'Demandas de produto que pedem veredito separado da execucao e da evidencia',
  },
  classic: {
    modo: 'classic',
    tag: '#Classic',
    blocos: [
      bloco(['GOAL'], 'objetivo'),
      bloco(['PLAN'], 'plano'),
      bloco(['GO', 'CHECK'], 'evidencias, com autorizacao antecipada de push'),
      bloco(['SHIP', 'MASTER'], SEM_PAUSA),
    ],
    pausas: 3,
    recomendadoPara: 'O padrao: premissas delicadas com entrega confiavel',
  },
  maestro: {
    modo: 'maestro',
    tag: '#Maestro',
    blocos: [
      bloco(['GOAL', 'PLAN'], 'premissas'),
      bloco(['GO', 'CHECK', 'SHIP'], SEM_PAUSA),
      bloco(['MASTER'], SEM_PAUSA),
    ],
    pausas: 1,
    recomendadoPara: 'Solucoes claras e ageis, sem muitos riscos ou tradeoffs',
  },
  auto: {
    modo: 'auto',
    tag: '#Auto',
    blocos: [bloco([...FASES], SEM_PAUSA)],
    pausas: 0,
    recomendadoPara: 'Solucoes menores, docs, estudos, pesquisas, configuracoes, auditorias, migracoes',
  },
  // I-42: uma fase so, a GO, sem cerimonia. Nao autoriza push sozinho (fora de
  // MODOS_QUE_AUTORIZAM_PUSH) e nao escreve contrato publico (ver contrato-publico.ts).
  fast: {
    modo: 'fast',
    tag: '#Fast',
    blocos: [bloco(['GO'], SEM_PAUSA)],
    pausas: 0,
    recomendadoPara: 'Pedido pequeno e claro, de minutos: uma fase so (GO), sem cerimonia; o push pede autorizacao',
  },
};

/**
 * Os modos APOSENTADOS pela I-43, na ordem do espectro.
 *
 * Domicilio unico da lista. Nenhum outro arquivo repete estes dois literais.
 */
export const MODOS_APOSENTADOS = ['look', 'ork'] as const satisfies readonly ModoAposentado[];

/**
 * Todos os modos que podem estar GRAVADOS em disco, na ordem do espectro.
 *
 * Domicilio unico do literal de todos. Antes da I-43 ele existia em tres copias
 * (`hitl-contract.ts`, `creation-operation-store.ts` e aqui), e encolher uma sem
 * encolher as outras quebraria recibo historico em silencio. Esta lista NUNCA encolhe.
 */
export const MODOS_LEGADOS = ['look', 'ork', 'classic', 'maestro', 'auto', 'fast'] as const satisfies readonly ModoLegado[];

/**
 * Os modos VIVOS na ordem do espectro, do mais HITL ao mais autonomo.
 *
 * E a unica lista que alimenta ESCRITOR: `parseModo`, `extrairTagDoPedido`, a tabela
 * de `ork modos`, a entrevista do `#setup` e o fallback do manifesto. Encolher aqui
 * apaga o modo de toda entrada de uma vez, sem tocar em nenhum leitor. Uma thread que
 * acrescente um modo (a I-42 e `#Fast`) cresce esta mesma lista e mais nada.
 */
export const ORDEM_DOS_MODOS = ['classic', 'maestro', 'auto', 'fast'] as const satisfies readonly Modo[];

/**
 * As #TAGs vivas oferecidas como substituto de um modo aposentado (D7).
 *
 * DERIVADA de `ORDEM_DOS_MODOS`, nunca escrita a mao, e essa e a propriedade que
 * importa: no dia em que a I-42 acrescentar `fast` a lista viva, toda mensagem de
 * recusa passa a nomear `#Fast` sozinha, sem uma linha de edicao e sem conflito de
 * merge nessa linha. Nomear um modo que ainda nao existe seria o pecado que o produto
 * combate; derivar a lista e o que garante que isso nunca aconteca.
 *
 * `#Maestro` fica de fora porque ele nao e substituto de `#Look` nem de `#Ork`: e o
 * modo de gate, com bloco e pausa de outra natureza.
 *
 * I-42: so modo de ciclo completo substitui um aposentado. `#Look` e `#Ork` eram os modos
 * de maior vigilancia; oferecer o `#Fast` (so a GO, sem PLAN nem CHECK) no lugar deles
 * trocaria o regime de supervisao pelas costas de quem pediu, que e o defeito que a
 * recusa existe para impedir. A regra e por desenho de ciclo, nao pelo nome do modo.
 */
export function substitutosVivos(): string[] {
  return ORDEM_DOS_MODOS.filter((m) => m !== 'maestro' && cicloCompleto(m)).map((m) => MODOS[m].tag);
}

/** O modo percorre as seis fases canonicas? */
export function cicloCompleto(modo: ModoLegado): boolean {
  return MODOS[modo].blocos.reduce((n, b) => n + b.fases.length, 0) === FASES.length;
}

/** O modo esta aposentado? (esta gravado em disco, e nao pode mais ser escrito) */
export function modoAposentado(modo: unknown): modo is ModoAposentado {
  return typeof modo === 'string' && (MODOS_APOSENTADOS as readonly string[]).includes(modo);
}

/** O motivo tipado de quem tentou escrever um modo aposentado (I-43). */
export const MOTIVO_MODO_APOSENTADO = 'modo.aposentado' as const;

/**
 * A recusa tipada de um modo aposentado, no formato `<dominio>.<motivo>` do produto.
 *
 * Ignorar em silencio esta PROIBIDO: e o pecado que o produto inteiro combate, e seria
 * o pior resultado possivel desta aposentadoria (o builder pede `#Look` e recebe `#Auto`
 * sem saber). A recusa nomeia o modo pedido e os substitutos VIVOS.
 *
 * O texto e DERIVADO de `ORDEM_DOS_MODOS` (ver `substitutosVivos`), nunca escrito a mao.
 */
export function recusaDeModoAposentado(modo: ModoAposentado): string {
  const tag = MODOS[modo].tag;
  return `${MOTIVO_MODO_APOSENTADO}: ${tag} foi aposentado e nao abre trabalho novo. `
    + `Use ${substitutosVivos().join(' ou ')}. `
    + `Thread ja gravada em ${tag} continua abrindo normalmente.`;
}

/**
 * O portao de ESCRITA de modo, com recusa tipada em vez de silencio.
 *
 * Devolve o modo vivo, ou lanca: `modo.aposentado` para quem saiu do produto e
 * `modo.desconhecido` para quem nunca existiu. Sao dois erros diferentes de proposito,
 * porque a acao do dono tambem e diferente: um troca a #TAG, o outro corrige um typo.
 */
export function exigirModoVivo(entrada: string | undefined | null): Modo {
  const vivo = parseModo(entrada);
  if (vivo) return vivo;
  const cru = (entrada ?? '').trim().replace(/^--?modo[= ]/i, '').replace(/^#/, '').toLowerCase();
  if (modoAposentado(cru)) throw new Error(recusaDeModoAposentado(cru));
  throw new Error(`modo.desconhecido: "${entrada ?? ''}" nao e um modo de conducao. `
    + `Use um de: ${ORDEM_DOS_MODOS.map((m) => MODOS[m].tag).join(', ')}.`);
}

/**
 * Parseia a #TAG de modo de conducao.
 * Aceita `#Auto`, `auto`, `--modo auto`, com ou sem caixa. Retorna null se nao reconhecer.
 */
export function parseModo(entrada: string | undefined | null): Modo | null {
  if (!entrada) return null;
  const limpo = entrada.trim().replace(/^--?modo[= ]/i, '').replace(/^#/, '').toLowerCase();
  return (ORDEM_DOS_MODOS as readonly string[]).includes(limpo) ? (limpo as Modo) : null;
}

/**
 * A primeira #TAG de modo do texto, VIVA OU APOSENTADA, sem julgar qual das duas.
 *
 * A lista e derivada de `MODOS_LEGADOS`: nenhuma lista de modos e escrita a mao aqui.
 * Reconhecer o aposentado e o que permite RECUSAR em vez de ignorar em silencio.
 */
function primeiraTagDoPedido(texto: string): ModoLegado | null {
  const alternativas = MODOS_LEGADOS.join('|');
  const achadas = texto.match(new RegExp(`#(?:${alternativas})\\b`, 'gi'));
  if (!achadas || achadas.length === 0) return null;
  const cru = achadas[0].slice(1).toLowerCase();
  return (MODOS_LEGADOS as readonly string[]).includes(cru) ? (cru as ModoLegado) : null;
}

/**
 * Extrai a primeira #TAG de modo VIVO presente no texto livre de um pedido do builder.
 * E o caminho usado pelos adaptadores de host antes de chamar `ork thread new --modo`.
 *
 * Uma #TAG aposentada devolve null AQUI e e reconhecida por `extrairTagAposentadaDoPedido`:
 * quem chama decide recusar com motivo, nunca seguir como se nada tivesse sido escrito.
 */
export function extrairTagDoPedido(texto: string): Modo | null {
  const achada = primeiraTagDoPedido(texto);
  return achada && !modoAposentado(achada) ? (achada as Modo) : null;
}

/**
 * A #TAG do pedido nomeia um modo APOSENTADO? E o caminho da recusa tipada da I-43.
 *
 * Devolve o modo aposentado quando ele e a PRIMEIRA tag do texto, que e a mesma regra
 * de precedencia de `extrairTagDoPedido`: um pedido com `#Look` antes de `#Auto` e um
 * pedido em `#Look`, e recusar e diferente de escolher o proximo da fila por conta.
 */
export function extrairTagAposentadaDoPedido(texto: string): ModoAposentado | null {
  const achada = primeiraTagDoPedido(texto);
  return achada && modoAposentado(achada) ? achada : null;
}

/** Tag mostrada quando a thread em disco nao traz um modo reconhecido. */
export const TAG_DE_MODO_DESCONHECIDO = '#?';

/**
 * Tag do modo para EXIBICAO, tolerante ao que esta de fato gravado em disco.
 *
 * `thread.json` e arquivo, nao tipo: uma thread criada por versao antiga, por outro
 * perfil de board ou editada a mao pode trazer um `modo` que nao existe na matriz
 * (ou nao trazer nenhum). Todo `MODOS[thread.modo].tag` nesses casos estourava com
 * "Cannot read properties of undefined (reading 'tag')" e derrubava o comando INTEIRO,
 * inclusive `ork board`, `ork thread list` e `ork orquestracao status`.
 *
 * A regra aqui e nunca lancar: um comando que so LE o board tem de conseguir mostrar
 * a thread torta, que e justamente a que o humano precisa ver para consertar. A tag
 * de fallback carrega o valor cru (`#?default`) para dizer o que arrumar.
 *
 * Isto NAO afrouxa a conducao: quem VALIDA modo (criar thread, checar manifesto)
 * continua usando `definicaoDoModo`, que lanca. Aqui so se decide o que imprimir.
 */
export function tagDoModo(modo: unknown): string {
  if (typeof modo === 'string') {
    const def = (MODOS as Record<string, DefinicaoDeModo | undefined>)[modo];
    if (def) return def.tag;
    const cru = modo.trim();
    if (cru.length > 0) return `${TAG_DE_MODO_DESCONHECIDO}${cru.slice(0, 16)}`;
  }
  return TAG_DE_MODO_DESCONHECIDO;
}

/**
 * Definicao de um modo, com erro tipado quando o modo nao existe.
 *
 * Leitor: aceita modo aposentado, porque `MODOS` mantem os cinco e porque abrir
 * thread antiga nao pode estourar. Quem VALIDA entrada usa `parseModo`.
 */
export function definicaoDoModo(modo: ModoLegado): DefinicaoDeModo {
  const def = MODOS[modo];
  if (!def) throw new Error(`modo de conducao desconhecido: ${modo}`);
  return def;
}

/** Numero de pausas humanas do modo, derivado dos blocos (nunca hardcoded no consumo). */
export function pausasDoModo(modo: ModoLegado): number {
  return definicaoDoModo(modo).blocos.filter((b) => b.pausa).length;
}

/** O bloco de loop que conduz a fase informada dentro do modo. */
export function blocoDaFase(modo: ModoLegado, fase: Fase): BlocoDeLoop {
  const def = definicaoDoModo(modo);
  const achado = def.blocos.find((b) => b.fases.includes(fase));
  if (!achado) throw new Error(`fase ${fase} nao pertence a nenhum bloco do modo ${modo}`);
  return achado;
}

/** A fase pausa para o humano ao fechar seu bloco? */
export function fasePausa(modo: ModoLegado, fase: Fase): boolean {
  const b = blocoDaFase(modo, fase);
  return b.pausa && b.fases[b.fases.length - 1] === fase;
}

/** Tabela dos modos VIVOS em texto, usada por `ork modos`. O numero vem da lista. */
export function tabelaDeModos(): string {
  const linhas: string[] = [];
  linhas.push('Modos de conducao (a #TAG vai no proprio pedido ao orquestrador)');
  linhas.push('');
  const cab = ['#TAG'.padEnd(10), 'BLOCOS'.padEnd(6), 'PAUSAS'.padEnd(7), 'CICLO'];
  linhas.push('  ' + cab.join(' '));
  linhas.push('  ' + '-'.repeat(78));
  for (const modo of ORDEM_DOS_MODOS) {
    const def = MODOS[modo];
    const ciclo = def.blocos
      .map((b) => b.fases.join('-') + (b.pausa ? ' *' : ''))
      .join(' / ');
    linhas.push(
      '  ' +
        [
          def.tag.padEnd(10),
          String(def.blocos.length).padEnd(6),
          String(pausasDoModo(modo)).padEnd(7),
          ciclo,
        ].join(' ')
    );
  }
  linhas.push('  ' + '-'.repeat(78));
  linhas.push('  * = bloco que pausa e espera veredito humano');
  linhas.push('');
  linhas.push('Detalhe por modo:');
  for (const modo of ORDEM_DOS_MODOS) {
    const def = MODOS[modo];
    const pausas = def.blocos.filter((b) => b.pausa).map((b) => b.pausaSobre);
    linhas.push(
      `  ${def.tag.padEnd(10)} slug das sessoes: ${def.blocos.map((b) => b.slugFases).join(', ')}`
    );
    linhas.push(`             pausas: ${pausas.length > 0 ? pausas.join(', ') : 'nenhuma'}`);
    linhas.push(`             uso: ${def.recomendadoPara}`);
  }
  linhas.push('');
  linhas.push('REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.');
  for (const inv of INVARIANTES) linhas.push('  - ' + inv);
  return linhas.join('\n');
}
