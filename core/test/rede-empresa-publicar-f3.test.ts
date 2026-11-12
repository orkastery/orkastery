import assert from 'node:assert/strict';
import test from 'node:test';
import { corpoComPreflightEmpresa, linhasDaPublicacao, type Publicacao } from '../src/ship-publicar';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';

const preflight: ResultadoPreflightEmpresa = { estado: 'conflito', consultivo: true, conflitos: [{
  a: { inscricaoId: 'a', builder: 'builder-a', threadRef: 'thread-a' }, b: { inscricaoId: 'b', builder: 'builder-b', threadRef: 'thread-b' },
  projectKey: 'github:github.com/time/projeto', itemId: 'RM-089', regioes: [{ a: 'core/src/**', b: 'core/src/*.ts' }],
  fontes: ['item', 'caminho'] }], ordemSugerida: [], lacunas: [], performance: { estado: 'unavailable' }, cobertura: 'completa',
  fotografia: { ponta: 'c1', publicacoes: 2, trabalhos: 2, caminhos: 2, commitsLidos: 1, fonte: 'rede-coletiva' } };

test('o mesmo preflight entra no corpo efetivo do PR em pt-BR e inglês', () => {
  const pt = corpoComPreflightEmpresa('# Entrega\n', preflight, 'pt-BR');
  const en = corpoComPreflightEmpresa('# Delivery\n', preflight, 'en');
  assert.match(pt, /Preflight coletivo: 1 conflito.*ordem sugerida é consultiva/);
  assert.match(en, /Collective preflight: 1 conflict.*Suggested order is advisory/);
  assert.equal(pt.match(/Preflight coletivo/g)?.length, 1);
});

test('resultado de publicação mostra o aviso sem alterar ação, motivo ou prova', () => {
  const r: Publicacao = { contrato: 'ork.ship-publicar/v1', thread: 'ork-exemplo', modo: 'auto', tag: '#Auto', acao: 'publicaria',
    motivo: null, detalhe: 'continua', correcao: '', branch: 'prj/ork-exemplo', base: 'main', remoto: 'origin', head: 'a'.repeat(40),
    remotaAntes: null, remota: null, pushVerificado: false, pr: null, corpo: 'padrao', passos: [], dryRun: true, preflightEmpresa: preflight };
  const antes = [r.acao, r.motivo, r.pushVerificado];
  assert.ok(linhasDaPublicacao(r).some((l) => l.includes('Preflight coletivo: 1 conflito')));
  assert.deepEqual([r.acao, r.motivo, r.pushVerificado], antes);
});

test('sem inscrição o corpo permanece byte a byte igual', () => {
  const corpo = '# Entrega\n\nTexto.\n';
  assert.equal(corpoComPreflightEmpresa(corpo, null, 'pt-BR'), corpo);
});
