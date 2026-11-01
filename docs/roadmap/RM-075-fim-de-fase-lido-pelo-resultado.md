---
id: RM-075
tipo: roadmap
titulo: "Fim de fase lido pelo resultado: sessão que termina sem pergunta não vira espera humana"
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

# RM-075: Fim de fase lido pelo resultado: sessão que termina sem pergunta não vira espera humana

> **Em uma frase:** uma sessão que termina o turno sem perguntar nada ao humano fecha como fase concluída, ou como GO sem mudança, e nunca como espera humana; a thread segue para o verify sem girar em GO nem parar esperando o dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz em `#Auto`. Hoje uma fase que terminou bem pode ser lida como espera humana, e a condução gira em GO sem verify ou para esperando o dono.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Sessões `claude-bg` de GO terminaram o turno com resumo final, commit feito e worktree limpa e saíram como `gate_blocked` / `human.pending`. Outra sessão com o mesmo tipo de final saiu como `fase_concluida`.
  - Na 0.6.2, a sessão em `working`/`idle` depois do Stop já fecha pela janela `OCIOSA_DEPOIS_DO_STOP_MS` (0.6.0). O estado nativo `blocked` com Stop ainda vai sempre para `esperaHumana()`, mesmo com a prova da fase presente (`core/src/session-watcher-claude.ts`).
  - Um GO sem commit também vira `human.pending` ("nenhum commit registrado"), em vez de seguir para a reavaliação do recibo.
  - O `parado-no-condutor` já devolve parte desses casos ao condutor, mas o ledger continua registrando `human.pending`.
- **Objetivo/OKR:** nenhuma espera humana falsa no ledger; o dono só é chamado quando a sessão perguntou algo de fato.
- **Hipótese:** se o fim de fase for classificado pelo resultado (Stop correlacionado, sem pergunta pendente, prova do núcleo), então as threads `#Auto` deixam de girar em GO e de parar à toa, porque a condução passa a receber `fase_concluida` ou "GO sem mudança" no lugar de `human.pending`.
- **Métrica principal / linha de base / meta / janela / fonte:** fração dos `human.pending` de fim de turno que tinham pergunta real ao humano. Linha de base: a medir nos ledgers locais. Meta: 100%. Janela: por release. Fonte: ledger (`gate_blocked`, `phase_result`) cruzado com a leitura de tela da sessão.
- **Métricas de proteção:** uma pergunta real ao humano continua virando pedido ao dono; nenhuma fase sem a prova do núcleo fecha como concluída; o Classic e o Agile Check não mudam.

## Escopo e validação

- **Incluído:**
  - no ramo `blocked` do sensor do `claude-bg`, com a prova da fase presente, sem pausa planejada no fim do bloco, sem `sessao_bloqueada` aberta e sem pergunta real na tela, classificar como `fase_concluida`;
  - GO concluído sem commit e com HEAD igual vira um resultado tipado de "GO sem mudança", que vai direto à reavaliação do recibo ([RM-078](RM-078-recibo-valido-enquanto-nada-muda.md)), com a prova "nenhum commit" para o verify decidir;
  - `human.pending` só quando a mensagem final pergunta algo ao humano.
- **Fora de escopo:** mudar a janela do Claude Code para marcar a sessão como encerrada; o runtime `codex`, que já fecha pelo `task_complete` do rollout.
- **Entregáveis e critérios de aceite:**
  - GO que termina sem pergunta ao humano fecha como `fase_concluida`, com ou sem commit, na mesma janela de ociosidade depois do Stop que já vale para `working`/`idle`;
  - um caso de teste por combinação de estado nativo (`blocked`, `working`, `done`) com e sem pergunta real;
  - mutante que devolve o ramo `blocked` para `esperaHumana()` morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads `#Auto` da VPS por uma semana, contando os `human.pending` de fim de turno com e sem pergunta real.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 1ª da fila de achados de condução em rede (31/10/2026). Crítica: um fim de fase mal lido para a autonomia inteira da thread.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono; candidato à primeira versão depois da RM-074.
- **Dependências e bloqueios (ID, owner, próxima revisão):** nenhuma. Conversa com a [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) no caso do GO sem commit.
- **Premissas / riscos / mitigação:** a leitura de tela pode errar uma pergunta; na dúvida, vale `human.pending`, como hoje.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Estender a janela de ociosidade ao estado `blocked`/`idle`: simples, mas ainda depende do tempo.
  2. Classificar pelo resultado (recomendada): depende só de fatos do núcleo e da tela.

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
