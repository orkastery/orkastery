import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import { avaliarCoberturaEmpresa, gravarAdesaoRedeEmpresa } from '../src/rede-empresa-config';
import { executarCliRedeEmpresa, type DependenciasCliRedeEmpresa } from '../src/rede-empresa-cli';
import { CONTRATO_POLITICA_EMPRESA_V2, type PoliticaDaEmpresa } from '../src/rede-empresa-contrato';
import { textoDaCoberturaEmpresa } from '../src/locale-network-empresa';
import { statusDaRedeEmpresa } from '../src/rede-empresa-status';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';
import { CONTRATO_ATESTACAO_EXCECAO, verificarExcecaoAutenticada, type CorpoDaExcecaoAutenticada,
  type PortaDeAtestacao } from '../src/rede-empresa-atestacao';

const agora = '2026-11-11T12:00:00.000Z';
const projectKey = 'github:github.com/time/projeto';
const politica = (nivel: 'observar' | 'avisar' | 'exigir'): PoliticaDaEmpresa => ({
  contrato: CONTRATO_POLITICA_EMPRESA_V2, versao: 'v2', saida: 'permitida', publicacaoMinima: 1,
  nivel, reciboVersao: 'recibo-v2', espelhos: [],
});

test('observar e avisar falham abertos de forma visível; exigir falha fechado', () => {
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    for (const configurada of [false, true]) {
      const r = avaliarCoberturaEmpresa({ configurada, conferida: false,
        cache: { versao: 'v2', nivel, reciboVersao: 'recibo-v2', conferidaEm: agora },
        projectKey, itemId: 'RM-089', agora });
      assert.equal(r.permite, nivel !== 'exigir');
      assert.match(textoDaCoberturaEmpresa(r, 'pt-BR'), nivel === 'exigir' ? /BLOQUEADO/ : /AVISO/);
      assert.match(textoDaCoberturaEmpresa(r, 'en'), nivel === 'exigir' ? /BLOCKED/ : /WARNING/);
    }
  }
});

test('exceção só libera exigir quando é específica, vigente e autenticada', () => {
  const base = { configurada: true, conferida: false,
    cache: { versao: 'v2', nivel: 'exigir' as const, reciboVersao: 'recibo-v2', conferidaEm: agora },
    projectKey, itemId: 'RM-089', agora };
  const corpo: CorpoDaExcecaoAutenticada = { contrato: CONTRATO_ATESTACAO_EXCECAO, projectKey, itemId: 'RM-089',
    responsavelAccountId: 7, justificativaId: 'incidente-17', emitidoEm: '2026-11-11T11:00:00.000Z',
    expiraEm: '2026-11-11T13:00:00.000Z', nonce: 'nonce-excecao-123456' };
  const body = JSON.stringify(corpo);
  const referencia = { forja: 'github' as const, id: 77, endpoint: '/repos/time/rede/issues/comments/77',
    sha256: createHash('sha256').update(body).digest('hex') };
  const porta: PortaDeAtestacao = { ler: () => ({ id: 77, authorId: 7, body,
    createdAt: corpo.emitidoEm, updatedAt: corpo.emitidoEm }) };
  const excecao = { projectKey, itemId: 'RM-089', responsavelAccountId: 7,
    justificativaId: 'incidente-17', expiraEm: corpo.expiraEm, referencia };
  const autenticarExcecao = () => verificarExcecaoAutenticada(porta, referencia, { projectKey, itemId: 'RM-089',
    responsavelAccountId: 7, justificativaId: 'incidente-17', expiraEm: corpo.expiraEm, agora, timeoutMs: 2_000 });
  assert.equal(avaliarCoberturaEmpresa({ ...base, excecao, autenticarExcecao: () => false }).permite, false);
  const aceita = avaliarCoberturaEmpresa({ ...base, excecao, autenticarExcecao });
  assert.deepEqual([aceita.permite, aceita.estado, aceita.auditavel], [true, 'excecao-autenticada', true]);
  assert.equal(avaliarCoberturaEmpresa({ ...base, excecao: { ...excecao, itemId: 'RM-090' },
    autenticarExcecao }).permite, false);
});

class Branch implements PortaDaBranchEmpresa {
  arquivos = new Map<string, string>();
  atualizada = true;
  ler() { return { id: 'c1', atualizada: this.atualizada, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    for (const m of mudancas) if (m.conteudo !== null) this.arquivos.set(m.caminho, m.conteudo);
    return 'c2';
  }
}

test('status usa a política conferida e o último cache durante indisponibilidade', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-status-f2-'));
  const ref = (caminho: string) => ({ forja: 'github' as const, host: 'github.com', caminho });
  try {
    gravarAdesaoRedeEmpresa({ inscricaoId: 'inscricao-a', empresa: ref('time/rede'), rede: ref('pessoa/rede'),
      maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'login', politicaVersao: 'v2',
      projetos: [ref('time/projeto')], estado: 'ativa', ultimaPublicacao: null, pendencia: null,
      politicaCache: { versao: 'v2', nivel: 'exigir', reciboVersao: 'recibo-v2', conferidaEm: agora } }, { ORKASTERY_HOME: home });
    const branch = new Branch();
    branch.arquivos.set('politica.json', JSON.stringify(politica('exigir')));
    const ok = statusDaRedeEmpresa(branch, 'inscricao-a', 'projeto-a', { ORKASTERY_HOME: home });
    assert.deepEqual([ok.cobertura.estado, ok.cobertura.nivel, ok.cobertura.permite], ['conferida', 'exigir', true]);
    branch.atualizada = false;
    const outage = statusDaRedeEmpresa(branch, 'inscricao-a', 'projeto-a', { ORKASTERY_HOME: home });
    assert.deepEqual([outage.cobertura.estado, outage.cobertura.nivel, outage.cobertura.permite], ['nao-conferida', 'exigir', false]);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('CLI cria política com nível e recibo versionados', () => {
  const branch = new Branch();
  const dependencias: DependenciasCliRedeEmpresa = { criarPelaForja: () => ({ criada: true,
    conta: { accountId: 41, login: 'login' }, porta: branch }) };
  const r = executarCliRedeEmpresa('criar', { forja: 'github', dono: 'time', repositorio: 'rede', politica: 'v2',
    nivel: 'exigir', 'recibo-versao': 'recibo-v2', json: true }, 'pt-BR', {}, dependencias);
  assert.equal(r.codigo, 0, r.stderr || r.stdout);
  const gravada = JSON.parse(branch.arquivos.get('politica.json')!);
  assert.deepEqual([gravada.contrato, gravada.nivel, gravada.reciboVersao],
    [CONTRATO_POLITICA_EMPRESA_V2, 'exigir', 'recibo-v2']);
});
