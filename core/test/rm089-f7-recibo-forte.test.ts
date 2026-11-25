/** RM-089 F7: âncora, assinatura e evidência canônica do recibo forte. */
import { strict as assert } from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { criarProjecaoReplayCi, emitirReciboRunnerCi } from '../src/ci-recibo-basico';
import { CONTRATO_POLITICA_RECIBO_FORTE_CI, CONTRATO_PORTA_ASSINATURA_RECIBO_FORTE_CI,
  assinarReciboForteComEvidenciaCanonica, assinarReciboForteNaFabrica, verificarReciboForteDaFabrica,
  type PoliticaDoReciboForteCi, type PortaDeAssinaturaDoReciboForteCi,
  type ResultadoDoReciboForteCi } from '../src/ci-fabrica-recibo';
import { CONTRATO_EVIDENCIA_CHECK_CI, CONTRATO_PAYLOAD_RECIBO_FORTE_CI,
  criarPayloadDoReciboForteCi, payloadDoReciboForteCiValido, preImagemDoReciboForteCi,
  sha256DoPayloadDoReciboForteCi, type ContextoDoReciboForteCi } from '../src/ci-recibo-forte';
import type { Claim } from '../src/types';
import { evidenciaCanonicaDoGithub } from '../src/forja/github/ci';
import { evidenciaCanonicaDoGitlab } from '../src/forja/gitlab/ci';

const HEAD = 'a'.repeat(40);
const CHECK_SHA = 'b'.repeat(64);

const claim: Claim = { id: 'C1', thread: 'ork-rm089f7recib', fase: 'GO',
  arquivo: 'core/test/rm089-f7-recibo-forte.test.ts', alegacao: 'o recibo forte ancora o recibo F5',
  negativa: false, verificar: ['node --test core/dist-test/test/rm089-f7-recibo-forte.test.js'],
  criadoEm: '2026-11-25T00:00:00.000Z', estado: 'pendente' };

function recibo() {
  const projecao = criarProjecaoReplayCi({ thread: claim.thread, claims: [claim], check: 'agile', baseline: null,
    commands: [{ name: 'build', command: 'npm --prefix core run build' }] });
  return emitirReciboRunnerCi(projecao, HEAD, { ok: true, motivos: [] });
}

function contexto(forja: 'github' | 'gitlab'): ContextoDoReciboForteCi {
  return { tagConducao: 'ork-rm089f7recib-full', rodadaId: `rodada-${forja}`, checkSha256: CHECK_SHA, forja,
    principalNativo: forja === 'github' ? 'github-app:101' : 'gitlab-user:102',
    construtor: forja === 'github' ? 'github-user:900' : 'gitlab-user:900',
    execucaoId: forja === 'github' ? '71' : '72', emitidoEm: '2026-11-25T00:00:00.000Z' };
}

function material() {
  const par = generateKeyPairSync('ed25519');
  const politica: PoliticaDoReciboForteCi = { contrato: CONTRATO_POLITICA_RECIBO_FORTE_CI, versao: 'policy-v1',
    emissor: 'fabrica-ci', chaves: [{ id: 'chave-v1', algoritmo: 'Ed25519',
      materialPublicoPem: par.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      validaDesde: '2026-11-01T00:00:00.000Z', validaAte: '2026-12-01T00:00:00.000Z' }] };
  const porta: PortaDeAssinaturaDoReciboForteCi = { contrato: CONTRATO_PORTA_ASSINATURA_RECIBO_FORTE_CI,
    operacao: 'assinar-recibo-forte', emissor: politica.emissor, chaveId: 'chave-v1', exclusiva: true,
    assinar: (preImagem) => sign(null, Buffer.from(preImagem, 'utf8'), par.privateKey).toString('base64') };
  return { par, politica, porta };
}

function evidencia(forja: 'github' | 'gitlab', alterar: (valor: Record<string, unknown>) => Record<string, unknown> = (v) => v) {
  const ctx = contexto(forja);
  const esperado = { project: 'org/projeto', source: 'feature/segura', target: 'main', head: HEAD,
    context: 'ork-replay', execucaoId: ctx.execucaoId, construtor: ctx.construtor };
  if (forja === 'github') {
    const bruto = { check: { id: 81, name: esperado.context, status: 'completed', conclusion: 'success',
      head_sha: HEAD, app: { id: 101 } }, run: { id: 71, head_sha: HEAD, head_branch: esperado.source,
      event: 'pull_request', workflow_id: 91, actor: { id: 901 }, repository: { full_name: esperado.project } },
    workflow: { id: 91, protected: true }, target: { name: 'main', protected: true },
    sourceRepository: esperado.project, targetRepository: esperado.project };
    return evidenciaCanonicaDoGithub(alterar(bruto) as typeof bruto, esperado);
  }
  const bruto = { job: { id: 72, name: esperado.context, status: 'success', user: { id: 102 },
    pipeline: { id: 82, project_id: 92, sha: HEAD } }, pipeline: { id: 82, project_id: 92, sha: HEAD,
    source: 'merge_request_event', user: { id: 902 } }, project: { id: 92, path_with_namespace: esperado.project },
  mergeRequest: { source_branch: esperado.source, target_branch: 'main', sha: HEAD,
    source_project_id: 92, target_project_id: 92 }, target: { protected: true }, configuration: { protected: true } };
  return evidenciaCanonicaDoGitlab(alterar(bruto) as typeof bruto, esperado);
}

function codigo(resultado: ResultadoDoReciboForteCi): string {
  assert.equal(resultado.ok, false);
  return resultado.ok ? '' : resultado.code;
}

test('o payload v1 ancora o hash F5 e a evidência canônica nas duas forjas', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const base = recibo();
    const payload = criarPayloadDoReciboForteCi(base, contexto(forja));
    assert.equal(payload.contrato, CONTRATO_PAYLOAD_RECIBO_FORTE_CI);
    assert.equal(payload.reciboSha256, base.sha256);
    assert.equal(payload.evidencia.contrato, CONTRATO_EVIDENCIA_CHECK_CI);
    assert.equal(payload.veredito, 'PASSOU');
    assert.equal(payloadDoReciboForteCiValido(payload, base), true);
    assert.match(sha256DoPayloadDoReciboForteCi(payload), /^[a-f0-9]{64}$/);
    assert.equal(preImagemDoReciboForteCi(payload), preImagemDoReciboForteCi({ ...payload }));
  }
});

test('alteração do recibo, HEAD ou evidência rompe a âncora', () => {
  const base = recibo();
  const payload = criarPayloadDoReciboForteCi(base, contexto('github'));
  const casos = [
    { ...payload, reciboSha256: 'c'.repeat(64) },
    { ...payload, head: 'd'.repeat(40) },
    { ...payload, campoExtra: true },
  ];
  for (const adulterado of casos) assert.equal(payloadDoReciboForteCiValido(adulterado, base), false);
  const evidenciaAdulterada = { ...payload, evidencia: { ...payload.evidencia, sha256: 'e'.repeat(64) } };
  assert.equal(payloadDoReciboForteCiValido(evidenciaAdulterada, base), true, 'o schema continua válido');
  assert.notEqual(sha256DoPayloadDoReciboForteCi(evidenciaAdulterada), sha256DoPayloadDoReciboForteCi(payload),
    'a assinatura de T2 cobre a alteração da evidência');
});

test('a F5 preserva a pré-imagem sem assinatura e sem autorreferência', () => {
  const base = recibo();
  assert.equal('assinatura' in base, false);
  const semSha = { ...base } as Record<string, unknown>;
  delete semSha.sha256;
  assert.equal(JSON.stringify(semSha).includes(base.sha256), false);
});

test('assinatura válida da fábrica liga recibo, rodada e CHECK nas duas forjas', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const base = recibo(), m = material(), ctx = contexto(forja);
    const assinado = assinarReciboForteComEvidenciaCanonica(base, ctx, evidencia(forja), m.politica, m.porta);
    assert.equal(assinado.ok, true, forja);
    if (!assinado.ok) continue;
    assert.deepEqual(verificarReciboForteDaFabrica(assinado.recibo, m.politica, ctx),
      { ok: true, recibo: assinado.recibo });
    for (const adulterado of [
      { ...assinado.recibo, head: 'c'.repeat(40) },
      { ...assinado.recibo, assinatura: { ...assinado.recibo.assinatura!, payload: {
        ...assinado.recibo.assinatura!.payload, rodadaId: 'rodada-adulterada' } } },
      { ...assinado.recibo, assinatura: { ...assinado.recibo.assinatura!, payload: {
        ...assinado.recibo.assinatura!.payload, evidencia: { ...assinado.recibo.assinatura!.payload.evidencia,
          sha256: 'd'.repeat(64) } } } },
    ]) assert.equal(verificarReciboForteDaFabrica(adulterado, m.politica, ctx).ok, false, forja);
  }
});

test('chave errada, emissor, revogação e material ausente falham com causa tipada', () => {
  const base = recibo(), m = material(), ctx = contexto('github');
  const assinado = assinarReciboForteComEvidenciaCanonica(base, ctx, evidencia('github'), m.politica, m.porta);
  assert.equal(assinado.ok, true);
  if (!assinado.ok) return;
  const outra = material();
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, outra.politica, ctx)),
    'ci.recibo-forte.assinatura-invalida');
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo,
    { ...m.politica, emissor: 'outro-emissor' }, ctx)),
    'ci.recibo-forte.emissor-invalido');
  const revogada = { ...m.politica, chaves: [{ ...m.politica.chaves[0], revogadaEm: '2026-11-24T00:00:00.000Z' }] };
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, revogada, ctx)),
    'ci.recibo-forte.chave-revogada');
  const ausente = { ...m.politica, chaves: [{ ...m.politica.chaves[0], materialPublicoPem: null }] };
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, ausente, ctx)),
    'ci.recibo-forte.material-publico-indisponivel');
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, null, ctx)),
    'ci.recibo-forte.material-publico-indisponivel');
  const vencida = { ...m.politica, chaves: [{ ...m.politica.chaves[0], validaAte: '2026-11-24T00:00:00.000Z' }] };
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, vencida, ctx)),
    'ci.recibo-forte.chave-fora-da-validade');
  assert.equal(codigo(verificarReciboForteDaFabrica(assinado.recibo, revogada, ctx, 'relogio-invalido')),
    'ci.recibo-forte.contexto-invalido');
});

test('evidência canônica inválida encerra antes da porta de assinatura', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const base = recibo(), m = material(), ctx = contexto(forja);
    let chamadas = 0;
    const porta = { ...m.porta, assinar: (preImagem: string) => { chamadas++; return m.porta.assinar(preImagem); } };
    const casos = forja === 'github' ? [
      evidencia('github', (v) => ({ ...v, check: { ...(v.check as object), app: {} } })),
      evidencia('github', (v) => ({ ...v, sourceRepository: 'fork/projeto' })),
      evidencia('github', (v) => ({ ...v, workflow: { ...(v.workflow as object), protected: false } })),
      evidencia('github', (v) => ({ ...v, check: { ...(v.check as object), head_sha: 'c'.repeat(40) } })),
    ] : [
      evidencia('gitlab', (v) => ({ ...v, job: { ...(v.job as object), user: {} } })),
      evidencia('gitlab', (v) => ({ ...v, mergeRequest: { ...(v.mergeRequest as object), source_project_id: 93 } })),
      evidencia('gitlab', (v) => ({ ...v, configuration: { protected: false } })),
      evidencia('gitlab', (v) => ({ ...v, pipeline: { ...(v.pipeline as object), sha: 'c'.repeat(40) } })),
    ];
    casos.push({ ...evidencia(forja)!, principalNativo: ctx.construtor });
    for (const caso of casos) {
      const resultado = assinarReciboForteComEvidenciaCanonica(base, ctx, caso, m.politica, porta);
      assert.equal(resultado.ok, false, forja);
    }
    assert.equal(chamadas, 0, `${forja}: nenhuma entrada inválida chama a porta`);
  }
});

test('a porta recusa principal não nativo ou igual ao construtor mesmo sem o adaptador', () => {
  const base = recibo(), m = material();
  for (const ctx of [{ ...contexto('github'), principalNativo: 'conta-do-builder' },
    { ...contexto('github'), principalNativo: contexto('github').construtor }]) {
    let chamadas = 0;
    const porta = { ...m.porta, assinar: (preImagem: string) => { chamadas++; return m.porta.assinar(preImagem); } };
    assert.equal(assinarReciboForteNaFabrica(base, ctx, m.politica, porta).ok, false);
    assert.equal(chamadas, 0);
  }
});
