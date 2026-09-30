---
id: RM-051
tipo: roadmap
titulo: Pacote de experiência de orquestração
categoria: melhoria
pai: null
features: [FEAT-031]
owner: Equipe Orkastery
atualizado_em: 2026-09-29T10:29:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Falhando
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 22083057682a652e6ffaa3f6da326549876221d6
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
| Em desenvolvimento | Branch criada | Falhando | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

Pessoas que conduzem projetos precisam de mensagens úteis e preferências aplicadas sem editar instruções manualmente. O comportamento em desenvolvimento está especificado em [FEAT-031](../produto/FEAT-031-pacote-de-experiencia.md), apoiada nos contratos de [horário](RM-035-horario-do-dono.md) e [HITL](RM-048-hitl-humano-no-centro.md).

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

Implementação local em andamento; esta página não é recibo oficial de aceite, instalação ou publicação.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-29 | Equipe Orkastery |
| Documentação | Em revisão | — | 2026-09-29 | Equipe Orkastery |
| Código | Branch criada | commit `22083057682a652e6ffaa3f6da326549876221d6` | 2026-09-29 | Equipe Orkastery |
| Testes | Falhando | — | 2026-09-29 | Equipe Orkastery |
| Deploy | Não implantado | — | 2026-09-29 | Equipe Orkastery |
| Exposição | Flag desligada | — | 2026-09-29 | Equipe Orkastery |
| Habilitação | Pendente | — | 2026-09-29 | Equipe Orkastery |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

A equipe Orkastery conduz implementação e revisão. Próxima ação: concluir coordenação dos arquivos adiados, verificar pelo núcleo e obter revisão independente antes de promover o estado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | Cadastro planejado | Especificação FEAT-031 | Equipe Orkastery |

## Evidência da implementação local

Código preparado em branch com testes focados de preferências, blocos, adaptadores, entradas, MCP, aviso de associação e lógica do ensaio. Os arquivos e comandos estão em [FEAT-031](../produto/FEAT-031-pacote-de-experiencia.md) e no [guia de experiência](../guias/orchestration-experience.pt-BR.md).

Os testes locais de CLI/MCP que dependem de subprocessos encontram restrições do ambiente. O eval completo também apresentou falhas nos canários. Por isso o estado de testes é **Falhando**, sem atribuir automaticamente tudo à baseline. Faltam verificação oficial, revisão independente e ensaio real de instalação do tarball. Versão mantida; mudança em “Não publicado”, sem PR, release ou deploy comprovado.

Alguns caminhos compartilhados aguardam coordenação por lease. O estado público não declara conclusão enquanto houver arquivos adiados ou provas pendentes. OpenClaw permanece sem distribuição de skills do pacote.
