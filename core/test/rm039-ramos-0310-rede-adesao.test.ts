/**
 * RM-039 (receita da C5): os ramos de `rede-adesao.ts` mudados em 03/10 que a suite nao executava.
 * Tudo numa pasta de usuario temporaria (`ORK_USUARIO_DIR`): sem rede, sem a forja e sem o
 * `~/.orkastery` real. O "cli" do disparo e um script vazio, nunca o `ork network publicar`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adesaoDaRede, CONTRATO_DA_ADESAO, gravarConfigDaRede, idDaMaquina, lerConfigDaRede, pastaDaRede, publicarRedeEmSegundoPlano,
  registrarNaRede, TETO_DE_TENTATIVA_MS, tomarVezDePublicar } from '../src/rede-adesao';
import { gravarConfigDaMaquina } from '../src/maquina';
import { dirTemporario } from './apoio';

function comUsuario<T>(nome: string, fn: (dir: string) => T): T {
  const antes = process.env.ORK_USUARIO_DIR;
  const dir = dirTemporario(`c5r-${nome}`);
  process.env.ORK_USUARIO_DIR = dir;
  try { return fn(dir); } finally {
    if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const gravarRede = (dir: string, conteudo: unknown) => fs.writeFileSync(path.join(dir, 'rede.json'), JSON.stringify(conteudo));
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('C5 rede config: contrato errado ou membro fora de boolean nao valem; campo ruim vira null e a gravacao parcial preserva', () => {
  comUsuario('config', (dir) => {
    assert.equal(gravarConfigDaRede({ forja: 'github' }).membro, false, 'sem rede.json e sem membro na mudanca: fora');
    gravarRede(dir, { contrato: 'ork.rede/v0', membro: true });
    assert.equal(lerConfigDaRede(), null);
    gravarRede(dir, { contrato: CONTRATO_DA_ADESAO, membro: 'sim' });
    assert.equal(lerConfigDaRede(), null);
    gravarRede(dir, { contrato: CONTRATO_DA_ADESAO, membro: true, forja: 'bitbucket', host: 'mau host', dono: '-x', repositorio: 'a/b', atualizadoEm: 7 });
    assert.deepEqual(lerConfigDaRede(), { contrato: CONTRATO_DA_ADESAO, membro: true, forja: null, host: null, dono: null, repositorio: null, atualizadoEm: '' });

    assert.throws(() => gravarConfigDaRede({ host: 'host com espaco' }), /rede\.config: host invalido/);
    assert.throws(() => gravarConfigDaRede({ dono: '--upload-pack' }), /rede\.config: dono invalido/);
    assert.throws(() => gravarConfigDaRede({ repositorio: 'a/../b' }), /rede\.config: repositorio invalido/);

    const primeira = gravarConfigDaRede({ membro: true, forja: 'gitlab', host: 'gitlab.exemplo:8443', dono: 'grupo', repositorio: 'rede' });
    assert.equal(primeira.host, 'gitlab.exemplo:8443');
    const segunda = gravarConfigDaRede({ dono: null });
    assert.deepEqual([segunda.membro, segunda.forja, segunda.host, segunda.dono, segunda.repositorio], [true, 'gitlab', 'gitlab.exemplo:8443', null, 'rede']);
    assert.deepEqual(adesaoDaRede().adesao, 'rede');
  });
});

test('C5 rede adesao: sair (membro false) vence a heranca da fabrica; sem rede.json a fabrica herda', () => {
  comUsuario('adesao', () => {
    gravarConfigDaMaquina({ fabricaCompartilhada: true });
    assert.deepEqual(adesaoDaRede(), { membro: true, adesao: 'fabrica', config: null });
    gravarConfigDaRede({ membro: false });
    const estado = adesaoDaRede();
    assert.equal(estado.membro, false);
    assert.equal(estado.adesao, null);
    assert.equal(gravarConfigDaRede({}).membro, false, 'membro ausente na mudanca fica como estava');
  });
});

test('C5 rede id: link pendurado vira id gravado e o alvo nao e criado; pasta no lugar do id recusa', () => {
  comUsuario('id', (dir) => {
    const arquivo = path.join(dir, 'maquina-id'), alvo = path.join(dir, 'nao-existe');
    fs.symlinkSync(alvo, arquivo);
    const id = idDaMaquina();
    assert.match(id, ID);
    assert.equal(fs.lstatSync(arquivo).isSymbolicLink(), false, 'o link sai');
    assert.equal(fs.readFileSync(arquivo, 'utf8'), id);
    assert.equal(fs.existsSync(alvo), false, 'o alvo do link fica como estava');
    assert.equal(idDaMaquina(), id, 'a segunda leitura devolve o mesmo id');

    fs.rmSync(arquivo);
    fs.mkdirSync(arquivo);
    assert.throws(() => idDaMaquina(), /rede\.id: .* nao e um arquivo/);
  });
});

test('C5 rede id: arquivo ruim vira o id da reserva da troca, o mesmo para quem o viu igual', () => {
  comUsuario('id-ruim', (dir) => {
    const arquivo = path.join(dir, 'maquina-id');
    fs.writeFileSync(arquivo, 'isto nao e um id\n');
    const quando = new Date('2026-10-03T08:00:00Z');
    fs.utimesSync(arquivo, quando, quando);
    const id = idDaMaquina();
    assert.match(id, ID);
    const reservas = fs.readdirSync(dir).filter((n) => n.startsWith('maquina-id.troca-'));
    assert.equal(reservas.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, reservas[0], 'id'), 'utf8'), id, 'o id gravado e o da reserva');
  });
});

test('C5 rede vez: dentro do teto perde a vez, marca no futuro ou ilegivel toma, depois do teto toma de novo', () => {
  comUsuario('vez', () => {
    const t0 = Date.parse('2026-10-03T10:00:00Z');
    assert.equal(tomarVezDePublicar(t0), true);
    assert.equal(tomarVezDePublicar(t0 + TETO_DE_TENTATIVA_MS - 1), false);
    assert.equal(tomarVezDePublicar(t0 - 60_000), true, 'relogio que voltou: a marca no futuro nao segura a vez');
    assert.equal(tomarVezDePublicar(t0 - 60_000 + TETO_DE_TENTATIVA_MS), true);
    fs.writeFileSync(path.join(pastaDaRede(), 'tentativa.json'), '{ilegivel');
    assert.equal(tomarVezDePublicar(t0), true, 'marca ilegivel: tenta');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pastaDaRede(), 'tentativa.json'), 'utf8')).em, new Date(t0).toISOString());
    fs.writeFileSync(path.join(pastaDaRede(), 'tentativa.json'), '{}');
    assert.equal(tomarVezDePublicar(t0), true, 'marca sem hora: tenta');
  });
  comUsuario('vez-arquivo', (dir) => {
    fs.writeFileSync(path.join(dir, 'rede'), 'arquivo no lugar da pasta');
    assert.equal(tomarVezDePublicar(Date.now()), false, 'sem a pasta da rede nao ha vez');
    registrarNaRede({ evento: 'teste' }); // o log e informativo: nao lanca
  });
});

test('C5 rede disparo: desligado, fora da rede ou sem cli nao dispara; membro dispara uma vez por teto', () => {
  comUsuario('disparo', (dir) => {
    const cli = path.join(dir, 'cli-vazio.js');
    fs.writeFileSync(cli, '');
    const env = { ...process.env, ORK_REDE_PUBLICAR: '1', ORK_FABRICA_PUBLICAR: '1' };
    const t0 = Date.parse('2026-10-03T11:00:00Z');
    assert.equal(publicarRedeEmSegundoPlano({ cli, env: { ...env, ORK_FABRICA_PUBLICAR: '0' }, agora: t0, diretorio: dir }), false);
    assert.equal(publicarRedeEmSegundoPlano({ cli, env, agora: t0, diretorio: dir }), false, 'fora da rede');
    gravarConfigDaRede({ membro: true });
    assert.equal(publicarRedeEmSegundoPlano({ cli: path.join(dir, 'nao-ha.js'), env, agora: t0, diretorio: dir }), false, 'sem cli');
    assert.equal(fs.existsSync(path.join(pastaDaRede(), 'tentativa.json')), false, 'sem cli a vez nao e gasta');
    assert.equal(publicarRedeEmSegundoPlano({ cli, env, agora: t0, diretorio: dir }), true);
    assert.equal(publicarRedeEmSegundoPlano({ cli, env, agora: t0 + 1000, diretorio: dir }), false, 'dentro do teto');
  });
});
