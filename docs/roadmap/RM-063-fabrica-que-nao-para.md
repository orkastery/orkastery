---
id: RM-063
tipo: roadmap
titulo: Fábrica que não para
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: adc973d
    pr: 144
  deploy:
    release: v0.6.0 (F4, F6, F7 e H1 a H4), @orkastery/cli no npm
sdlc:
  thread: ork-rm062fabrica
  modo: auto
  fase: GO
  status: aberta
---

# RM-063 — Fábrica que não para

> **Em uma frase:** nenhuma máquina da fábrica fica parada sem que o dono saiba em até 30 minutos, e nenhum bloqueio de infraestrutura ou de condução para a fábrica: o ork se recupera sozinho e só sobe ao dono o que é ato dele.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Produção | Parcial |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 12/10/2026:** "Você não pode deixar a máquina parada sem me avisar. Uma AI Factory não pode ficar parada, assim como qualquer fábrica não deveria ficar parada." O pedido vale para o avanço imediato do roadmap nesta máquina e para o núcleo do Orkastery, os mods do Claude Code e os adaptadores Hermes e OpenClaw.

## Problema e resultado

- **Público e problema/oportunidade:** o dono de uma fábrica #Auto. Hoje, uma máquina pode ficar dias sem batida e horas com uma fase morta, e as superfícies dizem "Nada agora" e "sigo na fase GO".
- **Evidências e fonte:** o incidente do maquina-b, de 03/10 a 12/10/2026 (tabela abaixo).
- **Objetivo/OKR:** tempo de máquina parada sem aviso igual a zero; tempo de fábrica parada por falha de infraestrutura abaixo de 30 minutos.
- **Hipótese:** se a batida for instalada e vigiada pelo próprio ork, se a falha de despacho virar retry automático com o prompt gravado e se as superfícies só disserem "sigo" quando há sessão viva, então nenhuma parada passa despercebida, porque cada camada que hoje falha em silêncio passa a ter dono, prazo e canal.
- **Métrica principal / linha de base / meta / janela / fonte:** minutos entre a parada (última sessão viva ou última batida) e o aviso ao dono. Linha de base: 13.300 min (03/10 08:52 a 12/10 06:00, sem batida) e 318 min (K7 com o despacho morto). Meta: ≤ 30 min. Janela: 14 dias. Fonte: `ork ledger stats` e o `hitl.log` da varredura.
- **Métricas de proteção:** nenhuma mensagem por item no canal do dono (o teto de um resumo por varredura continua); nenhum redespacho que mude o prompt; nenhum merge, tag ou publicação fora do que o dono autorizou.

### O incidente de 03/10 a 12/10/2026 no maquina-b

| # | O que parou | Por que ninguém viu | Camada |
| --- | --- | --- | --- |
| P1 | A máquina ficou sem batida de 03/10 08:52 a 12/10 | O cron do pulse nunca foi instalado. O `ork doctor` só confere o crontab quando `pulse-host.json` existe, e sem transporte ele cala | núcleo |
| P2 | O despacho do GO da K7 morreu na saída ("runtime adapter indisponível"), com o daemon do claude-bg (`cc-daemon`) fora do ar | O `ork roadmap status` disse "Precisa de você: nada agora" e "sigo ork-rm026k7conhe na fase GO", enquanto o `ork pulse` contava 3 itens que precisavam do dono | núcleo, mods |
| P3 | O `ork retry run` não redespachou | O plano disse "reexecutar, automática", mas a execução saiu com "não há despacho falho registrado em GO com prompt gravado" | núcleo |
| P4 | O PR #112 (`ork-rm043sobrasd`) foi mesclado em 10/10 e ficou dois dias sem `ship registrar-pr` | Só o `ork pulse` mostrava ("parado no condutor"); nenhum canal avisou | núcleo |
| P5 | Sessões fantasmas de threads já fechadas (`ork-rm053network`, `ork-rm054fatia2`) ficaram registradas | Ninguém roda `ork sessions limpar-fantasmas` sem um condutor | núcleo |
| P6 | O condutor era uma sessão interativa: acabou a conversa, acabou a condução | Não existe condutor que retome sozinho dentro das autorizações duráveis do dono (X1.a) | núcleo, hosts |
| P7 | A correção da batida (instalar o cron) foi barrada pelo modo automático do Claude Code como persistência não autorizada | Não existe comando do ork que o dono autorize uma vez e que instale a batida de forma auditável | núcleo, mods |

## Escopo e validação

- **Incluído:** as frentes F1 a F7 abaixo, com fatias por camada.
- **Fora de escopo:** planejar arcos autônomos de muitas threads, que é a [RM-058](RM-058-modo-noctum.md) (#Noctum). A RM-063 é a condição dela: o #Noctum planeja o arco, e a RM-063 garante que a máquina segue viva dentro dele. Também ficam fora a decisão de merge, tag e publicação, que segue com o dono ou com a autorização durável que ele der.

### Frentes no núcleo (`ork`)

| Frente | O que muda | Prova |
| --- | --- | --- |
| F1 Batida instalada e vigiada | `ork fabrica batida instalar\|status\|remover`: instala o cron (ou o timer do systemd) da varredura de forma idempotente, com o transporte do dono, e grava `batida_instalada` no ledger da máquina. O `ork doctor` reprova (não só avisa) quando há thread aberta e nenhuma batida, com ou sem `pulse-host.json` | teste com crontab falso: sem a linha, `doctor` sai ≠ 0 e o `roadmap status` mostra a parada |
| F2 Superfícies honestas | O `ork roadmap status` e o `ork fabrica` só dizem "sigo X na fase Y" quando há sessão viva verificada no runtime. Sem ela, a linha vira "X parada desde HH:MM: motivo" e entra em "O que precisa de você" quando o próximo passo é do dono. O fecho consome a mesma fila do `ork pulse`, para as duas superfícies nunca divergirem | teste: sessão fantasma em GO não produz "sigo" |
| F3 Retry que sempre tem o prompt | O `ork phase run` grava o prompt e o sha256 antes de chamar o adaptador; a falha de despacho (`runtime.unavailable`) fica registrada com eles, e o `ork retry run` redespacha sem pedir o texto de novo | teste: adaptador falso que falha no despacho; `retry run` redespacha com o mesmo sha256 |
| F4 Escada de recuperação do runtime | `runtime.unavailable` tenta, em ordem: reerguer o daemon do runtime, o fallback do bloco (`--fallback`, I-33), outro perfil (RM-056). Só depois de 3 tentativas sobe ao dono, com alternativas e recomendação (RM-057) | teste por degrau, com runtimes falsos |
| F5 Varredura que age | Na batida, com autorização durável gravada: limpar fantasmas, registrar entrega de PR já mesclado (`ship registrar-pr`) e fechar pelo MASTER por omissão. Sem autorização, cada um vira um item da fila, com o comando pronto | teste: merge de branch `ork/*` na main sem `ship_done` aparece na batida seguinte |
| F6 Ociosidade é alerta | Máquina com vaga livre (abaixo de `concurrency.max_parallel_threads`, 5 pela decisão P1.a) e fila de trabalho do roadmap reservada para ela gera o alerta "máquina ociosa" ao dono, com as próximas threads sugeridas | teste: 0 sessões vivas e reserva aberta geram o alerta |
| F7 Condutor autônomo dentro de autorização durável | `ork conducao autorizar --ate <data> --pode merge,registrar,master,despachar` grava a autorização do dono (como a X1.a); `ork conducao batida` é o passo determinístico que a varredura chama para avançar as threads dentro dela: merge do PR verde e limpo, registro, MASTER por omissão e o despacho com o prompt gravado. A fase que precisa de LLM é despachada como sessão de background, nunca rodada por cron LLM. O merge da main na branch da thread devolve os itens dela a "## Não publicado" do CHANGELOG | teste: autorização expirada recusa com motivo tipado; `gh`, remoto e runtime falsos |

### Frentes nos mods do Claude Code (família da [RM-059](RM-059-conducao-dentro-do-claude-code.md), conduzida pela VPS)

Proposta para a VPS incluir na RM-059 ou conduzir aqui, o que o dono decidir:

- **M1 Sentinela de sessão (`ork-sentinela`):** nos hooks `SessionEnd` e `StopFailure` das sessões despachadas, grava `sessao_morta` ou `despacho_falho` na hora e pede o redespacho pelo F3, sem esperar os 10 minutos de silêncio do pulse.
- **M2 Daemon vigiado:** quando o `cc-daemon` some (o `control.sock` não responde), o mod avisa o ork, que aciona o F4 antes de a fase seguinte tentar o despacho.
- **M3 Clima de Cota com redespacho:** o `ork-clima` já prevê o fim da cota; com a janela nova, ele aciona o `ork retry resume` em vez de só avisar.
- **M4 Abertura com a fábrica parada:** a sessão interativa do Claude Code aberta num projeto com a fábrica parada mostra, na primeira resposta, o que está parado e o comando que retoma.
- **M5 Batida autorizada uma vez:** o F1 instalado pelo mod pede a aprovação do dono pela permissão do Claude Code uma vez, com a regra gravada nas configurações, em vez de o condutor editar o crontab por fora.

### Frentes nos hosts (Hermes e OpenClaw)

- **H1 Batida do host como segunda linha:** o heartbeat do OpenClaw (a cada 30 min) e o do Hermes rodam o `ork doctor --json` de forma determinística e mandam ao dono a parada da fábrica quando a batida do ork passou de 30 minutos. Nunca como cron LLM com `deliver=origin`.
- **H2 Comando de retomada no canal:** `#OrkRetomar` no Telegram roda o F4 e o F5 e responde com o que voltou a andar; `#OrkFabrica` responde com o `ork fabrica` da rede.
- **H3 Paridade de transporte:** o adaptador Hermes ganha o mesmo `pulse-host.json` pronto do OpenClaw, e o `ork onboarding` grava o transporte junto com o canal do dono, para a máquina nunca ficar sem `pulse-host.json`.
- **H4 Falha do transporte também avisa:** quando o `openclaw message send` falha, a varredura tenta o outro host configurado e grava a falha no `ork doctor`.

- **Entregáveis e critérios de aceite:** cada frente acima, com a prova da tabela; o critério do item é o ensaio de parada: matar o daemon do runtime no meio de um GO e confirmar que o dono recebe o aviso e a fase volta a andar em até 30 minutos, sem intervenção.
- **Piloto, medição e critérios de expansão/interrupção:** 14 dias no maquina-b e na VPS; interrompe se o canal do dono receber mais de um resumo por varredura.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** P0 por pedido do dono de 12/10/2026; a fábrica parada custa todo o resto do roadmap.
- **Horizonte / alvo / previsão / confiança / marcos:** fatia 1 (F1, F2, F3) nesta semana; fatia 2 (F4, F5, F6); fatia 3 (F7 e H1 a H4); os mods M1 a M5 seguem a decisão do dono sobre quem conduz.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-056 (perfis e rodízio, F4); RM-057 (alternativas, F4); RM-059 (mods, VPS); RM-053 (`ork network entrar`, ato do dono, para a batida aparecer na rede).
- **Premissas / riscos / mitigação:** risco de o condutor autônomo passar do que o dono autorizou; mitigação: F7 recusa sem autorização gravada e com prazo, e merge, tag e publicação nunca entram por omissão.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** pedido do dono de 12/10/2026 (esta página).

## Estado com evidências

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): a fatia 2 (F4, a escada de recuperação do runtime; F6, a máquina ociosa; e a varredura que age) e a fatia 3 (F7, o condutor autônomo na autorização durável, e os hosts H1 a H4); a fatia 1 já estava no código da `v0.5.6`. Os mods M1 a M5 seguem.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `adc973d` · PR #144 | 2026-10-27 | Julio |
| Testes | Em execução | — | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0 (F4, F6, F7 e H1 a H4), @orkastery/cli no npm | 2026-10-27 | Julio |
| Exposição | Parcial | — | 2026-10-27 | Julio |
| Habilitação | Em andamento | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor do maquina-b (núcleo e hosts) e VPS (mods, se o dono decidir); A: Julio; C: —; I: —.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** condutor do maquina-b (#Auto), merge pela X1.a até 18/10/2026; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a fatia 3 (F7 e os hosts H1 a H4) já está na `main` e na versão 0.6.0; a thread `ork-rm062fabrica` segue aberta no `sdlc` desta página, com o `ork ship registrar-pr` e o MASTER dela; depois, atos do dono nesta máquina: a autorização durável pelo `ork conducao autorizar --ate <data> --pode merge,registrar,master,despachar`, o canal do dono pelo onboarding (`ork onboarding set maestro` com o `canal`) e a automação de 30 min do OpenClaw (ou o agendador do Hermes) com o `bin/ork-vigia-batida`. Os mods M1 a M5 seguem a decisão do dono sobre quem conduz. Responsável: condutor do maquina-b; prazo: 15/10/2026.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado com as frentes do núcleo, dos mods e dos hosts | Incidente do maquina-b de 03/10 a 12/10/2026 (P1 a P7) | Julio |
| 2026-10-12 | Fatia 1 no GO da thread `ork-rm062fabrica`: F1 (`ork fabrica batida` e o doctor que reprova sem batida), F2 ("sigo" só com sessão viva e o fecho lendo a fila do pulse) e F3 (prompt no ledger antes do adaptador e retry pelo sha256); F4 a F7, mods e hosts ficam para as fatias seguintes | Testes `core/test/rm062-batida.test.ts`, `rm062-superficies.test.ts` e `rm062-retry-prompt.test.ts`; decisões no ledger da thread | condutor do maquina-b (#Auto) |
| 2026-10-12 | Fatia 2 no GO da thread `ork-rm062fabrica`: F4 (a escada de recuperação do runtime no `ork retry run`: reerguer o daemon pelo `claude daemon status` e `stop`, o fallback do bloco, outro perfil, e o dono só depois dos três, com alternativas da RM-057), F5 (a varredura que age com a autorização durável `ork.autorizacao-duravel/v1`: limpar fantasmas, registrar a entrega do PR mesclado e o MASTER por omissão; sem ela, item da fila com o comando) e F6 (o alerta de máquina ociosa, uma vez por episódio); o mod `ork-sentinela` herda a F4 pelo `ork retry plan` e `retry run`, sem mudança nele | Testes `core/test/rm063-escada.test.ts`, `rm063-varredura.test.ts` e `rm063-ociosa.test.ts`; contrato em `docs/referencia/contratos/autorizacao-duravel-rm063.md`; decisões no ledger da thread | condutor do maquina-b (#Auto) |
| 2026-10-12 | Fatia 2, GO-FIX da revisão independente (14 achados): a escada não abre segunda sessão na worktree (a falha do redespacho guarda a sessão, e há prova de vida entre os degraus), o degrau parado por motivo que não é do destino não é consumido, o adaptador que lança vira falha do destino, o runtime mudo reergue o daemon e chama o dono na terceira vez, e o degrau 3 não volta à conta que o degrau 1 usou; a varredura não registra nem fecha por cima de trabalho na thread (sessão viva, worktree suja, commit ou despacho depois do PR), age depois da entrega do resumo e sob trava, só solta a fantasma com 30 min sem sinal e não repete a mesma recusa; a autorização exige fuso e autoria humana | Testes novos em `core/test/rm063-escada.test.ts` e `rm063-varredura.test.ts`, cada um reprovado no código anterior (`e22de4b0`) | condutor do maquina-b (#Auto) |
| 2026-10-13 | Fatia 3 no GO da thread `ork-rm062fabrica`: F7 (`ork conducao autorizar` e `autorizacao`, que gravam e mostram a autorização durável; `ork conducao batida`, que mescla o PR de branch `ork/*` com os checks obrigatórios verdes e o PR limpo por `gh pr merge --match-head-commit`, registra a entrega, fecha pelo MASTER por omissão e despacha a fase seguinte com o pedido guardado, cedendo à Sentinela; a reconciliação do CHANGELOG no merge da main, por `ork conducao atualizar`), H1 a H4 (o `ork doctor --json` com a batida, o `bin/ork-vigia-batida` do OpenClaw e do Hermes, `#OrkRetomar` e `#OrkFabrica` pelo ingresso assinado, o `pulse-host.json` gravado pelo onboarding com o canal do dono e o transporte que tenta o outro host) e três achados do núcleo (sessão `busy` não é parada; nenhum projeto de pasta temporária no registro durável, com a suíte numa casa temporária; a sessão terminada no runtime solta o lease) | Testes `core/test/rm063-conducao-autorizar.test.ts`, `rm063-conducao-batida.test.ts`, `rm063-changelog-reconciliacao.test.ts`, `rm063-hosts-nucleo.test.ts`, `rm063-hosts-canal.test.ts`, `rm063-achado-busy.test.ts`, `rm063-achado-registro.test.ts` e `rm063-achado-lease.test.ts`, e os dos adaptadores; a reconciliação conferida contra os 25 merges reais mais recentes; decisões no ledger da thread | condutor do maquina-b (#Auto) |
| 2026-10-13 | Fatia 3, GO-FIX da revisão independente (11 achados confirmados, 1 bloqueante, e 2 plausíveis): o merge da batida exige o CHECK aprovado depois do último commit de produto do PR, não passa por cima da pendência do dono nem da branch local com trabalho que o PR não tem (a atualização não empurra esse trabalho); a autorização não vem de host de agente e vale até 31 dias; a reconciliação do CHANGELOG aborta em vez de perder linha da thread e não reescreve o que não é dela; o push da atualização não leva tag; o comando do merge dado ao dono põe o título entre aspas; a espera de mais de 2 h vira item do dono | Testes novos em `core/test/rm063-conducao-batida.test.ts`, `rm063-changelog-reconciliacao.test.ts`, `rm063-conducao-autorizar.test.ts`, `rm063-hosts-canal.test.ts` e `rm063-hosts-nucleo.test.ts`, cada um reprovado no código anterior (`17dc6785`) | condutor do maquina-b (#Auto) |
| 2026-10-13 | Fatia 3, prova ao vivo no projeto real e merge da `main` feito pelo próprio `ork conducao atualizar`: a batida confere o estado do PR antes da autorização, e o dono só recebe "pronto" do PR que está pronto (o PR sem CHECK chega como `check-pendente`); a sessão despachada que conduz a thread reentra no `ork conducao atualizar` pela identidade de despacho, como no `ork verify` | Testes novos em `core/test/rm063-conducao-batida.test.ts` e `rm063-changelog-reconciliacao.test.ts`, reprovados no código anterior (`faef452c` e `b829673b`) | condutor do maquina-b (#Auto) |
| 2026-10-12 | Item renumerado de RM-062 para RM-063; a thread segue `ork-rm062fabrica` | A RM-062 "Repositório público sem dado privado" nasceu em paralelo (thread `ork-rm062privado`), sem reserva de nenhuma das duas, e já estava na `main` e na branch da versão 0.5.5; a renumeração desta, ainda sem merge, é a troca barata. Decisão no ledger da thread | condutor do maquina-b (#Auto) |
| 2026-10-27 | Fatias 2 e 3 em produção na 0.6.0; exposição Parcial e habilitação Em andamento, porque os mods M1 a M5 seguem | Tag `v0.6.0`, com os merges `babe9d48` (#154) e `45ecc51a` (#163) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
