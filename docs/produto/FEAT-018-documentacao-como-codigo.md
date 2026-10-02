---
id: FEAT-018
tipo: feature
titulo: Documentação como código
estado: vigente
pai: MOD-05
roadmap: [RM-044]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/docs.ts
    - core/assets/docs/markdownlint-cli2.jsonc
  testes:
    - core/test/docs.test.ts
  docs:
    - docs/padroes/documentacao-de-produto.md
    - docs/padroes/roadmap-de-produto.md
  simbolos:
    - core/src/docs.ts#verificarDocs
    - core/src/docs.ts#sincronizarDocs
    - core/src/docs.ts#iniciarDocs
  comandos:
    - ork docs verificar
    - ork docs sincronizar
    - ork docs init
---

# FEAT-018 — Documentação como código

> **Em uma frase:** Documentação de produto e roadmap vivem no repositório em Markdown com frontmatter, e `ork docs verificar` reprova no CI quando a página diverge do código ou do git.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-044](../roadmap/RM-044-documentacao-como-codigo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** iniciar a estrutura num produto, verificar paridade, sincronizar fatos do ledger e do git.
- **Pré-condições e gatilho:** repositório git; `docs/produto` e `docs/roadmap` (criados por `ork docs init`).
- **Fluxo principal:**

  1. `ork docs init` instala padrões, modelos, índices e o lint de Markdown, sem sobrescrever.
  2. `ork docs verificar` cobra frontmatter, leitura para TDAH, referências, fontes, símbolos, contratos, comandos do CLI e commits na base.
  3. `ork docs sincronizar --escrever` grava só fatos (merge, fase) e regera tabelas e índices.

- **Alternativas, erros e recuperação:** sem `--escrever` o sincronizador só mostra; sem histórico do git a paridade com o git vira aviso.
- **Pós-condições:** páginas e índices atualizados; o CI reprova divergência em todo PR.
- **Regras de negócio:** BR-018-01: o sincronizador nunca muda ciclo, documentação, deploy, exposição ou habilitação. BR-018-02: `codigo: Mesclado` exige o commit na base. BR-018-03: o merge `ship(<thread>)` da thread do item na base exige `codigo: Mesclado` (`docs.paridade.merge`), e o índice de `docs/roadmap/README.md` e de `docs/produto/README.md` é o que o frontmatter gera (`docs.paridade.indice`); o que as duas regras acusam, o `ork docs sincronizar --escrever` corrige. No PR (`ork docs verificar --pr`), as duas só avisam, e o push da `main` reprova.
- **Critérios de aceite e testes:** Dado um item com `codigo: Mesclado` e commit fora da `main`, quando o verificador roda, então reprova com `docs.paridade.git` (`core/test/docs.test.ts`). Dado o merge `ship(<thread>)` na base com o item em "Branch criada", quando o verificador roda, então reprova com `docs.paridade.merge` e a correção `ork docs sincronizar --escrever --so RM-NNN` (`core/test/rm037-fatia3-estado-do-merge.test.ts`).
- **Interface e acessibilidade:** Saída de texto em tópicos curtos; `--json` com regras tipadas para agentes.

## Dados e contratos

- **Entidades:** frontmatter de página de produto e de item de roadmap (seção 4 de cada padrão).
- **APIs:** Não aplicável.
- **Jobs:** job `documentacao` do workflow `CI` (markdownlint e `ork docs verificar`).

## Operação e controle

- **Configuração:** `.markdownlint-cli2.jsonc` na raiz (forma do Markdown).
- **Observabilidade:** `ork docs verificar --json`.
- **Rollback:** reverter a página; o verificador aponta o que ficou divergente.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-10-01 | o verificador confere os dois sentidos do merge e o índice gerado | Claude (agente) / Julio, revisão pendente | RM-037 |
