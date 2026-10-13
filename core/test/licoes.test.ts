/**
 * I-55 (RM-008): o loop de aprendizado. Threads fechadas pelo MASTER sao simuladas pelos dois
 * arquivos que o MASTER grava (`POSTMORTEM.json` e `master-log.json`), num projeto temporario.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lerLedger } from '../src/ledger';
import { lerLicoes, propostasDePolicy, registrarPropostasNovas, resumoDasLicoes, textoDasLicoes } from '../src/licoes';
import { abrirMemoria } from '../src/memoria';
import { montarPromptComMemoria } from '../src/phase';
import { novaThread } from '../src/thread';
import { ClasseDeFalha } from '../src/types';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

const dias = (n: number, base = Date.parse('2026-09-27T12:00:00Z')) => new Date(base - n * 86_400_000).toISOString();
const AGORA = dias(0);

function fechada(p: ProjetoDeTeste, id: string, o: { score: number; justificativa: string; classes: ClasseDeFalha[]; motivos: string[]; em: string }): void {
  const dir = path.join(p.dir, '.orkastery', 'threads', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'POSTMORTEM.json'), JSON.stringify({ versao: 1, thread: id, classesDeFalha: o.classes,
    gatesBloqueados: o.motivos.map((m) => ({ ts: o.em, motivo: m, detalhe: 'simulado' })), geradoEm: o.em }));
  fs.writeFileSync(path.join(dir, 'master-log.json'), JSON.stringify({ thread: id, score: o.score, justificativa: o.justificativa, avaliadoEm: o.em }));
}

function fabricaComHistoria(nome: string): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  fechada(p, 'ork-a', { score: 2, justificativa: 'claim sem comando voltou duas vezes', classes: ['processo'], motivos: ['claims.failed', 'claims.failed'], em: dias(3) });
  fechada(p, 'ork-b', { score: 4, justificativa: 'ok', classes: ['sem-falha'], motivos: ['claims.failed', 'verify.regression'], em: dias(5) });
  fechada(p, 'ork-c', { score: 3, justificativa: 'baseline faltou', classes: ['processo', 'outra'], motivos: ['claims.failed'], em: dias(10) });
  fechada(p, 'ork-d', { score: 0, justificativa: 'orfa encerrada', classes: ['outra'], motivos: [], em: dias(12) });
  fechada(p, 'ork-velha', { score: 1, justificativa: 'antiga', classes: ['processo'], motivos: ['claims.failed'], em: dias(60) });
  return p;
}

test('a licao agrega por thread, sem sem-falha nem outra, e nunca ensina a thread a si mesma', () => {
  const p = fabricaComHistoria('licoes-resumo');
  try {
    assert.equal(lerLicoes(p.dir).length, 5);
    const r = resumoDasLicoes(p.dir, 'ork-a');
    assert.equal(r.threads, 4, 'a propria thread fica fora');
    assert.deepEqual(r.motivos.map((m) => [m.nome, m.threads.length]), [['claims.failed', 3], ['verify.regression', 1]]);
    assert.deepEqual(r.classes.map((c) => [c.nome, c.threads.length]), [['processo', 2]]);
    assert.deepEqual(r.recentes.map((l) => l.thread), ['ork-c', 'ork-velha'], 'nota 0 (orfa) e nota 4 nao entram');
    const texto = textoDasLicoes(r);
    assert.match(texto, /^Das 4 threads ja fechadas pelo MASTER neste produto:/);
    assert.match(texto, /o bloqueio claims\.failed apareceu em 3 threads; o que evita: rode o comando da claim/);
    assert.match(texto, /a classe de falha processo fechou 2 threads/);
    assert.match(texto, /ork-c fechou com 3\/5: baseline faltou/);
    assert.equal(textoDasLicoes(resumoDasLicoes(projetoTemporario('licoes-vazio').dir, null)), '');
  } finally { p.limpar(); }
});

test('a licao volta no GOAL e no PLAN, com a origem declarada, e fica fora das outras fases', () => {
  const p = fabricaComHistoria('licoes-prompt');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'nova', modo: 'classic' });
    const memoria = abrirMemoria(p.carregado);
    for (const fase of ['GOAL', 'PLAN'] as const) {
      const { prompt, injecao } = montarPromptComMemoria(p.carregado, thread, fase, 'pedido', memoria);
      assert.equal(injecao.licoes, 1, fase);
      assert.match(prompt, /Licoes das threads fechadas deste produto \(POSTMORTEM e MASTER\)/, fase);
      assert.match(prompt, /origem: \.orkastery\/threads\/\*\/POSTMORTEM\.json/, fase);
      assert.equal(injecao.itens.find((i) => i.colecao === 'learning')?.origem, 'postmortem');
    }
    const go = montarPromptComMemoria(p.carregado, thread, 'GO', 'pedido', memoria);
    assert.equal(go.injecao.licoes, 0);
    assert.doesNotMatch(go.prompt, /Licoes das threads fechadas/);
  } finally { p.limpar(); }
});

test('recorrencia vira PROPOSTA de policy, uma vez por janela, no ledger do projeto', () => {
  const p = fabricaComHistoria('licoes-propostas');
  try {
    // claims.failed em ork-a, ork-b e ork-c nos ultimos 30 dias; a de 60 dias atras nao conta.
    const propostas = propostasDePolicy(p.dir, AGORA);
    assert.deepEqual(propostas.map((x) => [x.chave, x.threads.length]), [['motivo:claims.failed', 3]]);
    // RM-008 (B8): claims_failed e alias de claim_sem_prova_local, e a proposta ja sai como executavel.
    assert.match(propostas[0].sugestao, /policy `claims_failed` executavel: declare `claims_failed: warn`[\s\S]*rode o comando da claim/);
    const novas = registrarPropostasNovas(p.dir, AGORA);
    assert.deepEqual(novas.map((x) => x.chave), ['motivo:claims.failed']);
    assert.deepEqual(registrarPropostasNovas(p.dir, AGORA), [], 'rodar de novo nao duplica');
    const eventos = lerLedger(path.join(p.dir, '.orkastery')).filter((e) => e.tipo === 'policy_proposta');
    assert.equal(eventos.length, 1);
    assert.deepEqual(eventos[0].threads, ['ork-a', 'ork-b', 'ork-c']);
    // O manifesto nao muda: proposta nao bloqueia nada.
    assert.equal(fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8').includes('claims_failed'), false);
  } finally { p.limpar(); }
});

test('CLI: ork licoes mostra a licao e as propostas; --json traz os dois', () => {
  const p = fabricaComHistoria('licoes-cli');
  try {
    const ork = (...a: string[]) => spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), 'licoes', ...a],
      { cwd: p.dir, encoding: 'utf8', timeout: 60000 });
    const texto = ork();
    assert.equal(texto.status, 0, texto.stderr);
    assert.match(texto.stdout, /Licoes que voltam no GOAL e no PLAN da proxima thread/);
    assert.match(texto.stdout, /Proposta nao bloqueia nada/);
    const json = JSON.parse(ork('--json').stdout);
    assert.equal(json.resumo.threads, 5);
    assert.ok(Array.isArray(json.propostas));
  } finally { p.limpar(); }
});
