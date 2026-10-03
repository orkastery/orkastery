---
id: FEAT-008
tipo: feature
titulo: Rodízio de contas dos runtimes
estado: vigente
pai: MOD-03
roadmap: [RM-033, RM-040]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-03T06:52:15-03:00
versao: main@059f257a
evidencias:
  codigo:
    commit: d2a54075
    pr: 50
    fatia4: "107ac246, PR #45"
    fatia5: "d2a54075, PR #50"
fontes:
  codigo:
    - core/src/runtime-profiles.ts
    - core/src/retry.ts
    - core/src/session-watcher-claude.ts
    - core/src/esgotamentos.ts
  testes:
    - core/test/runtime-profiles.test.ts
    - core/test/rotacao-perfis.test.ts
    - core/test/rotacao-politica.test.ts
    - core/test/contas-compartilhadas.test.ts
    - core/test/rm040-esgotamentos.test.ts
    - core/test/rm037-fatia5-cota-ao-vivo.test.ts
    - core/test/rm037-fatia5-fuso-do-reset.test.ts
  simbolos:
    - core/src/runtime-profiles.ts#adicionarPerfil
    - core/src/runtime-profiles.ts#perfilDeDespacho
    - core/src/runtime-profiles.ts#lerPerfisComContas
    - core/src/runtime-profiles.ts#publicarEstadoDaConta
    - core/src/esgotamentos.ts#relatorioDeEsgotamentos
  contratos:
    - ork.runtime-profiles/v1
    - ork.contas-compartilhadas/v1
    - ork.esgotamentos/v1
  comandos:
    - ork accounts list
    - ork accounts add
    - ork accounts check
    - ork accounts remove
    - ork accounts esgotamentos
---

# FEAT-008 — Rodízio de contas dos runtimes

> **Em uma frase:** Quando uma conta esgota cota ou perde o login, o mesmo prompt segue em outro perfil do mesmo runtime ou no fallback do bloco, sem o `ork` tocar em credencial.

- **Estado:** vigente · **Verificado em:** 2026-10-03 · **Versão:** main@059f257a
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-03](MOD-03-runtimes-e-contas.md)
- **Roadmap:** [RM-033](../roadmap/RM-033-rotacao-de-contas.md), [RM-040](../roadmap/RM-040-estado-de-conta-compartilhado.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** cadastrar perfil, conferir login, rotacionar por cota ou por login perdido.
- **Pré-condições e gatilho:** o login foi feito pelo próprio CLI do runtime no diretório do perfil.
- **Fluxo principal:**

  1. `ork accounts add <id> --runtime R --dir D` cria o perfil e roda o login do CLI.
  2. O despacho resolve a conta pelo registro da sessão, nunca pelo ambiente do processo.
  3. Esgotou: o perfil fica indisponível até o prazo da cota. No próximo despacho ou retry permitido, a política de rodízio pula esse perfil; a troca gera `runtime_profile_rotated`.

- **Cota detectada durante a sessão (RM-037, fatia 5):** o observador da sessão `claude-bg` viva relê a transcrição quando ela cresce. Uma mensagem de esgotamento posterior ao despacho, entre os motivos já reconhecidos pelo rodízio, marca o perfil e grava `runtime_quota_detected` uma vez por erro. A detecção não espera a morte do processo, não encerra a fase e não muda a condução.
- **Prazo do esgotamento:** vale a hora de retorno da mensagem, interpretada no fuso que ela declara entre parênteses; sem hora de retorno, vale 1 h a partir da mensagem. `ork accounts list` mostra o prazo em `ESGOTADO ATE`. A escolha do próximo perfil continua sujeita a `rotate_same_runtime_on_quota`, à disponibilidade e aos gates.

- **Alternativas, erros e recuperação:** rate limit de janela curta nunca troca de perfil: espera a janela na fila. Chave paga no ambiente é `cost.violation`, sem retry.
- **Pós-condições:** estado do perfil (esgotado até, último uso, última falha) no store do projeto, e o estado da **conta** no registro do usuário, que as outras fábricas da mesma máquina leem antes de despachar.
- **Regras de negócio:** BR-008-01: `runtime_profiles.rotate_same_runtime_on_quota: true` por padrão (decisão do dono, 19/09/2026). BR-008-02: perfil autenticado por API paga nunca recebe despacho. BR-008-03: o registro compartilhado só escurece: ele nunca devolve ao rodízio um perfil que o projeto tirou, e leitura com problema vale registro vazio.
- **Regra do observador:** BR-008-04: mensagem antiga, anterior ao despacho, não marca a conta da sessão atual; observar de novo o mesmo erro não duplica o evento nem prorroga o prazo.
- **Critérios de aceite e testes:** Dado um perfil esgotado, quando a fase é despachada, então ela sai no próximo perfil com login (`core/test/rotacao-perfis.test.ts`). Dada uma conta esgotada num projeto, quando outro projeto do mesmo usuário escolhe o perfil, então ele pula essa conta até o prazo (`core/test/contas-compartilhadas.test.ts`). Com a sessão viva e a cota na transcrição, o perfil sai do rodízio na observação seguinte, sem encerrar a fase (`core/test/rm037-fatia5-cota-ao-vivo.test.ts`); o reset respeita o fuso da mensagem (`core/test/rm037-fatia5-fuso-do-reset.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `.orkastery/private/runtime-profiles.json` do projeto (contrato `ork.runtime-profiles/v1`) e `~/.orkastery/private/contas.json` do usuário (contrato `ork.contas-compartilhadas/v1`, chave = runtime mais o caminho real do diretório da conta). Nenhum dos dois guarda segredo.
- **APIs:** Não aplicável.
- **Eventos:** `runtime_quota_detected` (motivo, instante do erro, reset, fonte do prazo e perfil pelo id), `runtime_profile_rotated`, `runtime.quota-exhausted`, `runtime.auth-missing`.

## Operação e controle

- **Configuração:** `CLAUDE_CONFIG_DIR` ou `CODEX_HOME` por perfil; nenhum segredo no manifesto.
- **Estado compartilhado:** cota esgotada, login perdido e credencial paga valem para a conta em todos os projetos do mesmo usuário ([RM-040](../roadmap/RM-040-estado-de-conta-compartilhado.md)). Uso bem-sucedido ou login reconferido limpa a marca. `ork accounts list` mostra o que o despacho enxerga.
- **Medida:** `ork accounts esgotamentos [--desde 7d] [--json]` (contrato `ork.esgotamentos/v1`) só lê: as marcas vivas do registro e, em cada projeto registrado, os despachos com perfil que caíram na conta de uma marca de outro projeto, dentro do prazo dela. A conta sai como id opaco e o perfil, pelo id; nenhum diretório de conta vai à saída. Como o registro só guarda marcas vivas, o total é um piso.
- **Rollback:** `ork accounts remove <id>` desativa o perfil; diretório e login ficam onde estão.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | estado da conta compartilhado entre os projetos do mesmo usuário | Claude (agente) / Julio, revisão pendente | RM-040 |
| 2026-10-03 | `ork accounts esgotamentos`, a medida da métrica da RM-040 | Claude (agente) / Julio, revisão pendente | RM-040, thread `ork-b7relatoriod` |
| 2026-10-03 | Observador detecta cota ao vivo, marca o perfil até o reset no fuso da mensagem e evita novo despacho na conta esgotada | Codex (agente) / revisão pendente | RM-037: fatia 4 em `107ac246` (PR #45), fatia 5 em `d2a54075` (PR #50) |
