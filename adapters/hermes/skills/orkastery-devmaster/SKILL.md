---
name: orkastery-devmaster
description: "Reconhece orkastery maestro no Hermes: consulta panorama pelo ork_maestro, conduz demandas autorizadas e apresenta HITL na conversa."
bucket: hermes
roteia: "ork modos --do-pedido | ork thread new | ork phase run | ork ship | ork master"
license: MIT
---

# Orkastery no Hermes

Mensagem literal `orkastery maestro`: use `ork_maestro` (wrapper de `ork maestro --json`)
para consultar panorama do projeto atual. Não abra thread por essa consulta. Apresente
fontes/lacunas e próximas ações; ausência/ambiguidade de projeto exige contexto permitido.
Em sessão de fase já despachada, siga o bloco recebido sem abrir outra orquestração.
Ações usam os comandos tipados do núcleo com precondições e readback.

Usabilidade HITL tem prioridade máxima: tópicos, recomendação e opções claras, UUID
interno. Telegram é opcional. Só anuncie ingresso humano disponível quando o callback
do host estiver homologado e configurado; texto de tool não é identidade humana.
Sem ingresso no canal escolhido, conserve o pedido pendente e explique o motivo.
Não altere runtime, provider, perfil filho ou sandbox para contornar falha.
Horário para o dono sai no fuso dele (`owner.timezone`): use `prazoLocal` e os fatos
`*Local` do JSON (ex.: `19/09 15:16 (horário de Brasília)`), nunca o ISO em UTC.
Status do roadmap: `ork_roadmap_status` (`ork roadmap status`), texto como vem; nunca relatório próprio.

## O que esta skill e

O roteador do Orkastery dentro do Hermes, e **so isso**. Ela nao conduz fase por conta propria,
nao escreve codigo e nao guarda metodologia: ela traduz o pedido do builder em chamada de `ork`,
mostra o que o `ork` respondeu e para nos gates.

Antes desta skill, a skill devmaster do Hermes carregava a metodologia inteira em prosa e era ela
quem "lembrava" das regras. Isso e exatamente a fragilidade que corroeu o Devmaster original:
regra que existe so como texto e regra que ninguem verifica. **Agora a metodologia e executavel e
mora no `ork`; aqui ficou o roteador.**

## Quando usar

Sempre que o builder pedir trabalho de produto num repositorio que tem `orkastery.yaml`.

## Onboarding do projeto

Quando o builder pedir onboarding, execute `ork onboarding` para obter a pauta do núcleo.
Consulte `ork onboarding show --json` para retomar as etapas pendentes. Conduza a conversa
pela pauta devolvida e grave cada resposta pública com `ork onboarding set <etapa>
--conteudo <JSON> --por <quem>`, transportando argumentos como dados. A pauta e a validação
pertencem ao núcleo; não mantenha lista de etapas no host nem invente respostas.
Credenciais são somente nomes de variáveis; valores secretos ficam em `~/.hermes/.env`.
Use `ork onboarding reset [etapa]` quando solicitado e `ork onboarding sync --json` para
publicação opcional. Apresente o motivo tipado de degradação quando a memória não publicar.
Onboarding não exige criar thread de produto. Ao concluir, apresente `ork onboarding show --json`.

## Passo 1: o modo sai do pedido, nao de configuracao

```bash
MODO=$(ork modos --do-pedido "<pedido inteiro do builder>")
```

O comando usa a mesma funcao do nucleo que reconhece `#Classic`, `#Maestro`, `#Auto` e `#Fast`.
Sem tag no texto vale o `conduction.default_mode` do manifesto. **Nao reimplemente esse parse
aqui**, e nao valide o modo: `ork thread new` confere `conduction.allowed_modes` e recusa com erro tipado.

`#Look` e `#Ork` foram aposentados pela I-43. Um pedido com uma dessas tags faz o comando
sair com codigo != 0 e a recusa tipada `modo.aposentado`, que ja nomeia o substituto vivo.
**Repasse a recusa ao builder como ela veio**: nao traduza para outro modo e nao siga com o
default, porque trocar o regime de supervisao pelas costas de quem pediu e o defeito que a
recusa existe para impedir.

| #TAG | Pausas | Quando o builder escolhe |
|---|---|---|
| `#Classic` | 3 | O padrao do `ork init`: premissas delicadas |
| `#Maestro` | 1 | Solucao clara e agil: uma pausa para as premissas |
| `#Auto` | 0 | Docs, estudos, configuracoes, auditorias |
| `#Fast` | 0 | Pedido pequeno e claro: so a GO; o push pede autorizacao |

## Passo 2: antes de abrir, confira a maquina

```bash
ork doctor          # sai != 0 quando o despacho nao vale (custo, runtime, ambiente)
ork board plan      # quem avanca agora, quem espera e por que
ork brain status    # contrato Company Brain e tenant efetivo
```

Um `fail` do doctor para o ciclo antes de ele abrir. Isso e economia, nao obstaculo.

## Passo 3: abrir a thread e conduzir as fases

```bash
ork thread new "<nome curto>" --mode "$MODO" --worktree auto
ork phase run <thread> GOAL  --prompt "<pedido do builder>"
ork phase run <thread> PLAN  --prompt "<o que o plano precisa cobrir>"
ork worktree ensure <thread>
ork verify <thread> --baseline
ork phase run <thread> GO    --prompt "<uma tarefa do PLAN por vez>"
ork verify <thread>
ork phase run <thread> CHECK --prompt "<escopo da verificacao>"
ork ship <thread> --para main --autorizar-push "<quem>"
ork master <thread>
```

Quando o dono pedir estado do Company Brain, use o binário instalado `ork_brain` para `status`,
`query`, `get`, `context` (pacote citável: fonte, frescor e lacunas; cite o `digest`) ou `dossie`
(decisão com vínculo, alternativas, quem decidiu e evidência; resposta sem recibo vira lacuna).
Identidade só do transporte autenticado, nunca principal, DSN ou raiz da conversa; thread explícita, só leitura.

Cada `phase run` grava o prompt exato com sha256 e registra no ledger. O `ork` reverifica no
runtime que a sessao existe: self-report de despacho nao vale como evidencia.

## Passo 4: apresentar os gates ao humano

O Hermes e o podio: e aqui que o builder ve a evidencia e da o veredito. Quando o bloco pausa,
mostre o que o `ork` produziu e espere. A resposta entra pelo gateway autenticado como update Telegram original, com o remetente e o chat validados por allowlist. Use `ork_gate_answer` ou `ork_session_answer`, preservando o id do pedido e a referência da mensagem. Nunca sintetize um update nem use o nome do builder em uma aprovação criada pelo agente.

```bash
python3 adapters/hermes/bin/ork-hitl-answer.py ork_gate_answer <thread> <pedido> < update.json
python3 adapters/hermes/bin/ork-hitl-answer.py ork_session_answer <thread> <pedido> < update.json
```

`ORK_HITL_TELEGRAM_USERS` e `ORK_HITL_TELEGRAM_CHATS` contêm os ids permitidos, separados por vírgula. Sem configuração o comando recusa. A profundidade já vem do núcleo. Expiração só espera ou escala, nunca aprova. Push e score não são delegáveis.

### Atencao em camadas (I-41) e os formatos que o ingresso aceita

O nucleo monta e o Hermes so transporta: (1) UM resumo recorrente com as contagens e
`Posso te mandar as perguntas agora?`; (2) o dono responde com o codigo e a letra (`K7QX a`);
(3) com o sim, ate cinco objetivas a–d com uma recomendada, respondidas numa linha (`1a 2c 3b`).
Decisao obvia chega tomada e informada no resumo (`ork decisao registrar`). Cadencia (I-50): so a tag na mensagem (`#OrkPulseOff` 8h, `#OrkPulseOn` 2h, `#OrkPulseOn-15m`, `-30m`, `-60m`); pedida no meio da frase, devolva a tag exata para o dono mandar sozinha.

O plugin `orkastery-hitl` registra essas formas, a resposta numerada em prosa curta (`1. B, 2. A`,
`1 aprovo`), o codigo curto do gate (`DE6H a`, `DE6H detalhes`) e, so na janela curta depois da
pergunta, a palavra solta (`aprovo`, `sim`, `a`); ambiguo volta como pergunta (RM-048). Pedido ao dono sai
de `ork gate request <thread> --formato telegram`, com o codigo estavel; mande como vem. **Voce nunca responde pelo dono**: `ork gate answer` do terminal falha com
`proveniencia em argv diverge do envelope`, e essa e a defesa funcionando.

Quando o bloco nao pausa (`#Maestro`, `#Auto`, `#Fast`), o `ork` registra a decisao autonoma com quem decidiu, com que evidencia e por que. **O modo afrouxa a pausa, NUNCA a verificacao.**

## Passo 5: a entrega e o MASTER

O MASTER fecha com POSTMORTEM tipado e indice derivado do ledger; `ork master --aceitar-omissao` aceita as
pendentes com registro. Nota do dono: `ork master pedir <thread>` e mande a linha; ele responde `<codigo> 4 porque`
e o ingresso prova a origem. Nunca `--por` em nome dele: daqui da `master.prova-de-canal` (RM-048).

Memoria "degradada" tem dois portoes: a variavel da DSN no ambiente do processo
(`memory_degraded` com `dsn.env-ausente`) e a ativacao de escrita com aceite humano
(`write.activation.disabled`). Diagnostico: `ork memory status` e `ork doctor`.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Faco a fase aqui mesmo, e mais rapido" | A camada que apresenta nao escreve codigo de produto. Quem escreve e a sessao que o `ork` despacha, com prompt gravado e sha no ledger. |
| "Guardo as regras da metodologia nesta skill" | Metodologia em prosa e metodologia que ninguem verifica. Ela mora no `ork`; aqui fica o roteamento. |
| "Valido o modo antes de chamar o `ork`" | Validacao duplicada e validacao que vai divergir. `conduction.allowed_modes` e do nucleo. |
| "O builder confia, pulo o gate desta vez" | Gate pulado e gate que nao existe. Se o modo nao pausa, o `ork` registra a decisao autonoma; se pausa, ele espera. |
| "Score eu estimo pelo resultado" | O indice sai do ledger e a nota, quando existe, e do humano. Estimar nota destroi a metrica de conducao. |
| "O dono respondeu na conversa, eu registro" | So o ingresso registra, com prova HMAC do update. Devolva a linha exata para ele mandar. |

## Bandeiras vermelhas

- Esta skill crescendo de novo para carregar metodologia em vez de roteamento.
- Chamada de `git` direta em vez de `ork ship`.
- Modo escolhido por configuracao do host, e nao pela #TAG do pedido.
- Thread aberta com `ork doctor` em `fail`.
- Resposta do dono "registrada" pelo agente, sem o update autenticado do canal.

## Verificacao antes de responder ao builder

Modo lido do pedido pelo `ork`, doctor conferido, thread aberta pelo nucleo, fase despachada com
prompt gravado, gate apresentado ou decisao autonoma registrada, e uma linha dizendo em que ponto
a thread esta e o que acontece agora.
