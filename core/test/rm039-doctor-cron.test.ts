/**
 * RM-039 (B6): com `.orkastery/monitor/pulse-host.json`, o `ork doctor` le o crontab (leitor
 * injetado aqui) e avisa, sem bloquear, a varredura ausente ou mais lenta que 15 minutos, com a
 * linha do template `monitor/pulse.cron`. Sem o pulse-host.json, o doctor nao fala de cron.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { checar } from '../src/doctor';
import { BATIDA_DO_TEMPLATE, checarCronDoPulse, COMANDO_DO_TEMPLATE, intervaloEmMinutos, LeituraDoCrontab }
  from '../src/doctor-pulse-cron';

const NOME = 'cadencia do pulse no cron';

function comMonitor(): { dir: string; monitor: string; limpar: () => void } {
  const p = projetoTemporario('rm039-doctor-cron');
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  fs.mkdirSync(monitor, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'pulse-host.json'),
    JSON.stringify({ executavel: '/bin/true', argumentos: ['{{mensagem}}'] }));
  return { dir: p.dir, monitor, limpar: p.limpar };
}

const crontab = (texto: string) => (): LeituraDoCrontab => ({ ok: true, texto });

test('RM-039: sem pulse-host.json o doctor nao le o crontab nem fala de cron', () => {
  const p = projetoTemporario('rm039-sem-host');
  try {
    let leu = 0;
    const ler = () => { leu++; return { ok: true as const, texto: '0 * * * * /x/monitor/varredura-pulse.sh\n' }; };
    assert.equal(checarCronDoPulse(path.join(p.dir, '.orkastery', 'monitor'), p.dir, ler), null);
    const checks = checar(p.dir, [], ler);
    assert.equal(checks.find(c => c.nome === NOME), undefined);
    assert.equal(leu, 0);
  } finally { p.limpar(); }
});

test('RM-039: linha */15 da varredura fica ok', () => {
  const m = comMonitor();
  try {
    const c = checarCronDoPulse(m.monitor, m.dir,
      crontab('PATH=/usr/bin:/bin\n# comentario varredura-pulse.sh\n*/15 * * * * /srv/ork/monitor/varredura-pulse.sh\n'));
    assert.equal(c?.nivel, 'ok');
  } finally { m.limpar(); }
});

test('RM-039: linha 0 * * * * vira aviso com a linha nova do template, mantendo o comando instalado', () => {
  const m = comMonitor();
  try {
    const c = checarCronDoPulse(m.monitor, m.dir, crontab('0 * * * * /srv/ork/monitor/varredura-pulse.sh >> /tmp/p.log 2>&1\n'));
    assert.equal(c?.nivel, 'warn');
    assert.match(c!.detalhe, /de hora em hora/);
    assert.equal(c!.correcao, 'troque a linha no crontab (crontab -e) por: */15 * * * * /srv/ork/monitor/varredura-pulse.sh >> /tmp/p.log 2>&1');
  } finally { m.limpar(); }
});

test('RM-039: crontab sem a linha da varredura vira aviso com a linha do template no checkout', () => {
  const m = comMonitor();
  try {
    const c = checarCronDoPulse(m.monitor, m.dir, crontab('*/5 * * * * /usr/bin/outra-coisa\n'));
    assert.equal(c?.nivel, 'warn');
    assert.match(c!.detalhe, /nenhuma linha do crontab roda varredura-pulse\.sh/);
    assert.ok(c!.correcao!.endsWith(`*/15 * * * * ${path.join(m.dir, 'monitor', 'varredura-pulse.sh')}`));
  } finally { m.limpar(); }
});

test('RM-039: crontab inexistente vira aviso, sem erro, e o doctor segue sem bloquear por ele', () => {
  const m = comMonitor();
  try {
    const ler = (): LeituraDoCrontab => ({ ok: false, motivo: 'crontab -l falhou: no crontab for julio' });
    const c = checarCronDoPulse(m.monitor, m.dir, ler);
    assert.equal(c?.nivel, 'warn');
    assert.match(c!.detalhe, /no crontab for julio/);
    const doDoctor = checar(m.dir, [], ler).find(x => x.nome === NOME);
    assert.equal(doDoctor?.nivel, 'warn');
  } finally { m.limpar(); }
});

test('RM-039: intervalos das formas comuns do cron', () => {
  assert.equal(intervaloEmMinutos('*/15 * * * *'), 15);
  assert.equal(intervaloEmMinutos('*/5 * * * *'), 5);
  assert.equal(intervaloEmMinutos('* * * * *'), 1);
  assert.equal(intervaloEmMinutos('0,15,30,45 * * * *'), 15);
  assert.equal(intervaloEmMinutos('0 * * * *'), 60);
  assert.equal(intervaloEmMinutos('*/30 * * * *'), 30);
  assert.equal(intervaloEmMinutos('@hourly'), 60);
  assert.equal(intervaloEmMinutos('*/15 8-20 * * *'), 60);
  assert.equal(intervaloEmMinutos('lixo'), null);
});

test('RM-039: a batida e o comando do doctor sao os do template monitor/pulse.cron', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'monitor', 'pulse.cron'), 'utf8');
  const ativas = template.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.includes('='));
  assert.deepEqual(ativas, [`${BATIDA_DO_TEMPLATE} ${COMANDO_DO_TEMPLATE}`]);
});
