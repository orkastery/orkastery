---
id: FEAT-008
tipo: feature
titulo: Rodízio de contas dos runtimes
estado: vigente
pai: MOD-03
roadmap: [RM-033, RM-040]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T08:30:00-03:00
versao: main@74db81b
fontes:
  codigo:
    - core/src/runtime-profiles.ts
    - core/src/retry.ts
  testes:
    - core/test/runtime-profiles.test.ts
    - core/test/rotacao-perfis.test.ts
    - core/test/rotacao-politica.test.ts
    - core/test/contas-compartilhadas.test.ts
  simbolos:
    - core/src/runtime-profiles.ts#adicionarPerfil
    - core/src/runtime-profiles.ts#perfilDeDespacho
    - core/src/runtime-profiles.ts#lerPerfisComContas
    - core/src/runtime-profiles.ts#publicarEstadoDaConta
  contratos:
    - ork.runtime-profiles/v1
    - ork.contas-compartilhadas/v1
  comandos:
    - ork accounts list
    - ork accounts add
    - ork accounts check
    - ork accounts remove
---

# FEAT-008 — Rodízio de contas dos runtimes

> **Em uma frase:** Quando uma conta esgota cota ou perde o login, o mesmo prompt segue em outro perfil do mesmo runtime ou no fallback do bloco, sem o `ork` tocar em credencial.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@74db81b
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-03](MOD-03-runtimes-e-contas.md)
- **Roadmap:** [RM-033](../roadmap/RM-033-rotacao-de-contas.md), [RM-040](../roadmap/RM-040-estado-de-conta-compartilhado.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** cadastrar perfil, conferir login, rotacionar por cota ou por login perdido.
- **Pré-condições e gatilho:** o login foi feito pelo próprio CLI do runtime no diretório do perfil.
- **Fluxo principal:**

  1. `ork accounts add <id> --runtime R --dir D` cria o perfil e roda o login do CLI.
  2. O despacho resolve a conta pelo registro da sessão, nunca pelo ambiente do processo.
  3. Esgotou: evento `runtime_profile_rotated` e o prompt segue no próximo perfil.

- **Alternativas, erros e recuperação:** rate limit de janela curta nunca troca de perfil: espera a janela na fila. Chave paga no ambiente é `cost.violation`, sem retry.
- **Pós-condições:** estado do perfil (esgotado até, último uso, última falha) no store do projeto, e o estado da **conta** no registro do usuário, que as outras fábricas da mesma máquina leem antes de despachar.
- **Regras de negócio:** BR-008-01: `runtime_profiles.rotate_same_runtime_on_quota: true` por padrão (decisão do dono, 19/09/2026). BR-008-02: perfil autenticado por API paga nunca recebe despacho. BR-008-03: o registro compartilhado só escurece: ele nunca devolve ao rodízio um perfil que o projeto tirou, e leitura com problema vale registro vazio.
- **Critérios de aceite e testes:** Dado um perfil esgotado, quando a fase é despachada, então ela sai no próximo perfil com login (`core/test/rotacao-perfis.test.ts`). Dada uma conta esgotada num projeto, quando outro projeto do mesmo usuário escolhe o perfil, então ele pula essa conta até o prazo (`core/test/contas-compartilhadas.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `.orkastery/private/runtime-profiles.json` do projeto (contrato `ork.runtime-profiles/v1`) e `~/.orkastery/private/contas.json` do usuário (contrato `ork.contas-compartilhadas/v1`, chave = runtime mais o caminho real do diretório da conta). Nenhum dos dois guarda segredo.
- **APIs:** Não aplicável.
- **Eventos:** `runtime_profile_rotated`, `runtime.quota-exhausted`, `runtime.auth-missing`.

## Operação e controle

- **Configuração:** `CLAUDE_CONFIG_DIR` ou `CODEX_HOME` por perfil; nenhum segredo no manifesto.
- **Estado compartilhado:** cota esgotada, login perdido e credencial paga valem para a conta em todos os projetos do mesmo usuário ([RM-040](../roadmap/RM-040-estado-de-conta-compartilhado.md)). Uso bem-sucedido ou login reconferido limpa a marca. `ork accounts list` mostra o que o despacho enxerga.
- **Rollback:** `ork accounts remove <id>` desativa o perfil; diretório e login ficam onde estão.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | estado da conta compartilhado entre os projetos do mesmo usuário | Claude (agente) / Julio, revisão pendente | RM-040 |
