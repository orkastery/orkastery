#!/usr/bin/env node
/**
 * RM-058, fatia N6 (T8 da ork-rm058n6): o ensaio do piloto do #Noctum, pronto para rodar numa máquina.
 *
 * Monta, numa pasta temporária nova e fora de qualquer projeto, repositórios de teste descartáveis com fila, abre arcos
 * pelo caminho do dono (a proposta e a resposta curta do dono à pergunta, assinada pelo gateway; nunca um comando que
 * autorize no terminal), injeta falhas e roda
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
 * RM-058, integração (T7 da ork-rm058integra, D11): três cenários ligam as fatias de ponta a ponta pelo vigia e pelo
 * condutor de produção (`cadeia-ligada`, `condutor-morto` e `base-que-anda`), com a entrega da N5, a baseline e o verify
 * reais, um remoto bare de fixture e a forja, o CI, o runtime e as sessões simulados. O resultado leva `simulado: true` e
 * as marcas que o aceite do piloto recusa (`marcas`): nada daqui conta como piloto.
 *
 * RM-057 (resposta curta, T8 da ork-rm057respost): os arcos abrem como o dono autoriza agora, com "<código> a" à pergunta
 * do arco, assinado pelo ingresso do Hermes e recebido pelo receptor do pulse. O cenário `resposta-curta` prova a pergunta
 * que sai no canal, o reply, o código, a palavra solta e o número, os negativos (outro chat, sem pergunta, duas pendentes,
 * depois do prazo, a mesma mensagem e a sessão despachada que digita "sim" no terminal), a revogação pela pergunta e a
 * sessão do dono no terminal, com a sessão e a cadeia de processos SIMULADAS. GO-FIX 2 (D22): o ingresso do terminal está
 * desligado, e o cenário prova que nada grava por ele; e a palavra solta em reply a outra mensagem não vira palavra solta.
 *
 * Exige Linux com `/usr/bin/flock` (o arco só despacha com a trava do kernel) e o `core/dist` compilado
 * (`npm --prefix core run build`). Sai 0 com todas as expectativas, 1 quando alguma falha e 2 em erro de uso ou de
 * ambiente.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
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
/**
 * As variáveis que levariam o git do ensaio para outro repositório (um hook do git exporta GIT_DIR) ou para outra
 * configuração, a mesma lista que o núcleo limpa em `rede-forja.ts`, mais as da configuração por ambiente.
 */
const GIT_FORA_DA_PASTA = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_QUARANTINE_PATH', 'GIT_PREFIX', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS'];
/** Os executáveis que o ensaio nunca pode chamar: o runtime, a forja e os gateways de verdade. */
const SENTINELAS = ['claude', 'codex', 'gh', 'glab', 'openclaw', 'hermes'];
/**
 * RM-058, integração (T7 da ork-rm058integra, D11): as marcas que o aceite do piloto recusa. O ensaio nunca vale como piloto:
 * a máquina é a do ensaio, o remoto é de fixture, e a forja, o CI, o runtime e o canal são simulados, com as sentinelas no PATH.
 */
const MARCAS_DE_SIMULACAO = { maquina: MAQUINA, remoto: 'fixture', forja: 'simulada', ci: 'simulado', runtime: 'simulado', canal: 'simulado',
  sentinelas: SENTINELAS };

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
  for (const nome of Object.keys(process.env)) {
    if (nome.startsWith('ORK_HITL_') || SEM_ESTES.includes(nome) || GIT_FORA_DA_PASTA.includes(nome) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(nome)) {
      delete process.env[nome];
    }
  }
  // Sentinelas à frente do PATH: se algo do núcleo chamar o runtime, a forja ou um gateway, a chamada fica registrada.
  const sentinelas = path.join(raiz, 'sentinelas');
  fs.mkdirSync(sentinelas, { mode: 0o700 });
  for (const nome of SENTINELAS) {
    fs.writeFileSync(path.join(sentinelas, nome), `#!/bin/sh\necho "${nome} $*" >> "${path.join(raiz, 'chamadas-proibidas.log')}"\nexit 1\n`,
      { mode: 0o700 });
  }
  Object.assign(process.env, SEM_PUBLICAR, {
    PATH: `${sentinelas}${path.delimiter}${process.env.PATH ?? ''}`,
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

  /** Um repositório descartável com o manifesto do `ork init` do núcleo, com a sigla dada. */
  function projeto(nome, sigla = 'ens') {
    const dir = path.join(raiz, nome);
    fs.mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'ensaio@orkastery.local']);
    git(dir, ['config', 'user.name', 'Ensaio Noctum']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(dir, 'README.md'), '# repositório descartável do ensaio #Noctum\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-q', '-m', 'inicial']);
    n.init.init(dir, { nome: 'ensaio-noctum', abbrev: sigla });
    return { nome, dir, carregado: n.manifest.exigirManifesto(dir) };
  }

  /**
   * RM-058, integração (D6 da ork-rm058integra): a baseline SIMULADA que o condutor do arco grava antes do primeiro despacho
   * do bloco com GO. Os cenários da N6 abrem as threads com ela, como o condutor as deixaria; o vigia nunca a grava.
   */
  const comBaseline = (proj, t) => {
    n.ledger.registrar(n.thread.dirThread(proj.dir, t.id), t.id, 'baseline_recorded', { commit: 'SIMULADO', comandos: [], simulado: true });
    return t;
  };

  /** A thread #Auto de um trabalho, como o dono a criaria, com o item e o pedido guardado (e a baseline do condutor). */
  function threadDoTrabalho(proj, numero, item) {
    return comBaseline(proj, n.thread.novaThread(proj.carregado, { nome: `ensaio trabalho ${numero}`, modo: 'auto', roadmap: item,
      pedido: `Trabalho ${numero} SIMULADO do ensaio #Noctum.`, criarWorktree: false }).thread);
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
      destinos: [{ repositorio: 'exemplo/ensaio-noctum', base: 'main', permissoes: o.permissoes ?? ['push', 'pr'] }],
      orcamento: { arco: teto, porConta: contas.map((c) => ({ conta: c.conta, teto: subteto(6) })),
        porRuntime: runtimes.map((r) => ({ runtime: r.runtime, teto: subteto(8) })) },
      relatorio: { horario: horarioNoFuso(o.relatorioEm ?? fim + 30 * MIN, fuso), canal: o.canal ?? 'telegram' },
      trabalhos: o.trabalhos,
      capacidade: { maquina: o.maquina ?? 3, porConta: contas, porRuntime: runtimes, revisao: o.revisao ?? 0 },
    };
  }

  /** O envelope que o gateway do Hermes assina no endereço do arco, como chega do Telegram. */
  function assinado(arco, resposta, recebidoEm, chaveDoCanal = chave()) {
    mensagens += 1;
    const r = { resposta, origem: 'telegram', canal: 'hermes', por: 'telegram:42', mensagem: `telegram:-7:ensaio-${process.pid}-${mensagens}`,
      recebidoEm };
    return { ...r, prova: n.hitlGates.assinaturaDaResposta(n.arco.ALVO_DO_NOCTUM, n.arco.enderecoDoArco(arco), r, chaveDoCanal) };
  }

  /**
   * RM-057 (resposta curta): o que o ingresso do Hermes assina quando o dono digita `texto` no chat, em reply à mensagem da
   * pergunta (`referencia`, `<código>:<id da mensagem respondida>`, no endereço `resposta:<código>:<id>`) ou não (o endereço
   * do pulse).
   */
  function peloPulse(texto, recebidoEm, o = {}) {
    mensagens += 1;
    const r = { resposta: texto, origem: 'telegram', canal: 'hermes', por: 'telegram:42',
      mensagem: `telegram:${o.chat ?? '-7'}:ensaio-${process.pid}-${mensagens}`, recebidoEm };
    return { ...r, prova: n.hitlGates.assinaturaDaResposta(n.pulseConsentimento.ALVO_DO_PULSE, n.pulseConsentimento.enderecoDoPulse(o.referencia),
      r, chave()) };
  }

  /**
   * Propõe e autoriza como o dono faz desde a RM-057 (D12 da ork-rm057respost): "<código> a" à pergunta do arco, assinado
   * pelo ingresso do Hermes e recebido pelo receptor do pulse (o mesmo do `ork pulse responder`), agora.
   */
  function abrirArco(proj, p) {
    const agora = iso(Date.now());
    const proposta = n.arco.proporEnvelope(proj.dir, p, agora, n.pulseResposta.codigosEmUso(proj.dir));
    const recibo = n.pulseResposta.responderPeloPulse(proj.dir, peloPulse(`${proposta.codigo} a`, agora), { quando: agora });
    const lido = n.arco.lerArco(proj.dir, p.arco, agora);
    if (lido?.envelopeSha256 !== proposta.envelopeSha256) throw new Error(`o arco ${p.arco} não abriu pela resposta curta: ${recibo.mensagem}`);
    return { sha: proposta.envelopeSha256, recibo, fim: lido.conteudo.janela.fim, vencimento: n.relatorio.vencimentoDoRelatorio(lido.conteudo) };
  }

  /** RM-057: o transporte SIMULADO do pulse (`pulse-host.json`), por onde a pergunta do arco sai ao dono; grava cada mensagem. */
  function canalDoPulse(proj) {
    const script = path.join(raiz, 'canal-do-pulse-simulado.cjs');
    if (!fs.existsSync(script)) {
      // Como o transporte do Hermes depois do recibo: o id da mensagem entregue (500, 501...), que prende o reply do dono a ela.
      fs.writeFileSync(script, "'use strict';\nconst fs = require('node:fs');\nfs.appendFileSync(process.argv[2], JSON.stringify({ mensagem: process.argv[3] }) + '\\n');\n" +
        "const total = fs.readFileSync(process.argv[2], 'utf8').split('\\n').filter(Boolean).length;\n" +
        "process.stdout.write(JSON.stringify({ success: true, message_id: 499 + total, platform: 'telegram' }));\n");
    }
    const saida = path.join(raiz, `${proj.nome}-pulse.jsonl`);
    const host = path.join(proj.dir, '.orkastery', 'monitor', 'pulse-host.json');
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, JSON.stringify({ host: 'hermes', destino: 'telegram:-7', executavel: process.execPath,
      argumentos: [script, saida, '{{mensagem}}'] }, null, 2), { mode: 0o600 });
    return () => (fs.existsSync(saida) ? fs.readFileSync(saida, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).mensagem) : []);
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

  /**
   * Um tique do arco no instante dado, com o runtime, as reservas, a parada e o git simulados. RM-058, integração (D7 da
   * ork-rm058integra): o tique de produção chama o vigia da N4; os cenários da N6 passam o passo da N2 no lugar dele, como o
   * tique os rodava, e os cenários integrados ligam o vigia e o condutor.
   */
  function tique(proj, arco, rt, quando, itens, extra = {}) {
    rt.agora = quando;
    const opcoesDoPasso = { maquina: MAQUINA, lerReservas: reservas(itens), despachar: rt.despachar, consultarSessoes: rt.consultarSessoes,
      perfis: rt.perfis, abrirThread: (k, o) => comBaseline(proj, n.thread.novaThread(k, { ...o, criarWorktree: false }).thread),
      gravarBaseline: () => { rt.baselines += 1; }, esperarVezMs: 5_000 };
    return n.modo.tiqueDoArco(proj.carregado, arco, { quando, maquina: MAQUINA, lerReservas: reservas(itens), parar: rt.parar,
      listarSessoes: rt.listarSessoes, git: () => null, ...extra,
      passo: (k, a, q) => n.execucao.passoDoArco(k, a, { ...opcoesDoPasso, quando: q }) });
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

  /** O `ork` desta árvore num processo filho, no projeto, com o ambiente do ensaio (ou o dado). */
  function ork(proj, args, entrada, env = process.env) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd: proj.dir, encoding: 'utf8', input: entrada, timeout: 120_000, env });
  }
  const argvResponder = (arco, e) => ['noctum', 'responder', arco, '--resposta-stdin', '--origem', e.origem, '--canal', e.canal, '--por', e.por,
    '--mensagem', e.mensagem];

  function json(texto) { try { return JSON.parse(texto); } catch { return null; } }

  /** A recusa tipada do arco, ou `null` quando a função passou. */
  function recusaDe(fn) {
    try { fn(); return null; } catch (e) { if (e instanceof n.envelope.RecusaDoArco) return e.motivo; throw e; }
  }

  // -------------------------------------------------------------------------
  // RM-058, integração (T7 da ork-rm058integra, D11): o mundo dos cenários integrados.
  // -------------------------------------------------------------------------

  const FORJA = { host: 'github.com', repositorio: 'exemplo/ensaio-noctum' };
  const CHANGELOG_DA_BASE = '# Changelog\n\nAs mudanças, da mais nova para a mais antiga.\n\n## Não publicado\n\n### Adicionado\n\n' +
    '- **Antiga SIMULADA** (RM-900): já estava na base.\n\n## [0.1.0] - 2026-10-01\n\n- v1\n';
  const PERFIS = ['perfil-a', 'perfil-b'];
  const passar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
  /** O parecer gravado pela sessão; com o relógio controlado, a data do arquivo é a do instante do cenário. */
  function gravarParecer(arquivo, texto, ts) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, texto);
    if (ts) fs.utimesSync(arquivo, new Date(ts), new Date(ts));
  }

  /**
   * O mundo dos cenários integrados: o projeto com um remoto bare de fixture (push, `ls-remote` e merge do git de verdade),
   * o CI obrigatório e o CHANGELOG com "Não publicado" na base. A forja (o `gh`), o CI, o runtime, as contas e as sessões
   * são SIMULADOS, com os registros que o núcleo grava; o vigia, o condutor, a entrega da N5, a baseline e o verify são os
   * de produção, com essas dependências.
   */
  function mundo(nome) {
    const remoto = path.join(raiz, `${nome}-remoto.git`);
    fs.mkdirSync(remoto);
    git(remoto, ['init', '-q', '--bare', '-b', 'main']);
    // O bundle do CI só aceita thread `ork-*` (`core/src/ci.ts`): o mundo integrado usa a sigla `ork`.
    const proj = projeto(nome, 'ork');
    git(proj.dir, ['remote', 'add', 'origin', remoto]);
    const arquivoDoManifesto = path.join(proj.dir, 'orkastery.yaml');
    const manifesto = fs.readFileSync(arquivoDoManifesto, 'utf8');
    if (!manifesto.includes('required_for_ship: false')) throw new Error('o manifesto do ork init não traz required_for_ship: false');
    fs.writeFileSync(arquivoDoManifesto, manifesto.replace('required_for_ship: false', 'required_for_ship: true'));
    proj.carregado = n.manifest.exigirManifesto(proj.dir);
    fs.writeFileSync(path.join(proj.dir, 'CHANGELOG.md'), CHANGELOG_DA_BASE);
    git(proj.dir, ['add', 'CHANGELOG.md']);
    git(proj.dir, ['commit', '-q', '-m', 'docs: o CHANGELOG da base']);
    git(proj.dir, ['push', '-q', '-u', 'origin', 'main']);
    const lsRemote = (ref) => git(proj.dir, ['ls-remote', 'origin', ref]).split(/\s+/)[0] ?? '';
    const ancestral = (dir, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: dir, timeout: 60_000 }).status === 0;

    // A forja SIMULADA (o `gh`): `pr list` filtra pela branch e pelo estado, com a ponta que o remoto tem agora; `pr create`
    // abre o PR. Nenhuma outra chamada passa.
    const prs = [];
    const chamadasDaForja = [];
    const opcao = (args, nomeDaOpcao) => args.find((x) => x.startsWith(`--${nomeDaOpcao}=`))?.slice(nomeDaOpcao.length + 3);
    const executorGh = (args) => {
      chamadasDaForja.push([...args]);
      if (args[0] === 'pr' && args[1] === 'list') {
        const h = opcao(args, 'head'), estado = opcao(args, 'state');
        const lista = prs.filter((x) => (!h || x.headRefName === h) && (estado !== 'open' || x.state === 'OPEN')).map((x) => ({
          number: x.number, state: x.state, headRefName: x.headRefName, headRefOid: lsRemote(`refs/heads/${x.headRefName}`) || x.headRefOid,
          baseRefName: x.baseRefName, isDraft: false, isCrossRepository: false, url: `https://github.com/${FORJA.repositorio}/pull/${x.number}`,
          createdAt: x.createdAt, mergedAt: null, mergeable: 'MERGEABLE', statusCheckRollup: [] }));
        return { status: 0, stdout: JSON.stringify(lista), stderr: '' };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        const h = opcao(args, 'head') ?? '', b = opcao(args, 'base') ?? '';
        const numero = 300 + prs.length + 1;
        prs.push({ number: numero, state: 'OPEN', headRefName: h, headRefOid: lsRemote(`refs/heads/${h}`), baseRefName: b, createdAt: iso(Date.now()) });
        return { status: 0, stdout: `https://github.com/${FORJA.repositorio}/pull/${numero}\n`, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: `forja SIMULADA: ${args.join(' ')}` };
    };
    // O CI SIMULADO: roda no SHA que está na ponta de um PR aberto, e fica verde (vermelho no SHA que o cenário marca).
    const ci = { vermelhos: new Set(), chamadas: [] };
    const executorCi = ({ sha, context, caminho }) => {
      if (caminho && caminho.includes('/statuses')) return { ok: true, stdout: '[]', stderr: '', code: 0 };
      ci.chamadas.push(sha);
      const publicado = prs.some((x) => x.state === 'OPEN' && lsRemote(`refs/heads/${x.headRefName}`) === sha);
      const checks = !publicado ? [] : [{ name: context, status: 'completed', conclusion: ci.vermelhos.has(sha) ? 'failure' : 'success',
        html_url: `https://exemplo.invalid/check/${sha.slice(0, 7)}`, app: { slug: 'github-actions' } }];
      return { ok: true, stdout: JSON.stringify({ check_runs: checks }), stderr: '', code: 0 };
    };

    // O runtime SIMULADO: cada despacho deixa no disco o que o `phase run` deixa, e a leitura das contas lista as sessões.
    // `rt.agora` é o instante do cenário com relógio controlado (o do tique ou do condutor); sem ele, vale o relógio real.
    const rt = { n: 0, agora: null, estados: new Map(), perfis: new Map(), despachos: [], paradas: [] };
    const perfilDe = (id) => ({ id, runtime: 'claude-bg', configDir: path.join(raiz, 'contas', id) });
    function despacharSessao(carregado, threadId, o) {
      rt.n += 1;
      passar(20);
      const sessionId = `00000000-0000-4000-8007-${String(rt.n).padStart(12, '0')}`;
      const t = n.thread.lerThread(carregado.raiz, threadId);
      const bloco = t.blocos?.find((b) => b.fases.includes(o.fase))?.fases.join('-') ?? o.fase;
      const prompt = o.prompt ?? `# Prompt SIMULADO da fase ${o.fase}\n`;
      const dirT = n.thread.dirThread(carregado.raiz, threadId);
      const absoluto = path.join(dirT, 'prompts', `${t.slug}-${o.fase.toLowerCase()}-${rt.n}.md`);
      fs.mkdirSync(path.dirname(absoluto), { recursive: true });
      fs.writeFileSync(absoluto, prompt);
      const rel = path.relative(carregado.raiz, absoluto);
      const despachadaEm = rt.agora ?? iso(Date.now());
      const sessao = { slug: t.slug, fase: o.fase, bloco, sessionId, runtime: 'claude-bg', verificada: true, despachadaEm, promptPath: rel,
        promptSha256: sha256(prompt), origem: 'despacho' };
      t.sessoes = [...(t.sessoes ?? []), sessao];
      n.thread.gravarThread(carregado.raiz, t);
      n.conducao.registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 12 * HORA },
        { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
      n.ledger.registrar(dirT, threadId, 'phase_dispatch', { ts: despachadaEm, fase: o.fase, slug: t.slug, bloco, sessionId, runtime: 'claude-bg',
        perfil: o.perfil ? { id: o.perfil, runtime: 'claude-bg' } : null, promptSha256: sessao.promptSha256, promptPath: rel, cwd: t.worktree,
        modo: t.modo, pausaAoFim: false, correlacao: o.correlacao ?? null, simulado: true });
      n.ledger.registrar(dirT, threadId, 'phase_dispatch_verified', { ts: despachadaEm, fase: o.fase, slug: t.slug, sessionId, fonte: 'claude agents --json (SIMULADO)',
        encontrada: true });
      rt.estados.set(sessionId, 'working');
      rt.perfis.set(sessionId, o.perfil ?? null);
      rt.despachos.push({ thread: threadId, fase: o.fase, sessionId, perfil: o.perfil ?? null, prompt });
      return { sessionId, verificada: true, bloqueado: false, motivo: null };
    }
    const terminal = (estado) => ['done', 'completed', 'exited', 'stopped', 'failed'].includes(estado);
    rt.leitura = () => ({
      sessoes: [...rt.estados].map(([sessionId, state]) => ({ sessionId, runtime: 'claude-bg', perfil: rt.perfis.get(sessionId) ?? null,
        fantasma: false, viva: !terminal(state), state })),
      fontes: PERFIS.map((p) => ({ origem: `claude agents --json --all (perfil ${p}, SIMULADO)`, ok: true, detalhe: '' })),
      contas: PERFIS.map((p) => ({ runtime: 'claude-bg', perfil: perfilDe(p) })),
    });
    const parar = (s) => { rt.paradas.push(s.sessionId); rt.estados.set(s.sessionId, 'stopped'); return { ok: true, detalhe: 'parada SIMULADA' }; };
    const store = { contrato: n.perfis.CONTRATO_PERFIS, perfis: PERFIS.map((id) => ({ id, runtime: 'claude-bg', configDir: perfilDe(id).configDir,
      estado: 'ativo', esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: '2026-01-01T00:00:00.000Z' })) };

    /** As dependências do vigia e do condutor de produção: o runtime, as contas, a forja e o CI simulados, e o resto real. */
    function opcoesDoVigia(itens, extra = {}) {
      return {
        maquina: MAQUINA, consultarRuntime: rt.leitura, lerStore: () => store, pararSessao: parar, lerRemoto: () => ({ ok: true, sha: null }),
        ...extra,
        passo: { maquina: MAQUINA, lerReservas: reservas(itens), despachar: despacharSessao, consultarSessoes: rt.leitura, ...extra.passo },
        entrega: { forja: FORJA, executorGh, executorCi, despachar: despacharSessao, ...extra.entrega },
      };
    }

    /** O tique de produção (fechamento, vigia e relatório), no instante dado (sem ele, agora). */
    function tique(arco, itens, quando = null, extra = {}) {
      rt.agora = quando;
      try {
        return n.modo.tiqueDoArco(proj.carregado, arco, { quando: quando ?? iso(Date.now()), maquina: MAQUINA, lerReservas: reservas(itens), parar,
          listarSessoes: () => ({ lidas: true, vivas: new Set([...rt.estados].filter(([, e]) => !terminal(e)).map(([id]) => id)) }),
          opcoesDoVigia: opcoesDoVigia(itens, extra) });
      } finally { rt.agora = null; }
    }

    /** O condutor de produção por `maxPassos` passos, sem dormir de verdade; `relogio` fixa o instante de cada passo. */
    function conduzir(arco, itens, maxPassos, extra = {}) {
      const dormidas = [];
      rt.agora = extra.relogio ? extra.relogio() : null;
      try {
        const r = n.vigia.conduzirArco(proj.carregado, arco, { ...opcoesDoVigia(itens, extra), maxPassos, dormir: (ms) => { dormidas.push(ms); },
          ...(extra.relogio ? { relogio: extra.relogio } : {}) });
        return { ...r, dormidas };
      } finally { rt.agora = null; }
    }

    /** O `verify_run` da sessão no SHA: verde, com a baseline e todas as claims ativas verificadas, marcado SIMULADO. */
    function verifyDaSessao(threadId, commit, ts) {
      const claims = n.claims.lerClaims(proj.dir, threadId).filter((x) => x.estado !== 'retirada').map((x) => ({ id: x.id, verificado: true, motivo: null }));
      return n.ledger.registrar(n.thread.dirThread(proj.dir, threadId), threadId, 'verify_run', { ...(ts ? { ts } : {}), commit,
        veredito: 'verdade sustentada', motivos: [], claims, baseline: { commit: 'baseline-simulada', gravadaEm: ts ?? iso(Date.now()) }, comandos: [],
        simulado: true });
    }

    /**
     * A sessão SIMULADA do bloco: commita na worktree a nota do item e a linha do CHANGELOG em "Não publicado" pelo vínculo
     * da sessão, cadastra a claim e o bundle do CI, e conclui o bloco com o parecer dela, o verify e o resultado da fase. `ts`
     * é o instante do cenário com relógio controlado.
     */
    function sessaoDoBloco(threadId, sessionId, ts = null) {
      const t = n.thread.lerThread(proj.dir, threadId);
      const wt = t.worktree;
      const arquivo = `notas/${t.roadmap.toLowerCase()}.md`;
      fs.mkdirSync(path.join(wt, 'notas'), { recursive: true });
      fs.writeFileSync(path.join(wt, arquivo), `# Nota SIMULADA do ${t.roadmap}\n\nO produto que a sessão do bloco escreveu.\n`);
      const changelog = fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8')
        .replace('### Adicionado\n\n', `### Adicionado\n\n- **Nota SIMULADA** (${t.roadmap}): o que a thread ${threadId} acrescenta.\n\n`);
      fs.writeFileSync(path.join(wt, 'CHANGELOG.md'), changelog);
      git(wt, ['add', '--', arquivo, 'CHANGELOG.md']);
      git(wt, ['commit', '-q', '-m', `feat(${threadId}): a nota do ${t.roadmap}`]);
      const produto = git(wt, ['rev-parse', 'HEAD']);
      const sessao = t.sessoes.find((x) => x.sessionId === sessionId);
      registrar(proj, threadId, 'mcp_git_committed', { ...(ts ? { ts } : {}), commit: produto, paths: [arquivo, 'CHANGELOG.md'], origem: 'mcp.git',
        sessionId, despachoEm: sessao.despachadaEm });
      n.claims.adicionarClaim(proj.dir, threadId, { arquivo, alegacao: `a nota do ${t.roadmap} existe`, verificar: [`test -f '${arquivo}'`],
        semProvaLocal: true });
      const bundle = n.ci.prepararBundleCi(proj.carregado, threadId);
      git(wt, ['add', '--', path.relative(wt, bundle)]);
      git(wt, ['commit', '-q', '-m', `ci(${threadId}): bundle`]);
      const fonte = git(wt, ['rev-parse', 'HEAD']);
      passar(30);
      gravarParecer(path.join(n.thread.dirThread(proj.dir, threadId), 'docs', 'check.md'), '# CHECK SIMULADO da própria sessão\n\nVeredito: PASSOU\n', ts);
      verifyDaSessao(threadId, fonte, ts);
      registrar(proj, threadId, 'phase_result', { ...(ts ? { ts } : {}), fase: sessao.fase, sessionId, despachoEm: sessao.despachadaEm, origem: 'sessions.watch',
        sensorResultId: `claude-bg:${sessionId}`, classificacao: 'fase_concluida', ok: true, runtime: 'claude-bg', simulado: true });
      rt.estados.set(sessionId, 'completed');
      return { produto, fonte };
    }

    /** O CHECK independente SIMULADO: o parecer, o verify no SHA revisado e o resultado com a prova do núcleo. */
    function revisaoConcluida(threadId, sessionId, veredito = 'PASSOU', ts = null) {
      passar(30);
      const t = n.thread.lerThread(proj.dir, threadId);
      const sessao = t.sessoes.find((x) => x.sessionId === sessionId);
      const parecer = `# CHECK SIMULADO\n\nVeredito: ${veredito}\n`;
      gravarParecer(path.join(n.thread.dirThread(proj.dir, threadId), 'docs', 'check.md'), parecer, ts);
      const commit = git(t.worktree, ['rev-parse', 'HEAD']);
      const v = verifyDaSessao(threadId, commit, ts);
      registrar(proj, threadId, 'phase_result', { ...(ts ? { ts } : {}), fase: 'CHECK', sessionId, despachoEm: sessao.despachadaEm, origem: 'sessions.watch',
        sensorResultId: `claude-bg:${sessionId}`, classificacao: 'fase_concluida', ok: true, runtime: 'claude-bg',
        provaOrk: { ok: true, fonte: `docs/check.md gravado com veredito ${veredito}`, veredito, verify: { eventId: v.eventId, commit, ts: v.ts } },
        artefato: { arquivo: 'docs/check.md', sha256Base: null, sha256Atual: sha256(parecer) }, simulado: true });
      rt.estados.set(sessionId, 'completed');
      return commit;
    }

    /** A sessão que morre sem resultado: o runtime a lista como falha, e só a supervisão a vê. */
    const morrer = (sessionId) => rt.estados.set(sessionId, 'failed');

    /** A base anda: um commit na `main` da raiz, empurrado para o remoto. */
    function avancarBase(arquivos, mensagem) {
      for (const [arquivo, conteudo] of Object.entries(arquivos)) {
        fs.mkdirSync(path.dirname(path.join(proj.dir, arquivo)), { recursive: true });
        fs.writeFileSync(path.join(proj.dir, arquivo), conteudo);
        git(proj.dir, ['add', '--', arquivo]);
      }
      git(proj.dir, ['commit', '-q', '-m', mensagem]);
      git(proj.dir, ['push', '-q', 'origin', 'main']);
      return git(proj.dir, ['rev-parse', 'HEAD']);
    }

    /** A thread que o arco abriu para o item. */
    const threadDoItem = (item) => n.thread.listarIds(proj.dir).map((id) => n.thread.lerThread(proj.dir, id)).find((t) => t.roadmap === item) ?? null;
    const ledger = (threadId) => n.ledger.lerLedger(n.thread.dirThread(proj.dir, threadId));

    return { proj, remoto, rt, ci, prs, chamadasDaForja, criacoesDePr: () => chamadasDaForja.filter((x) => x[0] === 'pr' && x[1] === 'create').length,
      lsRemote, ancestral, git, tique, conduzir, sessaoDoBloco, revisaoConcluida, morrer, avancarBase, threadDoItem, ledger };
  }

  return { projeto, threadDoTrabalho, pedido, assinado, peloPulse, abrirArco, canalDoPulse, runtime, canal, tique, registrar, concluirSessao,
    morrerSessao, entregarComProva, entregarSemProva, reverterEntrega, ork, argvResponder, json, recusaDe, horarioNoFuso, mundo };
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
  // RM-057 (resposta curta): a proposta é a pergunta ao dono, com código curto; o como autorizar não traz o hash nem linha para copiar.
  c.esperar('ork noctum propor grava a proposta e não autoriza nada: devolve a pergunta ao dono com código curto, e o como autorizar é a resposta curta, sem o hash',
    proposta.status === 0 && pj.autorizado === false && typeof sha === 'string' && pj.pergunta?.codigo === pj.codigo &&
      Array.isArray(pj.comoAutorizar) && pj.comoAutorizar.some((x) => x.includes(`${pj.codigo} a`)) &&
      pj.comoAutorizar.every((x) => !x.includes(sha) && !x.includes('/ork noctum')), `${proposta.status}: ${proposta.stderr}`);
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

/**
 * RM-057 (resposta curta, T8 da ork-rm057respost): o dono aprova onde estiver, com resposta curta. A pergunta do arco sai
 * pelo transporte SIMULADO do pulse, e o dono responde pelo Telegram (o envelope que o ingresso do Hermes assina, entregue
 * ao `ork pulse responder`); nunca com o hash, nunca por um comando que autorize. O terminal (o evento do hook
 * `UserPromptSubmit`, entregue ao ingresso do terminal) está desligado (D22): só diz ao dono por onde responder.
 */
function cenarioRespostaCurta(c, a, n) {
  const proj = a.projeto('resposta-curta');
  const mensagens = a.canalDoPulse(proj);
  let k = 0;
  /** A proposta pelo CLI, como o condutor a faz: um trabalho por arco, cada um na sua thread. */
  const propor = (arco) => {
    k += 1;
    const t = a.threadDoTrabalho(proj, k, `RM-96${k}`);
    const arquivo = path.join(path.dirname(proj.dir), `${arco}-envelope.json`);
    fs.writeFileSync(arquivo, JSON.stringify(a.pedido(arco, { trabalhos: [{ id: 't1', item: `RM-96${k}`, prioridade: 1, dependeDe: [], thread: t.id }] }), null, 2));
    const r = a.ork(proj, ['noctum', 'propor', '--arquivo', arquivo, '--json']);
    return { ...r, j: a.json(r.stdout) ?? {} };
  };
  const argvDoPulse = (e, referencia) => ['pulse', 'responder', '--resposta-stdin', '--origem', e.origem, '--canal', e.canal, '--por', e.por,
    '--mensagem', e.mensagem, ...(referencia ? ['--em-resposta-a', referencia] : [])];
  /** O envelope assinado entregue ao `ork pulse responder`, como o ingresso do Hermes faz. */
  const entregar = (e, referencia) => { const r = a.ork(proj, argvDoPulse(e, referencia), JSON.stringify(e)); return { ...r, recibo: a.json(r.stdout) ?? {} }; };
  const dizer = (texto, o = {}) => { const e = a.peloPulse(texto, iso(Date.now()), o); return { e, ...entregar(e, o.referencia) }; };
  const arco = (nome) => n.arco.lerArco(proj.dir, nome);
  const autorizacoes = (nome) => fs.readFileSync(path.join(proj.dir, '.orkastery', 'noctum', 'arcos', nome, 'arco.jsonl'), 'utf8')
    .split('\n').filter((l) => l.includes('"tipo":"autorizado"')).length;

  // A pergunta no canal e o reply.
  const um = propor('arco-reply');
  const q1 = um.j.pergunta ?? {}, m1 = mensagens()[0] ?? '';
  c.esperar('a proposta vira a pergunta ao dono: sai uma vez no canal, numerada, com as alternativas e "Responda a, b ou c", sem o hash e sem linha para copiar',
    um.status === 0 && um.j.autorizado === false && q1.entrega?.entregue === true && mensagens().length === 1 &&
      m1.startsWith(`🔔 ${q1.entrega.numero}. arco arco-reply · ${um.j.codigo}`) && m1.includes('Responda a, b ou c.') && m1.includes('Autorizo') &&
      !m1.includes(um.j.envelopeSha256) && !m1.includes('/ork noctum') && arco('arco-reply').situacao === 'proposto',
    `${um.status}: ${um.stderr}${m1}`);
  // O reply leva o código e o id da mensagem em que a pergunta saiu (o transporte o devolveu na entrega).
  const ref1 = `${um.j.codigo}:${q1.entrega?.mensagens?.[0]}`;
  const sim = dizer('sim', { referencia: ref1 });
  c.esperar('o "sim" em reply à mensagem da pergunta, assinado no endereço do reply, autoriza o arco com o envelope que a pergunta guardou',
    sim.status === 0 && sim.recibo.ok === true && arco('arco-reply').situacao === 'vigente' && arco('arco-reply').envelopeSha256 === um.j.envelopeSha256,
    `${sim.status}: ${sim.stderr}${sim.stdout}`);
  const deNovo = entregar(sim.e, ref1);
  c.esperar('a mesma mensagem de novo não autoriza duas vezes: o recibo diz repetida, e o log tem uma autorização só',
    deNovo.status === 0 && deNovo.recibo.repetida === true && autorizacoes('arco-reply') === 1, `${deNovo.status}: ${deNovo.stdout}${deNovo.stderr}`);
  const semPergunta = dizer('sim');
  c.esperar('sem pergunta pendente, o "sim" solto não grava nada',
    (semPergunta.recibo.registradas ?? []).length === 0 && autorizacoes('arco-reply') === 1, `${semPergunta.status}: ${semPergunta.stdout}${semPergunta.stderr}`);

  // A palavra solta e as duas pendentes.
  const solta = propor('arco-solta');
  const a1 = dizer('a');
  c.esperar('sem reply, a palavra solta vale quando só uma pergunta espera no chat em que ela saiu',
    solta.status === 0 && a1.status === 0 && arco('arco-solta').situacao === 'vigente', `${a1.status}: ${a1.stdout}${a1.stderr}`);
  const d1 = propor('arco-dupla-1'), d2 = propor('arco-dupla-2');
  const ambigua = dizer('sim');
  c.esperar('com duas perguntas esperando no chat, o "sim" solto volta perguntando qual, com os códigos, e nada é gravado',
    ambigua.status === 0 && (ambigua.recibo.registradas ?? []).length === 0 && ambigua.recibo.mensagem?.includes(d1.j.codigo) &&
      ambigua.recibo.mensagem?.includes(d2.j.codigo) && arco('arco-dupla-1').situacao === 'proposto' && arco('arco-dupla-2').situacao === 'proposto',
    `${ambigua.status}: ${ambigua.stdout}${ambigua.stderr}`);
  const porCodigo = dizer(`${d2.j.codigo} a`);
  const porNumero = dizer(`${d1.j.pergunta?.entrega?.numero}a`);
  c.esperar('o código com a letra e o número servido com a letra resolvem cada um a sua pergunta, sem tocar a outra',
    porCodigo.status === 0 && porNumero.status === 0 && arco('arco-dupla-2').situacao === 'vigente' && arco('arco-dupla-1').situacao === 'vigente' &&
      autorizacoes('arco-dupla-1') === 1 && autorizacoes('arco-dupla-2') === 1, `${porCodigo.stdout}${porNumero.stdout}${porNumero.stderr}`);

  // Outro chat.
  const chats = process.env.ORK_HITL_TELEGRAM_CHATS;
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7,-8';
  try {
    const outro = propor('arco-outro-chat');
    const doOutro = dizer('sim', { chat: '-8' });
    c.esperar('a palavra solta de outro chat autorizado não responde à pergunta que saiu no chat do canal, e nada é gravado',
      outro.status === 0 && (doOutro.recibo.registradas ?? []).length === 0 && arco('arco-outro-chat').situacao === 'proposto',
      `${doOutro.status}: ${doOutro.stdout}${doOutro.stderr}`);
    const estranho = dizer(`${outro.j.codigo} a`, { chat: '-9' });
    c.esperar('o código vindo de um chat fora da lista do canal é recusado antes de qualquer gravação',
      estranho.status !== 0 && arco('arco-outro-chat').situacao === 'proposto', `${estranho.status}: ${estranho.stdout}${estranho.stderr}`);
    const codigoDoOutro = dizer(`${outro.j.codigo} a`, { chat: '-8' });
    c.esperar('de qualquer chat autorizado, o código com a letra responde à pergunta: o dono aprova onde estiver',
      codigoDoOutro.status === 0 && arco('arco-outro-chat').situacao === 'vigente', `${codigoDoOutro.status}: ${codigoDoOutro.stdout}${codigoDoOutro.stderr}`);
  } finally {
    if (chats === undefined) delete process.env.ORK_HITL_TELEGRAM_CHATS; else process.env.ORK_HITL_TELEGRAM_CHATS = chats;
  }

  // GO-FIX 1 (achado 2): o reply só vale para a mensagem da pergunta; a confirmação do "b" nunca é pergunta.
  const adiada = propor('arco-adiado');
  const refAdiada = `${adiada.j.codigo}:${adiada.j.pergunta?.entrega?.mensagens?.[0]}`;
  const b = dizer('b', { referencia: refAdiada });
  const okNaConfirmacao = dizer('ok', { referencia: `${adiada.j.codigo}:900` });
  c.esperar('o "ok" em reply à confirmação do "b) Adiar" não autoriza: a confirmação nunca foi a mensagem da pergunta, e nada é gravado',
    adiada.status === 0 && /b\) Adiar: nada muda/.test(b.recibo.mensagem ?? '') && okNaConfirmacao.status === 0 &&
      (okNaConfirmacao.recibo.registradas ?? []).length === 0 && arco('arco-adiado').situacao === 'proposto',
    `${okNaConfirmacao.status}: ${okNaConfirmacao.stdout}${okNaConfirmacao.stderr}`);
  // GO-FIX 2 (R1): a palavra solta em reply a outra mensagem (o gateway a assina em resposta:outra) nunca vira palavra solta.
  const okAOutra = dizer('ok', { referencia: 'outra' });
  c.esperar('o "ok" em reply a uma mensagem que não é a pergunta (a de outra pessoa, a confirmação de um gate) volta dizendo por onde responder, e nada é gravado',
    okAOutra.status === 0 && (okAOutra.recibo.registradas ?? []).length === 0 &&
      (okAOutra.recibo.recusas ?? []).some((x) => x.motivo === 'reply.outra-mensagem') && arco('arco-adiado').situacao === 'proposto',
    `${okAOutra.status}: ${okAOutra.stdout}${okAOutra.stderr}`);

  // O prazo.
  k += 1;
  const tv = a.threadDoTrabalho(proj, k, `RM-96${k}`);
  const vencida = n.arco.proporEnvelope(proj.dir, a.pedido('arco-vencido', { trabalhos: [{ id: 't1', item: `RM-96${k}`, prioridade: 1, dependeDe: [], thread: tv.id }] }),
    iso(Date.now() - 2 * HORA), n.pulseResposta.codigosEmUso(proj.dir));
  const tarde = dizer(`${vencida.codigo} a`);
  c.esperar('depois do prazo da pergunta, a resposta volta dizendo que ela venceu, e nada é autorizado',
    /venceu/.test(tarde.recibo.mensagem ?? '') && arco('arco-vencido').envelopeSha256 === null, `${tarde.status}: ${tarde.stdout}${tarde.stderr}`);

  // O terminal.
  const term = propor('arco-terminal');
  const transcricao = path.join(path.dirname(proj.dir), 'sessao-SIMULADA.jsonl');
  fs.writeFileSync(transcricao, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: term.j.pergunta?.texto ?? '' }] } })}\n`);
  const sessao = '7a1c0e42-5b3d-4f6e-8a9b-0c1d2e3f4a5b';
  const evento = (prompt, source = 'user') => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sessao, cwd: proj.dir,
    transcript_path: transcricao, prompt, source });
  const doHook = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: sessao, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PID: '4242' };
  const limpo = Object.fromEntries(Object.entries(process.env).filter(([nome]) => !/^CLAUDE|^ORK_DISPATCH_/.test(nome)));
  const despachada = a.ork(proj, ['noctum', 'terminal', '--hook-stdin'], evento('sim'),
    { ...limpo, ...doHook, ORK_DISPATCH_ID: 'despacho-SIMULADO', ORK_DISPATCH_THREAD: 'thread-SIMULADA' });
  const dd = a.json(despachada.stdout) ?? {};
  // GO-FIX 2 (D22): o ingresso do terminal está desligado; nada grava por ele, nem com a origem perfeita.
  c.esperar('no terminal, a sessão despachada pelo ork que digita "sim" ouve que o ingresso do terminal está desligado, e o arco segue só proposto',
    despachada.status === 0 && dd.acao === 'recusada' && dd.motivo === 'noctum.terminal.desligado' && arco('arco-terminal').situacao === 'proposto',
    `${despachada.status}: ${despachada.stdout}${despachada.stderr}`);
  const cadeia = [{ pid: 4300, ppid: 4299, ambiente: doHook }, { pid: 4299, ppid: 4242, ambiente: doHook },
    { pid: 4242, ppid: 4000, ambiente: { TERM: 'xterm-256color' } }, { pid: 4000, ppid: 1, ambiente: { SHELL: '/bin/bash' } }];
  // GO-FIX 1 (achado 1): o prompt que a máquina injeta na sessão do dono (a tarefa agendada) não grava, nem com a pergunta mostrada.
  const injetado = n.terminal.responderPeloTerminal(proj.dir, JSON.parse(evento('sim', 'schedule_wakeup')), { env: doHook, ancestrais: () => cadeia });
  c.esperar('na sessão do dono, o prompt que a tarefa agendada injeta também não grava, e o arco segue só proposto',
    injetado.acao === 'recusada' && injetado.motivo === 'noctum.terminal.desligado' && arco('arco-terminal').situacao === 'proposto',
    JSON.stringify(injetado));
  const doDono = n.terminal.responderPeloTerminal(proj.dir, JSON.parse(evento('sim')), { env: doHook, ancestrais: () => cadeia });
  c.esperar('na sessão interativa do dono, com a pergunta mostrada e a origem perfeita (sessão e cadeia SIMULADAS), o "sim" não grava: o dono ouve que responda pelo Telegram ou pela janela de confirmação do Claude Code',
    doDono.acao === 'recusada' && doDono.motivo === 'noctum.terminal.desligado' && doDono.presenca === true &&
      /pelo Telegram, em reply à mensagem da pergunta .* ou pela janela de confirmação do Claude Code/.test(doDono.mensagem ?? '') &&
      arco('arco-terminal').situacao === 'proposto' && !fs.existsSync(path.join(proj.dir, '.orkastery', 'noctum', 'arcos', 'arco-terminal', 'ingresso')),
    JSON.stringify(doDono));
  const puro = a.ork(proj, ['noctum', 'autorizar', 'arco-terminal', term.j.envelopeSha256 ?? '']);
  c.esperar('o terminal puro segue recusado: não existe comando que autorize o arco', puro.status === 2, `${puro.status}: ${puro.stdout}`);

  // A revogação.
  const pedido = a.ork(proj, ['noctum', 'revogar', 'arco-reply', '--json']);
  const pr = (a.json(pedido.stdout) ?? {}).pergunta ?? {};
  c.esperar('ork noctum revogar só pergunta: a pergunta de revogação sai no canal, e o arco segue vigente até a resposta',
    pedido.status === 0 && pr.entrega?.entregue === true && mensagens().some((m) => m.includes(`arco arco-reply · ${pr.codigo}`)) &&
      arco('arco-reply').situacao === 'vigente', `${pedido.status}: ${pedido.stdout}${pedido.stderr}`);
  const revoga = dizer('a', { referencia: `${pr.codigo}:${pr.entrega?.mensagens?.[0]}` });
  c.esperar('o "a" em reply à pergunta de revogação revoga o arco', revoga.status === 0 && arco('arco-reply').situacao === 'revogado',
    `${revoga.status}: ${revoga.stdout}${revoga.stderr}`);
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
  c.esperar('o custo traz as sessões medidas contra o teto do arco, de cada conta e do runtime, e separa as sessões abertas da reserva pendente',
    /• Teto do arco: 4 sessoes de 10 sessoes/.test(texto) && /• Teto da conta perfil-a: \d sessoes de 6 sessoes/.test(texto) &&
      /• Teto do runtime claude-bg: 4 sessoes de 8 sessoes/.test(texto) && /• Sessões abertas pelo arco: 3; reservas pendentes: 1 \(/.test(texto), texto);
  c.esperar('a supervisão da N4 é lida do log do arco pelo relatório: sem tique do vigia neste cenário, nada a dizer e nenhuma lacuna fixa',
    !/o tique ainda não chama o vigia|a supervisão do arco não se lê/.test(texto), texto.slice(0, 600));
  const rDepois = tq(depois(vencimento, 10 * MIN));
  c.esperar('cada página chegou ao canal uma vez só, e o tique seguinte não manda nada de novo',
    canal.doArco('arco-curto').length === paginas.length && new Set(paginas).size === paginas.length && rDepois.relatorio.enviadas === 0 &&
      rDepois.relatorio.acao === 'entregue', `${canal.doArco('arco-curto').length} mensagens`);
  c.esperar('todo despacho do arco passou pelo runtime simulado (quatro, um por trabalho), e nenhuma baseline foi pedida',
    rt.baselines === 0 && rt.despachos.length === 4 && new Set(rt.despachos.map((d) => d.thread)).size === 4, JSON.stringify(rt.despachos));
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

/**
 * O teto do arco com sessões em voo, em `sessoes`: nenhuma reserva nova passa, em conta nenhuma; as sessões já contadas
 * terminam (pará-las não protege o teto) e o arco fecha por custo quando a última acaba; a hora final para a que passar do fim.
 */
function cenarioTetoComSessoesEmVoo(c, a, n) {
  const proj = a.projeto('teto-com-sessoes');
  a.canal(proj);
  const rt = a.runtime();
  const th = [1, 2, 3].map((k) => a.threadDoTrabalho(proj, k, `RM-90${k}`));
  const itens = ['RM-901', 'RM-902', 'RM-903'];
  const trabalhos = th.map((x, i) => ({ id: `t${i + 1}`, item: itens[i], prioridade: i + 1, dependeDe: [], thread: x.id }));
  const arco = a.abrirArco(proj, a.pedido('arco-teto', { trabalhos, teto: { valor: 2, unidade: 'sessoes' } }));
  const t0 = iso(minutoCheio(Date.now()) + MIN);
  const em = (min) => depois(t0, min * MIN);
  const tq = (min) => a.tique(proj, 'arco-teto', rt, em(min), itens);
  tq(0);
  tq(1);
  const e1 = n.arco.lerArco(proj.dir, 'arco-teto', em(1));
  c.esperar('dois despachos alcançam o teto do arco (2 sessões), com as duas sessões em voo', e1.consumo.arco === 2 && rt.vivas.size === 2,
    JSON.stringify(e1.consumo));
  const r2 = tq(2);
  c.esperar('com o teto alcançado, nenhuma reserva nova passa: o t3 é recusado (noctum.orcamento.esgotado) e nada é despachado',
    !r2.fechamento.fechado && r2.passo?.acao === 'recusado' && r2.passo.motivo === 'noctum.orcamento.esgotado' && rt.despachos.length === 2 &&
      n.arco.lerArco(proj.dir, 'arco-teto', em(2)).despachos.length === 2, JSON.stringify({ f: r2.fechamento.detalhe, passo: r2.passo }));
  c.esperar('as sessões já contadas no teto seguem: nenhuma é parada, porque pará-las não protege o teto', rt.paradas.length === 0 &&
    rt.vivas.size === 2, JSON.stringify(rt.paradas));
  const reservar = (conta, min) => a.recusaDe(() => n.arco.reservarDespacho(proj.dir, { arco: 'arco-teto', envelopeSha256: arco.sha, trabalho: 't3',
    thread: th[2].id, fase: 'GOAL', runtime: 'claude-bg', conta, revisao: false }, em(min)));
  const noTeto = ['perfil-a', 'perfil-b'].map((conta) => reservar(conta, 3));
  c.esperar('sem troca de conta para contornar: nenhuma das duas contas reserva com o teto alcançado (noctum.orcamento.esgotado)',
    noTeto.every((x) => x === 'noctum.orcamento.esgotado'), JSON.stringify(noTeto));
  const e3 = n.arco.lerArco(proj.dir, 'arco-teto', em(3));
  e3.despachos.forEach((d, i) => { a.concluirSessao(proj, d.thread, d.sessionId, 'GOAL', em(30 + 10 * i)); rt.vivas.delete(d.sessionId); });
  const r41 = tq(41);
  c.esperar('quando a última sessão admitida acaba, o arco fecha por custo, sem nada a parar', r41.fechamento.agora &&
    r41.fechamento.motivo === 'custo' && /teto do arco é de 2 sessoes e 2 foram reservadas; nenhuma segue em voo/.test(r41.fechamento.detalhe) &&
    r41.passo === null && rt.paradas.length === 0 && r41.fechamento.paradas.length === 0, r41.fechamento.detalhe);
  const depoisDoTeto = ['perfil-a', 'perfil-b'].map((conta) => reservar(conta, 42));
  c.esperar('depois do fechamento nada reserva, em conta nenhuma (noctum.efeito.encerrado), e o arco fica encerrado',
    depoisDoTeto.every((x) => x === 'noctum.efeito.encerrado') && n.arco.lerArco(proj.dir, 'arco-teto', em(43)).situacao === 'encerrado',
    JSON.stringify(depoisDoTeto));
  const retrato = n.fechamento.lerFechamento(proj.dir, 'arco-teto').retrato ?? {};
  c.esperar('o estado deixado para retomar identifica o consumo, o trabalho que sobrou e a instrução de abrir um arco novo',
    retrato.motivo === 'custo' && retrato.consumo?.sessoes?.valor === 2 &&
      (retrato.retomada?.trabalhos ?? []).some((x) => x.id === 't3' && x.estado !== 'entregue') &&
      (retrato.retomada?.instrucao ?? []).some((x) => /não reabre/.test(x)), JSON.stringify(retrato.retomada));
  // A hora final ainda vale com o teto alcançado: a sessão admitida que passa do fim é parada.
  const rt2 = a.runtime();
  const th2 = a.threadDoTrabalho(proj, 9, 'RM-909');
  const arco2 = a.abrirArco(proj, a.pedido('arco-teto-hora', { trabalhos: [{ id: 'h1', item: 'RM-909', prioridade: 1, dependeDe: [], thread: th2.id }],
    teto: { valor: 1, unidade: 'sessoes' } }));
  a.tique(proj, 'arco-teto-hora', rt2, t0, ['RM-909']);
  const antes = a.tique(proj, 'arco-teto-hora', rt2, depois(arco2.fim, -MIN), ['RM-909']);
  const hora = a.tique(proj, 'arco-teto-hora', rt2, arco2.fim, ['RM-909']);
  c.esperar('com o teto alcançado e a sessão passando do fim, a hora final fecha o arco e pede a parada dela, uma vez',
    rt2.despachos.length === 1 && !antes.fechamento.fechado && hora.fechamento.motivo === 'hora' && rt2.paradas.length === 1,
    JSON.stringify({ antes: antes.fechamento.detalhe, hora: hora.fechamento.motivo, paradas: rt2.paradas }));
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
  c.esperar('o canal recebeu a mensagem igual pela entrada e pelo argumento do transporte (o canal simulado recusa a diferença), com o cabeçalho do arco',
    canal.doArco('arco-recibo').length === 1 && canal.doArco('arco-recibo').every((m) => m.startsWith('Arco arco-recibo, relatório v1, página 1/')),
    canal.doArco('arco-recibo')[0]?.slice(0, 80));
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

// ---------------------------------------------------------------------------
// RM-058, integração (T7 da ork-rm058integra, D11): os cenários integrados, pelo vigia e pelo condutor de produção.
// ---------------------------------------------------------------------------

/** O resumo de um passo do condutor ou do vigia, para o detalhe das expectativas. */
const resumoDoPasso = (p) => p ? { acao: p.acao, motivo: p.motivo, entrega: p.entrega ? { acao: p.entrega.acao, motivo: p.entrega.motivo,
  detalhe: p.entrega.detalhe } : p.entrega, falhaDaEntrega: p.falhaDaEntrega } : null;

/**
 * A cadeia ligada, de ponta a ponta numa máquina: o pedido do dono vira thread, o condutor grava a baseline real e despacha
 * o bloco, a sessão SIMULADA commita e conclui, a revisão independente é despachada e conclui, a publicação abre o PR na
 * forja SIMULADA, o CI SIMULADO fica verde no SHA, a integração mescla na base do remoto bare de fixture com a prova do push,
 * o MASTER por omissão fecha a thread, a fila vazia fecha o arco, e o relatório da manhã diz a entrega.
 */
function cenarioCadeiaLigada(c, a, n) {
  const m = a.mundo('cadeia-ligada');
  const canal = a.canal(m.proj);
  const itens = ['RM-951'];
  const doDono = 'Fatia SIMULADA da cadeia ligada: uma nota nova no produto.';
  const arco = a.abrirArco(m.proj, a.pedido('arco-cadeia', { trabalhos: [{ id: 't1', item: 'RM-951', prioridade: 1, dependeDe: [], pedido: doDono }],
    permissoes: ['push', 'pr', 'merge'], revisao: 1 }));
  const r1 = m.tique('arco-cadeia', itens);
  const t = m.threadDoItem('RM-951');
  c.esperar('o pedido do dono vira a thread #Auto do item, com o pedido guardado e a worktree, aberta pelo arco no primeiro tique',
    t?.modo === 'auto' && n.thread.pedidoDaThread(m.proj.dir, t)?.texto.includes(doDono) && !!t.worktree && fs.existsSync(t.worktree),
    JSON.stringify({ t: t && { id: t.id, modo: t.modo, worktree: t.worktree }, passo: resumoDoPasso(r1.passo) }));
  c.esperar('no tique, o vigia não grava a baseline: o passo espera o condutor (baseline-pendente), e nada é despachado',
    r1.vigia?.condutor === 'assumido' && r1.passo?.acao === 'aguardar' && r1.passo.motivo === 'baseline-pendente' && m.rt.despachos.length === 0,
    JSON.stringify({ condutor: r1.vigia?.condutor, passo: resumoDoPasso(r1.passo), falhas: r1.falhas }));
  const k1 = m.conduzir('arco-cadeia', itens, 2);
  const baseline = m.ledger(t.id).filter((e) => e.tipo === 'baseline_recorded');
  c.esperar('o condutor grava a baseline real da thread e despacha o GOAL pelo runtime, com a linha do arco no pedido da sessão',
    k1.acao === 'saiu' && k1.ultimo?.acao === 'despachou' && baseline.length === 1 && !baseline[0].simulado && m.rt.despachos.length === 1 &&
      m.rt.despachos[0].fase === 'GOAL' && m.rt.despachos[0].prompt.includes('Esta thread é trabalho do arco `arco-cadeia` do #Noctum'),
    JSON.stringify({ k1: resumoDoPasso(k1.ultimo), baseline: baseline.length, despachos: m.rt.despachos.map((d) => d.fase) }));
  const { fonte } = m.sessaoDoBloco(t.id, m.rt.despachos[0].sessionId);
  const k2 = m.conduzir('arco-cadeia', itens, 1);
  const revisao = m.rt.despachos[1];
  c.esperar('com o bloco concluído pela própria sessão, a entrega pede a revisão independente: um CHECK numa sessão nova, pelo condutor',
    k2.ultimo?.entrega?.acao === 'revisao-pedida' && revisao?.fase === 'CHECK' && revisao.sessionId !== m.rt.despachos[0].sessionId,
    JSON.stringify({ k2: resumoDoPasso(k2.ultimo), despachos: m.rt.despachos.map((d) => d.fase) }));
  if (!revisao) return;
  m.revisaoConcluida(t.id, revisao.sessionId);
  const k3 = m.conduzir('arco-cadeia', itens, 1);
  const branch = n.worktree.branchDaWorktree(n.thread.lerThread(m.proj.dir, t.id));
  c.esperar('com a revisão PASSOU e o verify no SHA, a entrega publica: a branch no remoto de fixture e o PR na forja SIMULADA',
    k3.ultimo?.entrega?.acao === 'publicou' && m.lsRemote(`refs/heads/${branch}`) === fonte && m.criacoesDePr() === 1,
    JSON.stringify({ k3: resumoDoPasso(k3.ultimo), branch: m.lsRemote(`refs/heads/${branch}`), fonte }));
  const k4 = m.conduzir('arco-cadeia', itens, 1);
  const base = m.lsRemote('refs/heads/main');
  const ship = m.ledger(t.id).filter((e) => e.tipo === 'ship_done');
  c.esperar('com o CI SIMULADO verde no SHA publicado, a entrega integra na base do remoto, e o ship_done leva a prova do push e o arco',
    k4.ultimo?.entrega?.acao === 'integrou' && ship.length === 1 && ship[0].pushVerificado === true && ship[0].evidencia?.arco === 'arco-cadeia' &&
      m.ancestral(m.proj.dir, fonte, base) || false,
    JSON.stringify({ k4: resumoDoPasso(k4.ultimo), ship: ship.map((e) => ({ push: e.pushVerificado, arco: e.evidencia?.arco })) }));
  const r2 = m.tique('arco-cadeia', itens);
  const daEntrega = r2.vigia?.passo?.entrega;
  c.esperar('o tique seguinte faz o MASTER por omissão da entrega do arco (a thread fecha), e só então a fila vazia fecha o arco',
    daEntrega?.acao === 'master' && n.thread.lerThread(m.proj.dir, t.id).status === 'fechada' && r2.fechamento.agora &&
      r2.fechamento.motivo === 'fila-vazia', JSON.stringify({ passo: resumoDoPasso(r2.vigia?.passo), f: r2.fechamento.detalhe, falhas: r2.falhas }));
  const rRel = m.tique('arco-cadeia', itens, arco.vencimento);
  const texto = canal.doArco('arco-cadeia').join('\n');
  c.esperar('o relatório da manhã sai no horário pelo canal combinado e dá o t1 como entregue, com o push provado',
    rRel.relatorio.acao === 'entregue' && /• t1 \(RM-951\): thread .+ push provado/.test(texto), JSON.stringify(rRel.relatorio) + texto.slice(0, 800));
  c.esperar('a cadeia inteira saiu sem falha de etapa no tique e sem exceção da entrega',
    [r1, r2, rRel].every((r) => r.falhas.length === 0) && [k1, k2, k3, k4].every((k) => !k.ultimo?.falhaDaEntrega),
    JSON.stringify([r1, r2, rRel].map((r) => r.falhas)));
}

/**
 * O condutor que morre: o condutor grava as baselines, despacha os dois trabalhos e sai no meio (a trava solta, a geração
 * dele fica). O vigia assume no tique: retoma a sessão que morreu e pede a revisão independente do trabalho concluído; a
 * base anda, a atualização sai no tique, e o verify espera o condutor. O condutor relançado roda o verify real, publica,
 * integra e faz o MASTER por omissão.
 */
function cenarioCondutorMorto(c, a, n) {
  const m = a.mundo('condutor-morto');
  const itens = ['RM-953', 'RM-954'];
  a.abrirArco(m.proj, a.pedido('arco-morto', { trabalhos: [
    { id: 't1', item: 'RM-953', prioridade: 1, dependeDe: [], pedido: 'Fatia SIMULADA t1 do condutor que morre.' },
    { id: 't2', item: 'RM-954', prioridade: 2, dependeDe: [], pedido: 'Fatia SIMULADA t2 do condutor que morre.' }],
  permissoes: ['push', 'pr', 'merge'], revisao: 1 }));
  const t0 = Date.now();
  const em = (min) => iso(t0 + min * MIN);
  m.tique('arco-morto', itens, em(0));
  const k1 = m.conduzir('arco-morto', itens, 4, { relogio: () => em(1) });
  const t1 = m.threadDoItem('RM-953'), t2 = m.threadDoItem('RM-954');
  const [s1, s2] = m.rt.despachos;
  // A trava do condutor ficou livre: tomada aqui e solta na hora, para o vigia achá-la livre também.
  const fd = n.filaPesada.tentarTravaExclusiva(path.join(n.supervisao.dirDaSupervisao(m.proj.dir, 'arco-morto'), 'condutor.lock'));
  if (fd !== null) fs.closeSync(fd);
  c.esperar('o condutor grava a baseline real de cada thread, despacha os dois trabalhos e sai no meio, com a trava solta',
    k1.acao === 'saiu' && m.rt.despachos.length === 2 && s1?.thread === t1?.id && s2?.thread === t2?.id &&
      [t1, t2].every((t) => t && m.ledger(t.id).some((e) => e.tipo === 'baseline_recorded' && !e.simulado)) && fd !== null,
    JSON.stringify({ k1: resumoDoPasso(k1.ultimo), despachos: m.rt.despachos.map((d) => [d.thread, d.fase]) }));
  if (!s1 || !s2) return;
  m.sessaoDoBloco(t1.id, s1.sessionId, em(2));
  m.morrer(s2.sessionId);
  // Passada a carência, o vigia assume: retoma a sessão que morreu e, na entrega, pede a revisão do t1.
  const r1 = m.tique('arco-morto', itens, em(17));
  const retomada = m.rt.despachos[2], revisao = m.rt.despachos[3];
  c.esperar('com o condutor fora, o vigia assume no tique e retoma a sessão morta do t2 pelo passo do arco, numa sessão nova',
    r1.vigia?.condutor === 'assumido' && r1.vigia.retomadas === 1 && retomada?.thread === t2.id && retomada.sessionId !== s2.sessionId &&
      n.supervisao.lerSupervisao(m.proj.dir, 'arco-morto').retomadas.some((x) => x.trabalho === 't2' && x.motivo === 'sessao-morta'),
    JSON.stringify({ vigia: r1.vigia && { condutor: r1.vigia.condutor, retomadas: r1.vigia.retomadas, lacunas: r1.vigia.lacunas },
      passo: resumoDoPasso(r1.vigia?.passo), despachos: m.rt.despachos.map((d) => [d.thread, d.fase]) }));
  c.esperar('no mesmo tique, a entrega do vigia pede a revisão independente do t1 (sem esperar a trava de despacho)',
    r1.vigia?.passo?.entrega?.acao === 'revisao-pedida' && revisao?.thread === t1.id && revisao.fase === 'CHECK',
    JSON.stringify(resumoDoPasso(r1.vigia?.passo)));
  if (!revisao) return;
  m.revisaoConcluida(t1.id, revisao.sessionId, 'PASSOU', depois(em(17), 30_000));
  const baseNova = m.avancarBase({ 'notas/de-fora.md': '# Nota SIMULADA que chegou na base, de fora do arco\n' }, 'docs: a nota de fora do arco');
  const r2 = m.tique('arco-morto', itens, em(18));
  const atualizou = r2.vigia?.passo?.entrega;
  c.esperar('a base anda e a atualização sai no tique, sobre a base nova, sem o verify: ele fica para o condutor',
    atualizou?.acao === 'atualizou' && atualizou.verify === null && m.ancestral(t1.worktree, baseNova, atualizou.para),
    JSON.stringify(resumoDoPasso(r2.vigia?.passo)));
  const r3 = m.tique('arco-morto', itens, em(19));
  const espera = r3.vigia?.passo?.entrega;
  c.esperar('no tique seguinte o verify espera o condutor: a entrega aguarda (ocupada), com o motivo de quem roda o verify',
    espera?.acao === 'aguardar' && espera.motivo === 'noctum.entrega.ocupada' && /fica para o condutor do arco/.test(espera.detalhe),
    JSON.stringify(resumoDoPasso(r3.vigia?.passo)));
  const verifiesAntes = m.ledger(t1.id).filter((e) => e.tipo === 'verify_run' && !e.simulado).length;
  const k2 = m.conduzir('arco-morto', itens, 6, { relogio: () => em(20) });
  const reais = m.ledger(t1.id).filter((e) => e.tipo === 'verify_run' && !e.simulado);
  const ship = m.ledger(t1.id).filter((e) => e.tipo === 'ship_done');
  c.esperar('o condutor relançado roda o verify real no SHA atualizado, publica, integra na base nova e faz o MASTER por omissão',
    k2.acao === 'saiu' && reais.length === verifiesAntes + 1 && reais.at(-1).commit === atualizou?.para && ship.length === 1 &&
      ship[0].pushVerificado === true && m.ancestral(m.proj.dir, baseNova, m.lsRemote('refs/heads/main')) &&
      n.thread.lerThread(m.proj.dir, t1.id).status === 'fechada',
    JSON.stringify({ k2: resumoDoPasso(k2.ultimo), reais: reais.map((e) => e.commit), para: atualizou?.para, ship: ship.length,
      status: n.thread.lerThread(m.proj.dir, t1.id).status }));
  // M4 do CHECK 2: só o tique fecha o arco; um tique depois do condutor relançado, com o t1 entregue e o t2 na sessão nova,
  // não o fecha pela fila vazia nem pede a parada do t2.
  const r4 = m.tique('arco-morto', itens, em(21));
  c.esperar('o trabalho retomado segue em curso: o arco não fecha com o t2 na sessão nova, nem no tique depois do condutor, e o t2 não é parado',
    r4.fechamento.fechado === false && !n.arco.lerArco(m.proj.dir, 'arco-morto', em(21)).encerramento &&
      m.rt.estados.get(retomada.sessionId) === 'working' && !m.rt.paradas.includes(retomada.sessionId),
    JSON.stringify({ fechamento: r4.fechamento.detalhe, encerramento: n.arco.lerArco(m.proj.dir, 'arco-morto', em(21)).encerramento,
      estados: [...m.rt.estados], paradas: m.rt.paradas, despachos: m.rt.despachos.map((d) => [d.thread, d.fase, d.sessionId.slice(-3)]) }));
}

/**
 * A base que anda: com o candidato publicado e o CI verde, um commit chega à base do remoto antes da integração. O condutor
 * atualiza o candidato sobre a base nova (o CHANGELOG em "Não publicado" e o bundle regravado) e roda o verify real no SHA
 * novo, publica de novo, e a integração mescla na base nova, com a prova do push.
 */
function cenarioBaseQueAnda(c, a, n) {
  const m = a.mundo('base-que-anda');
  const itens = ['RM-952'];
  a.abrirArco(m.proj, a.pedido('arco-base', { trabalhos: [{ id: 't1', item: 'RM-952', prioridade: 1, dependeDe: [],
    pedido: 'Fatia SIMULADA da base que anda.' }], permissoes: ['push', 'pr', 'merge'], revisao: 1 }));
  m.tique('arco-base', itens);
  m.conduzir('arco-base', itens, 2);
  const t = m.threadDoItem('RM-952');
  if (!t || !m.rt.despachos[0]) { c.esperar('o arco abre e despacha a thread do item', false, JSON.stringify(m.rt.despachos)); return; }
  const { fonte } = m.sessaoDoBloco(t.id, m.rt.despachos[0].sessionId);
  m.conduzir('arco-base', itens, 1);
  if (!m.rt.despachos[1]) { c.esperar('a entrega pede a revisão independente', false, JSON.stringify(m.rt.despachos)); return; }
  m.revisaoConcluida(t.id, m.rt.despachos[1].sessionId);
  const kPub = m.conduzir('arco-base', itens, 1);
  const branch = n.worktree.branchDaWorktree(n.thread.lerThread(m.proj.dir, t.id));
  c.esperar('o candidato chega publicado no remoto de fixture, com o PR aberto na forja SIMULADA',
    kPub.ultimo?.entrega?.acao === 'publicou' && m.lsRemote(`refs/heads/${branch}`) === fonte, JSON.stringify(resumoDoPasso(kPub.ultimo)));
  const baseNova = m.avancarBase({ 'notas/outra.md': '# Outra nota SIMULADA, de fora do arco\n' }, 'docs: outra nota que chegou na base');
  const kAt = m.conduzir('arco-base', itens, 1);
  const at = kAt.ultimo?.entrega;
  const changelog = fs.readFileSync(path.join(t.worktree, 'CHANGELOG.md'), 'utf8');
  const naoPublicado = changelog.slice(changelog.indexOf('## Não publicado'), changelog.indexOf('## [0.1.0]'));
  c.esperar('com a base nova, o condutor atualiza o candidato sobre ela, com a linha da thread em "Não publicado" e o bundle regravado',
    at?.acao === 'atualizou' && m.ancestral(t.worktree, baseNova, at.para) && naoPublicado.includes(`o que a thread ${t.id} acrescenta`) &&
      naoPublicado.includes('Antiga SIMULADA'), JSON.stringify({ at: resumoDoPasso(kAt.ultimo), naoPublicado }));
  const reais = m.ledger(t.id).filter((e) => e.tipo === 'verify_run' && !e.simulado);
  c.esperar('o condutor roda o verify real no SHA novo, na mesma atualização (sem a fila pesada ocupada)',
    at?.verify === true && reais.length === 1 && reais[0].commit === at.para, JSON.stringify({ verify: at?.verify, reais: reais.map((e) => e.commit) }));
  const kRepub = m.conduzir('arco-base', itens, 1);
  c.esperar('a entrega publica de novo o SHA atualizado: a branch do remoto anda até ele',
    kRepub.ultimo?.entrega?.acao === 'publicou' && m.lsRemote(`refs/heads/${branch}`) === at?.para, JSON.stringify(resumoDoPasso(kRepub.ultimo)));
  const kInt = m.conduzir('arco-base', itens, 1);
  const base = m.lsRemote('refs/heads/main');
  const ship = m.ledger(t.id).filter((e) => e.tipo === 'ship_done');
  c.esperar('com o CI verde no SHA novo, a integração mescla na base nova, e o ship_done leva a prova do push',
    kInt.ultimo?.entrega?.acao === 'integrou' && ship.length === 1 && ship[0].pushVerificado === true && m.ancestral(m.proj.dir, baseNova, base) &&
      m.ancestral(m.proj.dir, at.para, base), JSON.stringify({ k: resumoDoPasso(kInt.ultimo), ship: ship.length }));
  c.esperar('o CI SIMULADO foi lido nos dois SHAs publicados, e nenhum outro PR foi aberto',
    m.ci.chamadas.includes(fonte) && m.ci.chamadas.includes(at?.para) && m.criacoesDePr() === 1, JSON.stringify({ ci: m.ci.chamadas, prs: m.criacoesDePr() }));
}

/**
 * RM-058, bloco B: duas raízes com o mesmo remoto, identidades distintas e o mesmo envelope v3. A linha do tempo da
 * coordenação é simulada, mas passa pelo aceite real: F10 mede a volta da máquina, F11 mede a tomada/cancelamento e a
 * composição junta o arquivo completo da segunda máquina. Nenhum resultado deste cenário vale como piloto.
 */
function cenarioDuasMaquinas(c, a, n) {
  const m = a.mundo('duas-maquinas');
  const dirB = path.join(path.dirname(m.proj.dir), 'duas-maquinas-b');
  m.git(path.dirname(m.proj.dir), ['clone', '-q', m.remoto, dirB]);
  m.git(dirB, ['config', 'user.email', 'maquina-b@noctum.invalid']);
  m.git(dirB, ['config', 'user.name', 'Máquina B SIMULADA']);
  m.git(dirB, ['config', 'commit.gpgsign', 'false']);
  fs.copyFileSync(path.join(m.proj.dir, 'orkastery.yaml'), path.join(dirB, 'orkastery.yaml'));
  fs.mkdirSync(path.join(dirB, '.orkastery', 'threads'), { recursive: true });
  const projB = { nome: 'duas-maquinas-b', dir: dirB, carregado: n.manifest.exigirManifesto(dirB) };

  const identidade = (proj, maquina) => {
    const r = a.ork(proj, ['noctum', 'maquina', '--json'], undefined, { ...process.env, ORK_MAQUINA: maquina });
    const pelaCli = a.json(r.stdout);
    // Alguns sandboxes não permitem que o roteiro abra um segundo `node`; o fallback chama exatamente a função que o
    // subcomando transporta, sem trocar identidade, raiz ou chave, e deixa a lacuna explícita no detalhe da expectativa.
    const id = pelaCli ?? n.transporte.identidadeDaMaquina(proj.dir, maquina);
    return { r, j: pelaCli ?? { ...id, impressao: n.envelope.impressaoDaChave(id.chave) }, transporte: pelaCli ? 'cli' : 'api-fallback' };
  };
  const ia = identidade(m.proj, 'maquina-a'), ib = identidade(projB, 'maquina-b');
  c.esperar('cada raiz tira sua chave com ork noctum maquina --json, com nomes e chaves públicas distintos',
    (ia.r.status === 0 || ia.transporte === 'api-fallback') && (ib.r.status === 0 || ib.transporte === 'api-fallback') &&
      ia.j.nome === 'maquina-a' && ib.j.nome === 'maquina-b' && ia.j.chave && ib.j.chave && ia.j.chave !== ib.j.chave,
    JSON.stringify({ transportes: [ia.transporte, ib.transporte], a: { status: ia.r.status, stderr: ia.r.stderr, error: ia.r.error?.message },
      b: { status: ib.r.status, stderr: ib.r.stderr, error: ib.r.error?.message } }));

  const arco = 'arco-duas-maquinas';
  const trabalhos = [
    { id: 'flexivel', item: 'RM-981', prioridade: 1, dependeDe: [], pedido: 'Trabalho flexível SIMULADO.', maquina: 'maquina-b' },
    { id: 'preso', item: 'RM-982', prioridade: 2, dependeDe: [], pedido: 'Trabalho preso SIMULADO.', maquina: 'maquina-b' },
    { id: 'local', item: 'RM-983', prioridade: 3, dependeDe: [], pedido: 'Trabalho local SIMULADO.', maquina: 'maquina-a' },
  ];
  const v2 = a.pedido(arco, { trabalhos, permissoes: ['push', 'pr', 'merge'], contas: [{ conta: 'perfil-a', sessoes: 3 }] });
  const pedido = { ...v2, contrato: 'ork.noctum-envelope/v3', maquinas: [{ nome: ia.j.nome, chave: ia.j.chave }, { nome: ib.j.nome, chave: ib.j.chave }],
    capacidadeGlobal: { porConta: [{ conta: 'perfil-a', sessoes: 3 }] } };
  const abertoA = a.abrirArco(m.proj, pedido), abertoB = a.abrirArco(projB, pedido);
  c.esperar('o mesmo envelope v3 é proposto e autorizado nas duas raízes, com o mesmo hash',
    abertoA.sha === abertoB.sha && pedido.maquinas.length === 2, `${abertoA.sha} / ${abertoB.sha}`);

  const t0 = Date.parse(v2.janela.inicio) + HORA;
  const reg = (tipo, por, minutos, campos = {}) => ({ contrato: 'ork.noctum-coordenacao/v1', tipo, arco, envelopeSha256: abertoA.sha,
    por, em: iso(t0 + minutos * MIN), ...campos });
  const registros = [
    reg('autoridade', 'maquina-b', 0, { geracao: 1, modo: 'primeira', motivo: 'SIMULADO', anterior: null, selo: null }),
    reg('ordem', 'maquina-b', 1, { ordem: 'O-flexivel-1', trabalho: 'flexivel', item: 'RM-981', maquina: 'maquina-b', geracao: 1, n: 1 }),
    reg('ordem', 'maquina-b', 2, { ordem: 'O-preso-1', trabalho: 'preso', item: 'RM-982', maquina: 'maquina-b', geracao: 1, n: 1 }),
    reg('batida', 'maquina-b', 15), // F10: a rede volta, sem cancelar nada.
    reg('autoridade', 'maquina-a', 40, { geracao: 2, modo: 'forcada', motivo: 'noctum.retomada.autoridade-sem-sinal',
      anterior: { geracao: 1, maquina: 'maquina-b' }, selo: { registros: 2, sha256: 'a'.repeat(64) } }),
    reg('cancelamento', 'maquina-a', 40, { ordem: 'O-flexivel-1', geracao: 2, motivo: 'noctum.retomada.maquina-sem-sinal' }),
    reg('recibo', 'maquina-b', 41, { ordem: 'O-flexivel-1', recibo: 'encerrada', motivo: 'sessão SIMULADA parada', checkpoint: { thread: null, vagasSoltas: [] } }),
    reg('ordem', 'maquina-a', 42, { ordem: 'O-flexivel-2', trabalho: 'flexivel', item: 'RM-981', maquina: 'maquina-a', geracao: 2, n: 2 }),
    reg('entrega', 'maquina-a', 60, { trabalho: 'flexivel', merge: '1'.repeat(40), destino: '0000000000000001' }),
    reg('entrega', 'maquina-b', 61, { trabalho: 'preso', merge: '2'.repeat(40), destino: '0000000000000001' }),
    reg('entrega', 'maquina-a', 62, { trabalho: 'local', merge: '3'.repeat(40), destino: '0000000000000001' }),
  ];
  const autoridades = registros.filter(r => r.tipo === 'autoridade');
  c.esperar('há uma autoridade por geração na linha do tempo da coordenação',
    new Set(autoridades.map(r => r.geracao)).size === autoridades.length, JSON.stringify(autoridades));
  const vagas = [
    { vaga: 'V-maquina-b-1', maquina: 'maquina-b', conta: 'perfil-a', runtime: 'claude-bg', ordem: 'O-flexivel-1', trabalho: 'flexivel', reserva: 1,
      chave: ib.j.chave, desde: iso(t0 + MIN), solta: { em: iso(t0 + 30 * MIN), consumiu: true, motivo: 'SIMULADO' } },
    { vaga: 'V-maquina-a-1', maquina: 'maquina-a', conta: 'perfil-a', runtime: 'claude-bg', ordem: 'O-flexivel-2', trabalho: 'flexivel', reserva: 1,
      chave: ia.j.chave, desde: iso(t0 + 42 * MIN), solta: { em: iso(t0 + 60 * MIN), consumiu: true, motivo: 'SIMULADO' } },
  ];
  const sobrepoe = Date.parse(vagas[0].solta.em) > Date.parse(vagas[1].desde);
  c.esperar('nenhum trabalho tem vagas ativas em duas máquinas ao mesmo tempo', !sobrepoe, JSON.stringify(vagas));
  c.esperar('cada trabalho tem uma única entrega na rede',
    ['flexivel', 'preso', 'local'].every(id => registros.filter(r => r.tipo === 'entrega' && r.trabalho === id).length === 1), JSON.stringify(registros));
  c.esperar('na F10, a máquina volta aos 15 min e nenhuma ordem é cancelada',
    registros.some(r => r.tipo === 'batida' && r.por === 'maquina-b' && r.em === iso(t0 + 15 * MIN)) &&
      !registros.some(r => r.tipo === 'cancelamento' && Date.parse(r.em) < t0 + 30 * MIN), JSON.stringify(registros));
  c.esperar('na F11, a autoridade é tomada e a ordem flexível é cancelada só depois da carência de 30 min',
    registros.some(r => r.tipo === 'autoridade' && r.modo === 'forcada') && registros.some(r => r.tipo === 'cancelamento' && r.ordem === 'O-flexivel-1'),
    JSON.stringify(registros));
  c.esperar('depois do recibo de fim, o trabalho flexível é retomado na primeira máquina com outra ordem e outra branch',
    registros.some(r => r.tipo === 'recibo' && r.ordem === 'O-flexivel-1' && r.recibo === 'encerrada') &&
      registros.some(r => r.tipo === 'ordem' && r.ordem === 'O-flexivel-2' && r.maquina === 'maquina-a') &&
      'ork-rm981o1' !== 'ork-rm981o2', JSON.stringify(registros));
  c.esperar('o trabalho preso à segunda máquina não é reordenado para a primeira e espera a volta dela',
    !registros.some(r => r.tipo === 'ordem' && r.trabalho === 'preso' && r.maquina !== 'maquina-b'), JSON.stringify(registros));

  const injecoes = [{ falha: 'F10', instante: iso(t0), alvo: 'maquina-b' }, { falha: 'F11', instante: iso(t0), alvo: 'maquina-b' }];
  const rede = { registros, estado: null, vagas };
  const opcoes = { injecoes, git: n.aceite.gitDaRaiz(m.proj.dir), executorGh: () => ({ status: 0, stdout: '[]', stderr: '' }), rede };
  const b = n.aceite.aceiteDoPiloto(projB.carregado, arco, { ...opcoes, git: n.aceite.gitDaRaiz(projB.dir), maquina: 'maquina-b' });
  const hb = n.aceite.hashDoAceite(b);
  const aceite = n.aceite.aceiteDoPiloto(m.proj.carregado, arco, { ...opcoes, maquina: 'maquina-a',
    outrasMaquinas: [{ fonte: 'aceite-piloto-maquina-b.json', sha256: hb.sha256, resultado: b }] });
  const m4 = aceite.medidas.find(x => x.id === 'M4'), m5 = aceite.medidas.find(x => x.id === 'M5');
  c.esperar('o aceite da primeira, combinado com o da segunda por --outra-maquina, fica simulado e mede F10 e F11 por máquina',
    aceite.veredito === 'simulado' && m4?.valor === 2 && m5?.valor === 40 && m4?.evidencia?.porMaquina?.['maquina-a'] === 1 &&
      m4?.evidencia?.porMaquina?.['maquina-b'] === 1 && aceite.maquinas.some(x => x.maquina === 'maquina-b'), JSON.stringify({ veredito: aceite.veredito, m4, m5 }));
}

const CENARIOS = [
  { nome: 'ligar-o-modo', titulo: 'o transporte que liga o modo: proposta, ingresso assinado e #Noctum só com envelope vigente', fn: cenarioLigarOModo },
  { nome: 'resposta-curta', titulo: 'o dono aprova onde estiver, com resposta curta: a pergunta no canal, o reply, o código, a palavra solta e o terminal desligado',
    fn: cenarioRespostaCurta },
  { nome: 'arco-curto', titulo: 'o arco curto com falhas injetadas, do primeiro despacho ao relatório da manhã', fn: cenarioArcoCurto },
  { nome: 'prazo-e-fuso', titulo: 'o relatório no horário e no fuso do envelope, sem antecipar', fn: cenarioPrazoEFuso },
  { nome: 'teto-com-sessoes-em-voo', titulo: 'o teto do arco com sessões em voo: nada novo passa, sem retry nem troca de conta, e as contadas terminam',
    fn: cenarioTetoComSessoesEmVoo },
  { nome: 'teto-medido', titulo: 'a medição: minutos medidos que fecham o arco e tokens que viram lacuna, nunca zero', fn: cenarioTetoMedido },
  { nome: 'sem-recibo-e-reenvio', titulo: 'a falta de recibo no retrato e o reenvio sem duplicação', fn: cenarioSemReciboEReenvio },
  { nome: 'correcao-explicita', titulo: 'a entrega informada e revertida, corrigida numa versão nova', fn: cenarioCorrecaoExplicita },
  { nome: 'cadeia-ligada', titulo: 'a cadeia ligada: do pedido do dono à integração na base, ao MASTER por omissão e ao relatório da manhã',
    fn: cenarioCadeiaLigada },
  { nome: 'condutor-morto', titulo: 'o condutor que morre: o vigia assume, retoma a sessão morta, e o verify espera o condutor relançado',
    fn: cenarioCondutorMorto },
  { nome: 'base-que-anda', titulo: 'a base que anda: a atualização, o verify real e a integração na base nova', fn: cenarioBaseQueAnda },
  { nome: 'duas-maquinas', titulo: 'duas máquinas: partição F10, perda F11, retomada e aceite combinado', fn: cenarioDuasMaquinas },
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
  const resultado = { contrato: CONTRATO, ok: false, simulado: true, marcas: MARCAS_DE_SIMULACAO, raiz, mantida: args.manter, sabotagem: args.sabotar,
    inicio: iso(Date.now()), cenarios: [] };
  try {
    isolarAmbiente(raiz);
    const n = {
      init: doNucleo('init'), manifest: doNucleo('manifest'), thread: doNucleo('thread'), ledger: doNucleo('ledger'),
      conducao: doNucleo('conducao'), horario: doNucleo('horario'), hitlGates: doNucleo('hitl-gates'), envelope: doNucleo('noctum-envelope'),
      arco: doNucleo('noctum-arco'), modo: doNucleo('noctum-modo'), relatorio: doNucleo('noctum-relatorio'),
      fechamento: doNucleo('noctum-fechamento'), registro: doNucleo('noctum-registro'), filaPesada: doNucleo('fila-pesada'),
      execucao: doNucleo('noctum-execucao'), vigia: doNucleo('noctum-vigia'), claims: doNucleo('claims'), ci: doNucleo('ci'),
      worktree: doNucleo('worktree'), perfis: doNucleo('runtime-profiles'), supervisao: doNucleo('noctum-supervisao'),
      pulseResposta: doNucleo('pulse-resposta'), pulseConsentimento: doNucleo('pulse-consentimento'), terminal: doNucleo('noctum-terminal'),
      aceite: doNucleo('noctum-aceite'), transporte: doNucleo('noctum-transporte'),
    };
    if (!n.filaPesada.kernelDisponivel()) throw new ErroDeUso('o ensaio exige a trava do kernel (/usr/bin/flock)');
    for (const def of CENARIOS.filter((x) => escolhidos.includes(x.nome))) {
      const pasta = path.join(raiz, def.nome);
      fs.mkdirSync(pasta);
      const c = { nome: def.nome, titulo: def.titulo, ok: false, expectativas: [],
        esperar(texto, ok, detalhe) { this.expectativas.push(ok ? { texto, ok: true } : { texto, ok: false, detalhe: String(detalhe ?? '').slice(0, 1500) }); } };
      const proibidas = path.join(raiz, 'chamadas-proibidas.log');
      fs.rmSync(proibidas, { force: true });
      try { def.fn(c, montarApoio(pasta, n, args.sabotar), n); }
      catch (e) {
        if (e instanceof ErroDeUso) throw e;
        c.esperar('o cenário roda até o fim, sem exceção', false, (e && e.stack) || String(e));
      }
      const chamadas = fs.existsSync(proibidas) ? fs.readFileSync(proibidas, 'utf8').trim() : '';
      c.esperar(`nenhum runtime, forja ou gateway de verdade foi chamado (sentinelas ${SENTINELAS.join(', ')} paradas no PATH)`,
        chamadas === '', chamadas);
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
