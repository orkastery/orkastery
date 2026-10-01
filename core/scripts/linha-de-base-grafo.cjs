#!/usr/bin/env node
/**
 * RM-031 KG4 (D9, D10): linha de base do protocolo de medida do grafo (`ork.graph-benchmark/v1`).
 * Script de desenvolvimento, fora do pacote publicado (core/scripts nao entra em `files`).
 *
 *   node core/scripts/linha-de-base-grafo.cjs --saida ARQ [--repeticoes N]
 *   node core/scripts/linha-de-base-grafo.cjs --validar ARQ
 *   node core/scripts/linha-de-base-grafo.cjs --protocolo ARQ --linha-de-base ARQ [--modelo M] [--revisao-do-modelo R]
 *       [--runtime R] [--versao-do-runtime V] [--esforco E] [--provedor P]
 *   node core/scripts/linha-de-base-grafo.cjs --validar-protocolo ARQ
 *   node core/scripts/linha-de-base-grafo.cjs --executar --pago --protocolo ARQ --repositorio DIR --agente JSON --saida ARQ
 *       [--transcricoes DIR] [--simulado]
 *
 * A parte deterministica (`--saida`) mede, num clone compartilhado no tmp, na revisao do HEAD: o
 * preparo do indice, completo e incremental a partir do pai; e, para cada tarefa do protocolo (as seis
 * perguntas do KG3), os dois bracos: A, a leitura crua (`git grep` e a leitura de cada arquivo com
 * ocorrencia); B, `ork grafo <consulta> --json` num processo novo. De cada braco: bytes que chegam ao
 * agente, arquivos lidos, latencia mediana e quais fatos obrigatorios aparecem no contexto. Tokens
 * ficam `unavailable`: so a sessao de agente os mede, e ela e paga.
 *
 * `--protocolo` fixa o registro v1 com `status: not-run` (tarefas, controles propostos, tratamento com
 * o grafo medido, pares AB e BA balanceados pela seed). `--executar` e o harness da rodada paga: so
 * roda com `--pago`, abre uma sessao isolada por braco com o agente dado (um array JSON, como
 * `["claude","-p","--output-format","stream-json","--verbose"]`), le a telemetria `stream-json` por
 * requisicao e grava o registro v1 avaliado. `--simulado` marca o registro como sintetico (agente de
 * teste). Sem auditoria de arestas o veredito para em `inconclusive`: a auditoria e da rodada paga.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { PERGUNTAS } = require('./medir-consulta-grafo.cjs');

const SCHEMA = 'ork.graph-baseline/v0';
const RAIZ = path.resolve(__dirname, '..', '..');
const DIST = path.join(RAIZ, 'core', 'dist');
const ORK = path.join(DIST, 'index.js');
const EXPERIMENTO = 'rm031-kg4-ab';
const SEMENTE_DA_ORDEM = 'rm031-kg4-ordem-1';
const TOKENS = Object.freeze({ value: null, source: 'unavailable', unavailable_reason: 'so a sessao de agente mede tokens; esta parte e deterministica e nao chama modelo' });
/** Fatos obrigatorios de cada tarefa: o que uma resposta completa precisa citar, conferido no codigo. */
const FATOS = Object.freeze({
  P1: ['core/src/intelligence-graph-index.ts', 'construirIndice'],
  P2: ['core/src/leases.ts', 'core/src/thread.ts', 'core/src/ship.ts'],
  P3: ['core/src/intelligence-graph-extract.ts', 'core/src/intelligence-graph-query.ts', 'core/src/intelligence-benchmark-contract.ts'],
  P4: ['core/src/manifest.ts', 'core/src/intelligence-graph-repo.ts', 'core/src/docs.ts'],
  P5: ['core/src/estado-thread.ts', 'core/src/leases.ts'],
  P6: ['core/src/index.ts', 'core/src/manifest.ts'],
});
const METODO = Object.freeze({
  grafo: 'consulta-grafo/v0: ork grafo <consulta> --json num processo novo, indice do HEAD pronto; ao agente chega a saida JSON e ele nao abre arquivo',
  cru: 'leitura-crua/v0: git grep -n -I -F do nome nos rastreados, mais a leitura inteira de cada arquivo com ocorrencia',
  fatos: 'fato presente quando o texto do fato aparece no que chega ao agente',
  preparo: 'construirIndice no mesmo processo: completo do HEAD e incremental a partir do indice do pai',
});
const LIMITES = Object.freeze([
  'bytes e arquivos nao sao tokens; a metrica primaria do protocolo (logical_total_tokens) so sai da rodada paga',
  'a leitura crua modela um agente que abre todo arquivo com ocorrencia; um agente real pode ler menos ou mais',
  'fato presente no contexto nao e fato na resposta; isso a rodada paga confere',
]);
const CONCLUSAO = 'linha de base deterministica registrada; a comparacao de tokens entre os bracos fica para a rodada paga do protocolo';
const PENDENTE = 'rodada paga do ork.graph-benchmark/v1: sessoes de agente nos dois bracos, tokens runtime_reported e auditoria integral de arestas';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const agora = () => process.hrtime.bigint();
const msDesde = (i) => Number(agora() - i) / 1e6;
const arredondar = (x) => Math.round(x * 10) / 10;
const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, maxBuffer: 256 * 1024 * 1024 });

function argumentos(argv) {
  const r = { repeticoes: 3 };
  const valores = ['saida', 'validar', 'protocolo', 'linha-de-base', 'validar-protocolo', 'modelo', 'revisao-do-modelo', 'runtime', 'versao-do-runtime',
    'esforco', 'provedor', 'repositorio', 'agente', 'transcricoes', 'repeticoes'];
  const bandeiras = ['executar', 'pago', 'simulado'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], nome = a.slice(2);
    if (!a.startsWith('--')) throw new Error(`argumento inesperado: ${a}`);
    if (bandeiras.includes(nome)) r[nome] = true;
    else if (valores.includes(nome)) {
      if (i + 1 >= argv.length) throw new Error(`${a} exige valor`);
      r[nome] = argv[++i];
    } else throw new Error(`opcao desconhecida: ${a}`);
  }
  r.repeticoes = Number(r.repeticoes);
  if (!Number.isInteger(r.repeticoes) || r.repeticoes < 1 || r.repeticoes > 20) throw new Error('--repeticoes de 1 a 20');
  return r;
}

/** O que chega ao agente contem o fato? */
const presentes = (texto, id) => FATOS[id].map((f, i) => ({ fato: `${id}-F${i + 1}`, presente: texto.includes(f) }));

function bracoGrafo(clone, p, repeticoes) {
  const latencias = [];
  let saida = '';
  for (let i = 0; i < repeticoes; i++) {
    const inicio = agora();
    const r = spawnSync(process.execPath, [ORK, 'grafo', ...p.consulta, '--json'], { cwd: clone, maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
    latencias.push(arredondar(msDesde(inicio)));
    if (r.status !== 0) throw new Error(`ork grafo ${p.consulta.join(' ')}: saida ${r.status}`);
    saida = r.stdout.toString('utf8');
  }
  const json = JSON.parse(saida);
  return {
    bytes_ao_agente: Buffer.byteLength(saida), arquivos_lidos: 0, respostas: json.total_arestas, latencia_ms: latencias,
    latencia_mediana_ms: arredondar(mediana(latencias)), fatos: presentes(saida, p.id),
  };
}

function bracoCru(clone, p, repeticoes) {
  if (p.cru.indisponivel) return { indisponivel: p.cru.indisponivel };
  const args = ['grep', '-n', '-I', '-F', ...(p.cru.palavra ? ['-w'] : []), '-e', p.cru.padrao];
  const latencias = [];
  let medida = null;
  for (let i = 0; i < repeticoes; i++) {
    const inicio = agora();
    const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: clone, maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0 && r.status !== 1) throw new Error('git grep falhou');
    const grep = r.stdout.toString('utf8'), linhas = grep.split('\n').filter(Boolean);
    const arquivos = [...new Set(linhas.map((l) => l.slice(0, l.indexOf(':'))))].sort();
    const conteudos = arquivos.map((a) => fs.readFileSync(path.join(clone, a), 'utf8'));
    latencias.push(arredondar(msDesde(inicio)));
    const contexto = [grep, ...conteudos].join('\n');
    medida = { bytes_ao_agente: Buffer.byteLength(contexto), ocorrencias: linhas.length, arquivos_lidos: arquivos.length, fatos: presentes(contexto, p.id) };
  }
  return { ...medida, latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)) };
}

/** A parte deterministica, num clone do HEAD no tmp: preparo do indice e os dois bracos de cada tarefa. */
function medir(repeticoes, log = () => undefined) {
  if (git(RAIZ, 'status', '--porcelain=v1', '--untracked-files=no').length) throw new Error('a medida precisa da arvore limpa');
  const { construirIndice, lerIndice } = require(path.join(DIST, 'intelligence-graph-index.js'));
  const { carregarAnalisadores } = require(path.join(DIST, 'intelligence-graph-parsers.js'));
  const { sha256DoCanonico } = require(path.join(DIST, 'intelligence-graph-contract.js'));
  const { digestDoConjuntoDeArestas } = require(path.join(DIST, 'intelligence-benchmark-contract.js'));
  const parser = carregarAnalisadores();
  const revisao = git(RAIZ, 'rev-parse', 'HEAD').toString('utf8').trim(), pai = git(RAIZ, 'rev-parse', 'HEAD^').toString('utf8').trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-kg4-linha-de-base-'));
  try {
    const clone = path.join(tmp, 'r');
    git(RAIZ, 'clone', '-q', '--shared', '--no-checkout', RAIZ, clone);
    const ctx = { raiz: clone, estado: clone, repositorio: 'orkastery' };
    git(clone, 'checkout', '-q', '--detach', pai);
    construirIndice(ctx, { parser });
    git(clone, 'checkout', '-q', '--detach', revisao);
    const incremental = construirIndice(ctx, { parser });
    const completo = construirIndice(ctx, { parser, forcar: true });
    if (incremental.modo !== 'incremental' || completo.estado !== 'reconstruido-identico') throw new Error('o preparo incremental nao deu os bytes da completa');
    const { grafo } = lerIndice(ctx, completo.chave);
    const m = completo.manifesto, a = incremental.reaproveitamento;
    log(`preparo: completo ${completo.ms} ms, incremental ${incremental.ms} ms a partir de ${pai.slice(0, 12)}`);
    const tarefas = PERGUNTAS.map((p) => {
      const t = { id: p.id, pergunta: p.pergunta, consulta: p.consulta, fatos: FATOS[p.id], grafo: bracoGrafo(clone, p, repeticoes), cru: bracoCru(clone, p, repeticoes), tokens: { grafo: TOKENS, cru: TOKENS } };
      log(`${t.id}: grafo ${t.grafo.bytes_ao_agente} bytes, cru ${t.cru.bytes_ao_agente ?? 'indisponivel'} bytes`);
      return t;
    });
    return {
      schema: SCHEMA, protocolo: 'kg1-ab/1', medido_em: new Date().toISOString(), revisao,
      grafo: {
        graph_digest: m.graph_digest, snapshot_id: m.snapshot_id, arestas: grafo.edges.length, edge_set_digest: digestDoConjuntoDeArestas(grafo.edges.map((e) => e.edge_id)),
        corpus_hash: sha256DoCanonico(grafo.snapshot.source_manifest), bytes_do_indice: m.graph_bytes + m.report_bytes + m.units_bytes,
      },
      ambiente: { node: process.version, plataforma: `${process.platform}-${process.arch}`, nucleos: os.cpus().length, carga_1min: arredondar(os.loadavg()[0]) },
      metodo: { ...METODO, repeticoes },
      preparo: {
        completo: { ms: completo.ms },
        incremental: { base: pai, ms: incremental.ms, ts: a.ts.modo, ts_reextraidos: a.ts.reextraidos.length, md_reextraidos: a.md.reextraidos.length },
      },
      tarefas, conclusao: CONCLUSAO, limites: LIMITES, pendente: PENDENTE,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function validar(r) {
  const f = [];
  const numero = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const tokensOk = (t) => t && t.value === null && t.source === 'unavailable' && typeof t.unavailable_reason === 'string' && t.unavailable_reason.length > 0;
  const fatosOk = (lista, id) => Array.isArray(lista) && lista.length === FATOS[id].length && lista.every((x, i) => x.fato === `${id}-F${i + 1}` && typeof x.presente === 'boolean');
  if (!r || r.schema !== SCHEMA) return [`schema ${r && r.schema}`];
  if (!/^[0-9a-f]{40}$/.test(r.revisao ?? '')) f.push('revisao');
  if (Number.isNaN(Date.parse(r.medido_em))) f.push('medido_em');
  const g = r.grafo ?? {};
  if (!/^[0-9a-f]{64}$/.test(g.graph_digest ?? '') || !/^[0-9a-f]{64}$/.test(g.edge_set_digest ?? '') || !/^[0-9a-f]{64}$/.test(g.corpus_hash ?? '')
    || !/^snap-[0-9a-f]{64}$/.test(g.snapshot_id ?? '') || !numero(g.arestas)) f.push('grafo');
  if (!r.ambiente || !r.ambiente.node || !numero(r.ambiente.nucleos)) f.push('ambiente');
  const pr = r.preparo ?? {};
  if (!numero(pr.completo && pr.completo.ms) || !numero(pr.incremental && pr.incremental.ms) || !/^[0-9a-f]{40}$/.test((pr.incremental || {}).base ?? '')) f.push('preparo');
  if (r.conclusao !== CONCLUSAO || JSON.stringify(r.limites) !== JSON.stringify(LIMITES) || r.pendente !== PENDENTE) f.push('conclusao, limites ou pendente trocados');
  const ids = (r.tarefas ?? []).map((t) => t.id);
  if (JSON.stringify(ids) !== JSON.stringify(PERGUNTAS.map((p) => p.id))) f.push(`tarefas ${ids}`);
  for (const t of r.tarefas ?? []) {
    const b = t.grafo ?? {};
    for (const k of ['bytes_ao_agente', 'arquivos_lidos', 'respostas', 'latencia_mediana_ms']) if (!numero(b[k])) f.push(`${t.id} grafo.${k}`);
    if (!fatosOk(b.fatos, t.id)) f.push(`${t.id} grafo.fatos`);
    const esperado = PERGUNTAS.find((p) => p.id === t.id);
    if (esperado && esperado.cru.indisponivel) {
      if (typeof (t.cru ?? {}).indisponivel !== 'string') f.push(`${t.id} cru.indisponivel`);
    } else {
      for (const k of ['bytes_ao_agente', 'ocorrencias', 'arquivos_lidos', 'latencia_mediana_ms']) if (!numero((t.cru ?? {})[k])) f.push(`${t.id} cru.${k}`);
      if (!fatosOk((t.cru ?? {}).fatos, t.id)) f.push(`${t.id} cru.fatos`);
    }
    if (!tokensOk(t.tokens && t.tokens.grafo) || !tokensOk(t.tokens && t.tokens.cru)) f.push(`${t.id} tokens`);
  }
  if (/econom(ia|iza)|\breduz|\bmenos tokens/i.test(JSON.stringify({ c: r.conclusao, l: r.limites }))) f.push('promessa de economia');
  return f;
}

/** O texto da pergunta de cada tarefa, igual nos dois bracos; o braco so muda o mecanismo de contexto. */
const textoDaPergunta = (t) => `No repositorio desta pasta, ${t.pergunta}? Responda com os caminhos dos arquivos e os nomes dos simbolos.`;
const INSTRUCAO = Object.freeze({
  A: 'Obtenha o contexto lendo arquivos e buscando texto (git grep, leitura de arquivo). Nao use ork grafo.',
  B: 'Obtenha o contexto pelo grafo deterministico: rode ork grafo (vizinhos, chamadores, importadores, caminho) com --json. Nao abra arquivo.',
});
const PROMPT_BASE = 'Voce responde perguntas sobre o codigo deste repositorio. Termine com a resposta completa, sem pedir confirmacao.';
const FERRAMENTAS = Object.freeze(['Bash', 'Read', 'Grep', 'Glob']);
const PARADA = 'uma resposta final por sessao; sem retomar sessao';
const promptDe = (t, braco) => `${PROMPT_BASE}\n\n${INSTRUCAO[braco]}\n\n${textoDaPergunta(t)}`;

/** Embaralhamento reproduzivel (LCG) sobre a semente textual. */
function embaralhar(itens, semente) {
  const r = [...itens];
  let s = parseInt(sha256(semente).slice(0, 8), 16) >>> 0;
  for (let i = r.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** O registro v1 com o protocolo fixado e `status: not-run`. */
function montarProtocolo(base, opcoes = {}, refDaLinhaDeBase = null) {
  const { sha256DoCanonico } = require(path.join(DIST, 'intelligence-graph-contract.js'));
  const repeticoes = opcoes.repeticoesPorTarefa ?? 10;
  const tarefasDaBase = base.tarefas.filter((t) => !opcoes.tarefas || opcoes.tarefas.includes(t.id));
  const tasks = tarefasDaBase.map((t) => ({
    task_id: t.id, question_hash: sha256(textoDaPergunta(t)), mandatory_fact_ids: FATOS[t.id].map((_, i) => `${t.id}-F${i + 1}`), claim_ids: [], verifiers: [],
  }));
  const pairs = [];
  for (const t of tasks) {
    const ordens = embaralhar(Array.from({ length: repeticoes }, (_, i) => (i % 2 === 0 ? 'AB' : 'BA')), `${SEMENTE_DA_ORDEM}:${t.task_id}`);
    ordens.forEach((order, i) => pairs.push({ pair_id: `${t.task_id}-r${i + 1}`, task_id: t.task_id, repetition: i + 1, order }));
  }
  const evidencia = refDaLinhaDeBase ?? { ref: 'core/test/fixtures/kg4-linha-de-base.json', sha256: sha256(JSON.stringify(base)) };
  const indisponivel = (motivo, unit = 'tokens') => ({ value: null, unit, source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: motivo });
  return {
    schema: 'ork.graph-benchmark/v1', experiment_id: EXPERIMENTO, data_class: 'measured', status: 'not-run',
    protocol: {
      protocol_version: 'kg1-ab/1',
      corpus: { corpus_id: 'orkastery', corpus_version: base.revisao, corpus_hash: base.grafo.corpus_hash },
      tasks, repetitions_per_task: repeticoes, pairs, order_seed: SEMENTE_DA_ORDEM,
      controls: {
        model: opcoes.modelo ?? 'claude-sonnet-5-5', model_revision: opcoes.revisaoDoModelo ?? 'claude-sonnet-5-5', provider: opcoes.provedor ?? 'anthropic',
        runtime: opcoes.runtime ?? 'claude-code', runtime_version: opcoes.versaoDoRuntime ?? 'a confirmar na rodada', effort: opcoes.esforco ?? 'high',
        sampling: { temperature: null, top_p: null, seed: null, seed_unavailable_reason: 'o runtime nao expoe seed nem amostragem' },
        base_prompt_hash: sha256(PROMPT_BASE), tools_hash: sha256(JSON.stringify(FERRAMENTAS)), stop_rules_hash: sha256(PARADA),
        budget: { max_total_tokens: 2000000, max_context_tokens: 200000, max_wall_ms: 600000 },
        snapshot_id: base.grafo.snapshot_id, tenant_id: 'local', acl_policy_hash: sha256DoCanonico(['repo:orkastery:leitura']),
      },
      treatment: {
        graph_schema: 'ork.code-artifact-graph/v1', graph_digest: base.grafo.graph_digest, snapshot_id: base.grafo.snapshot_id, edge_count: base.grafo.arestas,
        edge_set_digest: base.grafo.edge_set_digest,
      },
      environment_hash: sha256DoCanonico({ node: base.ambiente.node, plataforma: base.ambiente.plataforma }),
      cache_policy: 'cold', warmup_runs_per_arm: 0, retry_policy: { max_attempts: 2 }, tool_call_convention: 'model-requested',
      latency_boundary: 'end-to-end', primary_metric: 'logical_total_tokens', required_metrics: ['logical_total_tokens', 'tool_calls', 'latency_ms'],
    },
    index_preparation: {
      scenario: 'cold',
      amortization_hypothesis: 'o indice e construido uma vez por revisao e serve todas as consultas dela; a revisao seguinte parte dele pelo incremental',
      logical_total_tokens: indisponivel('o preparo do indice nao chama modelo'),
      latency_ms: { value: base.preparo.completo.ms, unit: 'ms', source: 'runtime_reported', method: 'monotonic-clock', method_version: SCHEMA, evidence_ref: evidencia, unavailable_reason: null },
      cost: { ...indisponivel('preparo local, sem custo atribuivel', 'BRL'), cost_kind: null, rate_card: null },
    },
    runs: [], receipts_review: { state: 'pending', receipt_ref: null }, evidence_refs: [evidencia],
  };
}

/** A telemetria `stream-json`: uma requisicao por mensagem do assistente, a sessao e o texto final. */
function lerTelemetria(texto) {
  const mensagens = new Map(), ferramentas = new Set();
  let sessao = null, resultado = null, erro = false;
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    let e;
    try {
      e = JSON.parse(linha);
    } catch {
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') sessao = e.session_id;
    if (e.type === 'assistant' && e.message && typeof e.message.id === 'string' && e.message.usage) {
      mensagens.set(e.message.id, e.message.usage);
      for (const c of e.message.content ?? []) if (c && c.type === 'tool_use' && c.id) ferramentas.add(c.id);
    }
    if (e.type === 'result') {
      resultado = typeof e.result === 'string' ? e.result : '';
      erro = e.is_error === true;
    }
  }
  const inteiro = (x) => (Number.isSafeInteger(x) && x >= 0 ? x : 0);
  const requisicoes = [...mensagens].map(([id, u]) => {
    const cache = inteiro(u.cache_read_input_tokens);
    return { id, entrada: inteiro(u.input_tokens) + inteiro(u.cache_creation_input_tokens) + cache, saida: inteiro(u.output_tokens), cache };
  });
  return { sessao, resultado, erro, requisicoes, ferramentas: ferramentas.size };
}

/** Uma sessao isolada do agente, num braco de um par, com a telemetria e a transcricao. */
function rodarSessao(opcoes, protocolo, tarefa, par, braco, tentativa, tarefaDaBase) {
  const runId = `${par.pair_id}-${braco}-${tentativa}`;
  const inicio = new Date(), t0 = agora();
  const r = spawnSync(opcoes.agente[0], opcoes.agente.slice(1), {
    cwd: opcoes.repositorio, input: promptDe(tarefaDaBase, braco), maxBuffer: 256 * 1024 * 1024, timeout: protocolo.controls.budget.max_wall_ms,
  });
  const latencia = arredondar(msDesde(t0)), fim = new Date();
  const texto = (r.stdout ?? Buffer.alloc(0)).toString('utf8'), tel = lerTelemetria(texto);
  const transcricao = path.join(opcoes.transcricoes, `${runId}.jsonl`);
  fs.writeFileSync(transcricao, texto);
  const ref = { ref: path.relative(RAIZ, transcricao).startsWith('..') ? transcricao : path.relative(RAIZ, transcricao), sha256: sha256(texto) };
  const outcome = r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : r.status !== 0 || tel.erro || tel.resultado === null ? 'error' : 'completed';
  const requests = tel.requisicoes.filter((q) => q.entrada >= 1).map((q) => ({
    request_id: `${runId}:${q.id}`.slice(0, 128), input_total_tokens: q.entrada, output_total_tokens: q.saida, cached_input_tokens: q.cache, reasoning_tokens: 0,
  }));
  const soma = (f) => requests.reduce((n, q) => n + f(q), 0);
  const medida = (valor, unit = 'tokens', method = 'stream-json-usage') => (requests.length || valor === 0
    ? { value: valor, unit, source: 'runtime_reported', method, method_version: '1', evidence_ref: ref, unavailable_reason: null }
    : { value: null, unit, source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'a sessao nao trouxe requisicao com uso' });
  const semRequisicao = requests.length === 0;
  const tokens = (f) => (semRequisicao && outcome === 'completed'
    ? { value: null, unit: 'tokens', source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'a sessao nao trouxe requisicao com uso' }
    : medida(soma(f)));
  const fatos = FATOS[tarefa.task_id].map((f, i) => ({ fact_id: `${tarefa.task_id}-F${i + 1}`, result: (tel.resultado ?? '').includes(f) ? 'present' : 'missing' }));
  return {
    run_id: runId, session_id: (tel.sessao && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tel.sessao) ? tel.sessao : `${runId}-sessao`),
    pair_id: par.pair_id, arm: braco, task_id: tarefa.task_id, repetition: par.repetition, attempt: tentativa, warmup: false,
    started_at: inicio.toISOString(), ended_at: fim.toISOString(), outcome, controls: protocolo.controls, question_hash: tarefa.question_hash,
    metrics: {
      logical_total_tokens: tokens((q) => q.input_total_tokens + q.output_total_tokens), input_total_tokens: tokens((q) => q.input_total_tokens),
      output_total_tokens: tokens((q) => q.output_total_tokens), cached_input_tokens: tokens((q) => q.cached_input_tokens),
      reasoning_tokens: { value: null, unit: 'tokens', source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'o runtime nao separa o raciocinio na telemetria' },
      residual_context_tokens: { value: null, unit: 'tokens', source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'sem leitura do contexto residual no fim da sessao', window_tokens: null, read_point: 'task-end' },
      tool_calls: semRequisicao ? { value: null, unit: 'calls', source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'a sessao nao trouxe requisicao com uso' }
        : { value: tel.ferramentas, unit: 'calls', source: 'runtime_reported', method: 'model-requested', method_version: '1', evidence_ref: ref, unavailable_reason: null },
      latency_ms: { value: latencia, unit: 'ms', source: 'runtime_reported', method: 'monotonic-clock', method_version: '1', evidence_ref: ref, unavailable_reason: null },
      cost: { value: null, unit: 'BRL', source: 'unavailable', method: 'nenhum', method_version: '0', evidence_ref: null, unavailable_reason: 'assinatura sem custo atribuivel por sessao', cost_kind: null, rate_card: null },
    },
    requests, mandatory_fact_results: outcome === 'completed' ? fatos : [], claim_results: [], verify_results: [], edge_audit: null, artifacts: [ref],
  };
}

/** O harness da rodada paga: os pares na ordem do protocolo, uma sessao por braco, retry pela politica. */
function executar(opcoes, log = () => undefined) {
  if (!opcoes.pago) throw new Error('harness.pago: a rodada abre sessoes de agente que custam tokens; passe --pago para executar');
  const { validarBenchmark, avaliarBenchmark, DESFECHOS_COM_RETRY } = require(path.join(DIST, 'intelligence-benchmark-contract.js'));
  const registro = JSON.parse(JSON.stringify(opcoes.registro));
  if (registro.status !== 'not-run' || registro.runs.length) throw new Error('harness: o protocolo precisa estar fixado e sem execucao');
  const p = registro.protocol, tarefas = new Map(p.tasks.map((t) => [t.task_id, t]));
  const daBase = new Map(PERGUNTAS.map((q) => [q.id, q]));
  fs.mkdirSync(opcoes.transcricoes, { recursive: true });
  for (const par of p.pairs) {
    const t = tarefas.get(par.task_id);
    for (const braco of par.order.split('')) {
      for (let tentativa = 1; tentativa <= p.retry_policy.max_attempts; tentativa++) {
        const run = rodarSessao(opcoes, p, t, par, braco, tentativa, daBase.get(t.task_id));
        registro.runs.push(run);
        log(`${run.run_id}: ${run.outcome}, ${run.metrics.logical_total_tokens.value ?? 'sem'} tokens`);
        if (!DESFECHOS_COM_RETRY.includes(run.outcome)) break;
      }
    }
  }
  registro.status = 'complete';
  registro.data_class = opcoes.simulado ? 'synthetic' : 'measured';
  validarBenchmark(registro);
  return { registro, veredito: avaliarBenchmark(registro) };
}

function principal() {
  const a = argumentos(process.argv.slice(2));
  const ler = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (a.validar) {
    const f = validar(ler(a.validar));
    for (const x of f) console.log(`FALHA ${x}`);
    console.log(f.length ? `reprovado: ${f.length} falha(s)` : `linha de base ${a.validar} valida`);
    return f.length ? 1 : 0;
  }
  if (a['validar-protocolo']) {
    const { avaliarBenchmark } = require(path.join(DIST, 'intelligence-benchmark-contract.js'));
    const r = ler(a['validar-protocolo']), v = avaliarBenchmark(r);
    console.log(`registro ${r.schema} ${r.experiment_id}: status ${r.status}, veredito ${v.resultado} (${v.motivos.join(', ')}), publicavel ${v.publicavel}, ${v.paresPlanejados} pares planejados`);
    return v.publicavel || (r.status === 'not-run' && v.resultado !== 'not-run') ? 1 : 0;
  }
  if (a.executar) {
    if (!a.pago) throw new Error('harness.pago: a rodada abre sessoes de agente que custam tokens; passe --pago para executar');
    if (!a.protocolo || !a.repositorio || !a.agente || !a.saida) throw new Error('--executar pede --protocolo, --repositorio, --agente e --saida');
    const agente = JSON.parse(a.agente);
    if (!Array.isArray(agente) || !agente.length || agente.some((x) => typeof x !== 'string')) throw new Error('--agente e um array JSON de textos');
    const { registro, veredito } = executar({
      pago: true, simulado: !!a.simulado, registro: ler(a.protocolo), repositorio: path.resolve(a.repositorio), agente,
      transcricoes: path.resolve(a.transcricoes ?? path.join(path.dirname(a.saida), 'transcricoes')),
    }, console.log);
    fs.writeFileSync(a.saida, `${JSON.stringify(registro, null, 2)}\n`);
    console.log(`veredito ${veredito.resultado} (${veredito.motivos.join(', ')}); publicavel ${veredito.publicavel}; registro em ${a.saida}`);
    return 0;
  }
  if (a.protocolo) {
    if (!a['linha-de-base']) throw new Error('--protocolo pede --linha-de-base');
    const texto = fs.readFileSync(a['linha-de-base'], 'utf8');
    const ref = { ref: path.relative(RAIZ, path.resolve(a['linha-de-base'])), sha256: sha256(texto) };
    const registro = montarProtocolo(JSON.parse(texto), {
      modelo: a.modelo, revisaoDoModelo: a['revisao-do-modelo'], runtime: a.runtime, versaoDoRuntime: a['versao-do-runtime'], esforco: a.esforco, provedor: a.provedor,
    }, ref);
    const { validarBenchmark } = require(path.join(DIST, 'intelligence-benchmark-contract.js'));
    validarBenchmark(registro);
    fs.writeFileSync(a.protocolo, `${JSON.stringify(registro, null, 2)}\n`);
    console.log(`protocolo ${registro.experiment_id} fixado em ${a.protocolo}: ${registro.protocol.tasks.length} tarefas, ${registro.protocol.pairs.length} pares, status not-run`);
    return 0;
  }
  if (!a.saida) throw new Error('use --saida, --validar, --protocolo, --validar-protocolo ou --executar');
  const r = medir(a.repeticoes, console.log);
  const f = validar(r);
  fs.writeFileSync(a.saida, `${JSON.stringify(r, null, 2)}\n`);
  for (const x of f) console.log(`FALHA ${x}`);
  console.log(f.length ? `reprovado: ${f.length} falha(s)` : `linha de base gravada em ${a.saida}`);
  return f.length ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = principal();
  } catch (e) {
    process.stderr.write(`linha-de-base-grafo: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  SCHEMA, FATOS, CONCLUSAO, LIMITES, PENDENTE, TOKENS, validar, montarProtocolo, lerTelemetria, executar, promptDe, textoDaPergunta,
};
