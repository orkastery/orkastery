import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRATO_INSCRICAO_EMPRESA } from '../src/rede-empresa-contrato';
import { projetarPublicacaoEmpresa } from '../src/rede-empresa-publicacao';
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
    projeto: inscricao.projetos[0], panorama, agora, privacidade: contexto });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.doesNotMatch(r.texto, /cliente-real|maquina-pessoal|pessoa@|\/home\/pessoa|slug-interno|ramo/);
  assert.match(r.texto, /thread-[0-9a-f]{24}/);
});

test('barreira recusa segredo em campo permitido antes da escrita', () => {
  const r = projetarPublicacaoEmpresa({ ...inscricao, loginAtual: 'ghp_12345678901234567890' }, {
    inscricaoId: 'inscricao-a', projetoRef: 'projeto-a', projeto: inscricao.projetos[0], panorama, agora, privacidade: contexto });
  assert.deepEqual(r, { ok: false, codigo: 'rede-empresa.segredo' });
});
