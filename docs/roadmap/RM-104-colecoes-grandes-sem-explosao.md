---
id: RM-104
tipo: roadmap
titulo: Coleções grandes sem explosão de pilha ou memória
categoria: iniciativa
pai: null
features: []
owner: Condução do roadmap
atualizado_em: 2026-11-27T16:45:00-03:00
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

# RM-104: Coleções grandes sem explosão de pilha ou memória

> **Em uma frase:** caminhos de produção processam coleções cujo tamanho vem da entrada sem espalhamento dependente dela nem comparação quadrática por impressão digital.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem executa verify, CHECK, hosts, roadmap de rede e security scan pode fornecer uma coleção válida que cresce com a entrada e fazer o processo exceder a pilha ou a memória antes de produzir o resultado.
- **Evidências e fonte:** achados da condução de 27/11/2026. O GO-FIX da RM-102 identificou espalhamento `push(...x)` dependente da entrada em caminhos de produção, inclusive `verify.ts`, `check-agil.ts`, `hosts.ts` e `network-roadmap.ts`. O CHECK da RM-102 identificou em `core/src/security-scan/compare.ts:68-75` uma classificação quadrática para achados com a mesma impressão digital; uma coleção repetida no mesmo arquivo esgota a memória.
- **Objetivo/OKR:** aceitar entradas grandes preservando resultado e ordem, com crescimento controlado de pilha, memória e trabalho.
- **Hipótese:** se agregações dependentes da entrada forem iterativas e a classificação indexar grupos uma única vez, então o custo deixa de depender de chamadas com muitos argumentos e de comparações repetidas do mesmo grupo.
- **Métrica principal / linha de base / meta / janela / fonte:** caminhos de produção que falham na prova de volume por pilha, memória ou crescimento quadrático. A linha de base são os achados da RM-102; a fonte será a varredura estrutural e a suíte de volume.
- **Métricas de proteção:** nenhuma coleção é truncada; ordem e semântica permanecem; espalhamento de tamanho fixo continua permitido; a prova não depende de capacidade incidental do ambiente.

## Escopo e validação

- **Incluído:** auditar agregações de produção cujo tamanho depende da entrada; substituir espalhamento variável por iteração ou estrutura equivalente; reescrever `classify` para agrupar por impressão digital sem busca repetida no grupo; adicionar prova de volume para cada caminho alcançável; declarar limites usados pela prova e conferir que chegam ao processo testado.
- **Fora de escopo:** espalhamento com quantidade fixa de argumentos; mudanças sem relação com crescimento da entrada; alterar regras, categorias ou impressão digital do security scan; resolução de tipos da [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md); esconder falha por aumento do limite do processo.
- **Entregáveis e critérios de aceite:** nenhum espalhamento dependente da entrada permanece em caminho de produção; `classify` processa achados repetidos sem crescimento quadrático; provas de volume percorrem os caminhos reais, conferem a coleção completa e falham quando a proteção é retirada; resultados permanecem equivalentes para entradas normais e grandes.
- **Piloto, medição e critérios de expansão/interrupção:** começar pelos caminhos identificados na RM-102 e expandir pela varredura estrutural do núcleo. Interromper se a correção alterar ordem, identidade, contagem ou conteúdo do resultado.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada no GO-FIX e no CHECK da RM-102 em 27/11/2026; sem prioridade atribuída nesta thread.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery, sem previsão. Marcos: inventário reproduzível, desenho linear, provas de volume e comparação de resultado.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-102](RM-102-security-scan-estavel-com-relatorio-grande.md) como origem dos achados e harness de volume; owner: Condução do roadmap; revisão quando o item for priorizado.
- **Premissas / riscos / mitigação:** uma regra textual pode acusar espalhamento fixo ou código de teste; a varredura precisa distinguir origem do tamanho e caminho de produção. Uma reescrita pode mudar ordem; casos de equivalência conferem conteúdo e sequência.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achadosdacon` separou o item da RM-102 porque o critério alcança módulos fora do security scan e porque a própria RM-102 remetia `classify` a item futuro. Decisão registrada no ledger da thread.

## Estado com evidências

O item registra uma proposta em Discovery. Não há implementação, teste, deploy ou habilitação desta capacidade.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-27 | Condução do roadmap |
| Documentação | Rascunho | — | 2026-11-27 | Condução do roadmap |
| Código | Não iniciado | — | 2026-11-27 | Condução do roadmap |
| Testes | Não iniciados | — | 2026-11-27 | Condução do roadmap |
| Deploy | Não implantado | — | 2026-11-27 | Condução do roadmap |
| Exposição | Flag desligada | — | 2026-11-27 | Condução do roadmap |
| Habilitação | Pendente | — | 2026-11-27 | Condução do roadmap |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread do item; A: Condução do roadmap; C: manutenção do núcleo e revisão de performance; I: builders que executam verify e security scan.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO registrou a proposta e seus critérios; nenhuma implementação foi autorizada neste item.
- **Próxima ação, responsável e prazo:** priorizar ou estacionar a proposta; responsável: Condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-27 | Item criado em Discovery | Espalhamento dependente da entrada em produção e classificação quadrática no security scan | sessão GO `ork-achadosdacon` (#Fast) |
