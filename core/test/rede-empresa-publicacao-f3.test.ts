import assert from 'node:assert/strict';
import test from 'node:test';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import type { ContextoDaVarredura } from '../src/dado-privado';
import type { ProjetoNoPanorama } from '../src/network-roadmap';
import { CONTRATO_INSCRICAO_EMPRESA, CONTRATO_POLITICA_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V2,
  CONTRATO_PUBLICACAO_EMPRESA_V3, MAX_CAMINHOS_POR_TRABALHO_EMPRESA, type InscricaoDaEmpresa } from '../src/rede-empresa-contrato';
import { publicarNaRedeEmpresa, type PedidoDePublicacaoEmpresa } from '../src/rede-empresa-publicacao';
import type { CaminhoDoTrabalho } from '../src/rede-empresa-trabalho';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

class Branch implements PortaDaBranchEmpresa {
  id = 'c0'; arquivos = new Map<string, string>(); commits: MudancaNaBranch[][] = [];
  ler() { const snapshot = new Map(this.arquivos); return { id: this.id, atualizada: true,
    ler: (c: string) => snapshot.get(c) ?? null, listar: (p: string) => [...snapshot].filter(([c]) => c.startsWith(p))
      .map(([caminho, conteudo]) => ({ caminho, conteudo })) }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    this.commits.push([...mudancas]);
    for (const m of mudancas) if (m.conteudo !== null) this.arquivos.set(m.caminho, m.conteudo);
    this.id = `c${this.commits.length}`; return this.id;
  }
}

const agora = '2026-11-12T00:00:00.000Z';
const ref = { forja: 'github' as const, host: 'github.com', caminho: 'time/projeto' };
const inscricao: InscricaoDaEmpresa = { contrato: CONTRATO_INSCRICAO_EMPRESA, inscricaoId: 'inscricao-a', rede: ref,
  maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'conta-a', projetos: [ref],
  politicaVersao: 'v2', estado: 'ativa', registradaEm: agora, aceitaEm: agora, atualizadaEm: agora };
const panorama: ProjetoNoPanorama = { projeto: { nome: 'projeto', forja: 'github', clone: '/tmp/projeto', base: 'main', origem: 'cwd', fuso: 'UTC' },
  roadmap: null, reservas: [], maquinas: [{ maquina: 'local', por: 'conta-a', publicadoEm: agora, idadeMin: 0,
    semBatida: false, estaMaquina: true, origem: 'estado-local', versaoOrk: '0.0.0', entreguesSemMaster: 0, threadsLidas: true,
    ativas: [{ id: 'thread-a', nome: 'trabalho', modo: '#Auto', fase: 'GO', status: 'aberta', roadmap: 'RM-089',
      branch: 'branch', atualizadaEm: agora, entregue: null, esperaVoce: false, pergunta: null, paradaDesde: null }] }], fontes: [], lacunas: [] };
const privacidade: ContextoDaVarredura = { raiz: '/tmp/projeto', excecoes: { presente: false, emailsPermitidos: [], excecoes: [] },
  lista: { presente: false, procurada: [], lidos: [], termos: [], ignorados: 0, versionados: [], recusada: null } };

function preparada(): Branch {
  const b = new Branch();
  b.arquivos.set('politica.json', JSON.stringify({ contrato: CONTRATO_POLITICA_EMPRESA_V2, versao: 'v2', saida: 'permitida',
    publicacaoMinima: 1, nivel: 'avisar', reciboVersao: 'v2', espelhos: [] }));
  b.arquivos.set('inscricoes/inscricao-a.json', JSON.stringify(inscricao));
  return b;
}
function pedido(caminhos: readonly CaminhoDoTrabalho[] = [{ padrao: 'core/src/**/*.ts', fontes: ['plan'] }]): PedidoDePublicacaoEmpresa {
  return { inscricaoId: 'inscricao-a', projetoRef: 'projeto-a', projeto: ref, panorama,
    conta: { accountId: 41, login: 'conta-a' }, forja: 'github', host: 'github.com', agora, privacidade,
    caminhosPorThread: { 'thread-a': caminhos } };
}

test('publica v2 e v3 na mesma transação sem substituir o caminho compatível', () => {
  const b = preparada(), r = publicarNaRedeEmpresa(b, pedido());
  assert.ok(r.ok);
  assert.deepEqual(b.commits[0].map((m) => m.caminho), [
    'publicacoes/inscricao-a/projeto-a.json', 'publicacoes-v3/inscricao-a/projeto-a.json']);
  assert.equal(JSON.parse(b.arquivos.get('publicacoes/inscricao-a/projeto-a.json')!).contrato, CONTRATO_PUBLICACAO_EMPRESA_V2);
  const v3 = JSON.parse(b.arquivos.get('publicacoes-v3/inscricao-a/projeto-a.json')!);
  assert.equal(v3.contrato, CONTRATO_PUBLICACAO_EMPRESA_V3);
  assert.deepEqual(v3.trabalhos[0].caminhos, [{ padrao: 'core/src/**/*.ts', fontes: ['plan'] }]);
});

test('normaliza fontes e rejeita excesso ou caminho privado antes da transação', () => {
  const b = preparada();
  const combinado = publicarNaRedeEmpresa(b, pedido([
    { padrao: './core/src/*.ts', fontes: ['diff'] }, { padrao: 'core/src/*.ts', fontes: ['plan', 'lease'] },
  ]));
  assert.ok(combinado.ok);
  assert.deepEqual(combinado.ok && combinado.valorV3.trabalhos[0].caminhos,
    [{ padrao: 'core/src/*.ts', fontes: ['plan', 'lease', 'diff'] }]);
  const excesso = publicarNaRedeEmpresa(preparada(), pedido(Array.from({ length: MAX_CAMINHOS_POR_TRABALHO_EMPRESA + 1 },
    (_, i) => ({ padrao: `core/src/${i}.ts`, fontes: ['plan' as const] }))));
  assert.deepEqual(excesso.ok ? null : excesso.codigo, 'rede-empresa.projecao-invalida');
  const privado = publicarNaRedeEmpresa(preparada(), pedido([{ padrao: '/home/pessoa/segredo', fontes: ['plan'] }]));
  assert.deepEqual(privado.ok ? null : privado.codigo, 'rede-empresa.projecao-invalida');
});
