---
id: RM-097
tipo: roadmap
titulo: Resolução de tipos no worktree do security scan
categoria: iniciativa
pai: null
features: []
owner: Condução do roadmap
atualizado_em: 2026-11-25T00:00:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Não iniciado
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: null
  modo: null
---

# RM-097 — Resolução de tipos no worktree do security scan

> **Em uma frase:** o lint type-aware resolve os tipos reais do projeto no worktree destacado, sem mudar o Classic nem exigir fachadas tipadas à mão no produto.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem mantém o núcleo recebe achados de qualidade causados por dependências de tipo indisponíveis no worktree destacado do scan; esses achados não descrevem necessariamente defeito de execução.
- **Evidências e fonte:** CHECK da thread `ork-macosportave`, rodada 6, achado A2 e seção “Dívida pré-existente fora da thread”. O ensaio comparou o worktree sem `node_modules` com a compilação normal que usa `@types/node`.
- **Objetivo/OKR:** fazer o eslint type-aware analisar o projeto com os tipos que pertencem ao próprio projeto, mantendo os achados de qualidade úteis e sem alterar a cobertura do Classic.
- **Hipótese:** se o scan preparar ou montar as dependências de tipo do projeto de forma controlada, então o eslint deixa de inferir `any` por módulo não resolvido e seus achados passam a representar o código analisado.
- **Métrica principal / linha de base / meta / janela / fonte:** comparar o relatório do eslint no mesmo commit antes e depois da preparação de tipos; a fonte é o relatório JSON do security scan e a meta será definida na fase GOAL.
- **Métricas de proteção:** nenhum ignore novo de fonte ou teste; nenhuma regra desligada; o Classic mantém comandos, ferramentas, ordem, argumentos e conteúdo das configs congelados; nenhuma dependência vem de caminho fora do projeto.

## Escopo e validação

- **Incluído:** descoberta das dependências necessárias; preparação controlada no worktree destacado; resolução de `@types/node` e das dependências declaradas; classificação estável dos achados; prova de que o eslint executou.
- **Fora de escopo:** mudar a config padrão do Classic; ignorar `test` ou `src`; criar fachada manual para APIs do Node; reduzir achados por supressão; promover `quality` ao laço sem decisão própria.
- **Entregáveis e critérios de aceite:** desenho com origem das dependências; reprodução hermética no worktree destacado; teste que falha quando os tipos deixam de resolver; comparação do relatório no mesmo commit; Classic intacto.
- **Piloto, medição e critérios de expansão/interrupção:** começar pelo núcleo. Expandir somente se o preparo for reprodutível e não usar estado incidental da máquina. Interromper se a solução mudar o resultado do Classic ou depender de caminho externo ao projeto.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada no CHECK; sem prioridade atribuída nesta thread. O roadmap decide a posição antes de abrir trabalho.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery, sem previsão. Marcos: reprodução, desenho de isolamento, prova focada, comparação de relatório e decisão de expansão.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-068](RM-068-security-scan-no-check.md) e [RM-072](RM-072-check-cinco-vezes-mais-rapido.md); revisão quando o roadmap priorizar o item.
- **Premissas / riscos / mitigação:** a resolução deve usar somente dependências declaradas e versões controladas. O risco de mascarar achado é mitigado por mutação que remove a resolução e por comparação de conteúdo das configs do Classic.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a condução da thread `ork-macosportave` decidiu retirar a fachada e separar esta dívida no evento `5f1d4203-7ef8-41f4-a892-2de26f491cd0`. Alternativas de fachada manual e ignore global foram recusadas pelo CHECK.

## Estado com evidências

O item registra uma proposta do CHECK. Não há código, teste, deploy ou habilitação desta capacidade.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-25 | Condução do roadmap |
| Documentação | Rascunho | — | 2026-11-25 | Condução do roadmap |
| Código | Não iniciado | — | 2026-11-25 | Condução do roadmap |
| Testes | Não iniciados | — | 2026-11-25 | Condução do roadmap |
| Deploy | Não implantado | — | 2026-11-25 | Condução do roadmap |
| Exposição | Flag desligada | — | 2026-11-25 | Condução do roadmap |
| Habilitação | Pendente | — | 2026-11-25 | Condução do roadmap |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread do item; A: condução do roadmap; C: manutenção do security scan e revisão independente; I: mantenedores do núcleo.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO registrou a proposta determinada pela condução; nenhuma implementação foi autorizada neste item.
- **Próxima ação, responsável e prazo:** priorizar ou estacionar a proposta no roadmap; responsável: condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-25 | Proposta registrada em Discovery | CHECK da thread `ork-macosportave`, rodada 6, A2 | Condução da thread |
