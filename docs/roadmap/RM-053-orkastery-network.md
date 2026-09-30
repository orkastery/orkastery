---
id: RM-053
tipo: roadmap
titulo: Orkastery Network, as máquinas de uma pessoa em rede
categoria: iniciativa
pai: null
features: [FEAT-031]
owner: Julio
atualizado_em: 2026-09-30T00:01:00-03:00
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
  thread: ork-rm053network
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-053 — Orkastery Network, as máquinas de uma pessoa em rede

> **Em uma frase:** toda máquina em que uma pessoa entrou no Orkastery publica um retrato sem segredo num repositório privado dela na forja, e qualquer agente dela lê a rede inteira de qualquer diretório, com fonte e lacunas declaradas.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Feature:** [FEAT-031](../produto/FEAT-031-orkastery-network.md) · **Decisão:** [ADR-001](../conceitos/decisoes/ADR-001-estado-da-rede.md) · **Contratos:** [rede-rm053](../referencia/contratos/rede-rm053.md)
- **Thread:** `ork-rm053network` (fatia 1) · **Irmãs:** RM-052 (projeto-alvo) e RM-054 (roadmap da rede), em paralelo

## Problema e resultado

- **Público e problema:** a pessoa conduz o Orkastery em várias máquinas (hoje srvjcp86 e vps) e vários projetos. Fora do clone de um projeto, nenhum agente dela enxerga as outras máquinas.
- **Evidências e fonte:**
  - incidente de 29/09/2026 no Telegram: "orkastery maestro - qual é o status report do roadmap do orkastery agora?" voltou com o panorama de `~/.openclaw/workspace` e "outras máquinas: nenhuma publicou ainda", com 10 threads ativas na vps;
  - reproduzido só com leitura em 29/09: de `~/.openclaw/workspace`, `ork fabrica --sem-remoto` diz "Nenhuma maquina publicou ainda"; de `/tmp`, "manifesto orkastery.yaml nao encontrado"; só de dentro de `/home/julio/orkastery` aparecem srvjcp86 e vps;
  - causa que este item fecha: o estado das máquinas (RM-047) vive na branch `ork/fabrica-estado` do remoto de **um** repositório.
- **Objetivo:** a pessoa e os agentes dela respondem "quais máquinas eu tenho e o que cada uma tem" de qualquer diretório, sem confundir "não olhei" com "não existe".
- **Hipótese:** Se cada máquina publicar o próprio retrato num repositório privado da pessoa, e a leitura declarar a fonte e as lacunas, então qualquer agente dela responde sobre as máquinas de qualquer diretório, sem o falso "nenhuma publicou", porque a rede deixa de depender do clone e do cwd.
- **Métrica principal:** máquinas da pessoa visíveis de um diretório fora do clone. Linha de base: 0 de 2 (29/09, srvjcp86, `ork fabrica` de `~/.openclaw/workspace`). Meta: 2 de 2 com `ork network status --json` do mesmo diretório. Janela: a primeira semana depois do merge e do `ork network entrar` numa máquina. Fonte: a saída do comando.
- **Métricas de proteção:** zero segredo na casa da rede (varredura de todos os blobs em todo PR); zero escrita no retrato de outra máquina; a fábrica da RM-047 inalterada.

## Escopo e validação

- **Incluído na fatia 1 (esta thread):**
  - [ADR-001](../conceitos/decisoes/ADR-001-estado-da-rede.md): a rede mora num repositório privado por pessoa, `<usuario>/orkastery-network`;
  - `ork network entrar`, `ork network status`, `ork network publicar` e `ork network sair`, de qualquer diretório;
  - GitHub pelo `gh` e GitLab pelo `glab`, atrás da mesma interface, com a identidade da CLI já autenticada;
  - migração: quem fez `ork fabrica entrar` é membro sem refazer, e `ork/fabrica-estado` continua lida;
  - segurança: lista de permissão, varredura de segredo antes do push, repositório privado exigido, cada máquina só no próprio retrato (nome e identidade da instalação) e o git da rede isolado do ambiente;
  - a batida do pulse e os eventos de thread publicam o retrato.
- **Fora de escopo:**
  - registro de projetos e `--projeto` (RM-052): aqui só um adaptador de leitura de `~/.orkastery/projetos.json`;
  - `ork network roadmap`, leitura sem clone de roadmap e reservas, e as tools nos hosts (RM-054);
  - a rede de equipe (RM-026) e as credenciais, que continuam locais (RM-040);
  - publicar no npm (ato do mantenedor) e criar o repositório real na conta do dono (ato do dono).
- **Entregáveis e critérios de aceite:**

| Critério | Como se prova |
| --- | --- |
| Casa decidida com as três opções comparadas | ADR-001 |
| Entrar, ler, publicar e sair com duas máquinas, fora de clone | `RM-053 ciclo` em `core/test/rede.test.ts` |
| Lacuna tipada no lugar de lista vazia calada | `RM-053 honestidade` |
| Adesão herdada da fábrica e leitura da fábrica legada | `RM-053 migracao`, inclusive a batida real do pulse |
| Nenhum token, credencial, caminho de credencial ou conta paga em nenhum blob da casa | `RM-053 segredo` |
| Cada máquina só escreve o próprio retrato; retrato forjado vira lacuna | `RM-053 autoria` |
| Repositório público recusado; GitLab pela mesma interface | `RM-053 forja` |
| Projetos da RM-052 lidos por adaptador tolerante | `RM-053 projetos` |

- **Piloto, medição e critérios de expansão/interrupção:**
  - piloto: depois do merge, o dono roda `ork network entrar` na srvjcp86; a vps entra sozinha na batida do pulse quando o `ork` dela for atualizado;
  - medição: a métrica principal, 7 dias depois do piloto;
  - interromper se um segredo aparecer na casa ou se o repositório ficar público; a guarda já recusa a publicação nesses casos.
- **Próxima fatia (registrada, não implementada):**
  - piloto com GitLab real: `glab auth git-credential` só foi provado com `glab` simulado;
  - check da rede no `ork doctor`: adesão, casa, última batida e última falha do `rede.log`;
  - retrato parado há muitos dias sai do índice `REDE.md` (hoje só vira a lacuna `maquina.sem-batida`).
- **Achado extra, fora do escopo:** despacho que falha por impedimento que só o dono resolve (por exemplo, "Workspace not trusted" do Claude Code) hoje vira só `phase_dispatch_failed`, sem HITL e sem "espera você" no board e na fábrica. Evidência: o `phase_dispatch_failed` de 29/09 16:32 UTC no ledger desta thread. Proposta: classificar o motivo e abrir pedido tipado ao dono; candidato a item próprio.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 2 de 3 no pedido do dono de 29/09/2026 (RM-052, RM-053, RM-054); método: ordem de dependência declarada pelo dono; a RM-054 consome esta rede.
- **Horizonte / alvo / previsão / confiança / marcos:** Agora; fatia 1 em PR em 29/09/2026; confiança média, porque o merge depende da revisão do dono e das duas threads paralelas; marcos: PR verde, merge, `ork network entrar` na srvjcp86, vps na rede.
- **Dependências e bloqueios (ID, owner, próxima revisão):**
  - RM-047 (Julio): a fábrica por repositório, generalizada para a pessoa;
  - RM-040 (Julio): contas continuam locais, a rede não carrega credencial;
  - RM-052 (Julio): o registro de projetos, lido pelo adaptador;
  - RM-026 (Julio): a rede de equipe fica fora;
  - bloqueio: nenhum.
- **Premissas / riscos / mitigação:**
  - premissa: a pessoa usa a mesma conta da forja em todas as máquinas; senão, `ork network entrar --repositorio` fixa a casa;
  - risco: repositório público por engano; mitigação: a publicação é recusada e o status mostra a lacuna;
  - risco: todas as máquinas têm a mesma identidade na forja; mitigação: a regra de autoria é do cliente e auditável por git (ADR-001);
  - risco: conflito textual com as threads paralelas no merge; mitigação: a SHIP compara com a `main` do momento.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - [ADR-001](../conceitos/decisoes/ADR-001-estado-da-rede.md), 29/09/2026: repositório privado por pessoa; branch por repositório e gist ou snippet descartados;
  - decisões autônomas no ledger da thread, a ratificar pelo dono: a casa da rede, não criar o repositório real na conta do dono, e SHIP por PR sem merge próprio.

## Estado com evidências

- Fatia 1 na branch `ork/ork-rm053network-full` (29/09/2026): ADR, forja, fronteira com a RM-052, núcleo da rede, CLI e batida.
- CHECK 1 (29/09): reprovado, com uma regressão do lint de horário e dezenove achados de uma revisão independente, dois altos (falso positivo de e-mail em remoto scp e `GIT_DIR` herdado regravando a config do projeto).
- GO-FIX 1 (29/09): todos corrigidos com teste.
- CHECK 2 (29/09): o reverify do núcleo com o verify completo verde; uma segunda revisão independente achou uma regressão na fronteira de credencial (senha na forma scp) e duas funcionais, todas reproduzidas.
- GO-FIX 2 (29/09): corrigidas.
- CHECK 3 (29/09): o verify do núcleo verde; a terceira revisão achou mais uma variante de senha no remoto (barra invertida num usuário de domínio) e uma regressão no `sair`, reproduzidas.
- GO-FIX 3 (29/09): o remoto passa a ser montado de partes validadas.
- CHECK 4 (29/09): o verify do núcleo verde; a quarta revisão confirmou a montagem do remoto contra o parse do próprio git em HTTP(S) e scp, e achou o login no lugar do host nos transportes SSH, nome de projeto de terceiro com controle de terminal chegando ao status e ao `REDE.md`, e dois consertos da rodada 3 sem teste; todos reproduzidos.
- GO-FIX 4 (30/09): SSH e `git://` com `?` ou `#` viram `null`; uma regra só de nome de projeto; o leitor recusa texto com caractere invisível ou com cara de segredo e remonta o remoto alheio; a saída do status não executa nada; a casa só por HTTPS; 58 testes verdes em `core/test/rede.test.ts` contra forja simulada.
- Evidência dos testes: cada correção tem teste. Os que cobrem correção nova reprovam no código anterior, inclusive a corrida do id da instalação: os processos concorrentes reprovam `b3f5dbe`, e o processo lento determinístico reprova `f4da67c`. A trava órfã movida, a saída JSON do CLI, os tetos do escritor e o `core.sshCommand` na leitura legada foram provados por mutação. O SSH em lote (M5) é provado só pelo formato do ambiente.
- Nenhum repositório real foi criado e nada foi publicado no npm.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-30 | Julio |
| Documentação | Em revisão | — | 2026-09-30 | Julio |
| Código | Branch criada | — | 2026-09-30 | Julio |
| Testes | Em execução | — | 2026-09-30 | Julio |
| Deploy | Não implantado | — | 2026-09-30 | Julio |
| Exposição | Flag desligada | — | 2026-09-30 | Julio |
| Habilitação | Pendente | — | 2026-09-30 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: agentes do Orkastery (thread `ork-rm053network`) · A: Julio · C: — · I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** Claude (claude-code, sessão `624f65db`) conduziu do GOAL à SHIP no modo `#Auto`, com as decisões autônomas no ledger; revisão e merge: Julio.
- **Próxima ação, responsável e prazo:** Julio revisa e mescla o PR, depois roda `ork network entrar` na srvjcp86; prazo a definir pelo dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | proposto e criado | incidente do Telegram de 29/09; pedido do dono para RM-052, RM-053 e RM-054 | Julio |
| 2026-09-29 | casa da rede: repositório privado por pessoa | ADR-001; ledger da thread | agente, a ratificar por Julio |
| 2026-09-29 | fatia 1 em desenvolvimento na branch da thread | commits T1 a T7 de `ork-rm053network` | agente |
| 2026-09-29 | CHECK 1 reprovado e GO-FIX 1; a feature vira FEAT-031 (a RM-052 usa o 030) | parecer do CHECK 1 e commits `fix(ork-rm053network)` | agente |
| 2026-09-29 | CHECK 2 reprovado (segunda revisão) e GO-FIX 2 | parecer do CHECK 2 e commits `fix(ork-rm053network): GO-FIX 2` | agente |
| 2026-09-29 | CHECK 3 reprovado (terceira revisão) e GO-FIX 3: remoto montado de partes validadas | parecer do CHECK 3 e commit `fix(ork-rm053network): GO-FIX 3` | agente |
| 2026-09-30 | CHECK 4 reprovado (quarta revisão) e GO-FIX 4: SSH sem `?` nem `#`, regra única de nome, texto sem invisíveis, casa só por HTTPS | parecer do CHECK 4 e commit `fix(ork-rm053network): GO-FIX 4` | agente |
