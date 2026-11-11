import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextoDaVarredura } from '../src/dado-privado';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import type { ProjetoNoPanorama } from '../src/network-roadmap';
import { registrarInscricaoEmpresa, revogarInscricaoEmpresa, sairDaRedeEmpresa } from '../src/rede-empresa';
import { CONTRATO_INSCRICAO_EMPRESA, CONTRATO_POLITICA_EMPRESA, type InscricaoDaEmpresa,
  MAX_BYTES_PUBLICACAO_EMPRESA, MAX_ITENS_PUBLICACAO_EMPRESA, MAX_LACUNAS_PUBLICACAO_EMPRESA,
  MAX_RESERVAS_PUBLICACAO_EMPRESA, MAX_TRABALHOS_PUBLICACAO_EMPRESA, type PublicacaoDaEmpresa,
  type ReferenciaDaForja } from '../src/rede-empresa-contrato';
import { publicarNaRedeEmpresa, type PedidoDePublicacaoEmpresa } from '../src/rede-empresa-publicacao';
import { statusDaRedeEmpresa } from '../src/rede-empresa-status';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

class Branch implements PortaDaBranchEmpresa {
  id: string | null = 'c0';
  atualizada = true;
  rejeicoes = 0;
  arquivos = new Map<string, string>();
  historico: string[] = [];
  aoRejeitar: (() => void) | null = null;
  ler() { return { id: this.id, atualizada: this.atualizada, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    if (this.rejeicoes-- > 0) {
      this.id = `c${Number(this.id?.slice(1) ?? 0) + 1}`;
      const corrida = this.aoRejeitar; this.aoRejeitar = null; corrida?.();
      return false;
    }
    for (const m of mudancas) if (m.conteudo === null) this.arquivos.delete(m.caminho); else {
      this.arquivos.set(m.caminho, m.conteudo); this.historico.push(m.conteudo);
    }
    this.id = `c${Number(this.id?.slice(1) ?? 0) + 1}`;
    return this.id;
  }
}

const agora = '2026-11-11T00:00:00.000Z';
const ref = (caminho: string): ReferenciaDaForja => ({ forja: 'github', host: 'github.com', caminho });
const privacidade: ContextoDaVarredura = { raiz: '/tmp/repositorio-de-teste',
  excecoes: { presente: false, emailsPermitidos: [], excecoes: [] },
  lista: { presente: true, procurada: ['lista de teste'], lidos: ['lista de teste'],
    termos: ['cliente-real', 'maquina-pessoal'], ignorados: 0, versionados: [], recusada: null } };

function inscricao(id: string, rede: string, estado: InscricaoDaEmpresa['estado'] = 'ativa'): InscricaoDaEmpresa {
  return { contrato: CONTRATO_INSCRICAO_EMPRESA, inscricaoId: id, rede: ref(rede),
    maestroRef: { forja: 'github', host: 'github.com', accountId: id === 'inscricao-a' ? 41 : 42 },
    loginAtual: `login-${id}`, projetos: [ref('time/projeto')], politicaVersao: 'v1', estado,
    registradaEm: agora, aceitaEm: agora, atualizadaEm: agora };
}

function panorama(): ProjetoNoPanorama {
  return {
    projeto: { nome: 'cliente-real', forja: 'github', clone: '/home/pessoa/cliente-real', base: 'main', origem: 'cwd', fuso: 'UTC' },
    roadmap: { contrato: 'ork.roadmap-status/v1', consultadoEm: agora, projeto: 'cliente-real', grupos: [
      { id: 'desenvolvimento', icone: 'x', titulo: 'Projeto cliente-real', itens: [
        { id: 'RM-089', titulo: 'Dado da pessoa', ciclo: 'Em desenvolvimento', grupo: 'desenvolvimento', emAberto: [], threads: [] },
      ] }], precisaDeVoce: [], emSeguida: [] },
    reservas: [{ contrato: 'ork.roadmap-reserva/v1', item: 'RM-089', por: 'pessoa@example.net', maquina: 'maquina-pessoal',
      thread: 'thread-interna', nota: '/home/pessoa/segredo', desdeEm: agora, atualizadaEm: agora }],
    maquinas: [{ maquina: 'maquina-pessoal', por: 'pessoa@example.net', publicadoEm: agora, idadeMin: 0, semBatida: false,
      estaMaquina: true, origem: 'estado-local', versaoOrk: '0.0.0', entreguesSemMaster: 0, threadsLidas: true,
      ativas: [{ id: 'thread-interna', nome: 'cliente-real', modo: '#Auto', fase: 'GO', status: 'aberta',
        roadmap: 'RM-089', branch: '/home/pessoa/branch', atualizadaEm: agora, entregue: null, esperaVoce: false,
        pergunta: null, paradaDesde: null }] }],
    fontes: [{ parte: 'roadmap', origem: 'clone', onde: '/home/pessoa/cliente-real', ref: 'main', commit: 'abcdef0',
      dataDoCommit: agora, lidoEm: agora, atualizado: true, existe: true }],
    lacunas: [{ tipo: 'reservas.sem-branch', parte: 'reservas', alvo: 'maquina-pessoal', detalhe: '/home/pessoa', correcao: 'cliente-real' }],
  };
}

function pedido(id: string, instante = agora, projeto = panorama()): PedidoDePublicacaoEmpresa {
  return { inscricaoId: id, projetoRef: 'projeto-a', projeto: ref('time/projeto'), panorama: projeto,
    conta: { accountId: id === 'inscricao-a' ? 41 : 42, login: `login-${id}` }, forja: 'github', host: 'github.com',
    agora: instante, privacidade };
}

function preparada(): Branch {
  const b = new Branch();
  b.arquivos.set('politica.json', `${JSON.stringify({ contrato: CONTRATO_POLITICA_EMPRESA, versao: 'v1', saida: 'permitida', publicacaoMinima: 1 }, null, 2)}\n`);
  for (const i of [inscricao('inscricao-a', 'time/rede-a'), inscricao('inscricao-b', 'time/rede-b')])
    b.arquivos.set(`inscricoes/${i.inscricaoId}.json`, `${JSON.stringify(i, null, 2)}\n`);
  return b;
}

test('duas redes inscritas publicam em caminhos próprios', () => {
  const b = preparada();
  const a = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
  const c = publicarNaRedeEmpresa(b, pedido('inscricao-b'));
  assert.equal(a.ok && c.ok, true);
  assert.ok(b.arquivos.has('publicacoes/inscricao-a/projeto-a.json'));
  assert.ok(b.arquivos.has('publicacoes/inscricao-b/projeto-a.json'));
  for (const id of ['inscricao-a', 'inscricao-b']) {
    const publicada = JSON.parse(b.arquivos.get(`publicacoes/${id}/projeto-a.json`)!) as PublicacaoDaEmpresa;
    assert.deepEqual(publicada.itens, [{ id: 'RM-089', estado: 'desenvolvimento' }]);
    assert.equal(publicada.reservas[0].itemId, 'RM-089');
    assert.match(String(publicada.reservas[0].threadRef), /^thread-[0-9a-f]{24}$/);
    assert.deepEqual([publicada.trabalhos[0].fase, publicada.trabalhos[0].itemId], ['GO', 'RM-089']);
    assert.match(publicada.trabalhos[0].threadRef, /^thread-[0-9a-f]{24}$/);
    assert.deepEqual(publicada.fontes, [{ parte: 'roadmap', atualizado: true, lidoEm: agora, commit: 'abcdef0' }]);
    assert.deepEqual(publicada.lacunas, [{ tipo: 'reservas.sem-branch', parte: 'reservas' }]);
  }
});

test('publicação recompõe depois da concorrência na branch', () => {
  const b = preparada(); b.rejeicoes = 1;
  const r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.transacao.tentativas, 2);
});

test('projeção idêntica em outro instante é no-op e preserva o carimbo publicado', () => {
  const b = preparada();
  const primeira = publicarNaRedeEmpresa(b, pedido('inscricao-a', agora));
  const gravacoes = b.historico.length;
  const depois = '2026-11-11T01:00:00.000Z';
  const segunda = publicarNaRedeEmpresa(b, pedido('inscricao-a', depois));
  assert.equal(primeira.ok, true);
  assert.equal(segunda.ok, true);
  if (segunda.ok) assert.deepEqual([segunda.transacao.acao, segunda.valor.publicadoEm], ['sem-mudanca', agora]);
  assert.equal(b.historico.length, gravacoes);
});

test('outra conta, outro host ou outra forja não publicam nem criam commit depois do aceite', () => {
  const divergencias: Array<[string, Partial<PedidoDePublicacaoEmpresa>]> = [
    ['conta', { conta: { accountId: 99, login: 'outra' } }],
    ['host', { host: 'git.exemplo.invalid' }],
    ['forja', { forja: 'gitlab' }],
  ];
  for (const [nome, mudanca] of divergencias) {
    const b = preparada(), r = publicarNaRedeEmpresa(b, { ...pedido('inscricao-a'), ...mudanca });
    assert.deepEqual([nome, r.ok, r.ok ? '' : r.codigo, b.historico.length],
      [nome, false, 'rede-empresa.identidade-divergente', 0]);
    assert.equal(b.arquivos.has('publicacoes/inscricao-a/projeto-a.json'), false);
  }
});

test('cinco conflitos esgotam as tentativas sem criar publicação', () => {
  const b = preparada(); b.rejeicoes = 5;
  const r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
  assert.deepEqual([r.ok, r.ok ? '' : r.codigo, r.transacao?.tentativas, b.historico.length],
    [false, 'rede-empresa.concorrencia', 5, 0]);
  assert.equal(b.arquivos.has('publicacoes/inscricao-a/projeto-a.json'), false);
});

test('revogação ou saída que vence entre tentativas barra a publicação concorrente', () => {
  for (const estado of ['revogada', 'encerrada'] as const) {
    const b = preparada(); b.rejeicoes = 1;
    b.aoRejeitar = () => {
      const atual = JSON.parse(b.arquivos.get('inscricoes/inscricao-a.json')!) as InscricaoDaEmpresa;
      b.arquivos.set('inscricoes/inscricao-a.json', `${JSON.stringify({ ...atual, estado }, null, 2)}\n`);
    };
    const r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
    assert.deepEqual([estado, r.ok, r.ok ? '' : r.codigo, b.historico.length],
      [estado, false, 'rede-empresa.inscricao-inativa', 0]);
    assert.equal(b.arquivos.has('publicacoes/inscricao-a/projeto-a.json'), false);
  }
});

test('caminho público recusa excesso de itens, reservas, trabalhos e lacunas antes de gravar', () => {
  const casos: Array<[string, (p: ProjetoNoPanorama) => void]> = [
    ['itens', (p) => { p.roadmap!.grupos[0].itens = Array.from({ length: MAX_ITENS_PUBLICACAO_EMPRESA + 1 }, (_, i) =>
      ({ id: `RM-${i}`, titulo: 'x', ciclo: 'x', grupo: 'proposto', emAberto: [], threads: [] })); }],
    ['reservas', (p) => { p.reservas = Array.from({ length: MAX_RESERVAS_PUBLICACAO_EMPRESA + 1 }, (_, i) =>
      ({ contrato: 'ork.roadmap-reserva/v1', item: `RM-${i}`, por: 'x', maquina: 'x', thread: null, nota: '', desdeEm: agora, atualizadaEm: agora })); }],
    ['trabalhos', (p) => { p.maquinas![0].ativas = Array.from({ length: MAX_TRABALHOS_PUBLICACAO_EMPRESA + 1 }, (_, i) =>
      ({ id: `thread-${i}`, nome: 'x', modo: '#Auto', fase: 'GO', status: 'aberta', roadmap: null, branch: 'x', atualizadaEm: agora,
        entregue: null, esperaVoce: false, pergunta: null, paradaDesde: null })); }],
    ['lacunas', (p) => { p.lacunas = Array.from({ length: MAX_LACUNAS_PUBLICACAO_EMPRESA + 1 }, () =>
      ({ tipo: 'roadmap.sem-leitura', parte: 'roadmap', detalhe: 'x', correcao: 'x' })); }],
  ];
  for (const [nome, alterar] of casos) {
    const b = preparada(), p = panorama(); alterar(p);
    const r = publicarNaRedeEmpresa(b, pedido('inscricao-a', agora, p));
    assert.deepEqual([nome, r.ok, r.ok ? '' : r.codigo, b.historico.length], [nome, false, 'rede-empresa.projecao-invalida', 0]);
  }
});

test('caminho público recusa serializado acima do limite de bytes dentro das cardinalidades', () => {
  const b = preparada(), p = panorama();
  const longo = (i: number) => `RM-${String(i).padStart(5, '0')}-${'x'.repeat(115)}`;
  p.roadmap!.grupos[0].itens = Array.from({ length: MAX_ITENS_PUBLICACAO_EMPRESA }, (_, i) =>
    ({ id: longo(i), titulo: 'x', ciclo: 'x', grupo: 'proposto', emAberto: [], threads: [] }));
  p.reservas = Array.from({ length: MAX_RESERVAS_PUBLICACAO_EMPRESA }, (_, i) =>
    ({ contrato: 'ork.roadmap-reserva/v1', item: longo(i), por: 'x', maquina: 'x', thread: null, nota: '', desdeEm: agora, atualizadaEm: agora }));
  assert.ok(Buffer.byteLength(JSON.stringify(p), 'utf8') > MAX_BYTES_PUBLICACAO_EMPRESA);
  const r = publicarNaRedeEmpresa(b, pedido('inscricao-a', agora, p));
  assert.deepEqual([r.ok, r.ok ? '' : r.codigo, b.historico.length], [false, 'rede-empresa.projecao-invalida', 0]);
});

test('revogação e saída cessam novos envios', () => {
  for (const encerrar of ['revogar', 'sair'] as const) {
    const b = preparada();
    const transicao = encerrar === 'revogar'
      ? revogarInscricaoEmpresa(b, 'inscricao-a', agora)
      : sairDaRedeEmpresa(b, 'inscricao-a', agora, { accountId: 41, login: 'login' }, 'github', 'github.com');
    assert.equal(transicao.ok, true);
    const antes = b.historico.length, r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
    assert.deepEqual([r.ok, r.ok ? '' : r.codigo, b.historico.length], [false, 'rede-empresa.inscricao-inativa', antes]);
  }
});

test('forja indisponível não grava e o status mostra a pendência', () => {
  const b = preparada(); b.atualizada = false;
  const r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
  assert.deepEqual([r.ok, r.ok ? '' : r.codigo, b.historico.length], [false, 'rede-empresa.forja-indisponivel', 0]);
  const status = statusDaRedeEmpresa(b, 'inscricao-a', 'projeto-a', {});
  assert.equal(status.forjaAtualizada, false);
  assert.equal(status.pendencia?.codigo, 'rede-empresa.forja-indisponivel');
});

test('JSON remoto inválido vira erro tipado em registrar, publicar e status sem ecoar conteúdo', () => {
  const invalido = '{json-invalido-conteudo-nao-confiavel';

  const politica = new Branch();
  politica.arquivos.set('politica.json', invalido);
  const registro = registrarInscricaoEmpresa(politica, { inscricaoId: 'inscricao-a', rede: ref('time/rede'),
    maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'login', projetos: [ref('time/projeto')],
    politicaVersao: 'v1', agora });
  assert.deepEqual([registro.ok, registro.ok ? '' : registro.codigo, politica.historico.length],
    [false, 'rede-empresa.documento-remoto-invalido', 0]);

  const inscricaoInvalida = preparada();
  inscricaoInvalida.arquivos.set('inscricoes/inscricao-a.json', invalido);
  const publicacao = publicarNaRedeEmpresa(inscricaoInvalida, pedido('inscricao-a'));
  assert.deepEqual([publicacao.ok, publicacao.ok ? '' : publicacao.codigo, inscricaoInvalida.historico.length],
    [false, 'rede-empresa.documento-remoto-invalido', 0]);

  const publicacaoInvalida = preparada();
  publicacaoInvalida.arquivos.set('publicacoes/inscricao-a/projeto-a.json', invalido);
  assert.throws(() => statusDaRedeEmpresa(publicacaoInvalida, 'inscricao-a', 'projeto-a', {}), (erro: unknown) => {
    const tipado = erro as { codigo?: string; message?: string };
    assert.equal(tipado.codigo, 'rede-empresa.documento-remoto-invalido');
    assert.doesNotMatch(JSON.stringify(tipado), /json-invalido-conteudo-nao-confiavel/);
    return true;
  });
  assert.doesNotMatch(JSON.stringify({ registro, publicacao }), /json-invalido-conteudo-nao-confiavel/);
});
