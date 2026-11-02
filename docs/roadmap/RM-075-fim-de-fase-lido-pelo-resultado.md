---
id: RM-075
tipo: roadmap
titulo: "Fim de fase lido pelo resultado: sessão que termina sem pergunta não vira espera humana"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-02T13:06:31-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 7352012f
    pr: null
sdlc:
  thread: ork-rm075fimdefa
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-075: Fim de fase lido pelo resultado: sessão que termina sem pergunta não vira espera humana

> **Em uma frase:** uma sessão que termina o turno sem perguntar nada ao humano fecha como fase concluída, ou como GO sem mudança, e nunca como espera humana; a thread segue para o verify sem girar em GO nem parar esperando o dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz em `#Auto`. Hoje uma fase que terminou bem pode ser lida como espera humana, e a condução gira em GO sem verify ou para esperando o dono.
- **Evidências e fonte:** achados de uma rede de três VPS que conduz um roadmap em `#Auto`, observados no ork 0.5.6 e novamente na 0.6.4 entre 30/10 e 02/11/2026.
  - Sessões `claude-bg` de GO terminaram o turno com resumo final, commit feito e worktree limpa e saíram como `gate_blocked` / `human.pending`. Outra sessão com o mesmo tipo de final saiu como `fase_concluida`.
  - Na 0.6.2, a sessão em `working`/`idle` depois do Stop já fecha pela janela `OCIOSA_DEPOIS_DO_STOP_MS` (0.6.0). O estado nativo `blocked` com Stop ainda vai sempre para `esperaHumana()`, mesmo com a prova da fase presente (`core/src/session-watcher-claude.ts`).
  - Um GO sem commit também vira `human.pending` ("nenhum commit registrado"), em vez de seguir para a reavaliação do recibo.
  - O `parado-no-condutor` já devolve parte desses casos ao condutor, mas o ledger continua registrando `human.pending`.
  - No Codex, uma sessão terminou o turno com `task_complete` no rollout, CHECK aprovado e commit feito. O watcher perdeu o estado com `SESSION_STATE_SPLIT` e registrou `runtime.unavailable`, com `turnId` nulo e fonte "observação incompleta ou inválida".
  - A política de retry tratou esse resultado como falha do runtime, entrou no primeiro degrau da escada de recuperação e redespachou a mesma fase. A nova sessão continuou alterando a branch depois que a condução já tinha aberto o PR.
  - Em outro caso, a sessão registrou um pedido que só a condução podia cumprir e o resultado saiu como `conducao.acao-necessaria`. Esse resultado é correto e permanece.
- **Objetivo/OKR:** nenhuma espera humana falsa no ledger; o dono só é chamado quando a sessão perguntou algo de fato.
- **Hipótese:** se o fim de fase for classificado pelo resultado (Stop correlacionado, sem pergunta pendente, prova do núcleo), então as threads `#Auto` deixam de girar em GO e de parar à toa, porque a condução passa a receber `fase_concluida` ou "GO sem mudança" no lugar de `human.pending`.
- **Métrica principal / linha de base / meta / janela / fonte:** fração dos `human.pending` de fim de turno que tinham pergunta real ao humano. Linha de base: a medir nos ledgers locais. Meta: 100%. Janela: por release. Fonte: ledger (`gate_blocked`, `phase_result`) cruzado com a leitura de tela da sessão.
- **Métricas de proteção:** uma pergunta real ao humano continua virando pedido ao dono; nenhuma fase sem a prova do núcleo fecha como concluída; o Classic e o Agile Check não mudam.

## Escopo e validação

- **Incluído:**
  - no ramo `blocked` do sensor do `claude-bg`, com a prova da fase presente, sem pausa planejada no fim do bloco, sem `sessao_bloqueada` aberta e sem pergunta real na tela, classificar como `fase_concluida`;
  - GO concluído sem commit e com HEAD igual vira um resultado tipado de "GO sem mudança", que vai direto à reavaliação do recibo ([RM-078](RM-078-recibo-valido-enquanto-nada-muda.md)), com a prova "nenhum commit" para o verify decidir;
  - no Codex, `task_complete` no rollout fixado da sessão despachada fecha a fase pelo resultado mesmo quando o watcher perdeu o estado; sem `task_complete`, a indisponibilidade continua tipada;
  - pedido à condução registrado pela sessão prevalece sobre o fechamento genérico;
  - a política de retry não redespacha uma fase que o `task_complete` classificou como `fase_concluida`; quando o mesmo terminal carrega falha estruturada de runtime, a política tipada de recuperação permanece;
  - `human.pending` só quando a mensagem final pergunta algo ao humano.
- **Fora de escopo:** mudar a janela do Claude Code para marcar a sessão como encerrada; alterar o contrato de recibo da [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) ou a política de claims da [RM-079](RM-079-claims-que-a-correcao-passa.md).
- **Entregáveis e critérios de aceite:**
  - GO que termina sem pergunta ao humano fecha como `fase_concluida`, com ou sem commit, na mesma janela de ociosidade depois do Stop que já vale para `working`/`idle`;
  - um caso de teste por combinação de estado nativo (`blocked`, `working`, `done`) com e sem pergunta real;
  - Codex com `task_complete` e estado dividido fecha; sem `task_complete`, o pedido à condução permanece tipado;
  - retry com `task_complete` concluído é recusado e deixa a razão no ledger; `task_complete` com erro estruturado conserva a política da falha;
  - um mutante por regra morre.
- **Piloto, medição e critérios de expansão/interrupção:** a bancada da condução compara rodadas equivalentes com e sem a fatia e publica apenas a razão; qualquer pergunta real perdida ou redespacho depois de `task_complete` concluído interrompe a expansão.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 1ª da fila de achados de condução em rede (31/10/2026). Crítica: um fim de fase mal lido para a autonomia inteira da thread.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono; candidato à primeira versão depois da RM-074.
- **Dependências e bloqueios (ID, owner, próxima revisão):** nenhuma. Conversa com a [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) no caso do GO sem commit.
- **Premissas / riscos / mitigação:** a leitura de tela pode ficar indisponível; essa indisponibilidade não prova pergunta nem cria `human.pending`, que exige pergunta efetivamente lida. O Codex só aceita `task_complete` do descritor associado à fixação autenticada do controller.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Estender a janela de ociosidade ao estado `blocked`/`idle`: simples, mas ainda depende do tempo.
  2. Classificar pelo resultado (recomendada): depende só de fatos do núcleo e da tela.
  3. Ler o terminal Codex apenas da fixação autenticada: evita descobrir outro rollout quando o estado está dividido.
  4. Reconfirmar `task_complete` no plano e na execução do retry: impede a corrida entre a leitura do gate e o redespacho.
  5. Aplicar a guarda de retry ao resultado `fase_concluida`, não ao erro estruturado transportado por `task_complete`: preserva a recuperação tipada de cota, autenticação e modelo. Decisão `#Auto` registrada após o primeiro verify apontar regressões de cota e checkpoint.

- **Andamento da thread:** a matriz `blocked`/`working`/`done`, o resultado `go.sem-mudanca`, a leitura autenticada de `task_complete`, a precedência do pedido à condução e a guarda do retry estão implementados na branch.

- **Prova focada:** os casos RM-075 do sensor Claude e do controller Codex passam no sandbox; build, mutantes e verify oficial fecham o CHECK.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-02 | Julio |
| Documentação | Em revisão | — | 2026-11-02 | Julio |
| Código | Branch criada | commit `7352012f` | 2026-11-02 | Julio |
| Testes | Em execução | — | 2026-11-02 | Julio |
| Deploy | Não implantado | — | 2026-11-02 | Julio |
| Exposição | Flag desligada | — | 2026-11-02 | Julio |
| Habilitação | Pendente | — | 2026-11-02 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
| 2026-11-02 | Codex incluído no escopo e implementação iniciada | `task_complete` foi perdido sob `SESSION_STATE_SPLIT` e a escada redespachou a fase concluída | Condução `#Auto`, decisão registrada na thread |
