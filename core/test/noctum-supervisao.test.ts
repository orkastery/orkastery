/**
 * RM-058 (N4, D1 a D4 e D13 a D15 da ork-rm058n4): os checkpoints da supervisão do arco e a seleção de contas e runtimes.
 * Todos os itens, contas, sessões e provas são SIMULADOS; as raízes de estado são descartáveis.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { abrirArco, prepararIngressoSimulado, TrabalhoSimulado } from './noctum-apoio';
import { assinar, instancia, linhasDoLog, regravarLog } from './noctum-supervisao-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerArco } from '../src/noctum-arco';
import { CONTRATO_ARCO } from '../src/noctum-arco';
import { dirDaSupervisao, gravarNaSupervisao, lerSupervisao, parametrosDoArco, RecusaDaSupervisao, retomadasDe } from '../src/noctum-supervisao';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

const UM: TrabalhoSimulado[] = [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA da supervisão.' }];
const adulterada = (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.adulterada';

test('S1: o log da supervisão é encadeado e assinado: linha trocada, removida ou com MAC errado reprova a leitura', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s1');
  try {
    abrirArco(p.dir, 'arco-s1', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s1', [
      { tipo: 'conducao_assumida', geracao: 1, quem: instancia('condutor'), prova: 'trava do kernel livre (SIMULADO)' },
      { tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'reserva-incerta', detalhe: 'SIMULADO' },
      { tipo: 'parada', motivo: 'supervisor-falhou', detalhe: 'SIMULADO' },
    ]);
    const original = linhasDoLog(p.dir, 'arco-s1');
    assert.equal(original.length, 4, 'os parâmetros entram antes, na primeira linha');
    assert.equal(lerSupervisao(p.dir, 'arco-s1').isolados.get('a')?.motivo, 'reserva-incerta');
    const trocada = original.map((l, i) => i === 2 ? l.replace('reserva-incerta', 'erro-repetido') : l);
    regravarLog(p.dir, 'arco-s1', trocada);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), (e: unknown) => adulterada(e) && /MAC/.test(String(e)));
    regravarLog(p.dir, 'arco-s1', original.filter((_, i) => i !== 1));
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), (e: unknown) => adulterada(e) && /fora da cadeia/.test(String(e)));
    const semMac = original.map((l, i) => i === 3 ? l.replace(/"mac":"[0-9a-f]{4}/, '"mac":"0000') : l);
    regravarLog(p.dir, 'arco-s1', semMac);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), adulterada);
    // O log volta inteiro e a escrita seguinte encadeia nele.
    regravarLog(p.dir, 'arco-s1', original);
    assert.equal(gravarNaSupervisao(p.carregado, 'arco-s1', [{ tipo: 'batida', quem: instancia('condutor'), geracao: 1 }]).linhas, 5);
  } finally { p.limpar(); }
});

test('S2: arquivo aberto a outros, link no lugar do log e segunda linha de parâmetros, mesmo assinada, reprovam', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s2');
  try {
    abrirArco(p.dir, 'arco-s2', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s2', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const log = path.join(dirDaSupervisao(p.dir, 'arco-s2'), 'supervisao.jsonl');
    fs.chmodSync(log, 0o644);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), (e: unknown) => adulterada(e) && /privado/.test(String(e)));
    fs.chmodSync(log, 0o600);
    // Uma segunda linha de parâmetros com MAC válido (quem tem a chave local a forja): a leitura recusa pela posição.
    const linhas = linhasDoLog(p.dir, 'arco-s2');
    const ultima = JSON.parse(linhas.at(-1)!) as { dados: Record<string, unknown> };
    const dados = { ...ultima.dados, seq: 3, anterior: createHash('sha256').update(linhas.at(-1)!).digest('hex'),
      evento: { tipo: 'parametros', parametros: { ...lerSupervisao(p.dir, 'arco-s2').parametros, tetoDeRetomadas: 99 } } };
    regravarLog(p.dir, 'arco-s2', [...linhas, assinar(p.dir, dados)]);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), (e: unknown) => adulterada(e) && /primeira linha/.test(String(e)));
    regravarLog(p.dir, 'arco-s2', linhas);
    fs.renameSync(log, `${log}.real`);
    fs.symlinkSync(`${log}.real`, log);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), adulterada);
    // Gravar parâmetros por fora, ou num arco que não existe, é recusa tipada.
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-s2', [{ tipo: 'parametros', parametros: lerArco(p.dir, 'arco-s2') as never }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-que-nao-existe', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
  } finally { p.limpar(); }
});

test('S3: a cauda incompleta não dá autoridade a ninguém e sai na escrita seguinte, que segue a cadeia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s3');
  try {
    abrirArco(p.dir, 'arco-s3', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s3', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const linhas = linhasDoLog(p.dir, 'arco-s3');
    regravarLog(p.dir, 'arco-s3', linhas, '{"dados":{"evento":{"tipo":"parada","motivo":"supervisor-falhou"');
    const lido = lerSupervisao(p.dir, 'arco-s3');
    assert.equal(lido.parada, null, 'a parada pela metade não vale');
    assert.equal(lido.linhas, 2);
    const depois = gravarNaSupervisao(p.carregado, 'arco-s3', [{ tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'sessao-presa', detalhe: 'SIMULADO' }]);
    assert.equal(depois.linhas, 3);
    assert.equal(linhasDoLog(p.dir, 'arco-s3').length, 3);
    assert.ok(!fs.readFileSync(path.join(dirDaSupervisao(p.dir, 'arco-s3'), 'supervisao.jsonl'), 'utf8').includes('"motivo":"supervisor-falhou"'));
  } finally { p.limpar(); }
});

test('S4: os parâmetros gravados na primeira linha valem mesmo com o manifesto mudado depois', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s4');
  try {
    abrirArco(p.dir, 'arco-s4', { trabalhos: UM });
    p.carregado.manifesto.retry.max_tentativas = 3;
    const antes = parametrosDoArco(p.carregado, 'arco-s4');
    assert.equal(antes.tetoDeRetomadas, 3);
    assert.equal(antes.cadenciaMs, 5 * 60_000, 'a cadência da D3 do dono');
    assert.equal(antes.carenciaMs, 15 * 60_000);
    p.carregado.manifesto.retry.max_tentativas = 9;
    assert.equal(parametrosDoArco(p.carregado, 'arco-s4').tetoDeRetomadas, 3);
    gravarNaSupervisao(p.carregado, 'arco-s4', [{ tipo: 'batida', quem: instancia('condutor'), geracao: null }]);
    assert.deepEqual(lerSupervisao(p.dir, 'arco-s4').parametros, antes);
    assert.equal(linhasDoLog(p.dir, 'arco-s4').filter(l => l.includes('"tipo":"parametros"')).length, 1);
  } finally { p.limpar(); }
});

test('S5: um processo novo deriva do disco as mesmas gerações, tentativas e contas fora: reiniciar não zera nada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s5');
  try {
    abrirArco(p.dir, 'arco-s5', { trabalhos: UM });
    const envelope = lerArco(p.dir, 'arco-s5')!;
    gravarNaSupervisao(p.carregado, 'arco-s5', [
      { tipo: 'conducao_assumida', geracao: 1, quem: instancia('condutor', 1), prova: 'SIMULADO' },
      { tipo: 'retomada_autorizada', trabalho: 'a', thread: 'ork-x', fase: 'GO', tentativa: 1, motivo: 'sessao-morta', sessao: null, prova: 'SIMULADO' },
      { tipo: 'retomada_autorizada', trabalho: 'a', thread: 'ork-x', fase: 'GO', tentativa: 2, motivo: 'sem-avanco', sessao: null, prova: 'SIMULADO' },
      { tipo: 'conta_fora', conta: 'perfil-a', runtime: 'claude-bg', motivo: 'cota-sem-reset', ate: null, prova: 'SIMULADO' },
      { tipo: 'conducao_assumida', geracao: 2, quem: instancia('vigia', 2), prova: 'SIMULADO' },
    ]);
    const dist = path.resolve(__dirname, '..');
    const script = `
      const path = require('node:path');
      const { lerSupervisao, retomadasDe } = require(path.join(${JSON.stringify(dist)}, 'src/noctum-supervisao'));
      const s = lerSupervisao(${JSON.stringify(p.dir)}, 'arco-s5');
      process.stdout.write(JSON.stringify({ geracao: s.geracao.numero, quem: s.geracao.quem.papel, tentativas: retomadasDe(s, 'a', 'GO'),
        conta: s.contasFora.get('perfil-a').motivo, teto: s.parametros.tetoDeRetomadas }));
    `;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { geracao: 2, quem: 'vigia', tentativas: 2, conta: 'cota-sem-reset', teto: p.carregado.manifesto.retry.max_tentativas });
    assert.equal(retomadasDe(lerSupervisao(p.dir, 'arco-s5'), 'a', 'GO'), 2);
    // Nada disso toca o envelope: a mesma versão, o mesmo hash, o mesmo fim e nenhuma autorização nova.
    const depois = lerArco(p.dir, 'arco-s5')!;
    assert.deepEqual([depois.versao, depois.envelopeSha256, depois.conteudo!.janela.fim], [envelope.versao, envelope.envelopeSha256, envelope.conteudo!.janela.fim]);
  } finally { p.limpar(); }
});

test('S6: a subchave é própria: uma linha assinada no domínio do log do arco não vale na supervisão', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s6');
  try {
    abrirArco(p.dir, 'arco-s6', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s6', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const linhas = linhasDoLog(p.dir, 'arco-s6');
    const segunda = JSON.parse(linhas[1]) as { dados: unknown };
    regravarLog(p.dir, 'arco-s6', [linhas[0], assinar(p.dir, segunda.dados, CONTRATO_ARCO)]);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s6'), (e: unknown) => adulterada(e) && /MAC/.test(String(e)));
    regravarLog(p.dir, 'arco-s6', [linhas[0], assinar(p.dir, segunda.dados)]);
    assert.equal(lerSupervisao(p.dir, 'arco-s6').linhas, 2, 'a mesma linha, assinada no domínio da supervisão, vale');
  } finally { p.limpar(); }
});
