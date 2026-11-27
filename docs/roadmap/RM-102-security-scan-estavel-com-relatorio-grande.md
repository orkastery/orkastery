---
id: RM-102
tipo: roadmap
titulo: Security scan estável com relatório grande
categoria: iniciativa
pai: null
features: []
owner: Condução do roadmap
atualizado_em: 2026-11-27T01:49:08-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-rm102securit
  modo: fast
  fase: GO
  status: aberta
---

# RM-102 — Security scan estável com relatório grande

> **Em uma frase:** o security scan ingere relatórios grandes, identifica o mesmo achado de forma estável e encerra processos de teste sem intermitência no CI hospedado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem mantém o security scan pode receber falha de ingestão, achado novo falso ou teste intermitente apesar de o relatório e o comportamento analisados não terem mudado.
- **Evidências e fonte:** achado da condução de 26/11/2026. A ingestão do relatório do ESLint usa `findings.push(...)` com espalhamento e estoura com relatório grande; a impressão digital inclui uma mensagem cuja união de tipos muda de ordem entre rodadas; o caso `a round killed by SIGTERM` de `security-scan-run` é intermitente no runner hospedado e passa localmente.
- **Objetivo/OKR:** tornar ingestão, identidade do achado e encerramento da rodada determinísticos para o mesmo conteúdo analisado.
- **Hipótese:** se a ingestão trabalhar em lotes seguros, a impressão digital usar representação canônica e o teste controlar explicitamente o ciclo do processo, então tamanho, ordem textual equivalente e escalonamento do runner deixam de criar falhas falsas.
- **Métrica principal / linha de base / meta / janela / fonte:** rodadas equivalentes que divergem na ingestão, na identidade dos achados ou no resultado do teste de encerramento. A linha de base é o achado da condução; o aceite exige o relatório completo nos dois modos, a impressão estável sem colisão e o encerramento observado pelo processo; a fonte é a suíte do security scan e o verify oficial.
- **Métricas de proteção:** achados semanticamente diferentes não colidem; relatório grande não é truncado; processo realmente não encerrado continua reprovando; ferramentas e cobertura do Classic não mudam.

## Escopo e validação

- **Incluído:** ingestão sem espalhamento dependente do tamanho; canonicalização somente da parte instável da mensagem do ESLint; fixtures com ordens equivalentes e distintas; teste determinístico da rodada encerrada por `SIGTERM`; reprodução no runner hospedado.
- **Fora de escopo:** resolver tipos no worktree destacado, que permanece na [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md); mudar regras do ESLint; suprimir achados; reduzir cobertura; alterar a política do laço da [RM-068](RM-068-security-scan-no-check.md); corrigir o crescimento quadrático de `classify` com achados de mesma impressão digital, que deve seguir em item futuro.
- **Entregáveis e critérios de aceite:** relatório grande é ingerido por inteiro sem exceção; mensagens equivalentes com ordem diferente na união de tipos produzem a mesma impressão digital, enquanto achados distintos permanecem distintos; o teste de `SIGTERM` passa de modo repetível no CI hospedado e falha quando o processo não encerra; a RM-097 continua responsável apenas pela resolução de tipos.
- **Piloto, medição e critérios de expansão/interrupção:** começar pelo relatório e pelas fixtures que reproduzem os achados. Expandir quando rodadas repetidas no runner produzirem o mesmo conjunto. Interromper se a canonicalização colidir achados diferentes ou esconder falha real de processo.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** item priorizado pela condução na versão 0.6.11 e executado pela thread aberta `ork-rm102securit`; sem pontuação registrada.
- **Horizonte / alvo / previsão / confiança / marcos:** em desenvolvimento, sem previsão. A reprodução, a ingestão segura, a identidade canônica e o teste de processo foram implementados; o verify do commit `8c61a5f8` foi concluído e a correção pedida pelo CHECK da rodada 2 aguarda novo verify oficial.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-068](RM-068-security-scan-no-check.md) para o motor do scan e [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md) para manter separada a resolução de tipos; owner: thread `ork-rm102securit`; revisão após o verify oficial da correção.
- **Premissas / riscos / mitigação:** canonicalização ampla pode colidir mensagens; a transformação será restrita à estrutura comprovadamente comutativa e terá casos negativos. O teste de processo pode depender do escalonador; o harness observará eventos e estados explícitos, não uma espera incidental.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achados0611` separou este item da RM-097 para não duplicar a resolução de tipos e manter juntas as falhas de estabilidade da rodada. A decisão está registrada no ledger da thread.

## Estado com evidências

A implementação está na branch da thread, com prova focal para os modos Classic e Agile e com o teste de encerramento preservado. O verify oficial do commit `8c61a5f8` foi concluído; o CHECK independente da rodada 2 pediu mudanças e a correção desta rodada GO aguarda novo verify oficial.

Dispensas antigas de `no-unsafe-argument` com a união fora da ordem canônica precisam ser refeitas uma vez, porque a impressão digital passa a usar a forma canônica.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-27 | Condução do roadmap |
| Documentação | Em revisão | — | 2026-11-27 | Condução do roadmap |
| Código | Branch criada | — | 2026-11-27 | Condução do roadmap |
| Testes | Em execução | — | 2026-11-27 | Condução do roadmap |
| Deploy | Não implantado | — | 2026-11-27 | Condução do roadmap |
| Exposição | Flag desligada | — | 2026-11-27 | Condução do roadmap |
| Habilitação | Pendente | — | 2026-11-27 | Condução do roadmap |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: thread `ork-rm102securit`; A: condução do roadmap; C: manutenção do security scan e revisão independente; I: mantenedores do núcleo.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a thread `ork-rm102securit` implementou o escopo em modo #Fast; o CHECK independente pediu correções de agregação, prova e documentação, aplicadas neste GO sem ampliar a resolução de tipos da RM-097.
- **Próxima ação, responsável e prazo:** executar o verify oficial no HEAD corrigido e devolver o resultado ao CHECK independente; responsável: thread `ork-rm102securit`; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-26 | Proposta registrada em Discovery | Achado da condução sobre ingestão de relatório, impressão digital e teste de `SIGTERM`; a resolução de tipos permanece na RM-097 | sessão GO `ork-achados0611` (#Fast) |
| 2026-11-27 | Thread `ork-rm102securit` aberta em modo #Fast | A condução separou a estabilidade do security scan da resolução de tipos e gravou a baseline da branch | Condução da RM-102 |
| 2026-11-27 | Implementação entregue ao CHECK independente no commit `2b40ac63` | O verify oficial ficou verde e o CHECK pediu mudanças na agregação, nas provas e na documentação | thread `ork-rm102securit` (#Fast) |
| 2026-11-27 | Correções do CHECK aplicadas nos commits `deac7525` e `a4ebf235` | A agregação deixou de espalhar coleções dependentes da entrada e a prova passou a percorrer os modos Classic e Agile com cache anterior e casos negativos | thread `ork-rm102securit` (#Fast) |
| 2026-11-27 | Rodada 2 do CHECK revisou o commit `8c61a5f8` e pediu mudanças | O bloqueador ficou no relatório Markdown; os avisos pediram controles positivos, casos negativos, prova de grupo grande e atualização desta página | thread `ork-rm102securit` (#Fast) |
