/**
 * RM-063 (F6): ociosidade e alerta.
 *
 * Pedido do dono de 12/10/2026: "Você não pode deixar a máquina parada sem me avisar." No maquina-b a maquina ficou
 * dias sem sessao viva com item do roadmap reservado para ela, e nenhum canal disse nada. Agora a maquina com vaga
 * livre (abaixo de `concurrency.max_parallel_threads`) e trabalho reservado para ela no roadmap que ninguem trabalha
 * gera o alerta "maquina ociosa" ao dono pela varredura, com as proximas threads sugeridas, uma vez por episodio.
 *
 * Prova com a reserva gravada de verdade na branch `ork/roadmap-reservas` de um remoto bare local, o runtime vazio
 * (consulta injetada) e o transporte do resumo injetado. Nada toca rede, crontab ou gh.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import { maquinaOciosa } from '../src/maquina-ociosa';
import { nomeDaMaquina } from '../src/maquina';
import { montarPulse, Pulse, textoDoPulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { gravarUltimoResumo } from '../src/pulse-cadencia';
import { pegarItem } from '../src/roadmap-reservas';
import { novaThread } from '../src/thread';

const SEM_RUNTIME = { ok: true, sessoes: [], detalhe: '' };
const MIN = 60 * 1000;

function item(p: ProjetoDeTeste, id: string, titulo: string): void {
  const dir = path.join(p.dir, 'docs', 'roadmap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-simulado.md`), ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, '---', '', `# ${id}`, ''].join('\n'));
}

test('F6: 0 sessoes vivas e reserva aberta geram o alerta de maquina ociosa, com as proximas threads sugeridas', () => {
  const p = projetoTemporario('rm063-f6-ociosa', true);
  try {
    item(p, 'RM-001', 'Item sem thread simulado');
    item(p, 'RM-002', 'Item com thread simulado');
    const { thread } = novaThread(p.carregado, { nome: 'item com thread', modo: 'auto', roadmap: 'RM-002' });
    assert.equal(pegarItem(p.dir, 'RM-001', { maquina: nomeDaMaquina() }).acao, 'pegou');
    assert.equal(pegarItem(p.dir, 'RM-002', { maquina: nomeDaMaquina(), thread: thread.id }).acao, 'pegou');

    const pulse = montarPulse(p.carregado, { consulta: SEM_RUNTIME });
    const o = pulse.maquinaOciosa;
    assert.ok(o, 'a maquina sem sessao e com reserva esta ociosa');
    const limite = p.carregado.manifesto.concurrency.max_parallel_threads;
    assert.deepEqual([o!.maquina, o!.ocupadas, o!.livres, o!.limite, o!.reservados], [nomeDaMaquina(), 0, limite, limite, 2]);
    // A thread que ja existe vem antes: retomar custa menos que abrir.
    assert.deepEqual(o!.sugeridas.map((s) => [s.item, s.thread]), [['RM-002', thread.id], ['RM-001', null]]);
    assert.equal(o!.sugeridas[1].comando, 'ork thread new "Item sem thread simulado" --modo auto --roadmap RM-001');
    assert.match(o!.sugeridas[0].comando, new RegExp(`ork (phase run|retry run|thread status) ${thread.id}`));
    assert.match(textoDoPulse(pulse), /Máquina ociosa: .* com \d+ de \d+ vagas livres e 2 item\(ns\) do roadmap reservado\(s\)/);

    // Sem vaga livre, ou com a reserva de outra maquina, nao ha alerta.
    assert.equal(maquinaOciosa(p.carregado, { ocupadas: () => limite }), null);
    assert.equal(maquinaOciosa(p.carregado, { maquina: 'outra-maquina' }), null);
    // A vaga livre que sobra limita as sugeridas.
    assert.deepEqual(maquinaOciosa(p.carregado, { ocupadas: () => limite - 1 })?.sugeridas.map((s) => s.item), ['RM-002']);
  } finally { p.limpar(); }
});

test('F6: a varredura avisa a maquina ociosa na hora, uma vez por episodio, e de novo so no episodio seguinte', () => {
  const p = projetoTemporario('rm063-f6-varredura', true);
  try {
    item(p, 'RM-001', 'Item reservado simulado');
    assert.equal(pegarItem(p.dir, 'RM-001', { maquina: nomeDaMaquina() }).acao, 'pegou');
    const t0 = Date.parse('2026-10-12T12:00:00Z');
    const em = (min: number) => new Date(t0 + min * MIN).toISOString();
    const ociosa = montarPulse(p.carregado, { consulta: SEM_RUNTIME, quando: em(0) });
    assert.ok(ociosa.maquinaOciosa);
    const ocupada: Pulse = { ...ociosa, maquinaOciosa: undefined };
    const enviadas: string[] = [];
    const varrer = (pulse: Pulse, min: number) => varrerPulse({ raiz: p.dir, consultar: () => ({ ...pulse, consultadoEm: em(min) }),
      quando: em(min), comCadencia: true, enviar: (m) => { enviadas.push(m); return true; } });

    // A janela da cadencia acabou de sair: o alerta fura a cadencia, como a pergunta nova.
    gravarUltimoResumo(p.dir, em(-1));
    assert.equal(varrer(ociosa, 0).enviadas, 1);
    assert.match(enviadas[0], /Máquina ociosa: .*, com \d+ de \d+ vagas livres e 1 item reservado parado/);
    assert.match(enviadas[0], /RM-001: abrir a thread do item, que ainda não tem uma \(`ork thread new "Item reservado simulado" --modo auto --roadmap RM-001`\)/);

    // O mesmo episodio nao avisa de novo; a maquina ocupada por duas batidas encerra o episodio.
    assert.equal(varrer(ociosa, 15).enviadas, 0);
    assert.equal(varrer(ocupada, 30).enviadas, 0);
    assert.equal(varrer(ocupada, 50).enviadas, 0);
    assert.equal(varrer(ociosa, 65).enviadas, 1, 'ociosa de novo, depois do fim do episodio: novo aviso');
    assert.equal(enviadas.length, 2);
    const avisos = lerLedger(path.join(p.dir, '.orkastery')).filter((e) => e.tipo === TIPOS_DE_EVENTO.maquinaOciosaAvisada);
    assert.deepEqual(avisos.map((e) => [e.maquina, e.sugeridas]), [[nomeDaMaquina(), ['RM-001']], [nomeDaMaquina(), ['RM-001']]]);
  } finally { p.limpar(); }
});
