# Créditos

O Orkastery é uma implementação original, licenciada sob MIT, que não foi forkada de nada. Ele
também está apoiado em trabalho que outras pessoas fizeram primeiro e publicaram, e esta página
diz de quem, pelo nome.

*This page is also available in the project's history in English. The credits below are the
same, and corrections are welcome in either language.*

Duas regras governam este documento. **O crédito e generoso**, porque reconhecer uma influência
não custa nada é esconder uma custa a credibilidade do projeto. E **crédito nunca e
comparação**: nada aqui diz o que outro projeto faz ou deixa de fazer. Estas são as ideias que
moldaram este desenho, e gratidão e todo o conteúdo.

---

## Uma nota sobre a base destes créditos

Até a reestruturacao do repositório, cada crédito desta página se apoiava num relatório de
pesquisa datado, versionado aqui mesmo. Aqueles relatórios pertenciam a estrutura anterior do
projeto e não foram trazidos para a árvore atual. **Eles continuam na história do git**, no
commit `0568501`, e podem ser lidos de lá.

Os créditos foram mantidos porque as ideias continuam no desenho. A base documental mudou de
lugar, e dizer isso é mais honesto do que apagar o nome de quem influenciou o trabalho.

---

## Os pioneiros do loop autônomo

O desenho do **Maestro mode autônomo** (o runner de objetivo que virou as vigas
`--exige-runtime-diferente` e `--done` de `ork thread new`) se apoia em padrões que outras pessoas
foram as primeiras a publicar. Aquele capítulo existe por causa do trabalho
delas, então o crédito fica aqui, e não numa nota de rodapé.

- **Geoffrey Huntley**, pelo Ralph loop: uma especificação fixa, um agente de contexto novo por
  iteração, uma tarefa por vez, todo estado durável em arquivos e no git em vez de na memória do
  modelo, backpressure determinístico segurando o avanço, saídas verificadas por máquina sob um
  teto rígido de iterações, e um protocolo de travamento que documenta o bloqueio e para. O gate
  de regressão com reset barato, o ledger de progresso em disco, e o teto de iteracoes com o
  protocolo de travamento dentro do stop stack descendem desses princípios.

- **Matt Shumer**, pelo Gauntlet loop: decompor um objetivo grande em unidades que possam ser
  avaliadas de forma independente, separar quem constrói de um crítico cego que roda em contexto
  novo e inspeciona o artefato real, julgar contra uma barra de referência concreta que pode ser
  deliberadamente inalcancavel, iterar sobre a maior lacuna restante, e trocar os críticos entre
  as rodadas para que nenhum se ancore no próprio julgamento anterior. A unidade avaliável, a
  barra aspiracional com a sua janela de polish, e o ensemble de validação são esse padrão
  aplicado aqui.

- **Nicholas Carlini**, creditado entre as pessoas que foram pioneiras públicas destes padrões.

- **A comunidade de praticantes ao redor delas**, cujas execuções publicadas, relatos de falha e
  mitigacoes convergentes transformaram esses padrões em prática de engenharia. O padrão de
  workflow orientado a especificação, com a definição de pronto mantida fora do alcance de
  escrita do agente e oraculos acima de juizes-modelo, não tem autor único, e este projeto o
  herdou inteiro, junto com a janela sem progresso, o detector de oscilação e a regra de valor
  marginal.

Dois avisos daquela mesma pesquisa moldaram este desenho tanto quanto os padrões: os modos de
falha documentados (conclusão prematura, custo descontrolado e efeito colateral irreversível em
execução desassistida) são a razão de os passos irreversiveis aqui ficarem atrás de um gate
humano.

---

## O ecossistema em que este projeto é construído

- **Anthropic**, pelo ecossistema de host em que esta versão roda: os mecanismos de skills e
  plugins, e o runtime que o adapter `claude-bg` despacha pelo canal oficial. O Orkastery
  orquestra runtimes oficiais por mecanismos oficiais, sem spoofing de harness, sem extração de
  token e sem compartilhamento de credencial; a rotação entre contas próprias do operador segue
  a decisão do dono registrada em [SECURITY.md](SECURITY.md).

---

## Práticas que este projeto adotou, e não inventou

- **Declarar a origem de toda metrica**, de modo que um valor não medido seja publicado como
  `unavailable` e nunca como zero. A disciplina e mais velha do que este projeto, e e aplicada
  aqui sem nenhuma pretensão de autoria.

- **O plugin como unidade sancionada de distribuição**, com skills como o que um plugin carrega.
  São mecanismos do ecossistema do host, não invenções deste projeto, e o Orkastery embarca
  dentro deles em vez de ao redor deles.

---

## Correções

Se você está nomeado aqui é o crédito está errado, incompleto, ou e algo que você preferiria não
receber, abra uma issue e será corrigido na próxima versão.

Se você acredita que uma ideia sua está neste desenho e não está reconhecida aqui, vale o mesmo
caminho: **uma omissão nesta página é um defeito, e e tratada como um**.
