/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen), RM-053 e RM-054:
 *
 *  - no `ork_network_status` do MCP (projeto fixado), a maquina vista so na fabrica de outro projeto
 *    saia dos membros, mas a lacuna `maquina.sem-batida` dela, com o nome, ficava (D5).
 *
 * Casa, maquinas e projetos SIMULADOS; nenhuma forja real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { StatusDaRede } from '../src/rede-status';
import { redeDoProjetoFixado } from '../src/network-roadmap';
import { projetoTemporario } from './apoio';

test('revisao 03/10: no MCP fixado, a maquina de outro projeto nao deixa a lacuna com o nome dela', () => {
  const p = projetoTemporario('rev0310-rede-d5');
  try {
    const agora = new Date().toISOString(), velho = new Date(Date.now() - 5 * 864e5).toISOString();
    const status: StatusDaRede = { contrato: 'ork.rede-status/v1', consultadoEm: agora, casa: null,
      estaMaquina: { maquina: 'eu', membro: false, adesao: null, publicada: false, nomeEmUso: false },
      fontes: [{ fonte: 'fabrica-estado', projeto: 'time-b', ref: 'ork/fabrica-estado', ponta: 'abc', atualizado: true }],
      membros: [{ maquina: 'bob-laptop', origem: 'fabrica-estado', publicadoEm: velho, idadeMs: 5 * 864e5, hostname: null, adesao: null,
        pessoa: 'Bob Colega', forjas: [], runtimes: [], hosts: [], projetos: [{ nome: 'time-b', remoto: null, caminho: null }], versaoOrk: null }],
      lacunas: [{ tipo: 'maquina.sem-batida', maquina: 'bob-laptop', detalhe: 'bob-laptop: sem batida ha 5 d' },
        { tipo: 'rede.sem-leitura', detalhe: 'sem casa' }],
      naoConsultado: [] } as unknown as StatusDaRede;
    const s = redeDoProjetoFixado(p.dir, { status });
    assert.deepEqual(s.membros, []);
    assert.ok(!JSON.stringify(s).includes('bob-laptop'), JSON.stringify(s.lacunas));
    assert.deepEqual(s.lacunas.map((l) => l.tipo), ['rede.sem-leitura'], 'a lacuna sem maquina continua');
  } finally { p.limpar(); }
});
