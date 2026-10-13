/**
 * RM-058 (N3): o transporte assinado do ramo de coordenação. Duas "máquinas" são dois clones de um remoto bare de
 * fixture, cada um com a própria raiz de estado; chaves, contas e pedidos são SIMULADOS. Nada toca remoto de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from '../src/util';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { cloneDoRemoto, duasMaquinas, DuasMaquinas, gravarCru, registroCru } from './noctum-maquinas-apoio';
import { chavePublicaValida, RecusaDoArco } from '../src/noctum-envelope';
import { exigirManifesto } from '../src/manifest';
import {
  assinarDados, BRANCH_DE_COORDENACAO, CONTRATO_COORDENACAO, DadosDoRegistro, gravarNoRamo, identidadeDaMaquina, LeituraDoRamo, lerRamo,
} from '../src/noctum-transporte';

prepararIngressoSimulado();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: [], pedido: 'Fatia B SIMULADA.' },
];

function cenario(nome: string): DuasMaquinas {
  return duasMaquinas(nome, { trabalhos: TRABALHOS.map(t => ({ ...t })), contas: [{ conta: 'perfil-a', sessoes: 2 }] });
}

/** Confere o motivo tipado e devolve a mensagem. */
function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

/** Grava uma entrega SIMULADA (um registro de caminho único) pela máquina dada. */
function entrega(m: DuasMaquinas, quem: 'a' | 'b', trabalho: string): string | null {
  const maq = m[quem];
  return gravarNoRamo(maq.carregado, m.arco, { maquina: maq.nome }, () => ({
    novos: [{ tipo: 'entrega', trabalho, ordem: `O-${trabalho}-1`, simulado: true }], resultado: null })).commit;
}

/** Um registro com os campos comuns, para escrever à mão nos testes de adulteração. */
function dados(m: DuasMaquinas, extra: Record<string, unknown>): DadosDoRegistro {
  return { contrato: CONTRATO_COORDENACAO, arco: m.arco, envelopeSha256: m.hash, por: 'maquina-a', em: new Date().toISOString(),
    tipo: 'entrega', ...extra } as DadosDoRegistro;
}

const assinado = (raiz: string, d: DadosDoRegistro) => JSON.stringify({ dados: d, assinatura: assinarDados(raiz, d) }) + '\n';

test('T1: a chave da máquina é Ed25519, estável por raiz de estado e diferente entre raízes', () => {
  const m = cenario('noctum-t1');
  try {
    const a1 = identidadeDaMaquina(m.a.dir, 'maquina-a'), a2 = identidadeDaMaquina(m.a.dir, 'maquina-a');
    const b = identidadeDaMaquina(m.b.dir, 'maquina-b');
    assert.equal(a1.chave, a2.chave);
    assert.notEqual(a1.chave, b.chave);
    assert.equal(chavePublicaValida(a1.chave), a1.chave);
    assert.equal(identidadeDaMaquina(m.a.dir, 'outro-nome').chave, a1.chave, 'a chave é da raiz, não do nome');
    const chave = fs.statSync(path.join(m.a.dir, '.orkastery', 'private', 'hitl-local-signing.key'));
    assert.equal(chave.mode & 0o777, 0o600, 'a chave local de onde ela deriva é privada');
  } finally { m.limpar(); }
});

test('T2: o que uma máquina grava a outra lê, com a assinatura conferida pela chave do envelope', () => {
  const m = cenario('noctum-t2');
  try {
    assert.equal(lerRamo(m.b.carregado, m.arco).ponta, null, 'o ramo ainda não nasceu');
    assert.match(String(entrega(m, 'a', 'ta')), /^[0-9a-f]{40}$/);
    const lida = lerRamo(m.b.carregado, m.arco);
    assert.deepEqual(lida.registros.map(r => [r.caminho, r.dados.por]), [[`arcos/${m.arco}/entregas/ta.json`, 'maquina-a']]);
    assert.equal(lida.versoes.at(-1)!.envelopeSha256, m.hash);
    // Nada tocou a árvore de trabalho nem criou branch local.
    for (const dir of [m.a.dir, m.b.dir]) {
      assert.equal(exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH_DE_COORDENACAO}`], dir).ok, false);
    }
  } finally { m.limpar(); }
});

test('T3: assinatura de outra chave, máquina fora do envelope e caminho trocado recusam a leitura inteira', () => {
  const m = cenario('noctum-t3');
  try {
    entrega(m, 'a', 'boa');
    const intrusa = cloneDoRemoto(m.remoto, 'noctum-t3-c', 'Intrusa');
    // Assinado pela chave de outra raiz, dizendo ser a máquina A.
    gravarCru(m.b.dir, [{ caminho: `arcos/${m.arco}/entregas/forjada.json`, conteudo: assinado(intrusa, dados(m, { trabalho: 'forjada' })) }]);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.adulterado'), /forjada\.json com assinatura que não confere/);
    const m2 = cenario('noctum-t3b');
    try {
      gravarCru(m2.b.dir, [{ caminho: `arcos/${m2.arco}/entregas/fora.json`,
        conteudo: assinado(m2.a.dir, { ...dados(m2, { trabalho: 'fora' }), por: 'maquina-z' }) }]);
      assert.match(recusa(() => lerRamo(m2.b.carregado, m2.arco), 'noctum.coordenacao.adulterado'), /máquina fora do envelope \(maquina-z\)/);
    } finally { m2.limpar(); }
    const m3 = cenario('noctum-t3c');
    try {
      entrega(m3, 'a', 'original');
      const bom = registroCru(m3.b.dir, `arcos/${m3.arco}/entregas/original.json`);
      gravarCru(m3.b.dir, [{ caminho: `arcos/${m3.arco}/entregas/copia.json`, conteudo: bom }]);
      assert.match(recusa(() => lerRamo(m3.b.carregado, m3.arco), 'noctum.coordenacao.adulterado'), /copia\.json não é o caminho dos dados dele/);
      // Nada é decidido: a gravação também recusa, antes de escrever.
      recusa(() => entrega(m3, 'a', 'depois'), 'noctum.coordenacao.adulterado');
    } finally { m3.limpar(); }
    fs.rmSync(path.dirname(intrusa), { recursive: true, force: true });
  } finally { m.limpar(); }
});

test('T4: registro apagado ou alterado depois de visto recusa a leitura de quem já o viu', () => {
  const m = cenario('noctum-t4');
  try {
    entrega(m, 'a', 'x');
    entrega(m, 'a', 'y');
    assert.equal(lerRamo(m.b.carregado, m.arco).registros.length, 2, 'B viu os dois');
    gravarCru(m.a.dir, [{ caminho: `arcos/${m.arco}/entregas/x.json`, conteudo: null }]);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.adulterado'), /entregas\/x\.json foi apagado depois de visto/);
    const m2 = cenario('noctum-t4b');
    try {
      entrega(m2, 'a', 'x');
      assert.equal(lerRamo(m2.b.carregado, m2.arco).registros.length, 1);
      // A regrava o registro com outro conteúdo, assinado por ela mesma: alterar não é acrescentar.
      gravarCru(m2.a.dir, [{ caminho: `arcos/${m2.arco}/entregas/x.json`,
        conteudo: assinado(m2.a.dir, dados(m2, { trabalho: 'x', ordem: 'O-x-2' })) }]);
      assert.match(recusa(() => lerRamo(m2.b.carregado, m2.arco), 'noctum.coordenacao.adulterado'), /entregas\/x\.json foi alterado depois de visto/);
      recusa(() => lerRamo(m2.a.carregado, m2.arco), 'noctum.coordenacao.adulterado');
    } finally { m2.limpar(); }
    const m3 = cenario('noctum-t4c');
    try {
      // A batida é o único registro regravado: a segunda passa na leitura de quem viu a primeira.
      const bater = () => gravarNoRamo(m3.a.carregado, m3.arco, { maquina: 'maquina-a' }, () => ({ novos: [{ tipo: 'batida' }], resultado: null }));
      bater();
      const primeira = lerRamo(m3.b.carregado, m3.arco).registros[0].dados.em;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      bater();
      const lida = lerRamo(m3.b.carregado, m3.arco).registros;
      assert.equal(lida.length, 1);
      assert.ok(lida[0].dados.em > primeira, 'a batida nova substitui a velha');
    } finally { m3.limpar(); }
  } finally { m.limpar(); }
});

test('T5: história reescrita por push forçado e ramo apagado depois de visto recusam', () => {
  const m = cenario('noctum-t5');
  try {
    const primeiro = entrega(m, 'a', 'p')!;
    entrega(m, 'a', 'q');
    assert.equal(lerRamo(m.b.carregado, m.arco).registros.length, 2);
    exec('git', ['push', '-q', '--force', 'origin', `${primeiro}:refs/heads/${BRANCH_DE_COORDENACAO}`], m.a.dir);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.adulterado'), /a história do ramo foi reescrita/);
    // E o ramo trocado por outro que não desce do visto: a mesma recusa.
    const outro = gravarCru(m.a.dir, [{ caminho: `arcos/${m.arco}/entregas/outra.json`, conteudo: assinado(m.a.dir, dados(m, { trabalho: 'outra' })) }]);
    assert.match(outro, /^[0-9a-f]{40}$/);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.adulterado'), /a história do ramo foi reescrita/);
    const m2 = cenario('noctum-t5b');
    try {
      entrega(m2, 'a', 'p');
      lerRamo(m2.b.carregado, m2.arco);
      exec('git', ['push', '-q', 'origin', `:refs/heads/${BRANCH_DE_COORDENACAO}`], m2.a.dir);
      assert.match(recusa(() => lerRamo(m2.b.carregado, m2.arco), 'noctum.coordenacao.adulterado'), /sumiu do remoto origin depois de visto/);
    } finally { m2.limpar(); }
  } finally { m.limpar(); }
});

test('T6: sem o remoto nada é lido nem gravado, e a cópia local não vira fato', () => {
  const m = cenario('noctum-t6');
  try {
    entrega(m, 'a', 'antes');
    lerRamo(m.b.carregado, m.arco);
    exec('git', ['remote', 'set-url', 'origin', path.join(path.dirname(m.remoto), 'nao-existe.git')], m.b.dir);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.sem-remoto'), /sem leitura nova, nada é decidido/);
    recusa(() => entrega(m, 'b', 'partida'), 'noctum.coordenacao.sem-remoto');
    exec('git', ['remote', 'set-url', 'origin', m.remoto], m.b.dir);
    assert.deepEqual(lerRamo(m.b.carregado, m.arco).registros.map(r => r.dados.trabalho), ['antes'], 'a máquina partida não gravou nada');
    recusa(() => lerRamo(m.b.carregado, m.arco, { remoto: '-origin' }), 'noctum.coordenacao.sem-remoto');
  } finally { m.limpar(); }
});

test('T7: dois processos gravando ao mesmo tempo nunca perdem um registro do outro', async () => {
  const m = cenario('noctum-t7');
  try {
    const dist = path.resolve(__dirname, '..');
    const sinal = path.join(path.dirname(m.remoto), 'comecar');
    const script = (dir: string, maquina: string, prefixo: string) => `
      const fs = require('node:fs'); const path = require('node:path');
      const { gravarNoRamo } = require(path.join(${JSON.stringify(dist)}, 'src/noctum-transporte'));
      const { exigirManifesto } = require(path.join(${JSON.stringify(dist)}, 'src/manifest'));
      const carregado = exigirManifesto(${JSON.stringify(dir)});
      while (!fs.existsSync(${JSON.stringify(sinal)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      for (let i = 1; i <= 4; i++) {
        gravarNoRamo(carregado, ${JSON.stringify(m.arco)}, { maquina: ${JSON.stringify(maquina)} },
          () => ({ novos: [{ tipo: 'entrega', trabalho: ${JSON.stringify(prefixo)} + i, ordem: 'O-' + ${JSON.stringify(prefixo)} + i + '-1' }], resultado: null }));
      }
    `;
    const rodar = (dir: string, maquina: string, prefixo: string) => new Promise<void>((resolve, reject) => {
      const filho = spawn(process.execPath, ['-e', script(dir, maquina, prefixo)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let erro = '';
      filho.stderr.on('data', (d) => { erro += String(d); });
      filho.once('exit', (codigo) => codigo === 0 ? resolve() : reject(new Error(`filho saiu ${codigo}: ${erro}`)));
    });
    const corrida = Promise.all([rodar(m.a.dir, 'maquina-a', 'a'), rodar(m.b.dir, 'maquina-b', 'b')]);
    fs.writeFileSync(sinal, '');
    await corrida;
    const trabalhos = lerRamo(exigirManifesto(m.a.dir), m.arco).registros.map(r => String(r.dados.trabalho)).sort();
    assert.deepEqual(trabalhos, ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4']);
  } finally { m.limpar(); }
});

test('T8: registro de versão que esta máquina não autorizou, máquina fora do envelope e envelope v2 não gravam nem leem', () => {
  const m = cenario('noctum-t8');
  try {
    // A autoriza uma emenda que B ainda não autorizou: o que A grava nela, B não confere.
    const emenda = { ...m.pedido, relatorio: { horario: '08:00', canal: 'telegram' } };
    const nova = autorizarPedido(m.a.dir, m.arco, emenda);
    assert.notEqual(nova, m.hash);
    entrega(m, 'a', 'da-emenda');
    // A3 da revisão: é espera, não adulteração; nada se lê nem se grava até o dono autorizar a emenda aqui.
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.versao-nao-autorizada'),
      /versão do envelope que esta máquina ainda não autorizou: autorize a emenda aqui/);
    recusa(() => entrega(m, 'b', 'antes-da-emenda'), 'noctum.coordenacao.versao-nao-autorizada');
    assert.equal(autorizarPedido(m.b.dir, m.arco, emenda), nova);
    assert.equal(lerRamo(m.b.carregado, m.arco).registros.length, 1, 'autorizada aqui também, a leitura confere');
    // A raiz de B dizendo ser A: a chave não bate.
    assert.match(recusa(() => gravarNoRamo(m.b.carregado, m.arco, { maquina: 'maquina-a' }, () => ({ novos: [{ tipo: 'batida' }], resultado: null })),
      'noctum.coordenacao.fora-do-envelope'), /a chave desta raiz não é a que o envelope dá à máquina maquina-a/);
    assert.match(recusa(() => gravarNoRamo(m.b.carregado, m.arco, { maquina: 'maquina-z' }, () => ({ novos: [{ tipo: 'batida' }], resultado: null })),
      'noctum.coordenacao.fora-do-envelope'), /a máquina maquina-z não está no envelope vigente/);
    assert.match(recusa(() => lerRamo(m.b.carregado, 'arco-nunca-autorizado'), 'noctum.coordenacao.fora-do-envelope'),
      /não tem envelope autorizado nesta máquina/);
    // Um arco v2 desta raiz lê o ramo (vazio para ele) e não grava: só a v3 tem máquinas.
    autorizarPedido(m.a.dir, 'arco-v2', pedidoV2('arco-v2', { trabalhos: TRABALHOS.map(t => ({ ...t })) }));
    assert.equal(lerRamo(m.a.carregado, 'arco-v2').registros.length, 0);
    assert.match(recusa(() => gravarNoRamo(m.a.carregado, 'arco-v2', { maquina: 'maquina-a' }, () => ({ novos: [{ tipo: 'batida' }], resultado: null })),
      'noctum.coordenacao.fora-do-envelope'), /só a v3 coordena/);
  } finally { m.limpar(); }
});

test('T9: a batida nunca volta no tempo: quem grava não regride a própria, e a regressão assinada recusa a leitura de quem viu', () => {
  const m = cenario('noctum-t9');
  try {
    const bater = (quando: string) => gravarNoRamo(m.a.carregado, m.arco, { maquina: 'maquina-a', quando }, () => ({ novos: [{ tipo: 'batida' }], resultado: null }));
    const agora = Date.now();
    const caminho = `arcos/${m.arco}/batidas/maquina-a.json`;
    bater(new Date(agora).toISOString());
    // O relógio daqui voltou um minuto: a batida nova fica com o instante da anterior.
    bater(new Date(agora - 60_000).toISOString());
    assert.equal(lerRamo(m.b.carregado, m.arco).registros.find(r => r.caminho === caminho)!.dados.em, new Date(agora).toISOString());
    // A batida mais velha, assinada pela própria A e gravada à mão: a B, que viu a nova, recusa.
    gravarCru(m.a.dir, [{ caminho, conteudo: assinado(m.a.dir, dados(m, { tipo: 'batida', em: new Date(agora - 120_000).toISOString() })) }]);
    assert.match(recusa(() => lerRamo(m.b.carregado, m.arco), 'noctum.coordenacao.adulterado'), /a batida .*maquina-a\.json voltou no tempo depois de vista/);
  } finally { m.limpar(); }
});

test('T10: a última ponta vista só avança depois que a leitura inteira confere; o reparo do ramo volta a ler', () => {
  const m = cenario('noctum-t10');
  try {
    const boa = entrega(m, 'a', 'boa')!;
    lerRamo(m.b.carregado, m.arco);
    entrega(m, 'a', 'incoerente');
    // A coerência de quem chama reprova a ponta nova: a última ponta vista da B fica na boa.
    const conferir = (l: LeituraDoRamo) => {
      if (l.registros.some(r => r.dados.trabalho === 'incoerente')) throw new RecusaDoArco('noctum.coordenacao.adulterado', 'SIMULADO: registro incoerente');
    };
    recusa(() => lerRamo(m.b.carregado, m.arco, {}, conferir), 'noctum.coordenacao.adulterado');
    const vista = JSON.parse(fs.readFileSync(path.join(m.b.dir, '.orkastery', 'noctum', 'arcos', m.arco, 'coordenacao.json'), 'utf8'));
    assert.equal(vista.remotos.origin.ponta, boa);
    // O reparo (o ramo de volta à ponta boa) não é história reescrita para quem nunca aceitou a incoerente.
    exec('git', ['push', '-q', '--force', 'origin', `${boa}:refs/heads/${BRANCH_DE_COORDENACAO}`], m.a.dir);
    assert.deepEqual(lerRamo(m.b.carregado, m.arco, {}, conferir).registros.map(r => r.dados.trabalho), ['boa']);
    // Quem gravou a incoerente a viu, e para ela o reparo é reescrita.
    assert.match(recusa(() => lerRamo(m.a.carregado, m.arco), 'noctum.coordenacao.adulterado'), /a história do ramo foi reescrita/);
  } finally { m.limpar(); }
});

test('T11: o commit do ramo leva a identidade da máquina, nunca o nome e o e-mail do git de quem a usa', () => {
  const m = cenario('noctum-t11');
  try {
    entrega(m, 'a', 'x');
    entrega(m, 'b', 'y');
    lerRamo(m.a.carregado, m.arco);
    const log = exec('git', ['log', '--format=%an <%ae> %cn <%ce>', `refs/remotes/origin/${BRANCH_DE_COORDENACAO}`], m.a.dir).stdout.trim().split('\n');
    assert.deepEqual(log.sort(), ['ork-noctum maquina-a <ork-noctum@noctum.invalid> ork-noctum maquina-a <ork-noctum@noctum.invalid>',
      'ork-noctum maquina-b <ork-noctum@noctum.invalid> ork-noctum maquina-b <ork-noctum@noctum.invalid>']);
    assert.ok(!log.join('\n').includes('Builder B'), 'a identidade do git da B não foi ao remoto');
  } finally { m.limpar(); }
});
