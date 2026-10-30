---
id: RM-074
tipo: roadmap
titulo: Agile Check cerca de 1,7 vez mais rápido que o Classic
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-30T09:22:04-03:00
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
    commit: ab26364f
    pr: null
sdlc:
  thread: ork-rm074m2harne
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-074: Agile Check cerca de 1,7 vez mais rápido que o Classic, sem perder cobertura

> **Em uma frase:** o Agile Check completo, com a mesma bateria na mesma máquina, mira cerca de 1,7 vez o Classic, sem remover testes e com perda de qualidade de mutação limitada a 10%.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono (26/10/2026):** criar o item em Discovery, só página e pesquisa, sem código.

**Decisão vigente do dono (29/10/2026, alternativa 2.c):** a meta é o Agile Check completo cerca de 1,7 vez mais rápido que o Classic Check, na mesma máquina e com a mesma bateria, com no máximo 10% de perda de qualidade. Esta decisão substitui a meta de três vezes registrada em 27/10/2026. Nenhuma meta, critério, título ou resumo desta página usa duração absoluta: cada usuário do Orkastery tem máquinas e VPSs diferentes, e um tempo absoluto enviesaria o produto para uma máquina só.

- **Frentes medidas:** CPU da suíte, memória, a dívida do CHECK da RM-072 e, fora do caminho da meta, a seletividade nas rodadas intermediárias.
- **Origem:** a D3 da [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), decidida pelo dono em 24/10/2026 (resposta 3a): lançar o Agile Check com as fatias 1 e 2 e levar a meta de tempo para uma RM nova.
- **Regras inegociáveis:**
  - a cobertura não cai no gate;
  - nenhum teste é removido ou transformado em `skip`;
  - a mutação dos arquivos tocados não piora mais de 10%;
  - o Classic Check fica intacto;
  - a seletividade vale só para rodadas intermediárias e atrás de flag;
  - toda medida vem do ledger (`verify_run`, `duracaoMs`) numa cópia descartável do projeto;
  - o desempenho se diz em grandezas que não dependem do hardware: a razão contra o Classic Check na mesma máquina e no mesmo commit, o corte percentual da CPU da suíte contra a linha de base e a eficiência de paralelismo (a CPU total dividida pelos núcleos, contra a parede); a duração absoluta fica no `verify_run.duracaoMs` como evidência bruta e não vai para o texto.

## M0 — bancada coletada

A instrumentação da M0 e os casos MC9 a MC22 estão no commit `fabc6429`. A bancada
mediu, no commit `476410d6`, três pares de Agile e Classic, três passes por arquivo,
645 arquivos e 5.910 testes. O [JSON bruto](evidencias/RM-074/m0-bancada-bruta.json)
e a [leitura das sondas](evidencias/RM-074/m0-bancada.md) são a evidência da fatia.
A coleta da M0 está concluída; a razão de produto continua sem linha de base confiável.

A razão observada `Classic ÷ Agile` foi de 0,693, 0,926 e 0,971 vez. Nas duas
primeiras, o Agile aprovou e o Classic saiu 1; no terceiro par, os dois modos saíram 1.
O roubo de CPU foi de 14,2%, 24,6% e 52,4% no Agile e de 9,3%, 25,9% e 40,7%
no Classic. Portanto, a M0 prova que a bancada coleta as grandezas e aponta contenção
material, mas não prova vantagem ou desvantagem de um modo. Esta leitura e a meta
de três vezes são históricas e foram substituídas pela recoleta e pela decisão de
29/10/2026 abaixo.

A eficiência da suíte no Agile variou de 43,9% a 61,4%, com média de 50,4%. Para a
F2, o orçamento provisório é **pelo menos 60% de eficiência** e **pelo menos 63% de
corte da CPU da suíte** contra a média da M0. Com oito núcleos, a CPU média da suíte
equivale a 53,4% da parede Classic sob paralelismo perfeito; a 60% de eficiência, o
corte para a suíte caber em um terço é 62,6%, arredondado para cima. Esse orçamento
pertencia à antiga meta de três vezes; não é critério da M1.

### Recoleta da M0 em 30/10/2026

A recoleta que abre a M1 foi feita na `main` `6a30b24c`, com uma bateria idêntica
nos dois modos e uma máquina de 7 CPUs. O par mediu razão `Classic ÷ Agile` de
0,973 e razão de CPU de 0,997: empate de parede e de CPU. A CPU da suíte desta
coleta é a referência de 100% para o corte da M1. A bateria registrou 655 arquivos
e 6.075 testes; as reprovações dos dois modos foram preservadas como linha de base,
portanto o par serve ao diagnóstico e não é apresentado como gate aprovado.

A lane hermética responde por 86,5% da parede da suíte; os cinco arquivos mais
caros somam 23,4%. Nos arquivos pesados, a parcela de CPU de sistema chega a 77,1%,
compatível com o custo de criar processos. As claims ocupam 9,6% da parede do Agile
e 5,1% da do Classic, repetindo build e arquivos que as lanes já executaram. A cadeia
de locale alcança 602 de 655 arquivos, por isso a seleção por dependência fica fora
desta fatia.

### Resultado da M1 e diagnóstico de entrada da M2

A bancada da M1, no commit `4f4d4b55`, mediu razão `Classic ÷ Agile` de 1,15 e
razão de CPU de 1,06. É uma indicação, não um aceite: o roubo de CPU foi de 7,3%
num modo e 11,6% no outro. A CPU da suíte ficou 13,0% acima da recoleta usada como
linha de base. A própria bancada conta 6.126 testes na M1 contra 6.075 na base:
mantido o custo médio anterior, os 51 testes novos explicam 0,84 ponto desse aumento,
e a regressão de CPU por teste explica 12,21 pontos. O handoff da M1 também registrou
5.925 testes na base; se esse retrato for usado, os 201 testes novos explicam 3,39
pontos e a regressão por teste, 9,66. A divergência fica explícita; a decomposição
principal segue os JSONs da mesma bancada.

Na M1, a lane hermética ocupou 90,7% da parede de teste. Os cinco maiores arquivos
somaram 17,3% e os vinte maiores, 36,0%. As claims ainda ocuparam 11,4% da parede
do Agile, contra 5,0% no Classic. A reanálise do bruto da M1 selecionou, antes da
mudança da M2, os dez maiores pela parede sob concorrência. A coluna “sistema” é a
parcela observável de CPU do sistema na árvore — a aproximação para criação de
processos, espera e filesystem; ela não atribui todo esse custo exclusivamente ao
`spawn`.

| Arquivo | Testes | CPU da suíte | Sistema na CPU do arquivo | Sozinho ÷ concorrente |
| --- | ---: | ---: | ---: | ---: |
| `security-scan-integracao` | 5 | 0,27% | 50,7% | 0,94 |
| `rede` | 79 | 4,11% | 53,6% | 0,72 |
| `noctum-integracao` | 25 | 2,76% | 78,0% | 0,95 |
| `noctum-maquinas` | 27 | 2,44% | 77,3% | 1,30 |
| `noctum-coordenacao` | 28 | 2,53% | 78,2% | 1,00 |
| `projeto-alvo-declaracao` | 6 | 1,08% | 23,6% | 0,44 |
| `noctum-entrega` | 36 | 1,29% | 77,3% | 1,10 |
| `rm036-leases-canonicos` | 38 | 1,36% | 25,7% | 0,67 |
| `p4-worktree-por-thread` | 20 | 0,76% | 27,9% | 0,43 |
| `locale-f2b-snapshot` | 1 | 1,23% | 22,4% | 0,75 |

A M2 leva o harness somente aos cenários de resposta em `rede`,
`projeto-alvo-declaracao`, `p4-worktree-por-thread` e `locale-f2b`; sinais, PATH,
rede e Docker reais, Git, locks e concorrência continuam em processo filho. Nas
claims, a M2 reaproveita a auditoria TAP canônica e remove o preparo único depois
apenas de leituras `grep -q`; outra forma de shell continua inteira. A bancada M2
ainda não foi coletada no host real, portanto esta página não atribui a ela razão
nem CPU da suíte sem evidência. A razão da M2 só sai da bancada da sessão condutora,
fora deste sandbox.

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz o `ork` e o próprio Orkastery. A RM-072 deixou o Agile Check de 1,43 a 1,52 vez mais rápido que o Classic no mesmo commit e parou aí: a lane hermética ocupa 94% da parede do Agile, e ela é presa em CPU, não em espera. Cada rodada de GO-FIX e de CHECK paga a suíte inteira, mesmo quando o diff toca uma tela de texto.
- **Evidências e fonte:** os números de partida são da RM-072 (seção "Fatos de partida"); o que esta página mediu em 26/10/2026 está em "Sondas desta página" e é sonda, não linha de base. A linha de base da RM-074 é a M0 (fatia abaixo), medida pelo ledger numa cópia descartável.
- **Objetivo/OKR:** o gate completo chega a cerca de 1,7 vez o Classic na mesma máquina e com a mesma bateria, sem tirar arquivo, teste, asserção ou categoria de varredura.
- **Hipótese da M1:** executar o CLI no processo dos testes que não verificam fronteiras reais de processo, e reaproveitar nas claims o resultado nominal das lanes no mesmo HEAD e ambiente, corta criação de processos e trabalho duplicado sem mudar a bateria observável.
- **Métrica principal / linha de base / meta / janela / fonte:** a razão entre a parede do Classic Check e a do Agile Check completo, na mesma máquina, no mesmo commit e com a mesma bateria. Linha de base vigente: 0,973 na recoleta M0 de 30/10/2026. Meta: cerca de 1,7 vez, decisão 2.c do dono em 29/10/2026. Fonte: pares da bancada `medir-check.cjs`; a CPU da suíte é comparada em percentual contra a recoleta M0.
- **Métricas de proteção:** a bateria mantém arquivos, testes e asserções; nenhum teste vira `skip`; a mutação dos arquivos tocados não piora mais de 10%; as nove ferramentas de varredura continuam declaradas e comparadas por impressão digital; o Classic Check continua intacto.

## Fatos de partida (RM-072)

Números da página da RM-072, já em razão e percentual pela regra do dono de 27/10/2026; a coluna "Onde" diz a seção de origem. Onde a célula diz "cálculo", a conta é desta página, sobre os números de lá.

| Fato | Valor | Onde |
| --- | --- | --- |
| Agile Check completo, três rodadas aprovadas | 1,43, 1,49 e 1,52 vez o Classic no mesmo commit (70%, 67% e 66% da parede dele) | "Medição do GO", rodadas 1 a 3 |
| Classic Check no mesmo commit | a referência (razão 1); reprovou um teste de scan com Docker real que já falhava na base | "Medição do GO", rodada 4 |
| Partes do Classic | preparo 6%, `test` 65%, varredura 25%, claims e o resto 4% da parede | "Medição do GO", rodada 4 |
| Lane hermética no Agile | 94% da parede do Agile; de 95% a 101% do `test` do Classic | "Medição do GO" (cálculo) |
| Lane de integração no Agile | de 38% a 42% do `test`, depois da varredura | "Medição do GO" |
| Varredura no Agile | de 43% a 85% da do Classic; sozinha e com o cache quente, 2,1 vezes mais rápida que a dele | "Medição do GO" |
| Suíte com paralelismo perfeito | 42% da parede do Classic (a CPU da suíte na base, dividida pela cota de 7,2 CPUs) | "O piso físico" |
| Teto sem cortar CPU | 2,4 vezes o Classic, com qualquer distribuição | "O piso físico" |
| Eficiência de paralelismo da suíte | de 63% a 67% no Agile e 64% no Classic | "Medição do GO" e "O piso físico" (cálculo) |
| Pico agregado de memória do Agile | de 1,12 a 1,23 vez o do Classic (4,47 a 4,88 GiB contra 3,98 GiB), acima do teto de 4 GB da RM-072 | "Medição do GO" |
| Preparo com `tsgo` na árvore fria | de 10 a 12 vezes mais rápido que o do Classic | "Medição do GO" |
| Maior arquivo de teste | `locale-f3d-snapshot.test.js`, sozinho um quarto da parede do `npm test` da linha de base | "Medição da linha de base" |
| Critérios não atingidos | 5 vezes de razão e 4 GB de pico; a D3 os traz para esta página | "Entregáveis e critérios de aceite" e D3 |

## Sondas desta página (26/10/2026)

O pedido manda não presumir o que não está medido na RM-072 nem medido agora. Estas sondas foram feitas numa máquina de 8 CPUs e 31 GB, na worktree da thread, sobre o commit da base da thread (`c3801f49`), com outras cargas na máquina. Nenhuma é linha de base: a linha de base é a M0, pelo ledger e numa cópia descartável. Servem para dizer onde procurar e o que a página pode afirmar. Os números ficam em percentual e razão; a duração de cada arquivo fica no cache do reporter e no ledger.

### Sonda 1: onde a suíte gasta o tempo (parede por arquivo)

Fonte: o cache de durações por arquivo que o reporter `reporter-duracoes.mjs` grava a cada rodada das lanes, lido depois da última rodada local. É parede por arquivo sob concorrência (seis arquivos ao mesmo tempo na lane hermética), não CPU, e a soma passa da CPU da RM-072 por isso.

| Recorte | Valor |
| --- | --- |
| Arquivos `.test.js` compilados hoje | 645 (eram 628 na base da RM-072, 2,7% a mais) |
| Soma das durações por arquivo, por lane | 91% na lane hermética e 9% na de integração |
| Os 5 mais caros | 19,1% da soma |
| Os 10 mais caros | 28,3% |
| Os 20 mais caros | 39,3% |
| Os 50 mais caros | 55,5% |
| Os 100 mais caros | 72,2% |
| Arquivos com 0,22% da soma ou mais, cada um | 106 de 645 |
| Arquivos com menos de 0,022% da soma, cada um | 256 de 645 |
| Acima de 2,6% da soma, cada um (o orçamento por arquivo da F2 da RM-072) | 5: `locale-f3d-snapshot` 5,6%, `security-scan-integracao` 4,9%, `rede` 3,2%, `noctum-integracao` 2,8% e `noctum-coordenacao` 2,6% |

Leitura: a cauda é concentrada. Cem arquivos, 15,5% do total, dão 72% do tempo, e 256 arquivos juntos custam pouco. Cortar CPU pede ir arquivo por arquivo nos primeiros 50, não trocar o runner (fora de escopo desde a RM-072).

### Sonda 2: custo isolado dos arquivos mais caros

Cada arquivo rodou sozinho, em sequência, com a casa temporária do `ork` como no `npm test`, medido por `/usr/bin/time` (parede, CPU de usuário e de sistema, pico de memória do processo). A máquina estava com carga média de 1 a 2 num total de 8 CPUs.

| Arquivo | Testes | CPU, em % da CPU da suíte na base da RM-072 | Sistema, em % da CPU do arquivo | CPU por parede | Parede sozinho, em % da parede sob concorrência (sonda 1) | Pico de memória do maior processo |
| --- | --- | --- | --- | --- | --- | --- |
| `locale-f3d-snapshot` | 9 | 5,9% | 21% | 1,16 | 74% | 150 MB |
| `rede` | 79 | 3,8% | 54% | 1,37 | 71% | 119 MB |
| `locale-f3b-snapshot` | 2 | 2,3% | 23% | 1,18 | 70% | 109 MB |
| `noctum-integracao` | 25 | 2,6% | 77% | 1,05 | 72% | 138 MB |
| `noctum-coordenacao` | 28 | 2,1% | 78% | 1,05 | 63% | 128 MB |
| Soma dos cinco | 143 | 16,8% | | | 71% | |

Leitura:

- os cinco arquivos somam 16,8% da CPU da suíte que a RM-072 mediu (cálculo sobre os dois números), com 143 testes de 5.718 (2,5%);
- cada um usa pouco mais de uma CPU por vez (de 1,05 a 1,37 de CPU por parede): são quase seriais, e o tempo vem de processos filhos sobrepostos só em parte (os casos do snapshot de locale sobem a CLI em processo filho, como o cabeçalho do arquivo diz);
- em `rede`, `noctum-integracao` e `noctum-coordenacao` o tempo de sistema passa o de usuário (54%, 77% e 78% da CPU do arquivo), padrão de arquivo que sobe processo e mexe em disco, não de cálculo;
- o locale F3d tem só 9 testes e custa 5,9% da CPU da suíte: o custo é por caso de CLI dentro do teste, não por teste, o que aponta para reaproveitar o processo ou o catálogo em vez de cortar caso (a hipótese, a provar na F2 com a paridade byte a byte);
- sozinhos, os arquivos rodam em 63% a 74% da parede que levam sob concorrência; a diferença é disputa de CPU e de disco entre arquivos, a confirmar na M0.

### Sonda 3: o que as claims repetem

Fonte: as claims da thread `ork-check5x` (136 no `claims.jsonl`) e os `verify_run` do ledger dela.

- 112 dos 136 comandos de claim rodam `node --test` sobre arquivos que a lane hermética ou a de integração também rodam, e 118 trazem um `build` na cadeia (que o Agile já troca pelo produto do preparo).
- Seis `verify_run` do ledger da thread (rodadas feitas na worktree dela, não numa cópia descartável, com 101 a 120 claims): a soma das `duracaoMs` das claims vale de 55% a 60% da parede da rodada; a lane hermética, de 40% a 45%; a de integração, de 37% a 39% da hermética; a varredura, de 6% a 14% da rodada.
- Nas seis, a soma das claims com a lane hermética dá 99% da parede da rodada, o que indica que as claims correm em série com o grupo de lanes. É leitura do ledger, a confirmar na M0.
- As maiores claims individuais da thread (C31, C79, C43 e C70) valem, cada uma, de 4,5% a 10,3% da soma das claims de uma rodada. O que cada uma roda, e quanto repete da suíte completa, fica para a M0.

Leitura: numa thread real, o `verify` não é só a suíte. As claims que reexecutam testes pesam mais que a lane hermética, e uma seletividade que olha só a suíte deixa essa metade de fora. Duplicação de setup é uma frente de CPU por si.

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
- um mapa só por grafo de importação seleciona quase tudo sempre que o diff toca um módulo central;
- falta medir o falso negativo (esta sonda não comparou com falha real) e o mapa por cobertura de linha; o custo de rodar a suíte com cobertura não foi medido.

### Sonda 5: peças do Agile em fallback no último `verify_run` da `ork-check5x`

Três das doze peças do Agile caíram para o equivalente do Classic naquela rodada: `tsgo` (build incremental do `tsc` presente), `cache-semgrep` (a regra de arquivo local troca o `check_id` e a impressão digital) e `binarios-nativos` (nenhum dos oito binários do catálogo tem versão nativa). São tempo de varredura e de preparo que o Agile promete e não entrega nessa condição. A RM-072 mediu a varredura sozinha, com o cache quente, 2,1 vezes mais rápida que a do Classic.

### Contexto de crescimento

O comentário do `orkastery.yaml` registra a suíte com 2.753 testes em 10/10/2026; a RM-072 mediu 5.718 testes em 24/10/2026, 2,1 vezes mais em duas semanas, e a contagem de arquivos subiu de 628 para 645 desde a base dela. Os dois retratos vêm de máquinas e cargas diferentes e não se comparam em tempo, mas apontam o mesmo risco: a suíte cresce mais depressa que qualquer ganho pontual, e a meta precisa de um orçamento de CPU, em percentual da linha de base, que vigie o crescimento.

## O piso do gate: aritmética histórica

Cálculo histórico sobre as medições da RM-072 ("Medição do GO", rodadas 1 a 4, e "O piso físico"), não medida nova. Tudo em frações da parede do Classic Check da rodada 4, chamada W, no mesmo commit e na mesma máquina. Os valores são aproximados, para ordem de grandeza; a seção da M0 acima traz o orçamento recalculado sobre a bancada atual.

- **c:** o corte da CPU da suíte contra a linha de base (0% hoje).
- **e:** a eficiência de paralelismo da suíte, a CPU total dividida pelos núcleos, contra a parede da suíte (de 63% a 67% na RM-072; 65% nesta conta histórica).
- **A suíte com paralelismo perfeito** (e = 100%, c = 0%) ocupa 0,42 W.
- **A meta histórica:** a parede do Agile em até um terço da do Classic, 0,33 W.

No Agile, a lane hermética domina (94% da parede) e o preparo custa 0,5% de W; a varredura e a integração correm ao lado dela, uma depois da outra. A parede do Agile fica perto de 0,005 W + 0,42 W x (1 - c) / e.

- **Sem cortar CPU, a meta não fecha:** nem com paralelismo perfeito o Agile passa de 2,4 vezes o Classic.
- **Corte só no Agile** (o Classic fica igual, W = 1): o corte vem de alavancas que só o Agile usa, como a claim que reaproveita o resultado da lane, o processo ou o catálogo reaproveitados dentro da lane e a repetição de setup.
- **Corte nos dois modos** (a mudança é nos arquivos de teste, que o Classic também roda): o Classic também encolhe, para 0,35 W + 0,65 W x (1 - c), e o Agile precisa ficar em até um terço disso.

| Eficiência de paralelismo (e) | Corte de CPU necessário, só no Agile | Corte de CPU necessário, nos dois modos |
| --- | --- | --- |
| 65% (a de hoje) | 49% | 74% |
| 80% | 37% | 64% |
| 90% | 30% | 56% |
| 100% | 22% | 45% |

Leitura:

- o corte que só o Agile faz rende mais que o corte no arquivo de teste, que o Classic também ganha: com a eficiência de hoje, 49% contra 74%;
- subir a eficiência de paralelismo de 65% para 90% baixa o corte necessário em 19 pontos no caso só do Agile (de 49% para 30%); o maior arquivo limita essa subida, porque sozinho ele já leva cerca de 15% de W, e 21% sob concorrência (sonda 2, ordem de grandeza);
- a cadeia varredura e integração também precisa caber: hoje ela soma de 0,36 W (cache quente) a 0,46 W (cache frio), acima dos 0,33 W da meta; precisa encolher de 9% a 29%, ou a integração deixar de esperar a varredura inteira, o que pesa na D2;
- a conta vale para a bancada da RM-072, com três claims representativas; a M0 atual fixou o mesmo conjunto nos dois modos e mediu que as três claims repetem arquivos das lanes e trazem build, mas o roubo e as reprovações impedem usar a razão observada como linha de base de produto;
- seletividade não muda o gate, que roda a suíte completa por regra (D1); ela só reduz as rodadas intermediárias.

## Escopo e validação

- **Incluído (esta página, Discovery):** a pesquisa, as sondas acima, as fatias com critério de aceite medido em razão e percentual, o plano de medição e as decisões do dono. Nenhum código.
- **Fora de escopo:** trocar o runner `node:test`; reduzir a suíte, os arquivos de teste ou as categorias de varredura no gate; mexer no Classic Check; seletividade fora das rodadas intermediárias ou sem flag; mexer no CI hospedado além de manter `test:ci` equivalente; meta, critério ou resumo em tempo absoluto; qualquer código antes da decisão do dono.
- **Entregáveis e critérios de aceite:** por fatia, na seção "Fatias". Em comum: cada medida vem do `verify_run` do ledger (`duracaoMs` por comando, por lane e da rodada), numa cópia descartável do projeto, com a rodada do Classic no mesmo commit e na mesma máquina para a razão, e com a lista de arquivos de cada lane gravada e comparada com a da suíte completa.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads do próprio Orkastery, em modo sombra primeiro (a seletividade escolhe e a suíte completa roda também, só para comparar). Interrompe se o falso negativo passar do limiar da D3, se algum critério de paridade da varredura falhar ou se uma fatia de CPU reduzir cobertura.

### Métricas

| Métrica | Linha de base | Meta | Fonte |
| --- | --- | --- | --- |
| Razão entre o Classic e o Agile, gate completo | 0,973 na recoleta M0 de 30/10/2026 | Cerca de 1,7 vez, na mesma máquina e com a mesma bateria (D1 vigente) | Pares da bancada `medir-check.cjs` no mesmo commit |
| Corte da CPU da suíte contra a linha de base | 0% é a CPU da suíte na recoleta M0 de 30/10/2026 | Redução mensurável; a razão de 1,7 vez é soberana | Soma de `user` e `sys` por arquivo, normalizada contra a recoleta M0 |
| Eficiência de paralelismo da suíte | De 43,9% a 61,4% no Agile, média de 50,4% na M0 | Pelo menos 60%, provisório; pares controlados podem recalibrar | CPU total da lane dividida pelos núcleos, contra a parede da lane, por rodada |
| Cadeia varredura e integração, em fração da parede do Classic | De 0,36 a 0,46 | Cabe na parede total máxima de 0,59 do Classic | `duracaoMs` da varredura e da lane de integração |
| Parede por arquivo de teste, em % da soma das durações | De 10 a 12 arquivos acima de 2,6%; os cinco maiores somam de 16,9% a 22,3% na M0 | Nenhum arquivo acima de 1,3% da soma, ou justificativa registrada | Reporter de durações, gravado no ledger |
| CPU duplicada entre claims e suíte | 3 de 3 claims da bancada repetem arquivo de lane e trazem build; na referência, 85 de 136 repetem lane | Claim que repete arquivo da lane reaproveita o resultado da lane na mesma rodada, ou sai | Ledger: comando da claim contra a lista de arquivos da lane |
| Pico de memória agregado | De 1,12 a 1,23 vez o do Classic (RM-072) | Dentro do teto da D2 | `docker stats` mais RSS da árvore do verify, como na RM-072, por `medir-check.cjs` |
| Rodada intermediária com seletividade, contra o gate do Agile no mesmo commit | Não existe (a seletividade não existe) | Fixada na M0, fora da meta da D1 | `verify_run.duracaoMs` das duas rodadas, em sombra |
| Falso negativo da seletividade contra a suíte completa | Não medido | Dentro do limiar da D3, com o limite superior de 95% informado e N mínimo da M0 | Comparação, em sombra, da lista escolhida com as falhas da suíte completa do mesmo commit |
| Cobertura no gate (proteção) | 655 arquivos e 6.075 testes na recoleta M0 | Igual ou maior, sem `skip` novo, a cada rodada | Lista de arquivos e contagem de testes por lane no ledger |
| Qualidade por mutação (proteção) | Mutantes dos arquivos tocados na linha de base | Perda máxima de 10% | `core/test/mutantes/` sobre os arquivos tocados |

## Fatias

A numeração segue a ordem do pedido. A ordem de execução recomendada é a da decisão D4, e a M0 vem antes de todas.

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| M0 Bancada de medição (coleta concluída) | Cópia descartável do projeto, um comando que mede por arquivo `user`, `sys`, parede e pico de memória, a lista de arquivos e testes por lane, a rodada do Classic no mesmo commit para a razão e o conjunto de claims da bancada, o mesmo nos dois modos. Sem código de produto | A coleta entregou três pares, três passes, CPU por 645 arquivos, eficiência por lane, variação e sondas 1 a 5. O `steal` e as saídas 1 deixam a razão sem confiança para produto; três pares aprovados e controlados continuam necessários. O conjunto rotulado de diffs, com N definido pela D3, só entra quando a F1 começar |
| F1 Seletividade | Mapa de impacto arquivo para testes a partir do diff, nas rodadas intermediárias do GO e do CHECK, atrás de flag desligada por padrão; o motor sai da D3; fora do caminho da meta, porque a suíte completa continua obrigatória no gate final e no CI; as claims de teste entram no mesmo mapa | Rodada intermediária mais rápida que o gate do Agile no mesmo commit, na razão que a M0 fixa, em três rodadas seguidas pelo ledger; falso negativo dentro do limiar da D3 em sombra sobre os diffs da M0; teste que prova que o gate final roda a suíte completa em 100% dos casos e que a flag desligada dá o resultado de hoje; módulo central (os `locale-*`, 591 testes) tratado por regra explícita, não por seleção de tudo |
| M1 CPU por teste | Harness do CLI dentro do processo para os testes pesados que não verificam a fronteira de processo; resultado nominal das lanes reaproveitado por claims `node --test` no mesmo HEAD e ambiente; build único por rodada | Razão contra o Classic e CPU da suíte medidas pela mesma bancada da recoleta M0; mesmo número de testes e asserções, nenhum `skip`; paridade byte a byte entre harness e processo; mutação dos arquivos tocados sem piora superior a 10% |
| F2 CPU da suíte (demais fatias) | Os arquivos de teste mais caros que continuam fora da M1, a eficiência de paralelismo das lanes e a cadeia varredura e integração, com orçamento que vigia o crescimento | Evolução até cerca de 1,7 vez contra o Classic, no mesmo commit, máquina e bateria; nenhum caso removido; cada ganho medido em razão e CPU da suíte |
| F3 Memória | O teto da D2 aplicado à varredura do grupo e às lanes, medindo o que isso custa na razão contra o Classic | Pico agregado dentro do teto em três rodadas; varredura com as nove ferramentas e zero achado novo ou desaparecido por impressão digital; custo na razão medido e registrado, e aceito pelo dono se tirar a meta da D1 do alcance |
| F4 Dívida da RM-072 que pesa no tempo ou na confiança | O que a tabela "A dívida da RM-072" diz que entra: redação do motivo da peça `imagem-de-lint`, a lane caída sem veredito e o texto do gate, a data sem ano e o caso de `GMT+0` do snapshot de locale, os casos que faltam, a paridade do `tsgo` fora da thread de origem e as peças em fallback | Cada item da tabela com caso de teste que falha sem a correção; nenhum arquivo ou categoria de varredura removido; peças `tsgo`, `cache-semgrep` e binários nativos com o motivo do fallback medido e, onde o fallback some, o ganho em percentual da parede pelo ledger |

## A dívida da RM-072

Origem: a seção "Dívida aceita no CHECK" da RM-072. A tabela diz o que pesa no tempo ou na confiança do Agile e para onde cada item vai nesta página; o que não pesa fica como follow-up.

| Item da RM-072 | Pesa em | Destino |
| --- | --- | --- |
| O motivo da peça `imagem-de-lint` (a última linha do `docker build`) chega ao ledger sem redação | Confiança (dado no ledger) | F4 |
| A lane caída sem veredito que não seja por tempo deixa o `test` sem veredito no Agile, mais estrito que o comando único do Classic | Confiança e tempo (rodada refeita) | F4 |
| O texto do gate do `test` sem veredito não diz qual lane ficou sem veredito nem por quê | Confiança (diagnóstico) | F4 |
| A URL legítima no fim do motivo de uma peça também sai, e a expressão percorre a linha inteira antes do corte | Pouco; cosmético | Follow-up fora das fatias |
| O snapshot pt-BR F3c tem datas sem ano, que passam a sair com o ano em 01/01/2027 e o deixam vermelho para todos nesse dia | Confiança do gate; e o snapshot de locale é o maior consumidor de CPU | F2, junto do snapshot de locale; prazo real: 01/01/2027 |
| O caso de janeiro da legenda do fuso espera `GMT+0`, que o Node 20.20.2 e o 22.23.2 escrevem | Confiança | F4 |
| Faltam casos para o teto de 180 s do build da imagem de lint, para o teto dos trabalhadores, para o cache por usuário no trabalhador nativo, para a evidência das lanes com outra raiz de estado e para o `executado` do ramo do relógio | Confiança | F4 |
| O trabalhador da varredura roda por string de shell, sem risco hoje; o caso com Docker real do `runScanAgil` só existe nas rodadas de medição; restam limpezas de manutenção | Confiança; o caso com Docker real é candidato à lane de integração e pesa em tempo | F4, com o custo do caso medido |
| A paridade do `tsgo` com o `tsc` só é conferida a cada rodada na thread de origem, pela C70 | Confiança | F4 |
| A tabela de estado gerada por `ork docs sincronizar` usa travessão nas células vazias | Nenhum | Follow-up fora das fatias |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** a posição no índice de prioridade é decisão do dono; esta página registra a origem (D3 da RM-072, 24/10/2026), o pedido de abrir o item em Discovery (26/10/2026) e a meta vigente decidida pelo dono em 29/10/2026 (alternativa 2.c).
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. Marcos: M0 com a linha de base e a razão pelo ledger; cada fatia com três rodadas medidas; revisão do dono depois da F2, quando a razão do gate estiver medida. Confiança: alta para a F4 e a F3; média para a F2, porque a aritmética pede um corte grande de CPU; baixa para a F1 até a M0 medir o mapa por cobertura, e a F1 não move a meta.
- **Dependências e bloqueios (ID, owner, próxima revisão):**
  - [RM-072](RM-072-check-cinco-vezes-mais-rapido.md): origem. Entrega o Agile Check, o `verify_run` com `duracaoMs`, as lanes, `core/scripts/medir-check.cjs`, o reporter de durações e a F3 (seletividade) que esta página assume. Mesclada e em produção na versão 0.6.0; a dívida dela entra aqui pela D3 dela.
  - [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md), frente 1 (F1: modelos de decisão que escolhem testes pelo diff): o mapa determinístico desta página é a base e a verdade de comparação da frente dela; o modelo só entra como sinal sobre o mapa, nunca como prova. As duas partilham o limiar de falso negativo (D1 da RM-073) e a regra de que o gate roda a suíte completa. Ordem proposta: o mapa (esta página) antes do modelo.
  - [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md): o custo e o tempo por fase no relatório da esteira são a fonte de leitura da melhora (o CHECK por fase, em razão contra a linha de base) depois que a RM-071 entregar; até lá a fonte é o `verify_run`.
  - [RM-062](RM-062-repositorio-publico-sem-dado-privado.md): se a F1 usar modelo externo, a barreira de dado privado vale; o mapa determinístico não envia nada.
  - Decisão do dono sobre D2 a D4; a D1 foi revisada pela alternativa 2.c em 29/10/2026.
- **Premissas / riscos / mitigação:**
  - **Falso negativo da seletividade: um teste que falharia fica de fora da rodada intermediária.** Mitigação: sombra primeiro, limiar da D3, suíte completa obrigatória no gate e no CI, e a flag desligada dá o resultado de hoje.
  - **Módulos centrais selecionam tudo** (238 de 356 módulos, 591 testes na cadeia de `locale-*`). Mitigação: mapa por cobertura de linha, e regra explícita para os módulos centrais, em vez de selecionar tudo ou nada; se a medida não mostrar ganho, a F1 volta ao dono.
  - **Testes que sobem processo escondem a dependência** (131 arquivos pela heurística grossa). Mitigação: tratar o produto inteiro como dependência desses testes no mapa, e medir quantos deles a rodada intermediária precisa.
  - **Cortar CPU vira cortar cobertura.** Mitigação: a regra é o número de arquivos e de testes igual ou maior, por lane, no ledger; um teste que perde caso reprova a fatia.
  - **Cortar CPU nos arquivos de teste também acelera o Classic.** A razão é contra o Classic no mesmo commit, e o corte que os dois modos ganham pede mais (74% contra 49% com a eficiência de hoje). Mitigação: a F2 começa pelas alavancas que só o Agile usa e mede cada corte nos dois modos.
  - **A razão depende do conjunto de claims.** Com três claims representativas, as claims pesam pouco; numa thread real, pesam mais que a lane hermética (sonda 3). Mitigação: a M0 fixa o conjunto de claims da bancada, o mesmo nos dois modos, e o grava com a razão.
  - **A suíte cresce mais depressa que o ganho** (2.753 testes em 10/10, 5.718 em 24/10, 645 arquivos hoje contra 628). Mitigação: o orçamento de CPU e de parede por arquivo, em percentual da linha de base, vigiado a cada rodada, não só medido uma vez.
  - **Memória contra tempo.** Uma ferramenta por vez derruba o pico, mas alonga a varredura, que está na cadeia da integração e entra na razão. Mitigação: a D2, com o custo medido na F3.
  - **Medida varia com a carga.** A RM-072 e esta página rodaram com outras cargas na máquina; o `verify_run` grava o roubo de CPU (`steal`) por rodada, de 7,9% a 14,1% nas seis rodadas lidas. Mitigação: três rodadas por medida, o par Agile e Classic no mesmo commit rodado em sequência, o `steal` de cada um junto e a variação entre rodadas no relatório.
  - **O que a página não mediu:** o custo de rodar a suíte com cobertura, o falso negativo de qualquer seletividade, a CPU (`user` mais `sys`) dos 645 arquivos e a eficiência de paralelismo por lane, medida e não calculada. Tudo isso é a M0.
- **Não-objetivos:** reduzir a suíte; trocar o runner; seletividade no gate ou no CI; tirar o Classic Check; meta em tempo absoluto; divulgação e versão no npm.

### Decisões do dono

A D1 original foi decidida em 27/10/2026 e substituída pelo dono em 29/10/2026, na alternativa 2.c. D2, D3 e D4 seguem pendentes.

**D1. O que a meta mede. Decisão vigente do dono em 29/10/2026: o gate completo, em razão contra o Classic na mesma máquina e com a mesma bateria.**

- **A meta:** o Agile Check completo cerca de 1,7 vez mais rápido que o Classic Check, na mesma máquina, no mesmo commit e com a mesma bateria.
- **A proteção:** no máximo 10% de perda de qualidade por mutação; nenhum teste, asserção ou arquivo removido e nenhum `skip` novo.
- **A regra:** metas, critérios, títulos e resumos usam razão contra o Classic e CPU da suíte, não duração absoluta.
- **A medida:** a razão contra o Classic e o corte percentual da CPU da suíte contra a recoleta M0; a duração absoluta permanece apenas na evidência bruta.

Consequências:

1. A seletividade (F1) sai do caminho da meta, porque o gate roda a suíte completa.
2. A aritmética do gate passa a ser a da seção "O piso do gate", em termos relativos.
3. A meta de três vezes registrada em 27/10/2026 fica histórica e não é critério de aceite das fatias novas.

**D2. O teto de memória da varredura. Pendente.** A varredura entra na razão: no Agile, a lane de integração espera a varredura. Rodar uma ferramenta por vez derruba o pico, mas alonga essa cadeia. E um teto em GB depende da máquina: 4 GB são folga numa máquina de 31 GB e aperto numa de 8 GB.

1. Um teto fixo, igual para toda máquina (os 4 GB da RM-072), com uma ferramenta por vez no grupo. Protege a máquina pequena, mas tira da máquina grande a varredura em paralelo, alonga a cadeia da integração e afasta a meta justamente onde sobra memória.
2. **Teto declarado por máquina, com um padrão que protege a máquina pequena (recomendada).** Sem declaração, o Agile mira o pico do Classic na mesma máquina: a varredura do grupo roda uma ferramenta por vez, como o Classic já roda, e o pico fica no que aquela máquina já aguenta hoje. A máquina que quiser mais declara o próprio teto (no manifesto, por máquina, ou na configuração local da máquina, a definir na F3), e o Agile escolhe quantas ferramentas rodam juntas para caber nele; o `verify_run` grava o teto vigente, de onde ele veio e o pico medido. A razão da D1 é medida com o teto que a máquina declarou, e a razão sem declaração também fica registrada. Custo: a F3 precisa do escalonador por teto e de um campo novo no `verify_run`.
3. Teto automático, uma fração da memória detectada na hora (por exemplo, metade da memória livre). Serve a qualquer máquina sem configurar, mas o pico e a razão passam a variar de rodada para rodada com a carga do momento, e a medida deixa de ser reproduzível.

O que mudou na recomendação: antes, os 4 GB eram o alvo comum a todas as máquinas, e o teto só subia por máquina depois de medir o custo. Agora o padrão é relativo (o pico do Classic na mesma máquina), sem um número em GB que valha para todas, o teto maior é declaração explícita de cada máquina, e o custo da varredura conta na razão, porque ela está na cadeia da integração.

**D3. Motor e lugar da seletividade. Pendente.** Com a D1, a seletividade não move a meta: o gate roda a suíte completa. Ela continua útil nas rodadas intermediárias do GO e do CHECK, mas sai do caminho crítico.

1. Mapa por grafo de importação, logo depois da M0: determinístico e simples, mas a sonda 4 mostra que seleciona 90% do tempo na janela de 200 commits, e a página gastaria esforço cedo numa frente que não move a meta.
2. **Mapa por cobertura de linha, com o grafo como regra para o que a cobertura não vê, nesta página e depois da F2 (recomendada).** Seleciona pelo teste que de fato executa a linha alterada, trata módulo central e processo filho por regra explícita e usa o limiar da D1 da RM-073 (até 2% observado nas rodadas intermediárias, com limite superior de 95% até 5%, e o gate completo sempre). O modelo da RM-073 só entra depois, como sinal sobre este mapa. Custo: medir a suíte com cobertura, agora fora do caminho da meta.
3. Tirar a seletividade desta página e levá-la à frente 1 da RM-073, onde o mapa e o modelo andariam juntos. Encurta esta página e põe a escolha de testes num item só, mas a RM-073 está em Discovery, e o mapa determinístico, que é a verdade de comparação do modelo, perderia o dono aqui.

O que mudou na recomendação: o motor recomendado é o mesmo; a F1 deixa de ser frente da meta e passa para depois da F2, e o custo de medir a suíte com cobertura sai da M0.

**D4. Ordem das fatias. Pendente.**

1. A do pedido original: seletividade, CPU, memória, dívida. Com a D1, começa pela única frente que não move a meta.
2. **M0, depois F4 e F2 juntas, depois F3, e a F1 por último, fora da meta (recomendada).** A M0 mede a razão, a CPU por arquivo e a eficiência de paralelismo por lane. A F4 vem logo porque o snapshot com data sem ano derruba o gate em 01/01/2027 e porque as peças em fallback são tempo que o Agile promete e não entrega. A F2 começa pelas alavancas que só o Agile usa (a claim que repete a lane, a repetição de setup, o processo e o catálogo reaproveitados na lane, a eficiência de paralelismo e a cadeia varredura e integração), que pedem um corte de CPU menor que o corte nos arquivos de teste, que o Classic também ganha. A F3 vem com a razão já medida, para a D2 pesar o custo da memória contra a meta. Custo: a seletividade, a mais visível, fica por último, e as rodadas da F2 e da F4 disputam a mesma CPU, o que pede rodadas em sequência na bancada.
3. M0, depois F3 e F4 em paralelo, depois F2 e por fim F1 (a recomendada antes da meta nova). Ainda serve à dívida, mas põe a memória antes da CPU, e a D2 só fecha bem quando a razão do gate já está medida.

O que mudou na recomendação: a F2 sobe para antes da F3 e passa a ser a frente da meta, começando pelas alavancas exclusivas do Agile; a F1 fica fora da meta, por último; a F4 continua cedo, pelo prazo de 01/01/2027.

## Fontes

- Página da RM-072 lida inteira em 26/10/2026 e de novo em 27/10/2026, depois da troca dos minutos por razão: "Medição da linha de base", "Medição do GO", "O piso físico", D2, D3 e "Dívida aceita no CHECK".
- Sondas 1 a 5 desta página (26/10/2026): cache de durações por arquivo do reporter `reporter-duracoes.mjs`, `claims.jsonl` e `verify_run` do ledger da thread `ork-check5x` (relidos em 27/10/2026 para as proporções da sonda 3), fecho de `require` dos testes compilados contra o histórico do git, `/usr/bin/time` sobre os arquivos mais caros. Os scripts das sondas foram descartáveis e não estão no repositório; a M0 refaz tudo pelo ledger. Os números brutos das sondas ficam na versão desta página do merge `e7fb968f` (PR #207), no histórico do git.
- Decisão e regra do dono de 27/10/2026, no pedido da thread `ork-docsda060emp`.
- Decisão vigente 2.c do dono em 29/10/2026 e bancada M0 de 30/10/2026, recebidas no pedido da thread `ork-rm074m1menos`.
- Código citado: `core/scripts/test-lanes.cjs`, `core/scripts/reporter-duracoes.mjs`, `core/scripts/medir-check.cjs`, `core/src/integracoes-locais.ts`, `core/package.json`, `orkastery.yaml`.
- Páginas citadas: [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md), [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md), [RM-062](RM-062-repositorio-publico-sem-dado-privado.md).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-30 | Julio |
| Documentação | Em revisão | — | 2026-10-30 | Julio |
| Código | Branch criada | commit `2babe765` | 2026-10-30 | Julio |
| Testes | Em execução | — | 2026-10-30 | Julio |
| Deploy | Não implantado | — | 2026-10-30 | Julio |
| Exposição | Flag desligada | — | 2026-10-30 | Julio |
| Habilitação | Pendente | — | 2026-10-30 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: sessão condutora da thread `ork-rm074m2harne` para a M2; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a M2 é conduzida em `#Auto` pela thread `ork-rm074m2harne`; decisões autônomas ficam no ledger, enquanto a meta 2.c e o limite de qualidade são do dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** coletar a bancada M2 no host real, registrar razão e CPU da suíte e concluir CHECK/SHIP/MASTER; responsável: thread `ork-rm074m2harne`; prazo: nesta entrega.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-26 | Item criado em Discovery, só página e pesquisa, com M0 e quatro fatias, e quatro decisões pendentes | D3 da RM-072 (24/10/2026, resposta 3a) e pedido do dono de 26/10/2026; sondas da seção "Sondas desta página" | Julio |
| 2026-10-27 | D1 decidida: a meta é o Agile Check completo pelo menos 3 vezes mais rápido que o Classic na mesma máquina e no mesmo commit, em três rodadas seguidas pelo ledger; título, resumo, métricas e sondas sem minutos, em razão e percentual; a aritmética do piso refeita em termos relativos; D2, D3 e D4 reavaliadas; o arquivo passa a `RM-074-agile-check-tres-vezes-mais-rapido.md`, com os links corrigidos | Decisão e regra do dono de 27/10/2026, no pedido da thread `ork-docsda060emp` | Julio (a D1 e a regra); thread `ork-docsda060emp` (#Fast) na reescrita |
| 2026-10-29 | A alternativa 2.c substitui a D1: meta de cerca de 1,7 vez contra o Classic, mesma máquina e bateria, com perda de qualidade limitada a 10% | Decisão do dono recebida pela thread `ork-rm074m1menos` | Julio |
| 2026-10-30 | M1 iniciada: CLI no processo para testes pesados e resultados das lanes reutilizados por claims equivalentes no mesmo HEAD e ambiente | Bancada M0 `6a30b24c`, plano e implementação da thread `ork-rm074m1menos` | Thread `ork-rm074m1menos` (#Auto) |
| 2026-10-30 | M1 registrada; M2 leva o harness a quatro pontos quentes restantes e reaproveita formas fechadas das claims. A razão e a CPU da M2 ficam pendentes da bancada no host real | Bancada M1 `4f4d4b55`, reanálise da sonda 2 e implementação da thread `ork-rm074m2harne` | Thread `ork-rm074m2harne` (#Auto) |
