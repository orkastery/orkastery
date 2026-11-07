---
id: RM-082
tipo: roadmap
titulo: Credenciais redigidas em toda superfície de comando, motivo e detalhe
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-07T16:41:25-03:00
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

# RM-082: Credenciais redigidas em toda superfície de comando, motivo e detalhe

> **Em uma frase:** nenhuma superfície que grava ou mostra comando, motivo ou detalhe expõe credencial em texto, sem perder a identidade do comando original entre rodadas.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz ou revisa uma entrega pode ter uma credencial exposta por uma superfície que persiste ou publica comando, motivo ou detalhe sem aplicar a redação geral.
- **Evidências e fonte:** a F1 da [RM-079](RM-079-claims-que-a-correcao-passa.md) redigiu `verify_run`, recibos, retirada de claim e `fix`, mas registrou A7 a A12 como dívida da `main`. A condução de 07/11/2026 identificou também `.ork-ci/<thread>.json`, cujo campo `verificar` leva texto bruto para o bundle do CI.
- **Objetivo/OKR:** nenhuma credencial persiste ou aparece em texto nas superfícies de prova e condução.
- **Hipótese:** se toda fronteira de persistência e apresentação usar a redação geral e conservar separadamente a impressão do original, então a credencial deixa de sair em texto e a comparação entre rodadas continua estável.
- **Métrica principal / linha de base / meta / janela / fonte:** ocorrências de credencial em texto nas superfícies incluídas. Linha de base: as superfícies A7 a A12 e o bundle ainda aceitam texto bruto. Meta: zero. Janela: por release. Fonte: fixtures de redação e inspeção dos artefatos gerados.
- **Métricas de proteção:** o comando executado não muda; a comparação e o reaproveitamento continuam pela impressão do comando original; o CI não recebe um comando inexequível por efeito da redação.

## Escopo e validação

- **Incluído:**
  - A7: `textoDoVerify`, a CLI e o veredito do verify MCP assíncrono;
  - A8: baseline no ledger e na CLI;
  - A9: correções derivadas do verify;
  - A10: `ork_claims_list`, `claims add` e `claims conferir`;
  - A11: `claims ausente`;
  - A12: ledger, board e saída de auditoria;
  - `.ork-ci/<thread>.json`, inclusive a lista `verificar`, sem credencial literal no arquivo;
  - redação de comando, motivo e detalhe na fronteira comum de persistência e apresentação;
  - impressão do comando original como identidade para comparação, reuso e detecção de alteração, conforme a RM-079;
  - recusa tipada no preparo do CI quando retirar uma credencial literal tornaria o comando inexequível, com orientação para receber o valor por variável de ambiente ou cofre do runner;
  - paridade entre pt-BR e inglês em toda saída que tenha os dois idiomas.
- **Fora de escopo:** mudar o comando executado, copiar credencial para outro campo, registrar a credencial cifrada no roadmap ou alterar a política de fornecimento de segredos do runner.
- **Entregáveis e critérios de aceite:**
  - cada superfície incluída persiste e mostra somente texto seguro;
  - nenhuma credencial literal aparece no bundle de CI;
  - duas rodadas do mesmo comando continuam comparáveis pela impressão do original, mesmo quando o texto público é redigido;
  - mudança no comando original muda a impressão e invalida o reaproveitamento;
  - comando com credencial literal que não pode ser executado depois da redação é recusado antes de gerar o bundle, sem imprimir o valor;
  - as mensagens equivalentes em pt-BR e inglês passam pelo mesmo contrato de redação;
  - um mutante por fronteira de persistência ou apresentação morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas superfícies do verify, das claims e do bundle; a entrega interrompe se alguma delas expuser o original ou se a impressão deixar de distinguir comandos diferentes.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade a definir pelo dono; achado da condução de 07/11/2026, derivado da dívida A7 a A12 da RM-079 e da inspeção do bundle do CI.
- **Horizonte / alvo / previsão / confiança / marcos:** alvo 0.6.9; uma fatia para a fronteira comum e uma para o bundle e a paridade de idiomas.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-079](RM-079-claims-que-a-correcao-passa.md), redação geral e contrato do bundle de CI; owner: Julio; revisão no planejamento da 0.6.9.
- **Premissas / riscos / mitigação:** a redação pode produzir colisões visuais entre comandos distintos; mitigação: a identidade usa a impressão do original. Um comando com segredo literal pode deixar de ser executável no CI; mitigação: recusa tipada antes do bundle e uso de referência ao segredo no ambiente do runner.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Guardar o texto bruto e redigir só a tela: mantém credencial no disco.
  2. Redigir na persistência e comparar pela impressão do original, recusando bundle inexequível (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-07 | Julio |
| Documentação | Rascunho | — | 2026-11-07 | Julio |
| Código | Não iniciado | — | 2026-11-07 | Julio |
| Testes | Não iniciados | — | 2026-11-07 | Julio |
| Deploy | Não implantado | — | 2026-11-07 | Julio |
| Exposição | Flag desligada | — | 2026-11-07 | Julio |
| Habilitação | Pendente | — | 2026-11-07 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução a pedido do builder; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono define a prioridade e a condução abre a thread para o alvo 0.6.9.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-07 | Item criado em Discovery | Dívida A7 a A12 da RM-079 e lista `verificar` em texto bruto no bundle do CI | Builder (pedido de 07/11/2026) |
