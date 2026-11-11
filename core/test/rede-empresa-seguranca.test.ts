import assert from 'node:assert/strict';
import test from 'node:test';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import { CONTRATO_INSCRICAO_EMPRESA, CONTRATO_POLITICA_EMPRESA } from '../src/rede-empresa-contrato';
import { projetarPublicacaoEmpresa, publicarNaRedeEmpresa } from '../src/rede-empresa-publicacao';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';
import type { ContextoDaVarredura } from '../src/dado-privado';
import type { ProjetoNoPanorama } from '../src/network-roadmap';

const agora = '2026-11-11T00:00:00.000Z';
const contexto: ContextoDaVarredura = { raiz: '/tmp/repositorio-de-teste',
  excecoes: { presente: false, emailsPermitidos: [], excecoes: [] },
  lista: { presente: true, procurada: ['lista de teste'], lidos: ['lista de teste'], termos: ['cliente-real', 'maquina-pessoal'],
    ignorados: 0, versionados: [], recusada: null } };
const inscricao = { contrato: CONTRATO_INSCRICAO_EMPRESA, inscricaoId: 'inscricao-a',
  rede: { forja: 'github' as const, host: 'github.com', caminho: 'time/rede' },
  maestroRef: { forja: 'github' as const, host: 'github.com', accountId: 41 }, loginAtual: 'login-atual',
  projetos: [{ forja: 'github' as const, host: 'github.com', caminho: 'time/projeto' }], politicaVersao: 'v1', estado: 'ativa' as const,
  registradaEm: agora, aceitaEm: agora, atualizadaEm: agora };
const panorama = { projeto: { nome: 'cliente-real', forja: 'github', clone: '/home/pessoa/projeto', base: 'main', origem: 'cwd', fuso: 'UTC' },
  roadmap: { grupos: [{ itens: [{ id: 'RM-089', titulo: 'cliente-real', grupo: 'desenvolvimento' }] }] },
  reservas: [{ item: 'RM-089', thread: 'slug-interno', desdeEm: agora, por: 'pessoa@empresa.invalid', maquina: 'maquina-pessoal',
    nota: '/home/pessoa' }],
  maquinas: [{ maquina: 'maquina-pessoal', por: 'pessoa@empresa.invalid', ativas: [{ id: 'slug-interno', nome: 'cliente-real',
    fase: 'GO', roadmap: 'RM-089', branch: '/home/pessoa/ramo' }] }],
  fontes: [{ parte: 'roadmap', atualizado: true, lidoEm: agora, commit: 'abcdef0', onde: '/home/pessoa/projeto' }],
  lacunas: [{ tipo: 'roadmap.sem-leitura', parte: 'roadmap', detalhe: 'cliente-real', correcao: '/home/pessoa' }],
} as unknown as ProjetoNoPanorama;

test('projeção omite segredo, caminho local, e-mail, nome de máquina e texto livre', () => {
  const r = projetarPublicacaoEmpresa(inscricao, { inscricaoId: 'inscricao-a', projetoRef: 'projeto-a',
    projeto: inscricao.projetos[0], panorama, conta: { accountId: 41, login: 'login-atual' },
    forja: 'github', host: 'github.com', agora, privacidade: contexto });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.doesNotMatch(r.texto, /cliente-real|maquina-pessoal|pessoa@|\/home\/pessoa|slug-interno|ramo/);
  assert.match(r.texto, /thread-[0-9a-f]{24}/);
});

test('barreira recusa segredo em campo permitido antes da escrita', () => {
  const r = projetarPublicacaoEmpresa({ ...inscricao, loginAtual: 'ghp_12345678901234567890' }, {
    inscricaoId: 'inscricao-a', projetoRef: 'projeto-a', projeto: inscricao.projetos[0], panorama,
    conta: { accountId: 41, login: 'login-atual' }, forja: 'github', host: 'github.com', agora, privacidade: contexto });
  assert.deepEqual(r, { ok: false, codigo: 'rede-empresa.segredo' });
});

class BranchSeguranca implements PortaDaBranchEmpresa {
  id: string | null = 'c0';
  gravacoes = 0;
  arquivos = new Map<string, string>();
  constructor(loginAtual: string) {
    this.arquivos.set('politica.json', `${JSON.stringify({ contrato: CONTRATO_POLITICA_EMPRESA, versao: 'v1',
      saida: 'permitida', publicacaoMinima: 1 })}\n`);
    this.arquivos.set('inscricoes/inscricao-a.json', `${JSON.stringify({ ...inscricao, loginAtual })}\n`);
  }
  ler() { return { id: this.id, atualizada: true, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, _mudancas: readonly MudancaNaBranch[]) { this.gravacoes++; return 'c1'; }
}

test('caminho público bloqueia dado privado ou segredo antes de escrever na forja', () => {
  for (const [loginAtual, codigo] of [['cliente-real', 'rede-empresa.dado-privado'],
    ['ghp_12345678901234567890', 'rede-empresa.segredo']] as const) {
    const branch = new BranchSeguranca(loginAtual);
    const r = publicarNaRedeEmpresa(branch, { inscricaoId: 'inscricao-a', projetoRef: 'projeto-a',
      projeto: inscricao.projetos[0], panorama, conta: { accountId: 41, login: loginAtual },
      forja: 'github', host: 'github.com', agora, privacidade: contexto });
    assert.deepEqual([r.ok, r.ok ? '' : r.codigo, branch.gravacoes], [false, codigo, 0]);
  }
});
