import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { adesaoRedeEmpresa, ErroDaConfigRedeEmpresa, gravarAdesaoRedeEmpresa, lerConfigRedeEmpresa } from '../src/rede-empresa-config';
import { CONTRATO_PUBLICACAO_EMPRESA, ehPublicacaoDaEmpresa, MAX_ITENS_PUBLICACAO_EMPRESA, PublicacaoDaEmpresa } from '../src/rede-empresa-contrato';
import { statusDaRedeEmpresa } from '../src/rede-empresa-status';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

const ref = (caminho: string) => ({ forja: 'github' as const, host: 'github.com', caminho });
const maestroRef = { forja: 'github' as const, host: 'github.com', accountId: 41 };
const base = (): PublicacaoDaEmpresa => ({
  contrato: CONTRATO_PUBLICACAO_EMPRESA, politicaVersao: 'v1', inscricaoId: 'inscricao-a', publicadoEm: '2026-11-11T00:00:00.000Z',
  maestro: { ...maestroRef, loginAtual: 'login-atual' }, rede: ref('pessoa/rede'), projeto: ref('time/projeto'),
  itens: [{ id: 'RM-089', estado: 'desenvolvimento' }], reservas: [{ itemId: 'RM-089', threadRef: 't-a', iniciadaEm: '2026-11-10T00:00:00.000Z' }],
  trabalhos: [{ threadRef: 't-a', fase: 'GO', itemId: 'RM-089' }],
  fontes: [{ parte: 'roadmap', atualizado: true, lidoEm: '2026-11-11T00:00:00.000Z', commit: 'abcdef0' }],
  lacunas: [{ tipo: 'reservas.sem-branch', parte: 'reservas' }],
});

test('contrato aceita só a projeção fechada', () => {
  assert.equal(ehPublicacaoDaEmpresa(base()), true);
  assert.equal(ehPublicacaoDaEmpresa({ ...base(), caminho: '/privado' }), false);
  assert.equal(ehPublicacaoDaEmpresa({ ...base(), itens: [{ id: 'RM-089', estado: 'desenvolvimento', titulo: 'privado' }] }), false);
  assert.equal(ehPublicacaoDaEmpresa({ ...base(), lacunas: [{ tipo: 'x', parte: 'rede', detalhe: 'privado' }] }), false);
  assert.equal(ehPublicacaoDaEmpresa({ ...base(), lacunas: [{ tipo: 'categoria-forjada', parte: 'rede' }] }), false);
});

test('status recusa tipo de lacuna desconhecido vindo do repositório sem ecoar conteúdo', () => {
  const marcador = 'conteudo-nao-confiavel';
  const forjada = { ...base(), lacunas: [{ tipo: `categoria-${marcador}`, parte: 'rede' }] };
  const porta: PortaDaBranchEmpresa = { ler: () => ({ id: 'c1', atualizada: true,
    ler: (caminho) => caminho.startsWith('publicacoes/') ? `${JSON.stringify(forjada)}\n` : null }), gravar: () => false };
  assert.throws(() => statusDaRedeEmpresa(porta, 'inscricao-a', 'projeto-a', {}), (erro: unknown) => {
    const tipado = erro as { codigo?: string; message?: string };
    assert.equal(tipado.codigo, 'rede-empresa.documento-remoto-invalido');
    assert.doesNotMatch(JSON.stringify(tipado), new RegExp(marcador));
    return true;
  });
});

test('contrato recusa cardinalidade acima do limite antes do blob', () => {
  const p = base();
  p.itens = Array.from({ length: MAX_ITENS_PUBLICACAO_EMPRESA + 1 }, (_, i) => ({ id: `RM-${i}`, estado: 'proposto' as const }));
  assert.equal(ehPublicacaoDaEmpresa(p), false);
});

test('configuração local é 0600 e não guarda credencial, caminho ou máquina', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-empresa-config-'));
  const env = { ORKASTERY_HOME: dir };
  try {
    gravarAdesaoRedeEmpresa({ inscricaoId: 'inscricao-a', empresa: ref('time/rede'), rede: ref('pessoa/rede'), maestroRef,
      loginAtual: 'login-atual', politicaVersao: 'v1', projetos: [ref('time/projeto')], estado: 'ativa',
      ultimaPublicacao: null, pendencia: null }, env);
    const arquivo = path.join(dir, 'rede-empresa.json'), texto = fs.readFileSync(arquivo, 'utf8');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    assert.doesNotMatch(texto, /token|credencial|caminhoLocal|maquina|hostname|home/i);
    assert.equal(adesaoRedeEmpresa('inscricao-a', env)?.maestroRef.accountId, 41);
    assert.equal(lerConfigRedeEmpresa(env).inscricoes.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JSON inválido na configuração produz erro tipado e acionável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-empresa-config-invalida-'));
  try {
    fs.writeFileSync(path.join(dir, 'rede-empresa.json'), '{"contrato":', { mode: 0o600 });
    assert.throws(() => lerConfigRedeEmpresa({ ORKASTERY_HOME: dir }), (e: unknown) => {
      assert.ok(e instanceof ErroDaConfigRedeEmpresa);
      assert.equal(e.codigo, 'rede-empresa.config-invalida');
      assert.equal(e.arquivo, 'rede-empresa.json');
      assert.match(e.acao, /corrija|remova/);
      assert.doesNotMatch(`${e.message} ${e.acao}`, /\{"contrato"/);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
