/**
 * I-35 (GO-FIX 1, P1-1 do CHECK c655cb5e): entrada de processo que não passa pelo `main` do
 * CLI também fala no fuso do dono. O cron do pulse chama `dist/pulse-delivery.js` direto; aqui
 * roda a ENTRADA REAL com `TZ=UTC` no processo, `owner.timezone` em Brasília no manifesto,
 * `claude` falso no PATH e transporte falso que só grava em arquivo (nunca o host real).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { PedidoHitl } from '../src/hitl-contract';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const REPO = path.resolve(__dirname, '..', '..', '..');
const ENTRADA_DO_CRON = path.join(__dirname, '..', '..', 'dist', 'pulse-delivery.js');

function ambiente(tz: string, bin: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz, PATH: `${bin}:${process.env.PATH ?? ''}` };
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_') || nome === 'ORK_PULSE_WRITE_SCOPE') delete env[nome];
  return env;
}

test('entrada do cron (dist/pulse-delivery.js) com TZ=UTC entrega no fuso do dono do manifesto', () => {
  const p = projetoTemporario('horario-entrada-pulse');
  try {
    ajustarManifesto(p, 'owner:\n', `owner:\n  timezone: "${SP}"\n`);
    // Thread com pedido HITL aberto (prazo em 1 h) e escalada human.pending que o monitor vê.
    const t = novaThread(p.carregado, { nome: 'decisao', modo: 'classic' }).thread;
    const agora = Date.now();
    const q: PedidoHitl = { contrato: 'ork.hitl/v1', id: 'q-entrada', thread: t.id, fase: t.faseAtual, modo: t.modo,
      alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending', pergunta: 'Aprovar esta fixture SIMULADA?',
      opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Esperar', acao: 'esperar' }],
      recomendacao: 'Somente fixture sintética', criadoEm: new Date(agora).toISOString(),
      prazo: new Date(agora + 3600000).toISOString(), acaoPadraoAoExpirar: 'esperar',
      respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
    registrarPedidoHitl(p.dir, q);
    registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { fase: t.faseAtual, gate: 'human', motivo: 'human.pending', detalhe: 'espera o dono' });
    // Outra thread sem pedido: a pergunta traz um ISO (20/09 02:30 UTC = 19/09 23:30 em Brasília).
    const t2 = novaThread(p.carregado, { nome: 'retomada', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t2.id), t2.id, 'gate_blocked', { fase: t2.faseAtual, gate: 'human', motivo: 'human.pending',
      detalhe: 'retomada SIMULADA liberada depois de 2026-09-20T02:30:00.000Z' });

    const bin = path.join(p.dir, 'bin-falso');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = agents ]; then echo "[]"; exit 0; fi\nexit 1\n', { mode: 0o755 });
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ executavel: process.execPath,
      argumentos: ['-e', 'require("fs").appendFileSync(process.argv[2], process.argv[1] + "\\n=====\\n")', '{{mensagem}}',
        path.join(p.dir, 'mensagens-SIMULADAS.txt')] }));

    const rodar = (tz: string): string[] => {
      // As duas rodadas comparam fuso, nao historico: cada uma parte do mesmo estado. Desde a
      // I-41 o pulse guarda o lote servido e o consentimento entre rodadas (e isso e produto:
      // a segunda rodada diz que a pergunta "continua guardada"), entao os tres estados saem.
      for (const estado of ['pulse-avisado.json', 'pulse-lote.json', 'pulse-consentimento.json']) {
        fs.rmSync(path.join(monitor, estado), { force: true });
      }
      fs.rmSync(path.join(p.dir, 'mensagens-SIMULADAS.txt'), { force: true });
      const r = spawnSync(process.execPath, [ENTRADA_DO_CRON, p.dir], { cwd: p.dir, encoding: 'utf8', env: ambiente(tz, bin), timeout: 240000 });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // I-41: dois itens pendentes entregam UMA mensagem. Até 20/09 esta linha dizia 2, e era
      // isso que, com 75 itens, virava 75 mensagens no Telegram do dono em minutos.
      assert.equal(JSON.parse(r.stdout).enviadas, 1, r.stdout);
      return fs.readFileSync(path.join(p.dir, 'mensagens-SIMULADAS.txt'), 'utf8').split('\n=====\n').filter(Boolean).sort();
    };

    const utc = rodar('UTC');
    assert.equal(utc.length, 1, utc.join('\n'));
    const [resumo] = utc;
    // A entrada do cron não passa pelo `main` do CLI e mesmo assim fala no fuso do dono: o
    // cabeçalho do resumo sai em Brasília com TZ=UTC no processo.
    assert.match(resumo, /^🔔 Orkastery, resumo de \d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2} \(horário de Brasília\)$/m);
    assert.match(resumo, /Travando o avanço: 2, em 2 threads/);
    assert.doesNotMatch(resumo, /UTC/, resumo);
    assert.doesNotMatch(resumo, ISO, resumo);
    assert.equal((resumo.match(/horário de Brasília|Horários de Brasília/g) ?? []).length, 1, resumo);
    // O prazo do pedido e o ISO dentro de texto livre continuam localizados na mensagem de UM
    // item, composta por `mensagemPulse`; desde a I-41 o resumo não repete item por item, e essa
    // cobertura vive em `horario-hitl.test.ts` ("mensagem do pulse ao Telegram").
    // O fuso do processo não muda nada: mesma entrega com TZ=America/Sao_Paulo.
    //
    // O relógio do cabeçalho é normalizado antes de comparar, e só ele. As duas rodadas são
    // processos separados e podem cair em minutos diferentes; o que este trecho prova é que o
    // fuso do PROCESSO não muda a entrega, não que as duas aconteceram no mesmo minuto. O fuso
    // do cabeçalho continua conferido acima, em cima da rodada com TZ=UTC.
    // O codigo de consentimento e aleatorio por desenho (protecao contra resposta repetida):
    // duas rodadas independentes nunca repetem o codigo, entao ele e normalizado junto com o
    // relogio. O que se exige dele e coerencia DENTRO da mensagem: o mesmo nas duas alternativas.
    const CODIGO = /Responda com ([A-Z0-9]{4}) a \(sim\) ou ([A-Z0-9]{4}) b/;
    for (const m of utc) { const c = CODIGO.exec(m); if (c) assert.equal(c[1], c[2], m); }
    const semRelogio = (m: string) => m.replace(/\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2}/, '<hora>')
      .replace(CODIGO, 'Responda com <codigo> a (sim) ou <codigo> b');
    const sp = rodar(SP);
    assert.match(sp[0], /\(horário de Brasília\)/);
    assert.doesNotMatch(sp[0], /UTC/);
    assert.deepEqual(sp.map(semRelogio), utc.map(semRelogio));
  } finally { p.limpar(); }
});

/**
 * Entradas de processo (`require.main === module`) em core/src, monitor/ e scripts/: ou
 * registram a fonte do fuso do dono, ou dizem por que não mostram horário a uma pessoa.
 * Entrada nova sem declaração reprova.
 */
const REGISTRO = 'registrarFonteDoFuso(() => fusoDoManifesto(';
const ENTRADAS: { arquivo: string; registra?: 'no main' | 'na entrada'; razao?: string }[] = [
  { arquivo: 'core/src/index.ts', registra: 'no main' },
  { arquivo: 'core/src/pulse-delivery.ts', registra: 'na entrada' },
  { arquivo: 'core/src/maestro-runtime.ts', razao: '--native devolve ao Maestro o JSON das observações nativas, sem horário' },
  { arquivo: 'core/src/mcp-ship.ts', razao: '--worker devolve ao servidor MCP o resultado do ship em JSON (dado de máquina)' },
  { arquivo: 'core/src/mcp-git.ts', razao: '--worker devolve ao servidor MCP o resultado do commit em JSON (dado de máquina)' },
  { arquivo: 'core/src/mcp-experiencia.ts', razao: '--consulta-experiencia devolve ao servidor MCP painéis em JSON (dado de máquina), sem apresentar horários a pessoas' },
  { arquivo: 'core/src/mcp-grafo-worker.ts', razao: 'devolve ao servidor MCP o JSON da consulta do grafo (ork.code-graph-query/v0), que não tem horário' },
  { arquivo: 'core/src/session-watcher.ts', razao: '--run grava eventos no ledger (ISO) e não escreve texto para pessoa' },
  { arquivo: 'core/src/memory-prospective.ts', razao: '--dry-run imprime o resumo JSON do plano de memória (dado de máquina)' },
  { arquivo: 'core/src/adapters/codex-runner.ts', razao: '--run supervisiona o codex e grava recibo JSON' },
  { arquivo: 'core/src/adapters/codex-controller-worker.ts', razao: 'servidor e cliente JSON-RPC do controller do codex' },
  { arquivo: 'monitor/pulse-scope.cjs', razao: 'imprime a allowlist de threads do escopo do pulse' },
];

function entradasDoRepositorio(): string[] {
  const achadas: string[] = [];
  const andar = (dir: string, extensoes: RegExp) => {
    for (const nome of fs.readdirSync(path.join(REPO, dir)).sort()) {
      const rel = path.join(dir, nome);
      if (fs.statSync(path.join(REPO, rel)).isDirectory()) andar(rel, extensoes);
      else if (extensoes.test(nome) && !/\.test\./.test(nome) &&
        /require\.main\s*===?\s*module/.test(fs.readFileSync(path.join(REPO, rel), 'utf8'))) achadas.push(rel);
    }
  };
  andar('core/src', /\.ts$/);
  andar('monitor', /\.(?:c|m)?js$/);
  andar('scripts', /\.(?:c|m)?js$/);
  return achadas;
}

test('entradas de processo registram o fuso do dono ou dizem por que não mostram horário', () => {
  assert.deepEqual(entradasDoRepositorio(), ENTRADAS.map(e => e.arquivo).sort(), 'entrada nova precisa ser declarada aqui');
  for (const e of ENTRADAS) {
    const texto = fs.readFileSync(path.join(REPO, e.arquivo), 'utf8');
    const bloco = texto.slice(texto.search(/require\.main\s*===?\s*module/));
    if (e.registra === 'na entrada') assert.ok(bloco.includes(REGISTRO), `${e.arquivo}: a entrada não registra o fuso do dono`);
    else if (e.registra === 'no main') {
      assert.match(bloco, /main\(/, `${e.arquivo}: a entrada não chama o main`);
      assert.ok(texto.slice(texto.indexOf('export function main(')).slice(0, 300).includes(REGISTRO), `${e.arquivo}: o main não registra o fuso`);
    } else {
      assert.ok((e.razao ?? '').length > 10, `${e.arquivo}: entrada sem razão`);
      assert.ok(!bloco.includes(REGISTRO), `${e.arquivo}: registra o fuso; declare como registra`);
    }
  }
});
