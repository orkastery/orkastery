---
id: RM-074
tipo: roadmap
titulo: "Agile Check em 3 minutos: seletividade e CPU da suíte"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-26T05:53:43-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Branch criada
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-orkcheck3min
  modo: "#Fast"
  fase: GO
  status: aberta
---

# RM-074: Agile Check em 3 minutos, seletividade e CPU da suíte

> **Em uma frase:** levar o Agile Check de 13 a 14 minutos para no máximo 3 minutos de parede sem reduzir cobertura no gate, em quatro frentes medidas: seletividade nas rodadas intermediárias, CPU da suíte, memória e a dívida do CHECK da RM-072.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Branch criada | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono (26/10/2026):** criar o item em Discovery, só página e pesquisa, sem código.

- **Origem:** a D3 da [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), decidida pelo dono em 24/10/2026 (resposta 3a): lançar o Agile Check com as fatias 1 e 2 e levar a meta de 3 minutos para uma RM nova.
- **Regras inegociáveis:**
  - a cobertura não cai no gate;
  - o Classic Check fica intacto;
  - a seletividade vale só para rodadas intermediárias e atrás de flag;
  - toda medida vem do ledger (`verify_run`, `duracaoMs`) numa cópia descartável do projeto.

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz o `ork` e o próprio Orkastery. A RM-072 tirou o Agile Check de 20 min 37 s (Classic) para 13 min 35 s a 14 min 25 s no mesmo commit, 1,4 a 1,5 vez, e parou aí: a fila hermética de testes, que leva 13 a 14 minutos, é o gargalo, e ela é presa em CPU, não em espera. Cada rodada de GO-FIX e de CHECK paga esse tempo inteiro, mesmo quando o diff toca uma tela de texto.
- **Evidências e fonte:** os números de partida são da RM-072 (seção "Fatos de partida"); o que esta página mediu agora, em 26/10/2026, está em "Sondas desta página" e é sonda, não linha de base. A linha de base da RM-074 é a M0 (fatia abaixo), medida pelo ledger numa cópia descartável.
- **Objetivo/OKR:** a rodada intermediária de CHECK e de GO deixa de custar quase um quarto de hora, e o gate final deixa de ter um piso de CPU que nenhuma distribuição de lanes consegue vencer.
- **Hipótese:** se o Agile Check escolher, pelo diff, só os testes afetados nas rodadas intermediárias (atrás de flag, com a suíte completa no gate e no CI), cortar a CPU dos arquivos de teste mais caros e das claims que repetem a suíte, e rodar uma ferramenta de varredura por vez dentro do teto de memória, então a rodada intermediária cabe em 3 minutos e o gate completo se aproxima do mesmo alvo sem tirar nenhum arquivo, caso ou categoria de varredura, porque a RM-072 mediu que o tempo do gate é CPU de suíte (3.729 s) dividida por 7,2 CPUs, e não espera.
- **Métrica principal / linha de base / meta / janela / fonte:** duração de parede do Agile Check, em dois cortes (ver a decisão D1): a rodada intermediária com seletividade e o gate completo. Linha de base: 13 min 35 s a 14 min 25 s do Agile completo (RM-072, cópia descartável, três rodadas). Meta: no máximo 3 min na rodada intermediária; no gate completo, a meta é a da D1. Janela: três rodadas consecutivas depois de cada fatia. Fonte: `verify_run.duracaoMs` do ledger, por comando e por lane.
- **Métricas de proteção:** o gate executa o mesmo conjunto de arquivos e de testes da suíte completa (a lista de cada lane continua no ledger); as nove ferramentas de varredura continuam declaradas e comparadas por impressão digital; o Classic Check continua com o retrato contra a base `b16c5be8`; nenhum falso negativo da seletividade chega ao gate sem ser pego pela suíte completa; o pico de memória não passa do teto aprovado na D2.

## Fatos de partida (RM-072)

Números citados da página da RM-072, sem alteração; a coluna "Onde" diz a seção de origem.

| Fato | Valor | Onde |
| --- | --- | --- |
| Agile Check completo, três rodadas aprovadas | 13 min 35 s, 13 min 48 s e 14 min 25 s | "Medição do GO", rodadas 1 a 3 |
| Classic Check no mesmo commit | 20 min 37 s (reprovou um teste de scan com Docker real que já falhava na base) | "Medição do GO", rodada 4 |
| Fila hermética (`test`) no Agile | 12 min 48 s a 13 min 36 s, com a integração de 5 min 9 s a 5 min 20 s depois da varredura | "Medição do GO" |
| Varredura (`security_scan`) no Agile | 2 min 14 s a 4 min 24 s | "Medição do GO" |
| CPU da suíte na base | 3.729 s de CPU, 628 arquivos, 5.718 testes | "O piso físico" |
| Parede mínima com 7,2 CPUs | 518 s, acima dos 3 min com qualquer distribuição | "O piso físico" |
| Pico agregado de memória do Agile | 4,47 a 4,88 GiB contra o teto de 4 GB (Classic: 3,98 GiB) | "Medição do GO" |
| Preparo com `tsgo` na árvore fria | 6 a 7 s contra 1 min 13 s do `tsc` do Classic | "Medição do GO" |
| Maior arquivo de teste | `locale-f3d-snapshot.test.js`, 3 min 55 s | "Medição da linha de base" |
| Critérios não atingidos | 3 min de parede e 4 GB de pico; D3 os leva para uma RM nova | "Entregáveis e critérios de aceite" e D3 |

## Sondas desta página (26/10/2026)

O pedido manda não presumir o que não está medido na RM-072 nem medido agora. Estas sondas foram feitas numa máquina de 8 CPUs e 31 GB, na worktree da thread, sobre o commit da base da thread (`c3801f49`), com outras cargas na máquina. Nenhuma é linha de base: a linha de base é a M0, pelo ledger e numa cópia descartável. Servem para dizer onde procurar e o que a página pode afirmar.

### Sonda 1: onde a suíte gasta o tempo (parede por arquivo)

Fonte: o cache de durações por arquivo que o reporter `reporter-duracoes.mjs` grava a cada rodada das lanes, lido depois da última rodada local. É parede por arquivo sob concorrência (seis arquivos ao mesmo tempo na lane hermética), não CPU, e a soma passa da CPU da RM-072 por isso.

| Recorte | Valor |
| --- | --- |
| Arquivos `.test.js` compilados hoje | 645 (eram 628 na base da RM-072) |
| Soma das durações por arquivo | 4.586 s (4.166 s na lane hermética, 421 s na de integração) |
| Os 5 mais caros | 876 s, 19,1% da soma |
| Os 10 mais caros | 1.297 s, 28,3% |
| Os 20 mais caros | 1.802 s, 39,3% |
| Os 50 mais caros | 2.547 s, 55,5% |
| Os 100 mais caros | 3.309 s, 72,2% |
| Arquivos com 10 s ou mais | 106 de 645 |
| Arquivos com menos de 1 s | 256 de 645 |
| Acima do orçamento de 120 s por arquivo | 5: `locale-f3d-snapshot` 257 s, `security-scan-integracao` 225 s, `rede` 147 s, `noctum-integracao` 127 s e `noctum-coordenacao` 121 s |

Leitura: a cauda é concentrada. Cem arquivos, 15,5% do total, dão 72% do tempo, e 256 arquivos juntos custam pouco. Cortar CPU pede ir arquivo por arquivo nos primeiros 50, não trocar o runner (fora de escopo desde a RM-072).

### Sonda 2: custo isolado dos arquivos mais caros

Cada arquivo rodou sozinho, em sequência, com a casa temporária do `ork` como no `npm test`, medido por `/usr/bin/time` (parede, CPU de usuário e de sistema, pico de memória do processo). A máquina estava com carga média de 1 a 2 num total de 8 CPUs.

| Arquivo | Testes | Parede sozinho | CPU (usuário + sistema) | CPU por parede | Parede sob concorrência (sonda 1) | Pico de memória do maior processo |
| --- | --- | --- | --- | --- | --- | --- |
| `locale-f3d-snapshot` | 9 | 189 s | 219 s (172 + 46) | 1,16 | 257 s | 150 MB |
| `rede` | 79 | 105 s | 143 s (67 + 77) | 1,37 | 147 s | 119 MB |
| `locale-f3b-snapshot` | 2 | 73 s | 86 s (66 + 20) | 1,18 | 104 s | 109 MB |
| `noctum-integracao` | 25 | 92 s | 96 s (22 + 74) | 1,05 | 127 s | 138 MB |
| `noctum-coordenacao` | 28 | 76 s | 80 s (18 + 62) | 1,05 | 121 s | 128 MB |
| Soma dos cinco | 143 | 535 s | 625 s | | 756 s | |

Leitura:

- os cinco arquivos somam 625 s de CPU, 16,8% dos 3.729 s da RM-072 (cálculo sobre os dois números), com 143 testes de 5.718 (2,5%);
- cada um usa pouco mais de uma CPU por vez: são quase seriais, e o tempo vem de processos filhos sobrepostos só em parte (os casos do snapshot de locale sobem a CLI em processo filho, como o cabeçalho do arquivo diz);
- em `rede`, `noctum-integracao` e `noctum-coordenacao` o tempo de sistema passa o de usuário (77 contra 67 s, 74 contra 22 s e 62 contra 18 s), padrão de arquivo que sobe processo e mexe em disco, não de cálculo;
- o locale F3d tem só 9 testes e custa 219 s de CPU: o custo é por caso de CLI dentro do teste, não por teste, o que aponta para reaproveitar o processo ou o catálogo em vez de cortar caso (a hipótese, a provar na F2 com a paridade byte a byte);
- sozinhos, os arquivos rodam em 63 a 74% da parede que levam sob concorrência; a diferença é disputa de CPU e de disco entre arquivos, a confirmar na M0.

### Sonda 3: o que as claims repetem

Fonte: as claims da thread `ork-check5x` (136 no `claims.jsonl`) e os `verify_run` do ledger dela.

- 112 dos 136 comandos de claim rodam `node --test` sobre arquivos que a lane hermética ou a de integração também rodam, e 118 trazem um `build` na cadeia (que o Agile já troca pelo produto do preparo).
- Seis `verify_run` do ledger da thread (rodadas feitas na worktree dela, não numa cópia descartável, com 101 a 120 claims): rodada inteira de 30 min 44 s a 38 min 5 s; soma das `duracaoMs` das claims de 1.009 s a 1.262 s (de 16 min 49 s a 21 min 2 s); lane hermética de 786 s a 1.010 s; lane de integração de 306 s a 369 s; varredura de 130 s a 266 s.
- A parede da rodada fica perto de "soma das claims mais lane hermética" (por exemplo 1.936 s contra 1.098 s mais 823 s), o que indica que as claims correm em série com o grupo de lanes. É leitura do ledger, a confirmar na M0.
- As maiores claims individuais da thread levam 57 a 104 s (C31, C79, C43 e C70). O que cada uma roda, e quanto repete da suíte completa, fica para a M0.

Leitura: numa thread real, o `verify` não é só a suíte. As claims que reexecutam testes pesam tanto quanto a lane hermética, e uma seletividade que olha só a suíte deixa essa metade de fora. Duplicação de setup é uma frente de CPU por si.

### Sonda 4: a seletividade por grafo de importação, e o problema dos módulos centrais

Método: montar o fecho de `require` de cada arquivo de teste compilado (`dist-test`), com o conjunto de arquivos de `src` e de `test` que ele alcança; para cada um dos últimos commits sem merge que tocaram `core/src` ou `core/test`, selecionar os testes cujo fecho inclui um arquivo alterado (estático), e, no modo conservador, também todo teste que sobe processo filho, porque um teste que roda a CLI depende do produto inteiro.

| Medida | Valor |
| --- | --- |
| Arquivos de teste | 645 |
| Arquivos que sobem processo (heurística grossa sobre o texto: `spawn`, `execFile`, `dist/index.js`) | 131 |
| Módulos de `src` alcançados por algum teste | 356 |
| Módulos de `src` alcançados por 50% ou mais dos testes | 238 |
| Testes que alcançam a cadeia dos módulos `locale-*` | 591 de 645 |
| Últimos 60 commits: testes selecionados, estático (mediana, mínimo e máximo) | 59 (9%), 0 e 594 |
| Últimos 60 commits: conservador (mediana, mínimo e máximo) | 177 (27%), 0 e 599 |
| Últimos 60 commits: tempo selecionado, em % da soma das durações (mediana estático, mediana e terceiro quartil conservador) | 9%, 40% e 90% |
| Últimos 200 commits: testes selecionados, estático e conservador (mediana) | 561 e 567 de 645 |
| Últimos 200 commits: tempo selecionado, mediana e terceiro quartil conservador | 90% e 95% |

Leitura, com os limites:

- a janela de 60 commits favorece a seletividade (26 são da própria `ork-check5x`, 15 da `ork-grokbuild` e o resto de itens pequenos, trabalho concentrado em poucos módulos);
- a de 200 a desfavorece, porque muitos commits tocam módulos centrais;
- o ponto firme é estrutural: 238 de 356 módulos são alcançados pela maioria dos testes, e a cadeia de `locale-*` entra em 591 testes;
- um mapa só por grafo de importação seleciona quase tudo sempre que o diff toca um módulo central, e a seletividade não chega aos 3 minutos por esse caminho;
- falta medir o falso negativo (esta sonda não comparou com falha real) e o mapa por cobertura de linha, que a M0 mede; o custo de rodar a suíte com cobertura não foi medido.

### Sonda 5: peças do Agile em fallback no último `verify_run` da `ork-check5x`

Três das doze peças do Agile caíram para o equivalente do Classic naquela rodada: `tsgo` (build incremental do `tsc` presente), `cache-semgrep` (a regra de arquivo local troca o `check_id` e a impressão digital) e `binarios-nativos` (nenhum dos oito binários do catálogo tem versão nativa). São tempo de varredura e de preparo que o Agile promete e não entrega nessa condição. A RM-072 mediu a varredura sozinha em 80,9 s com o cache quente.

### Contexto de crescimento

O comentário do `orkastery.yaml` registra a suíte em 3,6 minutos com CPU livre em 10/10/2026, com 2.753 testes. A RM-072 mediu 5.718 testes em 24/10/2026, e a contagem de arquivos subiu de 628 para 645 desde a base dela. Os dois números vêm de máquinas e cargas diferentes e não são comparáveis em minutos, mas apontam o mesmo risco: a suíte cresce mais depressa que qualquer ganho pontual, e uma meta de tempo precisa de um orçamento de CPU que vigie o crescimento.

## O piso do gate: aritmética

Cálculo sobre os números da RM-072, não medida nova.

- Um gate de 3 minutos com 7,2 CPUs dá 180 s x 7,2 = 1.296 s de CPU para tudo: build, testes, claims e varredura.
- A suíte soma hoje 3.729 s. Mesmo com build, claims e varredura a custo zero, o corte necessário seria de pelo menos 65% (1 - 1.296 / 3.729) da CPU da suíte, sem tirar um caso.
- Seletividade não muda isso no gate, porque o gate roda a suíte completa por regra. Ela só reduz as rodadas intermediárias. Por isso o pedido tem as duas frentes, e por isso a decisão D1 pergunta ao dono o que os 3 minutos medem.
- Com 7,2 CPUs fixas, a suíte completa só chega a 3 minutos se a CPU cair de 3.729 s para um valor da ordem de 1.000 s (o resto do orçamento é de preparo, claims e varredura), ou se a máquina tiver mais CPUs, o que está fora de escopo.

## Escopo e validação

- **Incluído (esta página, Discovery):** a pesquisa, as sondas acima, as fatias com critério de aceite medido, o plano de medição e as decisões do dono. Nenhum código.
- **Fora de escopo:** trocar o runner `node:test`; reduzir a suíte, os arquivos de teste ou as categorias de varredura no gate; mexer no Classic Check; seletividade fora das rodadas intermediárias ou sem flag; mexer no CI hospedado além de manter `test:ci` equivalente; qualquer código antes da decisão do dono.
- **Entregáveis e critérios de aceite:** por fatia, na seção "Fatias". Em comum: cada medida vem do `verify_run` do ledger (`duracaoMs` por comando, por lane e da rodada), numa cópia descartável do projeto, com a lista de arquivos de cada lane gravada e comparada com a da suíte completa.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads do próprio Orkastery, em modo sombra primeiro (a seletividade escolhe e a suíte completa roda também, só para comparar). Interrompe se o falso negativo passar do limiar da D3, se algum critério de paridade da varredura falhar ou se uma fatia de CPU reduzir cobertura.

### Métricas

| Métrica | Linha de base | Meta | Fonte |
| --- | --- | --- | --- |
| Parede do Agile, rodada intermediária com seletividade | Não existe (a seletividade não existe); o Agile completo faz 13 min 35 s a 14 min 25 s | No máximo 3 min na rodada inteira, com a parte de teste abaixo de 90 s (a meta da F3 da RM-072) | `verify_run.duracaoMs` da rodada, nas três rodadas depois da fatia 1 |
| Parede do Agile, gate completo | 13 min 35 s a 14 min 25 s | A da D1; 3 min só se a CPU da suíte cair da ordem de 65% | `verify_run.duracaoMs`, três rodadas, sem seletividade |
| CPU total da suíte | 3.729 s de CPU para 628 arquivos e 5.718 testes (RM-072); 645 arquivos hoje | Meta a fixar na M0, da ordem de 1.000 s para o gate caber em 3 min; orçamento vigiado a cada rodada | Soma de `user` e `sys` por arquivo, medida na M0 e registrada por lane |
| Parede por arquivo de teste | 5 arquivos acima de 120 s; maior com 257 s sob concorrência (sonda 1) | Nenhum arquivo acima de 60 s, ou justificativa registrada | Reporter de durações, gravado no ledger |
| CPU duplicada entre claims e suíte | 112 de 136 comandos de claim rodam `node --test` (sonda 3) | Claim que repete arquivo da lane reaproveita o resultado da lane na mesma rodada, ou sai | Ledger: comando da claim contra a lista de arquivos da lane |
| Pico de memória agregado | 4,47 a 4,88 GiB no Agile (RM-072) | Dentro do teto da D2 | `docker stats` mais RSS da árvore do verify, como na RM-072, por `medir-check.cjs` |
| Falso negativo da seletividade contra a suíte completa | Não medido | Dentro do limiar da D3, com o limite superior de 95% informado e N mínimo da M0 | Comparação, em sombra, da lista escolhida com as falhas da suíte completa do mesmo commit |
| Cobertura no gate (proteção) | 628 arquivos (base da RM-072) e o mesmo conjunto de testes | Igual ou maior, a cada rodada | Lista de arquivos e contagem de testes por lane no ledger |

## Fatias

A numeração segue a ordem do pedido. A ordem de execução recomendada é a da decisão D4, e a M0 vem antes de todas.

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| M0 Bancada de medição (pré-requisito) | Cópia descartável do projeto, um comando que mede por arquivo `user`, `sys`, parede e pico de memória, a lista de arquivos e testes por lane, e o conjunto rotulado de diffs reais com a falha ou não de cada teste na suíte completa. Sem código de produto | Linha de base em três rodadas pelo ledger; CPU por arquivo para os 645; conjunto de diffs com N definido pela D3; o resultado desta página (sondas 1 a 5) refeito pelo ledger, com a variação entre rodadas |
| F1 Seletividade | Mapa de impacto arquivo para testes a partir do diff, nas rodadas intermediárias do GO e do CHECK, atrás de flag desligada por padrão; o motor sai da D3; a suíte completa continua obrigatória no gate final e no CI; as claims de teste entram no mesmo mapa | Rodada intermediária inteira em no máximo 3 min (teste abaixo de 90 s), três rodadas seguidas, pelo ledger; falso negativo dentro do limiar da D3 em sombra sobre os diffs da M0; teste que prova que o gate final roda a suíte completa em 100% dos casos e que a flag desligada dá o resultado de hoje; módulo central (os `locale-*`, 591 testes) tratado por regra explícita, não por seleção de tudo |
| F2 CPU da suíte | Os arquivos de teste mais caros (o snapshot de locale com 3 min 55 s, os que sobem processo ou Docker, a duplicação de setup, as claims que repetem a suíte), com meta de CPU total e de parede por arquivo e um orçamento que vigia o crescimento | CPU total da suíte na meta da M0; nenhum arquivo acima do orçamento; mesmo número de testes e de arquivos (nenhum caso removido), provado pela lista por lane; paridade byte a byte onde o teste é de snapshot; gate completo medido em três rodadas pelo ledger |
| F3 Memória | Uma ferramenta por vez na varredura do grupo e o pico de volta para dentro do teto da D2, medindo o que isso custa em tempo | Pico agregado dentro do teto em três rodadas; varredura com as nove ferramentas e zero achado novo ou desaparecido por impressão digital; custo em tempo da varredura medido e registrado, e aceito pelo dono se passar do limite da D2 |
| F4 Dívida da RM-072 que pesa no tempo ou na confiança | O que a tabela "A dívida da RM-072" diz que entra: redação do motivo da peça `imagem-de-lint`, a lane caída sem veredito e o texto do gate, a data sem ano e o caso de `GMT+0` do snapshot de locale, os casos que faltam, a paridade do `tsgo` fora da thread de origem e as peças em fallback | Cada item da tabela com caso de teste que falha sem a correção; nenhum arquivo ou categoria de varredura removido; peças `tsgo`, `cache-semgrep` e binários nativos com o motivo do fallback medido e, onde o fallback some, o ganho em segundos pelo ledger |

## A dívida da RM-072

Origem: a seção "Dívida aceita no CHECK" da RM-072. A tabela diz o que pesa no tempo ou na confiança do Agile e para onde cada item vai nesta página; o que não pesa fica como follow-up.

| Item da RM-072 | Pesa em | Destino |
| --- | --- | --- |
| O motivo da peça `imagem-de-lint` (a última linha do `docker build`) chega ao ledger sem redação | Confiança (dado no ledger) | F4 |
| A lane caída sem veredito que não seja por tempo deixa o `test` sem veredito no Agile, mais estrito que o comando único do Classic | Confiança e tempo (rodada refeita) | F4 |
| O texto do gate do `test` sem veredito não diz qual lane ficou sem veredito nem por quê | Confiança (diagnóstico) | F4 |
| A URL legítima no fim do motivo de uma peça também sai, e a expressão percorre a linha inteira antes do corte | Pouco; cosmético | Follow-up fora das fatias |
| O snapshot pt-BR F3c tem datas sem ano, que passam a sair com o ano em 01/01/2027 e o deixam vermelho para todos nesse dia | Confiança do gate; e o snapshot de locale é o maior consumidor de CPU | F2, junto do snapshot de locale; prazo real: 67 dias a partir desta página |
| O caso de janeiro da legenda do fuso espera `GMT+0`, que o Node 20.20.2 e o 22.23.2 escrevem | Confiança | F4 |
| Faltam casos para o teto de 180 s do build da imagem de lint, para o teto dos trabalhadores, para o cache por usuário no trabalhador nativo, para a evidência das lanes com outra raiz de estado e para o `executado` do ramo do relógio | Confiança | F4 |
| O trabalhador da varredura roda por string de shell, sem risco hoje; o caso com Docker real do `runScanAgil` só existe nas rodadas de medição; restam limpezas de manutenção | Confiança; o caso com Docker real é candidato à lane de integração e pesa em tempo | F4, com o custo do caso medido |
| A paridade do `tsgo` com o `tsc` só é conferida a cada rodada na thread de origem, pela C70 | Confiança | F4 |
| A tabela de estado gerada por `ork docs sincronizar` usa travessão nas células vazias | Nenhum | Follow-up fora das fatias |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** a posição no índice de prioridade é decisão do dono; esta página registra a origem (D3 da RM-072, 24/10/2026) e o pedido de abrir o item em Discovery (26/10/2026).
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. Marcos: M0 com a linha de base pelo ledger; cada fatia com três rodadas medidas; revisão do dono depois da F2, quando o piso de CPU do gate estiver medido. Confiança: alta para a F3 (memória) e a F4, média para a F2, baixa para a F1 até a M0 medir o mapa por cobertura, porque a sonda 4 mostra que o grafo de importação sozinho seleciona quase tudo nos módulos centrais.
- **Dependências e bloqueios (ID, owner, próxima revisão):**
  - [RM-072](RM-072-check-cinco-vezes-mais-rapido.md): origem. Entrega o Agile Check, o `verify_run` com `duracaoMs`, as lanes, `core/scripts/medir-check.cjs`, o reporter de durações e a F3 (seletividade) que esta página assume. Já mesclada; a dívida dela entra aqui pela D3 dela.
  - [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md), frente 1 (F1: modelos de decisão que escolhem testes pelo diff): o mapa determinístico desta página é a base e a verdade de comparação da frente dela; o modelo só entra como sinal sobre o mapa, nunca como prova. As duas partilham o limiar de falso negativo (D1 da RM-073) e a regra de que o gate roda a suíte completa. Ordem proposta: o mapa (esta página) antes do modelo.
  - [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md): o custo e o tempo por fase no relatório da esteira são a fonte de leitura da melhora (a rodada do CHECK em minutos por fase) depois que a RM-071 entregar; até lá a fonte é o `verify_run`.
  - [RM-062](RM-062-repositorio-publico-sem-dado-privado.md): se a F1 usar modelo externo, a barreira de dado privado vale; o mapa determinístico não envia nada.
  - Decisão do dono sobre D1 a D4.
- **Premissas / riscos / mitigação:**
  - **Falso negativo da seletividade: um teste que falharia fica de fora da rodada intermediária.** Mitigação: sombra primeiro, limiar da D3, suíte completa obrigatória no gate e no CI, e a flag desligada dá o resultado de hoje.
  - **Módulos centrais selecionam tudo** (238 de 356 módulos, 591 testes na cadeia de `locale-*`). Mitigação: mapa por cobertura de linha medido na M0, e regra explícita para os módulos centrais, em vez de selecionar tudo ou nada; se a M0 não mostrar ganho, a F1 volta ao dono.
  - **Testes que sobem processo escondem a dependência** (131 arquivos pela heurística grossa). Mitigação: tratar o produto inteiro como dependência desses testes no mapa, e medir quantos deles a rodada intermediária precisa.
  - **Cortar CPU vira cortar cobertura.** Mitigação: a regra é o número de arquivos e de testes igual ou maior, por lane, no ledger; um teste que perde caso reprova a fatia.
  - **A suíte cresce mais depressa que o ganho** (2.753 testes em 10/10, 5.718 em 24/10, 645 arquivos hoje contra 628). Mitigação: o orçamento de CPU e de parede por arquivo vigiado a cada rodada, não só medido uma vez.
  - **Memória contra tempo.** Uma ferramenta por vez derruba o pico, mas alonga a varredura que a RM-072 deixou em 80,9 s quente. Mitigação: medir o custo na F3 e deixar a troca para a D2.
  - **Medida varia com a carga.** A RM-072 e esta página rodaram com outras cargas na máquina; o `verify_run` grava o roubo de CPU (`steal`) por rodada, de 7,9% a 14,1% nas seis rodadas lidas. Mitigação: três rodadas por medida, o `steal` junto, e a variação entre rodadas no relatório.
  - **O que a página não mediu:** o custo de rodar a suíte com cobertura, o falso negativo de qualquer seletividade e a CPU (`user` mais `sys`) dos 645 arquivos. Tudo isso é a M0.
- **Não-objetivos:** reduzir a suíte; trocar o runner; seletividade no gate ou no CI; tirar o Classic Check; divulgação e versão no npm.

### Decisões do dono

Pendentes. Cada uma traz três alternativas e uma recomendada, no formato da RM-057; nada abaixo está decidido.

**D1. O que os "3 minutos" medem.** Pendente.

1. Só a rodada intermediária com seletividade: o gate completo fica sem meta numérica além de não piorar. Entrega o alvo do pedido pelo caminho mais curto, mas deixa o gate no piso de 518 s ou acima, e a RM fecha sem o corte de CPU.
2. **Dois alvos (recomendada).** A rodada intermediária em no máximo 3 min, e o gate completo com meta escalonada que a M0 fixa a partir do piso medido de CPU, com 3 min como alvo final condicionado a um corte de cerca de 65% da CPU da suíte (aritmética acima). O dono revê depois da F2. É o único desenho que mede o que cada frente pode entregar sem prometer o que a aritmética não sustenta.
3. Os 3 minutos só no gate completo: a F1 vira opcional e a F2 precisa cortar a CPU da suíte de 3.729 s para a ordem de 1.000 s sem perder um caso. Alvo mais fiel ao pedido literal, com risco alto de não fechar e de empurrar corte de caso de teste.

**D2. O teto de memória da varredura.** Pendente.

1. Manter os 4 GB como teto duro, com uma ferramenta por vez no grupo e qualquer custo de tempo aceito. Cumpre o critério da RM-072, ao preço de alongar a varredura (a medir).
2. **Os 4 GB como alvo, com troca medida (recomendada).** A F3 mede o pico e o tempo com uma ferramenta por vez; se o custo da varredura passar de um limite que o dono fixa depois da medição, o teto sobe por máquina, declarado no manifesto e registrado no ledger com o pico real. Evita escolher o limite no escuro e mantém a regra de que o pico fica visível.
3. Aceitar 5 GiB como teto declarado para máquinas de 16 GB ou mais, sem mexer na varredura. Zero custo de tempo, mas deixa de proteger máquinas pequenas, que é a razão do critério original.

**D3. Motor da seletividade e limiar de falso negativo.** Pendente.

1. Mapa por grafo de importação: determinístico e simples, mas a sonda 4 mostra que seleciona 90% do tempo na janela de 200 commits.
2. **Mapa por cobertura de linha, medido na M0, com o grafo como regra para o que a cobertura não vê (recomendada).** Seleciona pelo teste que de fato executa a linha alterada, trata módulo central e processo filho por regra explícita, e usa o limiar da D1 da RM-073 (até 2% observado nas rodadas intermediárias, com limite superior de 95% até 5%, e o gate completo sempre). O modelo da RM-073 só entra depois, como sinal sobre este mapa. Custo: medir a suíte com cobertura, que esta página não mediu.
3. Só o modelo de decisão da RM-073, sem mapa determinístico: encurta o caminho, mas troca uma regra auditável por um sinal, e a verdade de comparação some.

**D4. Ordem das fatias.** Pendente.

1. A do pedido: seletividade, CPU, memória, dívida. Entrega o item que o dono pôs em primeiro, mas a seletividade depende de medir o custo por arquivo, que é da F2.
2. **M0, depois F3 (memória) e F4 (dívida) em paralelo, depois F2 (CPU) e por fim F1 (seletividade) (recomendada).** Memória e dívida são pequenas, de alta confiança e destravam um verify confiável para medir o resto; a CPU por arquivo da M0 alimenta o mapa da seletividade e corta o custo de toda rodada, inclusive as que a seletividade não evita; a F1 é a de menor confiança até a M0. Custo: a seletividade, a mais visível, é a última.
3. Tudo em paralelo depois da M0: fecha mais cedo, ao custo de medidas que se atrapalham, porque as rodadas disputam a mesma CPU.

## Fontes

- Página da RM-072 lida inteira em 26/10/2026: "Medição da linha de base", "Medição do GO", "O piso físico", D2, D3 e "Dívida aceita no CHECK".
- Sondas 1 a 5 desta página (26/10/2026): cache de durações por arquivo do reporter `reporter-duracoes.mjs`, `claims.jsonl` e `verify_run` do ledger da thread `ork-check5x`, fecho de `require` dos testes compilados contra o histórico do git, `/usr/bin/time` sobre os arquivos mais caros. Os scripts das sondas foram descartáveis e não estão no repositório; a M0 refaz tudo pelo ledger.
- Código citado: `core/scripts/test-lanes.cjs`, `core/scripts/reporter-duracoes.mjs`, `core/scripts/medir-check.cjs`, `core/src/integracoes-locais.ts`, `core/package.json`, `orkastery.yaml`.
- Páginas citadas: [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md), [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md), [RM-062](RM-062-repositorio-publico-sem-dado-privado.md).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-26 | Julio |
| Documentação | Rascunho | — | 2026-10-26 | Julio |
| Código | Branch criada | — | 2026-10-26 | Julio |
| Testes | Não iniciados | — | 2026-10-26 | Julio |
| Deploy | Não implantado | — | 2026-10-26 | Julio |
| Exposição | Flag desligada | — | 2026-10-26 | Julio |
| Habilitação | Pendente | — | 2026-10-26 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: sessão condutora da thread `ork-orkcheck3min`; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** pesquisa, sondas e página pela sessão de GO da `ork-orkcheck3min` em modo `#Fast`, sem código; as decisões D1 a D4 ficam com o dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono responde D1 a D4; depois, abrir a thread da M0; responsável: Julio; prazo: a definir.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-26 | Item criado em Discovery, só página e pesquisa, com M0 e quatro fatias, e quatro decisões pendentes | D3 da RM-072 (24/10/2026, resposta 3a) e pedido do dono de 26/10/2026; sondas da seção "Sondas desta página" | Julio |
