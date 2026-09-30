/**
 * RM-052 (T2): o projeto-alvo pelo CLI real.
 *
 * `--projeto` vence `ORK_PROJETO`, que vence o cwd; sem os dois o terminal continua no cwd. Host sem
 * cwd (`ORK_PROJETO_EXPLICITO=1`) com mais de um projeto conhecido devolve a escolha na saida 4.
 * `ork init`, `ork thread new` e `ork fabrica entrar` alimentam o registro; `ork projetos` lista.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { CONTRATO_PROJETOS, registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function projeto(nome: string, abbrev: string, comRemoto = false): ProjetoDeTeste {
  const p = projetoTemporario(`projeto-alvo-cli-${nome}`, comRemoto);
  init(p.dir, { nome, abbrev, force: true });
  p.carregado = exigirManifesto(p.dir);
  return p;
}

/** O CLI real, com o registro do teste e sem alvo herdado do shell de quem roda a suite. */
function ork(usuario: string, cwd: string, args: string[], env: Record<string, string> = {}) {
  const base = { ...process.env };
  delete base.ORK_PROJETO; delete base.ORK_PROJETO_EXPLICITO;
  return spawnSync(process.execPath, [ORK, ...args], {
    cwd, encoding: 'utf8', timeout: 60000, env: { ...base, ORK_USUARIO_DIR: usuario, ...env },
  });
}

function projetoDoStatus(r: ReturnType<typeof ork>): string {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).projeto;
}

test('precedencia no CLI: --projeto (em qualquer posicao) > ORK_PROJETO > cwd; sem os dois o terminal segue o cwd', () => {
  const usuario = dirTemporario('projeto-alvo-cli-usuario');
  const a = projeto('orkastery', 'ork'), b = projeto('workspace', 'wor');
  try {
    const anterior = process.env.ORK_USUARIO_DIR;
    process.env.ORK_USUARIO_DIR = usuario;
    try { registrarProjeto(a.dir, 'init'); registrarProjeto(b.dir, 'init'); } finally { process.env.ORK_USUARIO_DIR = anterior; }

    assert.equal(projetoDoStatus(ork(usuario, b.dir, ['roadmap', 'status', '--json'])), 'workspace', 'terminal sem opcao: cwd');
    assert.equal(projetoDoStatus(ork(usuario, a.dir, ['roadmap', 'status', '--json'])), 'orkastery');
    assert.equal(projetoDoStatus(ork(usuario, b.dir, ['roadmap', 'status', '--json'], { ORK_PROJETO: 'orkastery' })), 'orkastery');
    assert.equal(projetoDoStatus(ork(usuario, b.dir, ['--projeto', 'orkastery', 'roadmap', 'status', '--json'],
      { ORK_PROJETO: 'workspace' })), 'orkastery', '--projeto vence ORK_PROJETO');
    assert.equal(projetoDoStatus(ork(usuario, b.dir, ['roadmap', 'status', '--projeto', 'ork', '--json'])), 'orkastery', 'depois do comando, por abbrev');
    assert.equal(projetoDoStatus(ork(usuario, b.dir, ['roadmap', 'status', '--json', `--projeto=${a.dir}`])), 'orkastery', 'por caminho, com =');
    assert.equal(projetoDoStatus(ork(usuario, '/', ['roadmap', 'status', '--json', '--projeto', 'workspace'])), 'workspace', 'fora de qualquer projeto');

    const duas = ork(usuario, b.dir, ['--projeto', 'orkastery', 'roadmap', 'status', '--projeto', 'workspace']);
    assert.equal(duas.status, 1);
    assert.match(duas.stderr, /--projeto <nome\|caminho> aparece uma vez só/);

    const maestro = ork(usuario, b.dir, ['maestro', '--json', '--projeto', 'orkastery']);
    assert.equal(maestro.status, 0, maestro.stderr);
    const snapshot = JSON.parse(maestro.stdout);
    assert.equal(snapshot.project.name, 'orkastery', 'o maestro le o projeto pedido, nao o do cwd');
    assert.equal(snapshot.project.origin, 'selection');
  } finally { a.limpar(); b.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('nome desconhecido e host sem cwd com dois projetos recusam na saida 4, com candidatos em texto e em JSON', () => {
  const usuario = dirTemporario('projeto-alvo-cli-usuario');
  const a = projeto('orkastery', 'ork'), gateway = projeto('workspace', 'wor');
  const vazio = dirTemporario('projeto-alvo-cli-vazio');
  try {
    const anterior = process.env.ORK_USUARIO_DIR;
    process.env.ORK_USUARIO_DIR = usuario;
    try { registrarProjeto(a.dir, 'fabrica entrar'); } finally { process.env.ORK_USUARIO_DIR = anterior; }

    const desconhecido = ork(usuario, gateway.dir, ['--projeto', 'gama', 'board', 'plan']);
    assert.equal(desconhecido.status, 4, desconhecido.stdout + desconhecido.stderr);
    assert.match(desconhecido.stdout, /^projeto\.desconhecido: "gama" não está no registro/);
    assert.match(desconhecido.stdout, /• orkastery \(ork\)/);

    const host = { ORK_PROJETO_EXPLICITO: '1' };
    const escolha = ork(usuario, gateway.dir, ['board', 'plan', '--json'], host);
    assert.equal(escolha.status, 4);
    const recusa = JSON.parse(escolha.stdout);
    assert.equal(recusa.erro, 'projeto.escolha');
    assert.deepEqual(recusa.candidatos.map((c: { nome: string }) => c.nome), ['orkastery', 'workspace']);
    assert.match(recusa.correcao, /parâmetro `projeto` da tool/);
    const texto = ork(usuario, gateway.dir, ['roadmap', 'status'], host);
    assert.equal(texto.status, 4);
    assert.ok(!/Roadmap do Workspace/.test(texto.stdout), 'o host nunca relata o projeto do cwd como o pedido');

    assert.equal(projetoDoStatus(ork(usuario, gateway.dir, ['roadmap', 'status', '--json', '--projeto', 'orkastery'], host)), 'orkastery');
    // F1 do CHECK (D4): no host, caminho nao entra por --projeto, venha da tool que vier.
    const porCaminho = ork(usuario, gateway.dir, ['roadmap', 'status', '--projeto', a.dir], host);
    assert.equal(porCaminho.status, 4);
    assert.match(porCaminho.stdout, /^projeto\.desconhecido: no host o projeto vem pelo nome registrado/);
    assert.equal(projetoDoStatus(ork(usuario, vazio, ['roadmap', 'status', '--json'], host)), 'orkastery', 'um so candidato vale');
    const nenhum = ork(dirTemporario('projeto-alvo-cli-sem-registro'), vazio, ['board'], host);
    assert.equal(nenhum.status, 4);
    assert.match(nenhum.stdout, /^projeto\.nenhum:/);
    // Comandos sem projeto nao sao barrados pela resolucao.
    assert.equal(ork(usuario, gateway.dir, ['--version'], host).status, 0);
    assert.equal(ork(usuario, gateway.dir, ['ciclos'], host).status, 0);
    // RM-054: o `--projeto` do `network` e dele (github:dono/repo); a opcao chega intacta e nada e resolvido aqui.
    for (const args of [['network', 'roadmap', '--projeto', 'github:orkastery/orkastery'], ['--projeto=github:o/r', 'network', 'roadmap']]) {
      const proprio = ork(usuario, gateway.dir, args, host);
      assert.notEqual(proprio.status, 4, `${args.join(' ')}: a resolucao do projeto nao pode recusar ${proprio.stderr.slice(0, 200)}`);
      assert.doesNotMatch(proprio.stderr, /projeto\.(escolha|nenhum|desconhecido)/);
      assert.doesNotMatch(proprio.stderr, /^comando desconhecido: network/);
    }
  } finally { a.limpar(); gateway.limpar(); fs.rmSync(vazio, { recursive: true, force: true }); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('init, thread new e fabrica entrar registram; ork projetos lista, registra por subdiretorio e esquece', () => {
  const usuario = dirTemporario('projeto-alvo-cli-usuario');
  const novo = dirTemporario('projeto-alvo-cli-novo');
  const a = projeto('orkastery', 'ork', true);
  try {
    exec('git', ['init', '-b', 'main'], novo);
    const iniciado = ork(usuario, novo, ['init', '--name', 'novo', '--abbrev', 'nov']);
    assert.equal(iniciado.status, 0, iniciado.stderr);
    assert.equal(iniciado.stderr, '', 'registro sem aviso');
    assert.equal(ork(usuario, novo, ['init', '--projeto', 'novo']).status, 1, 'init nao aceita --projeto');

    const thread = ork(usuario, a.dir, ['thread', 'new', 'Registro', '--modo', 'auto']);
    assert.equal(thread.status, 0, thread.stderr);
    const listados = JSON.parse(ork(usuario, '/', ['projetos', '--json']).stdout);
    assert.equal(listados.contrato, CONTRATO_PROJETOS);
    assert.deepEqual(listados.projetos.map((p: { nome: string; fonte: string; presente: boolean }) => [p.nome, p.fonte, p.presente]),
      [['novo', 'init', true], ['orkastery', 'thread new', true]]);

    const entrou = ork(usuario, a.dir, ['fabrica', 'entrar', '--maquina', 'pc-teste']);
    assert.equal(entrou.status, 0, entrou.stderr);
    const depois = JSON.parse(ork(usuario, '/', ['projetos', '--json']).stdout).projetos
      .find((p: { nome: string }) => p.nome === 'orkastery');
    assert.equal(depois.fonte, 'fabrica entrar');
    assert.equal(depois.remoto, a.remoto, 'o remoto da fabrica vai junto, sem credencial');

    fs.mkdirSync(path.join(novo, 'docs'), { recursive: true });
    const registrou = ork(usuario, '/', ['projetos', 'registrar', path.join(novo, 'docs')]);
    assert.equal(registrou.status, 0, registrou.stderr);
    assert.match(registrou.stdout, /^Projeto novo \(nov\) registrado: /);
    const texto = ork(usuario, '/', ['projetos']);
    assert.match(texto.stdout, /NOME\s+ABBREV\s+RAIZ\s+REMOTO\s+NO DISCO\s+ATUALIZADO/);
    assert.match(texto.stdout, /Use --projeto <nome> em qualquer comando/);

    const esqueceu = ork(usuario, '/', ['projetos', 'esquecer', 'novo']);
    assert.equal(esqueceu.status, 0, esqueceu.stderr);
    assert.match(esqueceu.stdout, /nada no disco foi apagado/);
    assert.ok(fs.existsSync(path.join(novo, 'orkastery.yaml')));
    assert.deepEqual(JSON.parse(ork(usuario, '/', ['projetos', '--json']).stdout).projetos.map((p: { nome: string }) => p.nome), ['orkastery']);
    assert.equal(ork(usuario, '/', ['projetos', 'esquecer', 'novo']).status, 4, 'esquecer o que nao esta registrado recusa tipado');
  } finally { a.limpar(); fs.rmSync(novo, { recursive: true, force: true }); fs.rmSync(usuario, { recursive: true, force: true }); }
});
