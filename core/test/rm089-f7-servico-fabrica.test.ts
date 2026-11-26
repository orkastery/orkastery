import assert from 'node:assert/strict';
import test from 'node:test';
import { fabricaCiDoTextoDoManifesto } from '../src/manifest';
import { conferirRegistrosDaFabrica, type RegistrosParaDecisaoDaFabrica } from '../src/ci-fabrica-registros';
import { processarEventoDaFabrica, type DecisaoDaFabrica } from '../src/ci-fabrica-servico';

const H = 'a'.repeat(40), V = 'b'.repeat(40), P = 'c'.repeat(40), K = 'd'.repeat(64);
const base = (): RegistrosParaDecisaoDaFabrica => ({
  forja: 'github', projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H,
  comandosDoManifesto: ['npm test'], configuracaoDoDestino: { github_app_id: 42 },
  verifies: [{ commit: V, verde: true, comandos: ['npm test'], rodadaId: 'rodada', chaveDeProva: K, posicao: 10 }],
  comparacao: { relacao: 'ahead', completa: true, arquivosDesdeVerify: ['.ork-ci/prova.json'],
    commits: [{ sha: P, pais: [V], arquivos: ['core/src/alvo.ts'] }, { sha: H, pais: [P], arquivos: ['.ork-ci/prova.json'] }] },
  registrosDeCommit: [{ tipo: 'mcp_git_committed', commit: P, sessionId: 'construtor', posicao: 11 }],
  checks: [{ fase: 'CHECK', origem: 'sessions.watch', sessionId: 'revisor', despachoEm: '2026-11-26T10:00:00.000Z',
    despachoRegistrado: true, despachoVerificado: true, promptConferido: true, sensorResultId: 'sensor', favoravel: true,
    parecerSha256: K, shaRevisado: H, conducaoId: 'condutora', posicao: 12 }],
  tags: [{ conducaoId: 'condutora', head: H, posicao: 13 }],
});

test('C127 aceita último verify verde, mudança só do bundle, CHECK independente no HEAD e tag da condução', () => {
  const r = conferirRegistrosDaFabrica(base());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.prova.commitsDeProduto, [P]);
});

test('C127 falha fechado com verde antigo, lista truncada, produto sem registro ou CHECK de construtor e de outro SHA', () => {
  const casos = [
    (e: RegistrosParaDecisaoDaFabrica) => { e.verifies.push({ ...e.verifies[0], verde: false, posicao: 20 }); },
    (e: RegistrosParaDecisaoDaFabrica) => { e.comparacao.completa = false; },
    (e: RegistrosParaDecisaoDaFabrica) => { e.registrosDeCommit = []; },
    (e: RegistrosParaDecisaoDaFabrica) => { e.checks[0].sessionId = 'construtor'; },
    (e: RegistrosParaDecisaoDaFabrica) => { e.checks[0].shaRevisado = V; },
  ];
  for (const mudar of casos) { const e = base(); mudar(e); assert.equal(conferirRegistrosDaFabrica(e).ok, false); }
});

test('A110 mede a ordem pelo ledger e considera construtor anterior', () => {
  const e = base();
  e.comparacao.commits.unshift({ sha: 'e'.repeat(40), pais: [V], arquivos: ['core/src/anterior.ts'] });
  e.registrosDeCommit.unshift({ tipo: 'commit', commit: 'e'.repeat(40), sessionId: 'outro-construtor', posicao: 9 });
  e.checks[0].sessionId = 'outro-construtor';
  assert.equal(conferirRegistrosDaFabrica(e).ok, false);
  e.checks[0].sessionId = 'revisor';
  e.checks[0].posicao = 8;
  assert.equal(conferirRegistrosDaFabrica(e).ok, false);
});

test('ci.fabrica lê somente os ids públicos e recusa segredo ou mapa vazio', () => {
  const prefixo = 'project:\n  name: p\n  abbrev: p\n  stage: nascente\nci:\n  fabrica:\n';
  assert.deepEqual(fabricaCiDoTextoDoManifesto(`${prefixo}    github_app_id: 42\n`), { github_app_id: 42 });
  assert.equal(fabricaCiDoTextoDoManifesto(`${prefixo}    token: segredo\n`), null);
  assert.equal(fabricaCiDoTextoDoManifesto(`${prefixo}`), null);
});

test('evento só dispara releitura e persistência acontece antes da publicação', () => {
  const ordem: string[] = [], gravadas: DecisaoDaFabrica[] = [];
  const d = processarEventoDaFabrica({ id: 'evt', assinaturaValida: true,
    emitidoEm: '2026-11-26T10:00:00.000Z', recebidoEm: '2026-11-26T10:01:00.000Z' }, 'exigir', {
    reler: () => { ordem.push('reler'); return base(); },
    persistir: (v) => { ordem.push('persistir'); gravadas.push(v); }, publicar: () => { ordem.push('publicar'); },
  });
  assert.equal(d.estado, 'liberado');
  assert.deepEqual(ordem, ['reler', 'persistir', 'publicar']);
  assert.equal(gravadas[0], d);
});

test('observar e avisar só diagnosticam; exigir bloqueia indisponibilidade e prazo', () => {
  const evento = { id: 'evt', assinaturaValida: true,
    emitidoEm: '2026-11-26T10:00:00.000Z', recebidoEm: '2026-11-26T10:01:00.000Z' };
  const rodar = (nivel: 'observar' | 'avisar' | 'exigir', erro: Error) => processarEventoDaFabrica(evento, nivel, {
    reler: () => { throw erro; }, persistir: () => undefined, publicar: () => undefined,
  });
  assert.equal(rodar('observar', new Error()).estado, 'diagnostico');
  assert.equal(rodar('avisar', new Error()).estado, 'diagnostico');
  assert.equal(rodar('exigir', new Error()).estado, 'bloqueado');
  const timeout = new Error(); timeout.name = 'TimeoutError';
  assert.equal(rodar('exigir', timeout).codigo, 'ci.fabrica.prazo-excedido');
});
