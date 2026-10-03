---
id: FEAT-007
tipo: feature
titulo: Worktree e leases por thread
estado: vigente
pai: MOD-02
roadmap: [RM-100]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/worktree.ts
    - core/src/leases.ts
  testes:
    - core/test/worktree.test.ts
    - core/test/leases-b2.test.ts
    - core/test/rm036-leases-canonicos.test.ts
  simbolos:
    - core/src/worktree.ts#garantirWorktree
    - core/src/leases.ts#adquirirRegiao
  comandos:
    - ork worktree ensure
    - ork worktree sync
    - ork lease list
    - ork lease acquire
---

# FEAT-007 — Worktree e leases por thread

> **Em uma frase:** Cada thread escreve na própria worktree, e leases tipados impedem duas sessões de mexer na mesma região ao mesmo tempo, com fila quando colidem.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** garantir worktree, rebasear na base, tomar e soltar lease.
- **Pré-condições e gatilho:** thread criada com `worktree.por_thread: true` (sem flag) ou com `--worktree auto`, ou depois por `ork worktree ensure`.
- **Fluxo principal:**

  1. A worktree nasce da base resolvida pelo `ork`.
  2. Escrita fora da worktree exige lease de região (`path:<glob>`).
  3. Lease ocupado entra na fila; vaga devolvida por estado real, não por tempo.

- **Alternativas, erros e recuperação:** `ork worktree audit` sai diferente de zero se a worktree divergir do registro.
- **Pós-condições:** registro da worktree e dos leases em `.orkastery/`.
- **Regras de negócio:**
  - BR-007-01: famílias de lease: `main-tree`, `worktree-write:<thread>`, `path:<glob>`, `board:<card>`, `service:<porta>`.
  - BR-007-02: os leases e a fila moram no `.orkastery/leases` da raiz do projeto (o estado canônico), com o `ork` chamado da raiz ou de qualquer worktree. O legado das worktrees só é consultado na janela de 30 minutos iniciada na primeira consulta desta versão, mesmo sem legado, marcada em `.orkastery/leases/.legado` na raiz. Só um arquivo regular válido, com nome correspondente, thread no formato de id, datas ISO e prazo de até 30 minutos (com tolerância de 1 segundo entre as leituras do relógio), barra enquanto vivo; não é copiado nem prova posse canônica. Arquivo inválido ou ilegível é ignorado e aparece na lista durante a janela. O diagnóstico mostra apenas o arquivo, sem comando de remoção. Depois de encerrada, a janela não reabre com arquivos legados novos. A aquisição preserva o legado vencido. A fila legada não é lida; a espera se refaz no próximo pedido. O legado nunca é apagado: o descarte grava uma marca `dev:ino:ctime` em `.orkastery/leases/.legado-ignorado-<dev>-<ino>-<ctime>` no estado canônico. Se existe cópia canônica, `release` atua somente nela; sem ela, a dona do legado (ou `--forcar`) apenas registra a marca. A poda e o fechamento também usam marcas, e uma substituição por outro inode ou `ctime` continua visível. O `ctime` usa `ctimeMs` e é conferido novamente antes de gravar a marca. O diagnóstico do legado não sugere `release`; o motivo exposto é sempre `(legado)`. Nenhuma liberação é anunciada quando nada saiu. A retomada automática funciona em Linux e macOS, inclusive sem `/usr/bin/flock`: candidatos exclusivos e tickets publicados por `rename` atômico serializam as retomadas, inclusive entre transportes diferentes; sob essa exclusão, o núcleo relê o conteúdo, confere dispositivo e inode e cria com `wx`. Ausência, bloqueio do spawn, timeout ou erro de `flock` usam o caminho portátil. Candidatos com PID morto são descartados; PID reutilizado ou sem permissão de consulta continua como vivo e pode exigir inspeção humana, sem expiração que remova um candidato vivo. `nlink === 0` é `lease.busy`, com fila normal e preservação do vencedor. Hard link ou link simbólico recebem `lease.resume-unavailable`, com escalada humana e sem retry automático. Após avaliar a posse, a correção explícita é `ork lease release <nome> --forcar`, seguida de nova aquisição. Contenção normal do `flock` ou dos tickets continua como `lease.busy`.
- **Critérios de aceite e testes:** Dado um lease tomado, quando outra thread pede o mesmo, então ela entra na fila (`core/test/leases-b2.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** leases em `.orkastery/leases/` da raiz do projeto, com a fila por colisão em `fila.json`.
- **APIs:** Não aplicável.
- **Eventos:** `lease_acquired`, `lease_released`, `worktree_created`.

## Operação e controle

- **Rollback:** `ork worktree release <thread>` remove a worktree e limpa o registro.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-10-03 | BR-007-02: leases e fila no estado canônico; legado validado na janela de 30 minutos, sem importar fila legada | Agentes Claude e Codex, revisão pendente | RM-036, thread `ork-rm036leasesd` |
