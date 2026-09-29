---
id: RM-051
tipo: roadmap
titulo: Pacote de experiência de orquestração
categoria: melhoria
pai: null
features: [FEAT-030]
owner: Equipe Orkastery
atualizado_em: 2026-09-29T09:53:00-03:00
estado:
  ciclo: Pronto para desenvolvimento
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
  thread: ork-pacotedeexpe
  modo: "#Auto"
---

# RM-051 — Pacote de experiência de orquestração

> **Em uma frase:** configurar idioma, fuso e profundidade da condução no onboarding e distribuir orientações bilíngues aos hosts, com instalação reversível e evidência reproduzível.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Pronto para desenvolvimento | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

Pessoas que conduzem projetos precisam de mensagens úteis e preferências aplicadas sem editar instruções manualmente. A proposta está especificada em [FEAT-030](../produto/FEAT-030-pacote-de-experiencia.md), apoiada nos contratos de [horário](RM-035-horario-do-dono.md) e [HITL](RM-048-hitl-humano-no-centro.md).

O resultado esperado é configuração explícita, instalação repetível e remoção segura. Não há métrica de adoção medida; a prova técnica será feita por testes e ensaio isolado de distribuição.

## Escopo e validação

- Preferências públicas no manifesto e onboarding, com opt-out.
- Skills em inglês e pt-BR, integradas a Claude Code, Codex e Hermes.
- Consultas MCP de reservas/fábrica e aviso de associação de item.
- Instalação idempotente e restauração byte a byte, preservando alterações externas.
- Fora do escopo: mudar HMAC, assinar como dono, alterar permissões nativas ou prometer distribuição de skills no OpenClaw.

Aceite exige testes locais, verify oficial, revisão independente e instalação real de tarball. A varredura pública terá padrões explícitos e limites declarados.

## Plano e decisões

Treze tarefas cobrem cadastro, preferências, onboarding, recibos, adaptadores, catálogo, hosts, MCP, aviso, distribuição, guias, higiene e paridade final. A execução mantém a versão e registra mudanças em “Não publicado”.

Riscos: caminhos inseguros, conflito de bloco e indisponibilidade remota. A mitigação prevista recusa sobrescritas ambíguas e distingue ausência de dados de falha de consulta. A manutenção valida a distribuição antes da publicação.

## Estado com evidências

Cadastro planejado: esta página não comprova implementação, aprovação, instalação ou publicação.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Pronto para desenvolvimento | — | 2026-09-29 | Equipe Orkastery |
| Documentação | Rascunho | — | 2026-09-29 | Equipe Orkastery |
| Código | Não iniciado | — | 2026-09-29 | Equipe Orkastery |
| Testes | Não iniciados | — | 2026-09-29 | Equipe Orkastery |
| Deploy | Não implantado | — | 2026-09-29 | Equipe Orkastery |
| Exposição | Flag desligada | — | 2026-09-29 | Equipe Orkastery |
| Habilitação | Pendente | — | 2026-09-29 | Equipe Orkastery |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

A equipe Orkastery conduz implementação e revisão. Próxima ação: implementar as tarefas e anexar evidências antes de promover o estado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | Cadastro planejado | Especificação FEAT-030 | Equipe Orkastery |
