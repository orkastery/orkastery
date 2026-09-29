/**
 * `ork verify` e `ork verify --baseline` (bloco B1).
 *
 * Duas verdades diferentes, ambas reexecutadas no HEAD REAL, nunca lidas de relatorio:
 *
 *   1. CLAIMS: cada alegacao registrada tem o seu comando reexecutado agora. Passou =
 *      `verificado: sim`. Falhou = `claims.failed`. Alegacao negativa sem comando
 *      tambem reprova: e o caso EvoJ6, em que a frase absoluta falsa passou batido.
 *   2. BASELINE: os comandos de `verify:` do manifesto rodam antes do GO e ficam
 *      gravados. No CHECK eles rodam de novo, e a diferenca separa REGRESSAO (passava e
 *      agora falha) de DIVIDA PRE-EXISTENTE (ja falhava). Sem baseline, a falha e
 *      declarada como `verify.failed`, e nao como regressao que nao da para provar.
 */

import { lerClaims, carimbarEstado, registrarCriteriosDePronto } from './claims';
import { registrarGateBloqueado } from './gates';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { dirThread, gravarThread, lerThread } from './thread';
import {
  Baseline,
  CanalDeConducao,
  CausaDoComando,
  Manifesto,
  MotivoGate,
  OperacaoDeConducao,
  ResultadoDeClaim,
  ResultadoDeComando,
  Thread,
} from './types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { agora, exec } from './util';
import { formatarDataHoraRotulada } from './horario';
import { redigirSaida, testesQueCairam } from './redacao-saida';
import { redigirCredenciaisUrl } from './redacao-url';
import { canalDoProcesso, comConducao, ConducaoTomada, identidadeDoAmbiente, prazoDaVerificacao } from './conducao';

/** Teto de tempo de um comando de verificacao (build e suite completa cabem). */
export const TIMEOUT_VERIFY_MS = 10 * 60 * 1000;

/** Ultimas linhas da saida real, o suficiente para servir de evidencia no ledger. */
function resumirSaida(stdout: string, stderr: string): string {
  const bruto = (stdout + (stderr ? '\n' + stderr : '')).trim();
  const linhas = bruto.split('\n').filter((l) => l.trim() !== '');
  return linhas.slice(-10).join('\n').slice(-800);
}

/** `timeout(1)` (GNU coreutils ou uutils): no estouro sinaliza o GRUPO de processos
 * inteiro, nao so o filho direto. Os dois se poem no proprio grupo e devolvem 124. */
const TIMEOUT_BIN = '/usr/bin/timeout';

/**
 * I-37 (D5, D6, D7): o comando de verificacao nunca herda a autoridade HITL.
 *
 * Um comando que prova uma alegacao nao pode agir como o dono: com a chave de ingresso e os
 * ids do canal no ambiente, ele conseguiria responder um gate. Sai todo `ORK_HITL_*` (as seis
 * variaveis do PLAN mais as do OpenClaw, que vieram depois), so no executor de verify, e sem
 * valvula de escape: comando que precise delas vira escalacao para humano.
 */
export const PREFIXO_BLOQUEADO_NO_VERIFY = 'ORK_HITL_';

export function ambienteDoVerify(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([chave]) => !chave.startsWith(PREFIXO_BLOQUEADO_NO_VERIFY)));
}

/** I-37 (D2): o prazo de um comando, resolvido uma vez por rodada (D3). */
export function prazoDoComando(manifesto: Manifesto, nome: string): number {
  const porComando = manifesto.verify.timeout_ms_por_comando as Record<string, number | undefined> | undefined;
  return porComando?.[nome] ?? manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS;
}

/**
 * Executa um comando de verificacao pelo shell, no diretorio de trabalho da thread.
 *
 * O `exec` sozinho mata so o `bash` quando estoura o teto: npm, tsc e node --test
 * ficavam orfaos, rodando sem dono. Em 21/09/2026 isso acumulou ate 38 builds de teste
 * presos e travou a VPS. Com o `timeout` na frente, o estouro leva a arvore inteira; e se
 * o proprio `ork` morrer no meio, o `timeout` segue de pe e encerra o grupo no prazo.
 * O estouro continua saindo como `code: -1`, o contrato de antes.
 */
export function executar(nome: string, comando: string, cwd: string,
  tetoMs = TIMEOUT_VERIFY_MS): ResultadoDeComando {
  const comGrupo = existsSync(TIMEOUT_BIN);
  const inicio = Date.now();
  const ambiente = ambienteDoVerify();
  const r = comGrupo
    ? exec(TIMEOUT_BIN, ['--kill-after=15', `${Math.ceil(tetoMs / 1000)}`, 'bash', '-c', comando],
      cwd, tetoMs + 30_000, ambiente)
    : exec('bash', ['-c', comando], cwd, tetoMs, ambiente);
  const duracaoMs = Date.now() - inicio;
  const causa = causaDoEncerramento({ code: r.code, signal: r.signal ?? null, error: r.error, comGrupo, duracaoMs, tetoMs });
  const estourou = causa === 'timeout';
  const resultado: ResultadoDeComando = {
    nome,
    comando,
    ok: r.ok,
    code: estourou ? -1 : r.code,
    resumo: resumirSaida(r.stdout, r.stderr),
    causa,
    prazoMs: tetoMs,
    duracaoMs,
    // I-54 (D11): so nao rodou o que o sistema recusou lancar; estouro e sinal rodaram e acabaram.
    executado: !(r.error && NAO_LANCADO.has(r.error)),
  };
  if (!r.ok) {
    const saida = r.stdout + (r.stderr ? '\n' + r.stderr : '');
    const testes = testesQueCairam(saida);
    if (testes.length > 0) resultado.testeQueCaiu = testes;
    resultado.trecho = redigirSaida(saida);
  }
  return resultado;
}

/** I-54 (D11): erros de spawn em que o processo nem chegou a existir. */
const NAO_LANCADO: ReadonlySet<string> = new Set(['ENOENT', 'EACCES', 'EAGAIN', 'ENOMEM', 'EPERM', 'EMFILE']);

/**
 * I-54 (RM-037, D11): a identidade do produto que a rodada verifica. HEAD, o diff contra ele e o
 * conteudo dos arquivos nao rastreados (o que o `.gitignore` exclui, como `dist/`, fica fora). O
 * mtime nao entra: `touch` o engana, e identidade e conteudo. O `.orkastery/` fica fora sempre: e
 * o estado do proprio `ork` (ledger, claims), que a rodada escreve enquanto verifica.
 */
const FORA_DO_PRODUTO = [':(exclude).orkastery'];
export function identidadeDoProduto(cwd: string): string {
  const h = createHash('sha256');
  h.update(exec('git', ['rev-parse', 'HEAD'], cwd).stdout);
  h.update(exec('git', ['diff', 'HEAD', '--no-ext-diff', '--binary', '--', '.', ...FORA_DO_PRODUTO], cwd).stdout);
  const soltos = exec('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...FORA_DO_PRODUTO], cwd).stdout
    .split('\0').filter(Boolean).sort();
  for (const arquivo of soltos) {
    h.update(arquivo + '\0');
    try { h.update(readFileSync(join(cwd, arquivo))); } catch { h.update('<ilegivel>'); }
  }
  return h.digest('hex');
}

/**
 * I-37 (T3): por que o comando terminou, a partir do que o processo devolveu.
 *
 * Pelo `timeout(1)`, 124 e o estouro e 137 o SIGKILL do `--kill-after`, e so contam como
 * estouro quando o tempo corrido chegou ao prazo. Sem ele, o proprio spawnSync mata por prazo e
 * devolve `ETIMEDOUT`. Comando que o shell nao achou sai 127. Morte por sinal aparece no
 * `signal` do processo ou, no GNU `timeout`, como 128 + sinal (o uutils devolve so o numero,
 * que fica indistinguivel de um `exit` e e tratado como tal).
 */
export function causaDoEncerramento(r: { code: number; signal: string | null; error?: string; comGrupo: boolean;
  duracaoMs: number; tetoMs: number }): CausaDoComando {
  const estourou = (r.comGrupo && (r.code === 124 || r.code === 137) && r.duracaoMs >= r.tetoMs - 1000)
    || (!r.comGrupo && r.error === 'ETIMEDOUT');
  if (estourou) return 'timeout';
  if (r.error === 'ENOENT' || r.code === 127) return 'nao-encontrado';
  if (r.signal || (r.comGrupo && r.code > 128 && r.code < 160)) return 'sinal';
  return 'exit';
}

/** I-37 (D8): o que o ledger grava de um comando. Sucesso e o codigo 0; falha leva a evidencia. */
export function comandoNoLedger(c: ResultadoDeComando): Record<string, unknown> {
  if (c.ok) return { nome: c.nome, ok: true, code: c.code };
  return {
    nome: c.nome, comando: redigirCredenciaisUrl(c.comando), ok: false, code: c.code,
    ...(c.causa ? { causa: c.causa } : {}),
    ...(c.prazoMs !== undefined ? { prazoMs: c.prazoMs } : {}),
    ...(c.duracaoMs !== undefined ? { duracaoMs: c.duracaoMs } : {}),
    ...(c.testeQueCaiu?.length ? { testeQueCaiu: c.testeQueCaiu } : {}),
    ...(c.trecho !== undefined ? { trecho: c.trecho } : {}),
  };
}

/** Comandos declarados em `verify:` no manifesto, na ordem canonica. */
export function comandosDoManifesto(manifesto: Manifesto): { nome: string; comando: string }[] {
  const lista: { nome: string; comando: string }[] = [];
  for (const nome of ['typecheck', 'build', 'test'] as const) {
    const comando = manifesto.verify[nome];
    if (comando && comando.trim() !== '') lista.push({ nome, comando });
  }
  return lista;
}

/** Diretorio onde a verificacao roda: a worktree da thread, ou a raiz do projeto. */
export function cwdDaThread(raiz: string, thread: Thread): string {
  return thread.worktree ?? raiz;
}

/** HEAD real do diretorio de trabalho, carimbado em toda verificacao. */
export function commitReal(cwd: string): string {
  const r = exec('git', ['rev-parse', 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : 'desconhecido';
}

/**
 * I-36 (T4): quem executa na worktree precisa da conducao da thread. A identidade de despacho do
 * ambiente faz a sessao que ja conduz reentrar (D4); o canal sai da borda (D6).
 */
export interface ConducaoDoVerify {
  canal?: CanalDeConducao;
  correlacao?: string | null;
  identidade?: string | null;
  /** `--esperar`: espera a vez ate este prazo em vez de recusar na hora (D2). */
  esperarMs?: number;
}

/** O pedido de conducao de uma verificacao, com o prazo derivado dos comandos que ela vai rodar (D3). */
function pedidoDoVerify(carregado: ManifestoCarregado, threadId: string, operacao: OperacaoDeConducao, comandos: number,
  conducao: ConducaoDoVerify) {
  return {
    canal: conducao.canal ?? canalDoProcesso(),
    correlacao: conducao.correlacao ?? null,
    operacao,
    identidade: conducao.identidade ?? identidadeDoAmbiente(threadId, process.env, carregado.raiz),
    prazoMs: prazoDaVerificacao(carregado.manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS, comandos),
    esperarMs: conducao.esperarMs,
  };
}

/** O executor que renova o prazo da conducao antes de cada comando (D3). */
function executorSobConducao(base: ExecutorVerify, manifesto: Manifesto, conducao: ConducaoTomada): ExecutorVerify {
  return (nome, comando, cwd) => {
    conducao.renovar(prazoDoComando(manifesto, nome));
    return base(nome, comando, cwd);
  };
}

/** `ork verify --baseline`: grava o estado do mundo ANTES do GO. */
export function gravarBaseline(carregado: ManifestoCarregado, threadId: string, executor: ExecutorVerify = executar,
  conducao: ConducaoDoVerify = {}): Baseline {
  const pedido = pedidoDoVerify(carregado, threadId, 'baseline', comandosDoManifesto(carregado.manifesto).length, conducao);
  return comConducao(carregado.raiz, threadId, pedido,
    (tomada) => gravarBaselineSobConducao(carregado, threadId, executorSobConducao(executor, carregado.manifesto, tomada)));
}

function gravarBaselineSobConducao(carregado: ManifestoCarregado, threadId: string, executor: ExecutorVerify): Baseline {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const cwd = cwdDaThread(raiz, thread);
  const comandos = comandosDoManifesto(manifesto).map((c) => executor(c.nome, c.comando, cwd));
  const baseline: Baseline = { commit: commitReal(cwd), gravadaEm: agora(), comandos };

  thread.baseline = baseline;
  gravarThread(raiz, thread);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.baselineGravada, {
    commit: baseline.commit,
    cwd,
    comandos: comandos.map((c) => ({ nome: c.nome, comando: c.comando, ok: c.ok, code: c.code })),
    fonte: 'execucao real no HEAD, nao relatorio de fase',
  });
  return baseline;
}

export interface ResultadoVerify {
  thread: string;
  commit: string;
  cwd: string;
  claims: ResultadoDeClaim[];
  comandos: ResultadoDeComando[];
  baseline: Baseline | null;
  /** Passava na baseline e falha agora. */
  regressoes: ResultadoDeComando[];
  /** Ja falhava na baseline: divida pre-existente, nao regressao desta thread. */
  preExistentes: ResultadoDeComando[];
  /** Falhou sem baseline para comparar: declarado como tal, nao chamado de regressao. */
  falhasSemBaseline: ResultadoDeComando[];
  /** I-37 (D1): estourou o prazo sem terminar. Nem regressao nem falha: nao ha veredito. */
  estouros: ResultadoDeComando[];
  /** I-54 (D10): o preparo unico da rodada, quando o manifesto declara `verify.preparo`. */
  preparo: { resultado: ResultadoDeComando; identidade: string; identidadeFinal: string; produtoAlterado: boolean } | null;
  motivos: MotivoGate[];
  /** True quando nenhum motivo BLOQUEANTE apareceu. */
  ok: boolean;
}

/** Dependência interna; nunca desserializada de argumentos CLI/MCP. */
export type ExecutorVerify = (nome: string, comando: string, cwd: string) => ResultadoDeComando;

export interface OpcoesVerify {
  executor?: ExecutorVerify;
  /** Nao roda os comandos do manifesto, so as claims (usado em verificacao rapida). */
  soClaims?: boolean;
  /** I-36: canal, identidade e espera da conducao desta verificacao. */
  conducao?: ConducaoDoVerify;
  /** I-36: quem pede a verificacao (default `verify`); o MCP declara `mcp.verify`. */
  operacao?: OperacaoDeConducao;
}

/**
 * Reexecuta a claim no HEAD real e devolve o veredito com o motivo tipado.
 *
 * Exportada para o bloco B5: as claims dos ACHADOS de auditoria passam por este mesmo
 * julgamento, sem uma segunda regra paralela que pudesse ser mais frouxa.
 */
export function verificarClaim(claim: ResultadoDeClaim['claim'], cwd: string, executor: ExecutorVerify = executar): ResultadoDeClaim {
  if (claim.verificar.length === 0) {
    const negativa = claim.negativa;
    return {
      claim,
      verificado: false,
      // Alegacao negativa sem comando e reprovacao (caso EvoJ6); positiva e aviso.
      motivo: negativa ? 'claims.failed' : 'claims.unverifiable',
      detalhe: negativa
        ? 'alegacao negativa/absoluta sem comando de verificacao: nao ha como comprova-la'
        : 'sem comando de verificacao declarado',
      execucoes: [],
    };
  }
  const execucoes = claim.verificar.map((c, i) => executor(`${claim.id}.${i + 1}`, c, cwd));
  // I-54 (D11): comando que nao rodou nao tem veredito, e lista vazia de execucao nunca aprova.
  const naoRodou = execucoes.find((e) => e.executado === false);
  if (naoRodou) {
    return {
      claim,
      verificado: false,
      motivo: 'verify.sem-veredito',
      detalhe: `comando "${redigirCredenciaisUrl(naoRodou.comando)}" nao foi executado: ${naoRodou.resumo}`,
      execucoes,
    };
  }
  const falhou = execucoes.find((e) => !e.ok);
  // I-37 (D1): estouro de prazo nao desmente a alegacao; a prova so nao chegou ao fim.
  const estourou = falhou?.causa === 'timeout';
  return {
    claim,
    verificado: !falhou,
    motivo: falhou ? (estourou ? 'verify.timeout' : 'claims.failed') : null,
    detalhe: falhou
      ? estourou
        ? `comando "${falhou.comando}" estourou o prazo de ${Math.round((falhou.prazoMs ?? 0) / 1000)} s sem terminar`
        : `comando "${redigirCredenciaisUrl(falhou.comando)}" saiu com codigo ${falhou.code}`
      : `${execucoes.length} comando(s) reexecutado(s) com sucesso`,
    execucoes,
  };
}

/**
 * `ork verify`: reexecuta claims e comandos do manifesto e classifica cada falha.
 * Nao decide pausa, decide VERDADE: quem pausa e o gate do modo de conducao.
 */
export function verificar(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesVerify = {}
): ResultadoVerify {
  // I-36 (T4): sem a conducao da thread, nenhum comando roda; a recusa sai tipada, com quem conduz.
  const planejados = lerClaims(carregado.raiz, threadId).filter((c) => c.estado !== 'retirada')
    .reduce((n, c) => n + c.verificar.length, 0) + (opcoes.soClaims ? 0 : comandosDoManifesto(carregado.manifesto).length) + 1;
  const pedido = pedidoDoVerify(carregado, threadId, opcoes.operacao ?? 'verify', planejados, opcoes.conducao ?? {});
  return comConducao(carregado.raiz, threadId, pedido, (tomada) => verificarSobConducao(carregado, threadId, opcoes, tomada, pedido.canal));
}

function verificarSobConducao(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesVerify,
  conducao: ConducaoTomada,
  canal: CanalDeConducao
): ResultadoVerify {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, threadId);
  const cwd = cwdDaThread(raiz, thread);
  const commit = commitReal(cwd);
  const dir = dirThread(raiz, threadId);

  // I-43 (D4, viga b): os criterios de pronto da thread viram claims do nucleo ANTES
  // da reexecucao, para entrarem no MESMO veredito das demais alegacoes. Idempotente:
  // `ork verify` roda em toda fase, e uma claim por criterio por rodada viraria
  // acumulador em vez de verificacao.
  registrarCriteriosDePronto(raiz, threadId);

  // I-37 (D2, D3): o prazo de cada comando sai do manifesto carregado no inicio da rodada;
  // editar o manifesto no meio dela nao muda o teto de quem ainda vai rodar.
  const executor: ExecutorVerify = executorSobConducao(opcoes.executor
    ?? ((nome, comando, dirDeTrabalho) => executar(nome, comando, dirDeTrabalho, prazoDoComando(manifesto, nome))), manifesto, conducao);

  // I-54 (D10): o preparo roda UMA vez, antes das claims. Ele nunca e condicao para uma claim
  // passar (cada uma roda o proprio comando inteiro); ele so deixa pronta a compilacao. A
  // identidade do produto e tomada logo depois dele e conferida no fim da rodada.
  const preparo = manifesto.verify.preparo ? (() => {
    const resultado = executor('preparo', manifesto.verify.preparo!, cwd);
    return { resultado, identidade: identidadeDoProduto(cwd) };
  })() : null;

  // Claim retirada sai do gate: o historico guarda a alegacao e o motivo da retirada.
  const claims = lerClaims(raiz, threadId)
    .filter((c) => c.estado !== 'retirada')
    .map((c) => verificarClaim(c, cwd, executor));
  for (const r of claims) {
    // Estouro de prazo e comando que nao rodou nao julgam a alegacao: o estado anterior vale.
    if (r.motivo === 'verify.timeout' || r.motivo === 'verify.sem-veredito') continue;
    const estado = r.verificado
      ? 'verificado'
      : r.motivo === 'claims.unverifiable'
        ? 'nao-verificavel'
        : 'reprovado';
    if (r.claim.estado !== estado) carimbarEstado(raiz, r.claim, estado);
  }

  const comandos = opcoes.soClaims
    ? []
    : comandosDoManifesto(manifesto).map((c) => executor(c.nome, c.comando, cwd));

  const baseline = thread.baseline ?? null;
  const regressoes: ResultadoDeComando[] = [];
  const preExistentes: ResultadoDeComando[] = [];
  const falhasSemBaseline: ResultadoDeComando[] = [];
  const estouros: ResultadoDeComando[] = [];
  for (const atual of comandos) {
    if (atual.ok) continue;
    if (atual.causa === 'timeout') {
      estouros.push(atual);
      continue;
    }
    const antes = baseline?.comandos.find((c) => c.nome === atual.nome);
    if (!antes) falhasSemBaseline.push(atual);
    else if (antes.ok) regressoes.push(atual);
    else preExistentes.push(atual);
  }

  // I-54 (D11): o produto mudou entre o preparo e o fim da rodada? Entao nenhum veredito vale.
  const identidadeFinal = preparo ? identidadeDoProduto(cwd) : null;
  const produtoAlterado = !!preparo && identidadeFinal !== preparo.identidade;
  const naoExecutados = comandos.filter((c) => c.executado === false);

  const motivos: MotivoGate[] = [];
  if (claims.some((c) => c.motivo === 'claims.failed')) motivos.push('claims.failed');
  if (claims.some((c) => c.motivo === 'claims.unverifiable')) motivos.push('claims.unverifiable');
  if (regressoes.length > 0) motivos.push('verify.regression');
  if (falhasSemBaseline.length > 0) motivos.push('verify.failed');
  if (estouros.length > 0 || claims.some((c) => c.motivo === 'verify.timeout')) motivos.push('verify.timeout');
  if (produtoAlterado || naoExecutados.length > 0 || claims.some((c) => c.motivo === 'verify.sem-veredito')) {
    motivos.push('verify.sem-veredito');
  }

  const bloqueantes = motivos.filter((m) => m !== 'claims.unverifiable');
  const ok = bloqueantes.length === 0;

  registrar(dir, threadId, TIPOS_DE_EVENTO.verificacao, {
    commit,
    cwd,
    claims: claims.map((c) => {
      const falhou = c.execucoes.find((e) => !e.ok);
      return {
        id: c.claim.id,
        verificado: c.verificado,
        motivo: c.motivo,
        detalhe: c.detalhe,
        ...(falhou ? { execucao: comandoNoLedger(falhou) } : {}),
      };
    }),
    comandos: comandos.map(comandoNoLedger),
    baseline: baseline ? { commit: baseline.commit, gravadaEm: baseline.gravadaEm } : null,
    regressoes: regressoes.map((r) => r.nome),
    preExistentes: preExistentes.map((r) => r.nome),
    falhasSemBaseline: falhasSemBaseline.map((r) => r.nome),
    estouros: estouros.map((r) => r.nome),
    prazoMs: manifesto.verify.timeout_ms ?? TIMEOUT_VERIFY_MS,
    ...(preparo ? { preparo: { ...comandoNoLedger(preparo.resultado), duracaoMs: preparo.resultado.duracaoMs,
      identidade: preparo.identidade.slice(0, 16), identidadeFinal: identidadeFinal!.slice(0, 16), produtoAlterado } } : {}),
    motivos,
    veredito: ok ? 'verdade sustentada' : 'reprovado',
    // I-36: por qual canal a verificacao chegou; a reentrada da sessao que conduz aparece aqui.
    canal,
    conducao: { identidade: conducao.identidade, reentrada: conducao.reentrada },
  });

  for (const motivo of bloqueantes) {
    registrarGateBloqueado(dir, threadId, {
      gate: 'verify',
      motivo,
      modo: thread.modo,
      detalhe:
        motivo === 'claims.failed'
          ? claims
              .filter((c) => c.motivo === 'claims.failed')
              .map((c) => `${c.claim.id}: ${c.detalhe}`)
              .join('; ')
          : motivo === 'verify.regression'
            ? `regressao em: ${regressoes.map((r) => r.nome).join(', ')}`
            : motivo === 'verify.timeout'
              ? `estourou o prazo sem terminar: ${[...estouros.map((r) => r.nome),
                ...claims.filter((c) => c.motivo === 'verify.timeout').map((c) => c.claim.id)].join(', ')}`
              : motivo === 'verify.sem-veredito'
                ? [produtoAlterado ? 'o produto mudou entre o preparo e o fim da rodada' : '',
                  ...naoExecutados.map((c) => `${c.nome} nao foi executado`),
                  ...claims.filter((c) => c.motivo === 'verify.sem-veredito').map((c) => `${c.claim.id}: ${c.detalhe}`)]
                  .filter(Boolean).join('; ')
                : `falha sem baseline em: ${falhasSemBaseline.map((r) => r.nome).join(', ')}`,
      evidencia: `reexecucao no HEAD ${commit} em ${cwd}`,
      correcao:
        motivo === 'claims.failed'
          ? 'corrija o artefato ou a alegacao e rode `ork verify` de novo'
          : motivo === 'verify.timeout'
            ? 'rode `ork verify` de novo; se estourar sempre, suba verify.timeout_ms no manifesto ou divida o comando'
            : motivo === 'verify.sem-veredito'
              ? 'rode `ork verify` de novo, sem editar a worktree durante a rodada'
              : 'corrija a regressao, ou grave a baseline antes do GO com `ork verify <thread> --baseline`',
    });
  }

  return {
    thread: threadId,
    commit,
    cwd,
    claims,
    comandos,
    baseline,
    regressoes,
    preExistentes,
    falhasSemBaseline,
    estouros,
    preparo: preparo ? { ...preparo, identidadeFinal: identidadeFinal!, produtoAlterado } : null,
    motivos,
    ok,
  };
}

/** `FALHOU (codigo 1)`, ou `ESTOUROU O PRAZO (600 s, rodou 612 s)`: a causa e dita pelo nome. */
function situacaoDoComando(c: ResultadoDeComando): string {
  const s = (ms?: number) => `${Math.round((ms ?? 0) / 1000)} s`;
  if (c.causa === 'timeout') return `ESTOUROU O PRAZO (${s(c.prazoMs)}, rodou ${s(c.duracaoMs)})`;
  if (c.causa === 'nao-encontrado') return `NAO EXECUTOU (comando nao encontrado, codigo ${c.code})`;
  if (c.causa === 'sinal') return `MORTO POR SINAL (codigo ${c.code})`;
  return `FALHOU (codigo ${c.code})`;
}

/** Texto de `ork verify`. */
export function textoDoVerify(r: ResultadoVerify): string {
  const linhas: string[] = [];
  linhas.push(`ork verify da thread ${r.thread}`);
  linhas.push(`  HEAD real   ${r.commit}`);
  linhas.push(`  diretorio   ${r.cwd}`);
  linhas.push(
    `  baseline    ${r.baseline ? `${r.baseline.commit.slice(0, 8)} de ${formatarDataHoraRotulada(r.baseline.gravadaEm)}` : '(nao gravada: falha nao pode ser chamada de regressao)'}`
  );
  if (r.preparo) {
    const p = r.preparo;
    linhas.push(`  preparo     ${p.resultado.ok ? 'ok' : situacaoDoComando(p.resultado)} em ` +
      `${Math.round((p.resultado.duracaoMs ?? 0) / 1000)} s, uma vez para a rodada; produto ` +
      `${p.produtoAlterado ? 'MUDOU no meio da rodada: nenhum veredito vale' : 'conferido do preparo ao fim'}`);
  }
  linhas.push('');
  linhas.push('Claims reexecutadas no HEAD real:');
  if (r.claims.length === 0) {
    linhas.push('  (nenhuma claim registrada nesta thread)');
  }
  for (const c of r.claims) {
    linhas.push(
      `  ${c.claim.id}  verificado: ${c.verificado ? 'sim' : 'NAO'}  ${c.claim.alegacao}`
    );
    linhas.push(`      arquivo: ${c.claim.arquivo}`);
    linhas.push(
      `      ${c.claim.verificar.length > 0 ? `comando(s): ${c.claim.verificar.join(' && ')}` : 'sem comando de verificacao'}`
    );
    if (!c.verificado) linhas.push(`      motivo tipado: ${c.motivo} (${c.detalhe})`);
  }
  if (r.comandos.length > 0) {
    linhas.push('');
    linhas.push('Comandos de verify do manifesto:');
    for (const c of r.comandos) {
      linhas.push(`  ${c.nome.padEnd(10)} ${c.ok ? 'ok' : situacaoDoComando(c)}  ${c.comando}`);
      if (!c.ok && c.testeQueCaiu?.length) linhas.push(`             teste(s) que caiu(ram): ${c.testeQueCaiu.join('; ')}`);
    }
  }
  if (r.estouros.length > 0) {
    linhas.push('');
    linhas.push(`Estouro de prazo (nao e reprovacao, a prova nao terminou): ${r.estouros.map((c) => c.nome).join(', ')}`);
  }
  if (r.regressoes.length > 0 || r.preExistentes.length > 0 || r.falhasSemBaseline.length > 0) {
    linhas.push('');
    linhas.push(
      `Classificacao: ${r.regressoes.length} regressao(oes), ` +
        `${r.preExistentes.length} pre-existente(s), ` +
        `${r.falhasSemBaseline.length} falha(s) sem baseline`
    );
    for (const c of r.regressoes) linhas.push(`  regressao      ${c.nome}: ${c.comando}`);
    for (const c of r.preExistentes) linhas.push(`  pre-existente  ${c.nome}: ${c.comando}`);
    for (const c of r.falhasSemBaseline) linhas.push(`  sem baseline   ${c.nome}: ${c.comando}`);
  }
  linhas.push('');
  linhas.push(
    r.ok
      ? 'Veredito: VERDADE SUSTENTADA (nenhum motivo bloqueante).'
      : `Veredito: REPROVADO. Motivos tipados: ${r.motivos.join(', ')}`
  );
  return linhas.join('\n');
}
