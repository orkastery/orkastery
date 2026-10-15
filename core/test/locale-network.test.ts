/**
 * RM-061, fatia F3b: `ork network status|entrar|sair|publicar` em ingles, com a forja falsa da RM-053 (tirada do proprio
 * teste da rede). O texto, as lacunas e as recusas saem pelo catalogo; o detalhe da lacuna vai ao `--json` em pt-BR e o
 * texto o remonta; a casa, a forja, o login e o motivo tipado saem iguais. A F3c traduz `ork network roadmap`, mas
 * preserva as tres linhas que os hosts e a prova de ativacao leem. Os nomes comecam por "locale en F3b network:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { comLocale, cobreLocale } from '../src/locale';
import { CLI, EN, linhasEmPortugues, PT } from './locale-apoio';
import { exec, noPath } from '../src/util';
import { init } from '../src/init';
import { CONTRATO_PANORAMA_DA_REDE, PanoramaDaRede, textoDoPanoramaDaRede } from '../src/network-roadmap';

/** A forja falsa da RM-053, tirada do teste da rede (a mesma fonte, sem copia que envelhece). */
function scriptDaForjaFalsa(): string {
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../test/rede.test.ts'), 'utf8');
  const m = /const SCRIPT_FALSO = `([\s\S]*?)`;\n/.exec(fonte);
  if (!m) throw new Error('forja falsa nao achada em rede.test.ts');
  return m[1].replace('${process.execPath}', process.execPath).replace(/\\\\/g, '\\');
}

interface Rede { raiz: string; rodar: (casa: 'a' | 'b', locale: Record<string, string>, ...args: string[]) => { status: number | null; stdout: string; stderr: string }; limpar: () => void }

test('locale en F3c network: o render puro preserva o preambulo contratual e traduz lacunas', () => {
  const panorama: PanoramaDaRede = { contrato: CONTRATO_PANORAMA_DA_REDE, consultadoEm: '2026-10-12T15:30:00.000Z',
    maquina: 'pc-a', pedido: null, limiarSemBatidaMin: 30, fuso: 'America/Sao_Paulo', projetos: [], rede: null,
    naoConsultado: ['registro de projetos desta máquina (RM-052): ausente'],
    lacunas: [{ tipo: 'rede.sem-projeto', parte: 'rede', detalhe: 'nenhum projeto conhecido nesta máquina',
      correcao: 'peça o projeto por --projeto' }] };
  const pt = comLocale('pt-BR', () => textoDoPanoramaDaRede(panorama));
  const en = comLocale('en', () => textoDoPanoramaDaRede(panorama));
  assert.deepEqual(en.split('\n').slice(0, 3), pt.split('\n').slice(0, 3));
  assert.match(en, /\n• this machine's project registry was not read because it is absent\n/);
  assert.match(en, /\nQuery gaps\n• rede\.sem-projeto: no project source was known to this query\. What to do: register the clone/);
  assert.deepEqual(linhasEmPortugues(en.split('\n').slice(3).join('\n')), []);
  assert.match(pt, /\nLacunas da consulta\n• rede\.sem-projeto: nenhum projeto conhecido nesta máquina\. O que fazer: peça o projeto por --projeto\./);
});

function rede(nome: string, comForja = true): Rede {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-network-${nome}-`)));
  const bin = path.join(raiz, 'bin'), ferramentas = path.join(raiz, 'ferramentas'), forja = path.join(raiz, 'forja'), fora = path.join(raiz, 'fora');
  for (const d of [bin, ferramentas, forja, fora, path.join(raiz, 'casa-a'), path.join(raiz, 'casa-b')]) fs.mkdirSync(d, { recursive: true });
  const git = noPath('git');
  if (!git) throw new Error('git fora do PATH');
  fs.symlinkSync(git, path.join(ferramentas, 'git'));
  fs.symlinkSync(process.execPath, path.join(ferramentas, 'node'));
  if (comForja) for (const cli of ['gh', 'glab', 'claude', 'codex', 'openclaw']) fs.writeFileSync(path.join(bin, cli), scriptDaForjaFalsa(), { mode: 0o755 });
  return {
    raiz,
    rodar: (casa, locale, ...args) => {
      const home = path.join(raiz, `casa-${casa}`);
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: fora, encoding: 'utf8', timeout: 120000,
        env: { HOME: home, ORK_USUARIO_DIR: path.join(home, '.orkastery'), PATH: `${bin}:${ferramentas}`, GLAB_FAKE_DIR: forja,
          ORK_BINARIOS_EXTRA: '', ORK_MAQUINA: '', ORK_REDE_PUBLICAR: '0', ORK_FABRICA_PUBLICAR: '0', TZ: 'America/New_York', ...locale } });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true }),
  };
}

test('locale en F3b network: entrar, status, publicar e sair saem em ingles, e o --json e igual', () => {
  const r = rede('ciclo');
  try {
    const a = r.rodar('a', EN, 'network', 'entrar', '--maquina', 'pc-a');
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /^Network: pc-a joined the Orkastery Network of pessoa-teste \(github: github\.com\/pessoa-teste\/orkastery-network, private, created now\)\.\n {2}First snapshot published \([0-9a-f]{7}\)\. From now on, this machine publishes by itself on the pulse heartbeat\n {2}and when it creates a thread, dispatches a phase, delivers and closes\. From any machine of this person: `ork network status`\n$/);
    const b = r.rodar('b', EN, 'network', 'entrar', '--maquina', 'pc-b');
    assert.match(b.stdout, /^Network: pc-b joined the Orkastery Network of pessoa-teste \(github: github\.com\/pessoa-teste\/orkastery-network, private\)\.\n/);
    const st = r.rodar('b', EN, 'network');
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /^Orkastery Network of pessoa-teste · github: github\.com\/pessoa-teste\/orkastery-network · read now\nQueried: network repository \([0-9a-f]{7}\)\.\nNot queried: roadmap, reservations, threads\. The roadmap of a project comes from `ork roadmap status` in it\.\n\n/);
    assert.match(st.stdout, /\npc-b \(this machine\) · network · heartbeat \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(less than 1 min ago\)\n/);
    assert.match(st.stdout, /\nThis machine \(pc-b\) is a member\.\nGaps: none\.\nTimes in America\/New_York, E[SD]T\.\n$/);
    assert.deepEqual(linhasEmPortugues(st.stdout.replace(/hostname \S+/g, 'hostname X')), []);
    const igual = r.rodar('a', EN, 'network', 'publicar');
    assert.match(igual.stdout, /^Network: the snapshot of pc-a matches the last one published to github\.com\/pessoa-teste\/orkastery-network; nothing to send \(use `--forcar` to publish anyway\)\.\n$/);
    assert.match(r.rodar('a', EN, 'network', 'publicar', '--forcar').stdout, /^Network: pc-a published the snapshot to github\.com\/pessoa-teste\/orkastery-network \([0-9a-f]{7}, 1 attempt\(s\)\)\.\n$/);
    const sai = r.rodar('b', EN, 'network', 'sair');
    assert.match(sai.stdout, /^Network: pc-b left; nothing else is published from here\. Snapshot removed from github\.com\/pessoa-teste\/orkastery-network \([0-9a-f]{7}\)\.\n$/);
    assert.equal(r.rodar('b', EN, 'network', 'sair').stdout,
      'Network: pc-b left; nothing else is published from here. There was no snapshot of this machine in github.com/pessoa-teste/orkastery-network.\n');
    const fora = r.rodar('b', EN, 'network', 'publicar');
    assert.equal(fora.status, 1);
    assert.equal(fora.stderr, 'error: rede.fora: this machine is not in the network; `ork network entrar`\n');
    // O --json e o mesmo nas duas linguas.
    const semVariavel = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>').replace(/"idadeMs": \d+/g, '"idadeMs": 0');
    assert.equal(semVariavel(r.rodar('a', EN, 'network', 'status', '--json').stdout), semVariavel(r.rodar('a', PT, 'network', 'status', '--json').stdout));
  } finally { r.limpar(); }
});

test('locale en F3b network: sem forja, as lacunas saem em ingles e o --json leva o detalhe em pt-BR', () => {
  const r = rede('sem-forja', false);
  try {
    const en = r.rodar('a', EN, 'network', 'status', '--sem-remoto');
    assert.equal(en.status, 0, en.stderr);
    assert.match(en.stdout, /^Orkastery Network · no home: no forge with a login on this machine\nQueried: nothing \(see the gaps\)\.\n/);
    assert.match(en.stdout, /\nNo machine read\. That does not mean there are no machines: see the gaps\.\n\nThis machine \(\S+\) is not in the network: `ork network entrar`\.\nGaps \(\d+\), what was not read:\n {2}• rede\.sem-leitura: no network and no known home on this machine: run without `--sem-remoto`\n/);
    assert.deepEqual(linhasEmPortugues(en.stdout), []);
    const json = JSON.parse(r.rodar('a', EN, 'network', 'status', '--sem-remoto', '--json').stdout) as { lacunas: { detalhe: string }[] };
    assert.equal(json.lacunas[0].detalhe, 'sem rede e sem casa conhecida nesta maquina: rode sem --sem-remoto');
    assert.equal(r.rodar('a', EN, 'network', 'voar').stderr.split('\n')[0], 'unknown subcommand: network voar');
    assert.match(r.rodar('a', EN, 'network', 'entrar', '--forja', 'bitbucket').stderr, /^usage: ork network \[status\] /);
    const semCli = r.rodar('a', EN, 'network', 'entrar', '--maquina', 'pc-a');
    assert.equal(semCli.stderr, 'error: rede.sem-forja: no forge CLI (gh or glab) on this machine\n');
  } finally { r.limpar(); }
});

test('locale en F3c network: network roadmap traduz o texto humano e preserva o preambulo dos hosts e o JSON', () => {
  assert.ok(cobreLocale(['network', 'roadmap'], {}));
  assert.ok(cobreLocale(['network'], {}));
  for (const sub of ['status', 'entrar', 'sair', 'publicar']) assert.ok(cobreLocale(['network', sub], {}), sub);
  const r = rede('roadmap');
  try {
    // O panorama le o projeto do cwd: com um projeto nele, saem tambem os blocos por projeto (threads, reservas, fontes
    // e lacunas), onde mora a maior parte do texto humano. Sem projeto, so o preambulo e as lacunas da consulta.
    const projeto = path.join(r.raiz, 'fora');
    exec('git', ['init', '-q', '-b', 'main'], projeto);
    init(projeto, { nome: 'loja', abbrev: 'loj' });
    const pt = r.rodar('a', PT, 'network', 'roadmap', '--sem-remoto');
    const en = r.rodar('a', EN, 'network', 'roadmap', '--sem-remoto');
    assert.equal(en.status, 0, en.stderr);
    assert.equal(en.status, pt.status);
    assert.deepEqual(en.stdout.split('\n').slice(0, 3), pt.stdout.split('\n').slice(0, 3), 'o preambulo contratual e byte a byte');
    assert.match(en.stdout.split('\n')[1], /^Consultado: loja \(clone em /);
    for (const secao of ['Threads by machine', 'Reservations', 'Sources', 'Gaps']) {
      assert.match(en.stdout, new RegExp(`\\n${secao}\\n`), secao);
    }
    assert.match(pt.stdout, /\nThreads por máquina\n[\s\S]*\nReservas\n[\s\S]*\nFontes\n[\s\S]*\nLacunas\n/);
    // A parte da lacuna sai em ingles no detalhe (o identificador fica no tipo e no --json).
    assert.match(en.stdout, /\n• reservas\.sem-leitura \([^)]*\): the reservations source was not read for /);
    assert.match(en.stdout, /\n• fabrica\.sem-leitura \([^)]*\): the factory source was not read for /);
    assert.doesNotMatch(en.stdout, /the (?:projeto|reservas|fabrica|estado-local|forja|registro|rede) source/);
    assert.doesNotMatch(en.stdout, /\n(?:Rede por pessoa|Lacunas da consulta|Threads por máquina|Reservas|Fontes|Lacunas)\n/);
    const normalizar = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');
    assert.equal(normalizar(r.rodar('a', EN, 'network', 'roadmap', '--sem-remoto', '--json').stdout),
      normalizar(r.rodar('a', PT, 'network', 'roadmap', '--sem-remoto', '--json').stdout));
    assert.equal(r.rodar('a', EN, 'network', 'roadmap', 'x').stderr,
      'usage: ork network roadmap [--projeto <path|github:owner/repo|gitlab:group/repo|name>] [--json] [--sem-remoto]\n');
  } finally { r.limpar(); }
});

test('locale en F3b network: a lacuna que nasce de erro sai em ingles, e o --json a leva em pt-BR (GO-FIX 1)', () => {
  const r = rede('erro');
  try {
    assert.equal(r.rodar('a', EN, 'network', 'entrar', '--maquina', 'pc-a').status, 0);
    const comErro = { ...EN, GLAB_FAKE_ERRO: '1' };
    const en = r.rodar('a', comErro, 'network', 'status');
    assert.match(en.stdout, /\n {2}• rede\.sem-leitura: github\.com\/pessoa-teste\/orkastery-network: gh api \S+ failed: /);
    assert.deepEqual(linhasEmPortugues(en.stdout.replace(/hostname \S+/g, 'hostname X')), []);
    const json = JSON.parse(r.rodar('a', comErro, 'network', 'status', '--json').stdout) as { lacunas: { tipo: string; detalhe: string }[] };
    assert.ok(json.lacunas.some((l) => l.tipo === 'rede.sem-leitura' && / falhou: /.test(l.detalhe)), JSON.stringify(json.lacunas));
  } finally { r.limpar(); }
});
