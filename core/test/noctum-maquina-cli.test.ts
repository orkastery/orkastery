/**
 * RM-058, bloco B (B4; D5 e D22 da ork-rm058blocob): o `ork noctum maquina`, que dá ao dono a entrada desta máquina em
 * `maquinas` do envelope `v3` (o nome, a chave pública e a impressão dela), e o aviso do `ork noctum propor` quando o `v3`
 * não traz esta máquina ou a traz com outra chave. Raízes, chaves, contas e envelopes são SIMULADOS; o CLI roda num
 * processo filho, num projeto descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { pedidoV2, TrabalhoSimulado } from './noctum-apoio';
import { chaveSimulada, pedidoV3 } from './noctum-maquinas-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { AvisoDaProposta, avisosDaProposta, USO_DO_NOCTUM } from '../src/noctum-cli';
import { chavePublicaValida, impressaoDaChave, MaquinaDoArco, validarPedidoDeAbertura } from '../src/noctum-envelope';
import { identidadeDaMaquina } from '../src/noctum-transporte';
import { PerfilDeRuntime, StoreDePerfis } from '../src/runtime-profiles';

const semKernel = !kernelDisponivel();
const CLI = path.resolve(__dirname, '../../dist/index.js');
type Projeto = ReturnType<typeof projetoTemporario>;

/** O CLI no projeto, com o nome da máquina por `ORK_MAQUINA` (a precedência de `nomeDaMaquina`). */
function cli(dir: string, args: string[], maquina: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ORK_MAQUINA: maquina },
    timeout: 60_000 });
}

/** Trabalho de pedido, sem thread: no `v3`, nenhum precisa de máquina presa. */
const TRABALHOS: TrabalhoSimulado[] = [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Trabalho SIMULADO da máquina.' }];

const perfil = (id: string): PerfilDeRuntime => ({ id, runtime: 'claude-bg', configDir: `/contas/${id}`, estado: 'ativo', esgotadoAte: null,
  ultimaFalha: null, ultimoUso: null, criadoEm: '2026-01-01T00:00:00.000Z' });
/** A conta do envelope com login e trust, SIMULADOS: dos avisos, só os da máquina podem sobrar. */
const CONTAS_PRONTAS = { store: { contrato: 'ork.runtime-profiles/v1', perfis: [perfil('perfil-a')] } as StoreDePerfis, confianca: () => true };
const daMaquina = (avisos: AvisoDaProposta[]) => avisos.filter(a => a.motivo.startsWith('noctum.proposta.maquina'));

/** A saída do `ork noctum maquina --json` de uma raiz. */
function maquinaDe(p: Projeto, nome: string): { nome: string; chave: string; impressao: string } {
  const r = cli(p.dir, ['noctum', 'maquina', '--json'], nome);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { nome: string; chave: string; impressao: string };
}

test('MQ1: ork noctum maquina dá o nome, a chave pública canônica e a impressão desta raiz, no texto e no --json', () => {
  const p = projetoTemporario('noctum-mq1');
  try {
    const r = cli(p.dir, ['noctum', 'maquina', '--json'], 'maquina-mq1');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { nome: string; chave: string; impressao: string };
    assert.deepEqual(Object.keys(j).sort(), ['chave', 'impressao', 'nome'], 'só o nome, a chave e a impressão (D5)');
    assert.equal(j.nome, 'maquina-mq1');
    assert.equal(chavePublicaValida(j.chave), j.chave, 'a chave sai na forma canônica que o envelope aceita');
    assert.equal(j.chave, identidadeDaMaquina(p.dir, 'maquina-mq1').chave, 'a chave é a desta raiz de estado');
    assert.equal(j.impressao, impressaoDaChave(j.chave));
    assert.deepEqual(maquinaDe(p, 'maquina-mq1'), j, 'a mesma raiz dá sempre a mesma saída');
    const t = cli(p.dir, ['noctum', 'maquina'], 'maquina-mq1');
    assert.equal(t.status, 0, t.stderr);
    for (const parte of [j.nome, j.chave, j.impressao]) assert.ok(t.stdout.includes(parte), parte);
    assert.ok(t.stdout.includes(JSON.stringify({ nome: j.nome, chave: j.chave })), 'a entrada de maquinas pronta para o envelope');
  } finally { p.limpar(); }
});

test('MQ2: a saída do ork noctum maquina não traz material privado, o caminho da raiz nem a pasta privada', () => {
  const p = projetoTemporario('noctum-mq2');
  try {
    const saidas = [cli(p.dir, ['noctum', 'maquina', '--json'], 'maquina-mq2'), cli(p.dir, ['noctum', 'maquina'], 'maquina-mq2')];
    const privada = path.join(p.dir, '.orkastery', 'private');
    const segredos = fs.readdirSync(privada).map(n => path.join(privada, n)).filter(f => fs.statSync(f).isFile())
      .map(f => fs.readFileSync(f, 'utf8').trim()).filter(Boolean);
    assert.ok(segredos.length > 0, 'a chave local existe depois do comando');
    const { chave } = identidadeDaMaquina(p.dir, 'maquina-mq2');
    for (const s of saidas) {
      assert.equal(s.status, 0, s.stderr);
      const tudo = s.stdout + s.stderr;
      for (const segredo of segredos) assert.ok(!tudo.includes(segredo), 'nenhum conteúdo da pasta privada');
      assert.ok(!tudo.includes(p.dir), 'sem o caminho da raiz');
      assert.ok(!tudo.includes(path.join('.orkastery', 'private')), 'sem a pasta privada');
      assert.doesNotMatch(tudo, /PRIVATE KEY|pkcs8/i);
      const blocos = tudo.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? [];
      assert.ok(blocos.length > 0 && blocos.every(b => b === chave), 'o único bloco base64 da saída é a chave pública');
    }
  } finally { p.limpar(); }
});

test('MQ3: duas raízes dão duas saídas que compõem maquinas válido num envelope v3', () => {
  const um = projetoTemporario('noctum-mq3-um'), dois = projetoTemporario('noctum-mq3-dois');
  try {
    const maquinas: MaquinaDoArco[] = [maquinaDe(um, 'maquina-um'), maquinaDe(dois, 'maquina-dois')].map(m => ({ nome: m.nome, chave: m.chave }));
    assert.notEqual(maquinas[0].chave, maquinas[1].chave, 'cada raiz tem a própria chave');
    const conteudo = validarPedidoDeAbertura(pedidoV3('arco-mq3', { trabalhos: TRABALHOS, maquinas }));
    assert.equal(conteudo.contrato, 'ork.noctum-envelope/v3');
    assert.deepEqual((conteudo as { maquinas?: MaquinaDoArco[] }).maquinas, maquinas);
  } finally { um.limpar(); dois.limpar(); }
});

test('MQ4: o nome desta máquina fora do formato do envelope sai 2, com a correção, e o uso errado mostra o subcomando', () => {
  const p = projetoTemporario('noctum-mq4');
  try {
    for (const nome of ['máquina com espaço', '-comeca-com-traco', 'x'.repeat(65)]) {
      const r = cli(p.dir, ['noctum', 'maquina', '--json'], nome);
      assert.equal(r.status, 2, `${nome}: ${r.stdout}`);
      assert.equal(r.stdout, '', 'nada sai como se fosse a entrada da máquina');
      assert.match(r.stderr, /noctum\.maquina\.nome-invalido/);
      assert.match(r.stderr, /ORK_MAQUINA/);
      assert.match(r.stderr, /maquina\.json/);
    }
    assert.ok(!fs.existsSync(path.join(p.dir, '.orkastery', 'private', 'hitl-local-signing.key')), 'o nome recusado não cria chave');
    const extra = cli(p.dir, ['noctum', 'maquina', 'extra'], 'maquina-mq4');
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /maquina \[--json\]/);
    assert.match(USO_DO_NOCTUM, /maquina \[--json\]/);
  } finally { p.limpar(); }
});

test('MQ5: o propor de um v3 avisa, sem recusar, quando esta máquina falta no envelope ou está nele com outra chave', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mq5');
  try {
    const eu = identidadeDaMaquina(p.dir, 'maquina-mq5');
    const outra = { nome: 'maquina-outra', chave: chaveSimulada('mq5-outra') }, velha = chaveSimulada('mq5-velha');
    const avisos = (maquinas: MaquinaDoArco[]) => daMaquina(avisosDaProposta(p.carregado,
      validarPedidoDeAbertura(pedidoV3('arco-mq5', { trabalhos: TRABALHOS, maquinas })), { ...CONTAS_PRONTAS, identidade: () => eu }));
    const ausente = avisos([outra]);
    assert.deepEqual(ausente.map(a => a.motivo), ['noctum.proposta.maquina-ausente']);
    assert.match(ausente[0].detalhe, /maquina-mq5/);
    assert.match(ausente[0].correcao, /ork noctum maquina --json/);
    const trocada = avisos([{ nome: eu.nome, chave: velha }, outra]);
    assert.deepEqual(trocada.map(a => a.motivo), ['noctum.proposta.maquina-outra-chave']);
    assert.ok(trocada[0].detalhe.includes(impressaoDaChave(velha)) && trocada[0].detalhe.includes(impressaoDaChave(eu.chave)), trocada[0].detalhe);
    assert.deepEqual(avisos([eu, outra]), [], 'com o nome e a chave desta raiz, nenhum aviso da máquina');
    // Pelo CLI: o aviso sai no --json e no texto, a proposta fica gravada e a saída segue 0.
    const arquivo = path.join(p.dir, 'envelope-mq5.json');
    fs.writeFileSync(arquivo, JSON.stringify(pedidoV3('arco-mq5', { trabalhos: TRABALHOS, maquinas: [outra] })));
    const j = cli(p.dir, ['noctum', 'propor', '--arquivo', arquivo, '--json'], 'maquina-mq5');
    assert.equal(j.status, 0, j.stderr);
    const r = JSON.parse(j.stdout) as { autorizado: boolean; avisos: AvisoDaProposta[] };
    assert.equal(r.autorizado, false);
    assert.deepEqual(daMaquina(r.avisos).map(a => a.motivo), ['noctum.proposta.maquina-ausente']);
    const t = cli(p.dir, ['noctum', 'propor', '--arquivo', arquivo], 'maquina-mq5');
    assert.equal(t.status, 0, t.stderr);
    assert.match(t.stdout, /Avisos \(não bloqueiam a proposta\):[\s\S]*noctum\.proposta\.maquina-ausente/);
  } finally { p.limpar(); }
});

test('MQ6: o propor de um v2 não lê a identidade da máquina nem avisa dela', () => {
  const p = projetoTemporario('noctum-mq6');
  try {
    let lidas = 0;
    const conteudo = validarPedidoDeAbertura(pedidoV2('arco-mq6', { trabalhos: TRABALHOS }));
    const avisos = avisosDaProposta(p.carregado, conteudo, { ...CONTAS_PRONTAS,
      identidade: () => { lidas += 1; return identidadeDaMaquina(p.dir, 'maquina-mq6'); } });
    assert.deepEqual(avisos, [], 'v2 com a conta pronta e duas vagas de execução: nenhum aviso');
    assert.equal(lidas, 0, 'o v2 não tem máquinas: a identidade nem é lida');
  } finally { p.limpar(); }
});

test('MQ7: os avisos do propor olham o envelope proposto, e saem já na primeira proposta, antes de qualquer autorização', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mq7');
  try {
    // Uma vaga de execução só (máquina 2, revisão 1): o aviso não depende de conta nem de trust.
    const arquivo = path.join(p.dir, 'envelope-mq7.json');
    fs.writeFileSync(arquivo, JSON.stringify(pedidoV2('arco-mq7', { trabalhos: TRABALHOS, maquina: 2, revisao: 1 })));
    const j = cli(p.dir, ['noctum', 'propor', '--arquivo', arquivo, '--json'], 'maquina-mq7');
    assert.equal(j.status, 0, j.stderr);
    const r = JSON.parse(j.stdout) as { autorizado: boolean; versao: number; avisos: AvisoDaProposta[] };
    assert.deepEqual([r.autorizado, r.versao], [false, 1], 'a primeira proposta do arco, sem nada autorizado');
    assert.ok(r.avisos.some(a => a.motivo === 'noctum.proposta.vaga-de-execucao-unica'), j.stdout);
    assert.deepEqual(daMaquina(r.avisos), [], 'v2: nenhum aviso da máquina');
  } finally { p.limpar(); }
});
