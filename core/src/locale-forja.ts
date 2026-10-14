/**
 * A familia `forja` do catalogo: o motivo de cada erro tipado da forja (`forja.*`), para a pessoa. O codigo sai igual
 * nas duas linguas, no comeco da frase; o detalhe e dado (status HTTP, metodo, caminho, host) e sai como veio. O
 * pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 */

type ErroLegivel = { codigo: string; detalhe: string; tentarEm?: string };

export const FORJA_PT_BR = {
  motivo: (e: ErroLegivel, tipo: string | null): string => {
    const d = e.detalhe;
    switch (e.codigo) {
      case 'forja.desconhecida': return `forja.desconhecida: nenhuma CLI com login em ${d} respondeu como forja; declare forja.tipo no orkastery.yaml`;
      case 'forja.ambigua': return `forja.ambigua: ${d} respondeu como mais de uma forja; declare forja.tipo no orkastery.yaml`;
      case 'forja.remoto-divergente': return `forja.remoto-divergente: o remoto não é da forja que o orkastery.yaml declara (${d})`;
      case 'forja.sem-login': return `forja.sem-login: a CLI da forja não tem login no host (${d})`;
      case 'forja.sem-permissao': return `forja.sem-permissao: o login da CLI não tem permissão para isto (${d})`;
      case 'forja.nao-achei': return tipo === 'gitlab'
        ? `forja.nao-achei: ${d}; no GitLab, projeto privado sem acesso também responde 404`
        : `forja.nao-achei: ${d}`;
      case 'forja.limite': return `forja.limite: a cota de requisições da forja acabou (${d})${e.tentarEm ? `; tente depois de ${e.tentarEm}` : ''}`;
      case 'forja.conflito': return `forja.conflito: a forja recusou por conflito com o estado atual (${d})`;
      case 'forja.indisponivel': return `forja.indisponivel: a forja não respondeu (${d})`;
      case 'forja.pedido-recusado': return `forja.pedido-recusado: a forja recusou o pedido (${d})`;
      case 'forja.incompleto': return `forja.incompleto: a lista passou do teto de leitura e não foi lida inteira (${d})`;
      case 'forja.resposta-invalida': return `forja.resposta-invalida: resposta fora do formato esperado (${d})`;
      case 'forja.versao-abaixo-do-piso': return `forja.versao-abaixo-do-piso: ${d}; o ork não opera esta versão`;
      case 'forja.sem-capacidade': return `forja.sem-capacidade: o adaptador não implementa ${d}`;
      case 'forja.ausente': return `forja.ausente: a CLI da forja não está instalada nesta máquina (${d})`;
      default: return `${e.codigo}: ${d}`;
    }
  },
};

export type MensagensDeForja = typeof FORJA_PT_BR;

export const FORJA_EN: MensagensDeForja = {
  motivo: (e, tipo) => {
    const d = e.detalhe;
    switch (e.codigo) {
      case 'forja.desconhecida': return `forja.desconhecida: no CLI logged in to ${d} answered as a forge; declare forja.tipo in orkastery.yaml`;
      case 'forja.ambigua': return `forja.ambigua: ${d} answered as more than one forge; declare forja.tipo in orkastery.yaml`;
      case 'forja.remoto-divergente': return `forja.remoto-divergente: the remote is not on the forge that orkastery.yaml declares (${d})`;
      case 'forja.sem-login': return `forja.sem-login: the forge CLI is not logged in to the host (${d})`;
      case 'forja.sem-permissao': return `forja.sem-permissao: the CLI login is not allowed to do this (${d})`;
      case 'forja.nao-achei': return tipo === 'gitlab'
        ? `forja.nao-achei: ${d}; on GitLab, a private project you cannot access also answers 404`
        : `forja.nao-achei: ${d}`;
      case 'forja.limite': return `forja.limite: the forge request quota ran out (${d})${e.tentarEm ? `; try again after ${e.tentarEm}` : ''}`;
      case 'forja.conflito': return `forja.conflito: the forge refused because of a conflict with the current state (${d})`;
      case 'forja.indisponivel': return `forja.indisponivel: the forge did not answer (${d})`;
      case 'forja.pedido-recusado': return `forja.pedido-recusado: the forge refused the request (${d})`;
      case 'forja.incompleto': return `forja.incompleto: the list went past the read cap and was not read in full (${d})`;
      case 'forja.resposta-invalida': return `forja.resposta-invalida: the response is not in the expected format (${d})`;
      case 'forja.versao-abaixo-do-piso': return `forja.versao-abaixo-do-piso: ${d}; ork does not operate this version`;
      case 'forja.sem-capacidade': return `forja.sem-capacidade: the adapter does not implement ${d}`;
      case 'forja.ausente': return `forja.ausente: the forge CLI is not installed on this machine (${d})`;
      default: return `${e.codigo}: ${d}`;
    }
  },
};
