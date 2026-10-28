# RM-074 M0 — resultado da bancada

Fonte: [`m0-bancada-bruta.json`](m0-bancada-bruta.json), contrato
`ork.medir-check.bancada/v1`, no commit `476410d67d1437ae5078e0838de08da073ff764d`.
A bancada fez três pares de Agile e Classic e três passes isolados pelos 645 arquivos
da suíte: 625 herméticos, 20 de integração e 5.910 testes. Este texto não converte
a medição em duração absoluta.

## Pares e limite de confiança

A razão é `Classic ÷ Agile`: 3 significaria que o Agile cumpriu a meta de ser três
vezes mais rápido. O roubo de CPU é o `steal` observado durante cada rodada.

| Par | Razão Classic ÷ Agile | Roubo no Agile | Roubo no Classic | Veredito do par |
| --- | ---: | ---: | ---: | --- |
| 1 | 0,693 vez | 14,2% | 9,3% | Agile aprovou; Classic saiu 1 |
| 2 | 0,926 vez | 24,6% | 25,9% | Agile aprovou; Classic saiu 1 |
| 3 | 0,971 vez | 52,4% | 40,7% | ambos saíram 1 |

Nas duas primeiras rodadas Classic, a saída 1 ocorreu enquanto o Agile do mesmo par
aprovou. O terceiro Classic também saiu 1, e o Agile do terceiro par igualmente saiu 1.
Assim, nenhum par teve os dois modos aprovados. As duas primeiras falhas Classic
impedem usar suas razões como comparação limpa entre modos; a falha compartilhada do
terceiro par impede até atribuir a reprovação daquele par a um modo específico.

O roubo permite concluir que a contenção externa foi material e variou muito entre as
rodadas, apesar da espera por carga quieta. Ele não permite corrigir a razão por regra
de três, atribuir a diferença ao Agile ou ao Classic, extrapolar para outra máquina,
nem declarar atingida ou perdida a meta de três vezes. As razões acima são observações
da bancada; a comparação de produto exige novos pares aprovados e com roubo controlado.

## Variação entre rodadas

| Grandeza | Faixa | Coeficiente de variação | Amplitude relativa |
| --- | ---: | ---: | ---: |
| Razão Classic ÷ Agile | 0,693–0,971 vez | 17,3% | 32,2% |
| Parede do Agile, normalizada pela média dele | 88,4%–118,0% | 15,8% | 29,6% |
| Parede do Classic, normalizada pela média dele | 74,5%–131,5% | 29,0% | 57,0% |
| CPU da suíte, normalizada pela média dela | 79,8%–110,4% | 17,5% | 30,6% |
| Eficiência da suíte no Agile | 43,9%–61,4% | 19,0% | 34,7% |
| Roubo de CPU nas nove medições | 9,3%–52,4% | 48,5% | 159,7% |

## Sondas 1 a 5 refeitas

1. **Concentração por arquivo.** Os cinco arquivos com mais parede concentraram de
   16,9% a 22,3% da soma; os 100 primeiros, de 72,4% a 74,6%. De 10 a 12 arquivos
   ficaram acima do orçamento de 2,6% por arquivo. A lane hermética respondeu por
   89,9% a 92,4% da soma e a de integração, por 7,6% a 10,1%.
2. **Custo isolado dos maiores.** Os cinco maiores de cada passe somaram de 17,7% a
   18,2% da CPU da suíte, embora representassem de 2,2% a 2,8% dos testes. O conjunto
   muda entre passes, mas `locale-f3d-snapshot`, `rede` e `noctum-integracao` aparecem
   nos três; o resultado confirma uma cauda curta e cara, sem provar a causa de cada
   arquivo.
3. **Repetição das claims.** As três claims da bancada executam `node --test`, repetem
   arquivo de uma lane e trazem build. Elas ocuparam de 3,9% a 8,4% da parede dos
   pares. Na referência de 136 claims, 86 executam `node --test`, 85 repetem arquivo
   de lane e 118 trazem build; há trabalho duplicado a atacar, mas a bancada não mede
   quanto pode ser removido sem perder a verificação independente.
4. **Seletividade por grafo.** Dos 645 testes, 262 sobem processo pela heurística; 238
   dos 356 módulos alcançados entram na maioria dos testes, e a cadeia de locale chega
   a 591. Na janela de 60 commits, a mediana estática seleciona 59,5 testes e de 13,2%
   a 13,9% da parede; a conservadora seleciona 305,5 e de 67,3% a 68,8%. Na janela de
   200, as medianas sobem para 561 e 593 testes. O grafo ajuda em diffs estreitos, mas
   não sustenta sozinho a meta quando o diff alcança módulos centrais.
5. **Peças em fallback.** `tsgo`, `cache-semgrep` e `binarios-nativos` ficaram em
   fallback nos três pares. O primeiro par registrou 14 peças e os demais, 12; a
   diferença de contagem também precisa ser explicada antes de comparar o custo das
   peças entre pares.

## Orçamento provisório da F2

A eficiência da suíte no Agile teve média de 50,4% e chegou a 61,4%. A F2 usa como
alvo provisório pelo menos 60% de eficiência e pelo menos 63% de corte da CPU da suíte
contra a média dos três passes da M0. Na média da bancada, a CPU da suíte equivaleria
a 53,4% da parede Classic se os oito núcleos estivessem ocupados por inteiro; com 60%
de eficiência, o corte mínimo para a suíte caber em um terço é 62,6%, arredondado para
cima. Esse é só o piso da suíte: claims, preparo e varredura ainda precisam caber no
gate. Pelo roubo e pelas reprovações, os dois números orientam a F2, mas não substituem
a meta final de três pares aprovados com razão mínima de 3.
