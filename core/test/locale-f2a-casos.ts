/**
 * RM-061, fatia F2a: os casos do snapshot pt-BR. Cada caso produz um texto que a F2a passa pelo
 * catalogo de mensagens: as funcoes sao chamadas com entradas fixas em todos os ramos que a fatia
 * toca, e o CLI roda num repositorio temporario com HOME proprio, PATH controlado e um runtime falso.
 *
 * A fixture `fixtures/locale-f2a-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da
 * base (antes da F2a); o teste `locale-f2a-snapshot` so compara e nunca regrava. O que varia de uma
 * maquina ou de uma execucao para outra (pastas temporarias, horarios, sha, versao do Node, usuario)
 * e normalizado aqui, igual na geracao e na comparacao.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checarChaveDeEmbedding, checarContas, checarDespachoPeloCodex, checarDonoDoGit, checarOnboarding,
  checarRuntimeClaude, manifestoForaDoRepositorio, relatorio,
} from '../src/doctor';
import { checarCronDoPulse } from '../src/doctor-pulse-cron';
import { checarRede, correcaoDaFalha } from '../src/doctor-rede';
import { duracao } from '../src/rede-status';
import { checarAnalisadoresDoGrafo } from '../src/intelligence-graph-cli';
import { sondasDeAmbiente } from '../src/preflight';
import { definirFusoDoDono } from '../src/horario';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { gravarEtapa, lerOnboarding, onboardingPadrao, textoDaPauta } from '../src/onboarding';
import { adicionarPerfil, caminhoDoStore, marcarFalhaDePerfil, PerfilDeDespacho } from '../src/runtime-profiles';
import { StatusDeAuth } from '../src/adapters/claude-bg';
import { editarBloco } from '../src/setup';
import { MODOS } from '../src/modos';
import { enfileirar, caminhoDaFila } from '../src/ratelimit';
import {
  avisoDaWorktree, avisoDeChaveSemCommit, avisoDeThreadSemBase, avisoDeThreadSemWorktree, avisoDeWorktreeQueFalharia,
  dirThread, linhaDaWorktree, lerThread, novaThread, resumoDaThread,
} from '../src/thread';
import { linhaDeConducao, quemConduz } from '../src/conducao-texto';
import { textoDoPedidoRepetido } from '../src/conducao';
import { descreverSlug, tabelaDoLedger } from '../src/phase';
import { linhasDeAviso } from '../src/policies';
import { avisoRoadmapSemAssociacao } from '../src/index';
import { ConducaoAtual, Thread } from '../src/types';
import { exec, noPath } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const SP = 'America/Sao_Paulo';
/** Instantes fixos fora do ano corrente: a data mostra o ano em qualquer ano de execucao. */
const T0 = '2025-09-19T18:16:00.000Z';
const T1 = '2025-09-19T18:21:30.000Z';

/** Pastas temporarias deste lote de casos, trocadas por marcadores na normalizacao. */
const marcadores: Array<[string, string]> = [];

function dirTemp(nome: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-f2a-${nome}-`)));
  marcadores.push([dir, marcador]);
  return dir;
}

/** O que varia entre maquinas e execucoes vira marcador; o resto fica byte a byte. */
export function normalizar(texto: string): string {
  let t = texto;
  for (const [dir, marcador] of [...marcadores].sort((a, b) => b[0].length - a[0].length)) t = t.split(dir).join(marcador);
  const usuario = os.userInfo().username;
  return t
    .replace(/\b\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2}(?::\d{2})?\b/g, '<DATA>')
    .replace(/\b[0-9a-f]{64}\b/g, '<SHA256>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/(@ )[0-9a-f]{8}\b/g, '$1<SHA8>')
    .replace(/(-(?:goal|plan|go|check|ship|master)-)[0-9a-f]{8}(\.md)/g, '$1<H>$2')
    .replace(/(sha256 )[0-9a-f]{12}\b/g, '$1<SHA12>')
    .replace(/(pedido )[0-9a-f]{8}\b/g, '$1<ID>')
    .replace(/\bv\d+\.\d+\.\d+\b/g, 'v<NODE>')
    .replace(/\bnode\.\d+\.\d+\.\d+/g, 'node.<NODE>')
    .replace(/\bunicode [\d.]+/g, 'unicode <UNICODE>')
    .replace(/\b\d+ entradas de \.git\b/g, '<N> entradas de .git')
    .replace(/\buid \d+/g, 'uid <UID>')
    .replace(/(o do repositorio e )\d+\)/g, '$1<UID>)')
    .replace(/(chown -R )\d+:\d+/g, '$1<UID>:<GID>')
    .replace(/(-not -uid )\d+/g, '$1<UID>')
    .replace(new RegExp(`(^|\\s)${usuario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, Claude e Codex`, 'gm'), '$1<USUARIO>, Claude e Codex');
}

function repoComCommit(nome: string, marcador: string): string {
  const dir = dirTemp(nome, marcador);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale f2a\n');
  exec('git', ['add', '--', 'README.md'], dir);
  exec('git', ['commit', '-q', '-m', 'inicial'], dir);
  return dir;
}

interface Ambiente { casa: string; bin: string; stub: string }

/**
 * HOME, um bin so com o git e o que o stub do `claude` usa (o mesmo script do `apoio.ts`): nenhum
 * `claude` nem `codex` de quem roda entra no PATH, em maquina nenhuma.
 */
function ambiente(nome: string): Ambiente {
  const casa = dirTemp(`${nome}-casa`, '<CASA>');
  const bin = dirTemp(`${nome}-bin`, '<BIN>');
  const stub = dirTemp(`${nome}-stub`, '<STUB>');
  for (const ferramenta of ['git', 'cat', 'cut', 'date', 'rm']) {
    const achado = noPath(ferramenta);
    if (!achado) throw new Error(`${ferramenta} fora do PATH de quem roda os testes`);
    fs.symlinkSync(path.resolve(achado), path.join(bin, ferramenta));
  }
  const apoio = fs.readFileSync(path.resolve(__dirname, '../../test/apoio.ts'), 'utf8');
  const m = /const SCRIPT_DO_RUNTIME = `([\s\S]*?)`;/.exec(apoio);
  if (!m) throw new Error('script do runtime falso nao achado em apoio.ts');
  fs.writeFileSync(path.join(stub, 'claude'), m[1].replace(/\\\\/g, '\\'), { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'pid'), String(process.pid));
  return { casa, bin, stub };
}

interface Saida { status: number | null; stdout: string; stderr: string }

/**
 * A CLI com ambiente montado do zero: HOME, PATH, LANG pt-BR e o fuso. `comRuntime` poe o stub do
 * `claude` no PATH (o despacho); sem ele, o PATH so tem o bin da funcao `ambiente`.
 */
function ork(dir: string, amb: Ambiente, comRuntime: boolean, ...args: string[]): Saida {
  return orkComEnv(dir, amb, comRuntime, {}, ...args);
}

function orkComEnv(dir: string, amb: Ambiente, comRuntime: boolean, extra: Record<string, string>, ...args: string[]): Saida {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: {
      HOME: amb.casa, LANG: 'C.UTF-8', TZ: SP,
      PATH: comRuntime ? `${amb.stub}:${amb.bin}` : amb.bin,
      ...(comRuntime ? { ORK_STUB_DIR: amb.stub } : {}),
      ...extra,
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function texto(s: Saida): string {
  return `[saida ${s.status}]\n${s.stdout}${s.stderr ? `[stderr]\n${s.stderr}` : ''}`;
}

/** Encerra os watchers que o despacho real abriu (identidade gravada no ledger). */
function encerrarWatchers(repo: string): void {
  const threads = path.join(repo, '.orkastery', 'threads');
  if (!fs.existsSync(threads)) return;
  for (const id of fs.readdirSync(threads)) {
    const ledger = path.join(threads, id, 'ledger.jsonl');
    if (!fs.existsSync(ledger)) continue;
    for (const linha of fs.readFileSync(ledger, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      const e = JSON.parse(linha) as { tipo?: string; identidade?: { pid?: number } };
      if (e.tipo === 'session_watcher_started' && e.identidade?.pid) {
        try { process.kill(e.identidade.pid, 'SIGTERM'); } catch { /* ja saiu */ }
      }
    }
  }
}

function limparTudo(): void {
  for (const [dir] of marcadores) {
    try { encerrarWatchers(dir); } catch { /* segue */ }
  }
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(pausa, 0, 0, 200);
  for (const [dir] of marcadores) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  marcadores.length = 0;
}

/** Roda `fn` e guarda o texto (ou `ERRO: mensagem`) normalizado. */
function caso(casos: Record<string, string>, nome: string, fn: () => string | null | undefined): void {
  if (nome in casos) throw new Error(`caso repetido: ${nome}`);
  let saida: string;
  try {
    const r = fn();
    saida = r === null ? '<null>' : r === undefined ? '<undefined>' : r;
  } catch (e) { saida = `ERRO: ${(e as Error).message}`; }
  casos[nome] = normalizar(saida);
}

function checkTexto(c: { nome: string; nivel: string; detalhe: string; correcao?: string } | null): string {
  if (!c) return '<null>';
  return `${c.nome} | ${c.nivel} | ${c.detalhe}${c.correcao ? ` | correcao: ${c.correcao}` : ''}`;
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

function casosDoDoctor(casos: Record<string, string>): void {
  const repo = repoComCommit('doctor', '<REPO>');
  exec('git', ['commit', '-q', '--allow-empty', '-m', 'segundo'], repo);
  const fora = dirTemp('doctor-fora', '<FORA>');
  const amb = ambiente('doctor');
  const init = ork(repo, amb, false, 'init', '--name', 'loc', '--abbrev', 'loc');
  if (init.status !== 0) throw new Error(`init falhou: ${init.stderr}`);
  const carregado = exigirManifesto(repo);

  caso(casos, 'doctor cli: repositorio novo sem claude nem codex', () => texto(ork(repo, amb, false, 'doctor')));
  caso(casos, 'doctor cli: init fora do repositorio', () => texto(ork(fora, amb, false, 'init')));
  caso(casos, 'doctor cli: doctor fora do repositorio', () => texto(ork(fora, amb, false, 'doctor')));

  // Manifesto fora do repositorio: um orkastery.yaml numa pasta acima do repositorio.
  caso(casos, 'doctor: manifesto fora do repositorio', () =>
    checkTexto(manifestoForaDoRepositorio(repo, path.join(fora, 'orkastery.yaml'))));

  // Contas por runtime: store invalido e perfis em todos os estados, com o login injetado.
  caso(casos, 'doctor: contas com store invalido', () => {
    const p = repoComCommit('doctor-store', '<STORE>');
    fs.mkdirSync(path.dirname(caminhoDoStore(p)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(caminhoDoStore(p), JSON.stringify({ contrato: 'outro', perfis: [] }), { mode: 0o600 });
    return checkTexto(checarContas(p, () => ({ ok: true, detalhe: '' })));
  });
  caso(casos, 'doctor: contas com perfis em todos os estados', () => {
    const p = repoComCommit('doctor-contas', '<CONTAS>');
    ork(p, amb, false, 'init', '--name', 'cta', '--abbrev', 'cta');
    const usuario = dirTemp('doctor-contas-usuario', '<USUARIODIR>');
    const anterior = process.env.ORK_USUARIO_DIR;
    process.env.ORK_USUARIO_DIR = usuario;
    try {
      for (const [id, runtime] of [['a', 'claude-bg'], ['b', 'claude-bg'], ['c', 'claude-bg'], ['d', 'claude-bg'], ['e', 'claude-bg'],
        ['x', 'codex'], ['y', 'codex']] as const) {
        const dir = path.join(p, 'contas', id);
        fs.mkdirSync(dir, { recursive: true });
        adicionarPerfil(p, { id, runtime, dir });
      }
      marcarFalhaDePerfil(p, 'e', { estado: 'esgotado', esgotadoAte: '2099-01-01T00:00:00.000Z', motivo: 'runtime.quota-exhausted',
        detalhe: 'cota SIMULADA', em: T0 });
      const auth = (q: PerfilDeDespacho): StatusDeAuth => {
        const id = q.id;
        if (id === 'b') return { ok: false, detalhe: 'sem login SIMULADO' };
        if (id === 'c') return { ok: false, pago: true, detalhe: 'pago SIMULADO' };
        if (id === 'd') return { ok: false, transitorio: true, detalhe: 'timeout SIMULADO' };
        return { ok: true, detalhe: 'ok SIMULADO' };
      };
      const todos = checkTexto(checarContas(p, auth));
      const soCodex = checkTexto(checarContas(p, (q) => q.runtime === 'codex' ? { ok: false, detalhe: 'x' } : { ok: true, detalhe: '' }));
      return `${todos}\n${soCodex}`;
    } finally {
      if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    }
  });

  // Chave de embedding: os ramos alem do provider none (que a F1 ja cobre).
  const comEmbedding = (embedding: Record<string, unknown>, database?: string): ManifestoCarregado => ({
    ...carregado,
    manifesto: { ...carregado.manifesto, memory: { ...carregado.manifesto.memory, embedding: embedding as never,
      ...(database ? { database_url_env: database } : {}) } },
  });
  const base = { provider: 'openrouter', model: 'openai/text-embedding-3-small' };
  caso(casos, 'doctor: chave de embedding com nome de provider pago', () =>
    checkTexto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: 'ANTHROPIC_API_KEY' }), {})));
  caso(casos, 'doctor: chave de embedding sem api_key_env', () =>
    checkTexto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: '' }), {})));
  caso(casos, 'doctor: chave de embedding com valor recusado', () =>
    checkTexto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: 'ORKASTERY_EMBEDDING_API_KEY' }),
      { ORKASTERY_EMBEDDING_API_KEY: 'valor com espaco' })));
  caso(casos, 'doctor: chave de embedding presente', () =>
    checkTexto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: 'ORKASTERY_EMBEDDING_API_KEY' }),
      { ORKASTERY_EMBEDDING_API_KEY: 'sk-or-SIMULADA0123456789' })));
  caso(casos, 'doctor: chave de embedding ausente', () =>
    checkTexto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: 'ORKASTERY_EMBEDDING_API_KEY' }), {})));

  // Dono do .git: outro dono, conferencia parcial e tudo certo, com o lstat injetado.
  const dono = (desvio: (p: string) => boolean) => (p: string): fs.Stats => {
    const st = fs.lstatSync(p);
    return desvio(p) ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid: 4242 }) : st;
  };
  const dirGit = path.join(repo, '.git');
  caso(casos, 'doctor: dono do .git com outro dono', () =>
    checkTexto(checarDonoDoGit(repo, { lstat: dono((p) => p === path.join(dirGit, 'HEAD')) })));
  caso(casos, 'doctor: dono do .git parcial', () => checkTexto(checarDonoDoGit(repo, { teto: 3 })));
  // A ordem do readdir muda com o sistema de arquivos: os exemplos viram marcador, o texto nao.
  caso(casos, 'doctor: dono do .git com outro dono e parcial', () =>
    checkTexto(checarDonoDoGit(repo, { teto: 3, lstat: dono((p) => p !== dirGit) }))
      .replace(/\): [^;]*; o git do dono/, '): <EXEMPLOS>; o git do dono'));
  caso(casos, 'doctor: dono do .git certo', () => checkTexto(checarDonoDoGit(repo)));

  // Entrevista: memoria e fuso divergentes do manifesto.
  caso(casos, 'doctor: entrevista diverge do manifesto', () => {
    const p = repoComCommit('doctor-entrevista', '<ENTREVISTA>');
    ork(p, amb, false, 'init', '--name', 'ent', '--abbrev', 'ent');
    gravarEtapa(p, 'memoria', { modo: 'orkmind' }, 'teste');
    gravarEtapa(p, 'maestro', { fuso: 'Europe/Lisbon' }, 'teste');
    return checarOnboarding(exigirManifesto(p)).map(checkTexto).join('\n');
  });

  // Runtime claude ausente: sem manifesto, com o padrao e com os blocos passados ao codex.
  caso(casos, 'doctor: claude ausente sem manifesto', () => checkTexto(checarRuntimeClaude(null, null, null)));
  caso(casos, 'doctor: claude ausente com os blocos no claude', () => checkTexto(checarRuntimeClaude(carregado, null, null)));
  caso(casos, 'doctor: claude presente com versao desconhecida', () => checkTexto(checarRuntimeClaude(carregado, '/opt/bin/claude', null)));
  caso(casos, 'doctor: claude presente sem login', () =>
    checkTexto(checarRuntimeClaude(carregado, '/opt/bin/claude', '2.1.0', { ok: false, detalhe: 'claude auth status: loggedIn false' })));
  caso(casos, 'doctor: claude presente com provider pago', () =>
    checkTexto(checarRuntimeClaude(carregado, '/opt/bin/claude', '2.1.0', { ok: false, pago: true, detalhe: 'claude auth status: provider pago' })));
  caso(casos, 'doctor: blocos no codex, com e sem fallback no claude', () => {
    const p = repoComCommit('doctor-codex', '<CODEX>');
    ork(p, amb, false, 'init', '--name', 'cdx', '--abbrev', 'cdx');
    const c0 = exigirManifesto(p);
    for (const modo of c0.manifesto.conduction.allowed_modes) {
      MODOS[modo].blocos.forEach((_, i) => { editarBloco(p, modo, i + 1, { runtime: 'codex', model: 'gpt-5.5' }); });
    }
    const semFallback = checkTexto(checarRuntimeClaude(exigirManifesto(p), null, null));
    editarBloco(p, 'auto', 1, { fallback: ['claude-bg:opus'] });
    const comFallback = checkTexto(checarRuntimeClaude(exigirManifesto(p), null, null));
    const despachoSem = checkTexto(checarDespachoPeloCodex(exigirManifesto(p), null, null));
    const despachoQuebrado = checkTexto(checarDespachoPeloCodex(exigirManifesto(p), '/opt/bin/codex', { ok: false }));
    const despachoOk = checkTexto(checarDespachoPeloCodex(exigirManifesto(p), '/opt/bin/codex', { ok: true }));
    return [semFallback, comFallback, despachoSem, despachoQuebrado, despachoOk].join('\n');
  });

  // Sondas de ambiente: umask, permissoes do estado e pasta privada.
  caso(casos, 'doctor: sondas de ambiente', () => {
    const linhas: string[] = [];
    const listar = (umask: number | null) => sondasDeAmbiente(repo, umask).map(checkTexto).join('\n');
    linhas.push(listar(0o022), listar(0o002), listar(null));
    const estado = path.join(repo, '.orkastery');
    fs.chmodSync(estado, 0o775);
    linhas.push(listar(0o022));
    fs.chmodSync(estado, 0o755);
    const privada = path.join(estado, 'private');
    fs.mkdirSync(privada, { mode: 0o700 });
    fs.chmodSync(privada, 0o700);
    linhas.push(listar(0o022));
    fs.chmodSync(privada, 0o755);
    linhas.push(listar(0o022));
    fs.rmSync(privada, { recursive: true, force: true });
    return linhas.join('\n');
  });

  // Cron do pulse: com o transporte configurado, cada ramo da leitura do crontab.
  caso(casos, 'doctor: cron do pulse', () => {
    const monitor = path.join(repo, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), '{}');
    const script = '/opt/ork/monitor/varredura-pulse.sh';
    const ler = (r: { ok: true; texto: string } | { ok: false; motivo: string }) => () => r as never;
    const linhas = [
      checarCronDoPulse(monitor, repo, ler({ ok: false, motivo: 'crontab ausente' }), script),
      checarCronDoPulse(monitor, repo, ler({ ok: true, texto: '# nada\n' }), script),
      checarCronDoPulse(monitor, repo, ler({ ok: true, texto: `*/15 * * * * ${script}\n` }), script),
      checarCronDoPulse(monitor, repo, ler({ ok: true, texto: `0 * * * * ${script}\n` }), script),
      checarCronDoPulse(monitor, repo, ler({ ok: true, texto: `*/30 * * * * ${script}\n` }), script),
      checarCronDoPulse(monitor, repo, ler({ ok: true, texto: `@reboot ${script}\n` }), script),
    ].map(checkTexto);
    fs.rmSync(monitor, { recursive: true, force: true });
    return linhas.join('\n');
  });

  // Rede: fora, saiu, membro parado, membro com falha nova e membro em dia.
  caso(casos, 'doctor: rede', () => {
    const usuario = dirTemp('doctor-rede-usuario', '<REDE>');
    const anterior = process.env.ORK_USUARIO_DIR;
    process.env.ORK_USUARIO_DIR = usuario;
    definirFusoDoDono(SP);
    try {
      const agoraMs = Date.parse(T1);
      const linhas = [checkTexto(checarRede({ agoraMs }))];
      fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: false }));
      linhas.push(checkTexto(checarRede({ agoraMs })));
      fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: true,
        host: 'github.com', dono: 'exemplo', repositorio: 'orkastery-network' }));
      const log = path.join(usuario, 'rede-log-vazio');
      linhas.push(checkTexto(checarRede({ agoraMs, log })));
      fs.mkdirSync(path.join(usuario, 'rede'), { recursive: true });
      fs.writeFileSync(path.join(usuario, 'rede', 'publicada.json'), JSON.stringify({ em: T0, casa: 'github.com/exemplo/orkastery-network' }));
      const comFalha = path.join(usuario, 'rede-log-falha');
      fs.writeFileSync(comFalha, JSON.stringify({ ts: T1, acao: 'falhou', origem: 'pulse', erro: 'rede.sem-forja: gh sem login SIMULADO' }) + '\n');
      linhas.push(checkTexto(checarRede({ agoraMs, log: comFalha })));
      linhas.push(checkTexto(checarRede({ agoraMs, log })));
      linhas.push(checkTexto(checarRede({ agoraMs: agoraMs + 3 * 3600 * 1000, log })));
      for (const erro of ['rede.sem-repositorio: x', 'rede.repositorio-alheio: x', 'rede.sem-forja: x', 'rede.repositorio-publico: x',
        'rede.nome-em-uso: x', 'outra coisa']) linhas.push(correcaoDaFalha(erro));
      return linhas.join('\n');
    } finally {
      definirFusoDoDono(SP);
      if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    }
  });
  caso(casos, 'doctor: duracao', () =>
    [NaN, 20_000, 5 * 60_000, 119 * 60_000, 3 * 3600_000, 47 * 3600_000, 72 * 3600_000].map(duracao).join(' | '));

  // Analisadores do grafo: os ramos da falta, com a versao do pacote e sem ela.
  caso(casos, 'doctor: analisadores do grafo ausentes', () => [
    checkTexto(checarAnalisadoresDoGrafo('0.5.4', () => { throw new Error('grafo.parser.indisponivel: micromark ausente'); })),
    checkTexto(checarAnalisadoresDoGrafo(undefined, () => { throw new Error('grafo.parser.indisponivel: ERR_REQUIRE_ESM'); })),
    checkTexto(checarAnalisadoresDoGrafo('0.0.0-desconhecida', () => { throw new Error('grafo.parser.indisponivel: x'); })),
  ].join('\n'));

  // Fila de rate limit e governanca: o doctor do CLI com a fila cheia e com uma sessao sem thread.
  caso(casos, 'doctor cli: fila com espera e escalado, sessao sem thread', () => {
    enfileirar(exigirManifesto(repo), { thread: 'loc-x', fase: 'GO', slug: 'loc-x-full', promptPath: 'prompt.md', promptSha256: '0'.repeat(64),
      cwd: repo, model: null, effort: null, sinal: { resetEm: '2099-01-01T00:00:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' },
      detalhe: 'rate limit SIMULADO' });
    const fila = caminhoDaFila(repo);
    const escalado = JSON.parse(fs.readFileSync(fila, 'utf8').trim().split('\n')[0]) as Record<string, unknown>;
    fs.appendFileSync(fila, JSON.stringify({ ...escalado, id: 'R2', estado: 'escalado' }) + '\n');
    const s = ork(repo, amb, true, 'doctor');
    fs.rmSync(fila, { force: true });
    return texto(s);
  });
  caso(casos, 'doctor cli: fila so com espera', () => {
    enfileirar(exigirManifesto(repo), { thread: 'loc-x', fase: 'GO', slug: 'loc-x-full', promptPath: 'prompt.md', promptSha256: '0'.repeat(64),
      cwd: repo, model: null, effort: null, sinal: { resetEm: '2099-01-01T00:00:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' },
      detalhe: 'rate limit SIMULADO' });
    const s = ork(repo, amb, false, 'doctor');
    fs.rmSync(caminhoDaFila(repo), { force: true });
    return texto(s);
  });
  caso(casos, 'doctor: relatorio so com avisos', () => relatorio([
    { nome: 'node', nivel: 'ok', detalhe: 'v1.0.0' },
    { nome: 'umask', nivel: 'warn', detalhe: 'umask 0002 permite escrita de grupo ou outros', correcao: 'umask 022' },
  ]));
}

// ---------------------------------------------------------------------------
// Onboarding e experiencia
// ---------------------------------------------------------------------------

function casosDoOnboarding(casos: Record<string, string>): void {
  const repo = repoComCommit('onboarding', '<REPO>');
  const amb = ambiente('onboarding');
  ork(repo, amb, false, 'init', '--name', 'onb', '--abbrev', 'onb');
  const owner = { language: 'pt-BR', timezone: SP, depth: 'curta' };

  caso(casos, 'onboarding: pauta padrao', () => textoDaPauta(onboardingPadrao(), owner));
  caso(casos, 'onboarding: pauta com etapas respondidas', () => {
    const estado = onboardingPadrao();
    estado.etapas.maestro = { por: 'teste', respondidaEm: T0, conteudo: { objetivo: 'x' } };
    estado.etapas.skills = { por: 'teste', respondidaEm: T0, conteudo: ['a'] };
    return textoDaPauta(estado, { language: 'en-US', timezone: 'UTC', depth: 'detalhada' });
  });
  caso(casos, 'onboarding cli: show', () => texto(ork(repo, amb, false, 'onboarding')));
  caso(casos, 'onboarding cli: show explicito', () => texto(ork(repo, amb, false, 'onboarding', 'show')));
  caso(casos, 'onboarding cli: set', () =>
    texto(ork(repo, amb, false, 'onboarding', 'set', 'produtos', '--conteudo', '{"produtos":["loc"]}', '--por', 'teste')));
  caso(casos, 'onboarding cli: reset de uma etapa', () => texto(ork(repo, amb, false, 'onboarding', 'reset', 'produtos', '--por', 'teste')));
  caso(casos, 'onboarding cli: reset pelo alias', () => texto(ork(repo, amb, false, 'onboarding', '--reset', '--por', 'teste')));
  caso(casos, 'onboarding cli: uso invalido', () => texto(ork(repo, amb, false, 'onboarding', 'qualquer')));
  caso(casos, 'onboarding cli: conteudo com segredo', () =>
    texto(ork(repo, amb, false, 'onboarding', 'set', 'produtos', '--conteudo', '{"senha":"x"}', '--por', 'teste')));
  caso(casos, 'onboarding: estado gravado continua legivel', () => JSON.stringify(Object.keys(lerOnboarding(repo).etapas)));

  caso(casos, 'experiencia cli: show', () => texto(ork(repo, amb, false, 'experiencia', 'show')));
  caso(casos, 'experiencia cli: show sem subcomando', () => texto(ork(repo, amb, false, 'experiencia')));
  caso(casos, 'experiencia cli: uso invalido', () => texto(ork(repo, amb, false, 'experiencia', 'show', '--x')));
  caso(casos, 'experiencia cli: preferencia invalida avisa', () => {
    const p = repoComCommit('experiencia-aviso', '<AVISO>');
    ork(p, amb, false, 'init', '--name', 'avi', '--abbrev', 'avi');
    fs.appendFileSync(path.join(p, 'orkastery.yaml'), '\nowner:\n  depth: "funda"\n');
    return texto(ork(p, amb, false, 'experiencia', 'show'));
  });
  caso(casos, 'experiencia cli: show com escolha do onboarding', () => {
    ork(repo, amb, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"pt-BR","timezone":"UTC","depth":"detalhada","experience":false}}', '--por', 'teste');
    return texto(ork(repo, amb, false, 'experiencia', 'show'));
  });
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

function conducao(dono: ConducaoAtual['dono'], operacao: ConducaoAtual['operacao'], sessao: string | null): ConducaoAtual {
  return { thread: 'loc-x', canal: 'cli', sessao, fase: 'GO', desde: T0, promptSha256: 'ab'.repeat(32), operacao, dono,
    expiraEm: T1, identidade: '00000000-0000-0000-0000-000000000000' } as ConducaoAtual;
}

function casosDaThread(casos: Record<string, string>): void {
  const repo = repoComCommit('thread', '<REPO>');
  const amb = ambiente('thread');
  ork(repo, amb, false, 'init', '--name', 'loc', '--abbrev', 'loc');

  caso(casos, 'thread cli: new com worktree pela chave', () => texto(ork(repo, amb, true, 'thread', 'new', 'Minha fatia', '--modo', 'auto')));
  caso(casos, 'thread cli: new em simulacao', () => texto(ork(repo, amb, true, 'thread', 'new', 'Outra', '--modo', 'classic', '--dry-run')));
  caso(casos, 'thread cli: new sem worktree na base', () =>
    texto(ork(repo, amb, true, 'thread', 'new', 'Sem arvore', '--modo', 'fast', '--sem-worktree')));
  caso(casos, 'thread cli: new com RM no nome e criterios de pronto', () =>
    texto(ork(repo, amb, true, 'thread', 'new', 'RM-123 coisa', '--modo', 'auto', '--sem-worktree', '--exige-runtime-diferente',
      '--done', 'build verde :: npm run build;; testes :: npm test')));
  caso(casos, 'thread cli: new com worktree auto em simulacao', () =>
    texto(ork(repo, amb, true, 'thread', 'new', 'Arvore', '--modo', 'auto', '--worktree', 'auto', '--dry-run')));
  caso(casos, 'thread cli: new sem nome', () => texto(ork(repo, amb, true, 'thread', 'new')));
  caso(casos, 'thread cli: new com modo invalido', () => texto(ork(repo, amb, true, 'thread', 'new', 'x', '--modo', 'nenhum')));
  caso(casos, 'thread cli: new com done sem comando', () => texto(ork(repo, amb, true, 'thread', 'new', 'x', '--done', 'sem comando')));
  caso(casos, 'thread cli: new com done incompleto', () => texto(ork(repo, amb, true, 'thread', 'new', 'x', '--done', ':: npm test')));
  caso(casos, 'thread cli: new com ciclo invalido', () => texto(ork(repo, amb, true, 'thread', 'new', 'x', '--ciclo', 'nenhum')));
  caso(casos, 'thread cli: new com ciclo que exige worktree', () =>
    texto(ork(repo, amb, true, 'thread', 'new', 'x', '--ciclo', 'merge-branch', '--sem-worktree')));
  caso(casos, 'thread cli: new com worktree e sem-worktree', () =>
    texto(ork(repo, amb, true, 'thread', 'new', 'x', '--worktree', 'auto', '--sem-worktree')));
  caso(casos, 'thread cli: status', () => texto(ork(repo, amb, true, 'thread', 'status', 'loc-minhafatia')));
  caso(casos, 'thread cli: status de thread com criterios', () => texto(ork(repo, amb, true, 'thread', 'status', 'loc-rm123coisa')));
  caso(casos, 'thread cli: status sem id', () => texto(ork(repo, amb, true, 'thread', 'status')));
  caso(casos, 'thread cli: status de thread que nao existe', () => texto(ork(repo, amb, true, 'thread', 'status', 'loc-nada')));
  caso(casos, 'thread cli: subcomando desconhecido', () => texto(ork(repo, amb, true, 'thread', 'qualquer')));

  // Resumo e avisos chamados direto, nos ramos que o CLI nao alcanca aqui.
  const thread = lerThread(repo, 'loc-minhafatia');
  caso(casos, 'thread: resumo com score, conducao e ciclo', () => resumoDaThread({ ...thread, variante: 'gap',
    score: { valor: 4, avaliadoPor: 'dono', regime: 'humano', avaliadoEm: T0 } } as unknown as Thread,
    conducao({ tipo: 'sessao', sessionId: '22222222-3333-4444-5555-666666666666' } as never, 'phase.run', '22222222-3333-4444-5555-666666666666')));
  caso(casos, 'thread: resumo sem conducao e sem worktree', () => resumoDaThread({ ...thread, worktree: null } as Thread, null));
  // Cada modo e cada ciclo: o `pausaSobre` de cada bloco aparece no resumo.
  for (const modo of exigirManifesto(repo).manifesto.conduction.allowed_modes) {
    caso(casos, `thread: resumo do modo ${modo}`, () =>
      resumoDaThread(novaThread(exigirManifesto(repo), { nome: `Modo ${modo}`, modo, dryRun: true }).thread));
  }
  for (const variante of ['greenfield', 'merge-branch', 'goal-plan', 'gap', 'feature-xl-faseada'] as const) {
    caso(casos, `thread: resumo do ciclo ${variante}`, () =>
      resumoDaThread(novaThread(exigirManifesto(repo), { nome: `Ciclo ${variante}`, modo: 'classic', dryRun: true, variante,
        criarWorktree: true, ...(variante === 'merge-branch' ? { branch: 'main' } : {}),
        ...(variante === 'feature-xl-faseada' ? { fatias: 2 } : {}) }).thread));
  }
  for (const por of ['chave', 'flag', 'ciclo'] as const) {
    for (const gravada of [true, false]) {
      caso(casos, `thread: linha da worktree ${por} ${gravada ? 'gravada' : 'simulada'}`, () => linhaDaWorktree(por, gravada, por === 'ciclo' ? 'merge-branch' : null));
    }
  }
  caso(casos, 'thread: linha da worktree do ciclo sem variante', () => linhaDaWorktree('ciclo', false, null));
  const manifesto = exigirManifesto(repo).manifesto;
  const semBase = { ...thread, base: { branch: 'main', commit: '0000000' } } as Thread;
  const variantes: Array<[string, Thread, Record<string, unknown>]> = [
    ['na base com block', { ...thread, base: { ...thread.base, branch: 'main' } } as Thread, { push_direto_na_base: 'block' }],
    ['na base sem policy', { ...thread, base: { ...thread.base, branch: 'main' } } as Thread, {}],
    ['na base com off', { ...thread, base: { ...thread.base, branch: 'main' } } as Thread, { push_direto_na_base: 'off' }],
    ['na base com warn', { ...thread, base: { ...thread.base, branch: 'main' } } as Thread, { push_direto_na_base: 'warn' }],
    ['em outra branch', { ...thread, base: { ...thread.base, branch: 'feature' } } as Thread, {}],
    ['com HEAD destacado', { ...thread, base: { ...thread.base, branch: 'HEAD' } } as Thread, {}],
  ];
  for (const [nome, t, policies] of variantes) {
    for (const gravada of [true, false]) {
      caso(casos, `thread: aviso sem worktree ${nome} ${gravada ? 'gravada' : 'simulada'}`, () =>
        avisoDeThreadSemWorktree(t, { ...manifesto, policies: policies as never }, gravada));
    }
  }
  caso(casos, 'thread: aviso sem worktree sem commit', () => {
    const t = novaThread(exigirManifesto(repoComCommitVazio()), { nome: 'sem commit', modo: 'auto', dryRun: true }).thread;
    return [avisoDeThreadSemWorktree(t, manifesto, true), avisoDeThreadSemBase(t, true), avisoDeThreadSemBase(t, false),
      avisoDeThreadSemBase(semBase, true) ?? '<null>'].join('\n');
  });
  for (const motivo of ['pasta-existe', 'branch-existe', 'sem-commit'] as const) {
    for (const por of ['chave', 'ciclo'] as const) {
      caso(casos, `thread: worktree que falharia ${motivo} ${por}`, () =>
        avisoDeWorktreeQueFalharia({ motivo: motivo as never, dir: '/tmp/arvore', branch: 'ork/x', por }));
    }
  }
  caso(casos, 'thread: chave sem commit', () => `${avisoDeChaveSemCommit(true)}\n${avisoDeChaveSemCommit(false)}`);
  caso(casos, 'thread: aviso da worktree por origem', () => [
    avisoDaWorktree('sem-worktree', { thread, gravada: true }, manifesto),
    avisoDaWorktree('chave', { thread, gravada: true, worktreePor: null }, manifesto),
    avisoDaWorktree('chave', { thread, gravada: false, worktreePor: null }, manifesto),
    avisoDaWorktree('flag', { thread, gravada: true, worktreePor: 'flag' }, manifesto),
  ].map((l) => l ?? '<null>').join('\n'));
  caso(casos, 'thread: conducao por dono', () => {
    definirFusoDoDono(SP);
    try {
      return [
        conducao({ tipo: 'sessao', sessionId: '33333333-4444-5555-6666-777777777777' } as never, 'phase.run', '33333333-4444-5555-6666-777777777777'),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'verify', null),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'retry.run', null),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'baseline', null),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'fix.open', null),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'fix.reverify', null),
        conducao({ tipo: 'processo', pid: 4321 } as never, 'mcp.verify', null),
        conducao({ tipo: 'reserva', por: 'dono' } as never, 'handoff', null),
        conducao({ tipo: 'outro' } as never, 'handoff', null),
      ].map((c) => `${quemConduz(c)} || ${linhaDeConducao(c, { agora: T1 })}`).join('\n');
    } finally { definirFusoDoDono(SP); }
  });
  caso(casos, 'thread: aviso de RM no nome', () => `${avisoRoadmapSemAssociacao('rm-077 nova coisa')}\n${avisoRoadmapSemAssociacao('rm-077 x', 'RM-077') ?? '<null>'}`);
}

/** Repositorio sem commit nenhum (para a thread sem base). */
function repoComCommitVazio(): string {
  const dir = dirTemp('sem-commit', '<SEMCOMMIT>');
  exec('git', ['init', '-q', '-b', 'main'], dir);
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), fs.readFileSync(path.join(marcadores.find(([, m]) => m === '<REPO>')![0], 'orkastery.yaml')));
  return dir;
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

function casosDaPhase(casos: Record<string, string>): void {
  const repo = repoComCommit('phase', '<REPO>');
  const amb = ambiente('phase');
  ork(repo, amb, false, 'init', '--name', 'loc', '--abbrev', 'loc');
  ork(repo, amb, true, 'thread', 'new', 'Minha fatia', '--modo', 'auto');
  const id = 'loc-minhafatia';

  caso(casos, 'phase cli: run em simulacao', () => texto(ork(repo, amb, true, 'phase', 'run', id, 'GOAL', '--prompt', 'objetivo de teste', '--dry-run')));
  caso(casos, 'phase cli: run', () => texto(ork(repo, amb, true, 'phase', 'run', id, 'GOAL', '--prompt', 'objetivo de teste')));
  caso(casos, 'phase cli: run repetido', () => texto(ork(repo, amb, true, 'phase', 'run', id, 'GOAL', '--prompt', 'objetivo de teste')));
  caso(casos, 'phase cli: status depois do despacho', () => texto(ork(repo, amb, true, 'thread', 'status', id)));
  caso(casos, 'phase cli: list', () => texto(ork(repo, amb, true, 'phase', 'list', id)));
  caso(casos, 'phase cli: run sem prompt', () => texto(ork(repo, amb, true, 'phase', 'run', id, 'GOAL')));
  caso(casos, 'phase cli: run com fase invalida', () => texto(ork(repo, amb, true, 'phase', 'run', id, 'NADA', '--prompt', 'x')));
  caso(casos, 'phase cli: list sem id', () => texto(ork(repo, amb, true, 'phase', 'list')));
  caso(casos, 'phase cli: list de thread que nao existe', () => texto(ork(repo, amb, true, 'phase', 'list', 'loc-nada')));
  caso(casos, 'phase cli: subcomando desconhecido', () => texto(ork(repo, amb, true, 'phase', 'qualquer')));

  // Ledger com todos os campos que a tabela le, em horario fixo.
  caso(casos, 'phase: tabela do ledger com todos os campos', () => {
    const r2 = repoComCommit('phase-ledger', '<LEDGER>');
    ork(r2, amb, false, 'init', '--name', 'led', '--abbrev', 'led');
    const t = novaThread(exigirManifesto(r2), { nome: 'Ledger', modo: 'auto' }).thread;
    const ledger = path.join(dirThread(r2, t.id), 'ledger.jsonl');
    const eventos: Record<string, unknown>[] = [
      { tipo: 'phase_dispatch', fase: 'GO', slug: 'led-ledger-full', sessionId: '44444444-5555-6666-7777-888888888888', model: 'opus', effort: 'high' },
      { tipo: 'phase_dispatch', fase: 'GO', model: 'sonnet' },
      { tipo: 'autonomous_decision', fase: 'GO', decisao: 'segue sem pausa', previstaSobre: 'plano', pedido: { id: 'abcdef0123456789' } },
      { tipo: 'phase_dispatch_verified', fase: 'GO', encontrada: false },
      { tipo: 'gate_blocked', fase: 'CHECK', motivo: 'claims.failed', claim: 'C3', veredito: 'REPROVADO' },
      { tipo: 'gate_next', fonte: 'estimated', ocupacao: null, slugSugerido: 'led-ledger-full-r2' },
      { tipo: 'gate_next', fonte: 'runtime_reported', ocupacao: 0.42 },
      { tipo: 'lease_acquired', lease: 'main-tree', acao: 'esperar-janela', playbook: 'mesma-sessao', pedido: 'P7' },
      { tipo: 'fix_opened', rodada: 2, cobertura: 'parcial', liberaEm: T1, tentativa: 1, limite: 3 },
      { tipo: 'ship_done', mergeSha: 'a'.repeat(40), shaRemoto: 'b'.repeat(40), pushVerificado: true, autorizadoPor: 'dono' },
      { tipo: 'ship_blocked', pushVerificado: false, sobre: 'push', estado: 'pendente', de: 'GO', para: 'CHECK', dryRun: true },
      { tipo: 'worktree_created', dir: '/tmp/arvore', branch: 'ork/led-ledger-full' },
      { tipo: 'handoff_exported', inline: 3, pointers: 2, summaries: 1, location: 'docs/x.md#y' },
      { tipo: 'phase_dispatch_failed', erro: 'runtime falhou SIMULADO', detalhe: 'detalhe longo SIMULADO em 2025-09-19T18:16:00.000Z' },
      { tipo: 'setup_configured', modo: 'auto' },
    ];
    fs.writeFileSync(ledger, eventos.map((e, i) => JSON.stringify({ ts: new Date(Date.parse(T0) + i * 1000).toISOString(), thread: t.id, ...e }))
      .join('\n') + '\n');
    definirFusoDoDono(SP);
    try { return tabelaDoLedger(r2, t.id); } finally { definirFusoDoDono(SP); }
  });
  caso(casos, 'phase: tabela de ledger vazio', () => {
    const r3 = repoComCommit('phase-vazio', '<VAZIO>');
    ork(r3, amb, false, 'init', '--name', 'vaz', '--abbrev', 'vaz');
    const t = novaThread(exigirManifesto(r3), { nome: 'Vazio', modo: 'auto' }).thread;
    fs.writeFileSync(path.join(dirThread(r3, t.id), 'ledger.jsonl'), '');
    return tabelaDoLedger(r3, t.id);
  });
  caso(casos, 'phase: slug descrito', () =>
    ['loc-minhafatia-full', 'loc-minhafatia-full-2', 'nao-e-slug'].map(descreverSlug).join('\n'));
  caso(casos, 'phase: pedido repetido', () => {
    definirFusoDoDono(SP);
    try {
      return textoDoPedidoRepetido('loc-x', conducao({ tipo: 'sessao', sessionId: '55555555-6666-7777-8888-999999999999' } as never,
        'phase.run', '55555555-6666-7777-8888-999999999999'), { agora: T1 });
    } finally { definirFusoDoDono(SP); }
  });
  caso(casos, 'phase: linhas de aviso de policy', () => linhasDeAviso([
    { policy: 'custo', severidade: 'warn', motivo: 'policy.violation', detalhe: 'detalhe SIMULADO', correcao: 'correcao SIMULADA' } as never,
    { policy: 'outra', severidade: 'block', motivo: 'policy.violation', detalhe: 'bloqueio', correcao: 'x' } as never,
  ]).join('\n'));
  caso(casos, 'phase cli: run bloqueado por policy de custo', () =>
    texto(orkComEnv(repo, amb, true, { ANTHROPIC_BASE_URL: 'https://exemplo.invalid' }, 'phase', 'run', id, 'GOAL', '--prompt', 'outro objetivo')));
}

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

function casosDaAjuda(casos: Record<string, string>): void {
  const repo = repoComCommit('ajuda', '<REPO>');
  const amb = ambiente('ajuda');
  const versao = (s: string) => s.replace(/^ork \d+\.\d+\.\d+(?:-[\w.]+)?,/, 'ork <VERSAO>,').replace(/\nork \d+\.\d+\.\d+(?:-[\w.]+)?,/, '\nork <VERSAO>,');
  caso(casos, 'ajuda cli: --help', () => versao(texto(ork(repo, amb, false, '--help'))));
  caso(casos, 'ajuda cli: help', () => versao(texto(ork(repo, amb, false, 'help'))));
  caso(casos, 'ajuda cli: sem comando', () => versao(texto(ork(repo, amb, false))));
  caso(casos, 'ajuda cli: thread --help', () => versao(texto(ork(repo, amb, false, 'thread', '--help'))));
  caso(casos, 'ajuda cli: comando desconhecido', () => versao(texto(ork(repo, amb, false, 'nada-disso'))));
}

/** Todos os casos, em ordem estavel. */
export function gerarCasos(): Record<string, string> {
  const casos: Record<string, string> = {};
  const umask = process.umask(0o022);
  // O fuso do dono fica fixo para os casos chamados no processo (o CI roda em UTC).
  definirFusoDoDono(SP);
  try {
    casosDoDoctor(casos);
    casosDoOnboarding(casos);
    casosDaThread(casos);
    casosDaPhase(casos);
    casosDaAjuda(casos);
  } finally {
    definirFusoDoDono(undefined);
    process.umask(umask);
    limparTudo();
  }
  return casos;
}
