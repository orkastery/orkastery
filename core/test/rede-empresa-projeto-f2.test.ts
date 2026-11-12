import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRATO_POLITICA_EMPRESA, CONTRATO_POLITICA_EMPRESA_V2, ehPoliticaDaEmpresa, nivelDaPolitica,
  type PoliticaDaEmpresa } from '../src/rede-empresa-contrato';
import { normalizarProjeto, segmentoDaProjectKey } from '../src/rede-empresa-projeto';

test('projectKey converge HTTPS, SSH, SCP, .git, caixa e portas padrão', () => {
  const entradas = [
    'https://GitHub.com/Time/Projeto.git/',
    'ssh://git@github.com:22/Time/Projeto.git',
    'git@github.com:Time/Projeto.git',
    'https://github.com:443/Time//Projeto.git',
  ];
  const chaves = entradas.map((entrada) => normalizarProjeto(entrada).projectKey);
  assert.deepEqual([...new Set(chaves)], ['github:github.com/time/projeto']);
  assert.match(segmentoDaProjectKey(chaves[0]), /^projeto-[a-f0-9]{24}$/);
});

test('projectKey separa forjas, hosts e homônimos e só converge espelho explícito', () => {
  const github = normalizarProjeto('https://github.com/time/projeto').projectKey;
  const gitlab = normalizarProjeto('https://gitlab.com/time/projeto').projectKey;
  const enterprise = normalizarProjeto('https://git.example.invalid/time/projeto', { forja: { tipo: 'gitlab' } }).projectKey;
  assert.equal(new Set([github, gitlab, enterprise]).size, 3);
  assert.equal(normalizarProjeto('https://git.example.invalid/time/projeto', { forja: { tipo: 'gitlab' },
    espelhos: [{ projectKey: enterprise, canonico: github }] }).projectKey, github);
  assert.throws(() => normalizarProjeto('https://git.example.invalid/time/projeto', { forja: { tipo: 'gitlab' }, espelhos: [
    { projectKey: enterprise, canonico: github }, { projectKey: enterprise, canonico: gitlab },
  ] }), /alias-ambiguo/);
});

test('política v2 declara cobertura e recibo, e v1 permanece legível como avisar', () => {
  const v1: PoliticaDaEmpresa = { contrato: CONTRATO_POLITICA_EMPRESA, versao: 'v1', saida: 'permitida', publicacaoMinima: 1 };
  const v2: PoliticaDaEmpresa = { contrato: CONTRATO_POLITICA_EMPRESA_V2, versao: 'v2', saida: 'negada', publicacaoMinima: 1,
    nivel: 'exigir', reciboVersao: 'recibo-v2', espelhos: [] };
  assert.equal(ehPoliticaDaEmpresa(v1), true);
  assert.equal(ehPoliticaDaEmpresa(v2), true);
  assert.deepEqual([nivelDaPolitica(v1), nivelDaPolitica(v2)], ['avisar', 'exigir']);
  assert.equal(ehPoliticaDaEmpresa({ ...v2, nivel: 'silencioso' }), false);
});
