/**
 * RM-063 (F7): `ork conducao autorizar` grava a autorizacao duravel do dono nesta maquina, na forma que a batida le
 * (`ork.autorizacao-duravel/v1`, fora do git), e `ork conducao autorizacao` mostra a vigente. Ate a fatia 2 o dono
 * gravava o arquivo a mao. Projeto temporario; a casa do ork e temporaria (test/apoio.ts).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { caminhoDaAutorizacao, gravarAutorizacao, lerAutorizacao, PedidoDeAutorizacao, prazoDoPedido } from '../src/autorizacao-duravel';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import { nomeDaMaquina } from '../src/maquina';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const AGORA = new Date('2026-10-13T12:00:00.000Z');
const SEM_DESPACHO: NodeJS.ProcessEnv = {};

function pedido(projeto: string, campos: Partial<PedidoDeAutorizacao> = {}): PedidoDeAutorizacao {
  return { ate: '2026-10-18', pode: 'merge,registrar,master,despachar', por: 'Dona Simulada', projeto, fuso: 'America/Sao_Paulo',
    agora: AGORA, ambiente: SEM_DESPACHO, ...campos };
}

/** O ambiente do CLI do dono: sem a identidade de despacho desta sessao, sem canal herdado. */
function ambienteDoDono(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ORK_MAQUINA: nomeDaMaquina(), LANG: 'C.UTF-8' };
  for (const k of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'LC_ALL']) delete env[k];
  return env;
}

test('F7: o prazo do --ate sai sempre com o fuso escrito; o que nao e prazo e recusado', () => {
  assert.equal(prazoDoPedido('2026-10-18', 'America/Sao_Paulo'), '2026-10-18T23:59:00-03:00');
  assert.equal(prazoDoPedido('2026-10-18T18:30', 'America/Sao_Paulo'), '2026-10-18T18:30:00-03:00');
  assert.equal(prazoDoPedido('2026-10-18', 'UTC'), '2026-10-18T23:59:00Z');
  assert.equal(prazoDoPedido('2026-10-18T23:59:00-03:00', 'UTC'), '2026-10-18T23:59:00-03:00');
  assert.equal(prazoDoPedido('2026-10-18T10:00:00Z', 'America/Sao_Paulo'), '2026-10-18T10:00:00Z');
  for (const ruim of ['amanha', '18/10/2026', '2026-02-30', '2026-10-18T25:00', '']) assert.equal(prazoDoPedido(ruim, 'UTC'), null, ruim);
});

test('F7: autorizar grava a forma do contrato, fora do git, e a batida a le valida; a nova substitui a anterior', () => {
  const p = projetoTemporario('rm063-f7-autorizar');
  try {
    const projeto = p.carregado.manifesto.project.name;
    const r = gravarAutorizacao(p.dir, pedido(projeto, { nota: 'X1.a' }));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const arquivo = caminhoDaAutorizacao(p.dir);
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    const gravada = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
    assert.deepEqual({ ...gravada, concedidaEm: null }, { contrato: 'ork.autorizacao-duravel/v1', maquina: nomeDaMaquina(), projeto,
      por: 'Dona Simulada', concedidaEm: null, ate: '2026-10-18T23:59:00-03:00', pode: ['merge', 'registrar', 'master', 'despachar'], nota: 'X1.a' });
    assert.equal(gravada.concedidaEm, '2026-10-13T09:00:00-03:00', 'concedida no fuso do dono, com o fuso escrito');
    const lida = lerAutorizacao(p.dir, { projeto, agora: AGORA });
    assert.equal(lida.valida, true);
    assert.equal(r.anterior, null);
    // A segunda concessao substitui a primeira inteira, e o ledger do projeto guarda as duas.
    const r2 = gravarAutorizacao(p.dir, pedido(projeto, { ate: '2026-10-20T18:00', pode: 'registrar,master' }));
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.ok ? r2.anterior?.pode : null, ['merge', 'registrar', 'master', 'despachar']);
    assert.deepEqual(lerAutorizacao(p.dir, { projeto, agora: AGORA }).valida ? JSON.parse(fs.readFileSync(arquivo, 'utf8')).pode : null,
      ['registrar', 'master']);
    const concedidas = lerLedger(path.join(p.dir, '.orkastery')).filter((e) => e.tipo === TIPOS_DE_EVENTO.autorizacaoConcedida);
    assert.equal(concedidas.length, 2);
    assert.deepEqual(concedidas[1].substituiu, { por: 'Dona Simulada', ate: '2026-10-18T23:59:00-03:00', pode: ['merge', 'registrar', 'master', 'despachar'] });
    assert.match(String(concedidas[1].sha256), /^[0-9a-f]{64}$/);
    // Fora do git: o status do repositorio nao ve o arquivo.
    const st = spawnSync('git', ['status', '--porcelain', '--', arquivo], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(st.stdout.trim(), '', 'a autorizacao apareceu no git');
  } finally { p.limpar(); }
});

test('F7: cada recusa tem motivo tipado e nao grava nada; tag e publicacao nunca entram', () => {
  const p = projetoTemporario('rm063-f7-recusas');
  try {
    const projeto = p.carregado.manifesto.project.name;
    const casos: [Partial<PedidoDeAutorizacao>, string][] = [
      [{ ambiente: { ORK_DISPATCH_ID: '9a8b7c6d-0000-4000-8000-000000000001' } }, 'autorizacao.sessao-despachada'],
      [{ ambiente: { ORK_DISPATCH_THREAD: 'ork-x' } }, 'autorizacao.sessao-despachada'],
      [{ ate: 'amanha' }, 'autorizacao.ate-invalido'],
      [{ ate: '2026-10-12' }, 'autorizacao.ate-passado'],
      [{ pode: ' , ' }, 'autorizacao.pode-vazio'],
      [{ pode: 'merge,merge' }, 'autorizacao.pode-repetido'],
      [{ pode: 'merge,tag' }, 'autorizacao.acao-proibida'],
      [{ pode: 'publicar' }, 'autorizacao.acao-proibida'],
      [{ pode: 'release,merge' }, 'autorizacao.acao-proibida'],
      [{ pode: 'merge,apagar-tudo' }, 'autorizacao.acao-desconhecida'],
      [{ por: 'claude' }, 'autorizacao.por'],
      [{ por: 'Codex GPT-5' }, 'autorizacao.por'],
      [{ nota: 'x'.repeat(301) }, 'autorizacao.nota'],
    ];
    for (const [campos, motivo] of casos) {
      const r = gravarAutorizacao(p.dir, pedido(projeto, campos));
      assert.deepEqual([r.ok, r.ok ? null : r.motivo], [false, motivo], JSON.stringify(campos));
      assert.equal(fs.existsSync(caminhoDaAutorizacao(p.dir)), false, `gravou com ${JSON.stringify(campos)}`);
    }
    // Sem --por, vale o user.name do git deste checkout, quando nomeia uma pessoa.
    const semPor = gravarAutorizacao(p.dir, pedido(projeto, { por: null }));
    assert.equal(semPor.ok ? semPor.leitura.autorizacao.por : null, 'Teste Orkastery');
  } finally { p.limpar(); }
});

test('F7: ork conducao autorizar e autorizacao pelo CLI; a sessao despachada nao autoriza', () => {
  const p = projetoTemporario('rm063-f7-cli');
  try {
    const ork = (args: string[], env = ambienteDoDono()) => spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, encoding: 'utf8', env });
    const vazia = ork(['conducao', 'autorizacao', '--json']);
    assert.equal(vazia.status, 0, vazia.stderr);
    assert.equal((JSON.parse(vazia.stdout) as { motivo: string }).motivo, 'autorizacao.ausente');
    const ate = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 10);
    const dentro = ork(['conducao', 'autorizar', '--ate', ate, '--pode', 'merge,despachar', '--por', 'Dona Simulada'],
      { ...ambienteDoDono(), ORK_DISPATCH_ID: '9a8b7c6d-0000-4000-8000-000000000001' });
    assert.equal(dentro.status, 1);
    assert.match(dentro.stdout, /Autorização recusada \(autorizacao\.sessao-despachada\)/);
    const r = ork(['conducao', 'autorizar', '--ate', ate, '--pode', 'merge,despachar', '--por', 'Dona Simulada', '--nota', 'X1.a']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^Autorização gravada\. autorização durável de Dona Simulada até .*: a varredura pode merge, despachar\./);
    const vigente = ork(['conducao', 'autorizacao']);
    assert.equal(vigente.status, 0);
    assert.match(vigente.stdout, /^Autorização durável de Dona Simulada até .*: a condução pode merge, despachar\./);
    assert.match(vigente.stdout, /Tag e publicação nunca entram/);
    const uso = ork(['conducao', 'autorizar', '--pode', 'merge']);
    assert.notEqual(uso.status, 0);
    assert.match(uso.stderr, /uso: ork conducao autorizar --ate <data> --pode/);
  } finally { p.limpar(); }
});

test('GO-FIX 3: de dentro de um host de agente ninguem se autoriza; o prazo tem teto e data de calendario', () => {
  const p = projetoTemporario('rm063-gofix-autorizar');
  try {
    const projeto = p.carregado.manifesto.project.name;
    for (const ambiente of [{ CLAUDECODE: '1' }, { HERMES_HOME: '/opt/hermes' }, { CODEX_SANDBOX: 'seatbelt' }, { ORK_CANAL: 'openclaw' }]) {
      const r = gravarAutorizacao(p.dir, pedido(projeto, { ambiente }));
      assert.deepEqual([r.ok, r.ok ? null : r.motivo], [false, 'autorizacao.host'], JSON.stringify(ambiente));
    }
    const longe = gravarAutorizacao(p.dir, pedido(projeto, { ate: '2026-12-31' }));
    assert.deepEqual([longe.ok, longe.ok ? null : longe.motivo], [false, 'autorizacao.ate-longe']);
    assert.equal(gravarAutorizacao(p.dir, pedido(projeto, { ate: '2026-11-12' })).ok, true, '30 dias ainda valem');
    for (const ruim of ['2026-02-30T10:00Z', '2026-02-30T10:00:00-03:00', '2026-13-01T00:00Z']) assert.equal(prazoDoPedido(ruim, 'UTC'), null, ruim);
    // A leitura tambem recusa o instante fora do calendario num arquivo escrito a mao.
    const arquivo = caminhoDaAutorizacao(p.dir);
    const gravada = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    fs.writeFileSync(arquivo, JSON.stringify({ ...gravada, ate: '2026-02-30T10:00:00-03:00' }));
    const lida = lerAutorizacao(p.dir, { projeto, agora: AGORA });
    assert.deepEqual([lida.valida, lida.valida ? null : lida.motivo], [false, 'autorizacao.campo']);
  } finally { p.limpar(); }
});
