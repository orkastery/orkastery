import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChamadorDaApi, PedidoDaApi } from '../src/forja/api';
import type { ErroDaForja, Resultado } from '../src/forja/contrato';
import { criarRedeColetiva } from '../src/rede-empresa-forja';
import { caminhoDaPublicacao, PortaDaBranchEmpresa, transacionarRedeEmpresa } from '../src/rede-empresa-transporte';

const resposta = (corpo: unknown) => ({ ok: true as const, valor: { status: 200, corpo, cabecalhos: {},
  limite: { restante: null, total: null, reiniciaEm: null } } });
const erro = (codigo: ErroDaForja['codigo']): Resultado<never> => ({ ok: false, erro: { codigo, detalhe: codigo } });

function api(regras: Array<(p: PedidoDaApi) => Resultado<ReturnType<typeof resposta> extends { valor: infer T } ? T : never> | null>):
ChamadorDaApi & { chamadas: PedidoDaApi[] } {
  const chamadas: PedidoDaApi[] = [];
  const f = ((p: PedidoDaApi) => {
    chamadas.push(p);
    for (const regra of regras) { const r = regra(p); if (r) return r; }
    return erro('forja.nao-achei');
  }) as ChamadorDaApi & { chamadas: PedidoDaApi[] };
  f.chamadas = chamadas;
  return f;
}

test('rede empresa cria no owner GitHub com accountId estável', () => {
  const a = api([
    (p) => p.metodo === 'GET' && p.caminho === 'user' ? resposta({ id: 41, login: 'login-atual' }) : null,
    (p) => p.metodo === 'GET' && p.caminho === 'orgs/time' ? resposta({ id: 7, login: 'time' }) : null,
    (p) => p.metodo === 'POST' && p.caminho === 'orgs/time/repos' ? resposta({ full_name: 'time/rede', visibility: 'private',
      clone_url: 'https://github.com/time/rede.git' }) : null,
  ]);
  const r = criarRedeColetiva({ tipo: 'github' }, a, 'time', 'rede');
  assert.ok(r.ok);
  assert.deepEqual(r.valor.conta, { accountId: 41, login: 'login-atual' });
  assert.equal(r.valor.repositorio.privado, true);
  assert.ok(a.chamadas.some((p) => p.caminho === 'orgs/time/repos'));
});

test('rede empresa relê o GitHub depois de resposta incerta do POST', () => {
  let leituras = 0;
  const a = api([
    (p) => p.metodo === 'GET' && p.caminho === 'user' ? resposta({ id: 41, login: 'login-atual' }) : null,
    (p) => p.metodo === 'GET' && p.caminho === 'orgs/time' ? resposta({ id: 7, login: 'time' }) : null,
    (p) => p.metodo === 'GET' && p.caminho === 'repos/time/rede' ? (++leituras === 1
      ? erro('forja.nao-achei')
      : resposta({ full_name: 'time/rede', visibility: 'private', clone_url: 'https://github.com/time/rede.git' })) : null,
    (p) => p.metodo === 'POST' && p.caminho === 'orgs/time/repos' ? erro('forja.indisponivel') : null,
  ]);
  const r = criarRedeColetiva({ tipo: 'github' }, a, 'time', 'rede');
  assert.ok(r.ok);
  assert.deepEqual([r.valor.criada, r.valor.repositorio.caminho, r.valor.repositorio.privado], [true, 'time/rede', true]);
  assert.deepEqual(a.chamadas.filter((p) => p.caminho === 'repos/time/rede' || p.caminho === 'orgs/time/repos')
    .map((p) => `${p.metodo} ${p.caminho}`),
  ['GET repos/time/rede', 'POST orgs/time/repos', 'GET repos/time/rede']);
  assert.equal(leituras, 2);
});

test('rede empresa cria no namespace GitLab e relê resposta perdida', () => {
  let leituras = 0;
  const a = api([
    (p) => p.caminho === 'user' ? resposta({ id: 52, username: 'login-atual' }) : null,
    (p) => p.caminho === 'namespaces/grupo%2Fsub' ? resposta({ id: 9, kind: 'group', full_path: 'grupo/sub' }) : null,
    (p) => p.caminho === 'groups/9/members/all/52' ? resposta({ access_level: 40 }) : null,
    (p) => p.metodo === 'POST' && p.caminho === 'projects' ? erro('forja.indisponivel') : null,
    (p) => p.metodo === 'GET' && p.caminho === 'projects/grupo%2Fsub%2Frede' && ++leituras > 1
      ? resposta({ path_with_namespace: 'grupo/sub/rede', visibility: 'private', http_url_to_repo: 'https://gitlab.example/grupo/sub/rede.git' }) : null,
  ]);
  const r = criarRedeColetiva({ tipo: 'gitlab' }, a, 'grupo/sub', 'rede');
  assert.ok(r.ok);
  assert.deepEqual(r.valor.conta, { accountId: 52, login: 'login-atual' });
  const post = a.chamadas.find((p) => p.metodo === 'POST');
  assert.equal((post?.corpo as Record<string, unknown>).namespace_id, 9);
});

test('rede empresa recusa repositório público', () => {
  const a = api([
    (p) => p.caminho === 'user' ? resposta({ id: 1, login: 'pessoa' }) : null,
    (p) => p.caminho === 'repos/pessoa/rede' ? resposta({ full_name: 'pessoa/rede', visibility: 'public',
      clone_url: 'https://github.com/pessoa/rede.git' }) : null,
  ]);
  const r = criarRedeColetiva({ tipo: 'github' }, a, 'pessoa', 'rede');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro.detalhe, /repositorio-publico/);
});

test('CAS recompõe depois da recusa e separa o caminho da inscrição', () => {
  let ponta = 'a', gravacoes = 0, preparos = 0;
  const porta: PortaDaBranchEmpresa = {
    ler: () => ({ id: ponta, atualizada: true, ler: () => null }),
    gravar: () => { gravacoes++; if (gravacoes === 1) { ponta = 'b'; return false; } return 'c'; },
  };
  const r = transacionarRedeEmpresa(porta, (lida) => {
    preparos++;
    return { mensagem: `publica sobre ${lida.id}`, mudancas: [{ caminho: caminhoDaPublicacao('inscricao-a', 'projeto-a'), conteudo: '{}' }] };
  });
  assert.deepEqual([r.acao, r.tentativas, preparos], ['publicou', 2, 2]);
});

test('CAS indisponível fica pendente sem gravar', () => {
  let gravou = false;
  const r = transacionarRedeEmpresa({
    ler: () => ({ id: 'ultima', atualizada: false, ler: () => null }),
    gravar: () => { gravou = true; return 'x'; },
  }, () => ({ mensagem: 'não chega', mudancas: [{ caminho: 'politica.json', conteudo: '{}' }] }));
  assert.deepEqual([r.acao, r.commit, gravou], ['pendente', 'ultima', false]);
});
