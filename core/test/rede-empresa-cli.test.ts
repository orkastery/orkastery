import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { CONTRATO_CLI_REDE_EMPRESA, executarCliRedeEmpresa } from '../src/rede-empresa-cli';
import { textoDaFalhaEmpresa } from '../src/locale-network-empresa';

const codigos = [
  'rede-empresa.uso', 'rede-empresa.config-ausente', 'rede-empresa.politica-ausente',
  'rede-empresa.politica-incompativel', 'rede-empresa.inscricao-ausente', 'rede-empresa.inscricao-inativa',
  'rede-empresa.identidade-divergente', 'rede-empresa.rede-divergente', 'rede-empresa.projeto-nao-autorizado',
  'rede-empresa.saida-negada', 'rede-empresa.projecao-invalida', 'rede-empresa.dado-privado', 'rede-empresa.segredo',
  'rede-empresa.forja-indisponivel', 'rede-empresa.concorrencia', 'rede-empresa.repositorio-publico',
  'forja.ausente', 'forja.sem-login', 'forja.sem-permissao', 'forja.nao-achei', 'forja.pedido-recusado',
  'forja.indisponivel', 'forja.limite', 'forja.conflito',
];

test('toda falha conhecida tem mensagem e ação em pt-BR e EN', () => {
  for (const codigo of codigos) for (const locale of ['pt-BR', 'en'] as const) {
    const texto = textoDaFalhaEmpresa(codigo, locale);
    assert.ok(texto.mensagem.trim(), `${codigo}/${locale}/mensagem`);
    assert.ok(texto.acao.trim(), `${codigo}/${locale}/acao`);
  }
});

test('JSON preserva código e contrato enquanto localiza mensagem e ação', () => {
  const env = { PATH: '', ORK_BINARIOS_EXTRA: '', ORKASTERY_HOME: os.tmpdir() };
  const pt = executarCliRedeEmpresa('criar', { forja: 'github', dono: 'equipe', repositorio: 'rede', json: true }, 'pt-BR', env);
  const en = executarCliRedeEmpresa('criar', { forja: 'github', dono: 'equipe', repositorio: 'rede', json: true }, 'en', env);
  const a = JSON.parse(pt.stdout), b = JSON.parse(en.stdout);
  assert.equal(a.contrato, CONTRATO_CLI_REDE_EMPRESA);
  assert.equal(a.erro.codigo, 'forja.ausente');
  assert.equal(b.erro.codigo, a.erro.codigo);
  assert.notEqual(a.erro.mensagem, b.erro.mensagem);
  assert.ok(a.erro.acao && b.erro.acao);
});

test('uso e configuração ausente retornam ação sem abrir processo', () => {
  const uso = executarCliRedeEmpresa('desconhecida', {}, 'pt-BR', {});
  assert.equal(uso.codigo, 2);
  assert.match(uso.stderr, /Ação:/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-empresa-cli-'));
  try {
    const status = executarCliRedeEmpresa('status', { inscricao: 'inscricao-a' }, 'en', { ORKASTERY_HOME: dir });
    assert.equal(status.codigo, 1);
    assert.match(status.stderr, /Action:/);
    assert.match(status.stderr, /network empresa inscrever/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
