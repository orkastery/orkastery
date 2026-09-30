# references/

Checklists normativas citadas **por numero de item** pelas skills, pelos adaptadores e pelo
humano, para que quem escreve `DoD 4` ou `SEC 5` e quem le resolvam a mesma linha.

| Arquivo | Citado como | O que fixa |
|---|---|---|
| [definition-of-done.md](definition-of-done.md) | `DoD 4` | As condicoes que uma entrega cumpre, por tarefa, por thread, por merge e por log |
| [code-review-axes.md](code-review-axes.md) | `REVIEW 7` | Os 5 eixos de review e a regra que categoriza todo achado |
| [security-checklist.md](security-checklist.md) | `SEC 5` | A superficie da auditoria e a condicao dura de zero bloqueadores |
| [testing-patterns.md](testing-patterns.md) | `TEST 3` | O que uma suite precisa provar e como uma suite verde e ganha honestamente |
| [performance-checklist.md](performance-checklist.md) | `PERF 2` | A auditoria condicional, seu contrato de dispensa e a honestidade de medicao |

Tres regras governam as cinco.

1. **Elas elevam verificacao que ja existe** no nucleo (`core/`) e nas skills finas, com o mesmo
   significado. Divergencia entre uma checklist e o comando `ork` que a executa e defeito, nunca
   segunda opiniao; onde aparecer, o nucleo vence.
2. **Um item so e gate quando esta maquina consegue roda-lo.** Tudo que depende de ferramenta
   ausente vai para a secao `Recomendacoes` dizendo isso. Checklist que exige evidencia que
   ninguem consegue produzir e mentira com cara de rigor. O que nao da para medir e publicado
   como `unavailable`, nunca como zero.
3. **Numeracao e append-only** a partir do commit que publica estes arquivos, pela vida da v1.
   Renumerar quebra toda citacao ja escrita e e mudanca de contrato publico versionado: exige
   decisao de classe 2 ratificada, a mesma regra que o contrato do MASTER log tomou ao congelar.
