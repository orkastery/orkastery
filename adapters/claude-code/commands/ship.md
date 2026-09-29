---
description: "Entrega a thread pelo `ork ship`: merge serializado e push provado."
argument-hint: "<thread-id> [--para <branch>]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /ship

Fase SHIP (F5): merge serializado por lease, atualizacao contra a base, push provado por comando e plano de rollback. Nada de `git push` na mao: push na mao nao e provado, e o guard do adaptador por projeto (`ork adapter install claude-code`) o bloqueia.

## O que este comando faz

1. Ressincroniza quando a base andou:

```bash
ork worktree sync <thread>
```

2. Ensaia a entrega inteira antes de tocar em qualquer coisa:

```bash
ork ship <thread> --para main --dry-run
```

3. Entrega, com a autorizacao registrada:

```bash
ork ship <thread> --para main --autorizar-push "<quem>"
```

4. Mostra a prova ao builder: `mergeSha`, `shaRemoto` e `pushVerificado` no ledger.

```bash
ork phase list <thread>
```

## Regras do adaptador

- **Zero regra de negocio aqui.** Este comando traduz intencao em chamada de `ork` e nada mais.
  Quem valida modo, monta prompt, decide gate e prova entrega e o nucleo.
- **A #TAG vem do pedido, nao de configuracao.** O modo sai de `ork modos --do-pedido`, que usa a
  mesma funcao do nucleo; sem tag vale o `conduction.default_mode` do manifesto. A validacao
  contra `conduction.allowed_modes` acontece dentro do `ork thread new`, nunca aqui.
- **Nada de escrever codigo de produto neste comando.** Quem escreve e a sessao que o `ork`
  despacha, com o prompt gravado e o sha no ledger.
