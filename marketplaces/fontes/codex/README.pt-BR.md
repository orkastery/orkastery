# Orkastery para o Codex

![Orkastery](../../../docs/assets/marca/png/assinatura-com-fundo-1200.png)

[English](README.md) · **Português**

> Uma fábrica de software de agentes de IA que prova o próprio trabalho: threads em paralelo, resultado verificado e decisão curta só quando importa.

Este plugin leva ao Codex, como skills, o ciclo de condução do Orkastery. Cada tarefa vira uma thread com seis fases (GOAL, PLAN, GO, CHECK, SHIP, MASTER), conduzida pelo CLI `ork` local em uma worktree própria do git. Uma alegação só vale depois que o `ork verify` reexecuta o comando dela no HEAD real, e uma pergunta só chega a você quando a decisão é mesmo sua, com as alternativas e uma recomendada.

## O que o plugin traz

| Componente | O que é |
| --- | --- |
| A skill de entrada `ork` | Reconhece `orkastery maestro`, lê o estado do projeto pelo CLI e apresenta progresso, decisões e entrega na conversa |
| 20 skills do catálogo | Roteadores finos para o CLI `ork`: as skills de fase, as de governança (triagem de decisão, guardião da narrativa, guardião do roadmap, checagem de escopo), estado e rastro da thread, quatro revisores do CHECK e o pacote de experiência de orquestração em inglês e pt-BR |
| 5 checklists | As referências que os revisores aplicam: eixos de code review, segurança, padrões de teste, performance e definição de pronto |

A metodologia mora no CLI, não no plugin. Quando uma skill e o CLI divergem, vale o CLI.

## O que ele precisa

1. Node 20 ou mais novo e `git`.
2. O CLI, pelo npm: `npm install -g @orkastery/cli` e depois `ork doctor`.
3. No seu repositório, com pelo menos um commit: `ork init` e depois `ork mcp install --project "$PWD" --host codex`. Esse segundo comando grava o servidor MCP `orkastery` em `.codex/config.toml` no projeto; a skill de entrada chama as ferramentas dele.

Sem o CLI, as skills não têm para onde rotear.

## Instalação

```bash
codex plugin marketplace add orkastery/orkastery
codex plugin add orkastery@orkastery
```

Depois abra uma sessão nova do Codex no seu repositório e diga `orkastery maestro`.

## O que ele executa, envia e guarda

- O plugin só leva Markdown e imagens: skills e checklists. Não tem hook, não tem servidor MCP próprio, não tem script e não faz requisição de rede.
- As instruções pedem ao Codex que rode o CLI `ork` local e que chame as ferramentas MCP `orkastery` que o `ork mcp install` configurou no seu projeto. Os dois rodam na sua máquina, dentro do sandbox que você configurou para o Codex.
- O CLI `ork` guarda o estado em arquivos sob `.orkastery/` no seu repositório. Não roda serviço hospedado, não abre porta de rede e não chama API de modelo; enquanto uma fase roda, pode manter processos auxiliares locais daquela sessão, como o observador de sessão. Acesso à rede só acontece pelos programas que você já usa e configura, como o remoto do git quando uma thread é entregue.
- Instalar skills não concede permissão: gates e preflight continuam no CLI. O `ork adapter install codex` é o outro caminho de instalação, com as mesmas skills copiadas para dentro do projeto.

## Idioma

As skills e a saída do CLI estão em português do Brasil hoje.

## Links

- Código e issues: [github.com/orkastery/orkastery](https://github.com/orkastery/orkastery)
- Documentação: [orkastery.com](https://orkastery.com/)
- Privacidade: [PRIVACY.md](https://github.com/orkastery/orkastery/blob/main/marketplaces/PRIVACY.md)
- Relato de segurança: [SECURITY.md](https://github.com/orkastery/orkastery/blob/main/SECURITY.md)
- Licença: MIT
