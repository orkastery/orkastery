import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { MAX_COMMITS_HISTORIA_EMPRESA } from '../src/rede-empresa-contrato';
import { lerHistoriaDaEmpresa, portaGitDaRedeEmpresa, type PontaDaRedeEmpresa,
  type RegistroDaHistoriaEmpresa } from '../src/rede-empresa-transporte';
import { dirTemporario } from './apoio';

const registros = (n: number): RegistroDaHistoriaEmpresa[] => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`,
  primeiroPai: i ? `c${i}` : null, ordinal: i + 1, documentos: [] }));
const ponta = (resultado: ReturnType<typeof lerHistoriaDaEmpresa> | null): PontaDaRedeEmpresa => ({ id: 'c2', atualizada: true,
  ler: () => null, historicoPrimeiroPai: () => resultado ?? { estado: 'completa', ponta: 'c2', registros: registros(2) } });

test('a mesma ponta completa preserva ordinais da raiz à ponta', () => {
  const a = lerHistoriaDaEmpresa(ponta(null)), b = lerHistoriaDaEmpresa(ponta(null));
  assert.deepEqual(a, b); assert.deepEqual(a.registros.map((r) => [r.id, r.ordinal]), [['c1', 1], ['c2', 2]]);
});

test('teto exato passa e histórias rasas, truncadas, não lineares ou excedentes são inconclusivas', () => {
  const exata = lerHistoriaDaEmpresa(ponta({ estado: 'completa', ponta: 'c2000', registros: registros(MAX_COMMITS_HISTORIA_EMPRESA) }));
  assert.equal(exata.estado, 'completa');
  for (const lacuna of ['historia.rasa', 'historia.truncada', 'historia.nao-linear', 'historia.excedeu-teto'] as const) {
    const r = lerHistoriaDaEmpresa(ponta({ estado: 'inconclusiva', ponta: 'c2', lacuna, registros: [] }));
    assert.deepEqual([r.estado, r.estado === 'inconclusiva' && r.lacuna], ['inconclusiva', lacuna]);
  }
});

test('porta sem história nunca conclui ausência de conflito', () => {
  const r = lerHistoriaDaEmpresa({ id: 'c1', atualizada: true, ler: () => null });
  assert.deepEqual([r.estado, r.estado === 'inconclusiva' && r.lacuna], ['inconclusiva', 'historia.indisponivel']);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function repositorioLinear(total: number, raso = false): { raiz: string; cache: string; limpar: () => void } {
  const raiz = dirTemporario('rede-empresa-historia-real'), remoto = path.join(raiz, 'remoto.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remoto]);
  const linhas = ['blob', 'mark :1', 'data 3', '{}\n'];
  for (let i = 1; i <= total; i++) {
    linhas.push('commit refs/heads/main', `mark :${i + 1}`, `author Teste <teste@invalid> ${1700000000 + i} +0000`,
      `committer Teste <teste@invalid> ${1700000000 + i} +0000`, `data ${String(i).length}`, String(i));
    if (i === 1) linhas.push('M 100644 :1 publicacoes-v3/inscricao/projeto.json');
    else linhas.push(`from :${i}`);
    linhas.push('');
  }
  linhas.push('done', '');
  execFileSync('git', ['fast-import', '--quiet'], { cwd: remoto, input: linhas.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] });
  const cache = path.join(raiz, 'cache');
  if (raso) execFileSync('git', ['clone', '-q', '--depth', '1', '--no-checkout', `file://${remoto}`, cache]);
  else {
    execFileSync('git', ['init', '-q', cache]);
    git(cache, 'remote', 'add', 'origin', remoto);
  }
  return { raiz, cache, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('adaptador Git real aceita o teto exato e recusa o excesso contratual', () => {
  for (const [total, estado, lacuna] of [[MAX_COMMITS_HISTORIA_EMPRESA, 'completa', null],
    [MAX_COMMITS_HISTORIA_EMPRESA + 1, 'inconclusiva', 'historia.excedeu-teto']] as const) {
    const repo = repositorioLinear(total);
    try {
      const historia = lerHistoriaDaEmpresa(portaGitDaRedeEmpresa(repo.cache).ler());
      assert.equal(historia.estado, estado);
      if (historia.estado === 'completa') {
        assert.equal(historia.registros.length, MAX_COMMITS_HISTORIA_EMPRESA);
        assert.deepEqual([historia.registros[0].ordinal, historia.registros.at(-1)?.ordinal],
          [1, MAX_COMMITS_HISTORIA_EMPRESA]);
      } else assert.equal(historia.lacuna, lacuna);
    } finally { repo.limpar(); }
  }
});

test('adaptador Git real tipa história rasa e cache truncado', () => {
  const rasa = repositorioLinear(2, true);
  try {
    const historia = lerHistoriaDaEmpresa(portaGitDaRedeEmpresa(rasa.cache).ler());
    assert.deepEqual([historia.estado, historia.estado === 'inconclusiva' && historia.lacuna],
      ['inconclusiva', 'historia.rasa']);
  } finally { rasa.limpar(); }

  const truncada = repositorioLinear(2);
  try {
    const ponta = portaGitDaRedeEmpresa(truncada.cache).ler();
    fs.rmSync(path.join(truncada.cache, '.git', 'objects'), { recursive: true, force: true });
    fs.mkdirSync(path.join(truncada.cache, '.git', 'objects', 'info'), { recursive: true });
    fs.mkdirSync(path.join(truncada.cache, '.git', 'objects', 'pack'), { recursive: true });
    const historia = lerHistoriaDaEmpresa(ponta);
    assert.deepEqual([historia.estado, historia.estado === 'inconclusiva' && historia.lacuna],
      ['inconclusiva', 'historia.truncada']);
  } finally { truncada.limpar(); }
});

test('adaptador Git real tipa história não linear', () => {
  const raiz = dirTemporario('rede-empresa-historia-merge'), remoto = path.join(raiz, 'origem'), cache = path.join(raiz, 'cache');
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', remoto]);
    git(remoto, 'config', 'user.name', 'Teste'); git(remoto, 'config', 'user.email', 'teste@invalid');
    fs.writeFileSync(path.join(remoto, 'base.txt'), 'base'); git(remoto, 'add', 'base.txt'); git(remoto, 'commit', '-qm', 'base');
    git(remoto, 'checkout', '-qb', 'lado'); fs.writeFileSync(path.join(remoto, 'lado.txt'), 'lado');
    git(remoto, 'add', 'lado.txt'); git(remoto, 'commit', '-qm', 'lado');
    git(remoto, 'checkout', '-q', 'main'); fs.writeFileSync(path.join(remoto, 'main.txt'), 'main');
    git(remoto, 'add', 'main.txt'); git(remoto, 'commit', '-qm', 'main'); git(remoto, 'merge', '--no-ff', '-qm', 'merge', 'lado');
    execFileSync('git', ['init', '-q', cache]); git(cache, 'remote', 'add', 'origin', remoto);
    const historia = lerHistoriaDaEmpresa(portaGitDaRedeEmpresa(cache).ler());
    assert.deepEqual([historia.estado, historia.estado === 'inconclusiva' && historia.lacuna],
      ['inconclusiva', 'historia.nao-linear']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
