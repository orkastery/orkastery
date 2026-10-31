---
id: RM-080
tipo: roadmap
titulo: Saída completa e causa tipada em todo comando do verify
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-31T12:00:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Não iniciado
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: null
  modo: null
---

# RM-080: Saída completa e causa tipada em todo comando do verify

> **Em uma frase:** todo comando do verify grava a saída inteira em arquivo, o ledger guarda o fim da saída e onde está o log completo, e saída grande demais aparece com causa própria, nunca como morto por sinal.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem corrige uma falha de verify e só vê o fim da saída, ou vê "morto por sinal" quando o comando apenas escreveu demais.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Na 0.5.6, `make test` saiu como `MORTO POR SINAL (codigo -1)` em todos os verifies de uma thread: o `spawnSync` sem `maxBuffer` matou o filho ao passar de 1 MiB (`ENOBUFS`).
  - A 0.6.0 subiu o buffer do `exec` para 64 MiB ([RM-037](RM-037-verify-rapido-e-confiavel.md)), e o grupo paralelo do Agile Check já grava a saída em arquivo.
  - Na 0.6.2 ainda:
    - `causaDoEncerramento` (`core/src/verify.ts`) não conhece `ENOBUFS`, que continua virando `sinal`;
    - o erro não vai ao ledger;
    - o trecho guardado tem só o fim da saída;
    - o Classic, o preparo, as claims, o `fix` e o `ci` seguem no `exec` com buffer;
    - o sandbox do MCP corta em 1 MiB;
    - o log completo do Agile é apagado no fim.
- **Objetivo/OKR:** a causa de todo encerramento é a verdadeira, e quem corrige tem a saída inteira.
- **Hipótese:** se todo comando gravar a saída em arquivo e a causa for tipada, então o GO-FIX deixa de corrigir às cegas e o verify deixa de reprovar por um limite do próprio núcleo.
- **Métrica principal / linha de base / meta / janela / fonte:** encerramentos classificados como `sinal` sem sinal de fato. Linha de base: a medir. Meta: zero. Janela: por release. Fonte: `verify_run`.
- **Métricas de proteção:** a redação de segredos vale para o log inteiro; o tamanho do estado da thread tem teto e limpeza.

## Escopo e validação

- **Incluído:**
  - `ENOBUFS` vira causa própria (por exemplo `saida-excedida`), conferida antes do ramo de sinal, e o erro vai ao `comandoNoLedger`;
  - o `executar` grava stdout e stderr em arquivo, como o grupo paralelo já faz;
  - o log completo redigido fica na pasta de estado da thread, com caminho e sha256 no ledger;
  - o sandbox do MCP usa a mesma causa.
- **Fora de escopo:** compressão ou envio do log para fora da máquina.
- **Entregáveis e critérios de aceite:**
  - um comando que escreve 5 MiB termina com o próprio código de saída;
  - o ledger mostra a causa certa e onde está a saída inteira;
  - um comando acima do teto aparece como `saida-excedida`, nunca como `sinal`;
  - um mutante por regra morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas suítes com saída grande.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 6ª da fila de achados de condução em rede (31/10/2026). Média: a 0.6.0 já tirou o caso mais comum; falta a causa e o log.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-037](RM-037-verify-rapido-e-confiavel.md) (a questão aberta de sinal × saída) e o grupo paralelo da [RM-072](RM-072-check-cinco-vezes-mais-rapido.md).
- **Premissas / riscos / mitigação:** disco cheio com logs grandes; mitigação: teto por thread e limpeza no MASTER.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Só subir o buffer: já feito na 0.6.0, não resolve a causa nem o log.
  2. Saída em arquivo e causa tipada (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-31 | Julio |
| Documentação | Rascunho | — | 2026-10-31 | Julio |
| Código | Não iniciado | — | 2026-10-31 | Julio |
| Testes | Não iniciados | — | 2026-10-31 | Julio |
| Deploy | Não implantado | — | 2026-10-31 | Julio |
| Exposição | Flag desligada | — | 2026-10-31 | Julio |
| Habilitação | Pendente | — | 2026-10-31 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
