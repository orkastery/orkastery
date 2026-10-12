---
id: RM-056
tipo: roadmap
titulo: Perfil por thread, rodízio por carga e sessões dos perfis
categoria: iniciativa
pai: null
features: [FEAT-037]
owner: Julio
atualizado_em: 2026-10-02T16:39:10+00:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 0a914b0
    pr: 37
sdlc:
  thread: ork-rm056perfil
  modo: "#Auto"
  fase: MASTER
  status: aberta
---

# RM-056 — Perfil por thread, rodízio por carga e sessões dos perfis

> **Em uma frase:** com várias contas do mesmo runtime, o dono escolhe a conta de cada despacho ou deixa o `ork` dividir pela carga, e todo inventário de sessões enxerga o que roda em cada conta, sem fantasma ocupando vaga.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-037](../produto/FEAT-037-perfil-carga-e-sessoes-das-contas.md)
- **Thread:** `ork-rm056perfil`

## Problema e resultado

- **Público e problema/oportunidade:** o dono que tem mais de uma conta por runtime (`ork accounts`). Hoje o `ork` usa sempre a primeira conta até a cota acabar, não deixa escolher a conta de um despacho e só enxerga as sessões da conta do processo.
- **Evidências e fonte (01/10/2026, srvjcp86, ork 0.5.0):**
  1. com `codex-a` e `codex-b` logados, duas threads despachadas ao mesmo tempo com `--runtime codex` foram as duas para `codex-a` (`ultimoUso` de `codex-b` intocado); o `phase run` não aceitava perfil, embora o núcleo já tivesse `perfil` em `escolherPerfil`/`perfilParaDespacho`, e o rodízio da [RM-033](RM-033-rotacao-de-contas.md) só troca de conta quando a cota acaba;
  2. `ork sessions` e `ork board plan` liam `claude agents` com o `CLAUDE_CONFIG_DIR` padrão e `~/.codex/sessions`: com 3 sessões vivas em `~/.claude-b` e `~/.codex-a`, o board mostrou "em andamento: 0";
  3. depois de uma atualização automática do Claude Code, duas sessões ficaram `blocked` sem `pid` no `claude agents`; `ork sessions stop`, `claude stop` e `claude rm` respondem "No job matching", e elas contavam como ocupadas.
- **Objetivo/OKR:** nenhuma conta ociosa enquanto outra carrega a fábrica, e nenhuma decisão de vaga tomada sem ver as sessões de todas as contas.
- **Hipótese:** Se o despacho aceitar o perfil pedido, puder escolher o perfil de menor carga e o inventário consultar cada conta do store, então dois despachos simultâneos vão a contas diferentes e o board conta as sessões que de fato rodam, porque a escolha e a contagem passam a ver todas as contas.
- **Métrica principal / linha de base / meta / janela / fonte:** despachos simultâneos com perfis livres que caem na mesma conta, com `distribuir: carga`. Linha de base: 2 de 2 (evidência 1). Meta: 0. Janela: cada par de despachos da fábrica. Fonte: `phase_dispatch.perfil` no ledger e o teste `rm056-rodizio-por-carga`.
- **Métricas de proteção:**
  - sem `runtime_profiles.distribuir`, a escolha é a de antes (testes de rotação da RM-033 verdes);
  - nenhum segredo lido ou impresso: a sessão leva o id do perfil, nunca o diretório da conta;
  - projeto sem perfis segue pelo ambiente do processo (P8 da I-33).

## Escopo e validação

- **Incluído:**
  - `ork phase run ... --perfil <id>`, e `perfil` em `ork_phase_run` (MCP) e na extensão OpenClaw;
  - `runtime_profiles.distribuir: carga` no manifesto (opt-in; padrão `ordem`);
  - inventário por perfil em `ork sessions`, `ork board plan`, no escalonador e no monitor (que alimenta o retrato da fábrica);
  - sessão fantasma (claude-bg não terminal sem `pid` vivo) marcada e fora da vaga; `ork sessions limpar-fantasmas`.
- **Fora de escopo:** tipar as falhas do despacho (RM-055, thread `ork-rm055impedim`); contas por runtime na rede (RM-053, fatia 2); remover a sessão do runtime (o `limpar-fantasmas` só solta o vínculo do `ork`); publicar no npm.
- **Entregáveis e critérios de aceite:**
  - perfil pedido → despacha com o env do perfil; inexistente ou de outro runtime recusa com `runtime.profile-invalid`; esgotado com `runtime.quota-exhausted`; sem login com `runtime.auth-missing`; nunca troca sozinho → `core/test/rm056-perfil-explicito.test.ts`, `core/test/mcp-server.test.ts` (RM-056), `adapters/openclaw/test/projeto-alvo.test.mjs` (RM-056);
  - carga → dois despachos seguidos com dois perfis livres vão a perfis diferentes; sem a chave, os dois vão ao primeiro do store → `core/test/rm056-rodizio-por-carga.test.ts`;
  - inventário → cada sessão com o perfil; sessão `working` de um perfil conta como em andamento; fantasma fora da vaga; `limpar-fantasmas` grava `sessao_morta` sem chamar o runtime → `core/test/rm056-sessoes-dos-perfis.test.ts`.
- **Piloto, medição e critérios de expansão/interrupção:** ligar `distribuir: carga` na srvjcp86 com `codex-a` e `codex-b` e conferir `phase_dispatch.perfil` de dois despachos simultâneos; voltar a `ordem` se a consulta das contas atrasar o despacho em mais de 10 s.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** alta / pedido do dono / - / contas pagas ociosas e board cego para as sessões dos perfis / 2026-10-01.
- **Horizonte / alvo / previsão / confiança / marcos:** próxima versão / 0.5.x / outubro de 2026 / alta / PR desta thread.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-033/FEAT-008 (rodízio), RM-040 (estado de conta compartilhado), RM-053 fatia 2 (contas por runtime na rede, depois).
- **Premissas / riscos / mitigação:** consultar N contas custa N chamadas de `claude agents` → contas deduplicadas pelo diretório real, carga só com opt-in; conflito com a RM-055 em `phase.ts` → mudanças em funções próprias (`perfilPedido`, `cargaDoDespacho`).
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1 a D7 no plano da thread `ork-rm056perfil` e no ledger (`ork decisao placar ork-rm056perfil`); decididas pela condução #Auto em 2026-10-01.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-02 | Julio |
| Documentação | Em revisão | — | 2026-10-02 | Julio |
| Código | Mesclado | commit `0a914b0` · PR #37 | 2026-10-02 | Julio |
| Testes | Em execução | — | 2026-10-02 | Julio |
| Deploy | Não implantado | — | 2026-10-02 | Julio |
| Exposição | Flag desligada | — | 2026-10-02 | Julio |
| Habilitação | Pendente | — | 2026-10-02 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** agente da thread / Julio / - / -
- **Agentes envolvidos, atuação, autonomia e revisor humano:** Claude Code (GOAL a MASTER, #Auto); revisão humana no PR.
- **Próxima ação, responsável e prazo:** revisão e merge do PR pela VPS.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-01 | Item criado e implementado na thread `ork-rm056perfil` | Pedido do dono de 29/09 e evidências de 01/10 | Julio |
| 2026-10-03 | Fatia na thread `ork-rm056fechara`: o fechamento (MASTER e `ork thread close`) solta o vínculo das sessões fantasma da própria thread com `sessao_morta`, só quando o ledger tem sessão sem fim; sessão viva fica | `ork sessions list` de 03/10 com 624f65db e d38ae1d4 presas a threads fechadas; teste `rm056-fantasma-ao-fechar` | Condutor #Auto, por delegação do dono |
