import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { emitirResultadoForteDaFabrica, verificarResultadoForteDaFabrica,
  type PoliticaDoResultadoForte, type PortaDeAssinaturaDoResultadoForte } from '../src/ci-fabrica-resultado';
import type { ProvaDosRegistrosDaFabrica } from '../src/ci-fabrica-registros';

const H = 'a'.repeat(40), V = 'b'.repeat(40), K = 'c'.repeat(64);
const chaves = generateKeyPairSync('ed25519');
const porta: PortaDeAssinaturaDoResultadoForte = { contrato: 'ork.ci-recibo-forte-signing-port/v2', emissor: 'fabrica',
  chaveId: 'k1', exclusiva: true, assinar: (texto) => sign(null, Buffer.from(texto), chaves.privateKey).toString('base64') };
const politica: PoliticaDoResultadoForte = { emissor: 'fabrica', chaves: [{ id: 'k1',
  materialPublicoPem: chaves.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  validaDesde: '2026-01-01T00:00:00.000Z', validaAte: '2027-01-01T00:00:00.000Z' }] };
const prova = (): ProvaDosRegistrosDaFabrica => ({ forja: 'github', projeto: 'grupo/projeto', origem: 'feature',
  destino: 'main', head: H, verify: { commit: V, verde: true, comandos: ['npm test'], rodadaId: 'r1',
    chaveDeProva: K, posicao: 1 }, check: { fase: 'CHECK', origem: 'sessions.watch', sessionId: 'revisor',
    despachoEm: '2026-11-26T00:00:00.000Z', despachoRegistrado: true, despachoVerificado: true,
    promptConferido: true, sensorResultId: 's', favoravel: true, parecerSha256: K, shaRevisado: H,
    conducaoId: 'c1', posicao: 2 }, tag: { conducaoId: 'c1', head: H, posicao: 3 }, construtores: ['autor'],
  commitsDeProduto: [V], configuracaoDoDestino: { github_app_id: 42 } });

test('C120 assina e verifica payload v2 separado com HEAD, verify, CHECK e tag', () => {
  const r = emitirResultadoForteDaFabrica(prova(), '2026-11-26T10:00:00.000Z', '2026-11-26T11:00:00.000Z', porta);
  assert.equal(r.payload.head, H);
  assert.equal(r.payload.verify.commit, V);
  assert.equal(r.payload.check.shaRevisado, H);
  assert.equal(verificarResultadoForteDaFabrica(r, politica,
    { projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H }, '2026-11-26T10:30:00.000Z').ok, true);
});

test('resultado de outro vínculo, vencido, adulterado ou com chave revogada falha fechado', () => {
  const r = emitirResultadoForteDaFabrica(prova(), '2026-11-26T10:00:00.000Z', '2026-11-26T11:00:00.000Z', porta);
  assert.equal(verificarResultadoForteDaFabrica(r, politica,
    { projeto: 'outro', origem: 'feature', destino: 'main', head: H }, '2026-11-26T10:30:00.000Z').ok, false);
  assert.equal(verificarResultadoForteDaFabrica(r, politica,
    { projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H }, '2026-11-26T11:00:00.000Z').ok, false);
  const adulterado = structuredClone(r); adulterado.payload.destino = 'outro';
  assert.equal(verificarResultadoForteDaFabrica(adulterado, politica,
    { projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H }, '2026-11-26T10:30:00.000Z').ok, false);
  const revogada = structuredClone(politica); revogada.chaves[0].revogadaEm = '2026-11-26T10:15:00.000Z';
  assert.equal(verificarResultadoForteDaFabrica(r, revogada,
    { projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H }, '2026-11-26T10:30:00.000Z').ok, false);
});

test('exceção F6 aceita somente operation ci.run e o mesmo vínculo', () => {
  const p = prova();
  const boa = { operation: 'ci.run' as const, projeto: p.projeto, origem: p.origem, destino: p.destino, head: p.head };
  assert.doesNotThrow(() => emitirResultadoForteDaFabrica(p, '2026-11-26T10:00:00.000Z',
    '2026-11-26T11:00:00.000Z', porta, boa));
  assert.throws(() => emitirResultadoForteDaFabrica(p, '2026-11-26T10:00:00.000Z',
    '2026-11-26T11:00:00.000Z', porta, { ...boa, projeto: 'outro' }));
});
