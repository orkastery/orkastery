---
id: FEAT-037
tipo: feature
titulo: Perfil por despacho, rodízio por carga e sessões de cada conta
estado: em desenvolvimento
pai: MOD-03
roadmap: [RM-056]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-01T06:00:00-03:00
versao: ork/ork-rm056perfil-full@6e1940c
fontes:
  codigo:
    - core/src/phase.ts
    - core/src/runtime-profiles.ts
    - core/src/sessoes-contas.ts
    - core/src/sessoes-inventario.ts
    - core/src/sessoes.ts
    - core/src/board.ts
    - core/src/orquestracao.ts
    - core/src/mcp-server.ts
    - adapters/openclaw/src/index.ts
  testes:
    - core/test/rm056-perfil-explicito.test.ts
    - core/test/rm056-rodizio-por-carga.test.ts
    - core/test/rm056-sessoes-dos-perfis.test.ts
  simbolos:
    - core/src/phase.ts#perfilPedido
    - core/src/runtime-profiles.ts#proximoPerfilPorCarga
    - core/src/sessoes-contas.ts#consultarContas
    - core/src/sessoes-contas.ts#ehFantasma
    - core/src/sessoes-contas.ts#sessoesVivasPorPerfil
    - core/src/sessoes.ts#limparFantasmas
  contratos:
    - ork.runtime-profiles/v1
  comandos:
    - ork phase run --perfil
    - ork sessions limpar-fantasmas
---

# FEAT-037 — Perfil por despacho, rodízio por carga e sessões de cada conta

> **Em uma frase:** o dono escolhe a conta de um despacho (`--perfil`) ou liga a divisão pela carga no manifesto, e `ork sessions`, o board, o escalonador e a fábrica enxergam as sessões de cada conta, com o fantasma fora da vaga.

- **Estado:** em desenvolvimento · **Verificado em:** 2026-10-01 · **Versão:** `ork/ork-rm056perfil-full@6e1940c`
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-03](MOD-03-runtimes-e-contas.md)
- **Roadmap:** [RM-056](../roadmap/RM-056-perfil-por-thread-e-carga.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:**
  - UC-037-01: o dono despacha uma fase numa conta escolhida (`ork phase run <thread> <FASE> --prompt P --perfil codex-b`; nos hosts, `perfil` em `ork_phase_run`);
  - UC-037-02: com `runtime_profiles.distribuir: carga`, o `ork` escolhe sozinho a conta de menor carga;
  - UC-037-03: o dono vê o que roda em cada conta (`ork sessions`, `ork board plan`) e solta do `ork` a sessão fantasma (`ork sessions limpar-fantasmas`).
- **Pré-condições e gatilho:** perfis cadastrados em `ork accounts add`; sem perfis, nada muda (o despacho segue pelo ambiente do processo).
- **Fluxo principal:**
  1. Perfil pedido: `perfilPedido` confere o store (com o estado compartilhado das contas, RM-040) e o preflight de login do próprio CLI confere a conta; aprovado, o filho nasce com o `CLAUDE_CONFIG_DIR`/`CODEX_HOME` do perfil.
  2. Sem pedido e com `distribuir: carga`: `sessoesVivasPorPerfil` conta as sessões vivas de cada conta do runtime nesta máquina e `proximoPerfilPorCarga` escolhe a de menor carga; empate pelo `ultimoUso` mais antigo, depois a ordem do store.
  3. Inventário: `consultarContas` consulta a conta do processo e cada perfil do store (inclusive desativado), sem repetir diretório real; cada sessão volta com o id do perfil.
  4. O escalonador e o monitor usam o mesmo mapa (`estadosNasContas`): sessão `working` de qualquer conta conta como em andamento; codex com rollout aberto e escrito dentro de `concurrency.stale_after_min` conta como `working`.
- **Alternativas, erros e recuperação:**
  - perfil inexistente ou de outro runtime: `runtime.profile-invalid` (escalar-humano, sem retry automático), sem sessão aberta;
  - perfil esgotado: `runtime.quota-exhausted`; sem login (no store ou no preflight): `runtime.auth-missing`; login de provider pago: `cost.violation`; o despacho nunca troca de perfil sozinho;
  - conta que não responde: fonte `ok: false` no inventário (consulta INCOMPLETA), nunca "zero sessões"; na carga, conta sem resposta vale carga zero e o desempate decide;
  - sessão claude-bg em estado não terminal sem `pid`, ou com `pid` sem processo: fantasma; não ocupa vaga nem vira pausa humana.
- **Pós-condições:** `phase_dispatch.perfil` registra a conta do despacho; `limpar-fantasmas` grava `sessao_morta` (origem `sessions.limpar-fantasmas`, `perfilId`) no ledger da thread vinculada, o que encerra a condução da sessão (`fimDaSessao`).
- **Regras de negócio:**
  - BR-037-01: o perfil pedido nunca é trocado por outro; a recusa diz por quê, com motivo tipado.
  - BR-037-02: sem `distribuir`, a escolha é a da ordem do store, idêntica à da RM-033.
  - BR-037-03: a saída mostra o id do perfil, nunca o diretório da conta nem nada de dentro dele.
  - BR-037-04: `limpar-fantasmas` nunca chama o runtime (`stop`, `rm`); só solta o vínculo do `ork`, uma vez por sessão.
- **Critérios de aceite e testes:**
  - Dado `a` e `b`, quando `--perfil b`, então o despacho sai com o diretório de `b` e `a` fica intocado (`rm056-perfil-explicito`);
  - Dado `distribuir: carga` e dois perfis livres, quando duas threads despacham em seguida, então vão a `a` e `b`; sem a chave, as duas vão a `a` (`rm056-rodizio-por-carga`);
  - Dada uma sessão `working` no perfil `b`, quando o escalonador consulta o runtime, então `em andamento` é 1 (antes: 0); dada uma sessão `blocked` sem `pid`, então ela é fantasma e `limpar-fantasmas` grava `sessao_morta` uma vez (`rm056-sessoes-dos-perfis`).
- **Interface e acessibilidade:** CLI. `ork sessions` ganha a coluna `PERFIL` (`processo` sem perfil) e a contagem de fantasmas.

## Dados e contratos

- **Entidades e campos:** `runtime_profiles.distribuir` (`ordem` | `carga`, padrão `ordem`; valor desconhecido vale `ordem` com aviso); `SessaoRuntime.pid` e `SessaoRuntime.atividadeEm` (só leitura do runtime); no inventário, `perfil`, `fantasma` e `viva` por sessão e `fantasmas` no total.
- **APIs e endpoints:** MCP `ork_phase_run.perfil` (texto, mesmo padrão do id de perfil); OpenClaw `ork_phase_run.perfil` (opcional) vira `--perfil`.
- **Eventos e jobs:** `sessao_morta` com `origem: sessions.limpar-fantasmas`; `gate_blocked` com `runtime.profile-invalid`.

## Operação e controle

- **Configuração e ambientes:** `runtime_profiles.distribuir: carga` no `orkastery.yaml`. Nenhum segredo.
- **Observabilidade:** `ork sessions [--json]` (perfil e fantasma por sessão), `ork board plan` (em andamento), ledger (`phase_dispatch.perfil`).
- **Acesso, privacidade e conformidade:** o `ork` nunca lê credencial; o login é conferido pelo próprio CLI com o env do perfil.
- **Dependências e rollback:** [FEAT-008](FEAT-008-rodizio-de-contas.md). Rollback: tirar `distribuir` do manifesto volta à ordem do store; reverter os commits da thread volta o inventário à conta do processo.
- **Código, PR, testes e release:** thread `ork-rm056perfil`; PR pendente; release no próximo pacote, pelo mantenedor.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-10-01 | Criada | Claude Code (thread `ork-rm056perfil`) / Julio | RM-056; decisões D1 a D7 no ledger da thread |
