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
  /**
   * RM-008 (fatia 3): fatos da thread, calculados por quem chama o gate. Cada policy nova so
   * avalia quando o fato dela veio; sem thread (como na checagem de ambiente do CLI), silencio.
   */
  threadId?: string;
  modo?: string;
  fase?: string;
  /** Numero do bloco (1..N) que conduz a fase, para o comando de correcao do setup. */
  bloco?: number;
  /** O bloco despachado contem a fase GO. */
  blocoComGo?: boolean;
  /** A thread ja gravou a baseline (`ork verify <thread> --baseline`). */
  temBaseline?: boolean;
  /** A ordem de fallback de runtimes do bloco despachado (vazia quando nao declarada). */
  fallbackDoBloco?: string[];
  /** Gate `ship`: a ponta da base nao esta contida na branch da thread. */
  branchAtrasDaBase?: boolean;
  /**
   * Fatia 2 do ensaio da 0.5.0 (P9), gate `ship`: a branch da thread nao traz commit alem da base (nada
   * a mergear) e a base local tem commit que a ref de rastreio do remoto nao tem. O ship empurraria a
   * base direto, sem merge de thread. Quem mede e o ship; sem o fato, a regra nao avalia.
   */
  semDeltaComBaseAFrente?: boolean;
  /** Gate `ship`: o remoto do push, para o texto da violacao. */
  remoto?: string;
  /**
   * RM-008 (B8), gate `claims.add`: o comando da claim que reprovou na conferencia local, rodado uma vez no
   * prazo do verify. Ausente quando passou ou nao rodou; sem o fato, a regra nao avalia.
   */
  provaLocalReprovada?: { claim: string; comando: string; code: number; estourou: boolean; prazoMs: number };
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
  // I-38 (T7): chave do OpenRouter; o hifen depois de `sk-or-v1` escapa do padrao da OpenAI.
  { nome: 'chave do OpenRouter', regex: /sk-or-v1-[A-Za-z0-9]{32,}/ },
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
  // RM-008 (fatia 3): licoes do loop de aprendizado que o `ork` sabe conferir sem ambiguidade.
  // O nome e o mesmo que o `ork licoes` propoe, para a proposta ser declarada como veio.
  verify_regression: {
    quando: ['phase.dispatch'],
    descricao: 'avisa quando o bloco que contem GO sai sem baseline gravada',
  },
  verify_failed: {
    quando: ['phase.dispatch'],
    descricao: 'avisa quando o bloco que contem GO sai sem baseline gravada (mesma conferencia de verify_regression)',
  },
  runtime_unavailable: {
    quando: ['phase.dispatch'],
    descricao: 'avisa quando o bloco despachado nao declara runtime de fallback',
  },
  tree_blocked: {
    quando: ['ship'],
    descricao: 'avisa quando a branch da thread esta atras da base',
  },
  // RM-008 (B8): a licao `claims.failed` ("rode o comando da claim antes de registra-la"). Desligada por
  // padrao; declarada, o `ork claims add` roda o comando uma vez no prazo do verify. So avisa, nunca para.
  claim_sem_prova_local: {
    quando: ['claims.add'],
    descricao: 'avisa quando o comando da claim reprova (ou estoura o prazo do verify) no registro',
  },
  claims_failed: {
    quando: ['claims.add'],
    descricao: 'a mesma conferencia de claim_sem_prova_local, com o nome que o ork licoes propoe',
  },
};

/** RM-008 (B8): as policies que conferem a claim no registro (um aviso so, como verify_regression e verify_failed). */
export const POLICIES_DE_PROVA_LOCAL: readonly string[] = ['claim_sem_prova_local', 'claims_failed'];

/** A primeira policy de prova local declarada fora de `off`, ou `null` (o `claims add` nao roda nada). */
export function policyDeProvaLocal(manifesto: Manifesto): string | null {
  const declaradas = manifesto.policies ?? {};
  for (const [nome, bruta] of Object.entries(declaradas)) {
    if (POLICIES_DE_PROVA_LOCAL.includes(nome) && severidade(bruta) !== 'off') return nome;
  }
  return null;
}

/**
 * Ensaio da 0.5.0: a thread criada sem `--worktree auto` entrega a base para a base, e a correcao
 * repetia o proprio `ork ship`. A thread que ainda nao passou do GO ganha a branch com
 * `ork worktree ensure`. Depois do GO, nao: os commits ja estao na base, a branch nova nasce com eles
 * e o ship sem delta empurraria a base direto, que e o que esta policy barra (CHECK, rodada 1).
 */
function correcaoSemBranchDaThread(threadId?: string, base?: string): string {
  return `entregue a branch da thread (ork/<slug>) com --para ${base || '<base>'}; sem worktree e antes do GO, ` +
    `crie-a com ork worktree ensure ${threadId || '<thread>'} (thread nova: --worktree auto); depois do GO, ` +
    'os commits ja estao na base e o ship nao os separa: leve-os para a branch da thread antes de entregar';
}

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
  // verify_regression e verify_failed conferem a mesma coisa: um aviso so, com o nome da primeira declarada.
  let baselineJaAvaliada = false;
  // claim_sem_prova_local e claims_failed idem.
  let provaLocalJaAvaliada = false;

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
          correcao: correcaoSemBranchDaThread(ctx.threadId, base),
        });
      } else if (de && base && de === base) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `a origem "${de}" e a propria branch base do projeto: nenhuma branch de thread foi usada`,
          correcao: correcaoSemBranchDaThread(ctx.threadId, base),
        });
      } else if (ctx.semDeltaComBaseAFrente === true) {
        // Fatia 2 do ensaio da 0.5.0 (P9): a thread que perdeu a branch depois do GO ganha uma com os commits
        // ja na base; o ship ve nada a mergear e empurraria a base, que e o que esta policy barra.
        const remoto = ctx.remoto ?? 'origin';
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `a branch "${de}" nao traz commit alem de "${para}", e ${para} local tem commit que ${remoto}/${para} nao tem: ` +
            'o ship empurraria a base direto, sem merge de thread',
          correcao: `leve os commits que estao so em ${para} local para a branch da thread antes de entregar, ou entregue-os ` +
            `pela thread que os criou (conferido em refs/remotes/${remoto}/${para}, sem rede)`,
        });
      }
      continue;
    }

    if (nome === 'verify_regression' || nome === 'verify_failed') {
      if (baselineJaAvaliada) continue;
      baselineJaAvaliada = true;
      if (ctx.blocoComGo === true && ctx.temBaseline === false) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: 'o bloco que contem GO vai sair sem baseline: uma falha que ja existia passaria por regressao desta thread',
          correcao: `ork verify ${ctx.threadId ?? '<thread>'} --baseline`,
        });
      }
      continue;
    }

    if (nome === 'runtime_unavailable') {
      if (Array.isArray(ctx.fallbackDoBloco) && ctx.fallbackDoBloco.length === 0) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: 'o bloco nao declara runtime de fallback: se o runtime cair, a fase para ate alguem trocar a mao',
          correcao: `ork setup ${ctx.modo ?? '<modo>'} --bloco ${ctx.bloco ?? 'N'} --fallback <runtime:modelo>`,
        });
      }
      continue;
    }

    if (POLICIES_DE_PROVA_LOCAL.includes(nome)) {
      if (provaLocalJaAvaliada) continue;
      provaLocalJaAvaliada = true;
      const r = ctx.provaLocalReprovada;
      if (r) {
        const id = ctx.threadId ?? '<thread>';
        violacoes.push({
          policy: nome,
          // O registro de claim nunca para: `block` declarado avisa como `warn`.
          severidade: 'warn',
          motivo: r.estourou ? 'verify.timeout' : 'claims.failed',
          detalhe: r.estourou
            ? `o comando da claim ${r.claim} estourou o prazo do verify (${Math.round(r.prazoMs / 1000)} s) no registro; a claim entrou sem prova local`
            : `o comando da claim ${r.claim} saiu ${r.code} no registro; a claim entrou sem prova local e reprova no verify`,
          correcao: r.estourou
            ? `divida o comando ou suba verify.timeout_ms; depois, ork verify ${id}`
            : `corrija o produto ou o comando e anexe o certo com ork claims verificar ${id} ${r.claim} --comando "<comando>"; ` +
              `se a alegacao nao vale, ork claims retirar ${id} ${r.claim} --motivo "<motivo>"`,
        });
      }
      continue;
    }

    if (nome === 'tree_blocked') {
      if (ctx.branchAtrasDaBase === true) {
        violacoes.push({
          policy: nome,
          severidade: sev,
          motivo: 'policy.violation',
          detalhe: `a branch "${ctx.de ?? 'da thread'}" esta atras de "${ctx.para ?? ctx.baseBranch ?? 'base'}": a entrega mistura a mudanca com o que a base ja andou`,
          correcao: `ork worktree sync ${ctx.threadId ?? '<thread>'}`,
        });
      }
      continue;
    }
  }

  return violacoes;
}

/** So as violacoes com severidade `warn` (as que registram e seguem). */
export function avisos(violacoes: ViolacaoDePolicy[]): ViolacaoDePolicy[] {
  return violacoes.filter((v) => v.severidade === 'warn');
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

/** RM-008 (fatia 3): as linhas de aviso (policies em warn) para a saida do CLI. Nada quando nao ha aviso. */
export function linhasDeAviso(violacoes: ViolacaoDePolicy[], recuo = '  '): string[] {
  return avisos(violacoes).flatMap((v) => [
    `${recuo}aviso da policy ${v.policy}: ${v.detalhe}`,
    `${recuo}  correcao: ${v.correcao}`,
  ]);
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
