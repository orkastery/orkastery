---
id: RM-051
tipo: roadmap
titulo: Pacote de experiência de orquestração
categoria: melhoria
pai: null
features: [FEAT-034]
owner: Equipe Orkastery
atualizado_em: 2026-09-30T00:13:18-03:00
estado:
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Branch criada
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 868e97484c5e93437166929c6ab07d6ffea6362c
    pr: null
sdlc:
  thread: ork-pacotedeexpe
  modo: "#Auto"
  fase: CHECK
  status: aberta
---

# RM-051: Pacote de experiência de orquestração

> **Em uma frase:** configurar idioma, fuso e profundidade da condução no onboarding e distribuir orientações bilíngues aos hosts, com instalação reversível e evidência reproduzível.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em validação | Branch criada | Aprovados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

Pessoas que conduzem projetos precisam de mensagens úteis e preferências aplicadas sem editar instruções manualmente. O comportamento está especificado em [FEAT-034](../produto/FEAT-034-pacote-de-experiencia.md), apoiada nos contratos de [horário](RM-035-horario-do-dono.md) e [HITL](RM-048-hitl-humano-no-centro.md).

O resultado esperado é configuração explícita, instalação repetível e remoção segura. Não há métrica de adoção medida; a prova técnica é feita por testes e pelo ensaio isolado de distribuição.

## Escopo e validação

- Preferências públicas no manifesto e onboarding, com opt-out.
- Skills em inglês e pt-BR, integradas a Claude Code, Codex e Hermes.
- Consultas MCP de reservas/fábrica e aviso de associação de item.
- Instalação idempotente e restauração byte a byte, preservando alterações externas.
- Fora do escopo: mudar HMAC, assinar como dono, alterar permissões nativas ou prometer distribuição de skills no OpenClaw.

Aceite exige testes locais, verify oficial, revisão independente e instalação real de tarball. A varredura pública tem padrões explícitos e limites declarados.

## Plano e decisões

Treze tarefas cobrem cadastro, preferências, onboarding, recibos, adaptadores, catálogo, hosts, MCP, aviso, distribuição, guias, higiene e paridade final. A execução mantém a versão e registra mudanças em “Não publicado”.

Riscos: caminhos inseguros, conflito de bloco e indisponibilidade remota. A mitigação prevista recusa sobrescritas ambíguas e distingue ausência de dados de falha de consulta. A manutenção valida a distribuição antes da publicação.

## Estado com evidências

Implementação completa na branch, em validação até o PR; esta página não é recibo oficial de aceite, instalação ou publicação.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em validação | — | 2026-09-30 | Equipe Orkastery |
| Documentação | Em revisão | — | 2026-09-30 | Equipe Orkastery |
| Código | Branch criada | commit `868e97484c5e93437166929c6ab07d6ffea6362c` | 2026-09-30 | Equipe Orkastery |
| Testes | Aprovados | — | 2026-09-30 | Equipe Orkastery |
| Deploy | Não implantado | — | 2026-09-30 | Equipe Orkastery |
| Exposição | Flag desligada | — | 2026-09-30 | Equipe Orkastery |
| Habilitação | Pendente | — | 2026-09-30 | Equipe Orkastery |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

A equipe Orkastery conduz implementação e revisão. Próxima ação: abrir o PR para a main e acompanhar o CI.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | Cadastro planejado | Especificação FEAT-034 | Equipe Orkastery |
| 2026-09-30 | Em validação, testes aprovados | CHECK independente com GO-FIX 2 a 5; a feature passa a FEAT-031 porque a main já usa FEAT-030 | Equipe Orkastery |
| 2026-09-30 | Feature renumerada de FEAT-031 para FEAT-034 | A FEAT-031 ficou combinada para a RM-053 em outra máquina da rede; nesta, a FEAT-033 é da RM-026 e a FEAT-034, da RM-051 | Equipe Orkastery |

## Evidência da implementação

Código na branch com testes de preferências, blocos, clone sem recibo, adaptadores, entradas, MCP, aviso de associação e varredura pública; os arquivos e comandos estão em [FEAT-034](../produto/FEAT-034-pacote-de-experiencia.md) e no [guia de experiência](../guias/orchestration-experience.pt-BR.md).

O CHECK independente rodou o eval completo, o lint de prompts e de Markdown, a verificação documental, os links, a varredura pública e o ensaio real de instalação do tarball, todos verdes. A revisão de código e a auditoria de privacidade acharam dois bloqueadores e seis avisos, corrigidos com teste nos GO-FIX 2 a 5. Versão mantida; mudança em “Não publicado”, sem PR, release ou deploy comprovado.

OpenClaw permanece sem distribuição de skills do pacote.
