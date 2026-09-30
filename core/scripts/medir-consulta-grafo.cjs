#!/usr/bin/env node
/**
 * RM-031 KG3 (D9): primeira medida do custo de consulta ao grafo contra a leitura crua de arquivos.
 * Script de desenvolvimento, fora do pacote publicado (core/scripts nao entra em `files`). Nao e o
 * benchmark `ork.graph-benchmark/v1`: nao ha modelo nem tokens medidos, e nada aqui conclui economia.
 *
 *   node core/scripts/medir-consulta-grafo.cjs --conferir [--repeticoes N]
 *   node core/scripts/medir-consulta-grafo.cjs --saida ARQ [--repeticoes N]
 *   node core/scripts/medir-consulta-grafo.cjs --validar ARQ
 *
 * Para cada pergunta fixa, mede os dois bracos na revisao do HEAD:
 * - grafo: `ork grafo <consulta> --json` num processo novo, com o indice do HEAD ja construido;
 *   bytes que chegam ao agente (a saida JSON; o texto a parte), respostas (arestas), evidencias,
 *   arquivos que o agente abre (nenhum), bytes que o processo le (o indice) e latencia ponta a ponta;
 * - leitura crua: `git grep -n -I -F` do nome nos arquivos rastreados e a leitura inteira de cada
 *   arquivo com ocorrencia, que e o que chega ao agente para confirmar a relacao; bytes, ocorrencias,
 *   arquivos abertos, bytes que o grep varre (os rastreados) e latencia.
 * O preparo do indice fica a parte (`ork grafo indexar --forcar --json`). Tokens ficam `unavailable`:
 * sem tokenizador exato nem contagem do runtime, bytes divididos por 4 seriam estimativa.
 *
 * `--conferir` mede e confere a proveniencia: o trecho de cada evidencia devolvida pelo grafo, lido
 * do blob do HEAD, contem o nome do alvo da aresta. `--validar` confere a forma de um registro.
 *
 * Requer `npm --prefix core run build` e o indice do HEAD (`node core/dist/index.js grafo indexar`).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA = 'ork.graph-query-cost/v0';
const RAIZ = path.resolve(__dirname, '..', '..');
const ORK = path.join(RAIZ, 'core', 'dist', 'index.js');
const CONCLUSAO = 'nenhuma: o registro mede os dois lados; economia so o benchmark do protocolo decide';
const TOKENS = { value: null, source: 'unavailable', unavailable_reason: 'sem tokenizador exato nem contagem do runtime nesta medida; bytes/4 seria estimativa' };
const METODO = {
  grafo: 'consulta-grafo/v0: ork grafo <consulta> --json num processo novo, indice do HEAD ja construido; ao agente chega a saida JSON, e ele nao abre arquivo; o processo le o indice',
  cru: 'leitura-crua/v0: git grep -n -I -F do nome nos arquivos rastreados, mais a leitura inteira de cada arquivo com ocorrencia',
  latencia: 'relogio monotonico do processo que mede, de ponta a ponta por repeticao, com a mediana',
};
const LIMITES = [
  'o grafo so responde o que o extrator prova (sem chamada por despacho de tipo, sem chamada fora de simbolo); a leitura crua acha texto, inclusive comentario, doc e nome igual em outro escopo',
  'as respostas dos dois lados nao sao as mesmas: o numero de cada lado fica registrado, e bytes sozinhos nao comparam qualidade',
  'a leitura crua modela um agente que abre todo arquivo com ocorrencia; um agente real pode ler menos ou mais',
  'latencia sob a carga registrada da maquina; o processo do grafo inclui a partida do Node e a carga do indice',
];
/** As perguntas fixas: a consulta ao grafo e o padrao da leitura crua (`palavra` usa `-w`). */
const PERGUNTAS = [
  { id: 'P1', pergunta: 'quem chama lerRepositorio', consulta: ['chamadores', 'core/src/intelligence-graph-repo.ts#lerRepositorio'], cru: { padrao: 'lerRepositorio', palavra: true } },
  { id: 'P2', pergunta: 'quem chama dirEstado', consulta: ['chamadores', 'core/src/manifest.ts#dirEstado'], cru: { padrao: 'dirEstado', palavra: true } },
  { id: 'P3', pergunta: 'quem importa o contrato do grafo', consulta: ['importadores', 'core/src/intelligence-graph-contract.ts'], cru: { padrao: 'intelligence-graph-contract', palavra: false } },
  { id: 'P4', pergunta: 'quem importa o leitor de YAML', consulta: ['importadores', 'core/src/yaml.ts'], cru: { padrao: "/yaml'", palavra: false } },
  { id: 'P5', pergunta: 'vizinhanca de raizDoEstado', consulta: ['vizinhos', 'core/src/estado-thread.ts#raizDoEstado'], cru: { padrao: 'raizDoEstado', palavra: true } },
  {
    id: 'P6', pergunta: 'caminho de main a dirEstado', consulta: ['caminho', 'core/src/index.ts#main', 'core/src/manifest.ts#dirEstado'],
    cru: { indisponivel: 'a leitura crua nao tem procedimento fixo que ache um caminho de chamadas sem inferir o simbolo que contem cada ocorrencia' },
  },
];

function argumentos(argv) {
  const r = { repeticoes: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], valor = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} exige valor`);
      return argv[++i];
    };
    if (a === '--conferir') r.conferir = true;
    else if (a === '--saida') r.saida = valor();
    else if (a === '--validar') r.validar = valor();
    else if (a === '--repeticoes') {
      r.repeticoes = Number(valor());
      if (!Number.isInteger(r.repeticoes) || r.repeticoes < 1 || r.repeticoes > 20) throw new Error('--repeticoes de 1 a 20');
    } else throw new Error(`opcao desconhecida: ${a}`);
  }
  if ([r.conferir, r.saida, r.validar].filter(Boolean).length !== 1) throw new Error('use uma de --conferir, --saida ARQ ou --validar ARQ');
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

function ork(args) {
  const inicio = agora();
  const r = rodar(process.execPath, [ORK, 'grafo', ...args]);
  const t = ms(inicio);
  if (r.status !== 0) throw new Error(`ork grafo ${args.join(' ')}: saida ${r.status}: ${r.stdout.toString('utf8').slice(0, 400)}${r.stderr.toString('utf8').slice(0, 400)}`);
  return { saida: r.stdout, ms: t };
}

function bracoGrafo(p, repeticoes, bytesDoIndice) {
  const latencias = [];
  let json = null, bytesJson = 0;
  for (let i = 0; i < repeticoes; i++) {
    const r = ork([...p.consulta, '--json']);
    latencias.push(arredondar(r.ms));
    bytesJson = r.saida.length;
    json = JSON.parse(r.saida.toString('utf8'));
  }
  const texto = ork(p.consulta).saida;
  const evidencias = json.arestas.reduce((n, a) => n + a.evidencias.length, 0);
  return {
    resposta: json,
    medida: {
      bytes_ao_agente: bytesJson, bytes_json: bytesJson, bytes_texto: texto.length, respostas: json.total_arestas, arestas_devolvidas: json.arestas.length,
      evidencias, arquivos_abertos: 0, bytes_lidos_pelo_processo: bytesDoIndice, latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)),
    },
  };
}

function bracoCru(p, repeticoes, bytesRastreados) {
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
      ocorrencias: linhas.length, arquivos_abertos: arquivos.length, bytes_lidos_pelo_processo: bytesRastreados,
    };
  }
  return { ...medida, latencia_ms: latencias, latencia_mediana_ms: arredondar(mediana(latencias)) };
}

/** Nome curto do no pelo rotulo (`symbol caminho#Classe.membro` vira `membro`; arquivo vira o nome sem extensao). */
function nomeDoAlvo(rotulo) {
  const resto = rotulo.slice(rotulo.indexOf(' ') + 1), i = resto.lastIndexOf('#');
  if (i >= 0) return resto.slice(i + 1).split('.').pop();
  return path.basename(resto).replace(/\.[^.]+$/, '');
}

/** A proveniencia: o trecho de cada evidencia, no blob do HEAD, contem o nome do alvo da aresta. */
function conferirProveniencia(respostas) {
  const blobs = new Map(), falhas = [];
  const blob = (p) => {
    if (!blobs.has(p)) blobs.set(p, git(['cat-file', 'blob', `HEAD:${p}`]));
    return blobs.get(p);
  };
  let conferidas = 0;
  for (const r of respostas) {
    for (const a of r.arestas) {
      const nome = nomeDoAlvo(a.to);
      for (const e of a.evidencias) {
        const trecho = blob(e.path).subarray(e.span.byte_start, e.span.byte_end).toString('utf8');
        conferidas++;
        if (!trecho.includes(nome)) falhas.push(`${a.kind} ${a.from} -> ${a.to}: o trecho em ${e.path}:${e.span.line_start} nao cita ${nome}`);
      }
    }
  }
  return { conferidas, falhas };
}

function medir(repeticoes) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=no']).toString('utf8');
  if (status) throw new Error('a medida precisa da arvore limpa: o indice e a leitura crua descrevem o mesmo HEAD');
  const revisao = git(['rev-parse', 'HEAD']).toString('utf8').trim();
  const preparo = JSON.parse(ork(['indexar', '--forcar', '--json']).saida.toString('utf8'));
  const bytesDoIndice = preparo.manifesto.graph_bytes + preparo.manifesto.report_bytes;
  // O que o `git grep` varre: os bytes de todo arquivo rastreado da arvore.
  const rastreados = git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  const bytesRastreados = rastreados.reduce((n, a) => {
    const st = fs.lstatSync(path.join(RAIZ, a), { throwIfNoEntry: false });
    return n + (st && st.isFile() ? st.size : 0);
  }, 0);
  const perguntas = [], respostas = [];
  for (const p of PERGUNTAS) {
    const g = bracoGrafo(p, repeticoes, bytesDoIndice);
    respostas.push(g.resposta);
    perguntas.push({ id: p.id, pergunta: p.pergunta, consulta: p.consulta, grafo: g.medida, cru: bracoCru(p, repeticoes, bytesRastreados), tokens: { grafo: TOKENS, cru: TOKENS } });
  }
  const registro = {
    schema: SCHEMA, medido_em: new Date().toISOString(), revisao, chave_do_indice: preparo.chave, graph_digest: preparo.manifesto.graph_digest,
    maquina: { node: process.version, plataforma: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, carga_1min: arredondar(os.loadavg()[0]) },
    metodo: { ...METODO, repeticoes },
    preparo_do_indice: {
      comando: 'ork grafo indexar --forcar --json', estado: preparo.estado, ms: preparo.ms,
      bytes_do_indice: preparo.manifesto.graph_bytes + preparo.manifesto.report_bytes,
      fontes: preparo.manifesto.conferencia.fontes, arestas: Object.values(preparo.manifesto.contagens.arestas).reduce((n, x) => n + x, 0),
    },
    perguntas, conclusao: CONCLUSAO, limites: LIMITES,
  };
  return { registro, respostas };
}

function validar(registro) {
  const f = [];
  const numero = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const tokensOk = (t) => t && t.value === null && t.source === 'unavailable' && typeof t.unavailable_reason === 'string' && t.unavailable_reason.length > 0;
  if (registro.schema !== SCHEMA) f.push(`schema ${registro.schema}`);
  if (!/^[0-9a-f]{40}$/.test(registro.revisao ?? '')) f.push('revisao');
  if (Number.isNaN(Date.parse(registro.medido_em))) f.push('medido_em');
  if (!registro.maquina || !numero(registro.maquina.carga_1min) || !numero(registro.maquina.cpus) || !registro.maquina.node) f.push('maquina');
  const pr = registro.preparo_do_indice;
  if (!pr || !numero(pr.ms) || !numero(pr.bytes_do_indice) || !numero(pr.fontes) || !numero(pr.arestas)) f.push('preparo_do_indice');
  if (registro.conclusao !== CONCLUSAO) f.push('conclusao');
  if (!Array.isArray(registro.limites) || registro.limites.length < 1) f.push('limites');
  const ids = (registro.perguntas ?? []).map((p) => p.id);
  if (JSON.stringify(ids) !== JSON.stringify(PERGUNTAS.map((p) => p.id))) f.push(`perguntas ${ids}`);
  for (const p of registro.perguntas ?? []) {
    const g = p.grafo ?? {};
    for (const k of ['bytes_ao_agente', 'bytes_json', 'bytes_texto', 'respostas', 'evidencias', 'arquivos_abertos', 'bytes_lidos_pelo_processo', 'latencia_mediana_ms']) {
      if (!numero(g[k])) f.push(`${p.id} grafo.${k}`);
    }
    if (!Array.isArray(g.latencia_ms) || g.latencia_ms.length < 1) f.push(`${p.id} grafo.latencia_ms`);
    const esperado = PERGUNTAS.find((x) => x.id === p.id);
    if (esperado && esperado.cru.indisponivel) {
      if (typeof (p.cru ?? {}).indisponivel !== 'string') f.push(`${p.id} cru.indisponivel`);
    } else {
      for (const k of ['bytes_grep', 'bytes_arquivos', 'bytes_ao_agente', 'ocorrencias', 'arquivos_abertos', 'bytes_lidos_pelo_processo', 'latencia_mediana_ms']) {
        if (!numero((p.cru ?? {})[k])) f.push(`${p.id} cru.${k}`);
      }
    }
    if (!tokensOk(p.tokens && p.tokens.grafo) || !tokensOk(p.tokens && p.tokens.cru)) f.push(`${p.id} tokens`);
  }
  if (/econom(ia|iza)\s+(de|comprovada|medida)|\breduz/i.test(JSON.stringify({ c: registro.conclusao, l: registro.limites }))) f.push('promessa de economia');
  return f;
}

function tabela(registro) {
  escrever(`medida ${registro.schema} na revisao ${registro.revisao.slice(0, 12)}, carga ${registro.maquina.carga_1min} em ${registro.maquina.cpus} nucleos`);
  const pr = registro.preparo_do_indice;
  escrever(`  preparo do indice: ${pr.ms} ms, ${pr.bytes_do_indice} bytes, ${pr.fontes} fontes, ${pr.arestas} arestas (${pr.estado})`);
  for (const p of registro.perguntas) {
    const g = p.grafo, c = p.cru;
    const cru = c.indisponivel ? `cru indisponivel (${c.indisponivel})`
      : `cru ${c.bytes_ao_agente} bytes (${c.ocorrencias} ocorrencias, ${c.arquivos_abertos} arquivos), ${c.latencia_mediana_ms} ms`;
    escrever(`  ${p.id} ${p.pergunta}: grafo ${g.bytes_ao_agente} bytes ao agente (${g.bytes_texto} em texto, ${g.respostas} arestas, ${g.arquivos_abertos} arquivos), ${g.latencia_mediana_ms} ms; ${cru}`);
  }
  escrever(`  tokens: unavailable nos dois bracos; conclusao: ${registro.conclusao}`);
}

function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.validar) {
    const falhas = validar(JSON.parse(fs.readFileSync(a.validar, 'utf8')));
    for (const f of falhas) escrever(`FALHA ${f}`);
    escrever(falhas.length ? `reprovado: ${falhas.length} falha(s)` : `registro ${a.validar} valido`);
    return falhas.length ? 1 : 0;
  }
  const { registro, respostas } = medir(a.repeticoes);
  tabela(registro);
  const falhas = validar(registro);
  if (a.conferir) {
    const p = conferirProveniencia(respostas);
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
  try {
    process.exitCode = principal();
  } catch (e) {
    process.stderr.write(`medir-consulta-grafo: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}

module.exports = { CONCLUSAO, PERGUNTAS, SCHEMA, TOKENS, conferirProveniencia, nomeDoAlvo, validar };
