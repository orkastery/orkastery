import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { novaThread } from '../src/thread';
import { ship } from '../src/ship';
import { criarPortaDaFabricaNoShip } from '../src/ship-fabrica';
import type { ChamadorDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import { commitar, projetoTemporario } from './apoio';

const manifesto = `ci:
  politica_recibo: exigir
  fabrica:
    github_app_id: 731
`;

test('ship consulta na forja o check decisório exato do destino, HEAD e App', () => {
  const projeto = projetoTemporario('rm089-f7-ship-fabrica', true);
  const { thread } = novaThread(projeto.carregado, { nome: 'ship fabrica', modo: 'auto', criarWorktree: true });
  const head = commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega pela fabrica');
  const forja: ForjaResolvida = { tipo: 'github', host: 'github.com', porta: null, caminhoBase: '', sshHost: null,
    sshPorta: null, ca: null, repo: 'exemplo/projeto', origem: { tipo: 'manifesto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };
  const caminhos: string[] = [];
  const api: ChamadorDaApi = (pedido) => {
    caminhos.push(pedido.caminho);
    return { ok: true, valor: { status: 200, cabecalhos: {}, limite: { restante: null, total: null, reiniciaEm: null },
      corpo: { total_count: 1, check_runs: [{ id: 8, name: 'ork-fabrica/utf8-6d61696e', head_sha: head,
        status: 'completed', conclusion: 'success', app: { id: 731 } }] } } };
  };
  const portaDaFabrica = criarPortaDaFabricaNoShip(projeto.carregado, {
    lerManifestoDestino: () => manifesto, resolver: () => forja, criarApi: () => api,
  });

  const resultado = ship(projeto.carregado, thread.id, { para: 'main', portaDaFabrica });

  assert.equal(resultado.ok, true, resultado.detalhe);
  assert.equal(caminhos.length, 1);
  assert.match(caminhos[0], new RegExp(`/commits/${head}/check-runs\\?`));
  assert.match(caminhos[0], /check_name=ork-fabrica%2Futf8-6d61696e/);
  projeto.limpar();
});

test('ship falha fechado quando o check decisório não vem do App configurado', () => {
  const projeto = projetoTemporario('rm089-f7-ship-fabrica-app', true);
  const { thread } = novaThread(projeto.carregado, { nome: 'ship fabrica app', modo: 'auto', criarWorktree: true });
  const head = commitar(thread.worktree as string, 'entrega.md', '# entrega\n', 'feat: entrega pela fabrica');
  const forja: ForjaResolvida = { tipo: 'github', host: 'github.com', porta: null, caminhoBase: '', sshHost: null,
    sshPorta: null, ca: null, repo: 'exemplo/projeto', origem: { tipo: 'manifesto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };
  const api: ChamadorDaApi = () => ({ ok: true, valor: { status: 200, cabecalhos: {},
    limite: { restante: null, total: null, reiniciaEm: null }, corpo: { total_count: 1,
      check_runs: [{ id: 9, name: 'ork-fabrica/utf8-6d61696e', head_sha: head,
        status: 'completed', conclusion: 'success', app: { id: 999 } }] } } });
  const portaDaFabrica = criarPortaDaFabricaNoShip(projeto.carregado, {
    lerManifestoDestino: () => manifesto, resolver: () => forja, criarApi: () => api,
  });

  const resultado = ship(projeto.carregado, thread.id, { para: 'main', portaDaFabrica });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'ci.failed');
  projeto.limpar();
});
