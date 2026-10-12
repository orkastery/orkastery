#!/usr/bin/env node
/**
 * RM-031 KG5 (D9): medida offline do custo da consulta do grafo pelo MCP, contra o JSON da CLI sem teto
 * e contra a leitura crua, nas seis perguntas da medida do KG3, os tres bracos na mesma revisao. Script
 * de desenvolvimento, fora do pacote publicado (core/scripts nao entra em `files`). Nao e o benchmark
 * `ork.graph-benchmark/v1`: nao ha modelo nem tokens medidos, e nada aqui conclui economia.
 *
 *   node core/scripts/medir-mcp-grafo.cjs --conferir [--repeticoes N]
 *   node core/scripts/medir-mcp-grafo.cjs --saida ARQ [--repeticoes N]
 *   node core/scripts/medir-mcp-grafo.cjs --validar ARQ
 *
 *   node core/scripts/medir-mcp-grafo.cjs --contexto --conferir
 *   node core/scripts/medir-mcp-grafo.cjs --contexto --saida core/test/fixtures/kg5-medida-contexto.json
 *   node core/scripts/medir-mcp-grafo.cjs --contexto --validar core/test/fixtures/kg5-medida-contexto.json
 *
 * Para cada pergunta, no HEAD com a arvore limpa e o indice do HEAD:
 * - tool: o worker das tools `ork_grafo_*` (o processo que a tool abre, com o ambiente minimo do MCP),
 *   com o argv que a tool monta para a pergunta e o teto padrao; ao agente chega o texto da resposta;
 * - CLI: `ork grafo <consulta> --json` num processo novo, sem teto (o braco grafo do KG3);
 * - cru: `git grep -n -I -F` do nome e a leitura inteira de cada arquivo com ocorrencia (o braco cru do KG3).
 * A descoberta e o custo fixo de ligar a flag: os bytes das definicoes das cinco tools no `tools/list`
 * de um servidor MCP num projeto temporario com `grafo.mcp: true`, contra o mesmo servidor sem a flag.
 * Tokens ficam `unavailable`: sem tokenizador exato nem contagem do runtime, bytes/4 seria estimativa.
 *
 * `--conferir` mede de novo e confere: a resposta da tool igual byte a byte a do `ork grafo` com o mesmo
 * argv, dentro do teto, e a proveniencia (o trecho de cada evidencia, no blob do HEAD, cita o alvo), pela
 * funcao do KG3. `--validar` confere a forma de um registro.
 *
 * Requer `npm --prefix core run build`; indexa o HEAD (`ork grafo indexar`) quando o indice nao existe.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PERGUNTAS, TOKENS, conferirProveniencia } = require('./medir-consulta-grafo.cjs');

const SCHEMA = 'ork.graph-mcp-cost/v0';
const RAIZ = path.resolve(__dirname, '..', '..');
const DIST = path.join(RAIZ, 'core', 'dist');
const ORK = path.join(DIST, 'index.js');
const CONCLUSAO = 'nenhuma: o registro mede bytes e respostas dos tres bracos e o custo fixo da descoberta; economia so o benchmark do protocolo decide';
const METODO = {
  tool: 'tool-mcp/v0: o worker das tools ork_grafo_* (core/dist/mcp-grafo-worker.js) com o argv que a tool monta e o teto padrao, num processo novo com o ambiente minimo do MCP; ao agente chega o texto da resposta da tool, e ele nao abre arquivo',
  cli: 'consulta-grafo/v0 do KG3: ork grafo <consulta> --json num processo novo, sem teto',
  cru: 'leitura-crua/v0 do KG3: git grep -n -I -F do nome nos arquivos rastreados, mais a leitura inteira de cada arquivo com ocorrencia',
  descoberta: 'bytes do JSON das definicoes das cinco tools no tools/list de um servidor MCP num projeto temporario com grafo.mcp: true, e do tools/list inteiro com e sem a flag',
  latencia: 'relogio monotonico do processo que mede, de ponta a ponta por repeticao, com a mediana',
};
const LIMITES = [
  'bytes nao sao tokens: o hex dos ids e o JSON tokenizam diferente de prosa, e a contagem de tokens fica com a rodada paga do protocolo',
  'a tool corta pelo teto: o que ela entrega pode ter menos arestas que a CLI sem teto, e o registro diz quantas e se cortou',
  'as respostas dos bracos nao sao as mesmas: o grafo so responde o que o extrator prova, e a leitura crua acha texto, comentario e nome igual em outro escopo',
  'a leitura crua modela um agente que abre todo arquivo com ocorrencia; um agente real pode ler menos ou mais',
  'a descoberta e um custo fixo por sessao com a flag ligada, pago mesmo sem consulta; como o host carrega as definicoes (todas ou sob demanda) muda o que chega ao modelo',
  'latencia sob a carga registrada da maquina; o braco da tool inclui a partida do Node e a leitura do indice a cada chamada',
];

function argumentos(argv) {
  const r = { repeticoes: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], valor = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} exige valor`);
      return argv[++i];
    };
    if (a === '--contexto') r.contexto = true;
    else if (a === '--listar-historico') r.listarHistorico = true;
    else if (a === '--conferir') r.conferir = true;
    else if (a === '--saida') r.saida = valor();
    else if (a === '--validar') r.validar = valor();
    else if (a === '--repeticoes') {
      r.repeticoes = Number(valor());
      if (!Number.isInteger(r.repeticoes) || r.repeticoes < 1 || r.repeticoes > 20) throw new Error('--repeticoes de 1 a 20');
    } else throw new Error(`opcao desconhecida: ${a}`);
  }
  if ([r.conferir, r.saida, r.validar, r.listarHistorico].filter(Boolean).length !== 1) throw new Error('use uma de --conferir, --saida ARQ ou --validar ARQ');
  return r;
}

const escrever = (linha) => process.stdout.write(`${linha}\n`);
const agora = () => process.hrtime.bigint();
const ms = (inicio) => Number(agora() - inicio) / 1e6;
const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};
const arredondar = (x) => Math.round(x * 10) / 10;

function rodar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, maxBuffer: 256 * 1024 * 1024, ...opcoes });
  if (r.error) throw r.error;
  return r;
}

function git(args) {
  const r = rodar('git', ['-c', 'core.fsmonitor=false', ...args]);
  if (r.status !== 0) throw new Error(`git ${args[0]} falhou: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

/** `ork grafo` num processo novo; `aceitar` diz os codigos de saida que valem como resposta. */
function ork(args, aceitar = [0]) {
  const inicio = agora();
  const r = rodar(process.execPath, [ORK, 'grafo', ...args]);
  const t = ms(inicio);
  if (!aceitar.includes(r.status)) throw new Error(`ork grafo ${args.join(' ')}: saida ${r.status}: ${r.stdout.toString('utf8').slice(0, 400)}${r.stderr.toString('utf8').slice(0, 400)}`);
  return { saida: r.stdout, ms: t, status: r.status };
}

/** A tool e os argumentos dela para a pergunta, com os padroes da tool. */
function chamadaDaTool(p) {
  const [sub, a, b] = p.consulta;
  return sub === 'caminho' ? { nome: 'ork_grafo_caminho', args: { de: a, para: b } } : { nome: `ork_grafo_${sub}`, args: { alvo: a } };
}

async function bracoTool(mcp, p, repeticoes) {
  const { nome, args } = chamadaDaTool(p), argv = mcp.argvDaTool(nome, args);
  const latencias = [];
  let r = null;
  for (let i = 0; i < repeticoes; i++) {
    const inicio = agora();
    r = await mcp.consultarPeloWorker(RAIZ, argv);
    latencias.push(arredondar(ms(inicio)));
    if (r.codigo !== 0 || r.interrompido) throw new Error(`${nome} ${JSON.stringify(args)}: worker saiu com ${r.codigo} (${r.interrompido ?? r.erro.split('\n')[0]})`);
  }
  const json = JSON.parse(r.saida);
  return {
    argv, texto: r.saida, resposta: json,
    medida: {
      tool: nome, argumentos: args, bytes_ao_agente: Buffer.byteLength(r.saida), arestas_devolvidas: json.arestas.length, total_arestas: json.total_arestas,
      cortado: json.teto.cortado, limite_efetivo: json.consulta.limite, evidencias: json.arestas.reduce((n, a) => n + a.evidencias.length, 0),
      arquivos_abertos: 0, latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)),
    },
  };
}

function bracoCli(p, repeticoes) {
  const latencias = [];
  let r = null;
  for (let i = 0; i < repeticoes; i++) {
    r = ork([...p.consulta, '--json']);
    latencias.push(arredondar(r.ms));
  }
  const json = JSON.parse(r.saida.toString('utf8'));
  return {
    bytes_ao_agente: r.saida.length, arestas_devolvidas: json.arestas.length, total_arestas: json.total_arestas,
    evidencias: json.arestas.reduce((n, a) => n + a.evidencias.length, 0), latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)),
  };
}

/** O braco cru do KG3, com o mesmo procedimento (`leitura-crua/v0`). */
function bracoCru(p, repeticoes) {
  if (p.cru.indisponivel) return { indisponivel: p.cru.indisponivel };
  const args = ['grep', '-n', '-I', '-F', ...(p.cru.palavra ? ['-w'] : []), '-e', p.cru.padrao];
  const latencias = [];
  let medida = null;
  for (let i = 0; i < repeticoes; i++) {
    const inicio = agora();
    const r = rodar('git', ['-c', 'core.fsmonitor=false', ...args]);
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep falhou: ${r.stderr.toString('utf8')}`);
    const linhas = r.stdout.toString('utf8').split('\n').filter(Boolean);
    const arquivos = [...new Set(linhas.map((l) => l.slice(0, l.indexOf(':'))))].sort();
    let bytesArquivos = 0;
    for (const a of arquivos) bytesArquivos += fs.readFileSync(path.join(RAIZ, a)).length;
    latencias.push(arredondar(ms(inicio)));
    medida = {
      comando: `git ${args.map((x) => (/^[A-Za-z0-9._\/-]+$/.test(x) ? x : JSON.stringify(x))).join(' ')}`,
      bytes_grep: r.stdout.length, bytes_arquivos: bytesArquivos, bytes_ao_agente: r.stdout.length + bytesArquivos,
      ocorrencias: linhas.length, arquivos_abertos: arquivos.length,
    };
  }
  return { ...medida, latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)) };
}

/** O custo fixo: as definicoes das cinco tools no `tools/list`, num projeto temporario, com e sem a flag. */
async function descoberta(mcp) {
  const doCore = (modulo) => require(require.resolve(modulo, { paths: [path.join(RAIZ, 'core')] }));
  const { Client } = doCore('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = doCore('@modelcontextprotocol/sdk/inMemory.js');
  const { criarServidorMcp } = require(path.join(DIST, 'mcp-server.js'));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-medida-kg5-')));
  const listar = async () => {
    const server = criarServidorMcp({ projeto: dir, host: 'claude-code' });
    const c = new Client({ name: 'medida-kg5', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await c.connect(ct);
    try {
      return (await c.listTools()).tools;
    } finally {
      await c.close();
      await server.close();
    }
  };
  try {
    const manifesto = 'project:\n  name: "medida"\n  abbrev: "med"\n';
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), manifesto);
    const sem = await listar();
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), `${manifesto}grafo:\n  mcp: true\n`);
    const com = await listar();
    const doGrafo = com.filter((t) => mcp.TOOLS_DO_GRAFO.includes(t.name));
    const bytesPorTool = Object.fromEntries(doGrafo.map((t) => [t.name, Buffer.byteLength(JSON.stringify(t))]));
    return {
      tools: doGrafo.map((t) => t.name), bytes_por_tool: bytesPorTool,
      bytes_das_tools: Object.values(bytesPorTool).reduce((n, x) => n + x, 0),
      tools_sem_flag: sem.length, tools_com_flag: com.length,
      bytes_tools_list_sem_flag: Buffer.byteLength(JSON.stringify(sem)), bytes_tools_list_com_flag: Buffer.byteLength(JSON.stringify(com)),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function medir(repeticoes) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=no']).toString('utf8');
  if (status) throw new Error('a medida precisa da arvore limpa: os tres bracos descrevem o mesmo HEAD');
  const mcp = require(path.join(DIST, 'mcp-grafo.js'));
  const revisao = git(['rev-parse', 'HEAD']).toString('utf8').trim();
  const preparo = JSON.parse(ork(['indexar', '--json']).saida.toString('utf8'));
  const perguntas = [], respostas = [], textos = [];
  for (const p of PERGUNTAS) {
    const tool = await bracoTool(mcp, p, repeticoes);
    respostas.push(tool.resposta);
    textos.push({ id: p.id, argv: tool.argv, texto: tool.texto });
    perguntas.push({
      id: p.id, pergunta: p.pergunta, consulta: p.consulta, tool: tool.medida, cli: bracoCli(p, repeticoes), cru: bracoCru(p, repeticoes),
      tokens: { tool: TOKENS, cli: TOKENS, cru: TOKENS },
    });
  }
  const registro = {
    schema: SCHEMA, medido_em: new Date().toISOString(), revisao, chave_do_indice: preparo.chave, graph_digest: preparo.manifesto.graph_digest,
    teto_padrao: mcp.TETO_PADRAO,
    maquina: { node: process.version, plataforma: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, carga_1min: arredondar(os.loadavg()[0]) },
    metodo: { ...METODO, repeticoes },
    preparo_do_indice: {
      comando: 'ork grafo indexar --json', estado: preparo.estado, modo: preparo.modo, ms: preparo.ms,
      bytes_do_indice: preparo.manifesto.graph_bytes + preparo.manifesto.report_bytes,
      fontes: preparo.manifesto.conferencia.fontes, arestas: Object.values(preparo.manifesto.contagens.arestas).reduce((n, x) => n + x, 0),
    },
    descoberta: await descoberta(mcp),
    perguntas, conclusao: CONCLUSAO, limites: LIMITES,
  };
  return { registro, respostas, textos };
}

function validar(registro) {
  const f = [];
  const numero = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const tokensOk = (t) => t && t.value === null && t.source === 'unavailable' && typeof t.unavailable_reason === 'string' && t.unavailable_reason.length > 0;
  if (!registro || typeof registro !== 'object') return ['registro'];
  if (registro.schema !== SCHEMA) f.push(`schema ${registro.schema}`);
  if (!/^[0-9a-f]{40}$/.test(registro.revisao ?? '')) f.push('revisao');
  if (Number.isNaN(Date.parse(registro.medido_em))) f.push('medido_em');
  if (registro.teto_padrao !== 32768) f.push('teto_padrao');
  if (!registro.maquina || !numero(registro.maquina.carga_1min) || !numero(registro.maquina.cpus) || !registro.maquina.node) f.push('maquina');
  const pr = registro.preparo_do_indice;
  if (!pr || !numero(pr.ms) || !numero(pr.bytes_do_indice) || !numero(pr.fontes) || !numero(pr.arestas)) f.push('preparo_do_indice');
  const d = registro.descoberta;
  // Registros da fatia 1 continuam validos: quatro tools; fatia 2 acrescenta contexto.
  const toolsFatia1 = ['ork_grafo_vizinhos', 'ork_grafo_chamadores', 'ork_grafo_importadores', 'ork_grafo_caminho'];
  const toolsFatia2 = [...toolsFatia1, 'ork_grafo_contexto'];
  if (!d || ![toolsFatia1, toolsFatia2].some((nomes) => JSON.stringify(d.tools) === JSON.stringify(nomes))
    || !numero(d.bytes_das_tools) || !numero(d.bytes_tools_list_sem_flag) || !numero(d.bytes_tools_list_com_flag)
    || d.tools_com_flag !== d.tools_sem_flag + d.tools.length || d.bytes_tools_list_com_flag <= d.bytes_tools_list_sem_flag) f.push('descoberta');
  if (registro.conclusao !== CONCLUSAO) f.push('conclusao');
  if (!Array.isArray(registro.limites) || registro.limites.length < 1) f.push('limites');
  const ids = (registro.perguntas ?? []).map((p) => p.id);
  if (JSON.stringify(ids) !== JSON.stringify(PERGUNTAS.map((p) => p.id))) f.push(`perguntas ${ids}`);
  for (const p of registro.perguntas ?? []) {
    const t = p.tool ?? {}, c = p.cli ?? {};
    for (const k of ['bytes_ao_agente', 'arestas_devolvidas', 'total_arestas', 'evidencias', 'arquivos_abertos', 'latencia_mediana_ms']) if (!numero(t[k])) f.push(`${p.id} tool.${k}`);
    if (typeof t.cortado !== 'boolean') f.push(`${p.id} tool.cortado`);
    if (numero(t.bytes_ao_agente) && t.bytes_ao_agente > (registro.teto_padrao ?? 0)) f.push(`${p.id} tool acima do teto`);
    if (t.cortado === false && numero(t.arestas_devolvidas) && numero(c.arestas_devolvidas) && t.arestas_devolvidas !== c.arestas_devolvidas) f.push(`${p.id} tool sem corte com outra resposta`);
    for (const k of ['bytes_ao_agente', 'arestas_devolvidas', 'total_arestas', 'evidencias', 'latencia_mediana_ms']) if (!numero(c[k])) f.push(`${p.id} cli.${k}`);
    if (!Array.isArray(t.latencia_ms) || t.latencia_ms.length < 1 || !Array.isArray(c.latencia_ms) || c.latencia_ms.length < 1) f.push(`${p.id} latencia_ms`);
    const esperado = PERGUNTAS.find((x) => x.id === p.id);
    if (esperado && esperado.cru.indisponivel) {
      if (typeof (p.cru ?? {}).indisponivel !== 'string') f.push(`${p.id} cru.indisponivel`);
    } else {
      for (const k of ['bytes_grep', 'bytes_arquivos', 'bytes_ao_agente', 'ocorrencias', 'arquivos_abertos', 'latencia_mediana_ms']) if (!numero((p.cru ?? {})[k])) f.push(`${p.id} cru.${k}`);
    }
    if (!tokensOk(p.tokens && p.tokens.tool) || !tokensOk(p.tokens && p.tokens.cli) || !tokensOk(p.tokens && p.tokens.cru)) f.push(`${p.id} tokens`);
  }
  if (/econom(ia|iza)|\breduz|mais barat|savings|cheaper/i.test(JSON.stringify({ c: registro.conclusao, l: registro.limites }).replace(CONCLUSAO, ''))) f.push('promessa de economia');
  return f;
}

/** `--conferir`: a tool e o `ork grafo` com o mesmo argv dao os mesmos bytes, dentro do teto. */
function conferirIgualdade(textos, teto) {
  const falhas = [];
  for (const { id, argv, texto } of textos) {
    const cli = ork(argv, [0, 1]).saida.toString('utf8');
    if (cli !== `${texto}\n`) falhas.push(`${id}: a tool difere do ork grafo ${argv.join(' ')}`);
    if (Buffer.byteLength(texto) > teto) falhas.push(`${id}: a tool passou do teto de ${teto} bytes`);
  }
  return falhas;
}

function tabela(registro) {
  escrever(`medida ${registro.schema} na revisao ${registro.revisao.slice(0, 12)}, carga ${registro.maquina.carga_1min} em ${registro.maquina.cpus} nucleos, teto ${registro.teto_padrao}`);
  const pr = registro.preparo_do_indice, d = registro.descoberta;
  escrever(`  preparo do indice: ${pr.ms} ms (${pr.estado}${pr.modo ? `, ${pr.modo}` : ''}), ${pr.bytes_do_indice} bytes, ${pr.fontes} fontes, ${pr.arestas} arestas`);
  escrever(`  descoberta: ${d.bytes_das_tools} bytes nas ${d.tools.length} definicoes; tools/list de ${d.bytes_tools_list_sem_flag} para ${d.bytes_tools_list_com_flag} bytes (${d.tools_sem_flag} para ${d.tools_com_flag} tools)`);
  for (const p of registro.perguntas) {
    const t = p.tool, c = p.cli, cru = p.cru;
    const braco = cru.indisponivel ? `cru indisponivel` : `cru ${cru.bytes_ao_agente} bytes (${cru.arquivos_abertos} arquivos)`;
    escrever(`  ${p.id} ${p.pergunta}: tool ${t.bytes_ao_agente} bytes (${t.arestas_devolvidas} de ${t.total_arestas} arestas${t.cortado ? ', cortada pelo teto' : ''}), ${t.latencia_mediana_ms} ms; cli ${c.bytes_ao_agente} bytes (${c.arestas_devolvidas} arestas); ${braco}`);
  }
  escrever(`  tokens: unavailable nos tres bracos; conclusao: ${registro.conclusao}`);
}

/** KG5 fatia 3: dois merges reais, somente blobs historicos, sem checkout nem estado do ork. */
const CONTEXTO_CASOS = [
  { thread: 'ork-rm031kg3', merge: 'c507a3a', sementes: ['core/src/intelligence-graph-extract.ts'],
    origem: 'RM-031, KG3: indice e consultas sobre o extrator entregue no KG2; semente retrospectiva fixa, nao prompt historico' },
  { thread: 'ork-rm031kg4incr', merge: '99b10d3', sementes: ['core/src/intelligence-graph-index.ts'],
    origem: 'RM-031, KG4: incremental sobre o indice entregue no KG3; semente retrospectiva fixa, nao prompt historico' },
];
const CONTEXTO_MEDIDA_SCHEMA = 'ork.graph-context-cost/v3';
const CONTEXTO_FIXTURE = path.join(RAIZ, 'core/test/fixtures/kg5-medida-contexto.json');

function separarEditadosContexto(editados, arquivosNaBase) {
  const base = new Set(arquivosNaBase), unicos = [...new Set(editados)].sort();
  return { editados_na_base: unicos.filter((p) => base.has(p)), arquivos_novos: unicos.filter((p) => !base.has(p)) };
}

/** O chamador fornece somente editados que existiam na base, nunca os novos. */
function coberturaContexto(editados, apontados, sementes) {
  const conjunto = new Set(apontados), iniciais = new Set(sementes);
  const acertos = editados.filter((p) => conjunto.has(p));
  const novosAcertos = acertos.filter((p) => !iniciais.has(p));
  return { editados: [...editados], apontados: [...apontados].sort(), acertos,
    total_editados: editados.length, total_apontados: conjunto.size, total_acertos: acertos.length,
    fora_das_sementes: { total_editados: editados.filter((p) => !iniciais.has(p)).length, acertos: novosAcertos },
    cobertura: editados.length ? acertos.length / editados.length : null,
    precisao: conjunto.size ? acertos.length / conjunto.size : null };
}

function fontesHistoricas(revisao) {
  const registros = git(['ls-tree', '-r', '-z', revisao]).toString('utf8').split('\0').filter(Boolean)
    .map((r) => { const tab = r.indexOf('\t'), [modo, tipo, objeto] = r.slice(0, tab).split(' ');
      return { modo, tipo, objeto, path: r.slice(tab + 1) }; })
    .filter((r) => ['100644', '100755'].includes(r.modo) && r.tipo === 'blob');
  // Uma leitura batch evita milhares de processos; bytes sao blobs crus, nunca filtros de checkout.
  const bruto = rodar('git', ['-c', 'core.fsmonitor=false', 'cat-file', '--batch'], {
    input: registros.map((r) => r.objeto).join('\n') + '\n',
  });
  if (bruto.status !== 0) throw new Error('cat-file historico falhou');
  let offset = 0;
  return registros.map((r) => {
    const fim = bruto.stdout.indexOf(10, offset), cabecalho = bruto.stdout.subarray(offset, fim).toString('ascii').split(' ');
    const tamanho = Number(cabecalho[2]);
    if (cabecalho[0] !== r.objeto || cabecalho[1] !== 'blob' || !Number.isSafeInteger(tamanho)) throw new Error('blob historico invalido');
    const bytes = bruto.stdout.subarray(fim + 1, fim + 1 + tamanho);
    if (bytes.length !== tamanho) throw new Error('blob historico incompleto');
    offset = fim + tamanho + 2;
    return { path: r.path, bytes };
  });
}

/** Nomes publicos explicitos no AST da semente; sem locais, comentarios ou resolucao de outro arquivo. */
function nomesExportadosContexto(texto, arquivo) {
  const ts = require('typescript');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true);
  const nomes = new Set();
  const adicionar = (nome) => {
    if (nome && ts.isIdentifier(nome) && [...nome.text].length >= 4) nomes.add(nome.text);
  };
  const binding = (nome) => {
    if (ts.isIdentifier(nome)) adicionar(nome);
    else for (const e of nome.elements) if (ts.isBindingElement(e)) binding(e.name);
  };
  for (const no of fonte.statements) {
    if (ts.isExportDeclaration(no)) {
      if (no.exportClause && ts.isNamedExports(no.exportClause)) for (const e of no.exportClause.elements) adicionar(e.name);
      else if (no.exportClause && ts.isNamespaceExport(no.exportClause)) adicionar(no.exportClause.name);
      continue;
    }
    if (!no.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      || no.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isVariableStatement(no)) for (const d of no.declarationList.declarations) binding(d.name);
    else adicionar(no.name);
  }
  return [...nomes].sort();
}

/** Baseline independente do grafo: ler sementes, grep de exports e ler os arquivos encontrados. */
function descobertaContexto(revisao, fontes, sementes, executar = rodar) {
  const porPath = new Map(fontes.map((f) => [f.path, f.bytes]));
  const termos = new Set(), abertos = new Set(sementes);
  for (const s of sementes) {
    const bytes = porPath.get(s);
    if (!bytes) throw new Error(`semente ausente na base historica: ${s}`);
    const texto = bytes.toString('utf8');
    for (const nome of nomesExportadosContexto(texto, s)) termos.add(nome);
    // Saidas explicitas relativas da semente: imports/reexports e links Markdown, sem inferencia.
    for (const m of texto.matchAll(/(?:from\s*['"]|import\s*['"]|require\(\s*['"]|\]\()((?:\.\.\/|\.\/)[^'"\s)]+)/g)) {
      const alvo = path.posix.normalize(path.posix.join(path.posix.dirname(s), m[1].split('#')[0]));
      const candidatos = [alvo, ...['.ts', '.tsx', '.js', '.md', '/index.ts', '/index.js'].map((ext) => alvo + ext)];
      const encontrado = candidatos.find((p) => porPath.has(p));
      if (encontrado) abertos.add(encontrado);
    }
  }
  const argv = termos.size ? ['grep', '-n', '-I', '-F', '-w', ...[...termos].sort().flatMap((t) => ['-e', t]), revisao, '--'] : null;
  // Nenhum nome elegivel: nao executar um grep sem padroes ou usar fallback de termos locais.
  const r = argv ? executar('git', ['-c', 'core.fsmonitor=false', ...argv]) : { status: 1, stdout: Buffer.alloc(0) };
  if (r.status !== 0 && r.status !== 1) throw new Error('grep historico falhou');
  const prefixo = `${revisao}:`, linhas = r.stdout.toString('utf8').split('\n').filter(Boolean);
  for (const linha of linhas) {
    if (!linha.startsWith(prefixo)) throw new Error('grep sem revisao esperada');
    const arquivo = linha.slice(prefixo.length).replace(/:\d+:.*$/, '');
    if (porPath.has(arquivo)) abertos.add(arquivo);
  }
  const arquivos = [...abertos].sort();
  const bytesArquivos = arquivos.reduce((n, p) => n + porPath.get(p).length, 0);
  return { argv: argv ? ['git', ...argv] : null, termos: [...termos].sort(), arquivos, bytes_grep: r.stdout.length,
    bytes_arquivos: bytesArquivos, bytes_ao_agente: r.stdout.length + bytesArquivos, ocorrencias: linhas.length };
}

async function medirContexto() {
  const { extrairGrafo } = require(path.join(DIST, 'intelligence-graph-extract.js'));
  const { carregarAnalisadores } = require(path.join(DIST, 'intelligence-graph-parsers.js'));
  const { pacoteDeContexto } = require(path.join(DIST, 'intelligence-graph-contexto.js'));
  const { sha256DoCanonico } = require(path.join(DIST, 'intelligence-graph-contract.js'));
  const casos = [];
  for (const c of CONTEXTO_CASOS) {
    const merge = git(['rev-parse', '--verify', `${c.merge}^{commit}`]).toString('utf8').trim();
    git(['merge-base', '--is-ancestor', merge, 'main']);
    const pais = git(['rev-list', '--parents', '-n', '1', merge]).toString('utf8').trim().split(' ').slice(1);
    if (pais.length !== 2) throw new Error(`caso ${c.thread} exige merge de dois pais`);
    const base = git(['merge-base', ...pais]).toString('utf8').trim();
    const fontes = fontesHistoricas(base);
    const { grafo } = extrairGrafo({ tenant_id: 'local', repository_id: 'orkastery', revision: base,
      revision_unavailable_reason: null, acl_refs: ['repo:orkastery:leitura'], fontes }, carregarAnalisadores());
    const digest = sha256DoCanonico(grafo);
    const indice = { repository_id: 'orkastery', revision: base, snapshot_id: grafo.snapshot.snapshot_id,
      graph_digest: digest, chave: sha256DoCanonico({ base, digest, metodo: CONTEXTO_MEDIDA_SCHEMA }), arvore: 'limpa', extratores: grafo.snapshot.extractors };
    const entrada = { thread: c.thread, base, diff: [], diffEstado: 'ignorado-sem-worktree',
      goal: c.sementes.map((s) => `\`${s}\``).join(' '), plan: null, claims: [] };
    const texto = pacoteDeContexto(grafo, indice, entrada), pacote = JSON.parse(texto);
    if (texto !== pacoteDeContexto(grafo, indice, entrada)) throw new Error('pacote historico nao deterministico');
    const cru = descobertaContexto(base, fontes, c.sementes);
    // Resultado final so lido DEPOIS de gerar ambos os bracos: nunca e semente ou termo de busca.
    const editados = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', pais[0], merge, '--'])
      .toString('utf8').split('\0').filter(Boolean).sort();
    const apontados = pacote.medida.arquivos.map((f) => f.path);
    // Existencia na base vem da arvore inteira, inclusive entradas que nao viram fontes do extrator.
    const caminhosNaBase = git(['ls-tree', '-r', '--name-only', '-z', base]).toString('utf8').split('\0').filter(Boolean);
    const resultado = separarEditadosContexto(editados, caminhosNaBase);
    casos.push({ ...c, merge, pais, base, indice: { graph_digest: digest, fontes: fontes.length }, entrada, resultado,
      pacote: { bytes_ao_agente: Buffer.byteLength(texto), sha256: require('node:crypto').createHash('sha256').update(texto).digest('hex'),
        truncado: pacote.truncado, omitidos: pacote.omitidos, arquivos: apontados },
      descoberta: cru, cobertura_pacote: coberturaContexto(resultado.editados_na_base, apontados, c.sementes),
      cobertura_descoberta: coberturaContexto(resultado.editados_na_base, cru.arquivos, c.sementes),
      arquivos_do_pacote_fora_da_descoberta: apontados.filter((p) => !cru.arquivos.includes(p)), tokens: TOKENS });
  }
  return { schema: CONTEXTO_MEDIDA_SCHEMA, estado: 'measured', casos,
    metodo: 'bases = merge-base dos pais; extracao em memoria dos blobs anteriores; sementes retrospectivas fixadas no script; grep -F -w de nomes exportados explicitamente pela semente, com pelo menos 4 caracteres, via AST TypeScript; leitura inteira dos matches e saidas relativas; resultado do merge somente para cobertura e precisao',
    limites: ['dois casos do mesmo subsistema, nao amostra representativa nem replay de prompts historicos',
      'sem diffs futuros nas entradas; cobertura somente dos editados existentes na base; arquivos novos separados, inalcançaveis pelos dois bracos; acertos das sementes separados',
      'grep textual pode achar homonimos e comentarios; divergencias de vizinhanca ficam listadas',
      'bytes nao sao tokens; nao ha promessa de economia nem medicao de latencia',
      'preparo do indice e descoberta das tools nao incluidos no custo por pacote; snapshot reconstruido, nao cache de producao'],
    conclusao: 'nenhuma sobre tokens; bytes e cobertura retrospectiva somente nos casos registrados' };
}

function validarContexto(r) {
  const erros = [], inteiro = (n) => Number.isSafeInteger(n) && n >= 0;
  if (r?.estado !== 'measured') return ['medicao historica nao executada'];
  if (r.schema !== CONTEXTO_MEDIDA_SCHEMA) return ['metodo historico desatualizado: regravar fixture'];
  if (r.casos?.length !== CONTEXTO_CASOS.length) erros.push('casos');
  for (const [i, c] of (r.casos ?? []).entries()) {
    if (c.thread !== CONTEXTO_CASOS[i]?.thread || JSON.stringify(c.sementes) !== JSON.stringify(CONTEXTO_CASOS[i]?.sementes)) erros.push('identidade do caso');
    if (!/^[a-f0-9]{40}$/.test(c.base ?? '') || !/^[a-f0-9]{40}$/.test(c.merge ?? '')) erros.push('revisoes');
    if (!/^[a-f0-9]{64}$/.test(c.pacote?.sha256 ?? '')) erros.push('sha256 pacote');
    if (!inteiro(c.pacote?.bytes_ao_agente) || c.pacote.bytes_ao_agente > 32768) erros.push('bytes pacote');
    if (!inteiro(c.descoberta?.bytes_grep) || !inteiro(c.descoberta?.bytes_arquivos)
      || c.descoberta.bytes_ao_agente !== c.descoberta.bytes_grep + c.descoberta.bytes_arquivos) erros.push('bytes descoberta');
    const resultado = c.resultado;
    if (!resultado || !Array.isArray(resultado.editados_na_base) || !Array.isArray(resultado.arquivos_novos)
      || resultado.arquivos_novos.some((p) => resultado.editados_na_base.includes(p))) erros.push('resultado');
    const termos = c.descoberta?.termos;
    if (!Array.isArray(termos) || termos.some((t) => typeof t !== 'string' || [...t].length < 4)
      || JSON.stringify(c.descoberta.argv) !== JSON.stringify(termos.length ? ['git', 'grep', '-n', '-I', '-F', '-w',
        ...[...termos].sort().flatMap((t) => ['-e', t]), c.base, '--'] : null)) erros.push('termos descoberta');
    for (const [k, apontados] of [['cobertura_pacote', c.pacote?.arquivos], ['cobertura_descoberta', c.descoberta?.arquivos]]) {
      const v = c[k];
      if (!v || !Array.isArray(v.editados) || !Array.isArray(v.apontados)
        || !Array.isArray(apontados) || !Array.isArray(resultado?.editados_na_base)
        || resultado?.arquivos_novos?.some((p) => apontados.includes(p))
        || JSON.stringify(v) !== JSON.stringify(coberturaContexto(resultado.editados_na_base, apontados, c.sementes))) erros.push(k);
    }
    if (c.tokens?.source !== 'unavailable' || c.tokens?.value !== null) erros.push('tokens');
    if (!Array.isArray(c.entrada?.diff) || c.entrada.diff.length) erros.push('diff futuro na entrada');
  }
  return erros;
}

/** O hash mede bytes exatos do pacote; o resto do registro tambem deve reproduzir a fixture. */
function conferirContexto(registro, fixture) {
  const erros = validarContexto(fixture);
  if (erros.length) return erros;
  for (const c of registro.casos) {
    const esperado = fixture.casos.find((f) => f.thread === c.thread);
    if (c.pacote.sha256 !== esperado?.pacote.sha256) erros.push(`${c.thread}: sha256 do pacote difere da fixture`);
  }
  if (JSON.stringify(registro) !== JSON.stringify(fixture)) erros.push('registro historico difere da fixture');
  return erros;
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.listarHistorico) {
    escrever(git(['log', '--first-parent', '--merges', '-30', '--format=%H %P %s', 'main']).toString('utf8'));
    return 0;
  }
  if (a.validar) {
    const falhas = (a.contexto ? validarContexto : validar)(JSON.parse(fs.readFileSync(a.validar, 'utf8')));
    for (const f of falhas) escrever(`FALHA ${f}`);
    escrever(falhas.length ? `reprovado: ${falhas.length} falha(s)` : `registro ${a.validar} valido`);
    return falhas.length ? 1 : 0;
  }
  if (a.contexto) {
    const registro = await medirContexto();
    const falhas = validarContexto(registro);
    if (a.conferir) falhas.push(...conferirContexto(registro, JSON.parse(fs.readFileSync(CONTEXTO_FIXTURE, 'utf8'))));
    if (falhas.length) throw new Error(falhas.join('; '));
    if (a.saida) fs.writeFileSync(a.saida, `${JSON.stringify(registro, null, 2)}\n`);
    escrever(JSON.stringify(registro, null, 2));
    return 0;
  }
  const { registro, respostas, textos } = await medir(a.repeticoes);
  tabela(registro);
  const falhas = validar(registro);
  if (a.conferir) {
    falhas.push(...conferirIgualdade(textos, registro.teto_padrao));
    const p = conferirProveniencia(respostas);
    escrever(`  igualdade: ${textos.length} respostas da tool comparadas com o ork grafo do mesmo argv`);
    escrever(`  proveniencia: ${p.conferidas} evidencias conferidas no blob do HEAD, ${p.falhas.length} sem o nome do alvo`);
    falhas.push(...p.falhas);
    if (p.conferidas === 0) falhas.push('nenhuma evidencia conferida');
  }
  if (a.saida) fs.writeFileSync(a.saida, `${JSON.stringify(registro, null, 2)}\n`);
  for (const f of falhas) escrever(`FALHA ${f}`);
  escrever(falhas.length ? `reprovado: ${falhas.length} falha(s)` : 'aprovado');
  return falhas.length ? 1 : 0;
}

if (require.main === module) {
  principal().then((codigo) => { process.exitCode = codigo; }, (e) => {
    process.stderr.write(`medir-mcp-grafo: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  });
}

module.exports = { CONCLUSAO, LIMITES, SCHEMA, validar, CONTEXTO_CASOS, CONTEXTO_MEDIDA_SCHEMA,
  separarEditadosContexto, coberturaContexto, nomesExportadosContexto, descobertaContexto, validarContexto, conferirContexto };
