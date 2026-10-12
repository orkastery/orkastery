---
id: RM-063
tipo: roadmap
titulo: Fábrica que não para
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-12T13:11:47+00:00
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
    commit: null
    pr: null
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
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

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
| F7 Condutor autônomo dentro de autorização durável | `ork conducao autorizar --ate <data> --pode merge,registrar,master,despachar` grava a autorização do dono (como a X1.a); `ork conducao batida` é o passo determinístico que a varredura chama para avançar as threads dentro dela. A fase que precisa de LLM é despachada como sessão de background, nunca rodada por cron LLM | teste: autorização expirada recusa com motivo tipado |

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

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-12 | Julio |
| Documentação | Em revisão | — | 2026-10-12 | Julio |
| Código | Branch criada | — | 2026-10-12 | Julio |
| Testes | Em execução | — | 2026-10-12 | Julio |
| Deploy | Não implantado | — | 2026-10-12 | Julio |
| Exposição | Flag desligada | — | 2026-10-12 | Julio |
| Habilitação | Pendente | — | 2026-10-12 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor do maquina-b (núcleo e hosts) e VPS (mods, se o dono decidir); A: Julio; C: —; I: —.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** condutor do maquina-b (#Auto), merge pela X1.a até 18/10/2026; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** merge do PR da fatia 1 (F1, F2, F3) e, com ele na base, `ork fabrica batida instalar` no maquina-b (o crontab é do dono, autorizado uma vez); depois, a fatia 2 (F4, F5, F6). Responsável: condutor do maquina-b; prazo: 14/10/2026.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado com as frentes do núcleo, dos mods e dos hosts | Incidente do maquina-b de 03/10 a 12/10/2026 (P1 a P7) | Julio |
| 2026-10-12 | Fatia 1 no GO da thread `ork-rm062fabrica`: F1 (`ork fabrica batida` e o doctor que reprova sem batida), F2 ("sigo" só com sessão viva e o fecho lendo a fila do pulse) e F3 (prompt no ledger antes do adaptador e retry pelo sha256); F4 a F7, mods e hosts ficam para as fatias seguintes | Testes `core/test/rm062-batida.test.ts`, `rm062-superficies.test.ts` e `rm062-retry-prompt.test.ts`; decisões no ledger da thread | condutor do maquina-b (#Auto) |
| 2026-10-12 | Item renumerado de RM-062 para RM-063; a thread segue `ork-rm062fabrica` | A RM-062 "Repositório público sem dado privado" nasceu em paralelo (thread `ork-rm062privado`), sem reserva de nenhuma das duas, e já estava na `main` e na branch da versão 0.5.5; a renumeração desta, ainda sem merge, é a troca barata. Decisão no ledger da thread | condutor do maquina-b (#Auto) |
