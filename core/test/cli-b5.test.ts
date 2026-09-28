/**
 * Testes do bloco B5 pelo BINARIO, nao pelas funcoes.
 *
 * `ork audit run` e chamado por CRON e por orquestrador de host: quem consome o comando e
 * uma linha de shell, entao e a linha de shell que precisa estar coberta. Um codigo de saida
 * que mude de 1 para 0 numa reprovacao faria o agendador achar que a rodada passou.
 *
 * Nenhum teste aqui despacha sessao: todo `audit run` roda em `--dry-run`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return {
      saida: execFileSync(process.execPath, [ORK, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      codigo: 0,
    };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('ork --help anuncia os comandos do bloco B5', () => {
  const { saida, codigo } = ork(process.cwd(), ['--help']);
  assert.equal(codigo, 0);
  for (const comando of [
    'audit packs',
    'audit run <pack>',
    'audit ingest',
    'audit verify',
    'audit report',
    'audit divida',
    'audit surface',
    '--from-finding',
  ]) {
    assert.ok(saida.includes(comando), `a ajuda nao cita "${comando}"`);
  }
  assert.ok(saida.includes('security-privacy'), 'a ajuda lista os 7 packs');
  assert.ok(saida.includes('nascente, crescendo, maduro'), 'a ajuda lista os estagios');
});

test('ork audit packs mostra o hardening por estagio do projeto', (t) => {
  const p = projetoTemporario('b5-cli-packs');
  t.after(p.limpar);

  const { saida, codigo } = ork(p.dir, ['audit', 'packs']);
  assert.equal(codigo, 0);
  assert.ok(saida.includes('estagio declarado do projeto: nascente'));
  assert.ok(saida.includes('Ativos aqui e agora: clean-code, reuse, process'));

  const maduro = ork(p.dir, ['audit', 'packs', '--estagio', 'maduro']);
  assert.ok(maduro.saida.includes('security-privacy, process'));

  const detalhe = ork(p.dir, ['audit', 'packs', 'security-privacy']);
  assert.equal(detalhe.codigo, 0);
  assert.ok(detalhe.saida.includes('SP2'), 'o detalhe do pack mostra as regras de LGPD');
  assert.ok(detalhe.saida.includes('inativo'), 'e diz que o pack esta inativo neste estagio');

  assert.equal(ork(p.dir, ['audit', 'packs', 'inexistente']).codigo, 2);
});

test('ork audit run sai != 0 quando reprova, e monta o prompt quando passa', (t) => {
  const p = projetoTemporario('b5-cli-run');
  t.after(p.limpar);

  // Pack inativo no estagio: o agendador precisa ver codigo diferente de zero.
  const inativo = ork(p.dir, ['audit', 'run', 'security-privacy', '--dry-run', '--agora', 'teste']);
  assert.equal(inativo.codigo, 1);
  assert.ok(inativo.saida.includes('motivo tipado: pack.inativo-no-estagio'));

  const ensaio = ork(p.dir, ['audit', 'run', 'clean-code', '--dry-run', '--agora', 'teste', '--since', '7d']);
  assert.equal(ensaio.codigo, 0);
  assert.ok(ensaio.saida.includes('Simulacao (--dry-run)'));
  assert.ok(ensaio.saida.includes('effort eco'), 'o esforco eco e a governanca de custo padrao');
  assert.ok(/claude --bg "<prompt>" --name ork-clean-code-\d{4}-\d{2}-\d{2}-\d/.test(ensaio.saida));

  const rodada = (/rodada (ork-clean-code-\d{4}-\d{2}-\d{2}-\d)/.exec(ensaio.saida) ?? [])[1];
  assert.ok(rodada, 'o CLI imprime o id da rodada');
  assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'audits', rodada, 'prompt.md')));
  assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'audits', rodada, 'FORMATO.md')));

  const lista = ork(p.dir, ['audit', 'list']);
  assert.ok(lista.saida.includes(rodada));
  assert.ok(lista.saida.includes('nao verificado'));

  assert.equal(ork(p.dir, ['audit', 'run', 'nao-existe']).codigo, 2);
  assert.equal(ork(p.dir, ['audit', 'lint']).codigo, 0);
});

test('o ciclo completo pelo CLI: achado, verify, relatorio com propostas e --from-finding', (t) => {
  const p = projetoTemporario('b5-cli-ciclo');
  t.after(p.limpar);
  fs.writeFileSync(path.join(p.dir, 'duplicado.txt'), 'mesma linha\nmesma linha\n', 'utf8');

  const ensaio = ork(p.dir, ['audit', 'run', 'reuse', '--dry-run', '--agora', 'teste']);
  const rodada = (/rodada (ork-reuse-\d{4}-\d{2}-\d{2}-\d)/.exec(ensaio.saida) ?? [])[1];
  assert.ok(rodada);

  // Achado sem proposta completa e recusado pelo CLI, com o motivo tipado.
  const semProposta = ork(p.dir, [
    'audit', 'finding', 'add', rodada,
    '--regra', 'RU4',
    '--titulo', 'regra repetida',
    '--arquivo', 'duplicado.txt:1',
    '--impacto', 'duas fontes de verdade',
  ]);
  assert.notEqual(semProposta.codigo, 0);
  assert.ok(semProposta.saida.includes('achado.sem-proposta'));

  const add = ork(p.dir, [
    'audit', 'finding', 'add', rodada,
    '--regra', 'RU4',
    '--severidade', 'maior',
    '--titulo', 'a mesma linha aparece duas vezes em duplicado.txt',
    '--arquivo', 'duplicado.txt:2',
    '--alegacao', 'duplicado.txt repete a mesma linha',
    '--verificar', 'test "$(grep -c \'mesma linha\' duplicado.txt)" -eq 2',
    '--impacto', 'a correcao precisa ser feita nos dois lugares',
    '--fix', 'manter uma linha so',
    '--irreversivel', 'nenhum',
    '--estimativa', '30min',
  ]);
  assert.equal(add.codigo, 0);
  assert.ok(add.saida.includes('Achado F1 registrado'));

  // Antes do verify, o achado NAO vira thread.
  const cedo = ork(p.dir, ['thread', 'new', '--from-finding', 'F1']);
  assert.equal(cedo.codigo, 1);
  assert.ok(cedo.saida.includes('motivo tipado: claims.failed'));
  assert.ok(cedo.saida.includes('ork audit verify'));

  const verify = ork(p.dir, ['audit', 'verify', rodada]);
  assert.equal(verify.codigo, 0);
  assert.ok(verify.saida.includes('ACHADOS SUSTENTADOS'));

  const report = ork(p.dir, ['audit', 'report', rodada]);
  assert.equal(report.codigo, 0);
  assert.ok(report.saida.includes('## PROPOSTAS DE AJUSTE PARA O ROADMAP DE ORKASTERY'));
  for (const campo of ['duplicado.txt:2', 'a correcao precisa ser feita', 'manter uma linha so', 'nenhum', '30min']) {
    assert.ok(report.saida.includes(campo), `o bloco de propostas nao traz "${campo}"`);
  }
  assert.ok(report.saida.includes('ork thread new'), 'o relatorio ja entrega o comando do --from-finding');

  const nova = ork(p.dir, ['thread', 'new', 'tirar duplicacao', '--from-finding', 'F1', '--modo', 'classic']);
  assert.equal(nova.codigo, 0);
  assert.ok(nova.saida.includes('Thread criada a partir do achado F1'));
  assert.ok(nova.saida.includes('Pedido de GOAL ja montado a partir do achado'));
  assert.ok(nova.saida.includes('pedido-goal.md'), 'o CLI entrega o proximo comando pronto');
  assert.ok(nova.saida.includes('duplicado.txt:2'), 'a evidencia viaja para o pedido de GOAL');

  const idThread = (/id\s+(\S+)/.exec(nova.saida) ?? [])[1];
  assert.ok(idThread);
  const claims = ork(p.dir, ['claims', 'list', idThread]);
  assert.ok(claims.saida.includes('duplicado.txt repete a mesma linha'));

  // O mesmo achado nao abre uma segunda thread.
  const denovo = ork(p.dir, ['thread', 'new', '--from-finding', 'F1']);
  assert.equal(denovo.codigo, 1);
  assert.ok(denovo.saida.includes('achado.ja-virou-thread'));

  const divida = ork(p.dir, ['audit', 'divida']);
  assert.equal(divida.codigo, 0);
  assert.ok(divida.saida.includes('F1'));
  assert.ok(divida.saida.includes('virou-thread'));
  assert.ok(divida.saida.includes('Recorrencia (2 propoem controle, 3 propoem bloqueante;'));
});

test('ork audit ingest le o achados.json que o auditor escreve e recusa o incompleto', (t) => {
  const p = projetoTemporario('b5-cli-ingest');
  t.after(p.limpar);

  const ensaio = ork(p.dir, ['audit', 'run', 'clean-code', '--dry-run', '--agora', 'teste']);
  const rodada = (/rodada (ork-clean-code-\d{4}-\d{2}-\d{2}-\d)/.exec(ensaio.saida) ?? [])[1];
  const arquivo = path.join(p.dir, '.orkastery', 'audits', rodada, 'achados.json');
  fs.writeFileSync(
    arquivo,
    JSON.stringify({
      achados: [
        {
          regra: 'CC1',
          severidade: 'menor',
          titulo: 'README curto demais para o que promete',
          arquivo: 'README.md:1',
          alegacao: 'README.md existe no repositorio',
          verificar: ['test -f README.md'],
          impacto: 'o leitor nao sabe o que o projeto faz',
          fix: 'escrever o paragrafo de proposito',
          irreversivel: 'nenhum',
          estimativa: '1h',
        },
        { regra: 'CC1', titulo: 'sem proposta', arquivo: 'README.md:2' },
      ],
    }),
    'utf8'
  );

  const r = ork(p.dir, ['audit', 'ingest', rodada, '--arquivo', arquivo]);
  assert.equal(r.codigo, 1, 'a ingestao com recusa sai != 0 para o orquestrador ver');
  assert.ok(r.saida.includes('1 achado(s) no board de divida'));
  assert.ok(r.saida.includes('RECUSADOS (1)'));
  assert.ok(r.saida.includes('achado #2'), 'o CLI diz QUAL achado foi recusado');

  assert.equal(ork(p.dir, ['audit', 'verify', rodada]).codigo, 0);
  const show = ork(p.dir, ['audit', 'show', rodada]);
  assert.ok(show.saida.includes('Claims do auditor: SUSTENTADAS'));

  const ledger = ork(p.dir, ['audit', 'show', rodada, '--ledger']);
  for (const evento of ['finding_added', 'proposal_recorded', 'audit_verified']) {
    assert.ok(ledger.saida.includes(evento), `o ledger da rodada nao tem ${evento}`);
  }
});

test('ork audit surface varre a superficie de rede pelo binario e sai != 0 quando acha', (t) => {
  const p = projetoTemporario('b5-cli-surface');
  t.after(p.limpar);
  fs.mkdirSync(path.join(p.dir, 'servidor'), { recursive: true });
  fs.writeFileSync(
    path.join(p.dir, 'servidor', 'api.js'),
    [
      "const express = require('express');",
      "const cors = require('cors');",
      'const app = express();',
      '',
      "app.use(cors({ origin: '*', credentials: true }));",
      '',
      "app.get('/admin/usuarios', (req, res) => res.json(listar()));",
      '',
      "app.post('/login', (req, res) => res.json(entrar(req.body)));",
      '',
      'app.listen(3000);',
      '',
    ].join('\n'),
    'utf8'
  );

  const limpo = ork(p.dir, ['audit', 'surface', 'core']);
  assert.equal(limpo.codigo, 0, 'sem rota no escopo o comando sai 0');
  assert.ok(limpo.saida.includes('NAO e o mesmo que superficie limpa'));

  const varredura = ork(p.dir, ['audit', 'surface']);
  assert.equal(varredura.codigo, 1, 'com achado o comando sai != 0 para o agendador do host');
  for (const esperado of ['SP9', 'SP10', 'SP11', 'servidor/api.js:7', 'CONFIANCA', 'express']) {
    assert.ok(varredura.saida.includes(esperado), `a varredura nao mostra "${esperado}"`);
  }

  const so = ork(p.dir, ['audit', 'surface', '--regra', 'sp11']);
  assert.equal(so.codigo, 1);
  assert.ok(!so.saida.includes('SP10'), 'o filtro por regra corta as outras regras');

  const json = ork(p.dir, ['audit', 'surface', '--json']);
  const dados = JSON.parse(json.saida) as { achados: { regra: string; verificar: string[] }[] };
  assert.ok(dados.achados.length > 0);
  assert.ok(dados.achados.every((a) => a.verificar.length >= 2), 'todo achado declara como se reexecuta');

  assert.equal(ork(p.dir, ['audit', 'surface', '--regra', 'SP99']).codigo, 2);
  assert.equal(ork(p.dir, ['audit', 'surface', '--limite', 'zero']).codigo, 2);
});

test('a rodada periodica de security-privacy varre a superficie e a leva ao board', (t) => {
  const p = projetoTemporario('b5-cli-surface-rodada');
  t.after(p.limpar);
  fs.writeFileSync(
    path.join(p.dir, 'api.js'),
    [
      "const express = require('express');",
      'const app = express();',
      '',
      "app.get('/debug/console', (req, res) => res.json(estado()));",
      '',
      'app.listen(3000);',
      '',
    ].join('\n'),
    'utf8'
  );

  // O pack security-privacy so entra no estagio maduro: `--forcar` assume o custo, como no
  // resto do B5. `--tudo` porque o arquivo novo ainda nao esta no git log da janela.
  const ensaio = ork(p.dir, [
    'audit', 'run', 'security-privacy', '--dry-run', '--agora', 'teste', '--forcar', '--tudo',
  ]);
  assert.equal(ensaio.codigo, 0);
  const rodada = (/rodada (ork-security-privacy-\d{4}-\d{2}-\d{2}-\d)/.exec(ensaio.saida) ?? [])[1];
  assert.ok(rodada, 'o CLI imprime o id da rodada de security-privacy');
  assert.ok(ensaio.saida.includes('superficie'), 'o ensaio ja diz o que a varredura encontrou');
  assert.ok(ensaio.saida.includes('nada registrado no board (--dry-run)'));
  assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'audits', rodada, 'superficie.json')));
  assert.ok(ork(p.dir, ['audit', 'divida']).saida.includes('Board de divida vazio'));

  const formato = fs.readFileSync(path.join(p.dir, '.orkastery', 'audits', rodada, 'FORMATO.md'), 'utf8');
  assert.ok(formato.includes('SP8..SP12'), 'o FORMATO.md avisa o auditor do que ja foi varrido');
  assert.ok(formato.includes('SP9 em api.js:4'));

  const registro = ork(p.dir, ['audit', 'surface', '--registrar', rodada]);
  assert.equal(registro.codigo, 1, 'registrar achado sai != 0: ha divida nova no board');
  assert.ok(registro.saida.includes('achado(s) registrado(s) no board de divida'));
  assert.ok(registro.saida.includes('F1'));

  const divida = ork(p.dir, ['audit', 'divida', '--pack', 'security-privacy']);
  assert.ok(divida.saida.includes('SP9'));
  assert.ok(divida.saida.includes('api.js:4'));

  const verify = ork(p.dir, ['audit', 'verify', rodada]);
  assert.equal(verify.codigo, 0, 'a claim da varredura se sustenta no HEAD real');
  assert.ok(verify.saida.includes('ACHADOS SUSTENTADOS'));

  const report = ork(p.dir, ['audit', 'report', rodada]);
  assert.equal(report.codigo, 0);
  assert.ok(report.saida.includes('## PROPOSTAS DE AJUSTE PARA O ROADMAP DE ORKASTERY'));
  assert.ok(report.saida.includes('varredura deterministica de superficie de rede'));
  assert.ok(report.saida.includes('restringir por rede'), 'o fix proposto viaja para o relatorio');

  const thread = ork(p.dir, ['thread', 'new', 'fechar o console de debug', '--from-finding', 'F1']);
  assert.equal(thread.codigo, 0);
  assert.ok(thread.saida.includes('api.js:4'), 'a evidencia da varredura vira pedido de GOAL');

  const ledger = ork(p.dir, ['audit', 'show', rodada, '--ledger']);
  assert.ok(ledger.saida.includes('attack_surface_scanned'), 'a varredura fica no ledger da rodada');
});
