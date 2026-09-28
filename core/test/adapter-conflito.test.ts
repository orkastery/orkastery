/**
 * I-43 (D5): a cerimonia de instalacao deixa de BARRAR sem deixar de DETECTAR.
 *
 * R1 do GOAL chama esta de a remocao com maior risco, e e a unica das cinco cujo
 * defeito evitado e SILENCIOSO: uma copia instalada editada a mao nao e alcancada por
 * nenhum teste da suite, porque a suite roda sobre o CATALOGO. Trocar uma recusa
 * barulhenta por nada seria trocar investigacao de madrugada por defeito que ninguem ve.
 *
 * O que muda e o que BARRA. O recibo `INSTALADO.json` ja gravava o sha de cada arquivo
 * NO MOMENTO da instalacao, e esse terceiro sha responde a pergunta que o texto antigo
 * apenas enunciava e nao resolvia ("ou a copia foi editada, ou o catalogo andou").
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classificarDivergencia, instalarAdaptador, lerRecibo, textoDaInstalacao } from '../src/hosts';
import { dirTemporario } from '../src/sandbox';

const CATALOGO = path.resolve(__dirname, '../../..');

function comDestino<T>(nome: string, fn: (destino: string) => T): T {
  const destino = dirTemporario(nome);
  try { return fn(destino); } finally { fs.rmSync(destino, { recursive: true, force: true }); }
}

test('os tres estados saem do recibo, e sem recibo nao se adivinha', () => {
  // As comparacoes sao entre TRES shas: catalogo agora, copia agora, e o que o recibo
  // gravou quando instalou. Sem o terceiro nao ha classificacao possivel.
  assert.equal(classificarDivergencia('novo', 'recibo', 'recibo'), 'catalogo-andou');
  assert.equal(classificarDivergencia('recibo', 'editado', 'recibo'), 'copia-editada');
  assert.equal(classificarDivergencia('novo', 'editado', 'recibo'), 'ambos-andaram');
  assert.equal(classificarDivergencia('a', 'b', undefined), 'sem-recibo');
});

test('a copia editada a mao e DETECTADA, NOMEADA e classificada, e BARRA', () => {
  comDestino('adapter-editado', (destino) => {
    const comum = { projeto: destino, dir: '.', catalogo: CATALOGO, versao: '0.0.0-teste' };
    const primeira = instalarAdaptador('hermes', comum);
    assert.equal(primeira.conflitos.length, 0, 'instalacao limpa nao inventa divergencia');
    assert.ok((lerRecibo(destino)?.arquivos.length ?? 0) > 0, 'o recibo nasce com o sha de cada arquivo');

    // Reinstalar sem mexer em nada nao acusa nada.
    assert.equal(instalarAdaptador('hermes', { ...comum, dryRun: true }).conflitos.length, 0);

    // Alguem edita a COPIA. E o defeito que a suite nao alcanca.
    const alvo = primeira.arquivos.find((a) => a.relativo.endsWith('README.md'))!;
    fs.appendFileSync(alvo.destino, '\n<!-- editado a mao -->\n');

    const depois = instalarAdaptador('hermes', { ...comum, dryRun: true });
    const achado = depois.conflitos.find((a) => a.relativo === alvo.relativo);
    assert.ok(achado, 'a edicao precisa ser detectada');
    assert.equal(achado!.divergencia, 'copia-editada');
    assert.equal(depois.ok, false, '`copia-editada` e justamente o que NAO se resolve sozinho');
    assert.ok(depois.precisamDeDecisao.some((a) => a.relativo === alvo.relativo));

    const texto = textoDaInstalacao(depois);
    assert.ok(texto.includes(alvo.relativo), 'a saida NOMEIA o arquivo');
    assert.match(texto, /\$ diff -u /, 'a saida traz o diff legivel');
    assert.match(texto, /--aceitar-catalogo/);
    assert.match(texto, /--manter-copia/);
    // `--force` ressincronizava tudo sem mostrar o que mudava, e era o UNICO caminho
    // oferecido. Ele continua existindo como instrumento cego, e sai do texto.
    assert.doesNotMatch(texto, /--force/);
  });
});

test('`catalogo-andou` resolve SOZINHO: a copia esta como foi instalada', () => {
  comDestino('adapter-catalogo-andou', (destino) => {
    const comum = { projeto: destino, dir: '.', catalogo: CATALOGO, versao: '0.0.0-teste' };
    const primeira = instalarAdaptador('hermes', comum);
    const alvo = primeira.arquivos.find((a) => a.relativo.endsWith('README.md'))!;

    // O CATALOGO andou: reescrevemos o recibo com um sha que bate com a copia atual,
    // simulando o que acontece quando o catalogo muda e a copia nao.
    const caminho = path.join(destino, 'INSTALADO.json');
    const recibo = JSON.parse(fs.readFileSync(caminho, 'utf8')) as { arquivos: { arquivo: string; sha256: string }[] };
    const entrada = recibo.arquivos.find((x) => x.arquivo === alvo.relativo)!;
    // A copia fica intacta e o catalogo "muda": basta o sha do catalogo divergir do
    // recibo enquanto a copia continua igual ao recibo.
    fs.appendFileSync(alvo.destino, '');
    entrada.sha256 = alvo.sha256;
    fs.writeFileSync(caminho, JSON.stringify(recibo));

    // Agora editamos a copia E o recibo juntos, para o estado ser "catalogo andou".
    fs.writeFileSync(alvo.destino, 'conteudo antigo da copia\n');
    entrada.sha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(alvo.destino)).digest('hex');
    fs.writeFileSync(caminho, JSON.stringify(recibo));

    const r = instalarAdaptador('hermes', { ...comum, dryRun: true });
    const achado = r.conflitos.find((a) => a.relativo === alvo.relativo);
    assert.equal(achado?.divergencia, 'catalogo-andou');
    assert.equal(r.precisamDeDecisao.some((a) => a.relativo === alvo.relativo), false,
      'divergencia segura nao pode virar decisao do operador');
    assert.match(textoDaInstalacao(r), /catalogo-andou/);
  });
});

test('`--dir` na raiz AVISA, em vez de reportar "tudo novo" com saida 0', () => {
  comDestino('adapter-dir-raiz', (raiz) => {
    // `--dir` e o destino COMPLETO, nao a raiz do projeto. Passar a raiz era o erro
    // natural, e ele devolvia "tudo novo, 0 divergentes" com saida 0: a copia editada
    // passava despercebida, e a unica coisa que o recibo existe para pegar nao era pega.
    const dentro = path.join(raiz, '.hermes');
    instalarAdaptador('hermes', { projeto: raiz, dir: '.hermes', catalogo: CATALOGO, versao: '0.0.0-teste' });
    assert.ok(fs.existsSync(path.join(dentro, 'INSTALADO.json')));

    const naRaiz = instalarAdaptador('hermes', { projeto: raiz, dir: '.', catalogo: CATALOGO, versao: '0.0.0-teste', dryRun: true });
    assert.equal(naRaiz.reciboVizinho, dentro, 'o comando precisa dizer onde o recibo esta');
    const texto = textoDaInstalacao(naRaiz);
    assert.match(texto, /ATENCAO/);
    assert.match(texto, /destino COMPLETO/);
  });
});

test('a resolucao e de UM comando, por arquivo, e `--manter-copia` nao esconde a divergencia', () => {
  comDestino('adapter-um-comando', (destino) => {
    const comum = { projeto: destino, dir: '.', catalogo: CATALOGO, versao: '0.0.0-teste' };
    const primeira = instalarAdaptador('hermes', comum);
    const alvo = primeira.arquivos.find((a) => a.relativo.endsWith('README.md'))!;
    fs.appendFileSync(alvo.destino, '\n<!-- editado -->\n');

    assert.equal(instalarAdaptador('hermes', { ...comum, dryRun: true }).ok, false);

    // Um comando, um arquivo: deixa de barrar.
    assert.equal(instalarAdaptador('hermes', { ...comum, dryRun: true, aceitarCatalogo: [alvo.relativo] }).ok, true);
    assert.equal(instalarAdaptador('hermes', { ...comum, dryRun: true, manterCopia: [alvo.relativo] }).ok, true);

    // `--manter-copia` de verdade preserva a copia...
    const antes = fs.readFileSync(alvo.destino, 'utf8');
    instalarAdaptador('hermes', { ...comum, manterCopia: [alvo.relativo] });
    assert.equal(fs.readFileSync(alvo.destino, 'utf8'), antes, 'a copia fica como estava');

    // ...e NAO esconde a divergencia na proxima rodada: esconder seria o defeito
    // silencioso de R1 voltando por outra porta.
    const seguinte = instalarAdaptador('hermes', { ...comum, dryRun: true });
    assert.ok(seguinte.conflitos.some((a) => a.relativo === alvo.relativo),
      'a divergencia continua sendo DETECTADA depois de o operador decidir manter');
  });
});
