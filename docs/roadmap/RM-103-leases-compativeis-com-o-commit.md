---
id: RM-103
tipo: roadmap
titulo: Leases compatíveis com o commit da própria thread
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

# RM-103: Leases compatíveis com o commit da própria thread

> **Em uma frase:** o commit pelo MCP ignora lease vencido e reconhece o lease da própria thread sem disputar com a proteção temporária que o próprio commit adquire.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz uma thread pelo MCP pode ter um commit autorizado recusado por um lease que já venceu ou por um lease do mesmo caminho que a própria thread tomou antes do GO.
- **Evidências e fonte:** achados da condução de 27/11/2026. Um lease de caminho vencido e tomável, pertencente a outra thread, barrou o commit de um CHANGELOG. Em outra entrega, `ork_git_commit` tentou adquirir seu lease temporário e devolveu `lease.busy` porque a condução já tinha adquirido o lease do mesmo caminho para a mesma thread, conforme o PLAN.
- **Objetivo/OKR:** preservar exclusão entre threads sem fazer a própria thread competir consigo nem tratar lease vencido como ativo.
- **Hipótese:** se validade e identidade da thread forem conferidas antes da aquisição temporária do commit, então o commit mantém a proteção concorrente e elimina recusas sem conflito real.
- **Métrica principal / linha de base / meta / janela / fonte:** commits MCP recusados por `lease.busy` sem conflito ativo de outra thread. A linha de base são os dois achados; a fonte será a suíte de leases e o ledger do commit.
- **Métricas de proteção:** lease ativo de outra thread continua bloqueando; nenhuma posse é transferida por inferência; a validade é conferida pelo relógio do núcleo.

## Escopo e validação

- **Incluído:** podar ou ignorar lease vencido antes do commit; reconhecer lease de caminho da mesma thread; tornar a aquisição temporária do commit compatível com posse prévia equivalente; orientar o PLAN a não pedir lease que `ork_git_commit` toma sozinho; manter causa tipada para conflito ativo de outra thread.
- **Fora de escopo:** dispensar lease ativo de outra thread; mudar famílias de lease sem relação com paths de commit; retirar claims, HEAD esperado ou guardas do commit MCP.
- **Entregáveis e critérios de aceite:** lease vencido não barra commit; lease do mesmo caminho e da mesma thread não barra o commit dessa thread; lease ativo de outra thread barra com causa tipada; PLAN não prescreve aquisição prévia do lease interno do commit; os casos têm prova hermética de concorrência e validade.
- **Piloto, medição e critérios de expansão/interrupção:** pilotar em commit comum e em commit do bundle. Interromper se a compatibilidade permitir que threads diferentes escrevam o mesmo caminho ao mesmo tempo.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada nos achados de 27/11/2026; sem prioridade atribuída nesta thread.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery, sem previsão. Marcos: reprodução, contrato de compatibilidade, prova concorrente e piloto pelo MCP.
- **Dependências e bloqueios (ID, owner, próxima revisão):** famílias `path:*`, `ork_git_commit`, validade dos leases e orientação de PLAN; owner: Condução do roadmap; revisão quando o item for priorizado.
- **Premissas / riscos / mitigação:** reentrada ampla pode esconder conflito entre sessões da mesma thread; a compatibilidade deve exigir thread, caminho, operação e posse equivalentes. Relógio divergente pode invalidar cedo ou tarde; a decisão usa a fonte temporal do núcleo e casos de fronteira na suíte.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achadosdacon` separou o item da RM-101 porque o defeito atinge commits comuns e a orientação do PLAN, não apenas o bundle derivado. Decisão registrada no ledger da thread.

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

- **RACI (R / A / C / I):** R: futura thread do item; A: Condução do roadmap; C: manutenção de leases, MCP e Git; I: builders que fecham GO pelo MCP.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO registrou a proposta e seus critérios; nenhuma implementação foi autorizada neste item.
- **Próxima ação, responsável e prazo:** priorizar ou estacionar a proposta; responsável: Condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-27 | Item criado em Discovery | Leases vencido e da própria thread bloquearam commits MCP sem conflito ativo de outra thread | sessão GO `ork-achadosdacon` (#Fast) |
