/**
 * RM-061, fatia F3d: os casos do snapshot pt-BR das familias que a F3d levou ao catalogo, em oito grupos, um modulo
 * `locale-f3d-casos-<grupo>.ts` por grupo. Cada caso produz um texto que a F3d passa pelo catalogo: as funcoes de texto
 * sao chamadas com entradas fixas nos ramos que a fatia toca, e o CLI roda em repositorios temporarios com HOME proprio,
 * PATH controlado e um `claude` falso (`locale-f3d-apoio.ts`). So entram funcoes que a base ja tinha, com o mesmo nome.
 *
 * A fixture `fixtures/locale-f3d-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da base (a `main` em
 * `97c2a446`, antes da F3d); o teste `locale-f3d-snapshot` so compara e nunca regrava. O que varia de uma maquina ou de
 * uma execucao para outra e normalizado no apoio, igual na geracao e na comparacao.
 */

import { definirFusoDoDono } from '../src/horario';
import { Ambiente, ambiente, Casos, limparTudo, SP } from './locale-f3d-apoio';
import { gerarGrupo as audit } from './locale-f3d-casos-audit';
import { gerarGrupo as conducao } from './locale-f3d-casos-conducao';
import { gerarGrupo as correcao } from './locale-f3d-casos-correcao';
import { gerarGrupo as fabrica } from './locale-f3d-casos-fabrica';
import { gerarGrupo as memoria } from './locale-f3d-casos-memoria';
import { gerarGrupo as produto } from './locale-f3d-casos-produto';
import { gerarGrupo as sessoes } from './locale-f3d-casos-sessoes';
import { gerarGrupo as setup } from './locale-f3d-casos-setup';

/** Os grupos, na ordem da fixture: o nome e a funcao que preenche os casos dele. */
export const GRUPOS: ReadonlyArray<readonly [string, (casos: Casos, amb: Ambiente) => void]> = [
  ['produto', produto], ['setup', setup], ['sessoes', sessoes], ['correcao', correcao],
  ['conducao', conducao], ['memoria', memoria], ['audit', audit], ['fabrica', fabrica],
];

/** Os casos de um grupo, no fuso fixo de Sao Paulo, com HOME e pastas temporarias so dele, no locale padrao (pt-BR). */
export function casosDoGrupo(nome: string): Casos {
  const grupo = GRUPOS.find(([n]) => n === nome);
  if (!grupo) throw new Error(`grupo desconhecido: ${nome}`);
  definirFusoDoDono(SP);
  const casos: Casos = {};
  try {
    grupo[1](casos, ambiente('cli'));
  } finally {
    definirFusoDoDono(undefined);
    limparTudo();
  }
  return casos;
}

/** Todos os grupos, na ordem de `GRUPOS`: e o que a fixture guarda. */
export function gerarCasos(): Record<string, Casos> {
  return Object.fromEntries(GRUPOS.map(([nome]) => [nome, casosDoGrupo(nome)]));
}
