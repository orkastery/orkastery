/**
 * RM-062 (F1): a batida instalada e vigiada pelo proprio `ork`.
 *
 * O incidente do srvjcp86 (03/10 a 12/10/2026, P1 e P7): sem `pulse-host.json` o `ork doctor` nao lia o
 * crontab e calava; a maquina ficou nove dias sem varredura. Prova, com crontab FALSO (executor injetado,
 * ou um binario `crontab` falso no PATH, conferido antes de cada uso): `ork fabrica batida instalar` poe a
 * linha do template de forma idempotente, preserva as outras entradas e grava `batida_instalada` no ledger
 * da maquina; `remover` tira so a linha dela; `status` diz a linha e a ultima rodada do `hitl.log`; e o
 * doctor reprova com thread aberta e sem batida, mesmo sem `pulse-host.json`. O crontab real nunca e tocado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { checar, doctor } from '../src/doctor';
import { checarCronDoPulse, LeituraDoCrontab } from '../src/doctor-pulse-cron';
import {
  ExecutorDoCrontab, estadoDaBatida, instalarBatida, linhaDaBatida, MARCA_DA_BATIDA, removerBatida, textoDoEstadoDaBatida,
} from '../src/fabrica-batida';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import { gravarThread, lerThread, novaThread } from '../src/thread';
import { main } from '../src/index';
import { noPath } from '../src/util';

const NOME = 'cadencia do pulse no cron';
const OUTRAS = 'MAILTO=""\n# backup da noite\n0 3 * * * /usr/local/bin/backup --tudo\n';

/** Crontab em memoria: o texto, quantas gravacoes houve, e uma leitura que pode falhar. */
function crontabFalso(inicial: string | null): ExecutorDoCrontab & { texto: () => string | null; gravacoes: () => number } {
  let texto = inicial, gravacoes = 0;
  return {
    ler: (): LeituraDoCrontab => texto === null ? { ok: false, motivo: 'crontab -l falhou: sem permissao (simulado)' } : { ok: true, texto },
    gravar: (novo: string) => { gravacoes++; texto = novo; return { ok: true }; },
    texto: () => texto,
    gravacoes: () => gravacoes,
  };
}

/** O ledger da maquina deste processo de teste (`ORK_USUARIO_DIR`, isolado pelo apoio). */
function ledgerDaMaquina() {
  return lerLedger(process.env.ORK_USUARIO_DIR as string);
}

/** Projeto temporario com o script da varredura no proprio checkout, como o do Orkastery. */
function projetoComVarredura(nome: string) {
  const p = projetoTemporario(nome);
  fs.mkdirSync(path.join(p.dir, 'monitor'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, 'monitor', 'varredura-pulse.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return p;
}

test('F1: instalar poe a linha do template no crontab falso, preserva as outras entradas e grava batida_instalada', () => {
  const p = projetoComVarredura('rm062-batida-instalar');
  try {
    const cron = crontabFalso(OUTRAS);
    const antes = ledgerDaMaquina().length;
    const r = instalarBatida(p.dir, { executor: cron, por: 'teste' });
    assert.equal(r.acao, 'instalou');
    const linha = r.linha as string;
    assert.ok(linha.startsWith('*/15 * * * * '), 'a batida do template, de 15 em 15 minutos');
    assert.ok(linha.includes(`ORK_PULSE_PROJECT=${p.dir}`), linha);
    assert.ok(linha.includes(`${path.join(p.dir, 'monitor', 'varredura-pulse.sh')} ${MARCA_DA_BATIDA}`), linha);
    // O PATH acha o node que roda este ork (o cron nao carrega o perfil do shell).
    assert.ok(linha.includes(path.dirname(process.execPath)), linha);
    assert.equal(cron.texto(), `${OUTRAS}${linha}\n`, 'as outras entradas ficam como estavam, na mesma ordem');

    const eventos = ledgerDaMaquina().slice(antes);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].tipo, TIPOS_DE_EVENTO.batidaInstalada);
    assert.equal(eventos[0].thread, 'maquina');
    assert.equal(eventos[0].projeto, p.dir);
    assert.equal(eventos[0].linha, linha);
    assert.equal(eventos[0].por, 'teste');
    assert.equal(r.eventId, eventos[0].eventId);
  } finally { p.limpar(); }
});

test('F1: instalar de novo e idempotente: nada e gravado e nenhum evento novo', () => {
  const p = projetoComVarredura('rm062-batida-idempotente');
  try {
    const cron = crontabFalso('');
    instalarBatida(p.dir, { executor: cron });
    const texto = cron.texto(), gravacoes = cron.gravacoes(), eventos = ledgerDaMaquina().length;
    const r = instalarBatida(p.dir, { executor: cron });
    assert.equal(r.acao, 'ja-instalada');
    assert.equal(cron.texto(), texto);
    assert.equal(cron.gravacoes(), gravacoes, 'a segunda vez nao grava o crontab');
    assert.equal(ledgerDaMaquina().length, eventos, 'nem registra evento');
  } finally { p.limpar(); }
});

test('F1: instalar troca a linha posta a mao deste projeto e nao toca a varredura de outro projeto', () => {
  const p = projetoComVarredura('rm062-batida-manual');
  try {
    const manual = `0 * * * * ${path.join(p.dir, 'monitor', 'varredura-pulse.sh')} >> /tmp/pulse.log 2>&1`;
    const outro = '*/15 * * * * ORK_PULSE_PROJECT=/srv/outro-projeto /opt/ork/monitor/varredura-pulse.sh';
    const cron = crontabFalso(`${OUTRAS}${manual}\n${outro}\n`);
    const r = instalarBatida(p.dir, { executor: cron });
    assert.equal(r.acao, 'instalou');
    assert.deepEqual(r.retiradas, [manual]);
    assert.equal(cron.texto(), `${OUTRAS}${outro}\n${r.linha}\n`);
    assert.deepEqual(ledgerDaMaquina().at(-1)?.retiradas, [manual], 'o evento diz a linha que saiu');
  } finally { p.limpar(); }
});

test('F1: remover tira so a linha dela, grava batida_removida e diz a linha posta a mao que ficou', () => {
  const p = projetoComVarredura('rm062-batida-remover');
  try {
    const cron = crontabFalso(OUTRAS);
    const { linha } = instalarBatida(p.dir, { executor: cron });
    const manual = `*/5 * * * * ORK_PULSE_PROJECT=${p.dir} /opt/ork/monitor/varredura-pulse.sh`;
    cron.gravar(`${cron.texto()}${manual}\n`);
    const r = removerBatida(p.dir, { executor: cron, por: 'teste' });
    assert.equal(r.acao, 'removeu');
    assert.deepEqual(r.retiradas, [linha]);
    assert.deepEqual(r.manuais, [manual]);
    assert.equal(cron.texto(), `${OUTRAS}${manual}\n`);
    const e = ledgerDaMaquina().at(-1)!;
    assert.equal(e.tipo, TIPOS_DE_EVENTO.batidaRemovida);
    assert.deepEqual(e.retiradas, [linha]);
    // Sem a linha do ork, remover de novo nao grava nada.
    const gravacoes = cron.gravacoes();
    assert.equal(removerBatida(p.dir, { executor: cron }).acao, 'nao-instalada');
    assert.equal(cron.gravacoes(), gravacoes);
  } finally { p.limpar(); }
});

test('F1: crontab que nao se le nao e gravado: instalar recusa com o motivo, e nada muda', () => {
  const p = projetoComVarredura('rm062-batida-sem-leitura');
  try {
    const cron = crontabFalso(null);
    assert.throws(() => instalarBatida(p.dir, { executor: cron }), /fabrica\.batida\.sem-leitura: crontab -l falhou: sem permissao/);
    assert.throws(() => removerBatida(p.dir, { executor: cron }), /fabrica\.batida\.sem-leitura/);
    assert.equal(cron.gravacoes(), 0);
  } finally { p.limpar(); }
});

test('F1: status diz a linha, a ultima rodada do hitl.log e ha quanto tempo; atrasada quando passou de 30 min', () => {
  const p = projetoComVarredura('rm062-batida-status');
  try {
    const cron = crontabFalso('');
    const sem = estadoDaBatida(p.dir, { executor: cron, quando: '2026-10-12T15:00:00.000Z' });
    assert.equal(sem.instalada, false);
    assert.equal(sem.ultimaRodada, null);
    assert.match(textoDoEstadoDaBatida(sem), /instalada: não; instale com: ork fabrica batida instalar/);

    const { linha } = instalarBatida(p.dir, { executor: cron });
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'hitl.log'), [
      JSON.stringify({ ts: '2026-10-12T14:30:00.000Z', tipo: 'pulse_scan', code: 0, novas: 0, enviadas: 0, detalhe: 'sem novidade' }),
      JSON.stringify({ ts: '2026-10-12T14:45:00.000Z', tipo: 'pulse_scan', code: 1, novas: 0, enviadas: 0, detalhe: 'transporte ausente' }),
      '',
    ].join('\n'));
    const e = estadoDaBatida(p.dir, { executor: cron, quando: '2026-10-12T15:00:00.000Z' });
    assert.equal(e.instalada, true);
    assert.equal(e.gerenciada, linha);
    assert.equal(e.intervaloMin, 15);
    assert.deepEqual(e.ultimaRodada, { em: '2026-10-12T14:45:00.000Z', code: 1, detalhe: 'transporte ausente', haMin: 15 });
    const texto = textoDoEstadoDaBatida(e, '2026-10-12T15:00:00.000Z');
    assert.match(texto, /instalada: sim, a cada 15 min, pelo ork fabrica batida instalar/);
    assert.match(texto, /última rodada: .* \(há 15 min\), código 1: transporte ausente/);
    assert.doesNotMatch(texto, /atrasada/);
    const tarde = estadoDaBatida(p.dir, { executor: cron, quando: '2026-10-12T16:00:00.000Z' });
    assert.match(textoDoEstadoDaBatida(tarde, '2026-10-12T16:00:00.000Z'), /atrasada: nenhuma rodada há 75 min/);
  } finally { p.limpar(); }
});

test('F1: caminho que nao cabe numa linha do cron e recusado antes de ler o crontab', () => {
  assert.throws(() => linhaDaBatida('/srv/projeto%novo', { scriptDoOrk: '/opt/ork/monitor/varredura-pulse.sh' }),
    /fabrica\.batida\.caminho-invalido/);
});

test('F1: com thread aberta e sem batida, o doctor REPROVA mesmo sem pulse-host.json; a correcao e o ork fabrica batida instalar', () => {
  const p = projetoComVarredura('rm062-doctor-sem-batida');
  try {
    novaThread(p.carregado, { nome: 'aberta', modo: 'auto' });
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    assert.equal(fs.existsSync(path.join(monitor, 'pulse-host.json')), false, 'sem transporte, como no srvjcp86');
    const semLinha = (): LeituraDoCrontab => ({ ok: true, texto: OUTRAS });
    const c = checar(p.dir, [], semLinha).find((x) => x.nome === NOME);
    assert.equal(c?.nivel, 'fail', JSON.stringify(c));
    assert.match(c!.detalhe, /^1 thread\(s\) aberta\(s\) e nenhuma batida da varredura: nenhuma linha do crontab roda varredura-pulse\.sh/);
    assert.match(c!.correcao!, /^ork fabrica batida instalar /);
    // Sem crontab legivel tambem reprova: nao ha prova de batida.
    const semLeitura = (): LeituraDoCrontab => ({ ok: false, motivo: 'comando crontab ausente nesta maquina' });
    assert.equal(checarCronDoPulse(monitor, p.dir, semLeitura)?.nivel, 'fail');
    // A linha de OUTRO projeto nao e a batida deste.
    const deOutro = (): LeituraDoCrontab => ({ ok: true, texto: '*/15 * * * * ORK_PULSE_PROJECT=/srv/outro /opt/ork/monitor/varredura-pulse.sh\n' });
    assert.equal(checarCronDoPulse(monitor, p.dir, deOutro)?.nivel, 'fail');
    // Com a linha deste projeto, o check volta a ok.
    const comLinha = (): LeituraDoCrontab => ({ ok: true, texto: `${OUTRAS}${linhaDaBatida(p.dir)}\n` });
    assert.equal(checarCronDoPulse(monitor, p.dir, comLinha)?.nivel, 'ok');
  } finally { p.limpar(); }
});

test('F1: thread fechada nao e thread a vigiar: sem aberta e sem pulse-host.json, o doctor continua calado', () => {
  const p = projetoTemporario('rm062-doctor-fechada');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fechada', modo: 'auto' });
    const t = lerThread(p.dir, thread.id); t.status = 'fechada'; gravarThread(p.dir, t);
    let leu = 0;
    const ler = (): LeituraDoCrontab => { leu++; return { ok: true, texto: '' }; };
    assert.equal(checar(p.dir, [], ler).find((x) => x.nome === NOME), undefined);
    assert.equal(leu, 0);
  } finally { p.limpar(); }
});

/**
 * Um `crontab` falso no PATH deste processo: `-l` le o arquivo (ou diz "no crontab for", como o cronie),
 * `-` grava o stdin nele. O CLI e o `ork doctor` rodam o caminho real do sistema contra ele.
 */
function crontabNoPath(nome: string) {
  const dir = dirTemporario(`crontab-${nome}`);
  const arquivo = path.join(dir, 'crontab.txt');
  fs.writeFileSync(path.join(dir, 'crontab'), [
    '#!/bin/sh',
    `ARQ='${arquivo}'`,
    'if [ "$1" = "-l" ]; then',
    '  if [ -f "$ARQ" ]; then cat "$ARQ"; exit 0; fi',
    '  echo "no crontab for teste" >&2; exit 1',
    'fi',
    'if [ "$1" = "-" ]; then cat > "$ARQ"; exit 0; fi',
    'exit 2', ''].join('\n'), { mode: 0o755 });
  const anterior = process.env.PATH ?? '';
  process.env.PATH = `${dir}${path.delimiter}${anterior}`;
  // A garantia de que o crontab da maquina nunca e tocado: o binario achado e o falso.
  assert.equal(noPath('crontab'), path.join(dir, 'crontab'));
  return {
    texto: () => (fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null),
    restaurar: () => { process.env.PATH = anterior; fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('F1: CLI: sem crontab, status sai 1; instalar grava pelo crontab do sistema (falso), status sai 0, remover tira', () => {
  const p = projetoComVarredura('rm062-batida-cli');
  const cron = crontabNoPath('cli');
  const cwd = process.cwd(), log = console.log;
  let saida = '';
  try {
    process.chdir(p.dir);
    console.log = (s: unknown) => { saida += `${String(s)}\n`; };
    assert.equal(main(['fabrica', 'batida', 'status']), 1);
    assert.match(saida, /instalada: não; instale com: ork fabrica batida instalar/);
    saida = '';
    assert.equal(main(['fabrica', 'batida', 'instalar', '--por', 'teste', '--json']), 0);
    const r = JSON.parse(saida);
    assert.equal(r.acao, 'instalou');
    assert.equal(cron.texto(), `${r.linha}\n`, 'a maquina sem crontab ganha um com a linha');
    saida = '';
    assert.equal(main(['fabrica', 'batida', 'status']), 0);
    assert.match(saida, /instalada: sim, a cada 15 min/);
    saida = '';
    assert.equal(main(['fabrica', 'batida', 'remover']), 0);
    assert.match(saida, /Batida removida de /);
    assert.equal(cron.texto(), '');
  } finally { console.log = log; process.chdir(cwd); cron.restaurar(); p.limpar(); }
});

test('F1: o ork doctor sai != 0 com thread aberta e o crontab (falso) sem a batida, e volta a passar no check com ela', () => {
  const p = projetoComVarredura('rm062-doctor-saida');
  const cron = crontabNoPath('doctor');
  try {
    novaThread(p.carregado, { nome: 'aberta', modo: 'auto' });
    const sem = doctor(p.dir, []);
    assert.notEqual(sem.codigo, 0);
    assert.match(sem.texto, /\[FAIL\] cadencia do pulse no cron +1 thread\(s\) aberta\(s\) e nenhuma batida da varredura/);
    assert.match(sem.texto, /correcao: ork fabrica batida instalar/);
    instalarBatida(p.dir);
    const com = checar(p.dir, []).find((x) => x.nome === NOME);
    assert.equal(com?.nivel, 'ok', JSON.stringify(com));
  } finally { cron.restaurar(); p.limpar(); }
});
