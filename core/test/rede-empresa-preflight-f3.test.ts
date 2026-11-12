import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRATO_PUBLICACAO_EMPRESA, CONTRATO_PUBLICACAO_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V3,
  MAX_CAMINHOS_PUBLICACAO_EMPRESA, type PublicacaoDaEmpresaV1, type PublicacaoDaEmpresaV2,
  type PublicacaoDaEmpresaV3 } from '../src/rede-empresa-contrato';
import { preflightDaRedeEmpresa } from '../src/rede-empresa-preflight';
import type { PortaDaBranchEmpresa, RegistroDaHistoriaEmpresa } from '../src/rede-empresa-transporte';

const agora = '2026-11-12T00:00:00.000Z';
const publicacao = (inscricaoId: string, accountId: number, threadRef: string, caminho: string): PublicacaoDaEmpresaV3 => ({
  contrato: CONTRATO_PUBLICACAO_EMPRESA_V3, projectKey: 'github:github.com/time/projeto', politicaVersao: 'v2', inscricaoId,
  publicadoEm: agora, maestro: { forja: 'github', host: 'github.com', accountId, loginAtual: `builder-${accountId}` },
  rede: { forja: 'github', host: 'github.com', caminho: 'time/rede' }, projeto: { forja: 'github', host: 'github.com', caminho: 'time/projeto' },
  itens: [], reservas: [], trabalhos: [{ threadRef, fase: 'GO', itemId: 'RM-089', caminhos: [{ padrao: caminho, fontes: ['plan'] }],
    instanteLocal: { valor: agora, fonte: 'auto-relato-autenticado' } }], fontes: [], lacunas: [] });
const doc = (p: PublicacaoDaEmpresaV3) => ({ caminho: `publicacoes-v3/${p.inscricaoId}/projeto.json`, conteudo: JSON.stringify(p) });
const legada = (contrato: typeof CONTRATO_PUBLICACAO_EMPRESA | typeof CONTRATO_PUBLICACAO_EMPRESA_V2,
  inscricaoId: string, accountId: number): PublicacaoDaEmpresaV1 | PublicacaoDaEmpresaV2 => {
  const base = { politicaVersao: 'v2', inscricaoId, publicadoEm: agora,
    maestro: { forja: 'github' as const, host: 'github.com', accountId, loginAtual: `builder-${accountId}` },
    rede: { forja: 'github' as const, host: 'github.com', caminho: 'time/rede' },
    projeto: { forja: 'github' as const, host: 'github.com', caminho: 'time/projeto' }, itens: [], reservas: [],
    trabalhos: [{ threadRef: `thread-${inscricaoId}`, fase: 'GO' as const, itemId: 'RM-X' }], fontes: [], lacunas: [] };
  return contrato === CONTRATO_PUBLICACAO_EMPRESA_V2
    ? { ...base, contrato, projectKey: 'github:github.com/time/projeto' } : { ...base, contrato };
};

function porta(publicacoes: PublicacaoDaEmpresaV3[], historia?: RegistroDaHistoriaEmpresa[]): PortaDaBranchEmpresa & { leituras: number } {
  const d = publicacoes.map(doc);
  return { leituras: 0, ler() { this.leituras++;
    return { id: 'c2', atualizada: true, ler: () => null, listar: (prefixo: string) => prefixo === 'publicacoes-v3/' ? d : [],
      historicoPrimeiroPai: () => ({ estado: 'completa' as const, ponta: 'c2', registros: historia ?? [
        { id: 'c1', primeiroPai: null, ordinal: 1, documentos: d.slice(0, 1) },
        { id: 'c2', primeiroPai: 'c1', ordinal: 2, documentos: d },
      ] }) }; }, gravar: () => false };
}

test('um preflight faz uma leitura, usa a história carimbada e não faz I/O no laço de pares', () => {
  const p = porta([publicacao('inscricao-a', 41, 'thread-a', 'core/src/**'), publicacao('inscricao-b', 42, 'thread-b', 'core/src/*.ts')]);
  const r = preflightDaRedeEmpresa(p);
  assert.equal(p.leituras, 1); assert.equal(r.estado, 'conflito');
  assert.deepEqual(r.ordemSugerida.map((x) => x.threadRef), ['thread-a', 'thread-b']);
  assert.deepEqual(r.fotografia, { ponta: 'c2', publicacoes: 2, trabalhos: 2, caminhos: 2, commitsLidos: 2, fonte: 'rede-coletiva' });
  assert.deepEqual(r.performance, { estado: 'unavailable' });
});

test('legado, documento inválido e história incompleta nunca viram sem conflito', () => {
  const semV3: PortaDaBranchEmpresa = { ler: () => ({ id: 'c1', atualizada: true, ler: () => null,
    listar: (prefixo) => prefixo === 'publicacoes/' ? [{ caminho: 'publicacoes/a/p.json', conteudo: '{}' }] : [] }), gravar: () => false };
  const r = preflightDaRedeEmpresa(semV3);
  assert.equal(r.estado, 'inconclusivo'); assert.ok(r.lacunas.includes('caminhos.desconhecidos'));
  assert.ok(r.lacunas.includes('historia.indisponivel'));
});

test('publicações v1 e v2 sem caminhos ainda entram no conflito por item', () => {
  const documentos = [legada(CONTRATO_PUBLICACAO_EMPRESA, 'inscricao-a', 41),
    legada(CONTRATO_PUBLICACAO_EMPRESA_V2, 'inscricao-b', 42)]
    .map((p) => ({ caminho: `publicacoes/${p.inscricaoId}/p.json`, conteudo: JSON.stringify(p) }));
  const p: PortaDaBranchEmpresa = { ler: () => ({ id: 'c1', atualizada: true, ler: () => null,
    listar: (prefixo) => prefixo === 'publicacoes/' ? documentos : [] }), gravar: () => false };
  const r = preflightDaRedeEmpresa(p);
  assert.equal(r.estado, 'inconclusivo');
  assert.deepEqual(r.conflitos.map((c) => c.fontes), [['item']]);
  assert.ok(r.lacunas.includes('caminhos.desconhecidos'));
});

test('o teto total por publicação permanece aceito sem promessa de performance', () => {
  const p = publicacao('inscricao-a', 41, 'thread-a', 'core/src/0.ts');
  p.trabalhos = Array.from({ length: MAX_CAMINHOS_PUBLICACAO_EMPRESA / 64 }, (_, i) => ({ threadRef: `thread-${i}`, fase: 'GO',
    caminhos: Array.from({ length: 64 }, (_, j) => ({ padrao: `core/src/${i}/${j}.ts`, fontes: ['plan'] })),
    instanteLocal: { valor: agora, fonte: 'auto-relato-autenticado' } }));
  const r = preflightDaRedeEmpresa(porta([p], [{ id: 'c1', primeiroPai: null, ordinal: 1, documentos: [doc(p)] }]));
  assert.equal(r.fotografia.caminhos, MAX_CAMINHOS_PUBLICACAO_EMPRESA);
  assert.deepEqual(r.performance, { estado: 'unavailable' });
});
