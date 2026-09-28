/**
 * O board de divida: onde os achados e as propostas de ajuste ficam (bloco B5).
 *
 * Toda rodada de auditoria termina em PROPOSTA enderecada ao roadmap do produto, nunca em
 * correcao aplicada. O board e o registro append-only dessas propostas: e dele que o
 * `ork thread new --from-finding <id>` tira o achado, e e nele que a RECORRENCIA de uma
 * regra e contada (a regra mecanica herdada do `ork learn`: 2 recorrencias propoem
 * controle, 3 propoem bloqueante).
 *
 * Duas regras estruturais moram aqui:
 *   1. achado sem proposta COMPLETA nao entra (`achado.sem-proposta`), o que torna o bloco
 *      obrigatorio de propostas uma garantia do formato de dados e nao um pedido no prompt;
 *   2. o achado carrega uma CLAIM montada pela MESMA regra das claims de fase
 *      (`montarClaim`), porque o auditor nao tem direito a self-report.
 */

import * as path from 'node:path';
import { montarClaim } from './claims';
import { dirEstado } from './manifest';
import { PACKS } from './auditoria';
import {
  Achado,
  Estagio,
  EstadoDeAchado,
  PackDeAuditoria,
  PosturaDoPack,
  PropostaDeAjuste,
  Recorrencia,
  SeveridadeDeAchado,
} from './types';
import { agora, anexarJsonl, lerJsonl, proximoIdSequencial, tabela } from './util';

/** Diretorio do board de divida do projeto. */
export function dirDivida(raiz: string): string {
  return path.join(dirEstado(raiz), 'divida');
}

/** O board em si, append-only como o ledger e o `claims.jsonl`. */
export function caminhoBoard(raiz: string): string {
  return path.join(dirDivida(raiz), 'board.jsonl');
}

/** Le o board (armazem JSONL: a ultima gravacao de um id vence, como no `claims.jsonl`). */
export function lerBoard(raiz: string): Achado[] {
  return lerJsonl<Achado>(caminhoBoard(raiz));
}

/** Proximo id sequencial do board (`F1`, `F2`, ...), unico no projeto. */
export function proximoIdDeAchado(achados: Achado[]): string {
  return proximoIdSequencial(achados.map((a) => a.id), 'F');
}

/** Anexa o achado ao board (append-only). */
export function gravarAchado(raiz: string, achado: Achado): void {
  anexarJsonl(caminhoBoard(raiz), achado);
}

/** Acha um achado pelo id, com erro acionavel quando ele nao existe. */
export function exigirAchado(raiz: string, id: string): Achado {
  const achado = lerBoard(raiz).find((a) => a.id === id.toUpperCase());
  if (!achado) {
    throw new Error(
      `achado "${id}" nao existe no board de divida (${caminhoBoard(raiz)}). Veja: ork audit divida`
    );
  }
  return achado;
}

/** Severidades aceitas, para o parse do que vem do auditor. */
export const SEVERIDADES: readonly SeveridadeDeAchado[] = ['critico', 'maior', 'menor'];

/** Severidade valida, ou null. */
export function parseSeveridade(bruto: string | undefined): SeveridadeDeAchado | null {
  const alvo = (bruto ?? '').trim().toLowerCase();
  return (SEVERIDADES as readonly string[]).includes(alvo) ? (alvo as SeveridadeDeAchado) : null;
}

/** Separa `caminho/arquivo.ts:42` em caminho e linha. Sem linha, a linha e null. */
export function separarArquivoELinha(bruto: string): { arquivo: string; linha: number | null } {
  const casado = /^(.*):(\d+)$/.exec(bruto.trim());
  if (!casado) return { arquivo: bruto.trim(), linha: null };
  return { arquivo: casado[1], linha: Number(casado[2]) };
}

/** O que o auditor precisa entregar por achado. */
export interface EntradaDeAchado {
  rodada: string;
  pack: PackDeAuditoria;
  regra: string;
  severidade: SeveridadeDeAchado;
  titulo: string;
  /** `caminho:linha` da evidencia principal. */
  arquivo: string;
  descricao: string;
  /** A alegacao do auditor sobre o achado (vira Claim). */
  alegacao?: string;
  /** Comandos que reexecutam a evidencia no HEAD real. */
  verificar?: string[];
  impacto: string;
  fix: string;
  estimativa: string;
  /** O passo irreversivel do fix. `nenhum` quando o fix e reversivel. */
  irreversivel?: string;
  produto: string;
  estagio: Estagio;
  postura: PosturaDoPack;
  memory: string;
}

/**
 * Os campos que compoem a proposta de ajuste, com o texto que o auditor le no FORMATO.md.
 *
 * Fonte UNICA: a validacao (`faltasDaProposta`) e a documentacao que a rodada deixa para o
 * auditor saem desta lista. Antes ela existia em codigo e em duas prosas independentes, e
 * foi o proprio pack `reuse` que apontou isso (regra RU4) na rodada ork-reuse-2026-09-03-1.
 */
export const CAMPOS_DA_PROPOSTA: readonly {
  campo: keyof EntradaDeAchado;
  rotulo: string;
  descricao: string;
}[] = [
  { campo: 'titulo', rotulo: 'titulo', descricao: 'uma linha, o que esta errado' },
  {
    campo: 'arquivo',
    rotulo: 'arquivo (evidencia caminho:linha)',
    descricao: 'a evidencia principal, no formato caminho/do/arquivo.ext:42',
  },
  { campo: 'impacto', rotulo: 'impacto', descricao: 'o que quebra ou custa se ficar como esta' },
  { campo: 'fix', rotulo: 'fix sugerido', descricao: 'o ajuste proposto, em uma frase' },
  {
    campo: 'irreversivel',
    rotulo: 'passo irreversivel (escreva "nenhum" quando o fix for reversivel)',
    descricao: 'o passo irreversivel do fix, ou "nenhum"',
  },
  { campo: 'estimativa', rotulo: 'estimativa', descricao: '2h | 1d | 1 semana' },
];

/**
 * Valida a proposta de ajuste.
 *
 * Os campos abaixo sao o bloco obrigatorio da visao (secao 5.1): evidencia arquivo:linha,
 * impacto, fix sugerido, passo irreversivel e estimativa. Sem eles o achado nao vira insumo
 * de roadmap, e um achado que nao vira insumo de roadmap e relatorio, que e exatamente o
 * que o B5 nao pode produzir.
 */
export function faltasDaProposta(entrada: EntradaDeAchado): string[] {
  const faltas: string[] = [];
  for (const { campo, rotulo } of CAMPOS_DA_PROPOSTA) {
    if (String(entrada[campo] ?? '').trim() === '') faltas.push(rotulo);
  }
  const pack = PACKS[entrada.pack];
  if (pack && !pack.regras.some((r) => r.id === entrada.regra)) {
    faltas.push(
      `regra "${entrada.regra}" fora do pack ${entrada.pack} (validas: ${pack.regras.map((r) => r.id).join(', ')})`
    );
  }
  return faltas;
}

/**
 * O mesmo achado ja registrado NESTA rodada, se houver.
 *
 * A chave e (rodada, pack, regra, evidencia, titulo). De proposito ela nao atravessa
 * rodadas: o mesmo achado voltando numa rodada POSTERIOR e recorrencia, que e justamente
 * o sinal que promove policy. Duplicata dentro da mesma rodada e outra coisa: e a mesma
 * leitura contada duas vezes, e ela inflaria a recorrencia sem nenhum fato novo.
 */
export function acharDuplicado(achados: Achado[], entrada: EntradaDeAchado): Achado | null {
  const { arquivo, linha } = separarArquivoELinha(entrada.arquivo);
  return (
    achados.find(
      (a) =>
        a.rodada === entrada.rodada &&
        a.pack === entrada.pack &&
        a.regra === entrada.regra &&
        a.arquivo === arquivo &&
        a.linha === linha &&
        a.titulo === (entrada.titulo ?? '').trim()
    ) ?? null
  );
}

/**
 * Registra um achado no board de divida.
 *
 * Nao grava no ledger: quem registra o evento e a rodada que chamou, porque o ledger da
 * auditoria pertence a rodada e nao ao board.
 */
export function registrarAchado(raiz: string, entrada: EntradaDeAchado): Achado {
  const faltas = faltasDaProposta(entrada);
  if (faltas.length > 0) {
    throw new Error(
      `achado.sem-proposta: a proposta de ajuste esta incompleta (faltam: ${faltas.join(', ')}). ` +
        'Cada achado precisa terminar em proposta enderecada ao roadmap do produto.'
    );
  }
  const board = lerBoard(raiz);
  const id = proximoIdDeAchado(board);
  const { arquivo, linha } = separarArquivoELinha(entrada.arquivo);
  const proposta: PropostaDeAjuste = {
    impacto: entrada.impacto.trim(),
    fix: entrada.fix.trim(),
    estimativa: entrada.estimativa.trim(),
    passoIrreversivel: (entrada.irreversivel ?? '').trim(),
    destino: `roadmap do produto ${entrada.produto}`,
    regime: entrada.memory,
  };
  // A claim do achado nasce pela MESMA regra das claims de fase: o auditor tambem nao
  // pode alegar sem declarar como se comprova.
  const claim = montarClaim({
    id: `${id}.C1`,
    dono: entrada.rodada,
    fase: null,
    arquivo: entrada.arquivo.trim(),
    alegacao: (entrada.alegacao ?? entrada.titulo).trim(),
    verificar: entrada.verificar,
  });
  const achado: Achado = {
    id,
    rodada: entrada.rodada,
    pack: entrada.pack,
    regra: entrada.regra,
    severidade: entrada.severidade,
    titulo: entrada.titulo.trim(),
    arquivo,
    linha,
    descricao: entrada.descricao.trim(),
    proposta,
    claim,
    estado: 'aberto',
    produto: entrada.produto,
    estagio: entrada.estagio,
    postura: entrada.postura,
    registradoEm: agora(),
    thread: null,
  };
  gravarAchado(raiz, achado);
  return achado;
}

/** Regrava o achado com o novo estado (o append mais novo vence). */
export function carimbarAchado(raiz: string, achado: Achado, mudanca: Partial<Achado>): Achado {
  const atualizado: Achado = { ...achado, ...mudanca };
  gravarAchado(raiz, atualizado);
  return atualizado;
}

/** Achados de uma rodada, na ordem do board. */
export function achadosDaRodada(raiz: string, rodada: string): Achado[] {
  return lerBoard(raiz).filter((a) => a.rodada === rodada);
}

/**
 * Recorrencia por (pack, regra) no board de divida.
 *
 * A regra de promocao e MECANICA e vem da visao (secao 5.2 e onboarding secao 4): 2
 * recorrencias PROPOEM um controle, 3 PROPOEM tornar a policy bloqueante. O `ork` nunca
 * promove sozinho: promover policy e decisao do humano, e o board so mostra a conta.
 */
export function recorrencias(achados: Achado[]): Recorrencia[] {
  const grupos = new Map<string, Achado[]>();
  for (const a of achados) {
    // Achado descartado nao procedia e achado resolvido ja foi pago: nenhum dos dois conta
    // como recorrencia, senao a conta que propoe promover policy mediria divida quitada.
    if (a.estado === 'descartado' || a.estado === 'resolvido') continue;
    const chave = `${a.pack}::${a.regra}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), a]);
  }
  const saida: Recorrencia[] = [];
  for (const [chave, lista] of grupos) {
    const [pack, regra] = chave.split('::');
    const n = lista.length;
    const promocao: Recorrencia['promocaoProposta'] =
      n >= 3 ? 'bloqueante' : n === 2 ? 'controle' : 'nenhuma';
    saida.push({
      pack: pack as PackDeAuditoria,
      regra,
      ocorrencias: n,
      achados: lista.map((a) => a.id),
      promocaoProposta: promocao,
      detalhe:
        promocao === 'bloqueante'
          ? `${n} recorrencias: o board PROPOE promover a policy correspondente para block`
          : promocao === 'controle'
            ? `${n} recorrencias: o board PROPOE um controle para a regra ${regra}`
            : 'primeira ocorrencia: sem promocao proposta',
    });
  }
  return saida.sort(
    (a, b) => b.ocorrencias - a.ocorrencias || a.pack.localeCompare(b.pack) || a.regra.localeCompare(b.regra)
  );
}

/** Estados que continuam pendentes de decisao do humano. */
export function abertos(achados: Achado[]): Achado[] {
  return achados.filter((a) => a.estado === 'aberto');
}

/** Estado valido a partir do texto do usuario, ou null. */
export function parseEstadoDeAchado(bruto: string | undefined): EstadoDeAchado | null {
  const alvo = (bruto ?? '').trim().toLowerCase();
  const validos: readonly string[] = ['aberto', 'virou-thread', 'adiado', 'resolvido', 'descartado'];
  return validos.includes(alvo) ? (alvo as EstadoDeAchado) : null;
}

/** Tabela de `ork audit divida`. */
export function tabelaDaDivida(
  raiz: string,
  filtro: { pack?: PackDeAuditoria; todos?: boolean } = {}
): string {
  const board = lerBoard(raiz);
  const alvo = board
    .filter((a) => (filtro.pack ? a.pack === filtro.pack : true))
    .filter((a) => (filtro.todos ? true : a.estado !== 'descartado' && a.estado !== 'resolvido'));
  if (alvo.length === 0) {
    return (
      'Board de divida vazio' +
      (filtro.pack ? ` para o pack ${filtro.pack}` : '') +
      `.\nRode uma auditoria: ork audit run <pack>`
    );
  }
  const linhas = alvo.map((a) => [
    a.id,
    a.pack,
    a.regra,
    a.severidade,
    a.claim.estado,
    a.estado,
    a.proposta.estimativa,
    a.proposta.passoIrreversivel.toLowerCase() === 'nenhum' ? 'nao' : 'SIM',
    `${a.arquivo}${a.linha !== null ? ':' + a.linha : ''}`,
    a.titulo,
  ]);
  const corpo = tabela(
    ['ID', 'PACK', 'REGRA', 'SEVERIDADE', 'CLAIM', 'ESTADO', 'ESTIMATIVA', 'IRREVERSIVEL', 'EVIDENCIA', 'TITULO'],
    linhas
  );
  const rec = recorrencias(alvo).filter((r) => r.ocorrencias > 1);
  const linhasRec =
    rec.length === 0
      ? ['  (nenhuma regra recorrente ainda)']
      : rec.map((r) => `  ${r.pack} ${r.regra}: ${r.ocorrencias}x -> promocao proposta: ${r.promocaoProposta} (${r.achados.join(', ')})`);
  return [
    `Board de divida do projeto (${caminhoBoard(raiz)})`,
    '',
    corpo,
    '',
    'Recorrencia (2 propoem controle, 3 propoem bloqueante; o `ork` nunca promove sozinho):',
    ...linhasRec,
    '',
    `abertos: ${abertos(alvo).length} | total listado: ${alvo.length}`,
    'Achado vira thread com: ork thread new "<nome>" --from-finding <ID>',
  ].join('\n');
}

/** Detalhe de um achado, usado pelo `--from-finding` e por `ork audit show`. */
export function textoDoAchado(a: Achado): string {
  const linhas: string[] = [];
  linhas.push(`  ${a.id}  [${a.severidade}] ${a.pack}/${a.regra}  ${a.titulo}`);
  linhas.push(`      evidencia   ${a.arquivo}${a.linha !== null ? ':' + a.linha : ''}`);
  if (a.descricao) linhas.push(`      descricao   ${a.descricao}`);
  linhas.push(`      claim       ${a.claim.id} [${a.claim.estado}] ${a.claim.alegacao}`);
  linhas.push(
    `      verificar   ${a.claim.verificar.join(' && ') || '(sem comando: o auditor nao comprovou o achado)'}`
  );
  linhas.push(`      impacto     ${a.proposta.impacto}`);
  linhas.push(`      fix         ${a.proposta.fix}`);
  linhas.push(`      irreversivel ${a.proposta.passoIrreversivel}`);
  linhas.push(`      estimativa  ${a.proposta.estimativa}`);
  linhas.push(`      destino     ${a.proposta.destino} (regime ${a.proposta.regime})`);
  linhas.push(`      estado      ${a.estado}${a.thread ? ` (thread ${a.thread})` : ''}`);
  return linhas.join('\n');
}

/**
 * O texto do GOAL que um achado entrega a thread aberta por `--from-finding`.
 *
 * E o "sem retrabalho" da visao: o pedido do builder ja nasce com a evidencia, o impacto, o
 * fix proposto, o passo irreversivel e a estimativa que o auditor levantou.
 */
export function pedidoDoAchado(a: Achado): string {
  return [
    `Achado de auditoria ${a.id} (pack ${a.pack}, regra ${a.regra}, severidade ${a.severidade}).`,
    '',
    `Titulo: ${a.titulo}`,
    `Evidencia: ${a.arquivo}${a.linha !== null ? ':' + a.linha : ''}`,
    a.descricao ? `Descricao: ${a.descricao}` : '',
    `Alegacao do auditor (claim ${a.claim.id}, estado ${a.claim.estado}): ${a.claim.alegacao}`,
    `Como reexecutar a evidencia: ${a.claim.verificar.join(' && ') || '(nao declarado pelo auditor)'}`,
    '',
    'Proposta de ajuste levantada pela rodada:',
    `  impacto       ${a.proposta.impacto}`,
    `  fix sugerido  ${a.proposta.fix}`,
    `  irreversivel  ${a.proposta.passoIrreversivel}`,
    `  estimativa    ${a.proposta.estimativa}`,
    '',
    `Origem: rodada ${a.rodada}, produto ${a.produto}, estagio ${a.estagio}, postura ${a.postura}.`,
    'O fix acima e proposta do auditor, nao decisao: valide no GOAL antes de implementar.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
