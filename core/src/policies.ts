/**
 * Policies executaveis do manifesto (bloco B1).
 *
 * O bloco `policies:` do `orkastery.yaml` deixa de ser prosa e passa a ser codigo:
 * cada policy conhecida tem um gate (`when`), uma severidade (`block` ou `warn`) e um
 * avaliador deterministico. Policy `block` violada reprova em QUALQUER modo, inclusive
 * `#Auto`, porque o modo afrouxa a pausa e nunca a verificacao.
 *
 * Policy declarada no manifesto que o `ork` nao conhece nao e silenciosamente ignorada:
 * ela volta na lista de desconhecidas, para o `doctor` e o CLI dizerem que ela nao vale.
 */

import { PontoDeGate } from './gates';
import { Manifesto, MotivoGate } from './types';

export type Severidade = 'block' | 'warn' | 'off';

export interface ContextoDePolicy {
  gate: PontoDeGate;
  /** Prompt montado da fase (gate `phase.dispatch`). */
  prompt?: string;
  /** Branch de origem e de destino do merge (gate `ship`). */
  de?: string;
  para?: string;
  /** Branch base do projeto (do manifesto). */
  baseBranch?: string;
}

export interface ViolacaoDePolicy {
  policy: string;
  severidade: Severidade;
  motivo: MotivoGate;
  detalhe: string;
  correcao: string;
}

/**
 * Variaveis que REDIRECIONAM o despacho do `claude` para um provider pago.
 * Mesma lista do `ork doctor`: presenca delas com `subscription-only` e bloqueante.
 */
const ENVS_QUE_REDIRECIONAM = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

/**
 * Padroes de segredo procurados no prompt antes do despacho.
 * O `ork` reporta o NOME do padrao e a posicao, nunca o trecho casado: relatorio de
 * vazamento que imprime o segredo e um segundo vazamento.
 */
const PADROES_DE_SEGREDO: { nome: string; regex: RegExp }[] = [
  { nome: 'chave da Anthropic', regex: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { nome: 'chave da OpenAI', regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { nome: 'chave de acesso AWS', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'token do GitHub', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { nome: 'chave privada PEM', regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  {
    nome: 'segredo atribuido em texto',
    regex: /\b(?:api[_-]?key|secret|token|senha|password)\s*[:=]\s*['"][^'"\s]{16,}['"]/i,
  },
];

/** Um padrao de segredo que casou, com a linha e SEM o trecho casado. */
export interface AchadoDeSegredo {
  nome: string;
  linha: number;
}

/**
 * Procura os padroes de segredo em um texto qualquer (prompt de fase, template de prompt).
 * Devolve o NOME do padrao e a linha, nunca o trecho: relatorio que imprime o segredo vaza de novo.
 */
export function procurarSegredos(texto: string): AchadoDeSegredo[] {
  const achados: AchadoDeSegredo[] = [];
  for (const padrao of PADROES_DE_SEGREDO) {
    const casado = padrao.regex.exec(texto);
    if (!casado) continue;
    achados.push({ nome: padrao.nome, linha: texto.slice(0, casado.index).split('\n').length });
  }
  return achados;
}

/** Catalogo das policies que o `ork` sabe executar, com o gate em que cada uma vale. */
export const POLICIES_CONHECIDAS: Readonly<Record<string, { quando: PontoDeGate[]; descricao: string }>> = {
  provider: {
    quando: ['phase.dispatch', 'ship'],
    descricao: 'proibe despacho por provider pago quando a politica e subscription-only',
  },
  segredo_em_prompt: {
    quando: ['phase.dispatch'],
    descricao: 'proibe despachar prompt que carrega credencial',
  },
  push_direto_na_base: {
    quando: ['ship'],
    descricao: 'proibe entregar sem branch de thread (push direto na base)',
  },
};

function severidade(bruta: string | undefined): Severidade {
  if (bruta === 'block' || bruta === 'warn' || bruta === 'off') return bruta;
  return 'warn';
}

/** Policies declaradas no manifesto que o `ork` nao sabe executar. */
export function policiesDesconhecidas(manifesto: Manifesto): string[] {
  return Object.keys(manifesto.policies ?? {}).filter((p) => !(p in POLICIES_CONHECIDAS));
}

/** Avalia as policies aplicaveis ao gate informado. Nunca lanca: devolve as violacoes. */
export function avaliarPolicies(manifesto: Manifesto, ctx: ContextoDePolicy): ViolacaoDePolicy[] {
  const declaradas = manifesto.policies ?? {};
  const violacoes: ViolacaoDePolicy[] = [];

  for (const [nome, bruta] of Object.entries(declaradas)) {
    const conhecida = POLICIES_CONHECIDAS[nome];
    if (!conhecida || !conhecida.quando.includes(ctx.gate)) continue;
    const sev = severidade(bruta);
    if (sev === 'off') continue;

    if (nome === 'provider') {
      if (manifesto.runtime.provider_policy !== 'subscription-only') continue;
      const ativas = ENVS_QUE_REDIRECIONAM.filter((e) => (process.env[e] ?? '').trim() !== '');
      if (ativas.length > 0) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          // Bloco B3: a policy `provider` deixa de sair como `policy.violation` generica e
          // passa a carregar o motivo de CUSTO. E o que permite a politica de retry recusar
          // a reexecucao automatica dela sem precisar reabrir o nome da policy em cada gate.
          motivo: 'cost.violation',
          detalhe: `${ativas.join(', ')} redireciona o despacho do claude para provider pago`,
          correcao: `remova do ambiente: ${ativas.join(', ')} (o despacho usa a assinatura Claude local)`,
        });
      }
      continue;
    }

    if (nome === 'segredo_em_prompt') {
      for (const achado of procurarSegredos(ctx.prompt ?? '')) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `padrao "${achado.nome}" casou na linha ${achado.linha} do prompt (trecho omitido de proposito)`,
          correcao: 'tire a credencial do pedido; referencie a variavel de ambiente pelo nome',
        });
      }
      continue;
    }

    if (nome === 'push_direto_na_base') {
      const de = ctx.de ?? '';
      const para = ctx.para ?? '';
      const base = ctx.baseBranch ?? '';
      if (de && para && de === para) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `origem e destino sao a mesma branch ("${de}"): isso e push direto na base, nao merge de thread`,
          correcao: 'entregue a partir da branch da thread: ork ship <thread> --para ' + (base || 'main'),
        });
      } else if (de && base && de === base) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `a origem "${de}" e a propria branch base do projeto: nenhuma branch de thread foi usada`,
          correcao: 'crie a thread com --worktree auto e entregue a branch ork/<slug>',
        });
      }
      continue;
    }
  }

  return violacoes;
}

/** So as violacoes com severidade `block` (as que reprovam em qualquer modo). */
export function bloqueantes(violacoes: ViolacaoDePolicy[]): ViolacaoDePolicy[] {
  return violacoes.filter((v) => v.severidade === 'block');
}

/**
 * O motivo tipado que representa um conjunto de violacoes bloqueantes.
 *
 * Custo vence: se qualquer violacao do lote for de custo, o lote inteiro sai como
 * `cost.violation`, porque e o unico motivo que NUNCA pode ser reexecutado sozinho.
 * Sem este helper, cada gate carimbaria `policy.violation` na mao e a regra de custo
 * viraria uma segunda regra paralela, mais frouxa, em cada arquivo.
 */
export function motivoDominante(violacoes: ViolacaoDePolicy[]): MotivoGate {
  return violacoes.some((v) => v.motivo === 'cost.violation')
    ? 'cost.violation'
    : 'policy.violation';
}

/** Texto das violacoes para a saida do CLI. */
export function textoDeViolacoes(violacoes: ViolacaoDePolicy[]): string {
  return violacoes
    .map(
      (v) =>
        `  [${v.severidade}] policy ${v.policy}: ${v.detalhe}\n` + `           correcao: ${v.correcao}`
    )
    .join('\n');
}
