---
id: RM-073
tipo: roadmap
titulo: Modelos de decisão no ork e no OrkMind
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-24T19:20:00-03:00
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

# RM-073: Modelos de decisão no ork e no OrkMind

> **Em uma frase:** o ork e o OrkMind passam a usar modelos de decisão (System One), que devolvem escolha, nota ou probabilidade tipadas em segundos, como camada de sinal rápido em cinco frentes, sem nunca trocar a prova do gate.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono (24/10/2026):** criar o item em Discovery, só página e pesquisa, sem código. Cinco frentes, cada uma uma fatia com critério de aceite medido, e regras inegociáveis: o modelo é sinal e não prova, código e prints só saem com opt-in e a barreira de dado privado, a chave fica no cofre, há teto de custo e fallback, e nenhum fornecedor fica fixo no código.

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz o `ork` e o próprio Orkastery. Hoje quatro decisões repetidas da fábrica são tomadas por regra fixa ou por um agente generativo caro: quais testes rodar, com que runtime, modelo e esforço despachar uma fase, que nota dar no fechamento e que alternativa recomendar ao dono. A fase CHECK completa leva cerca de 20 minutos, o esforço `xhigh` ou `max` é o padrão dos despachos, a nota do MASTER sai por omissão na maioria das threads e a recomendação do HITL não aprende com as respostas passadas do dono.
- **Evidências e fonte:** duas famílias de medida, ambas de 24/10/2026.
  - **O que os modelos são**, do catálogo público do OpenRouter e da documentação dele (seção "Os três modelos do pedido").
  - **A linha de base local**, contada nos ledgers de 294 threads do próprio Orkastery (seção "Linha de base medida").
- **Objetivo/OKR:** o ork decide mais rápido e mais barato o que é julgamento de baixo risco, e o dono continua com a prova e com a palavra final.
- **Hipótese:** se o ork usar modelos de decisão em modo sombra, atrás de flag e com teto de custo, como sinal para escolher testes afetados, esforço de despacho, nota de MASTER, recomendação de HITL e veredito de tela, então o minuto do Agile Check, o custo por fase e o tempo do dono caem sem aumentar o falso negativo acima de um limiar que o dono aprova, porque o modelo devolve uma resposta tipada com probabilidade em uma chamada barata, e cada resposta é comparada com a verdade que o ledger já guarda antes de ter qualquer efeito.
- **Métrica principal / linha de base / meta / janela / fonte:** uma métrica por frente, na tabela "Métricas". A comum a todas é o **falso negativo contra a verdade do ledger ou dos testes atuais**, com limite superior de 95% informado junto. Janela: cada fatia, em modo sombra, antes de ligar a flag. Fonte: a bancada de medição (M0) e o ledger.
- **Métricas de proteção:**
  - o gate não muda: a suíte completa, as claims e o comando reproduzível continuam como hoje, e o Classic Check fica intacto;
  - com o provedor fora do ar, sem chave ou sem opt-in, o comportamento é o de hoje, byte a byte, e o ledger registra o fallback;
  - nenhum código, print ou texto privado sai sem opt-in do projeto e sem passar pela barreira da [RM-062](RM-062-repositorio-publico-sem-dado-privado.md);
  - o gasto nunca passa dos tetos por dia e por arco;
  - nenhuma decisão de modelo vira prova: ela entra no ledger como `sinal`, nunca como `verificada`.

## Os três modelos do pedido

Fonte: `GET /api/v1/models?output_modalities=decisions` e `GET /api/v1/models/<id>/endpoints` do OpenRouter, mais as páginas de documentação "Jev", "Multimodal Decisions" e "Decisions API", lidas em 24/10/2026. Os três IDs do pedido existem e estão ativos (uptime de 100% nos últimos 30 minutos, 5 minutos e 1 dia no catálogo). A listagem padrão de modelos do OpenRouter não os mostra: só aparecem com o filtro `output_modalities=decisions`, que a configuração do ork precisa usar para descobrir modelos. Com o filtro saem 30 entradas, contando aliases `~...-latest` e variantes `:free`.

| | `typesafe/jev-1.14` | `perplexity/pplx-decider-v1.2` | `openai/gpt-6-luna-decisions` |
| --- | --- | --- | --- |
| O que é | Modelo de decisão da TypeSafe, o primeiro System One | Checkpoint de 27B da Perplexity; o irmão `pplx-decider-flash-v1.2` tem 4B | GPT-6 Luna servido pela Decisions API da OpenAI |
| Entrada aceita | Texto e imagem | Texto e imagem | Texto, JSON e imagem |
| Áudio e vídeo | Não | Não | Não |
| Código | Como texto ou JSON dentro de `state`; não há modalidade "código" | Idem | Idem |
| Saída | Decisões tipadas, sem texto gerado | Idem | Idem |
| Perguntas | Choice, Noul (sim ou não), Score (escala ordenada) e Box (caixa em imagem, só no Jev 1.14) | Choice, Noul e Score | Choice, Noul e Score |
| Contexto | 262.144 tokens | 262.144 tokens | 1.050.000 tokens |
| Imagens por pedido | PNG ou JPEG, de 256 a 1.568 px por lado | Não consta na documentação lida | Até 128 |
| Preço de entrada | US$ 0,042 por milhão de tokens | US$ 0,02 por milhão (o flash, US$ 0,01) | US$ 0,10 por milhão |
| Preço de saída | Zero | Zero | Zero |
| Latência publicada | Nenhuma (`latency_last_30m` nulo no catálogo) | Nenhuma | Nenhuma |

O que isso muda para o desenho:

- **Não existe texto de justificativa.** A documentação do Jev diz que ele não produz explicação nem texto livre, e os três descrevem a saída como decisão tipada. As frentes 3 e 4 pedem "justificativa" e "motivo": a justificativa tem de ser montada pelo ork, decompondo o julgamento em várias perguntas Noul por critério e mostrando quais ficaram baixas, e não pedida ao modelo.
- **A saída gratuita muda a conta.** O preço da entrada do Luna Decisions é o mesmo do Luna de chat (US$ 0,10 por milhão); a economia está em não pagar saída, em não gastar raciocínio e em usar modelos menores. Para o Jev e o Decider, a entrada é de 2 a 5 vezes mais barata.
- **Imagem tem regra por modelo.** Limites de quantidade e de tamanho variam (Clef aceita 4, Mercury Decide 16, Luna 128, Jev exige de 256 a 1.568 px). O adaptador do ork declara a capacidade de cada modelo.
- **A API é alpha.** O endpoint é `POST /api/alpha/decisions`; a TypeSafe marca imagem e Box como recursos iniciais cujo formato pode mudar. Há também `POST /api/v1/systemone`, compatível com os SDKs da TypeSafe. O ork conversa com um adaptador, nunca com o endpoint direto.
- **Descoberta por capacidade.** O catálogo traz `input_modalities` por modelo, então "aceita imagem?" vem do catálogo, não do código.
- **Aberto e hospedável.** Há modelos de peso aberto na lista (família Clef da Cloudflare, Span-02 da Respan, Kev 4B, Mammoth 1 e Elephant 1 da Baseten), o que permite a alternativa de nada sair da infraestrutura do dono.

**O que não foi medido, e por quê.**

- O pedido manda confirmar latência e custo reais com chamadas de teste sem dado privado.
- **Nenhuma chamada foi feita.** O ambiente do agente não tem chave do OpenRouter, e isso é o desenho pedido: a chave fica no cofre, fora do ambiente dos agentes, como na [RM-069](RM-069-dsn-fora-do-ambiente-dos-agentes.md).
- Uma chamada sem chave a `POST /api/v1/chat/completions` respondeu `401`, como esperado.
- Não se usou credencial de outra ferramenta da máquina, porque não é a do cofre deste projeto.
- Latência e custo por chamada ficam como **lacuna declarada** até a bancada M0, que exige uma chave colocada pelo dono no cofre.
- O custo abaixo é conta sobre o preço publicado, não medida.

| Pedido de 50.000 tokens de entrada | Jev 1.14 | Decider v1.2 | Luna Decisions |
| --- | --- | --- | --- |
| Custo por chamada (cálculo) | US$ 0,0021 | US$ 0,0010 | US$ 0,0050 |
| Mil chamadas por dia (cálculo) | US$ 2,10 | US$ 1,00 | US$ 5,00 |

O tamanho real de um diff ou de uma tela em tokens não foi medido. A M0 mede.

## Linha de base medida

Contagem feita em 24/10/2026 nos ledgers locais de 294 threads do Orkastery. Os números são desta amostra, de um projeto só, e não generalizam.

| O que | Medida | O que significa para o item |
| --- | --- | --- |
| Tempo do CHECK completo | 19 a 20 min de parede; 15 min 22 s só o `npm test`, com 350 arquivos e 5.718 testes (medição da RM-072). Nos ledgers, a mediana do CHECK é de 20,2 min em 19 rodadas | Frente 1: é o minuto que se quer cortar nas rodadas intermediárias |
| Tempo por fase nos ledgers (mediana, n) | GO 17,1 min (47); GOAL 10,5 (19); PLAN 6,7 (18); CHECK 20,2 (19) | Frente 2: o custo por fase precisa dessa mesma régua |
| Esforço de despacho | Dos 506 despachos, 390 (77%) caem em quatro arranjos de esforço `xhigh` ou `max` | Frente 2: há espaço para esforço dinâmico, mas sem qualidade medida por fase não se prova que baixar é seguro |
| Tokens por fase | 105 dos 339 `phase_result` trazem `tokens`: 105 de 131 no `codex` (80%), 0 de 157 no `claude-bg`, 0 de 51 sem runtime | Frente 2 depende da [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) F2, que fecha essa lacuna |
| Fechamentos (`master_done`) | 213: 162 por omissão (nota derivada do ledger, ninguém pontuou), 46 em lote, 4 em pausa, 1 sem regime | Frente 3: a base de notas que não são omissão é de 50 |
| Notas fora da omissão | 0: 21; 3: 4; 4: 15; 5: 10; 1 sem valor numérico | Frente 3: amostra pequena e concentrada nas pontas; a origem humana de cada nota em lote é a confirmar |
| Classes de falha do POSTMORTEM | `outra` 86, `sem-falha` 68, `base-avancou` 51, `processo` 38, `rate-limit` 13, `erro-de-spec` 2, `modelo` 1 | Frente 3: a classe mais frequente é `outra`, ou seja, a classificação de hoje é fraca |
| Decisões autônomas | 2.520 eventos `autonomous_decision`; o `ork decisao placar` já conta as revertidas | Frente 4: é o rótulo mais abundante (aceita ou revertida pelo dono) |
| Pedidos ao dono | 25 `hitl_requested` e 36 `human_gate`, em 11 threads | Frente 4: poucas respostas explícitas; o aprendizado por resposta passada começa pequeno |

## Escopo e validação

- **Incluído:**
  - **M0, a bancada de medição** (pré-requisito, não é uma das cinco fatias): um conjunto rotulado por frente, extraído do ledger e dos testes, e um comando que roda cada modelo candidato contra ele e grava latência (p50 e p95), custo, concordância, falso negativo e cobertura de recusas. Sem dado privado: o conjunto usa só o que o repositório público já mostra, ou fixtures sintéticas.
  - **A camada de decisão**, neutra de fornecedor: configuração com `provedor`, `modelo` e arquivo de chave no cofre (o mesmo padrão de arquivo `0600` da RM-069), descoberta de capacidades pelo catálogo, e um adaptador por superfície (Decisions API, System One).
  - **Cinco fatias**, abaixo, cada uma em três degraus: sombra (o modelo responde e o ork só compara), consultivo (o ork mostra o sinal) e ligado atrás de flag.
  - **Teto e fallback**: teto de gasto por dia e por arco, e volta ao comportamento de hoje se o provedor falhar, estourar o teto ou não tiver opt-in, tudo gravado no ledger.
- **Fora de escopo:** trocar o gate por julgamento de modelo; tirar o Classic Check; qualquer modelo generativo escrevendo a justificativa (opcional e fora desta onda); treino ou ajuste fino de modelo; fornecedor fixo no código; mandar dado privado para fora; mudar a nota do dono (a nota humana continua sobrescrevendo); produto para clientes finais.
- **Entregáveis e critérios de aceite:** por fatia, na seção "Fatias". O critério do item é que cada decisão de modelo apareça no ledger com modelo, versão, pergunta tipada, resposta, probabilidade, custo, latência e verdade comparada, e que um teste reprove a decisão que chegue ao gate como prova.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads do próprio Orkastery, primeiro em sombra. Cada fatia só sobe de degrau se a medição da M0 e do piloto cumprir a meta aprovada pelo dono. Interrompe se o falso negativo passar do limiar, se o gasto bater o teto sem ganho medido, ou se o provedor mudar o contrato (a API é alpha).

### Métricas

| Frente | Métrica | Linha de base | Meta a propor (o dono aprova) | Fonte |
| --- | --- | --- | --- | --- |
| 1. Agile Check | Minutos da rodada intermediária de teste, e falso negativo da escolha de testes (teste que falharia na suíte completa e foi deixado de fora) | Rodada completa de 15 min 22 s só de teste; escolha de testes por modelo não existe | Rodada intermediária abaixo de 90 s, igual à meta da F3 da RM-072; falso negativo dentro do limiar da decisão D1 | `verify_run.duracaoMs` (RM-072) e comparação com a suíte completa do gate |
| 2. Esforço dinâmico | Tokens e custo por fase e por task, e qualidade (nota derivada do MASTER, rodadas de GO-FIX e de CHECK) | Tokens em 31% das fases (105 de 339) e em 0% no `claude-bg`; custo em dinheiro só como referência estimada | Cobertura de 100% das fases do piloto; custo por fase menor com qualidade igual ou melhor, medido por arranjo | `phase_result.tokens` da RM-071 F2, `phase_dispatch` e `master_done` |
| 3. MASTER autônomo | Concordância do MASTER automático com a nota humana (exata, dentro de 1 ponto, e kappa ponderado) e acerto da classe do POSTMORTEM | Não medida; 50 notas fora da omissão | Dentro de 1 ponto em pelo menos 90% e classe `outra` abaixo de 40% das classes atribuídas, no conjunto de teste, com a amostra mínima definida na M0 | `master_done`, `postmortem_recorded` |
| 4. Status e HITL | Acerto da recomendação (a alternativa recomendada é a que o dono escolheu), e calibração (a probabilidade dita bate com a frequência) | Recomendação de hoje (RM-057) existe, acerto não medido | Acerto acima da recomendação atual, com calibração medida; 0 pergunta que antes não parava a fábrica passando a parar | `hitl_requested`, `human_gate`, `autonomous_decision`, `ork decisao placar` |
| 5. Avaliador multimodal | Falso negativo do avaliador (a tela que o teste atual ou um humano reprova e ele aprova) e concordância com os testes atuais | Não medida; bateria lenta de hoje é a referência | Falso negativo zero em N de pelo menos 300 comparações (limite superior de 95% perto de 1%), antes de trocar qualquer bateria | Testes atuais do CHECK e rótulo humano em amostra |

Para ancorar a decisão D1: com zero falso negativo observado em N comparações, o limite superior de 95% é de cerca de 3 dividido por N (regra dos três). Para N igual a 300 dá cerca de 1%; para N igual a 100, cerca de 3%.

## Fatias propostas

Cada fatia é um PR com teste hermético e uma linha no `CHANGELOG.md`. Nenhuma começa antes da decisão do dono registrada em "Plano e decisões" e da M0.

| Fatia | Entrega | Critério de aceite verificável |
| --- | --- | --- |
| F1 Agile Check mais rápido | Pelo diff, o modelo escolhe os testes afetados nas rodadas intermediárias, ordena as lanes por risco e decide o fallback (rodar mais, ou tudo). A suíte completa continua no gate. Liga à F3 da RM-072. | Em sombra, sobre diffs reais de threads fechadas: a escolha inclui todo teste que falhou na suíte completa em pelo menos o limiar da D1; a rodada intermediária cumpre a meta de minutos; a rodada final e o gate rodam a suíte completa em 100% dos casos, provado por teste que reprova atalho no gate; sem provedor, o resultado é igual ao de hoje. |
| F2 Esforço dinâmico | Por thread e por fase, escolher runtime, modelo e esforço a partir do pedido, do histórico do ledger e da memória do OrkMind, com custo por fase e por task medido. Depende dos tokens por fase da RM-071. | Em sombra, a escolha recomendada é comparada com o arranjo usado e o resultado dele; a recomendação mais barata só sobe de degrau onde a qualidade medida (nota derivada, rodadas de GO-FIX e de CHECK) não piora; custo por fase medido em 100% das fases do piloto; sem dado de tokens, a fase usa o arranjo de hoje e o relatório diz `lacuna`. |
| F3 MASTER autônomo | Nota de 0 a 5 e classes do POSTMORTEM, com confiança e justificativa montada por perguntas por critério, calibradas contra as notas humanas do histórico. A nota do dono continua sobrescrevendo. | Concordância e kappa contra as notas humanas do conjunto de teste cumprindo a meta aprovada; a nota do dono sobrescreve a automática em teste que prova o registro das duas; a nota automática sai marcada como `sinal`, nunca como nota do dono. |
| F4 Status e HITL | Recomendar a alternativa de cada pergunta com probabilidade e motivo, aprendendo com as respostas passadas do dono (RM-048, RM-057). O aprendizado é recuperação de casos e recalibração, não treino. | Acerto da recomendação acima da atual e calibração medida em conjunto separado do de ajuste; a pergunta continua com 3 a 5 alternativas e uma recomendada no formato da RM-057; a recomendação nunca decide pelo dono; sem sinal, sai a recomendação de hoje. |
| F5 Avaliador multimodal no CHECK | Prints de tela, código e critério de aceite viram veredito tipado, como um humano ou agente testando a tela, para trocar baterias lentas onde a paridade for provada. | Falso negativo dentro do limiar da D1 em N mínimo, comparado com os testes atuais e com rótulo humano; só troca uma bateria atrás de flag e com a paridade provada para aquela bateria; o Classic Check fica intacto e a troca se desfaz desligando a flag; print só sai com opt-in e barreira da RM-062. |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** pedido direto do dono em 24/10/2026, sem pontuação RICE. A posição no índice de prioridade do roadmap é decisão dele.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. Item em Discovery; nada de código iniciado. Ordem proposta na decisão D3.

### Dependências e bloqueios

| Item | Por que | Estado e bloqueio |
| --- | --- | --- |
| RM-072 (CHECK 5x) | A F1 liga à F3 dela (mapa de impacto de teste por arquivo e lanes). Se a RM-072 levar o CHECK completo a 3 minutos, o ganho da F1 diminui, e a medição dela é a régua | Em Discovery, reservada em outra thread; a página dela ainda está na branch dela, por isso não há link aqui. Bloqueio: nenhum para a M0 |
| [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) | A F2 precisa dos tokens, minutos e conta por fase (F2 da RM-071) | Em Discovery. Bloqueia a F2, não as outras |
| [RM-048](RM-048-hitl-humano-no-centro.md) e [RM-057](RM-057-hitl-por-alternativas.md) | O formato da pergunta ao dono (curta, com recomendação, 3 a 5 alternativas) é o contrato da F4 | Em validação e em desenvolvimento. Nenhum bloqueio |
| [RM-058](RM-058-modo-noctum.md) | O arco do #Noctum é a unidade do teto de custo por arco e consome as decisões de esforço e de HITL | Em desenvolvimento. Nenhum bloqueio |
| [RM-062](RM-062-repositorio-publico-sem-dado-privado.md) | A barreira de dado privado antes de qualquer saída de código ou print | Em desenvolvimento. Bloqueia a F5 e qualquer saída de código |
| [RM-069](RM-069-dsn-fora-do-ambiente-dos-agentes.md) | Padrão de segredo em arquivo `0600` do dono, fora do ambiente dos agentes, que a chave do provedor reaproveita | Em desenvolvimento. Bloqueia ligar qualquer provedor |
| OrkMind ([RM-006](RM-006-orkmind-na-fabrica.md), [RM-008](RM-008-loop-de-aprendizado.md)) | Guarda as decisões, a calibração e os casos passados que as frentes 2, 3 e 4 recuperam | Concluído e em piloto. Nenhum bloqueio |

### Premissas / riscos / mitigação

- **Premissa:** o catálogo e a documentação do OpenRouter de 24/10/2026 descrevem os modelos corretamente. Mitigação: a M0 confere cada capacidade com chamada real antes de qualquer fatia.
- **Risco: confundir sinal com prova.** Mitigação: a decisão entra no ledger como `sinal`; o gate lê só claims e comando reproduzível; um teste reprova qualquer caminho em que a resposta do modelo aprove um gate.
- **Risco: falso negativo escondido por amostra pequena.** Mitigação: limite superior de 95% sempre ao lado do número, N mínimo por fatia, e a regra dos três na decisão D1.
- **Risco: a amostra local é pequena e de um projeto só** (50 notas fora da omissão, 25 pedidos ao dono). Mitigação: a M0 declara o tamanho do conjunto e a frente fica em sombra até ele bastar; sem amostra suficiente, a meta não é declarada atingida.
- **Risco: rótulo viciado.** A nota por omissão é derivada do ledger e não é nota humana; treinar ou calibrar contra ela mediria o próprio ledger. Mitigação: a F3 calibra só contra nota que não seja omissão e confirma a origem humana das notas em lote.
- **Risco: sem contrafactual na frente 2.** Só se vê o resultado do arranjo que rodou. Mitigação: sombra com comparação por thread parecida, e degrau ligado só onde o histórico cobre o arranjo recomendado.
- **Risco: dado privado saindo.** Mitigação: opt-in por projeto, barreira da RM-062 antes do envio, envio mínimo (trecho do diff, não o repositório), e teste que procura segredo, nome de máquina e caminho absoluto no pedido. O pedido passa por dois terceiros (o OpenRouter e o provedor do modelo); a política de dados de cada modelo, na página dele, é conferida na M0 e registrada.
- **Risco: API alpha mudar.** Mitigação: adaptador com teste de contrato, fallback para o comportamento de hoje, e descoberta de capacidade pelo catálogo.
- **Risco: sem justificativa em texto.** Mitigação: justificativa montada pelo ork a partir de perguntas por critério; texto livre por modelo generativo fica opcional e fora desta onda.
- **Risco: gasto fora de controle.** Mitigação: tetos por dia e por arco, contagem no ledger por chamada, e corte para o fallback ao bater o teto.
- **Risco: captura de tela indisponível no host** (um host já registrou chromium sem biblioteca para captura). Mitigação: a F5 declara a captura de tela como pré-requisito e usa `lacuna` quando falta.

### Decisões do dono

Cada decisão traz três alternativas e uma recomendada, no formato da RM-057. **Decididas pelo dono em 25/10/2026, no terminal do Claude Code:** D1 a D5 pelas alternativas recomendadas, e a D6, abaixo, acrescentada por ele.

**D1. Limiar de falso negativo para trocar teste ou bateria (frentes 1 e 5).** Decidida: alternativa recomendada.

1. Um nível só e rígido: zero falso negativo em pelo menos 300 comparações, em tudo.
2. **Dois níveis (recomendada).** Rodada intermediária: até 2% observado, com limite superior de 95% até 5%, porque a suíte completa ainda roda no gate. Troca de bateria: zero falso negativo em pelo menos 300 comparações, porque ali o modelo substitui um teste.
3. Só rodada intermediária nesta onda; nenhuma bateria é trocada, e a F5 só emite sinal consultivo.

**D2. O que sai para provedor externo.** Decidida: alternativa recomendada.

1. Só metadados e texto sem código: nomes de arquivo, estatística do diff, nomes de teste, resultados do ledger. Serve as frentes 1, 2 e 4; limita a 3 e anula a 5.
2. **Código e prints com opt-in do projeto e barreira da RM-062 (recomendada).** É o que o pedido autoriza: com opt-in o diff e as telas saem, sem opt-in vale a alternativa 1, e a política de dados do modelo é conferida na M0 antes de ligar.
3. Só modelos de peso aberto rodando na infraestrutura do dono: nada sai, mas exige infraestrutura e abre mão dos modelos maiores.

**D3. Ordem das fatias depois da M0.** Decidida: alternativa recomendada.

1. **F4, F3, depois F2, F1 e F5 (recomendada).** Começa pelas que não tocam o gate e já têm rótulo no ledger (2.520 decisões autônomas, notas e classes). A F1 espera o resultado da RM-072, cujo ganho define quanto sobra para cortar; a F2 espera os tokens da RM-071; a F5 vem por último, pelo risco maior.
2. F1 primeiro, porque o CHECK de cerca de 20 minutos é a maior dor medida hoje; depende da F3 da RM-072.
3. As cinco em sombra ao mesmo tempo: mede tudo cedo, ao custo de mais gasto e de dispersão do piloto.

**D4. Tetos de custo (a revisar com a M0).** Decidida: alternativa recomendada.

1. **US$ 1 por dia e US$ 0,25 por arco (recomendada).** Cerca de 470 chamadas de 50.000 tokens por dia no Jev, pelo preço publicado; teto baixo até a M0 medir o gasto real.
2. US$ 5 por dia e US$ 1 por arco: cerca de 2.380 chamadas de 50.000 tokens por dia no Jev.
3. US$ 20 por dia e US$ 5 por arco: folga para medir tudo em sombra, com o risco de gasto sem ganho.

**D5. Modelos da bancada M0.** Decidida: alternativa recomendada.

1. **Os três do pedido (recomendada):** `typesafe/jev-1.14`, `perplexity/pplx-decider-v1.2` e `openai/gpt-6-luna-decisions`, mais o `pplx-decider-flash-v1.2` como referência barata. Cobrem três fabricantes e texto com imagem. Pelo preço publicado, 1.500 chamadas de 50.000 tokens custam da ordem de US$ 5 (cálculo, não medida).
2. Um por família de fabricante entre os 30 do catálogo, para descobrir se há modelo melhor ou mais barato; custa mais e alarga o piloto.
3. Só um modelo, o Jev 1.14: mais simples, mas sem comparação e com dependência de um fornecedor.

**D6. Quando o avaliador de telas (frente 5) pode ser usado.** Decidida pelo dono em 25/10/2026: só em teste de escopo pequeno e pontual, de baixa criticidade e que possa ser validado olhando o print da tela. Todas as condições juntas:

- **Escopo pequeno e pontual:** a mudança toca só a apresentação de uma tela ou de um componente (texto, layout, estilo, elemento presente ou ausente), com diff pequeno e sem lógica nova.
- **Baixa criticidade:** não toca autenticação e permissões, pagamento, dados gravados e migrações, segurança e segredos, API pública, comportamento da CLI nem o próprio gate de teste e publicação.
- **Verificável pelo print:** o critério de aceite é visual; fluxo de vários passos, desempenho e dado correto no banco ficam fora.
- **Quem decide a elegibilidade:** o PLAN marca a tarefa como visual, com os caminhos que ela toca, e o núcleo confere por regra fixa (caminhos de interface, nenhum arquivo de área crítica). O próprio modelo nunca decide que pode ser usado.
- **Por cima disso:** a paridade da D1 (zero falso negativo em pelo menos 300 comparações antes de trocar uma bateria), a flag que desliga tudo e o opt-in com a barreira da RM-062 para o print sair. Falhou qualquer condição, a tarefa roda os testes de sempre (Classic ou Agile Check).

- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1 a D6 acima, decididas pelo dono em 25/10/2026. Decisão tomada nesta thread, registrada no ledger como decidida pela sessão: não fazer chamadas de teste sem chave do cofre.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-24 | Julio |
| Documentação | Rascunho | — | 2026-10-24 | Julio |
| Código | Não iniciado | — | 2026-10-24 | Julio |
| Testes | Não iniciados | — | 2026-10-24 | Julio |
| Deploy | Não implantado | — | 2026-10-24 | Julio |
| Exposição | Flag desligada | — | 2026-10-24 | Julio |
| Habilitação | Pendente | — | 2026-10-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: sessão condutora da thread; A: Julio; C: quem conduz RM-072 e RM-071; I: quem usa o ork.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** uma sessão do Claude Code em modo #Fast escreveu esta página e fez a pesquisa pública, sem código; revisor humano: Julio, pendente.
- **Próxima ação, responsável e prazo:** a chave do provedor já está no cofre do projeto (arquivo `0600` fora do ambiente dos agentes, o padrão da RM-069), então a M0 pode ser despachada; prioridade e data com o dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-24 | Item criado em Discovery, só página e pesquisa | Pedido do dono; catálogo e documentação públicos do OpenRouter lidos; linha de base contada nos ledgers locais | Julio |
| 2026-10-25 | D1 a D5 decididas pelas recomendadas; D6 nova (avaliador de telas só para mudança pequena, de baixa criticidade e verificável pelo print); chave do provedor no cofre | Respostas do dono no terminal do Claude Code | Julio |
