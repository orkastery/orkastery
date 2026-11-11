import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextoDaVarredura } from '../src/dado-privado';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import type { ProjetoNoPanorama } from '../src/network-roadmap';
import { revogarInscricaoEmpresa, sairDaRedeEmpresa } from '../src/rede-empresa';
import { CONTRATO_INSCRICAO_EMPRESA, CONTRATO_POLITICA_EMPRESA, type InscricaoDaEmpresa,
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
  ler() { return { id: this.id, atualizada: this.atualizada, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    if (this.rejeicoes-- > 0) { this.id = `c${Number(this.id?.slice(1) ?? 0) + 1}`; return false; }
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

function pedido(id: string): PedidoDePublicacaoEmpresa {
  return { inscricaoId: id, projetoRef: 'projeto-a', projeto: ref('time/projeto'), panorama: panorama(), agora, privacidade };
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
});

test('publicação recompõe depois da concorrência na branch', () => {
  const b = preparada(); b.rejeicoes = 1;
  const r = publicarNaRedeEmpresa(b, pedido('inscricao-a'));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.transacao.tentativas, 2);
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
