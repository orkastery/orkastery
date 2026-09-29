/**
 * RM-052 (T1): o registro de projetos desta maquina e a resolucao do projeto-alvo.
 *
 * O incidente de 29/09 nasceu de o nucleo resolver o projeto pelo cwd do gateway. Aqui se prova a
 * peca que o substitui: registro sem segredo, resolucao que nunca chuta (desconhecido e ambiguo
 * recusam com candidatos) e a precedencia `--projeto` > `ORK_PROJETO` > host sem cwd > cwd.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { init } from '../src/init';
import { exigirManifesto, diretorioDoProjeto } from '../src/manifest';
import { exec } from '../src/util';
import {
  CONTRATO_PROJETOS, ENV_PROJETO, ENV_PROJETO_EXPLICITO, ErroDeProjeto, caminhoDoRegistro, consultaDoProjeto,
  esquecerProjeto, fixarProjetoAlvo, linhasDaConsulta, listarProjetos, lerRegistroDeProjetos, raizParaExibir,
  registrarProjeto, registrarProjetoEmSilencio, resolverProjetoAlvo,
} from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

/** Um projeto de teste com nome e abbrev proprios (o apoio sempre nasce "orkastery"). */
function projeto(nome: string, abbrev: string): ProjetoDeTeste {
  const p = projetoTemporario(`projeto-alvo-${nome}`);
  init(p.dir, { nome, abbrev, force: true });
  p.carregado = exigirManifesto(p.dir);
  return p;
}

/** Cada teste com o seu registro: nada vaza entre testes nem para o home de quem roda. */
function comRegistroProprio(corpo: () => void): void {
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = dirTemporario('projeto-alvo-usuario');
  try { corpo(); } finally {
    fs.rmSync(process.env.ORK_USUARIO_DIR, { recursive: true, force: true });
    process.env.ORK_USUARIO_DIR = anterior;
    fixarProjetoAlvo(null);
  }
}

function recusa(fn: () => unknown, codigo: string): ErroDeProjeto {
  try { fn(); } catch (e) {
    assert.ok(e instanceof ErroDeProjeto, `esperava ErroDeProjeto, veio ${(e as Error).message}`);
    assert.equal(e.codigo, codigo, e.texto);
    return e;
  }
  assert.fail(`esperava a recusa ${codigo}`);
}

test('registro ork.projetos/v1: raiz canonica, remoto sem credencial, datas, 0600 e reentrada idempotente', () => {
  comRegistroProprio(() => {
    const p = projeto('alfa', 'alf');
    try {
      exec('git', ['remote', 'add', 'origin', 'https://usuario:ghp_' + 'a'.repeat(36) + '@github.com/exemplo/alfa.git'], p.dir);
      const primeiro = registrarProjeto(p.dir, 'init', { quando: '2026-09-29T10:00:00.000Z' });
      assert.equal(primeiro.nome, 'alfa');
      assert.equal(primeiro.abbrev, 'alf');
      assert.equal(primeiro.raiz, fs.realpathSync(p.dir));
      assert.equal(primeiro.fonte, 'init');
      assert.ok(primeiro.remoto && !primeiro.remoto.includes('ghp_'), `remoto redigido: ${primeiro.remoto}`);
      assert.match(primeiro.remoto!, /github\.com\/exemplo\/alfa\.git$/);

      const bruto = fs.readFileSync(caminhoDoRegistro(), 'utf8');
      assert.equal(JSON.parse(bruto).contrato, CONTRATO_PROJETOS);
      assert.ok(!bruto.includes('ghp_'), 'o arquivo nunca carrega o token');
      assert.equal(fs.statSync(caminhoDoRegistro()).mode & 0o777, 0o600);

      const segundo = registrarProjeto(p.dir, 'thread new', { quando: '2026-09-29T11:00:00.000Z' });
      assert.equal(segundo.registradoEm, '2026-09-29T10:00:00.000Z', 'registradoEm preservado');
      assert.equal(segundo.atualizadoEm, '2026-09-29T11:00:00.000Z');
      assert.equal(lerRegistroDeProjetos().projetos.length, 1, 'mesma raiz nao duplica');
      assert.deepEqual(Object.keys(lerRegistroDeProjetos().projetos[0]).sort(),
        ['abbrev', 'atualizadoEm', 'fonte', 'nome', 'raiz', 'registradoEm', 'remoto']);
    } finally { p.limpar(); }
  });
});

test('registro recusa entrada com segredo e o aviso silencioso nunca derruba quem chama', () => {
  comRegistroProprio(() => {
    const p = projeto('ghp_' + 'b'.repeat(36), 'sec');
    try {
      assert.throws(() => registrarProjeto(p.dir, 'init'), /parece carregar segredo/);
      assert.equal(fs.existsSync(caminhoDoRegistro()), false);
      const aviso = registrarProjetoEmSilencio(p.dir, 'thread new');
      assert.match(aviso ?? '', /^aviso: projeto não registrado/);
      assert.ok(!(aviso ?? '').includes('ghp_' + 'b'.repeat(36)), 'o aviso nao repete o segredo');
    } finally { p.limpar(); }
  });
});

test('registro de worktree grava a arvore principal; raiz sem manifesto fica ausente e sai da resolucao', () => {
  comRegistroProprio(() => {
    const p = projeto('beta', 'bet');
    const wt = dirTemporario('projeto-alvo-wt');
    fs.rmSync(wt, { recursive: true, force: true });
    try {
      exec('git', ['add', '-A'], p.dir); exec('git', ['commit', '-m', 'manifesto'], p.dir);
      assert.ok(exec('git', ['worktree', 'add', '-b', 'ork/teste', wt], p.dir).ok);
      assert.equal(registrarProjeto(wt, 'thread new').raiz, fs.realpathSync(p.dir));
      assert.deepEqual(listarProjetos().map((x) => [x.nome, x.presente]), [['beta', true]]);
      fs.renameSync(path.join(p.dir, 'orkastery.yaml'), path.join(p.dir, 'orkastery.yaml.bak'));
      assert.deepEqual(listarProjetos().map((x) => [x.nome, x.presente]), [['beta', false]]);
      const e = recusa(() => resolverProjetoAlvo({ opcao: 'beta', ambiente: {} }), 'projeto.desconhecido');
      assert.match(e.detalhe, /manifesto não está mais na raiz/);
      assert.equal(e.candidatos[0].presente, false);
    } finally { exec('git', ['worktree', 'remove', '--force', wt], p.dir); p.limpar(); }
  });
});

test('resolucao por nome, abbrev e caminho; desconhecido e ambiguo recusam com candidatos, sem chutar', () => {
  comRegistroProprio(() => {
    const a = projeto('orkastery', 'ork'), b = projeto('workspace', 'wor'), clone = projeto('orkastery', 'ork');
    try {
      registrarProjeto(a.dir, 'init'); registrarProjeto(b.dir, 'init');
      assert.equal(resolverProjetoAlvo({ opcao: 'workspace', ambiente: {} })?.raiz, fs.realpathSync(b.dir));
      assert.equal(resolverProjetoAlvo({ opcao: 'WOR', ambiente: {} })?.raiz, fs.realpathSync(b.dir), 'abbrev sem caixa');
      const sub = path.join(a.dir, 'core', 'src'); fs.mkdirSync(sub, { recursive: true });
      const porCaminho = resolverProjetoAlvo({ opcao: sub, ambiente: {} });
      assert.deepEqual(porCaminho, { raiz: fs.realpathSync(a.dir), origem: 'opcao', pedido: sub });

      const desconhecido = recusa(() => resolverProjetoAlvo({ opcao: 'gama', ambiente: {} }), 'projeto.desconhecido');
      assert.deepEqual(desconhecido.candidatos.map((c) => c.nome).sort(), ['orkastery', 'workspace']);
      assert.match(desconhecido.texto, /Candidatos:\n  • orkastery \(ork\)/);
      recusa(() => resolverProjetoAlvo({ opcao: '../gama/', ambiente: {}, cwd: a.dir }), 'projeto.sem-manifesto');
      recusa(() => resolverProjetoAlvo({ opcao: dirTemporario('projeto-alvo-vazio'), ambiente: {} }), 'projeto.sem-manifesto');
      recusa(() => resolverProjetoAlvo({ opcao: '  ', ambiente: {} }), 'projeto.desconhecido');

      registrarProjeto(clone.dir, 'thread new');
      const ambiguo = recusa(() => resolverProjetoAlvo({ opcao: 'orkastery', ambiente: {} }), 'projeto.ambiguo');
      assert.equal(ambiguo.candidatos.length, 2);
      assert.deepEqual(ambiguo.recusa.erro, 'projeto.ambiguo');
      // O caminho desfaz a ambiguidade: o registro nao escolhe no lugar de quem pediu.
      assert.equal(resolverProjetoAlvo({ opcao: clone.dir, ambiente: {} })?.raiz, fs.realpathSync(clone.dir));
      assert.deepEqual(esquecerProjeto(clone.dir).map((x) => x.raiz), [fs.realpathSync(clone.dir)]);
      assert.equal(resolverProjetoAlvo({ opcao: 'orkastery', ambiente: {} })?.raiz, fs.realpathSync(a.dir));
      recusa(() => esquecerProjeto('gama'), 'projeto.desconhecido');
    } finally { a.limpar(); b.limpar(); clone.limpar(); }
  });
});

test('precedencia: --projeto vence ORK_PROJETO, que vence o host sem cwd, que vence o cwd', () => {
  comRegistroProprio(() => {
    const a = projeto('orkastery', 'ork'), b = projeto('workspace', 'wor');
    try {
      registrarProjeto(a.dir, 'init'); registrarProjeto(b.dir, 'init');
      const ambos = { [ENV_PROJETO]: 'workspace', [ENV_PROJETO_EXPLICITO]: '1' };
      assert.equal(resolverProjetoAlvo({ opcao: 'orkastery', ambiente: ambos, cwd: b.dir })?.origem, 'opcao');
      assert.equal(resolverProjetoAlvo({ opcao: 'orkastery', ambiente: ambos, cwd: b.dir })?.raiz, fs.realpathSync(a.dir));
      assert.deepEqual(resolverProjetoAlvo({ ambiente: ambos, cwd: a.dir }),
        { raiz: fs.realpathSync(b.dir), origem: 'ambiente', pedido: 'workspace' });
      assert.equal(resolverProjetoAlvo({ ambiente: {}, cwd: b.dir }), null, 'terminal sem opcao segue o cwd');
    } finally { a.limpar(); b.limpar(); }
  });
});

test('host sem cwd: um candidato vale, mais de um e escolha, nenhum e recusa; o cwd do gateway conta como candidato', () => {
  comRegistroProprio(() => {
    const a = projeto('orkastery', 'ork'), gateway = projeto('workspace', 'wor');
    const vazio = dirTemporario('projeto-alvo-gateway-vazio');
    const host = { [ENV_PROJETO_EXPLICITO]: '1' };
    try {
      recusa(() => resolverProjetoAlvo({ ambiente: host, cwd: vazio }), 'projeto.nenhum');
      assert.deepEqual(resolverProjetoAlvo({ ambiente: host, cwd: gateway.dir }),
        { raiz: fs.realpathSync(gateway.dir), origem: 'unico-conhecido', pedido: null });
      registrarProjeto(a.dir, 'fabrica entrar');
      assert.equal(resolverProjetoAlvo({ ambiente: host, cwd: vazio })?.raiz, fs.realpathSync(a.dir));
      const escolha = recusa(() => resolverProjetoAlvo({ ambiente: host, cwd: gateway.dir }), 'projeto.escolha');
      assert.deepEqual(escolha.candidatos.map((c) => c.nome), ['orkastery', 'workspace']);
      assert.match(escolha.texto, /o ork não escolhe pelo diretório do gateway/);
      assert.match(escolha.correcao, /parâmetro `projeto` da tool/);
      // O cwd do gateway registrado nao aparece duas vezes.
      registrarProjeto(gateway.dir, 'init');
      assert.equal(recusa(() => resolverProjetoAlvo({ ambiente: host, cwd: gateway.dir }), 'projeto.escolha').candidatos.length, 2);
    } finally { a.limpar(); gateway.limpar(); fs.rmSync(vazio, { recursive: true, force: true }); }
  });
});

test('alvo fixado move as raizes padrao; a consulta declara projeto, raiz com ~, remoto, origem e o nao lido', () => {
  comRegistroProprio(() => {
    const a = projeto('orkastery', 'ork'), b = projeto('workspace', 'wor');
    try {
      registrarProjeto(a.dir, 'init'); registrarProjeto(b.dir, 'init');
      const alvo = resolverProjetoAlvo({ opcao: 'orkastery', ambiente: {}, cwd: b.dir });
      fixarProjetoAlvo(alvo);
      assert.equal(diretorioDoProjeto(), fs.realpathSync(a.dir));
      assert.equal(exigirManifesto().manifesto.project.name, 'orkastery', 'o padrao segue o alvo, nao o cwd');
      const c = consultaDoProjeto(exigirManifesto(), { lido: ['threads deste projeto nesta máquina'], naoLido: ['roadmap (ork roadmap status)'] });
      assert.equal(c.contrato, 'ork.consulta/v1');
      assert.deepEqual(c.projeto, { nome: 'orkastery', abbrev: 'ork', raiz: raizParaExibir(fs.realpathSync(a.dir)), remoto: null, origem: 'opcao' });
      assert.deepEqual(c.naoLido, ['roadmap (ork roadmap status)', 'outros projetos desta máquina: 1 (ork projetos)']);
      const [linha1, linha2] = linhasDaConsulta(c);
      assert.match(linha1, /^Projeto consultado: orkastery \(ork\) · .* · sem remoto · pela opção --projeto$/);
      assert.equal(linha2, 'Não lido: roadmap (ork roadmap status) · outros projetos desta máquina: 1 (ork projetos)');
      assert.equal(consultaDoProjeto(exigirManifesto(), { lido: [], naoLido: [], outrosProjetos: false }).naoLido.length, 0);
      fixarProjetoAlvo(null);
      assert.equal(diretorioDoProjeto(), process.cwd());
      assert.equal(consultaDoProjeto(a.carregado, { lido: [], naoLido: [] }).projeto.origem, 'cwd');
      assert.equal(raizParaExibir(path.join(os.homedir(), 'orkastery')), '~/orkastery');
      assert.equal(raizParaExibir('/srv/projetos/x'), '/srv/projetos/x');
    } finally { a.limpar(); b.limpar(); }
  });
});

test('trava do registro: trava de processo morto e retomada; trava de processo vivo espera e recusa', () => {
  comRegistroProprio(() => {
    const p = projeto('delta', 'del');
    try {
      const trava = path.join(process.env.ORK_USUARIO_DIR!, 'projetos.json.lock');
      fs.mkdirSync(path.dirname(trava), { recursive: true });
      fs.writeFileSync(trava, JSON.stringify({ pid: 2 ** 22 + 12345, em: new Date().toISOString() }));
      assert.equal(registrarProjeto(p.dir, 'init').nome, 'delta');
      assert.equal(fs.existsSync(trava), false, 'a trava e solta no fim');
      fs.writeFileSync(trava, JSON.stringify({ pid: process.pid, em: new Date().toISOString() }));
      assert.throws(() => registrarProjeto(p.dir, 'init', { esperaMs: 50 }), /registro de projetos ocupado/);
      fs.rmSync(trava);
      fs.writeFileSync(caminhoDoRegistro(), '{ corrompido');
      assert.deepEqual(lerRegistroDeProjetos().projetos, [], 'arquivo corrompido vale registro vazio');
      assert.equal(registrarProjeto(p.dir, 'init').nome, 'delta');
    } finally { p.limpar(); }
  });
});
