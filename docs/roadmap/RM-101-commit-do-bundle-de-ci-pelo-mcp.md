---
id: RM-101
tipo: roadmap
titulo: Commit do bundle de CI pelo MCP
categoria: iniciativa
pai: null
features: []
owner: Condução do roadmap
atualizado_em: 2026-11-26T09:50:38-03:00
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

# RM-101 — Commit do bundle de CI pelo MCP

> **Em uma frase:** a sessão registra pelo MCP o bundle de CI produzido pelo verify verde, sem claim artificial nem commit feito fora do núcleo.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** sessões de GO que usam o transporte MCP conseguem gerar o bundle oficial de CI, mas não conseguem registrá-lo pelo mesmo transporte. O caminho oficial fica incompleto e incentiva commit por fora do núcleo ou uma claim sem significado.
- **Evidências e fonte:** achado da condução de 25 e 26/11/2026. O `ork_git_commit` recusou `.ork-ci/<thread>.json` com `mcp.git.claim.missing`, e a condução precisou commitar o bundle por fora em mais de uma thread. Esta mesma thread reproduziu a recusa em 26/11/2026, e a condução commitou o bundle.
- **Objetivo/OKR:** fechar o GO pelo transporte autorizado, mantendo o bundle derivado ligado à rodada verde, ao HEAD e à thread que o produziu.
- **Hipótese:** se o núcleo reconhecer o bundle como artefato derivado com recibo próprio, então o MCP poderá commitá-lo sem claim artificial, enquanto arquivos comuns continuam exigindo claims.
- **Métrica principal / linha de base / meta / janela / fonte:** proporção de bundles gerados pelo fluxo oficial que são commitados pelo MCP sem desvio de transporte. A linha de base é o achado da condução; a meta e a janela serão definidas na fase GOAL; a fonte será o ledger e o recibo do commit.
- **Métricas de proteção:** nenhum arquivo comum perde a exigência de claim; bundle de outra thread, de outro HEAD ou de verify não verde é recusado; o conteúdo gerado não vira prova de si mesmo.

## Escopo e validação

- **Incluído:** recibo do `ork ci prepare`; vínculo entre bundle, thread, HEAD e rodada verde; exceção estreita no `ork_git_commit` para o bundle derivado; commit com HEAD esperado; resposta tipada para bundle ausente, alterado, obsoleto ou de outra thread.
- **Fora de escopo:** dispensar claims de arquivos de produto ou documentação; aceitar bundle editado pela sessão; commitar por shell; executar o CI; autorizar SHIP, push, PR ou merge.
- **Entregáveis e critérios de aceite:** depois do verify verde, `ork ci prepare <thread>` gera o bundle e o `ork_git_commit` o registra no HEAD esperado sem claim artificial; mudança no bundle, na rodada, na thread ou no HEAD recusa antes do commit; os demais paths continuam recusados sem claim; o recibo do commit identifica o artefato derivado sem declarar que ele verificou a si mesmo.
- **Piloto, medição e critérios de expansão/interrupção:** piloto numa thread de documentação pelo MCP. Expandir quando o caminho oficial fechar sem exceção genérica. Interromper se um arquivo arbitrário puder usar o recibo do bundle ou se um bundle obsoleto for aceito.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada na condução da versão 0.6.11; sem prioridade atribuída nesta thread. O roadmap decide a posição antes de abrir trabalho.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery, sem previsão. Marcos: contrato do recibo, guarda estreita no commit, provas de recusa e piloto pelo MCP.
- **Dependências e bloqueios (ID, owner, próxima revisão):** contrato do bundle de CI, `ork ci prepare`, `ork_git_commit`, claims e verify; owner: Condução do roadmap; revisão quando o roadmap priorizar o item.
- **Premissas / riscos / mitigação:** a exceção pode virar um bypass de claims; ela será limitada ao path calculado pelo núcleo e à impressão do conteúdo produzido. Uma rodada pode ficar obsoleta entre preparo e commit; o HEAD e o recibo serão relidos imediatamente antes do efeito.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achados0611` separou o achado em item próprio porque o bundle é artefato derivado do fechamento, não uma alegação de produto. A decisão está registrada no ledger da thread.

## Estado com evidências

O item registra um achado da condução. Não há código, teste, deploy ou habilitação desta capacidade.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-26 | Condução do roadmap |
| Documentação | Rascunho | — | 2026-11-26 | Condução do roadmap |
| Código | Não iniciado | — | 2026-11-26 | Condução do roadmap |
| Testes | Não iniciados | — | 2026-11-26 | Condução do roadmap |
| Deploy | Não implantado | — | 2026-11-26 | Condução do roadmap |
| Exposição | Flag desligada | — | 2026-11-26 | Condução do roadmap |
| Habilitação | Pendente | — | 2026-11-26 | Condução do roadmap |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread do item; A: condução do roadmap; C: manutenção de claims, verify, CI e MCP; I: builders que fecham GO pelo transporte MCP.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO registrou a proposta e seu critério; nenhuma implementação ou exceção de claim foi autorizada.
- **Próxima ação, responsável e prazo:** priorizar ou estacionar a proposta no roadmap; responsável: condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-26 | Proposta registrada em Discovery | Achado da condução de 25 e 26/11/2026: o bundle oficial foi recusado pelo MCP com `mcp.git.claim.missing` | sessão GO `ork-achados0611` (#Fast) |
