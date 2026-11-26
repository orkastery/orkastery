import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import type { RegistrosParaDecisaoDaFabrica } from '../src/ci-fabrica-registros';

const id = process.env.ORK_MUTATION_CHILD;
const grupo = process.env.ORK_MUTATION_GROUP;

if (!id || !grupo) {
  test('C124 a lane adversarial fica fora da lane hermética comum', () => {
    assert.equal(process.env.ORK_MUTATION_CHILD, undefined);
  });
} else {
  test(`[${id}] ${grupo}`, async () => {
    const H = 'a'.repeat(40), V = 'b'.repeat(40), P = 'c'.repeat(40), K = 'd'.repeat(64), D = 'e'.repeat(40);
    if (grupo.startsWith('github-')) {
      const m = await import('../src/ci-fabrica-github');
      const e: import('../src/ci-fabrica-github').EntradaDoGateGithub = { nivel: 'exigir', repositorio: 'g/p',
        destino: 'main', baseDoPedido: 'main', head: H, appIdEsperado: 42, evento: 'pull_request', fork: false,
        relacaoComDestino: 'ahead', listaCompleta: true, protecaoClassica: { padrao: 'main', strict: true,
          checks: [{ nome: m.nomeDecisorioGithub('main'), appId: 42 }] }, rulesets: [] };
      if (grupo === 'github-app') e.protecaoClassica!.checks[0].appId = 7;
      if (grupo === 'github-lista') e.listaCompleta = false;
      if (grupo === 'github-atualizado') e.relacaoComDestino = 'behind';
      if (grupo === 'github-regra') e.protecaoClassica!.padrao = 'release';
      if (grupo === 'github-diagnostico') { e.nivel = 'observar'; e.protecaoClassica = undefined; }
      const r = m.avaliarGateGithub(e);
      if (grupo === 'github-diagnostico') { assert.equal(r.ok, true); if (r.ok) assert.equal(r.decisorio, false); }
      else assert.equal(r.ok, false);
      return;
    }
    if (grupo.startsWith('gitlab-') && grupo !== 'gitlab-sha') {
      const m = await import('../src/ci-fabrica-gitlab');
      const e: import('../src/ci-fabrica-gitlab').EntradaGitlabPago = { nivel: 'exigir', plano: 'premium', projeto: 'g/p',
        iid: 1, origem: 'f', destino: 'main', head: H, headRelido: H, projetoOrigem: 1, projetoDestino: 1,
        estado: 'opened', divergencia: 0, destinoProtegido: true, mergeNivel: 40, pushNivel: 0, forcePush: false,
        contaDaFabrica: 42, escopoDoToken: ['api'], contaRestritaAosProjetos: true, membrosCompletos: true,
        membros: [{ id: 42, nivel: 40 }], comparacaoCompleta: true, compareTimeout: false, baseDeMerge: V,
        commitDoVerify: V, destinoNaPrimeiraLeitura: D, destinoAntesDoEfeito: D, limiteDeOwnerDeclarado: true,
        resetAprovacoesNoPush: true, regraDeAprovacaoEditavelNoMr: false, impedirAprovacaoPeloAutor: true,
        aprovacoesExigidas: 1, aprovacoesValidas: 1, mergeTrainAtivo: false, configuracaoCompleta: true };
      if (grupo === 'gitlab-divergencia') e.divergencia = 1;
      if (grupo === 'gitlab-membros') e.membrosCompletos = false;
      if (grupo === 'gitlab-corrida') e.destinoAntesDoEfeito = 'f'.repeat(40);
      if (grupo === 'gitlab-reset') e.resetAprovacoesNoPush = false;
      if (grupo === 'gitlab-edicao') e.regraDeAprovacaoEditavelNoMr = true;
      if (grupo === 'gitlab-aprovacao') e.aprovacoesValidas = 0;
      assert.equal(m.avaliarGateGitlabPago(e).ok, false);
      return;
    }
    if (grupo === 'gitlab-sha') {
      const m = await import('../src/forja/gitlab/pedidos');
      assert.equal(m.pedidoDeMergeDaFabricaGitlab('g/p', 1, H).corpo.sha, H); return;
    }
    if (grupo.startsWith('registros-')) {
      const m = await import('../src/ci-fabrica-registros');
      const e: import('../src/ci-fabrica-registros').RegistrosParaDecisaoDaFabrica = { forja: 'github', projeto: 'p',
        origem: 'f', destino: 'main', head: H, comandosDoManifesto: [], configuracaoDoDestino: { github_app_id: 42 },
        verifies: [{ commit: H, verde: true, comandos: [], rodadaId: 'r', chaveDeProva: K, posicao: 1 }],
        comparacao: { relacao: 'identical', completa: true, arquivosDesdeVerify: [], commits: [] },
        registrosDeCommit: [], checks: [{ fase: 'CHECK', origem: 'sessions.watch', sessionId: 'revisor',
          despachoEm: '2026-11-26T00:00:00.000Z', despachoRegistrado: true, despachoVerificado: true,
          promptConferido: true, sensorResultId: 's', favoravel: true, parecerSha256: K, shaRevisado: H,
          conducaoId: 'c', posicao: 3 }], tags: [{ conducaoId: 'c', head: H, posicao: 4 }] };
      let esperado = false;
      if (grupo === 'registros-verify') e.verifies[0].verde = false;
      if (grupo === 'registros-check-head') e.checks[0].shaRevisado = V;
      if (grupo === 'registros-revisor') { e.comparacao.commits = [{ sha: P, pais: [V], arquivos: ['x'] }];
        e.registrosDeCommit = [{ tipo: 'commit', commit: P, sessionId: 'revisor', posicao: 2 }]; }
      if (grupo === 'registros-merge') { e.comparacao.commits = [{ sha: P, pais: [V, D], arquivos: ['x'] }]; esperado = true; }
      if (grupo === 'registros-lista') e.comparacao.completa = false;
      if (grupo === 'registros-produto') { e.verifies[0].commit = V; e.comparacao.relacao = 'ahead';
        e.comparacao.arquivosDesdeVerify = ['core/x']; }
      if (grupo === 'registros-tag') e.tags[0].conducaoId = 'outra';
      if (grupo === 'registros-ultimo') e.verifies.push({ ...e.verifies[0], verde: false, posicao: 2 });
      assert.equal(m.conferirRegistrosDaFabrica(e).ok, esperado); return;
    }
    if (grupo.startsWith('servico-')) {
      const m = await import('../src/ci-fabrica-servico');
      const e: RegistrosParaDecisaoDaFabrica = { forja: 'github', projeto: 'p', origem: 'f', destino: 'main',
        head: H, comandosDoManifesto: [], configuracaoDoDestino: { github_app_id: 42 }, verifies: [{ commit: H,
          verde: true, comandos: [], rodadaId: 'r', chaveDeProva: K, posicao: 1 }], comparacao: { relacao: 'identical',
          completa: true, arquivosDesdeVerify: [], commits: [] }, registrosDeCommit: [], checks: [{ fase: 'CHECK',
          origem: 'sessions.watch', sessionId: 'r', despachoEm: '2026-11-26T00:00:00.000Z', despachoRegistrado: true,
          despachoVerificado: true, promptConferido: true, sensorResultId: 's', favoravel: true, parecerSha256: K,
          shaRevisado: H, conducaoId: 'c', posicao: 2 }], tags: [{ conducaoId: 'c', head: H, posicao: 3 }] };
      const ordem: string[] = [];
      const evento = { id: 'e', assinaturaValida: grupo !== 'servico-assinatura',
        emitidoEm: grupo === 'servico-janela' ? '2026-11-25T00:00:00.000Z' : '2026-11-26T10:00:00.000Z',
        recebidoEm: '2026-11-26T10:01:00.000Z' };
      const r = m.processarEventoDaFabrica(evento, 'exigir', { reler: () => e,
        persistir: () => { ordem.push('persistir'); }, publicar: () => { ordem.push('publicar'); } });
      if (grupo === 'servico-persistencia') assert.deepEqual(ordem, ['persistir', 'publicar']);
      else assert.equal(r.estado, 'bloqueado');
      return;
    }
    if (grupo.startsWith('resultado-')) {
      const m = await import('../src/ci-fabrica-resultado');
      const chaves = generateKeyPairSync('ed25519');
      const prova = { forja: 'github' as const, projeto: 'p', origem: 'f', destino: 'main', head: H,
        verify: { commit: V, verde: true, comandos: [], rodadaId: 'r', chaveDeProva: K, posicao: 1 },
        check: { fase: 'CHECK' as const, origem: 'sessions.watch' as const, sessionId: 'r',
          despachoEm: '2026-11-26T00:00:00.000Z', despachoRegistrado: true, despachoVerificado: true,
          promptConferido: true, sensorResultId: 's', favoravel: true, parecerSha256: K, shaRevisado: H,
          conducaoId: 'c', posicao: 2 }, tag: { conducaoId: 'c', head: H, posicao: 3 }, construtores: [],
        commitsDeProduto: [], configuracaoDoDestino: { github_app_id: 42 } };
      const porta = { contrato: 'ork.ci-recibo-forte-signing-port/v2' as const, emissor: 'e', chaveId: 'k',
        exclusiva: true as const, assinar: (s: string) => sign(null, Buffer.from(s), chaves.privateKey).toString('base64') };
      if (grupo === 'resultado-operacao') {
        assert.throws(() => m.emitirResultadoForteDaFabrica(prova, '2026-11-26T10:00:00.000Z',
          '2026-11-26T11:00:00.000Z', porta, { operation: 'outra' as 'ci.run', projeto: 'p', origem: 'f', destino: 'main', head: H }));
        return;
      }
      const r = m.emitirResultadoForteDaFabrica(prova, '2026-11-26T10:00:00.000Z', '2026-11-26T11:00:00.000Z', porta);
      const politica = { emissor: 'e', chaves: [{ id: 'k', materialPublicoPem: chaves.publicKey.export({ type: 'spki',
        format: 'pem' }).toString(), validaDesde: '2026-01-01T00:00:00.000Z', validaAte: '2027-01-01T00:00:00.000Z',
        ...(grupo === 'resultado-revogacao' ? { revogadaEm: '2026-11-26T10:01:00.000Z' } : {}) }] };
      const esperado = { projeto: grupo === 'resultado-vinculo' ? 'outro' : 'p', origem: 'f', destino: 'main', head: H };
      const agora = grupo === 'resultado-validade' ? '2026-11-26T11:00:00.000Z' : '2026-11-26T10:30:00.000Z';
      assert.equal(m.verificarResultadoForteDaFabrica(r, politica, esperado, agora).ok, false); return;
    }
    if (grupo.startsWith('ship-')) {
      const m = await import('../src/ship');
      const e: import('../src/ship').EntradaDoShipComFabrica = { configurada: true, nivel: 'exigir', forja: 'github',
        destino: 'main', head: H, resultado: { valido: grupo !== 'ship-decisao', destino: 'main', head: H, githubAppId: 42 },
        github: { appIdEsperado: 42, checkVerde: true }, ci: { state: grupo === 'ship-veto' ? 'failure' : 'success' } };
      assert.equal(m.decidirShipComFabrica(e).ok, false); return;
    }
    assert.fail(`grupo desconhecido: ${grupo}`);
  });
}
