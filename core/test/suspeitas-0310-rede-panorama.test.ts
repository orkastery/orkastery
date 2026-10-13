/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): o defeito 3 da revisao (o retrato de
 * outra instalacao com o nome desta maquina mostrado como "(esta maquina)") foi corrigido no `ork
 * network status`, mas o panorama do `ork network roadmap` decidia `estaMaquina` so pelo nome.
 *
 * Rede SIMULADA: o status ja diz `nomeEmUso` (o retrato "pc-a" na casa e de outra instalacao).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { definirFusoDoDono } from '../src/horario';
import { montarPanoramaDaRede, textoDoPanoramaDaRede } from '../src/network-roadmap';
import { StatusDaRede } from '../src/rede-status';
import { projetoTemporario } from './apoio';

const QUANDO = '2026-10-03T04:00:00.000Z';

test('suspeitas 03/10: no panorama, o retrato de outra instalacao com o meu nome nao e "esta maquina"', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const p = projetoTemporario('susp0310-panorama', true);
  try {
    const status: StatusDaRede = {
      contrato: 'ork.rede-status/v1', consultadoEm: QUANDO,
      casa: { forja: 'github', host: 'github.com', dono: 'dono', repositorio: 'orkastery-network', origem: 'rede.json' },
      estaMaquina: { maquina: 'pc-a', membro: true, adesao: 'rede', publicada: false, nomeEmUso: true },
      fontes: [{ fonte: 'rede', ref: 'github.com/dono/orkastery-network#main', ponta: 'abcdef1234567890abcdef1234567890abcdef12', atualizado: true }],
      membros: [{ maquina: 'pc-a', origem: 'rede', publicadoEm: '2026-10-03T03:55:00.000Z', idadeMs: 5 * 60000, hostname: 'outra-vm',
        adesao: 'rede', pessoa: null, forjas: [], runtimes: [], hosts: [], projetos: [{ nome: 'orkastery', remoto: null, caminho: '/srv/x' }], versaoOrk: '0.5.2' }],
      lacunas: [{ tipo: 'maquina.nome-em-uso', maquina: 'pc-a', detalhe: 'o retrato "pc-a" na casa e de outra instalacao' }],
      naoConsultado: ['roadmap', 'reservas', 'threads'],
    };
    const panorama = montarPanoramaDaRede({ cwd: p.dir, quando: QUANDO, maquina: 'pc-a', registro: path.join(p.dir, 'sem-registro.json'),
      semRemoto: true, rede: status });
    assert.deepEqual(panorama.rede!.membros.map((m) => [m.maquina, m.estaMaquina]), [['pc-a', false]]);
    const texto = textoDoPanoramaDaRede(panorama);
    assert.doesNotMatch(texto, /^• pc-a \(esta máquina\): retrato de/m, texto);
  } finally { p.limpar(); }
});
