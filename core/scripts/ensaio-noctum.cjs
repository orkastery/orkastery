#!/usr/bin/env node
/**
 * RM-058, fatia N6 (T8 da ork-rm058n6): o ensaio do piloto do #Noctum, pronto para rodar numa máquina.
 *
 * Monta, numa pasta temporária nova e fora de qualquer projeto, repositórios de teste descartáveis com fila, abre arcos
 * pelo caminho do dono (proposta e envelope assinado do gateway, nunca autorização pelo terminal), injeta falhas e roda
 * arcos curtos com relógio controlado, tique a tique, pelas APIs do `core/dist`: o fechamento por hora, por custo e por
 * fila vazia, a medição das unidades, o relatório da manhã com recibo e o transporte que liga o modo. Cada cenário
 * imprime as expectativas da tabela "Condição / Comportamento / Estado" e do aceite da N6, e o roteiro sai 0 só quando
 * todas valem.
 *
 *   node core/scripts/ensaio-noctum.cjs [--cenario NOME]... [--resumo] [--json] [--manter] [--listar]
 *     --cenario NOME   roda só este cenário (pode repetir); sem ele, todos
 *     --resumo         uma linha por cenário e o total
 *     --json           o resultado no contrato ork.noctum-ensaio/v1
 *     --manter         não apaga a pasta do ensaio no fim (para inspecionar os logs do arco)
 *     --listar         lista os cenários e sai
 *     --sabotar duplicar-envio
 *                      prova que o ensaio reprova: o canal simulado entrega cada mensagem duas vezes, e as expectativas
 *                      de entrega única têm de falhar (sai 1)
 *
 * Nada aqui chama o runtime, a rede ou o Telegram: o runtime (o despacho, a lista de sessões e a parada), as contas, as
 * reservas e o canal são simulados; o canal é um executável local que grava cada mensagem num arquivo da pasta do
 * ensaio, configurado pelo mesmo `noctum-host.json` que o piloto usa. O processo isola HOME, CLAUDE_CONFIG_DIR,
 * CODEX_HOME, o diretório do usuário do `ork` e o registro de projetos dentro da pasta do ensaio, troca as chaves do
 * ingresso por chaves falsas desta execução, tira do ambiente o projeto fixado e a identidade de despacho e desliga as
 * publicações em segundo plano. O piloto de verdade começa só com os valores e a autorização do dono (página da RM-058).
 *
 * Exige Linux com `/usr/bin/flock` (o arco só despacha com a trava do kernel) e o `core/dist` compilado
 * (`npm --prefix core run build`). Sai 0 com todas as expectativas, 1 quando alguma falha e 2 em erro de uso ou de
 * ambiente.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const RAIZ_DO_REPO = path.resolve(__dirname, '../..');
const DIST = path.join(RAIZ_DO_REPO, 'core', 'dist');
const CLI = path.join(DIST, 'index.js');
const CONTRATO = 'ork.noctum-ensaio/v1';
const MAQUINA = 'maquina-do-ensaio';
const MIN = 60_000;
const HORA = 60 * MIN;
const SABOTAGENS = ['duplicar-envio'];
/** O que não entra no ambiente do ensaio: o projeto fixado, a identidade de despacho e a autoridade HITL de quem roda. */
const SEM_ESTES = ['ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'ORK_FILA_PESADA_DONO',
  'ORK_RECEIPT_VERIFIERS', 'LC_ALL', 'LC_MESSAGES'];
/** As publicações em segundo plano (fábrica e rede da pessoa) nunca levam a cópia do ensaio. */
const SEM_PUBLICAR = { ORK_FABRICA_PUBLICAR: '0', ORK_REDE_PUBLICAR: '0' };

/** O canal simulado: confere que a mensagem veio igual pela entrada e pelo argumento, e grava ou falha pelo modo. */
const CANAL_SIMULADO = `'use strict';
const fs = require('node:fs');
const [saida, arquivoDoModo, mensagem] = process.argv.slice(2);
const entrada = fs.readFileSync(0, 'utf8');
if (entrada !== mensagem) { process.stderr.write('a mensagem da entrada difere da do argumento\\n'); process.exit(3); }
const modo = fs.readFileSync(arquivoDoModo, 'utf8').trim();
if (modo === 'falha') { process.stderr.write('canal SIMULADO fora do ar\\n'); process.exit(1); }
if (modo === 'morre') process.kill(process.pid, 'SIGKILL');
const antes = fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\\n').filter(Boolean).length : 0;
for (let i = 0; i < (modo === 'duplica' ? 2 : 1); i++) fs.appendFileSync(saida, JSON.stringify({ mensagem: entrada }) + '\\n');
process.stdout.write(JSON.stringify({ message_id: antes + 1 }));
`;

class ErroDeUso extends Error {}

function lerArgs(argv) {
  const a = { cenarios: [], resumo: false, json: false, manter: false, listar: false, sabotar: null, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--cenario') { if (!argv[i + 1]) throw new ErroDeUso('--cenario exige o nome'); a.cenarios.push(argv[++i]); }
    else if (x === '--sabotar') { if (!argv[i + 1]) throw new ErroDeUso('--sabotar exige o nome'); a.sabotar = argv[++i]; }
    else if (x === '--resumo') a.resumo = true;
    else if (x === '--json') a.json = true;
    else if (x === '--manter') a.manter = true;
    else if (x === '--listar') a.listar = true;
    else if (x === '--ajuda' || x === '-h' || x === '--help') a.ajuda = true;
    else throw new ErroDeUso(`argumento desconhecido: ${x}`);
  }
  if (a.sabotar !== null && !SABOTAGENS.includes(a.sabotar)) throw new ErroDeUso(`sabotagem desconhecida: ${a.sabotar} (há: ${SABOTAGENS.join(', ')})`);
  return a;
}

/** A pasta do ensaio fica fora do repositório e de qualquer projeto do Orkastery (nenhuma pasta acima com `orkastery.yaml`). */
function pastaDoEnsaio() {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ensaio-noctum-')));
  const repo = fs.realpathSync(RAIZ_DO_REPO);
  if (raiz === repo || raiz.startsWith(repo + path.sep)) {
    fs.rmSync(raiz, { recursive: true, force: true });
    throw new ErroDeUso(`a pasta temporária cai dentro do repositório (${raiz}): aponte TMPDIR para fora dele`);
  }
  for (let d = path.dirname(raiz); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'orkastery.yaml'))) {
      fs.rmSync(raiz, { recursive: true, force: true });
      throw new ErroDeUso(`a pasta temporária cai dentro do projeto ${d}: aponte TMPDIR para fora de qualquer projeto`);
    }
    if (path.dirname(d) === d) break;
  }
  return raiz;
}

/** O ambiente do ensaio, antes de carregar qualquer módulo do núcleo: tudo o que o `ork` lê da máquina fica na pasta. */
function isolarAmbiente(raiz) {
  const casa = path.join(raiz, 'casa');
  for (const d of ['.claude', '.codex/sessions', '.orkastery', '.config', '.cache', '.local/state', '.local/share']) {
    fs.mkdirSync(path.join(casa, d), { recursive: true, mode: 0o700 });
  }
  for (const nome of Object.keys(process.env)) if (nome.startsWith('ORK_HITL_') || SEM_ESTES.includes(nome)) delete process.env[nome];
  Object.assign(process.env, SEM_PUBLICAR, {
    HOME: casa, CLAUDE_CONFIG_DIR: path.join(casa, '.claude'), CODEX_HOME: path.join(casa, '.codex'),
    ORK_USUARIO_DIR: path.join(casa, '.orkastery'), ORKASTERY_HOME: path.join(casa, '.orkastery'),
    XDG_CONFIG_HOME: path.join(casa, '.config'), XDG_CACHE_HOME: path.join(casa, '.cache'),
    XDG_STATE_HOME: path.join(casa, '.local/state'), XDG_DATA_HOME: path.join(casa, '.local/share'),
    LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    // O ingresso simulado do Telegram, com uma chave que só existe nesta execução.
    ORK_HITL_INGRESS_KEY_HERMES: `chave-do-ensaio-SIMULADA-${randomBytes(12).toString('hex')}`,
    ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7',
  });
}

function doNucleo(modulo) {
  const arquivo = path.join(DIST, `${modulo}.js`);
  if (!fs.existsSync(arquivo)) throw new ErroDeUso(`falta core/dist/${modulo}.js: rode npm --prefix core run build`);
  return require(arquivo);
}

// ---------------------------------------------------------------------------
// Relógio, projeto, arco e as dependências simuladas.
// ---------------------------------------------------------------------------

const iso = (ms) => new Date(ms).toISOString();
const depois = (base, ms) => iso(Date.parse(base) + ms);
const minutoCheio = (ms) => Math.ceil(ms / MIN) * MIN;

function montarApoio(raiz, n, sabotar) {
  let mensagens = 0;
  const chave = () => process.env.ORK_HITL_INGRESS_KEY_HERMES;

  function git(dir, args) {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
    return r.stdout.trim();
  }

  /** Um repositório descartável com o manifesto do `ork init` do núcleo. */
  function projeto(nome) {
    const dir = path.join(raiz, nome);
    fs.mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'ensaio@orkastery.local']);
    git(dir, ['config', 'user.name', 'Ensaio Noctum']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(dir, 'README.md'), '# repositório descartável do ensaio #Noctum\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-q', '-m', 'inicial']);
    n.init.init(dir, { nome: 'ensaio-noctum', abbrev: 'ens' });
    return { nome, dir, carregado: n.manifest.exigirManifesto(dir) };
  }

  /** A thread #Auto de um trabalho, como o dono a criaria, com o item e o pedido guardado. */
  function threadDoTrabalho(proj, numero, item) {
    return n.thread.novaThread(proj.carregado, { nome: `ensaio trabalho ${numero}`, modo: 'auto', roadmap: item,
      pedido: `Trabalho ${numero} SIMULADO do ensaio #Noctum.`, criarWorktree: false }).thread;
  }

  const horarioNoFuso = (ms, fuso) => { const p = n.horario.partesLocais(ms, fuso); return `${p.hora}:${p.minuto}`; };

  /**
   * O pedido de abertura `v2`: janela de 8 h que começou uma hora antes de agora, no minuto cheio, e o relatório no
   * `HH:MM` do fuso do instante pedido (30 min depois do fim, se nada for dito).
   */
  function pedido(arco, o) {
    const inicio = minutoCheio(Date.now()) - HORA;
    const fim = inicio + 8 * HORA;
    const contas = o.contas ?? [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }];
    const runtimes = o.runtimes ?? [{ runtime: 'claude-bg', sessoes: 3 }];
    const teto = o.teto ?? { valor: 10, unidade: 'sessoes' };
    const fuso = o.fuso ?? 'America/Sao_Paulo';
    const subteto = (valor) => ({ valor: teto.unidade === 'sessoes' ? Math.min(valor, teto.valor) : valor, unidade: 'sessoes' });
    return {
      contrato: 'ork.noctum-envelope/v2', arco,
      janela: { inicio: iso(inicio), fim: iso(fim), fuso },
      destinos: [{ repositorio: 'exemplo/ensaio-noctum', base: 'main', permissoes: ['push', 'pr'] }],
      orcamento: { arco: teto, porConta: contas.map((c) => ({ conta: c.conta, teto: subteto(6) })),
        porRuntime: runtimes.map((r) => ({ runtime: r.runtime, teto: subteto(8) })) },
      relatorio: { horario: horarioNoFuso(o.relatorioEm ?? fim + 30 * MIN, fuso), canal: o.canal ?? 'telegram' },
      trabalhos: o.trabalhos,
      capacidade: { maquina: o.maquina ?? 3, porConta: contas, porRuntime: runtimes, revisao: 0 },
    };
  }

  /** O envelope que o gateway do Hermes assina no endereço do arco, como chega do Telegram. */
  function assinado(arco, resposta, recebidoEm, chaveDoCanal = chave()) {
    mensagens += 1;
    const r = { resposta, origem: 'telegram', canal: 'hermes', por: 'telegram:42', mensagem: `telegram:-7:ensaio-${process.pid}-${mensagens}`,
      recebidoEm };
    return { ...r, prova: n.hitlGates.assinaturaDaResposta(n.arco.ALVO_DO_NOCTUM, n.arco.enderecoDoArco(arco), r, chaveDoCanal) };
  }

  /** Propõe e autoriza pelo ingresso dos gateways (`responderAoArco`, o mesmo do `ork noctum responder`), agora. */
  function abrirArco(proj, p) {
    const agora = iso(Date.now());
    const { envelopeSha256 } = n.arco.proporEnvelope(proj.dir, p, agora);
    const recibo = n.modo.responderAoArco(proj.dir, p.arco, assinado(p.arco, n.arco.textoDeAutorizacao(envelopeSha256), agora), agora);
    const conteudo = n.arco.lerArco(proj.dir, p.arco, agora).conteudo;
    return { sha: envelopeSha256, recibo, fim: conteudo.janela.fim, vencimento: n.relatorio.vencimentoDoRelatorio(conteudo) };
  }

  /** O runtime simulado: abre sessões como o `phase run` deixa no disco, e responde à parada e à lista de sessões. */
  function runtime() {
    const rt = { agora: null, n: 0, vivas: new Set(), paradas: [], falhas: new Map(), despachos: [], baselines: 0 };
    rt.despachar = (carregado, threadId, o) => {
      const falha = rt.falhas.get(threadId) ?? null;
      rt.despachos.push({ thread: threadId, fase: o.fase, conta: o.perfil ?? null, falha });
      if (falha === 'falha-seca') {
        return { sessionId: null, verificada: false, bloqueado: false, motivo: 'runtime.unavailable',
          erro: 'o runtime SIMULADO caiu sem dizer o id da sessão' };
      }
      rt.n += 1;
      const sessionId = `00000000-0000-4000-8000-${String(rt.n).padStart(12, '0')}`;
      n.conducao.registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 12 * HORA },
        { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
      n.ledger.registrar(n.thread.dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { ts: rt.agora, fase: o.fase, sessionId,
        runtime: 'claude-bg', perfil: o.perfil ?? null, pausaAoFim: false, simulado: true });
      rt.vivas.add(sessionId);
      return { sessionId, verificada: true, bloqueado: false, motivo: null };
    };
    rt.parar = (s) => { rt.paradas.push(s.sessionId); rt.vivas.delete(s.sessionId); return { ok: true, detalhe: 'o runtime SIMULADO aceitou a parada' }; };
    rt.listarSessoes = () => ({ lidas: true, vivas: new Set(rt.vivas) });
    rt.consultarSessoes = () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (SIMULADO)', ok: true, detalhe: '' }],
      contas: [{ runtime: 'claude-bg', perfil: null }] });
    rt.perfis = () => [{ id: 'perfil-a', runtime: 'claude-bg' }, { id: 'perfil-b', runtime: 'claude-bg' }, { id: 'perfil-codex', runtime: 'codex' }];
    return rt;
  }

  /** O canal simulado do projeto, pelo `noctum-host.json` local (fora do git), igual ao que o piloto configura. */
  function canal(proj) {
    const script = path.join(raiz, 'canal-simulado.cjs');
    if (!fs.existsSync(script)) fs.writeFileSync(script, CANAL_SIMULADO);
    const saida = path.join(raiz, `${proj.nome}-canal.jsonl`), modo = path.join(raiz, `${proj.nome}-canal.modo`);
    const host = path.join(proj.dir, '.orkastery', 'monitor', n.relatorio.ARQUIVO_DO_TRANSPORTE);
    const c = {
      modo: (m) => fs.writeFileSync(modo, m === 'ok' && sabotar === 'duplicar-envio' ? 'duplica' : m),
      configurar: () => {
        fs.mkdirSync(path.dirname(host), { recursive: true });
        const t = { executavel: process.execPath, argumentos: [script, saida, modo, '{{mensagem}}'] };
        fs.writeFileSync(host, JSON.stringify({ telegram: t, openclaw: t }, null, 2), { mode: 0o600 });
      },
      remover: () => fs.rmSync(host, { force: true }),
      mensagens: () => (fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).mensagem) : []),
      /** As mensagens de um arco, pelo cabeçalho de cada página. */
      doArco: (arco) => c.mensagens().filter((m) => m.startsWith(`Arco ${arco}, relatório v`)),
    };
    c.modo('ok');
    c.configurar();
    return c;
  }

  /** As reservas da cópia local, simuladas: cada item do envelope está com esta máquina. */
  const reservas = (itens) => () => ({ leitura: 'copia-local', reservas: itens.map((item) => ({ item, maquina: MAQUINA, thread: null })) });

  /** Um tique do arco no instante dado, com o runtime, as reservas, a parada e o git simulados. */
  function tique(proj, arco, rt, quando, itens, extra = {}) {
    rt.agora = quando;
    return n.modo.tiqueDoArco(proj.carregado, arco, { quando, maquina: MAQUINA, lerReservas: reservas(itens), parar: rt.parar,
      listarSessoes: rt.listarSessoes, git: () => null, ...extra,
      opcoesDoPasso: { despachar: rt.despachar, consultarSessoes: rt.consultarSessoes, perfis: rt.perfis,
        abrirThread: (k, o) => n.thread.novaThread(k, { ...o, criarWorktree: false }).thread,
        gravarBaseline: () => { rt.baselines += 1; }, esperarVezMs: 5_000 } });
  }

  const registrar = (proj, threadId, tipo, dados) => n.ledger.registrar(n.thread.dirThread(proj.dir, threadId), threadId, tipo, dados);
  /** A fase concluída com o resultado do observador. */
  const concluirSessao = (proj, threadId, sessionId, fase, ts) =>
    registrar(proj, threadId, 'phase_result', { ts, fase, sessionId, classificacao: 'fase_concluida', ok: true, simulado: true });
  /** A sessão que morre sem terminal: o que o observador grava (a morte, o bloqueio e o resultado). */
  function morrerSessao(proj, threadId, sessionId, fase, ts) {
    const dados = { ts, fase, sessionId, classificacao: 'gate_blocked', motivo: 'runtime.unavailable', ok: false, gate: 'phase.dispatch',
      origem: 'sessions.watch', simulado: true };
    registrar(proj, threadId, 'sessao_morta', dados);
    registrar(proj, threadId, 'gate_blocked', dados);
    registrar(proj, threadId, 'phase_result', dados);
  }
  /** A entrega com a prova do push verificado no remoto (o que a N5 e a condutora gravam). */
  const entregarComProva = (proj, threadId, ts, k) => registrar(proj, threadId, 'ship_done', { ts, pushVerificado: true,
    fonteDaProva: 'git ls-remote origin refs/heads/main (SIMULADO)', mergeSha: String(k).repeat(40).slice(0, 40), pr: 100 + k, simulado: true });
  /** A entrega registrada sem a prova do push (o `ork ship` sem o remoto conferido): não conta como entregue. */
  const entregarSemProva = (proj, threadId, ts) => registrar(proj, threadId, 'ship_done', { ts, origem: 'local', simulado: true });
  const reverterEntrega = (proj, threadId, ts) => registrar(proj, threadId, 'rollback_done', { ts, motivo: 'entrega revertida (SIMULADA)', simulado: true });

  /** O `ork` desta árvore num processo filho, no projeto, com o ambiente do ensaio. */
  function ork(proj, args, entrada) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd: proj.dir, encoding: 'utf8', input: entrada, timeout: 120_000, env: process.env });
  }
  const argvResponder = (arco, e) => ['noctum', 'responder', arco, '--resposta-stdin', '--origem', e.origem, '--canal', e.canal, '--por', e.por,
    '--mensagem', e.mensagem];

  function json(texto) { try { return JSON.parse(texto); } catch { return null; } }

  /** A recusa tipada do arco, ou `null` quando a função passou. */
  function recusaDe(fn) {
    try { fn(); return null; } catch (e) { if (e instanceof n.envelope.RecusaDoArco) return e.motivo; throw e; }
  }

  return { projeto, threadDoTrabalho, pedido, assinado, abrirArco, runtime, canal, tique, registrar, concluirSessao, morrerSessao,
    entregarComProva, entregarSemProva, reverterEntrega, ork, argvResponder, json, recusaDe, horarioNoFuso };
}

// ---------------------------------------------------------------------------
// Os cenários. Cada um tem a própria pasta, o próprio projeto e o próprio relógio.
// ---------------------------------------------------------------------------

const GRUPOS = ['✅ Entregue', '🔄 Em curso', '⏸️ Impedido', '🧭 Decidi no envelope', '💰 Custo e duração', '📝 Correções', '👤 O que precisa de você'];
const gruposEmOrdem = (texto) => { const p = GRUPOS.map((g) => texto.indexOf(`\n${g}\n`)); return p.every((x, i) => x > 0 && (i === 0 || x > p[i - 1])); };

/** O transporte que liga o modo: proposta, ingresso assinado, `#Noctum` só com envelope vigente, lista fechada. */
function cenarioLigarOModo(c, a, n) {
  const proj = a.projeto('ligar-o-modo');
  const t = a.threadDoTrabalho(proj, 1, 'RM-901');
  const semArco = a.ork(proj, ['modos', '--do-pedido', '#Noctum seguir o roadmap']);
  c.esperar('sem envelope vigente, o #Noctum é recusado tipado (noctum.modo.sem-envelope) e nunca cai no modo padrão em silêncio',
    semArco.status === 2 && semArco.stdout === '' && /noctum\.modo\.sem-envelope/.test(semArco.stderr), `${semArco.status}: ${semArco.stderr}`);
  const p = a.pedido('arco-ligar', { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
  const arquivo = path.join(path.dirname(proj.dir), 'ligar-o-modo-envelope.json');
  fs.writeFileSync(arquivo, JSON.stringify(p, null, 2));
  const proposta = a.ork(proj, ['noctum', 'propor', '--arquivo', arquivo, '--json']);
  const pj = a.json(proposta.stdout) ?? {};
  const sha = pj.envelopeSha256;
  c.esperar('ork noctum propor grava a proposta e não autoriza nada: devolve o hash e diz como o dono autoriza (/ork noctum <arco> autorizar <sha256>)',
    proposta.status === 0 && pj.autorizado === false && Array.isArray(pj.comoAutorizar) &&
      pj.comoAutorizar.some((x) => x.includes(`/ork noctum arco-ligar autorizar ${sha}`)), `${proposta.status}: ${proposta.stderr}`);
  const aindaSem = a.ork(proj, ['modos', '--do-pedido', '#Noctum seguir o roadmap']);
  c.esperar('a proposta sozinha não liga o modo: o #Noctum segue recusado até o dono autorizar', aindaSem.status === 2, aindaSem.stdout);
  const forjado = a.assinado('arco-ligar', n.arco.textoDeAutorizacao(sha), iso(Date.now()), 'chave-que-nao-e-a-do-canal-SIMULADA-0000000000');
  const rf = a.ork(proj, a.argvResponder('arco-ligar', forjado), JSON.stringify(forjado));
  c.esperar('a mensagem assinada com outra chave é recusada (noctum.origem.sem-prova), e o arco segue só proposto',
    rf.status === 2 && /noctum\.origem\.sem-prova/.test(rf.stderr) && n.arco.lerArco(proj.dir, 'arco-ligar').situacao === 'proposto',
    `${rf.status}: ${rf.stderr}`);
  const e = a.assinado('arco-ligar', n.arco.textoDeAutorizacao(sha), iso(Date.now()));
  const rr = a.ork(proj, a.argvResponder('arco-ligar', e), JSON.stringify(e));
  const recibo = a.json(rr.stdout) ?? {};
  c.esperar('o envelope assinado pelo gateway, entregue a ork noctum responder pela entrada, autoriza o arco com o recibo ork.noctum-ingresso/v1',
    rr.status === 0 && recibo.contrato === 'ork.noctum-ingresso/v1' && recibo.ato === 'autorizar' && recibo.situacao === 'vigente' &&
      recibo.repetida === false, `${rr.status}: ${rr.stderr}${rr.stdout}`);
  const deNovo = a.ork(proj, a.argvResponder('arco-ligar', e), JSON.stringify(e));
  c.esperar('a mesma mensagem de novo não autoriza duas vezes: o recibo diz repetida, e o gateway não confirma de novo ao dono',
    deNovo.status === 0 && (a.json(deNovo.stdout) ?? {}).repetida === true, `${deNovo.status}: ${deNovo.stderr}`);
  const comArco = a.ork(proj, ['modos', '--do-pedido', '#Noctum seguir o roadmap', '--json']);
  const mj = a.json(comArco.stdout) ?? {};
  c.esperar('com o envelope vigente, o #Noctum é aceito e devolve o arco, e as threads do arco seguem #Auto',
    comArco.status === 0 && mj.modo === 'noctum' && (mj.arcos ?? []).some((x) => x.arco === 'arco-ligar') && mj.modoDasThreads === 'auto',
    `${comArco.status}: ${comArco.stderr}${comArco.stdout}`);
  const nova = a.ork(proj, ['thread', 'new', 'trabalho fora da lista', '--modo', 'noctum']);
  c.esperar('thread nova em #Noctum é recusada pela lista fechada (noctum.modo.lista-fechada): trabalho novo entra por emenda do envelope',
    nova.status === 2 && /noctum\.modo\.lista-fechada/.test(nova.stderr), `${nova.status}: ${nova.stderr}`);
  const status = a.ork(proj, ['noctum', 'status', 'arco-ligar', '--json']);
  const sj = a.json(status.stdout) ?? {};
  c.esperar('ork noctum status mostra o arco vigente, o consumo contra o teto e o relatório agendado no fuso do envelope',
    status.status === 0 && sj.situacao === 'vigente' && (sj.consumo ?? []).some((x) => x.escopo === 'do arco') &&
      typeof sj.relatorio?.vencimentoEm === 'string' && sj.janela?.fuso === 'America/Sao_Paulo', `${status.status}: ${status.stderr}`);
}

/** O arco curto de ponta a ponta: falhas injetadas, continuidade, fim com sessão em voo, relatório e recibo. */
function cenarioArcoCurto(c, a, n) {
  const proj = a.projeto('arco-curto');
  const canal = a.canal(proj);
  const rt = a.runtime();
  const th = [1, 2, 3].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  const itens = ['RM-901', 'RM-902', 'RM-903', 'RM-904'];
  const trabalhos = [
    { id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: th[0].id },
    { id: 't2', item: 'RM-902', prioridade: 2, dependeDe: [], thread: th[1].id },
    { id: 't3', item: 'RM-903', prioridade: 3, dependeDe: [], thread: th[2].id },
    { id: 't4', item: 'RM-904', prioridade: 4, dependeDe: ['t3'], pedido: 'Fatia SIMULADA que o arco abre depois de o t3 ser entregue.' },
  ];
  const arco = a.abrirArco(proj, a.pedido('arco-curto', { trabalhos, maquina: 4, runtimes: [{ runtime: 'claude-bg', sessoes: 4 }] }));
  rt.falhas.set(th[0].id, 'falha-seca');
  const t0 = new Date(minutoCheio(Date.now()) + MIN).toISOString();
  const em = (min) => depois(t0, min * MIN);
  const tq = (quando) => a.tique(proj, 'arco-curto', rt, quando, itens);
  const r0 = tq(em(0));
  const estado0 = n.arco.lerArco(proj.dir, 'arco-curto', em(0));
  const d1 = estado0.despachos.filter((d) => d.trabalho === 't1');
  c.esperar('o despacho que cai sem dizer o id da sessão deixa a reserva pendente e contada: o runtime pode ter aberto a sessão',
    r0.passo?.acao === 'recusado' && d1.length === 1 && d1[0].desfecho === 'pendente' && estado0.consumo.arco === 1,
    JSON.stringify({ passo: r0.passo?.acao, d1, consumo: estado0.consumo }));
  tq(em(1));
  tq(em(2));
  const r3 = tq(em(3));
  const estado3 = n.arco.lerArco(proj.dir, 'arco-curto', em(3));
  const porTrabalho = (e, id) => e.despachos.filter((d) => d.trabalho === id);
  c.esperar('o arco segue com o trabalho independente: t2 e t3 despachados nos tiques seguintes, cada um com uma sessão, e o t1 nunca de novo',
    porTrabalho(estado3, 't1').length === 1 && porTrabalho(estado3, 't2').length === 1 && porTrabalho(estado3, 't3').length === 1 &&
      porTrabalho(estado3, 't2')[0].desfecho === 'concluido' && r3.passo?.acao === 'aguardar',
    JSON.stringify(estado3.despachos.map((d) => [d.trabalho, d.desfecho])) + ` ${r3.passo?.acao}`);
  const fila3 = n.modo.retratoDoArco(proj.carregado, 'arco-curto', { quando: em(3), maquina: MAQUINA,
    lerReservas: () => ({ leitura: 'copia-local', reservas: itens.map((item) => ({ item, maquina: MAQUINA, thread: null })) }) }).fila;
  const trabalho = (f, id) => f.trabalhos.find((x) => x.id === id) ?? {};
  c.esperar('com a reserva pendente, o t1 vai para a retomada da N4, e o t4 espera a dependência do t3',
    trabalho(fila3, 't1').motivo === 'retomada' && trabalho(fila3, 't4').motivo === 'dependencia', JSON.stringify(fila3.trabalhos));
  // A sessão do t2 morre no meio; a do t3 conclui e o t3 é entregue com a prova do push.
  const s2 = porTrabalho(estado3, 't2')[0].sessionId, s3 = porTrabalho(estado3, 't3')[0].sessionId;
  a.morrerSessao(proj, th[1].id, s2, 'GOAL', em(20));
  rt.vivas.delete(s2);
  const r21 = tq(em(21));
  a.concluirSessao(proj, th[2].id, s3, 'GOAL', em(40));
  rt.vivas.delete(s3);
  a.entregarComProva(proj, th[2].id, em(45), 3);
  const r46 = tq(em(46));
  const estado46 = n.arco.lerArco(proj.dir, 'arco-curto', em(46));
  const d4 = porTrabalho(estado46, 't4');
  const threadT4 = d4[0]?.threadDespachada ?? d4[0]?.thread ?? null;
  const t4 = threadT4 ? n.thread.lerThread(proj.dir, threadT4) : null;
  c.esperar('entregue o t3 com a prova do push, o arco abre a thread #Auto do t4 com o item e o pedido do envelope e a despacha pelo GOAL',
    r46.passo?.acao === 'despachou' && d4.length === 1 && t4?.modo === 'auto' && t4?.roadmap === 'RM-904' && d4[0].fase === 'GOAL',
    JSON.stringify({ passo: r46.passo?.acao, d4 }));
  c.esperar('a sessão que morreu tira o t2 da fila executável (retomada da N4), sem sessão nova por cima; só com bloqueios e sessão em curso, o passo espera',
    porTrabalho(estado46, 't2').length === 1 && rt.despachos.filter((d) => d.thread === th[1].id).length === 1 && r21.passo?.acao === 'aguardar',
    JSON.stringify({ despachos: rt.despachos, r21: r21.passo?.acao }));
  // A decisão que só o dono toma vai ao lote, com alternativas e uma recomendada.
  const decisao = n.arco.enfileirarDecisao(proj.dir, 'arco-curto', { thread: th[1].id, acaoImpedida: 'redespachar o GO do t2',
    dependentes: [], impacto: 'o t2 fica parado até a decisão', pergunta: 'A sessão do t2 morreu no meio do GOAL. Como seguimos com ele?',
    alternativas: [
      { letra: 'a', texto: 'Retomar num arco novo pelo checkpoint', consequencia: 'volta amanhã sem perder o que foi feito', recomendada: true,
        porque: 'a retomada pela prova mais adiantada não repete trabalho' },
      { letra: 'b', texto: 'Tirar o t2 do roadmap desta semana', consequencia: 'libera a capacidade para outro item' },
      { letra: 'c', texto: 'Reabrir do zero', consequencia: 'refaz o GOAL e descarta o que a sessão deixou' }] }, em(50));
  const fim = arco.fim;
  const rAntes = tq(depois(fim, -MIN));
  c.esperar('um minuto antes do fim o arco segue, com o t4 em curso', !rAntes.fechamento.fechado, rAntes.fechamento.detalhe);
  const rFim = tq(fim);
  const sessaoT4 = d4[0]?.sessionId;
  const porSessao = Object.fromEntries((rFim.fechamento.paradas ?? []).map((p) => [p.sessionId ?? `reserva:${p.seq}`, p.resultado]));
  c.esperar('no fim do envelope o arco fecha por hora e pede a parada da sessão em voo uma vez, pelo controle da conta dela',
    rFim.fechamento.agora && rFim.fechamento.motivo === 'hora' && rFim.passo === null && porSessao[sessaoT4] === 'pedida' &&
      rt.paradas.filter((s) => s === sessaoT4).length === 1, JSON.stringify({ f: rFim.fechamento.motivo, porSessao, paradas: rt.paradas }));
  c.esperar('a reserva pendente do t1 entra no fechamento como sessão possível sem id para parar, e a sessão morta não é parada de novo',
    porSessao[`reserva:${d1[0].seq}`] === 'sem-id' && !(s2 in porSessao), JSON.stringify(porSessao));
  const rConf = tq(depois(fim, 5 * MIN));
  c.esperar('no tique seguinte a lista do runtime confirma a parada, e nenhuma parada é pedida de novo',
    rConf.fechamento.conferencias.some((x) => x.sessionId === sessaoT4 && x.confirmada) && rt.paradas.length === 1,
    JSON.stringify(rConf.fechamento.conferencias));
  const contaOutra = estado46.despachos.find((d) => d.trabalho === 't4')?.conta === 'perfil-a' ? 'perfil-b' : 'perfil-a';
  const recusa = a.recusaDe(() => n.arco.reservarDespacho(proj.dir, { arco: 'arco-curto', envelopeSha256: arco.sha, trabalho: 't1', thread: th[0].id,
    fase: 'GOAL', runtime: 'claude-bg', conta: contaOutra, revisao: false }, depois(fim, 6 * MIN)));
  c.esperar('depois do fechamento nenhuma reserva passa, nem por outra conta (noctum.efeito.encerrado)', recusa === 'noctum.efeito.encerrado', String(recusa));
  const retomada = n.fechamento.lerFechamento(proj.dir, 'arco-curto').retrato?.retomada ?? {};
  c.esperar('o estado de retomada lista a reserva pendente, a reconciliação pendente e a instrução de retomar num arco novo',
    (retomada.reservasEmVoo ?? []).some((r) => r.trabalho === 't1') && (retomada.reconciliacaoPendente ?? []).length >= 2 &&
      (retomada.instrucao ?? []).some((x) => /reconciliadas antes do primeiro despacho do arco novo/.test(x)), JSON.stringify(retomada));
  const vencimento = arco.vencimento;
  const rRel = tq(vencimento);
  const paginas = canal.doArco('arco-curto');
  const texto = paginas.join('\n');
  c.esperar('o relatório da manhã sai no horário do envelope pelo canal combinado, com recibo de cada página',
    rRel.relatorio.acao === 'entregue' && rRel.relatorio.versao === 1 && paginas.length >= 1, JSON.stringify(rRel.relatorio));
  c.esperar('os sete grupos da página aparecem na ordem, e o arco diz que fechou às HH:MM pela hora final', gruposEmOrdem(`\n${texto}`) &&
    /O arco fechou às .+ \(hora final\)/.test(texto), texto.slice(0, 400));
  c.esperar('Entregue só com a prova do push (t3); t1 e t2 em Impedido, com o lote do dono marcado #HITL e as alternativas',
    /• t3 \(RM-903\): thread .+ push provado/.test(texto) && /• t1 \(RM-901\): retomada/.test(texto) && /• t2 \(RM-902\): .+#HITL/.test(texto) &&
      texto.includes(`• ${decisao.id} (${th[1].id}):`) && /\ba\) Retomar num arco novo pelo checkpoint: .+\(Recomendação: /.test(texto), texto);
  c.esperar('o t4 aparece em curso, com o próximo passo de retomada e a parada do fechamento confirmada; a reserva sem id sai em palavras',
    /• t4 \(RM-904\): thread .+próximo passo: conferir a sessão que o fechamento mandou parar e retomar pela prova mais adiantada/.test(texto) &&
      texto.includes(`• no fechamento, ${sessaoT4} (t4, claude-bg): parada confirmada`) &&
      texto.includes(`• no fechamento, reserva ${d1[0].seq} (t1, claude-bg): reserva pendente sem id de sessão, nada a parar`) &&
      !/sendo conduzida agora|: sem-id\b/.test(texto), texto);
  c.esperar('o custo traz as sessões medidas contra o teto do arco, de cada conta e do runtime, e as sessões despachadas pelo arco',
    /• Teto do arco: 4 sessoes de 10 sessoes/.test(texto) && /• Teto da conta perfil-a: \d sessoes de 6 sessoes/.test(texto) &&
      /• Teto do runtime claude-bg: 4 sessoes de 8 sessoes/.test(texto) && /• Sessões despachadas pelo arco: 4/.test(texto), texto);
  c.esperar('a supervisão da N4, ainda fora da base, aparece como fonte não lida, em vez de vazia',
    /Não lido: .*a supervisão e a retomada da N4 não foram lidas nesta instalação/.test(texto), texto.slice(0, 600));
  const rDepois = tq(depois(vencimento, 10 * MIN));
  c.esperar('cada página chegou ao canal uma vez só, e o tique seguinte não manda nada de novo',
    canal.doArco('arco-curto').length === paginas.length && new Set(paginas).size === paginas.length && rDepois.relatorio.enviadas === 0 &&
      rDepois.relatorio.acao === 'entregue', `${canal.doArco('arco-curto').length} mensagens`);
  c.esperar('nenhuma baseline foi gravada e nenhum runtime de verdade foi chamado: todo despacho passou pelo runtime simulado',
    rt.baselines === 0 && rt.despachos.length === 4, JSON.stringify(rt.despachos));
}

/** O prazo e o fuso: o relatório vence no primeiro HH:MM do fuso, nada antes, e o fechamento cedo não antecipa. */
function cenarioPrazoEFuso(c, a, n) {
  const base = a.pedido('arco-puro', { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ens-simulada' }] });
  const venc = (inicio, fim, fuso, horario) => n.relatorio.vencimentoDoRelatorio(n.envelope.validarPedidoDeAbertura({ ...base,
    janela: { inicio, fim, fuso }, relatorio: { horario, canal: 'telegram' } }));
  c.esperar('em Brasília, arco das 22 h às 6 h com o relatório às 07:30: vence às 10:30 UTC do dia seguinte',
    venc('2026-10-12T22:00:00-03:00', '2026-10-13T06:00:00-03:00', 'America/Sao_Paulo', '07:30') === '2026-10-13T10:30:00.000Z');
  c.esperar('no domingo em que Nova York adianta o relógio, o 07:00 já é horário de verão: vence às 11:00 UTC',
    venc('2026-03-07T22:00:00-05:00', '2026-03-08T06:00:00-04:00', 'America/New_York', '07:00') === '2026-03-08T11:00:00.000Z');
  c.esperar('o 02:30 que o salto pula vence depois do salto, às 03:30 locais (07:30 UTC)',
    venc('2026-03-07T22:00:00-05:00', '2026-03-08T06:00:00-04:00', 'America/New_York', '02:30') === '2026-03-08T07:30:00.000Z');
  const proj = a.projeto('prazo-e-fuso');
  const canal = a.canal(proj);
  const rt = a.runtime();
  const t = a.threadDoTrabalho(proj, 1, 'RM-901');
  a.entregarComProva(proj, t.id, iso(Date.now()), 1);
  // Sem horário de verão e com o nome IANA que o núcleo guarda como veio (Asia/Kolkata vira Asia/Calcutta no ICU).
  const fuso = 'Asia/Tokyo';
  const vence = minutoCheio(Date.now()) + 2 * HORA;
  const arco = a.abrirArco(proj, a.pedido('arco-fuso', { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }],
    fuso, relatorioEm: vence, canal: 'openclaw' }));
  c.esperar(`o relatório vence no primeiro ${a.horarioNoFuso(vence, fuso)} de ${fuso} depois do início da janela, não no fuso da máquina`,
    arco.vencimento === iso(vence), `${arco.vencimento} contra ${iso(vence)}`);
  const t0 = iso(minutoCheio(Date.now()) + MIN);
  const r0 = a.tique(proj, 'arco-fuso', rt, t0, ['RM-901']);
  c.esperar('com a fila vazia confirmada, o arco fecha cedo (fila-vazia) no primeiro tique, sem despachar nem abrir escopo novo',
    r0.fechamento.agora && r0.fechamento.motivo === 'fila-vazia' && rt.despachos.length === 0, JSON.stringify(r0.fechamento.motivo));
  const retrato = r0.fechamento.retrato ?? {};
  c.esperar('o retrato do fechamento guarda a fila lida e o item concluído (entregue)', retrato.fila?.lida === true &&
    (retrato.retomada?.trabalhos ?? []).some((x) => x.id === 't1' && x.estado === 'entregue'), JSON.stringify(retrato.fila));
  c.esperar('fechar cedo não antecipa o relatório: nada é composto antes do horário', r0.relatorio.acao === 'aguardar' &&
    n.registro.lerRegistro(proj.dir, 'arco-fuso', 'relatorio').length === 0, JSON.stringify(r0.relatorio));
  const r1 = a.tique(proj, 'arco-fuso', rt, depois(arco.vencimento, -MIN), ['RM-901']);
  c.esperar('um minuto antes do vencimento, ainda nada sai', r1.relatorio.acao === 'aguardar' && canal.mensagens().length === 0, r1.relatorio.acao);
  const r2 = a.tique(proj, 'arco-fuso', rt, arco.vencimento, ['RM-901']);
  const texto = canal.doArco('arco-fuso').join('\n');
  c.esperar('no vencimento a versão 1 é composta e entregue pelo canal do envelope (openclaw), com recibo',
    r2.relatorio.acao === 'entregue' && r2.relatorio.canal === 'openclaw' && canal.doArco('arco-fuso').length === 1, JSON.stringify(r2.relatorio));
  const horaLocal = n.horario.formatarHora(t0, { fuso, agora: arco.vencimento, locale: 'pt-BR' });
  c.esperar(`o texto diz o fuso e dá os horários nele: o fechamento às ${horaLocal} de ${fuso}`,
    texto.includes(`Horários em ${fuso}.`) && texto.includes(`O arco fechou às ${horaLocal} (fila vazia)`), texto.slice(0, 300));
}

/** O teto do arco com sessões em voo: para tudo, sem retry nem troca de conta, e deixa o estado para retomar. */
function cenarioTetoComSessoesEmVoo(c, a, n) {
  const proj = a.projeto('teto-com-sessoes');
  a.canal(proj);
  const rt = a.runtime();
  const th = [1, 2, 3].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  const itens = ['RM-901', 'RM-902', 'RM-903'];
  const trabalhos = th.map((x, i) => ({ id: `t${i + 1}`, item: itens[i], prioridade: i + 1, dependeDe: [], thread: x.id }));
  const arco = a.abrirArco(proj, a.pedido('arco-teto', { trabalhos, teto: { valor: 2, unidade: 'sessoes' } }));
  const t0 = iso(minutoCheio(Date.now()) + MIN);
  const tq = (min) => a.tique(proj, 'arco-teto', rt, depois(t0, min * MIN), itens);
  tq(0);
  tq(1);
  const e1 = n.arco.lerArco(proj.dir, 'arco-teto', depois(t0, MIN));
  const contas = [...new Set(e1.despachos.map((d) => d.conta))];
  c.esperar('dois despachos alcançam o teto do arco (2 sessões), com as duas sessões em voo', e1.consumo.arco === 2 && rt.vivas.size === 2,
    JSON.stringify(e1.consumo));
  const r2 = tq(2);
  const e2 = n.arco.lerArco(proj.dir, 'arco-teto', depois(t0, 2 * MIN));
  c.esperar('o tique seguinte fecha por custo antes de qualquer despacho novo: o t3 não ganha reserva',
    r2.fechamento.agora && r2.fechamento.motivo === 'custo' && r2.passo === null && e2.despachos.length === 2 &&
      /teto do arco é de 2 sessoes e 2 foram reservadas/.test(r2.fechamento.detalhe), r2.fechamento.detalhe);
  c.esperar('cada sessão em voo recebeu exatamente um pedido de parada, pelo controle da conta dela', rt.paradas.length === 2 &&
    new Set(rt.paradas).size === 2 && r2.fechamento.paradas.every((p) => p.resultado === 'pedida'), JSON.stringify(rt.paradas));
  const recusas = ['perfil-a', 'perfil-b'].map((conta) => a.recusaDe(() => n.arco.reservarDespacho(proj.dir, { arco: 'arco-teto', envelopeSha256: arco.sha,
    trabalho: 't3', thread: th[2].id, fase: 'GOAL', runtime: 'claude-bg', conta, revisao: false }, depois(t0, 3 * MIN))));
  c.esperar(`sem troca de conta para contornar: nem ${contas.length > 1 ? 'as duas contas' : 'outra conta'} reservam depois do teto (noctum.efeito.encerrado)`,
    recusas.every((x) => x === 'noctum.efeito.encerrado'), JSON.stringify(recusas));
  const r7 = tq(7);
  c.esperar('sem retry: o tique seguinte confirma as paradas e não pede nada de novo, nem despacha', r7.fechamento.conferencias.length === 2 &&
    r7.fechamento.conferencias.every((x) => x.confirmada) && rt.paradas.length === 2 && rt.despachos.length === 2,
    JSON.stringify(r7.fechamento.conferencias));
  const retrato = n.fechamento.lerFechamento(proj.dir, 'arco-teto').retrato ?? {};
  c.esperar('o estado deixado para retomar identifica o consumo, as sessões em voo a reconciliar e o trabalho que sobrou',
    retrato.motivo === 'custo' && (retrato.retomada?.reconciliacaoPendente ?? []).filter((x) => /em voo no fechamento/.test(x)).length === 2 &&
      (retrato.retomada?.trabalhos ?? []).some((x) => x.id === 't3' && x.estado !== 'entregue') &&
      (retrato.retomada?.instrucao ?? []).some((x) => /não reabre/.test(x)), JSON.stringify(retrato.retomada));
  const situacao = n.arco.lerArco(proj.dir, 'arco-teto', depois(t0, 8 * MIN)).situacao;
  c.esperar('o arco fica encerrado: nada o reabre dentro da janela', situacao === 'encerrado', situacao);
}

/** A medição: teto em minutos medidos, que fecha com as sessões em voo, e teto em tokens com lacuna, que nunca vale zero. */
function cenarioTetoMedido(c, a, n) {
  const proj = a.projeto('teto-medido');
  a.canal(proj);
  const rt = a.runtime();
  const th = [1, 2, 3].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  const itens = ['RM-901', 'RM-902', 'RM-903'];
  const trabalhos = th.map((x, i) => ({ id: `t${i + 1}`, item: itens[i], prioridade: i + 1, dependeDe: [], thread: x.id }));
  a.abrirArco(proj, a.pedido('arco-minutos', { trabalhos, teto: { valor: 30, unidade: 'minutos-de-sessao' } }));
  const t0 = iso(minutoCheio(Date.now()) + MIN);
  const tq = (arco, min) => a.tique(proj, arco, rt, depois(t0, min * MIN), itens);
  tq('arco-minutos', 0);
  tq('arco-minutos', 1);
  tq('arco-minutos', 2);
  c.esperar('com o consumo medido abaixo do teto de 30 minutos, o arco despacha os três trabalhos', rt.despachos.length === 3 &&
    rt.vivas.size === 3, JSON.stringify(rt.despachos.map((d) => d.thread)));
  const r10 = tq('arco-minutos', 10);
  c.esperar('com 27 minutos medidos (10, 9 e 8, das sessões em voo), o arco segue', !r10.fechamento.fechado, r10.fechamento.detalhe);
  const r12 = tq('arco-minutos', 12);
  const consumo = r12.fechamento.retrato?.consumo?.['minutos-de-sessao'] ?? {};
  c.esperar('com 33 de 30 minutos medidos, o arco fecha por custo com as três sessões em voo e pede a parada de cada uma',
    r12.fechamento.agora && r12.fechamento.motivo === 'custo' && /30 minutos-de-sessao e o consumo medido é 33/.test(r12.fechamento.detalhe) &&
      rt.paradas.length === 3, r12.fechamento.detalhe);
  c.esperar('a medição de minutos vem do despacho ao instante da leitura, marcada como parcial pelas sessões em voo',
    consumo.valor === 33 && consumo.parcial === true, JSON.stringify(consumo));
  const tokens = r12.fechamento.retrato?.consumo?.tokens ?? {};
  const cota = r12.fechamento.retrato?.consumo?.['percentual-da-cota'] ?? {};
  c.esperar('sem transcrição legível, tokens ficam como lacuna, e a cota do claude-bg também: nenhuma estimativa vira gasto medido',
    tokens.valor === null && (tokens.lacunas ?? []).length > 0 && cota.valor === null && (cota.lacunas ?? []).length > 0,
    JSON.stringify({ tokens, cota }));
  // O teto em tokens: sem sessão, zero provado; com a sessão em voo sem transcrição, lacuna, e a reserva recusa.
  const proj2 = a.projeto('teto-em-tokens');
  const rt2 = a.runtime();
  const th2 = [1, 2].map((k) => a.threadDoTrabalho(proj2, k, `RM-90${k}`));
  a.abrirArco(proj2, a.pedido('arco-tokens', { trabalhos: th2.map((x, i) => ({ id: `t${i + 1}`, item: `RM-90${i + 1}`, prioridade: i + 1,
    dependeDe: [], thread: x.id })), teto: { valor: 100000, unidade: 'tokens' } }));
  const tk = (min) => a.tique(proj2, 'arco-tokens', rt2, depois(t0, min * MIN), ['RM-901', 'RM-902']);
  const k0 = tk(0);
  c.esperar('sem nenhuma sessão do arco, o consumo em tokens é zero provado, e o primeiro despacho passa',
    k0.passo?.acao === 'despachou' && rt2.despachos.length === 1, JSON.stringify(k0.passo?.acao));
  const k1 = tk(1);
  c.esperar('com a sessão em voo sem transcrição, o consumo em tokens é lacuna: a reserva recusa (noctum.orcamento.sem-medicao) e nada mais sai',
    k1.passo?.acao === 'recusado' && k1.passo.motivo === 'noctum.orcamento.sem-medicao' && rt2.despachos.length === 1 &&
      n.arco.lerArco(proj2.dir, 'arco-tokens', depois(t0, MIN)).despachos.length === 1, JSON.stringify(k1.passo));
  const k2 = tk(2);
  c.esperar('lacuna não prova o teto alcançado: o arco não fecha por custo e segue até o fim ou até a medição voltar',
    !k2.fechamento.fechado && rt2.despachos.length === 1, k2.fechamento.detalhe);
}

/** A falta de recibo e o reenvio sem duplicação: sem transporte, com falha, com envio incerto e com o reenvio do dono. */
function cenarioSemReciboEReenvio(c, a, n) {
  const proj = a.projeto('sem-recibo');
  const canal = a.canal(proj);
  const rt = a.runtime();
  const [ta, tb] = [1, 2].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  a.entregarComProva(proj, ta.id, iso(Date.now()), 1);
  a.entregarComProva(proj, tb.id, iso(Date.now()), 2);
  const vence = minutoCheio(Date.now()) + 2 * HORA;
  const arco = a.abrirArco(proj, a.pedido('arco-recibo', { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: ta.id }],
    relatorioEm: vence }));
  const t0 = iso(minutoCheio(Date.now()) + MIN);
  a.tique(proj, 'arco-recibo', rt, t0, ['RM-901']);
  canal.remover();
  const v = arco.vencimento;
  const tq = (min) => a.tique(proj, 'arco-recibo', rt, depois(v, min * MIN), ['RM-901']);
  const lacunas = (quando) => n.modo.retratoDoArco(proj.carregado, 'arco-recibo', { quando, maquina: MAQUINA,
    lerReservas: () => ({ leitura: 'copia-local', reservas: [] }) }).lacunas;
  const tentativas = () => n.registro.lerRegistro(proj.dir, 'arco-recibo', 'relatorio').filter((l) => l.evento.tipo === 'envio_tentado').length;
  const r0 = tq(0);
  c.esperar('sem o transporte do canal configurado, nada é tentado nem contado, e o relatório fica pendente e durável',
    r0.relatorio.acao === 'pendente' && r0.relatorio.versao === 1 && tentativas() === 0, JSON.stringify(r0.relatorio));
  c.esperar('a falta do transporte aparece como lacuna no retrato do arco', lacunas(depois(v, MIN)).some((x) => /noctum-host\.json/.test(x)),
    JSON.stringify(lacunas(depois(v, MIN))));
  canal.configurar();
  canal.modo('falha');
  const r1 = tq(1);
  c.esperar('com o canal fora do ar, a tentativa é gravada antes e a falha depois, e nada é dado como entregue',
    r1.relatorio.acao === 'pendente' && tentativas() === 1 && canal.mensagens().length === 0, JSON.stringify(r1.relatorio));
  c.esperar('sem recibo, a lacuna aparece no retrato seguinte do arco', lacunas(depois(v, 2 * MIN))
    .some((x) => /sem recibo da página 1 da versão 1 no canal telegram \(1 tentativa\(s\) falharam\)/.test(x)), JSON.stringify(lacunas(depois(v, 2 * MIN))));
  tq(3);
  c.esperar('antes de 5 minutos da falha, o tique não tenta de novo', tentativas() === 1, String(tentativas()));
  canal.modo('ok');
  const r7 = tq(7);
  c.esperar('com o canal de volta, a página sai e ganha recibo: chegou ao canal uma vez só',
    r7.relatorio.acao === 'entregue' && tentativas() === 2 && canal.doArco('arco-recibo').length === 1, `${tentativas()} tentativas, ` +
      `${canal.doArco('arco-recibo').length} mensagens`);
  tq(8);
  const forcado = n.relatorio.reenviarRelatorio(proj.carregado, 'arco-recibo', 'telegram', { quando: depois(v, 9 * MIN) });
  c.esperar('nem o tique seguinte nem o reenvio do dono repetem a página que já tem recibo', canal.doArco('arco-recibo').length === 1 &&
    forcado.enviadas === 0 && forcado.acao === 'entregue', JSON.stringify(forcado));
  c.esperar('o canal recebeu a mensagem igual pela entrada e pelo argumento do transporte, como o piloto configura',
    canal.doArco('arco-recibo').every((m) => m.startsWith('Arco arco-recibo, relatório v1, página 1/')), canal.doArco('arco-recibo')[0]?.slice(0, 80));
  // O transporte que morre no meio: a mensagem pode ter chegado, e o envio nunca se repete às cegas.
  const arcoB = a.abrirArco(proj, a.pedido('arco-incerto', { trabalhos: [{ id: 't1', item: 'RM-902', prioridade: 1, dependeDe: [], thread: tb.id }],
    relatorioEm: vence }));
  a.tique(proj, 'arco-incerto', rt, t0, ['RM-902']);
  canal.modo('morre');
  const i0 = a.tique(proj, 'arco-incerto', rt, arcoB.vencimento, ['RM-902']);
  const tentB = () => n.registro.lerRegistro(proj.dir, 'arco-incerto', 'relatorio').filter((l) => l.evento.tipo === 'envio_tentado').length;
  canal.modo('ok');
  a.tique(proj, 'arco-incerto', rt, depois(arcoB.vencimento, 10 * MIN), ['RM-902']);
  a.tique(proj, 'arco-incerto', rt, depois(arcoB.vencimento, 20 * MIN), ['RM-902']);
  c.esperar('o transporte que morre no meio deixa o envio incerto, e nenhum tique o repete sozinho, nem com o canal de volta',
    i0.relatorio.acao === 'pendente' && tentB() === 1 && canal.doArco('arco-incerto').length === 0, `${tentB()} tentativas`);
  const lb = n.modo.retratoDoArco(proj.carregado, 'arco-incerto', { quando: depois(arcoB.vencimento, 21 * MIN), maquina: MAQUINA,
    lerReservas: () => ({ leitura: 'copia-local', reservas: [] }) }).lacunas;
  c.esperar('o retrato diz o envio incerto e o comando do reenvio, que é do dono',
    lb.some((x) => /envio incerto da página 1 da versão 1 no canal telegram: .*ork noctum relatorio arco-incerto --reenviar telegram/.test(x)),
    JSON.stringify(lb));
  const cli = a.ork(proj, ['noctum', 'relatorio', 'arco-incerto', '--reenviar', 'telegram']);
  c.esperar('ork noctum relatorio arco-incerto --reenviar telegram manda a página uma vez e sai 0 com o recibo',
    cli.status === 0 && canal.doArco('arco-incerto').length === 1, `${cli.status}: ${cli.stdout}${cli.stderr}`);
  const cli2 = a.ork(proj, ['noctum', 'relatorio', 'arco-incerto', '--reenviar', 'telegram']);
  c.esperar('o segundo reenvio do dono não duplica: a página com recibo nunca vai de novo', cli2.status === 0 &&
    canal.doArco('arco-incerto').length === 1, `${cli2.status}: ${cli2.stdout}`);
}

/** A correção explícita: a entrega informada que é revertida volta numa versão nova, sem apagar o rastro. */
function cenarioCorrecaoExplicita(c, a, n) {
  const proj = a.projeto('correcao');
  const canal = a.canal(proj);
  const rt = a.runtime();
  const [ta, tb] = [1, 2].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  const vence = minutoCheio(Date.now()) + 2 * HORA;
  const arco = a.abrirArco(proj, a.pedido('arco-correcao', { trabalhos: [
    { id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: ta.id },
    { id: 't2', item: 'RM-902', prioridade: 2, dependeDe: [], thread: tb.id }], relatorioEm: vence }));
  const v = arco.vencimento;
  a.entregarComProva(proj, ta.id, depois(v, -60 * MIN), 1);
  a.entregarSemProva(proj, tb.id, depois(v, -50 * MIN));
  const tq = (min) => a.tique(proj, 'arco-correcao', rt, depois(v, min * MIN), ['RM-901', 'RM-902']);
  const r0 = tq(0);
  const v1 = canal.doArco('arco-correcao').join('\n');
  c.esperar('a versão 1 dá o t1 como entregue, com a prova do push', r0.relatorio.versao === 1 && /• t1 \(RM-901\): thread .+push provado/.test(v1), v1);
  c.esperar('o t2, com a entrega registrada sem a prova do push, fica em curso, nunca em Entregue',
    !/✅ Entregue\n(?:• .*\n)*• t2 /.test(v1) && /• t2 \(RM-902\): .*checkpoint: entrega registrada sem a prova do push no remoto/.test(v1), v1);
  a.reverterEntrega(proj, ta.id, depois(v, 30 * MIN));
  const r31 = tq(31);
  const v2 = canal.doArco('arco-correcao').filter((m) => m.startsWith('Arco arco-correcao, relatório v2')).join('\n');
  c.esperar('revertida a entrega, o tique seguinte compõe a versão 2 com a correção explícita: foi informado, fato confirmado agora, fonte e impacto',
    r31.relatorio.versao === 2 && /📝 Correções\n• Foi informado: t1 entregue \(versão 1, telegram, .+\)\. Fato confirmado agora: entrega revertida na base/.test(v2) &&
      /Fonte: o ledger da thread do trabalho/.test(v2) && /Impacto: o trabalho não conta como entregue, e nada foi entregue de novo/.test(v2), v2);
  c.esperar('na versão 2 o t1 sai de Entregue e aparece em Impedido, pela entrega revertida', /• t1 \(RM-901\): entrega revertida na base/.test(v2) &&
    !/✅ Entregue\n• t1 /.test(v2), v2);
  const registro = n.registro.lerRegistro(proj.dir, 'arco-correcao', 'relatorio').filter((l) => l.evento.tipo === 'composto');
  c.esperar('o rastro fica: a versão 1 continua no registro do relatório, ao lado da 2', registro.map((l) => l.evento.versao).join(',') === '1,2',
    registro.map((l) => l.evento.versao).join(','));
  tq(40);
  const todas = canal.doArco('arco-correcao');
  c.esperar('nada é entregue de novo: cada versão chegou uma vez, e o tique seguinte não cria a versão 3', todas.length === 2 &&
    n.registro.lerRegistro(proj.dir, 'arco-correcao', 'relatorio').filter((l) => l.evento.tipo === 'composto').length === 2,
    `${todas.length} mensagens`);
}

const CENARIOS = [
  { nome: 'ligar-o-modo', titulo: 'o transporte que liga o modo: proposta, ingresso assinado e #Noctum só com envelope vigente', fn: cenarioLigarOModo },
  { nome: 'arco-curto', titulo: 'o arco curto com falhas injetadas, do primeiro despacho ao relatório da manhã', fn: cenarioArcoCurto },
  { nome: 'prazo-e-fuso', titulo: 'o relatório no horário e no fuso do envelope, sem antecipar', fn: cenarioPrazoEFuso },
  { nome: 'teto-com-sessoes-em-voo', titulo: 'o teto do arco com sessões em voo: parada global, sem retry nem troca de conta', fn: cenarioTetoComSessoesEmVoo },
  { nome: 'teto-medido', titulo: 'a medição: minutos medidos que fecham o arco e tokens que viram lacuna, nunca zero', fn: cenarioTetoMedido },
  { nome: 'sem-recibo-e-reenvio', titulo: 'a falta de recibo no retrato e o reenvio sem duplicação', fn: cenarioSemReciboEReenvio },
  { nome: 'correcao-explicita', titulo: 'a entrega informada e revertida, corrigida numa versão nova', fn: cenarioCorrecaoExplicita },
];

// ---------------------------------------------------------------------------
// A execução.
// ---------------------------------------------------------------------------

function rodar(args) {
  const escolhidos = args.cenarios.length ? args.cenarios : CENARIOS.map((x) => x.nome);
  for (const nome of escolhidos) if (!CENARIOS.some((x) => x.nome === nome)) throw new ErroDeUso(`cenário desconhecido: ${nome} (veja --listar)`);
  if (process.platform !== 'linux' || !fs.existsSync('/usr/bin/flock')) {
    throw new ErroDeUso('o ensaio exige Linux com /usr/bin/flock: sem a trava do kernel o arco não despacha');
  }
  if (!fs.existsSync(CLI)) throw new ErroDeUso('falta core/dist/index.js: rode npm --prefix core run build');
  const raiz = pastaDoEnsaio();
  const resultado = { contrato: CONTRATO, ok: false, raiz, mantida: args.manter, sabotagem: args.sabotar, inicio: iso(Date.now()), cenarios: [] };
  try {
    isolarAmbiente(raiz);
    const n = {
      init: doNucleo('init'), manifest: doNucleo('manifest'), thread: doNucleo('thread'), ledger: doNucleo('ledger'),
      conducao: doNucleo('conducao'), horario: doNucleo('horario'), hitlGates: doNucleo('hitl-gates'), envelope: doNucleo('noctum-envelope'),
      arco: doNucleo('noctum-arco'), modo: doNucleo('noctum-modo'), relatorio: doNucleo('noctum-relatorio'),
      fechamento: doNucleo('noctum-fechamento'), registro: doNucleo('noctum-registro'), filaPesada: doNucleo('fila-pesada'),
    };
    if (!n.filaPesada.kernelDisponivel()) throw new ErroDeUso('o ensaio exige a trava do kernel (/usr/bin/flock)');
    for (const def of CENARIOS.filter((x) => escolhidos.includes(x.nome))) {
      const pasta = path.join(raiz, def.nome);
      fs.mkdirSync(pasta);
      const c = { nome: def.nome, titulo: def.titulo, ok: false, expectativas: [],
        esperar(texto, ok, detalhe) { this.expectativas.push(ok ? { texto, ok: true } : { texto, ok: false, detalhe: String(detalhe ?? '').slice(0, 1500) }); } };
      try { def.fn(c, montarApoio(pasta, n, args.sabotar), n); }
      catch (e) {
        if (e instanceof ErroDeUso) throw e;
        c.esperar('o cenário roda até o fim, sem exceção', false, (e && e.stack) || String(e));
      }
      c.ok = c.expectativas.length > 0 && c.expectativas.every((x) => x.ok);
      resultado.cenarios.push(c);
    }
    resultado.ok = resultado.cenarios.every((x) => x.ok);
    return resultado;
  } finally {
    resultado.fim = iso(Date.now());
    if (!args.manter) fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function imprimir(r, args) {
  if (args.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return; }
  const total = r.cenarios.reduce((s, x) => s + x.expectativas.length, 0);
  const boas = r.cenarios.reduce((s, x) => s + x.expectativas.filter((e) => e.ok).length, 0);
  const l = [];
  if (!args.resumo) {
    l.push('Ensaio do piloto #Noctum (RM-058, N6), com relógio controlado e tudo simulado: nenhum runtime, rede ou Telegram de verdade.',
      `Pasta descartável: ${r.raiz}${r.mantida ? ' (mantida)' : ' (apagada no fim)'}.${r.sabotagem ? ` Sabotagem ligada: ${r.sabotagem}.` : ''}`, '');
  }
  for (const c of r.cenarios) {
    const boasDoCenario = c.expectativas.filter((e) => e.ok).length;
    l.push(`${c.ok ? '[ok]' : '[FALHOU]'} ${c.nome}: ${c.titulo} (${boasDoCenario} de ${c.expectativas.length})`);
    if (args.resumo) continue;
    for (const e of c.expectativas) {
      l.push(`  ${e.ok ? '[ok]' : '[FALHOU]'} ${e.texto}`);
      if (!e.ok && e.detalhe) l.push(...e.detalhe.split('\n').slice(0, 12).map((x) => `      ${x}`));
    }
    l.push('');
  }
  l.push(`${r.ok ? 'Ensaio aprovado' : 'Ensaio reprovado'}: ${r.cenarios.length} cenário(s), ${boas} de ${total} expectativas.` +
    (r.ok ? ' O piloto de verdade espera os valores e a autorização do dono.' : ''));
  process.stdout.write(`${l.join('\n')}\n`);
}

function main() {
  let args;
  try { args = lerArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
  if (args.ajuda) { process.stdout.write(`${fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '')}\n`); return 0; }
  if (args.listar) { process.stdout.write(`${CENARIOS.map((x) => `${x.nome}: ${x.titulo}`).join('\n')}\n`); return 0; }
  let r;
  try { r = rodar(args); }
  catch (e) { if (e instanceof ErroDeUso) { process.stderr.write(`${e.message}\n`); return 2; } throw e; }
  imprimir(r, args);
  return r.ok ? 0 : 1;
}

process.exitCode = main();
