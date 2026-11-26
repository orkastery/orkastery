import assert from 'node:assert/strict';
import test from 'node:test';
import { codigoDoPushRecusadoNoShip, decidirShipComFabrica,
  type EntradaDoShipComFabrica } from '../src/ship';

const H = 'a'.repeat(40);
const github = (): EntradaDoShipComFabrica => ({ configurada: true, nivel: 'exigir', forja: 'github',
  destino: 'main', head: H, resultado: { valido: true, destino: 'main', head: H, githubAppId: 42 },
  github: { appIdEsperado: 42, checkVerde: true }, ci: { state: 'success' } });

test('C126 sinal positivo da CI não autoriza e sinal negativo veta', () => {
  const semFabrica = github(); semFabrica.resultado = null;
  const positivo = decidirShipComFabrica(semFabrica);
  assert.equal(positivo.ok, false);
  if (!positivo.ok) assert.equal(positivo.codigo, 'ci.fabrica.prova-ausente');
  const negativo = github(); negativo.ci.state = 'failure';
  const veto = decidirShipComFabrica(negativo);
  assert.equal(veto.ok, false);
  if (!veto.ok) assert.equal(veto.codigo, 'ci.failed');
});

test('GitHub só mescla depois do resultado e check da fábrica para destino e App esperados', () => {
  assert.deepEqual(decidirShipComFabrica(github()), { ok: true, acao: 'mesclar-github' });
  const app = github(); app.resultado!.githubAppId = 7;
  assert.equal(decidirShipComFabrica(app).ok, false);
  const destino = github(); destino.resultado!.destino = 'release';
  assert.equal(decidirShipComFabrica(destino).ok, false);
});

test('os três resultados do ship ficam no campo codigo e push da fábrica tem precedência', () => {
  const push = github(); push.github!.pushAceito = false;
  const recusado = decidirShipComFabrica(push);
  assert.equal(recusado.ok, false);
  if (!recusado.ok) assert.equal(recusado.codigo, 'ship.fabrica.push-recusado');
  assert.equal(codigoDoPushRecusadoNoShip(true), 'ship.fabrica.push-recusado');
  assert.equal(codigoDoPushRecusadoNoShip(false), 'entrega.base-protegida');

  const pendente: EntradaDoShipComFabrica = { ...github(), forja: 'gitlab', github: undefined,
    resultado: { valido: true, destino: 'main', head: H }, gitlab: { estado: 'pendente' } };
  const espera = decidirShipComFabrica(pendente);
  assert.equal(espera.ok, false); if (!espera.ok) assert.equal(espera.codigo, 'ship.fabrica.merge-pendente');
  pendente.gitlab = { estado: 'mesclado', shaMesclado: 'b'.repeat(40) };
  const divergente = decidirShipComFabrica(pendente);
  assert.equal(divergente.ok, false); if (!divergente.ok) assert.equal(divergente.codigo, 'ship.fabrica.sha-divergente');
  pendente.gitlab.shaMesclado = H;
  assert.deepEqual(decidirShipComFabrica(pendente), { ok: true, acao: 'registrar-gitlab' });
});

test('sem fábrica ou fora de exigir preserva o fluxo publicado', () => {
  for (const nivel of ['observar', 'avisar'] as const) { const e = github(); e.nivel = nivel;
    assert.deepEqual(decidirShipComFabrica(e), { ok: true, acao: 'fluxo-publicado' }); }
  const e = github(); e.configurada = false;
  assert.deepEqual(decidirShipComFabrica(e), { ok: true, acao: 'fluxo-publicado' });
});
