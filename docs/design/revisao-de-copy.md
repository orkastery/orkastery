# Revisão de copy · termos proibidos no site e no README

Proposta de troca, arquivo por arquivo. Regra: "pausa" no sentido de HITL vira **ponto de HITL** ("decidir ou aprovar"). "Afrouxar", "batuta", "metrônomo" e Bernstein saem. IDs técnicos (`pausa: boolean`, `pausas`, `pausaSobre`) só mudam se o núcleo (`ork modos`) mudar junto. Abaixo, só texto visível.

Fonte: orkastery/orkastery.com@main e orkastery/orkastery@main, lidos em 2026-10-12.

## orkastery.com · src/data/home-sections.ts
| linha | hoje | proposta |
| --- | --- | --- |
| 14 | Pausa humana no lugar certo | Ponto de HITL no lugar certo |
| 20 | Quanta pausa você quer? Escreva uma #TAG. | Quanta autonomia você quer? Escreva uma #TAG. |
| 51 | How much pause do you want? Write a #TAG. | How much autonomy do you want? Write a #TAG. |

## orkastery.com · src/data/home.ts e src/data/product-pages.ts (mesmo texto)
| idioma | hoje | proposta |
| --- | --- | --- |
| PT | Os modos controlam pausas; permissões e provas continuam explícitas. | O modo ajusta a autonomia; permissões e provas continuam explícitas. |
| EN | Modes control pauses; permissions and evidence remain explicit. | The mode sets the autonomy; permissions and evidence remain explicit. |

## orkastery.com · src/data/modos.ts
| campo | hoje | proposta |
| --- | --- | --- |
| comentário l.1 | do que mais pausa ao mais leve | do que tem mais pontos de HITL ao mais autônomo |
| #Maestro · uso (PT) | Solução clara e ágil, sem tradeoff pesado: uma pausa para alinhar as premissas. | Solução clara e ágil, sem tradeoff pesado: um ponto de HITL para alinhar as premissas. |
| #Maestro · uso (EN) | A clear solution: pause once to agree on assumptions. | A clear solution: one HITL point to agree on assumptions. |
| #Auto · pausaSobre (EN) | no scheduled pauses | no scheduled HITL points |
| #Fast · pausaSobre (EN) | no scheduled pauses; pushing to the base still needs authorization | no scheduled HITL points; pushing to the base still needs authorization |

## orkastery.com · src/data/docs-concepts.ts
| idioma | hoje | proposta |
| --- | --- | --- |
| PT l.42 | O modo controla pausas previstas. | O modo define os pontos de HITL previstos. |
| EN l.106 | The mode controls scheduled pauses. | The mode sets the scheduled HITL points. |

## orkastery.com · src/data/docs-guides.ts
| linha | hoje | proposta |
| --- | --- | --- |
| 11 | Compare as pausas previstas e os limites de cada modo. | Compare os pontos de HITL e os limites de cada modo. |
| 17 | #Classic separa objetivo, plano e evidências em três pausas. #Maestro concentra a pausa nas premissas e no plano. #Auto percorre o ciclo completo sem pausa prevista. | #Classic tem três pontos de HITL: objetivo, plano e evidências. #Maestro concentra o ponto de HITL nas premissas e no plano. #Auto percorre o ciclo completo sem ponto de HITL previsto. |
| 47 | O modo diz quantas pausas a thread tem | O modo diz quantos pontos de HITL a thread tem |
| 56 | Compare scheduled pauses and the limits of each mode. | Compare the HITL points and the limits of each mode. |
| 62 | #Classic provides three pauses for the goal, plan and evidence. #Maestro concentrates its pause on assumptions and the plan. #Auto runs the full cycle without scheduled pauses. | #Classic has three HITL points: goal, plan and evidence. #Maestro concentrates its HITL point on assumptions and the plan. #Auto runs the full cycle without a scheduled HITL point. |
| 92 | The mode decides how many pauses a thread has | The mode decides how many HITL points a thread has |
| 957 | Acompanhe pausas e decisões | Acompanhe pontos de HITL e decisões |
| 1011 | Track pauses and decisions | Track HITL points and decisions |

## orkastery.com · src/data/docs-product.ts
| idioma | hoje | proposta |
| --- | --- | --- |
| PT l.127 | #Classic, #Maestro e #Auto mudam as pausas. | #Classic, #Maestro e #Auto mudam os pontos de HITL. |
| EN l.206 | #Classic, #Maestro and #Auto change pauses. | #Classic, #Maestro and #Auto change the HITL points. |

## orkastery.com · src/data/docs-reference.ts
"comando da pausa" (l.51) e "pause command" (l.155) descrevem o runtime esperando um aceite de termos. Não é HITL de decisão, mas evita ambiguidade:
- PT: "a fase espera o dono rodar o comando indicado"
- EN: "the phase waits for the owner to run the indicated command"

## orkastery.com · arquivos com nome proibido
- `src/scripts/batuta.ts`: renomear (sugestão: `regente.ts` ou `conducao.ts`) e atualizar os imports.

## orkastery/orkastery · README.md (EN)
| trecho | hoje | proposta |
| --- | --- | --- |
| Four modes | The mode changes **where** the cycle waits for you | The mode sets **where** the cycle asks for you |
| tabela de modos | coluna "Pauses" | coluna "HITL points" |
| bloco de texto | The mode loosens the PAUSE. The mode NEVER loosens the VERIFICATION. | The mode sets the autonomy. Verification never changes. |
| Credits | No metronome ever turned anyone into Bernstein. Mastery is not tempo: … | Mastery is building more, and faster, with quality in the product and in the life of whoever conducts. It is knowing, after each run, what you did, what it cost and how well it went. That is the phase we call MASTER, and it is why the project is called Orkastery. |

O README.pt-BR.md segue o mesmo mapa, usando as frases aprovadas em PT ("O modo ajusta a autonomia. A verificação é sempre a mesma." e "Maestria é construir mais, e mais rápido, com qualidade no produto e na vida de quem conduz.").

## Espanhol
O site ainda tem `/es/` (as linhas ES dos mesmos arquivos). O brief define só PT e EN: decidir se o ES sai ou recebe a mesma revisão.
