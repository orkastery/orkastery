/**
 * RM-058, bloco B (D3): retomada conservadora entre máquinas.
 *
 * Silêncio não transfere trabalho. Ele permite tomar uma autoridade sem sinal e, depois de uma carência maior, cancelar
 * uma ordem não presa; a ordem aceita fica isolada até o executor assinar o fim. O resultado também diz ao vigia quais
 * ordens desta máquina foram canceladas, para que ele pare a sessão sem autorizar uma retomada local.
 */
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { lerArco } from './noctum-arco';
import {
  assumirAutoridade, BATIDA_VENCIDA_MS, cancelarOrdem, cederAutoridade, EstadoDaCoordenacao, lerCoordenacao,
  OpcoesDaCoordenacao, ordemViva,
} from './noctum-coordenacao';
import { envelopeMultimaquina, RecusaDoArco } from './noctum-envelope';

/** O cancelamento exige duas carências de batida: uma partição de 15 min não transfere trabalho. */
export const CARENCIA_DA_RETOMADA_MS = 2 * BATIDA_VENCIDA_MS;

export interface OrdemCanceladaLocal {
  ordem: string;
  trabalho: string;
}

export interface ResultadoDaRetomadaNaRede {
  aplicavel: boolean;
  acoes: string[];
  canceladasLocais: OrdemCanceladaLocal[];
  lacuna: { motivo: string; detalhe: string } | null;
}

const idadeDoSinal = (estado: EstadoDaCoordenacao, maquina: string, quando: string): number => {
  const sinal = estado.sinais.get(maquina);
  return sinal ? Date.parse(quando) - Date.parse(sinal) : Number.POSITIVE_INFINITY;
};

const canceladasDestaMaquina = (estado: EstadoDaCoordenacao, maquina: string): OrdemCanceladaLocal[] =>
  [...estado.ordens.values()].filter(o => o.maquina === maquina && o.estado === 'isolada' && !!o.cancelada)
    .map(o => ({ ordem: o.ordem, trabalho: o.trabalho }));

/**
 * Executa no máximo uma mudança de coordenação por chamada. Releituras e corridas continuam sob as trocas atômicas da N3;
 * uma recusa tipada vira lacuna do tique, nunca estado vazio.
 */
export function retomadaNaRede(carregado: ManifestoCarregado, arco: string,
  opcoes: OpcoesDaCoordenacao = {}): ResultadoDaRetomadaNaRede {
  const quando = opcoes.quando ?? new Date().toISOString();
  const local = lerArco(carregado.raiz, arco, quando);
  if (!local?.conteudo || !envelopeMultimaquina(local.conteudo)) {
    return { aplicavel: false, acoes: [], canceladasLocais: [], lacuna: null };
  }
  const eu = nomeDaMaquina(opcoes.maquina);
  const acoes: string[] = [];
  try {
    let estado = lerCoordenacao(carregado, arco, { ...opcoes, quando });
    const cessao = estado.autoridade ? estado.cessoes.get(estado.autoridade.geracao) : null;
    if (estado.autoridade && estado.autoridade.maquina !== eu && cessao?.para === eu && local.situacao === 'vigente') {
      assumirAutoridade(carregado, arco, { ...opcoes, quando });
      acoes.push('autoridade-assumida-por-cessao');
      estado = lerCoordenacao(carregado, arco, { ...opcoes, quando });
    } else if (estado.autoridade && estado.autoridade.maquina !== eu && local.situacao === 'vigente' &&
        idadeDoSinal(estado, estado.autoridade.maquina, quando) > BATIDA_VENCIDA_MS) {
      assumirAutoridade(carregado, arco, { ...opcoes, quando,
        forcar: { motivo: 'noctum.retomada.autoridade-sem-sinal' } });
      acoes.push('autoridade-tomada-sem-sinal');
      estado = lerCoordenacao(carregado, arco, { ...opcoes, quando });
    }

    if (estado.autoridade?.maquina === eu && local.situacao === 'encerrado') {
      const para = (estado.vigente.conteudo.maquinas ?? []).filter(m => m.nome !== eu)
        .map(m => ({ nome: m.nome, em: estado.sinais.get(m.nome) ?? '' }))
        .sort((a, b) => Date.parse(b.em || '1970-01-01') - Date.parse(a.em || '1970-01-01'))[0];
      if (para && !estado.cessoes.has(estado.autoridade.geracao)) {
        cederAutoridade(carregado, arco, para.nome, 'noctum.retomada.cessao-no-encerramento', { ...opcoes, quando });
        acoes.push(`autoridade-cedida:${para.nome}`);
        estado = lerCoordenacao(carregado, arco, { ...opcoes, quando });
      }
    } else if (estado.autoridade?.maquina === eu && local.situacao === 'vigente') {
      const presa = new Map((estado.vigente.conteudo.trabalhos ?? []).map(t => [t.id, t.maquina ?? null]));
      const ordem = [...estado.ordens.values()].find(o => o.maquina !== eu && ordemViva(o) && !o.cancelada &&
        presa.get(o.trabalho) !== o.maquina && idadeDoSinal(estado, o.maquina, quando) > CARENCIA_DA_RETOMADA_MS);
      if (ordem) {
        cancelarOrdem(carregado, arco, ordem.ordem, 'noctum.retomada.maquina-sem-sinal', { ...opcoes, quando });
        acoes.push(`ordem-cancelada:${ordem.ordem}`);
        estado = lerCoordenacao(carregado, arco, { ...opcoes, quando });
      }
    }
    return { aplicavel: true, acoes, canceladasLocais: canceladasDestaMaquina(estado, eu), lacuna: null };
  } catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    return { aplicavel: true, acoes, canceladasLocais: [], lacuna: { motivo: e.motivo, detalhe: e.message } };
  }
}
