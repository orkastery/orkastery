# Padrão de interação humana

> Uma decisão humana chega como pergunta curta, com alternativas claras e uma recomendação; a fábrica executa o trabalho operacional autorizado.

## Quando perguntar

Pergunte somente quando a decisão pertence ao humano, quando um contrato público exige ratificação ou quando uma política bloqueia o avanço. Impedimento técnico, diagnóstico, comando e operação que a fábrica consegue realizar continuam com a fábrica.

## Forma da pergunta

Toda pergunta segue o mesmo contrato de apresentação em qualquer canal:

1. contexto em uma frase;
2. uma pergunta por decisão dependente;
3. de três a cinco alternativas mutuamente exclusivas;
4. exatamente uma alternativa marcada como `Recomendada`;
5. impacto de cada alternativa em linguagem simples;
6. resposta curta, ligada à pergunta e com prova do canal.

A alternativa recomendada nunca contém comando de terminal. Quando a escolha autoriza uma ação operacional, a fábrica descreve o resultado e executa o restante pelo fluxo da [RM-093](../roadmap/RM-093-acao-do-dono-executada-pela-fabrica.md).

## Sequência e lote

- **Perguntas dependentes:** aparecem uma de cada vez. A resposta anterior define quais alternativas são verdadeiras na próxima pergunta.
- **Perguntas independentes:** podem aparecer no mesmo lote, cada uma com número, alternativas próprias e exatamente uma recomendada.
- **Ambiguidade:** a resposta que puder resolver mais de uma pergunta volta como pergunta curta; o núcleo não escolhe por inferência.

## Aprofundamento em camadas

O primeiro contato mostra somente o necessário para decidir. O dono pode aprofundar na ordem:

1. **Por quê:** problema, efeito esperado e razão da recomendação;
2. **Evidência:** fatos, fontes e lacunas que sustentam as alternativas;
3. **Detalhe técnico:** contratos, parâmetros, riscos e caminho de reversão.

Cada camada preserva a mesma pergunta e as mesmas alternativas. Aprofundar não altera escopo, validade ou recomendação silenciosamente.

## Status sem mudança

Se nada mudou desde o último status, a superfície mostra uma linha: `Sem mudança desde o último status.` Não repete contexto, opções ou instruções antigas. Uma mudança real volta ao formato completo e identifica o fato novo.

## Autoria, autorização e execução

- Texto de agente não prova resposta humana.
- A resposta vale somente para a pergunta, o escopo e a validade apresentados.
- O contrato da [RM-092](../roadmap/RM-092-ratificacao-autenticada-de-contrato-publico-no-auto.md) registra canal e prova da autorização.
- A sessão que propõe não assume a identidade do dono e não executa ação reservada dentro da própria sessão.
- Repetição da resposta não duplica decisão nem execução.

## Critérios de conformidade

Um pedido não está conforme se tiver menos de três ou mais de cinco alternativas, nenhuma ou mais de uma recomendada, termo técnico sem explicação, comando na alternativa recomendada, perguntas dependentes no mesmo lote ou ausência de prova do canal para uma decisão reservada.
