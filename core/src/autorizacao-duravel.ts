/**
 * RM-063 (F5): a autorizacao duravel do dono para a varredura agir sozinha nesta maquina.
 *
 * Incidente de 03 a 12/10/2026 (P4 e P5 da pagina da RM-063): o PR #112 foi mesclado e ficou dois dias sem
 * `ork ship registrar-pr`, e as sessoes fantasmas de threads fechadas ficaram registradas, porque nada roda esses
 * comandos sem um condutor. Agora a batida da varredura (`pulse-delivery`) faz isso sozinha, mas SO com a autorizacao
 * do dono gravada nesta maquina, com prazo e com a lista do que ela pode. Sem autorizacao (ou com ela vencida,
 * ilegivel, de outra maquina ou de outro projeto), cada acao vira um item da fila do pulse com o comando pronto.
 *
 * O arquivo e desta maquina e fica fora do git, como o `pulse-host.json` (RM-047):
 * `.orkastery/monitor/autorizacao.json` no checkout canonico. O contrato e `ork.autorizacao-duravel/v1`, o mesmo
 * que a F7 (`ork conducao autorizar`) vai gravar; a referencia esta em
 * `docs/referencia/contratos/autorizacao-duravel-rm063.md`. Leitura pura: nada aqui grava.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { formatarDataHoraRotulada } from './horario';
import { autoriaHumana } from './master';
import { nomeDaMaquina } from './maquina';
import { rastreadoPeloGit } from './procedencia';

export const CONTRATO_DA_AUTORIZACAO = 'ork.autorizacao-duravel/v1' as const;
export const ARQUIVO_DA_AUTORIZACAO = 'autorizacao.json';
/** Um arquivo de autorizacao tem poucas linhas; acima disto, nao e o que o dono gravou. */
const TETO_DO_ARQUIVO = 64 * 1024;

/**
 * As acoes do contrato. A varredura da F5 faz `limpar` (sessoes fantasmas), `registrar` (a entrega de PR ja mesclado)
 * e `master` (o MASTER por omissao); `merge` e `despachar` sao da F7 e ja fazem parte do contrato para a forma dele nao
 * mudar.
 */
export const ACOES_DA_AUTORIZACAO = ['limpar', 'registrar', 'master', 'merge', 'despachar'] as const;
export type AcaoAutorizavel = typeof ACOES_DA_AUTORIZACAO[number];

export interface AutorizacaoDuravel {
  contrato: typeof CONTRATO_DA_AUTORIZACAO;
  /** A maquina onde ela vale (`ork fabrica entrar --maquina`, `ORK_MAQUINA` ou o hostname). */
  maquina: string;
  /** O `project.name` do manifesto do checkout onde ela vale. */
  projeto: string;
  /** Quem autorizou: o dono. */
  por: string;
  concedidaEm: string;
  /** O prazo, em ISO com fuso: depois dele, nada e feito sozinho. */
  ate: string;
  pode: AcaoAutorizavel[];
  /** Uma referencia livre (a decisao do dono, por exemplo "X1.a"). */
  nota?: string;
}

/** Por que a autorizacao nao vale, tipado. `autorizacao.ausente` e o estado de quem nunca autorizou. */
export type MotivoDaAutorizacao = 'autorizacao.ausente' | 'autorizacao.rastreada' | 'autorizacao.ilegivel' |
  'autorizacao.contrato' | 'autorizacao.campo' | 'autorizacao.acao-desconhecida' | 'autorizacao.outra-maquina' |
  'autorizacao.outro-projeto' | 'autorizacao.expirada';

export type LeituraDaAutorizacao =
  | { valida: true; arquivo: string; autorizacao: AutorizacaoDuravel; sha256: string }
  | { valida: false; arquivo: string; motivo: MotivoDaAutorizacao; detalhe: string; autorizacao?: AutorizacaoDuravel };

/** O arquivo da autorizacao desta maquina, no checkout canonico (de dentro de uma worktree, o da raiz). */
export function caminhoDaAutorizacao(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DA_AUTORIZACAO);
}

/** O instante com o fuso explicito (`Z` ou `-03:00`): sem ele, o prazo dependeria do fuso de quem le. */
const instante = (v: unknown): boolean => typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const textoCurto = (v: unknown, teto: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= teto &&
  !/\p{Cc}/u.test(v);

/**
 * Le e confere a autorizacao desta maquina. Cada recusa tem motivo tipado e detalhe; so a valida, no prazo, desta
 * maquina e deste projeto, autoriza alguma coisa.
 */
export function lerAutorizacao(raiz: string, opcoes: { projeto: string; agora?: Date; maquina?: string }): LeituraDaAutorizacao {
  const arquivo = caminhoDaAutorizacao(raiz);
  const recusa = (motivo: MotivoDaAutorizacao, detalhe: string, autorizacao?: AutorizacaoDuravel): LeituraDaAutorizacao =>
    ({ valida: false, arquivo, motivo, detalhe, ...(autorizacao ? { autorizacao } : {}) });
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (!st) return recusa('autorizacao.ausente', 'nenhuma autorizacao duravel gravada nesta maquina');
  // RM-047: como o transporte do pulse, a autorizacao so vale do arquivo local desta maquina.
  if (!st.isFile()) return recusa('autorizacao.rastreada', 'a autorizacao precisa ser um arquivo comum desta maquina, nao link nem diretorio');
  if (rastreadoPeloGit(raiz, arquivo)) return recusa('autorizacao.rastreada', 'a autorizacao esta versionada no git; ela so vale do arquivo local desta maquina');
  if (st.size > TETO_DO_ARQUIVO) return recusa('autorizacao.ilegivel', `o arquivo passa de ${TETO_DO_ARQUIVO} bytes`);
  let bruto: string, dado: Record<string, unknown>;
  try {
    bruto = fs.readFileSync(arquivo, 'utf8');
    const lido = JSON.parse(bruto) as unknown;
    if (!lido || typeof lido !== 'object' || Array.isArray(lido)) throw new Error('nao e um objeto JSON');
    dado = lido as Record<string, unknown>;
  } catch (e) { return recusa('autorizacao.ilegivel', `o arquivo nao e JSON valido (${(e as Error).message.slice(0, 120)})`); }
  if (dado.contrato !== CONTRATO_DA_AUTORIZACAO) return recusa('autorizacao.contrato', `o contrato precisa ser ${CONTRATO_DA_AUTORIZACAO}`);
  for (const [campo, teto] of [['maquina', 80], ['projeto', 80], ['por', 120]] as const) {
    if (!textoCurto(dado[campo], teto)) return recusa('autorizacao.campo', `o campo ${campo} precisa ser texto de ate ${teto} caracteres`);
  }
  // A autoria e a mesma regra da nota do MASTER: nome de agente, de runtime ou generico nao autoriza nada.
  if (!autoriaHumana(dado.por)) {
    return recusa('autorizacao.campo', 'o campo por precisa nomear a pessoa que autorizou; agente, runtime ou nome generico nao autoriza');
  }
  for (const campo of ['concedidaEm', 'ate'] as const) {
    if (!instante(dado[campo])) {
      return recusa('autorizacao.campo', `o campo ${campo} precisa ser um instante ISO com fuso (Z ou -03:00), como 2026-10-18T23:59:00-03:00`);
    }
  }
  if (dado.nota !== undefined && !textoCurto(dado.nota, 300)) return recusa('autorizacao.campo', 'a nota precisa ser texto de ate 300 caracteres');
  const pode = dado.pode;
  if (!Array.isArray(pode) || pode.length === 0 || pode.some((a) => typeof a !== 'string') || new Set(pode).size !== pode.length) {
    return recusa('autorizacao.campo', 'o campo pode precisa ser uma lista de acoes, sem repeticao');
  }
  const desconhecida = pode.find((a) => !(ACOES_DA_AUTORIZACAO as readonly string[]).includes(a as string));
  if (desconhecida !== undefined) {
    return recusa('autorizacao.acao-desconhecida', `a acao ${JSON.stringify(desconhecida)} nao e do contrato (${ACOES_DA_AUTORIZACAO.join(', ')})`);
  }
  const autorizacao: AutorizacaoDuravel = {
    contrato: CONTRATO_DA_AUTORIZACAO, maquina: dado.maquina as string, projeto: dado.projeto as string, por: dado.por as string,
    concedidaEm: dado.concedidaEm as string, ate: dado.ate as string, pode: pode as AcaoAutorizavel[],
    ...(typeof dado.nota === 'string' ? { nota: dado.nota } : {}),
  };
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  if (autorizacao.maquina !== maquina) {
    return recusa('autorizacao.outra-maquina', `a autorizacao e da maquina ${autorizacao.maquina}, e esta e ${maquina}`, autorizacao);
  }
  if (autorizacao.projeto !== opcoes.projeto) {
    return recusa('autorizacao.outro-projeto', `a autorizacao e do projeto ${autorizacao.projeto}, e este e ${opcoes.projeto}`, autorizacao);
  }
  const agora = opcoes.agora ?? new Date();
  if (Date.parse(autorizacao.ate) <= agora.getTime()) {
    return recusa('autorizacao.expirada', `o prazo acabou em ${formatarDataHoraRotulada(autorizacao.ate, { agora: agora.toISOString() })}`,
      autorizacao);
  }
  return { valida: true, arquivo, autorizacao, sha256: createHash('sha256').update(bruto, 'utf8').digest('hex') };
}

/** A acao esta autorizada agora? */
export function autorizada(leitura: LeituraDaAutorizacao, acao: AcaoAutorizavel): boolean {
  return leitura.valida && leitura.autorizacao.pode.includes(acao);
}

/** A referencia que vai ao ledger com cada acao feita: quem autorizou, ate quando e qual arquivo. */
export function referenciaDaAutorizacao(leitura: LeituraDaAutorizacao): Record<string, unknown> | null {
  if (!leitura.valida) return null;
  const a = leitura.autorizacao;
  return { contrato: a.contrato, por: a.por, ate: a.ate, pode: a.pode, sha256: leitura.sha256, ...(a.nota ? { nota: a.nota } : {}) };
}

/** Uma linha para o `ork fabrica batida status` e para o pulse. */
export function linhaDaAutorizacao(leitura: LeituraDaAutorizacao, agora: string = new Date().toISOString()): string {
  if (leitura.valida) {
    const a = leitura.autorizacao;
    return `autorização durável de ${a.por} até ${formatarDataHoraRotulada(a.ate, { agora })}: a varredura pode ${a.pode.join(', ')}`;
  }
  if (leitura.motivo === 'autorizacao.ausente') {
    return 'sem autorização durável: as ações da varredura viram itens da fila do pulse, com o comando pronto';
  }
  return `autorização durável sem valor (${leitura.motivo}: ${leitura.detalhe}); as ações da varredura viram itens da fila do pulse`;
}
