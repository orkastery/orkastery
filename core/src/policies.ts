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
import { msg } from './locale';

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
  provaLocalReprovada?: { claim: string; comando: string; code: number; estourou: boolean; prazoMs: number; semDiretorio?: string };
  /**
   * RM-062 (F2), gates `verify` e `ci.prepare`: o resultado da varredura de dado privado, sem o valor casado. Sem o
   * fato, a regra nao avalia (com a policy fora do manifesto, ninguem varre).
   */
  dadoPrivado?: FatosDoDadoPrivado;
}

/** RM-062 (F2): o que a policy `dado_privado` sabe da varredura. Nenhum campo leva o valor casado nem o termo. */
export interface FatosDoDadoPrivado {
  achados: number;
  /** Os padroes achados, sem repeticao (`home`, `email`, `hostname`, `lista-local`). */
  padroes: string[];
  /** Ate dez `arquivo:linha` (ou `arquivo (nome)`), com o caminho ja mascarado. */
  onde: string[];
  /** A lista local de termos privados foi lida. */
  listaLocal: boolean;
  /** O que foi varrido, em uma frase (o diff contra a base, o bundle). */
  escopo: string;
  /** A varredura nao rodou: arquivo de excecoes fora do contrato, lista local versionada ou git sem resposta. */
  erro: string | null;
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
export const PADROES_DE_SEGREDO: readonly { nome: string; regex: RegExp }[] = [
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

/** Resultado seguro da transformação: categorias e quantidade, nunca o valor casado. */
export interface RedacaoDeSegredo {
  texto: string;
  categorias: string[];
  total: number;
}

/** Resultado fechado da varredura das representacoes aceitas pela telemetria de prompts. */
export type RedacaoDeRepresentacoes = RedacaoDeSegredo & { ok: true } | {
  ok: false;
  texto: '';
  categorias: [];
  total: 0;
  erro: 'representacao-invalida' | 'limite-excedido';
};

const LIMITE_PADRAO_DAS_REPRESENTACOES = 4 * 1024 * 1024;

interface PadraoSeparado { nome: string; regex: RegExp }

/**
 * As mesmas familias do catalogo, admitindo espaco ou quebra de linha dentro do valor. O prefixo
 * continua contiguo para nao transformar prosa comum em candidato de credencial. O casamento
 * inteiro e removido; o espaco final, quando houver, fica fora do intervalo substituido.
 */
const PADROES_DE_SEGREDO_SEPARADO: readonly PadraoSeparado[] = [
  { nome: 'chave da Anthropic', regex: /sk-ant-(?:[A-Za-z0-9_-]\s*){16,}/g },
  { nome: 'chave do OpenRouter', regex: /sk-or-v1-(?:[A-Za-z0-9]\s*){32,}/g },
  { nome: 'chave da OpenAI', regex: /sk-(?:[A-Za-z0-9]\s*){32,}/g },
  { nome: 'chave de acesso AWS', regex: /AKIA(?:[0-9A-Z]\s*){16}/g },
  { nome: 'token do GitHub', regex: /gh[pousr]_(?:[A-Za-z0-9]\s*){20,}/g },
];

function acrescentarCategorias(destino: Set<string>, origem: readonly string[]): void {
  for (const categoria of origem) destino.add(categoria);
}

function redigirSeparadores(texto: string, marcador: string): RedacaoDeSegredo {
  let redigido = texto, total = 0;
  const categorias = new Set<string>();
  for (const padrao of PADROES_DE_SEGREDO_SEPARADO) {
    padrao.regex.lastIndex = 0;
    redigido = redigido.replace(padrao.regex, (casado) => {
      const fim = casado.match(/\s+$/u)?.[0] ?? '';
      categorias.add(padrao.nome);
      total += 1;
      return marcador + fim;
    });
  }
  return { texto: redigido, categorias: [...categorias], total };
}

function decodificarBase64Canonico(candidato: string): string | null {
  const semPadding = candidato.replace(/=+$/u, '');
  if (semPadding.length < 20 || semPadding.length % 4 === 1) return null;
  const alfabetoUrl = /[-_]/u.test(semPadding);
  if (alfabetoUrl && /[+/]/u.test(semPadding)) return null;
  const normalizado = semPadding.replace(/-/gu, '+').replace(/_/gu, '/');
  try {
    const bytes = Buffer.from(normalizado + '='.repeat((4 - normalizado.length % 4) % 4), 'base64');
    const volta = bytes.toString('base64').replace(/=+$/u, '');
    if (volta !== normalizado) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

function redigirBase64(texto: string, marcador: string): RedacaoDeSegredo {
  let total = 0;
  const categorias = new Set<string>();
  const regex = /[A-Za-z0-9+/_-]{20,}={0,2}/g;
  const redigido = texto.replace(regex, (candidato, deslocamento: number, entrada: string) => {
    const anterior = deslocamento > 0 ? entrada[deslocamento - 1] : '';
    const posterior = entrada[deslocamento + candidato.length] ?? '';
    if (/[A-Za-z0-9+/_=-]/u.test(anterior) || /[A-Za-z0-9+/_=-]/u.test(posterior)) return candidato;
    const decodificado = decodificarBase64Canonico(candidato);
    if (decodificado === null) return candidato;
    const literal = redigirSegredos(decodificado, marcador);
    const separado = redigirSeparadores(literal.texto, marcador);
    if (literal.total + separado.total === 0) return candidato;
    acrescentarCategorias(categorias, literal.categorias);
    acrescentarCategorias(categorias, separado.categorias);
    total += literal.total + separado.total;
    return marcador;
  });
  return { texto: redigido, categorias: [...categorias], total };
}

function redigirSemJson(texto: string, marcador: string): RedacaoDeSegredo {
  const literal = redigirSegredos(texto, marcador);
  const separado = redigirSeparadores(literal.texto, marcador);
  const base64 = redigirBase64(separado.texto, marcador);
  return { texto: base64.texto, total: literal.total + separado.total + base64.total,
    categorias: [...new Set([...literal.categorias, ...separado.categorias, ...base64.categorias])] };
}

function pareceStringJsonDeSegredo(token: string): boolean {
  return /(?:sk-|AKIA|gh[pousr]_).*\\/isu.test(token);
}

/**
 * Redige o catalogo no texto bruto, em tokens separados, em strings JSON e em Base64/Base64URL.
 * A funcao nunca devolve o candidato que falhou: uma string JSON com aparencia de segredo mas
 * escape invalido fecha a preparacao antes que o chamador possa mapear o prompt.
 */
export function redigirRepresentacoesDeSegredo(texto: string, marcador = '[segredo omitido]',
  limiteBytes = LIMITE_PADRAO_DAS_REPRESENTACOES): RedacaoDeRepresentacoes {
  if (Buffer.byteLength(texto) > limiteBytes) {
    return { ok: false, texto: '', categorias: [], total: 0, erro: 'limite-excedido' };
  }
  const inicial = redigirSemJson(texto, marcador);
  let falhou = false, totalJson = 0;
  const categoriasJson = new Set<string>();
  const regexStringJson = /"(?:\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4})|[^"\\\u0000-\u001f])*"|"[^"\r\n]*\\[^"\r\n]*"/g;
  const comJson = inicial.texto.replace(regexStringJson, (token) => {
    let decodificado: unknown;
    try { decodificado = JSON.parse(token) as unknown; }
    catch {
      if (pareceStringJsonDeSegredo(token)) falhou = true;
      return token;
    }
    if (typeof decodificado !== 'string') return token;
    const interno = redigirSemJson(decodificado, marcador);
    if (interno.total === 0) return token;
    totalJson += interno.total;
    acrescentarCategorias(categoriasJson, interno.categorias);
    return JSON.stringify(marcador);
  });
  if (falhou) return { ok: false, texto: '', categorias: [], total: 0, erro: 'representacao-invalida' };
  return { ok: true, texto: comJson, total: inicial.total + totalJson,
    categorias: [...new Set([...inicial.categorias, ...categoriasJson])] };
}

/**
 * Redige os mesmos padrões usados pelo gate `segredo_em_prompt`.
 *
 * A função não devolve o casamento e recompila cada expressão com `g` para que todas as
 * ocorrências sejam substituídas sem alterar o catálogo que também atende `procurarSegredos`.
 */
export function redigirSegredos(texto: string, marcador = '[segredo omitido]'): RedacaoDeSegredo {
  let redigido = texto;
  const categorias = new Set<string>();
  let total = 0;
  for (const padrao of PADROES_DE_SEGREDO) {
    const flags = [...new Set((padrao.regex.flags + 'g').split(''))].join('');
    const regex = new RegExp(padrao.regex.source, flags);
    redigido = redigido.replace(regex, () => {
      categorias.add(padrao.nome);
      total += 1;
      return marcador;
    });
  }
  return { texto: redigido, categorias: [...categorias], total };
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
  // RM-062 (F2): a barreira de dado privado. Declarada, o `ork verify` varre o diff da thread e o `ork ci prepare`, o
  // diff e o bundle; fora do manifesto, nenhum dos dois varre nada (projeto privado nao paga pelo que nao pediu).
  dado_privado: {
    quando: ['verify', 'ci.prepare'],
    descricao: 'reprova (ou avisa) quando o diff da thread ou o bundle de CI leva caminho de home, e-mail fora da lista, ' +
      'hostname de maquina ou termo da lista local',
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

/** RM-062 (F2): a severidade da policy como o manifesto a declara, ou `null` quando ele nao a declara. */
export function severidadeDeclarada(manifesto: Manifesto, nome: string): Severidade | null {
  const bruta = manifesto.policies?.[nome];
  return bruta === undefined ? null : severidade(bruta);
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
          detalhe: r.semDiretorio
            ? `a worktree da thread (${r.semDiretorio}) nao existe; o comando da claim ${r.claim} nao rodou e a claim entrou sem prova local`
            : r.estourou
            ? `o comando da claim ${r.claim} estourou o prazo do verify (${Math.round(r.prazoMs / 1000)} s) no registro; a claim entrou sem prova local`
            : `o comando da claim ${r.claim} saiu ${r.code} no registro; a claim entrou sem prova local e reprova no verify`,
          correcao: r.semDiretorio
            ? `recrie a worktree da thread (ou feche a thread que perdeu a worktree); depois, ork verify ${id}`
            : r.estourou
            ? `divida o comando ou suba verify.timeout_ms; depois, ork verify ${id}`
            : `corrija o produto ou o comando e anexe o certo com ork claims verificar ${id} ${r.claim} --comando "<comando>"; ` +
              `se a alegacao nao vale, ork claims retirar ${id} ${r.claim} --motivo "<motivo>"`,
        });
      }
      continue;
    }

    if (nome === 'dado_privado') {
      const f = ctx.dadoPrivado;
      if (!f || (f.achados === 0 && !f.erro)) continue;
      const lista = f.listaLocal ? 'com a lista local' : 'lista local ausente: so os padroes genericos';
      violacoes.push({
        policy: nome,
        severidade: sev,
        motivo: 'policy.violation',
        detalhe: f.erro
          ? `a varredura de dado privado nao rodou: ${f.erro}`
          : `${f.achados} achado(s) de dado privado (${f.padroes.join(', ')}) no ${f.escopo}, ${lista}: ` +
            `${f.onde.join(', ')}${f.achados > f.onde.length ? ', ...' : ''} (o valor casado nunca e impresso)`,
        correcao: f.erro
          ? 'corrija o orkastery.privado.json (ou tire a lista local do git) e rode de novo'
          : 'troque o dado pelo generico (maquina-a, /home/usuario, pessoa@exemplo.invalid) ou, se for exemplo inventado, ' +
            'ponha a excecao com motivo em orkastery.privado.json, revisada em PR; confira com ork privado varrer --base <base>',
      });
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
  // RM-061 (F2a): a moldura segue o locale do comando; detalhe e correcao sao dado da policy avaliada.
  const m = msg().phase;
  return avisos(violacoes).flatMap((v) => [m.avisoDaPolicy(recuo, v.policy, v.detalhe), m.avisoCorrecao(recuo, v.correcao)]);
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
