import assert from 'node:assert/strict';
import test from 'node:test';
import { fabricaCiDoTextoDoManifesto } from '../src/manifest';
import { conferirRegistrosDaFabrica, type RegistrosParaDecisaoDaFabrica } from '../src/ci-fabrica-registros';
import { processarEventoDaFabrica, type DecisaoDaFabrica } from '../src/ci-fabrica-servico';

const H = 'a'.repeat(40), V = 'b'.repeat(40), P = 'c'.repeat(40), K = 'd'.repeat(64);
const base = (): RegistrosParaDecisaoDaFabrica => ({
  forja: 'github', projeto: 'grupo/projeto', origem: 'feature', destino: 'main', head: H,
  nivelDoDestino: 'exigir', comandosDoManifesto: ['npm test'], configuracaoDoDestino: { github_app_id: 42 },
  configuracaoDoCheckout: { github_app_id: 7 }, identidadeRelidaDaFabrica: 42, chaveDeProvaDoArtefato: K,
  verifies: [{ commit: V, verde: true, comandos: ['npm test'], rodadaId: 'rodada', chaveDeProva: K, posicao: 10 }],
  comparacao: { relacao: 'ahead', completa: true, arquivosDesdeVerify: ['.ork-ci/prova.json'],
    commits: [{ sha: P, pais: [V], arquivos: ['core/src/alvo.ts'] }, { sha: H, pais: [P], arquivos: ['.ork-ci/prova.json'] }] },
  registrosDeCommit: [{ tipo: 'mcp_git_committed', commit: P, sessionId: 'construtor', posicao: 11 }],
  checks: [{ fase: 'CHECK', origem: 'sessions.watch', sessionId: 'revisor', despachoEm: '2026-11-26T10:00:00.000Z',
    despachoRegistrado: true, despachoVerificado: true, promptConferido: true, sensorResultId: 'sensor', favoravel: true,
    parecerSha256: K, shaRevisado: V, conducaoId: 'condutora', posicao: 12 }],
  tags: [{ conducaoId: 'condutora', head: H, posicao: 13 }],
});

test('C127 aceita último verify verde, chave igual, mudança só do bundle, CHECK no verify e tag no HEAD', () => {
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
    (e: RegistrosParaDecisaoDaFabrica) => { e.checks[0].shaRevisado = H; },
    (e: RegistrosParaDecisaoDaFabrica) => { e.chaveDeProvaDoArtefato = 'e'.repeat(64); },
    (e: RegistrosParaDecisaoDaFabrica) => { e.identidadeRelidaDaFabrica = 7; },
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
    emitidoEm: '2026-11-26T10:00:00.000Z', recebidoEm: '2026-11-26T10:01:00.000Z' }, {
    reler: () => { ordem.push('reler'); return base(); },
    avaliarDestino: () => null, revalidarAntesDoEfeito: () => true, emitirResultado: () => ({ sha256: K }),
    persistir: (v) => { ordem.push('persistir'); gravadas.push(v); }, publicar: () => { ordem.push('publicar'); },
  });
  assert.equal(d.estado, 'liberado');
  assert.deepEqual(ordem, ['reler', 'persistir', 'publicar']);
  assert.equal(gravadas[0], d);
  assert.equal(d.fatosRelidos?.configuracaoDoDestino?.github_app_id, 42);
  assert.match(d.digestCanonico ?? '', /^[a-f0-9]{64}$/);
});

test('reentrega sempre relê e o id do evento não substitui o digest dos fatos', () => {
  const evento = { id: 'evt', assinaturaValida: true, emitidoEm: '2026-11-26T10:00:00.000Z',
    recebidoEm: '2026-11-26T10:01:00.000Z', headInformado: 'f'.repeat(40) };
  let releituras = 0, anterior: DecisaoDaFabrica | null = null;
  const portas = (fatos: RegistrosParaDecisaoDaFabrica) => ({ reler: () => { releituras++; return fatos; },
    jaProcessado: () => anterior, avaliarDestino: () => null, revalidarAntesDoEfeito: () => true,
    emitirResultado: () => ({ sha256: K }), persistir: (d: DecisaoDaFabrica) => { anterior = d; },
    publicar: () => undefined });
  const primeira = processarEventoDaFabrica(evento, portas(base()));
  const segunda = processarEventoDaFabrica(evento, portas(base()));
  assert.equal(segunda, primeira);
  const mudados = base(); mudados.configuracaoDoCheckout = { github_app_id: 8 };
  const terceira = processarEventoDaFabrica(evento, portas(mudados));
  assert.notEqual(terceira.digestCanonico, primeira.digestCanonico);
  assert.equal(releituras, 3);
});

test('observar e avisar só diagnosticam; exigir bloqueia indisponibilidade e prazo', () => {
  const evento = { id: 'evt', assinaturaValida: true,
    emitidoEm: '2026-11-26T10:00:00.000Z', recebidoEm: '2026-11-26T10:01:00.000Z' };
  const rodar = (nivel: 'observar' | 'avisar' | 'exigir', erro: Error) => processarEventoDaFabrica(evento, {
    reler: () => { const e = base(); e.nivelDoDestino = nivel; return e; }, avaliarDestino: () => { throw erro; },
    revalidarAntesDoEfeito: () => true, emitirResultado: () => ({ sha256: K }),
    persistir: () => undefined, publicar: () => undefined,
  });
  assert.equal(rodar('observar', new Error()).estado, 'diagnostico');
  assert.equal(rodar('avisar', new Error()).estado, 'diagnostico');
  assert.equal(rodar('exigir', new Error()).estado, 'bloqueado');
  const timeout = new Error(); timeout.name = 'TimeoutError';
  assert.equal(rodar('exigir', timeout).codigo, 'ci.fabrica.prazo-excedido');
});

test('porta ausente e erro de emissão são falha de prova em exigir', () => {
  const evento = { id: 'evt', assinaturaValida: true, emitidoEm: '2026-11-26T10:00:00.000Z',
    recebidoEm: '2026-11-26T10:01:00.000Z' };
  const comum = { reler: base, persistir: () => undefined, publicar: () => undefined };
  assert.equal(processarEventoDaFabrica(evento, comum).codigo, 'ci.fabrica.prova-ausente');
  const d = processarEventoDaFabrica(evento, { ...comum, avaliarDestino: () => null,
    revalidarAntesDoEfeito: () => true, emitirResultado: () => { throw new Error('assinatura recusada'); } });
  assert.equal(d.codigo, 'ci.fabrica.prova-ausente');
});
