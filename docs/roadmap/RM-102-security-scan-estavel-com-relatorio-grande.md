---
id: RM-102
tipo: roadmap
titulo: Security scan estável com relatório grande
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

# RM-102 — Security scan estável com relatório grande

> **Em uma frase:** o security scan ingere relatórios grandes, identifica o mesmo achado de forma estável e encerra processos de teste sem intermitência no CI hospedado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem mantém o security scan pode receber falha de ingestão, achado novo falso ou teste intermitente apesar de o relatório e o comportamento analisados não terem mudado.
- **Evidências e fonte:** achado da condução de 26/11/2026. A ingestão do relatório do ESLint usa `findings.push(...)` com espalhamento e estoura com relatório grande; a impressão digital inclui uma mensagem cuja união de tipos muda de ordem entre rodadas; o caso `a round killed by SIGTERM` de `security-scan-run` é intermitente no runner hospedado e passa localmente.
- **Objetivo/OKR:** tornar ingestão, identidade do achado e encerramento da rodada determinísticos para o mesmo conteúdo analisado.
- **Hipótese:** se a ingestão trabalhar em lotes seguros, a impressão digital usar representação canônica e o teste controlar explicitamente o ciclo do processo, então tamanho, ordem textual equivalente e escalonamento do runner deixam de criar falhas falsas.
- **Métrica principal / linha de base / meta / janela / fonte:** rodadas equivalentes que divergem na ingestão, na identidade dos achados ou no resultado do teste de encerramento. A linha de base é o achado da condução; a meta e a janela serão definidas na fase GOAL; a fonte será o relatório normalizado e o CI.
- **Métricas de proteção:** achados semanticamente diferentes não colidem; relatório grande não é truncado; processo realmente não encerrado continua reprovando; ferramentas e cobertura do Classic não mudam.

## Escopo e validação

- **Incluído:** ingestão sem espalhamento dependente do tamanho; canonicalização somente da parte instável da mensagem do ESLint; fixtures com ordens equivalentes e distintas; teste determinístico da rodada encerrada por `SIGTERM`; reprodução no runner hospedado.
- **Fora de escopo:** resolver tipos no worktree destacado, que permanece na [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md); mudar regras do ESLint; suprimir achados; reduzir cobertura; alterar a política do laço da [RM-068](RM-068-security-scan-no-check.md).
- **Entregáveis e critérios de aceite:** relatório grande é ingerido por inteiro sem exceção; mensagens equivalentes com ordem diferente na união de tipos produzem a mesma impressão digital, enquanto achados distintos permanecem distintos; o teste de `SIGTERM` passa de modo repetível no CI hospedado e falha quando o processo não encerra; a RM-097 continua responsável apenas pela resolução de tipos.
- **Piloto, medição e critérios de expansão/interrupção:** começar pelo relatório e pelas fixtures que reproduzem os achados. Expandir quando rodadas repetidas no runner produzirem o mesmo conjunto. Interromper se a canonicalização colidir achados diferentes ou esconder falha real de processo.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada na condução da versão 0.6.11; sem prioridade atribuída nesta thread. O roadmap decide a posição antes de abrir trabalho.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery, sem previsão. Marcos: reprodução, ingestão segura, identidade canônica, teste de processo e prova no runner.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-068](RM-068-security-scan-no-check.md) para o motor do scan e [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md) para manter separada a resolução de tipos; owner: Condução do roadmap; revisão quando o roadmap priorizar o item.
- **Premissas / riscos / mitigação:** canonicalização ampla pode colidir mensagens; a transformação será restrita à estrutura comprovadamente comutativa e terá casos negativos. O teste de processo pode depender do escalonador; o harness observará eventos e estados explícitos, não uma espera incidental.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achados0611` separou este item da RM-097 para não duplicar a resolução de tipos e manter juntas as falhas de estabilidade da rodada. A decisão está registrada no ledger da thread.

## Estado com evidências

O item registra achados da condução. Não há código, teste, deploy ou habilitação desta capacidade.

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

- **RACI (R / A / C / I):** R: futura thread do item; A: condução do roadmap; C: manutenção do security scan e revisão independente; I: mantenedores do núcleo.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO registrou a proposta e separou o escopo da RM-097; nenhuma implementação foi autorizada.
- **Próxima ação, responsável e prazo:** priorizar ou estacionar a proposta no roadmap; responsável: condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-26 | Proposta registrada em Discovery | Achado da condução sobre ingestão de relatório, impressão digital e teste de `SIGTERM`; a resolução de tipos permanece na RM-097 | sessão GO `ork-achados0611` (#Fast) |
