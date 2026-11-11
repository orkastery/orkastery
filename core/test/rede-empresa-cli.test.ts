import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import type { ContextoDaVarredura } from '../src/dado-privado';
import { CONTRATO_CLI_REDE_EMPRESA, type DependenciasCliRedeEmpresa, executarCliRedeEmpresa } from '../src/rede-empresa-cli';
import type { ProjetoNoPanorama } from '../src/network-roadmap';
import type { ReferenciaDaForja } from '../src/rede-empresa-contrato';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';
import { textoDaFalhaEmpresa } from '../src/locale-network-empresa';

const codigos = [
  'rede-empresa.uso', 'rede-empresa.config-ausente', 'rede-empresa.config-invalida', 'rede-empresa.documento-remoto-invalido',
  'rede-empresa.politica-ausente',
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

test('documento remoto inválido orienta correção em pt-BR e EN sem ecoar conteúdo', () => {
  const marcador = 'json-invalido-conteudo-nao-confiavel';
  const pt = textoDaFalhaEmpresa('rede-empresa.documento-remoto-invalido', 'pt-BR');
  const en = textoDaFalhaEmpresa('rede-empresa.documento-remoto-invalido', 'en');
  assert.match(pt.acao, /administração.*corrigir.*repositório privado/);
  assert.match(en.acao, /administrator.*repair.*private repository/);
  assert.doesNotMatch(JSON.stringify({ pt, en }), new RegExp(marcador));
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
    assert.match(status.stderr, /network empresa aceitar/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JSON inválido da configuração vira erro tipado com ação e sem eco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-empresa-cli-config-invalida-'));
  try {
    const marcador = 'conteudo-nao-confiavel';
    fs.writeFileSync(path.join(dir, 'rede-empresa.json'), `{"${marcador}":`, { mode: 0o600 });
    const saida = executarCliRedeEmpresa('status', { inscricao: 'inscricao-a', json: true }, 'pt-BR', { ORKASTERY_HOME: dir });
    const json = JSON.parse(saida.stdout);
    assert.equal(json.erro.codigo, 'rede-empresa.config-invalida');
    assert.match(json.erro.acao, /corrija|remova/);
    assert.doesNotMatch(saida.stdout, new RegExp(marcador));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

class BranchCli implements PortaDaBranchEmpresa {
  id: string | null = null;
  arquivos = new Map<string, string>();
  gravacoes = 0;
  ler() { return { id: this.id, atualizada: true, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    for (const m of mudancas) if (m.conteudo === null) this.arquivos.delete(m.caminho); else this.arquivos.set(m.caminho, m.conteudo);
    this.gravacoes++;
    this.id = `c${this.gravacoes}`;
    return this.id;
  }
}

const privacidade: ContextoDaVarredura = { raiz: '/tmp/rede-empresa-cli-simulada',
  excecoes: { presente: false, emailsPermitidos: [], excecoes: [] },
  lista: { presente: true, procurada: ['simulada'], lidos: ['simulada'], termos: [], ignorados: 0,
    versionados: [], recusada: null } };

const panorama: ProjetoNoPanorama = {
  projeto: { nome: 'simulado', forja: 'github', clone: null, base: 'main', origem: 'argumento', fuso: 'UTC' },
  roadmap: null, reservas: null, maquinas: null, fontes: [], lacunas: [],
};

test('CLI executa os sete fluxos com forja e branch simuladas, separando registro e aceite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-empresa-cli-fluxos-'));
  const env = { ORKASTERY_HOME: dir };
  const branch = new BranchCli();
  const acessos: ReferenciaDaForja[] = [];
  let conta = { accountId: 41, login: 'maestro-autenticado' };
  const dependencias: DependenciasCliRedeEmpresa = {
    acesso: (ref) => { acessos.push(ref); return { conta, url: `https://${ref.host}/${ref.caminho}`, helper: 'simulado' }; },
    portaDaEmpresa: () => branch,
    criarPelaForja: () => ({ criada: true, conta, porta: branch }),
    prepararPublicacao: () => ({ panorama, privacidade }),
  };
  const operacoes: string[] = [];
  const rodar = (acao: string, opcoes: Record<string, string | boolean>) => {
    const saida = executarCliRedeEmpresa(acao, { ...opcoes, json: true }, 'pt-BR', env, dependencias);
    assert.equal(saida.codigo, 0, `${acao}: ${saida.stderr || saida.stdout}`);
    const json = JSON.parse(saida.stdout);
    assert.equal(json.contrato, CONTRATO_CLI_REDE_EMPRESA);
    assert.equal(json.ok, true);
    operacoes.push(json.operacao);
    return json.dados;
  };
  const comuns = { empresa: 'github:time/rede-coletiva', rede: 'github:pessoa/rede', projetos: 'github:time/projeto' };
  try {
    rodar('criar', { forja: 'github', dono: 'time', repositorio: 'rede-coletiva' });
    const registro = rodar('inscrever', { ...comuns, inscricao: 'inscricao-a', 'account-id': '41', login: 'maestro-esperado' });
    assert.equal(registro.inscricao.estado, 'pendente');
    assert.equal(registro.inscricao.maestroRef.accountId, 41);
    assert.equal(acessos.length, 0, 'o registro administrativo não resolve a conta que aceitará');
    assert.equal(fs.existsSync(path.join(dir, 'rede-empresa.json')), false, 'registro não cria adesão local');

    const aceite = rodar('aceitar', { ...comuns, inscricao: 'inscricao-a' });
    assert.equal(aceite.inscricao.estado, 'ativa');
    assert.equal(aceite.inscricao.loginAtual, 'maestro-autenticado');
    assert.deepEqual(acessos.map((r) => r.caminho), ['pessoa/rede', 'time/projeto']);

    const antes = branch.gravacoes;
    rodar('publicar', { inscricao: 'inscricao-a' });
    assert.equal(branch.gravacoes, antes + 1);
    assert.equal(acessos.at(-1)?.caminho, 'pessoa/rede', 'cada publicação resolve de novo a conta autenticada');
    conta = { accountId: 99, login: 'outra-conta' };
    const negada = executarCliRedeEmpresa('publicar', { inscricao: 'inscricao-a', json: true }, 'pt-BR', env, dependencias);
    assert.equal(JSON.parse(negada.stdout).erro.codigo, 'rede-empresa.identidade-divergente');
    assert.equal(branch.gravacoes, antes + 1, 'a conta divergente não cria commit');
    conta = { accountId: 41, login: 'maestro-autenticado' };
    rodar('status', { inscricao: 'inscricao-a' });
    rodar('sair', { inscricao: 'inscricao-a' });

    rodar('inscrever', { ...comuns, inscricao: 'inscricao-b', 'account-id': '41', login: 'maestro-esperado' });
    rodar('revogar', { empresa: comuns.empresa, inscricao: 'inscricao-b' });
    assert.deepEqual([...new Set(operacoes)], ['criar', 'inscrever', 'aceitar', 'publicar', 'status', 'sair', 'revogar']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
