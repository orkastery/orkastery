import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { aceitarInscricaoEmpresa, criarPoliticaEmpresa, registrarInscricaoEmpresa, revogarInscricaoEmpresa, sairDaRedeEmpresa } from '../src/rede-empresa';
import type { ReferenciaDaForja } from '../src/rede-empresa-contrato';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

class Branch implements PortaDaBranchEmpresa {
  id: string | null = null;
  arquivos = new Map<string, string>();
  ler() { return { id: this.id, atualizada: true, ler: (c: string) => this.arquivos.get(c) ?? null }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    for (const m of mudancas) if (m.conteudo === null) this.arquivos.delete(m.caminho); else this.arquivos.set(m.caminho, m.conteudo);
    this.id = `c${Number(this.id?.slice(1) ?? 0) + 1}`; return this.id;
  }
}

const agora = '2026-11-11T00:00:00.000Z';
const ref = (caminho: string): ReferenciaDaForja => ({ forja: 'github', host: 'github.com', caminho });
const registro = { inscricaoId: 'inscricao-a', rede: ref('pessoa/rede'), maestroRef: { forja: 'github' as const, host: 'github.com', accountId: 41 },
  loginAtual: 'login-antigo', projetos: [ref('time/projeto')], politicaVersao: 'v1', agora };

function preparada() {
  const b = new Branch();
  assert.equal(criarPoliticaEmpresa(b, 'v1', 'permitida').ok, true);
  assert.equal(registrarInscricaoEmpresa(b, registro).ok, true);
  return b;
}

test('aceite vincula accountId e permite mudança de login', () => {
  const b = preparada(), casa = fs.mkdtempSync(path.join(os.tmpdir(), 'aceite-empresa-'));
  try {
    const r = aceitarInscricaoEmpresa(b, { inscricaoId: 'inscricao-a', conta: { accountId: 41, login: 'login-novo' },
      forja: 'github', host: 'github.com', rede: ref('pessoa/rede'), projetosAcessiveis: [ref('time/projeto')],
      empresa: ref('time/rede-coletiva'), agora, env: { ORKASTERY_HOME: casa } });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual([r.valor.estado, r.valor.loginAtual, r.valor.maestroRef.accountId], ['ativa', 'login-novo', 41]);
    assert.doesNotMatch(fs.readFileSync(path.join(casa, 'rede-empresa.json'), 'utf8'), /token|credencial/i);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

test('aceite recusa outra conta e projeto não acessível', () => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-grava-'));
  try {
    const outra = aceitarInscricaoEmpresa(preparada(), { inscricaoId: 'inscricao-a', conta: { accountId: 99, login: 'outro' },
      forja: 'github', host: 'github.com', rede: ref('pessoa/rede'), projetosAcessiveis: [ref('time/projeto')],
      empresa: ref('time/rede-coletiva'), agora, env: { ORKASTERY_HOME: casa } });
    assert.deepEqual([outra.ok, outra.ok ? '' : outra.codigo], [false, 'rede-empresa.identidade-divergente']);
    const projeto = aceitarInscricaoEmpresa(preparada(), { inscricaoId: 'inscricao-a', conta: { accountId: 41, login: 'login' },
      forja: 'github', host: 'github.com', rede: ref('pessoa/rede'), projetosAcessiveis: [ref('time/outro')],
      empresa: ref('time/rede-coletiva'), agora, env: { ORKASTERY_HOME: casa } });
    assert.deepEqual([projeto.ok, projeto.ok ? '' : projeto.codigo], [false, 'rede-empresa.projeto-nao-autorizado']);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

test('revogação e saída usam a mesma ponta e deixam a inscrição inativa', () => {
  const revogada = revogarInscricaoEmpresa(preparada(), 'inscricao-a', agora);
  assert.equal(revogada.ok && revogada.valor.estado, 'revogada');
  const encerrada = sairDaRedeEmpresa(preparada(), 'inscricao-a', agora, { accountId: 41, login: 'login' }, 'github', 'github.com');
  assert.equal(encerrada.ok && encerrada.valor.estado, 'encerrada');
});
