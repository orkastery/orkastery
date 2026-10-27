---
id: RM-072
tipo: roadmap
titulo: "Agile Check e Classic Check: o CHECK rápido como padrão, sem perder cobertura"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 90032a5
    pr: "#200"
  deploy:
    release: v0.6.0, @orkastery/cli no npm (o Agile Check como CHECK padrão; o Classic com check.mode classic)
sdlc:
  thread: ork-check5x
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-072: Agile Check e Classic Check, o CHECK rápido como padrão sem perder cobertura

> **Em uma frase:** a fase CHECK ganha o Agile Check, padrão a partir do lançamento, com a mesma cobertura e menos repetição e espera em série, e mantém o Classic Check, o CHECK de sempre, que volta com `check.mode: classic`.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz o `ork`, e o próprio Orkastery. A fase CHECK é o gargalo do ciclo: no `verify` completo, o `npm test` ocupava 72% da soma das peças e usava em média 4,36 das 8 CPUs da máquina (eficiência de paralelismo de 54,5%), e boa parte do resto é trabalho repetido, não verificação nova. Cada rodada de CHECK atrasa o GO-FIX e a entrega da thread.
- **Evidências e fonte:** medição feita por Hermes em 24/10/2026 numa máquina de 8 vCPU e 31 GB, com outras cargas rodando em paralelo, sobre o checkout do projeto na versão 0.5.6, logo após o ship da [RM-057](RM-057-hitl-por-alternativas.md). As proporções estão na seção "Medição da linha de base"; os números brutos ficam na versão desta página do merge `90032a5` (PR #200).
- **Os dois modos (D2):** o Classic Check fica como o CHECK de hoje, com os mesmos comandos, a mesma ordem e as mesmas ferramentas, e só ganha medição; o Agile Check, novo e padrão a partir do lançamento, leva tudo das fatias 1 e 2. Onde esta página diz "no lugar de", vale "no Agile Check, em vez de".
- **Objetivo/OKR:** a fase CHECK deixa de ser o gargalo do ciclo, e o `ork` entrega uma versão a mais por dia sem aumentar o consumo de CPU da máquina.
- **Hipótese:** se o Agile Check separar as lanes de teste, parar de recompilar por claim, rodar a varredura em paralelo com cache persistente e trocar as peças caras por equivalentes nativos, então o mesmo gate fecha cinco vezes mais rápido mantendo 100% dos arquivos de teste e das categorias de varredura, porque o custo hoje é redundância (o scan roda duas vezes, o build até cinco) e empacotamento ruim (eficiência de paralelismo de 54,5%, 436% de 800% de CPU), não trabalho útil.
- **Métrica principal / linha de base / meta / janela / fonte:** a razão entre a parede do Classic Check e a do Agile Check num `ork verify` completo, na mesma máquina e no mesmo commit. Linha de base: o Classic Check (razão 1). Meta desta página: 5 vezes, com a mesma cobertura; a primeira versão a escreveu em tempo de parede contra a linha de base de 24/10/2026. Não atingida (1,43 a 1,52 vez): pela D3, a meta seguiu para a [RM-074](RM-074-agile-check-em-3-minutos.md), que o dono fixou em 27/10/2026 em pelo menos 3 vezes o Classic. Janela: três rodadas consecutivas do Agile Check depois da fatia 2. Fonte: `verify_run` no ledger, que grava `duracaoMs` por comando, por claim e da rodada nos dois modos desde a thread `ork-check5x`. Pela regra do dono de 27/10/2026, a duração absoluta fica no ledger como evidência bruta, e o texto diz razão e percentual, que não dependem da máquina.
- **Métricas de proteção:** o gate executa os mesmos arquivos de teste da linha de base (628 no glob do `npm test` na base `b16c5be8`, 608 na lane hermética e 20 na de integração) e o mesmo conjunto de testes; as nove ferramentas de varredura continuam declaradas e comparadas por impressão digital contra a base; nenhum achado novo ou desaparecido além do que a linha de base já registra; nenhuma ferramenta sai do catálogo sem substituto de cobertura equivalente; a suíte de CI hermética (`test:ci`) continua com o mesmo conjunto de arquivos. A primeira versão desta página dizia 350 arquivos; a contagem do glob na base é 628.

## Medição da linha de base (24/10/2026)

Proporções da medição de 24/10/2026. "Parte" é a fatia da peça na soma das peças de um CHECK estimado (preparo, três claims, `test` e `security_scan`), ou a relação dita na célula.

| Peça do CHECK | Parte | Pico de memória | Observação |
| --- | --- | --- | --- |
| `npm test` (build + build:test + 628 arquivos) | 72% da soma das peças | 1,52 GB num processo | 5.718 testes; eficiência de paralelismo de 54,5% (média de 436% de CPU em 8 vCPU), com 62% da CPU em usuário e 38% em sistema; 3 testes falham hoje |
| `tsc --build tsconfig.json` | 1,8% da parede do `npm test` | 990 MB | compilação do `src` |
| `tsc --build tsconfig.test.json` | 3,8% da parede do `npm test` | 2,16 GB | compilação de `src` + `test` |
| `ork security-scan` (9 ferramentas, HEAD e base) | 12% da soma das peças | 490 MB no container maior | 23.422 achados, todos `existing`; o eslint leva 52% da varredura e o semgrep 27%; ferramentas em série |
| Recompilação por claim | 4% da soma das peças por claim (5,6% da parede do `npm test`) | 2,16 GB | toda claim começa com `npm run build && npm run build:test` |
| `docker run` com imagem quente | 7,6% da varredura, somadas as 18 partidas | - | 18 partidas de container por varredura (9 ferramentas, HEAD e base) |

Composição estimada de um CHECK, na soma das peças: preparo 4%, três claims 12%, `test` 72% e `security_scan` 12%.

O build do `src` custa 7% de um único arquivo de teste (`locale-f3d-snapshot.test.js`, que sozinho leva um quarto da parede do `npm test`) e mostra onde o tempo não está: o problema é distribuição e redundância, não a suíte em si.

## Medição do GO (24/10/2026)

Medido na thread `ork-check5x`, numa máquina de 8 vCPU e 31 GB (cota de 7,2 CPUs), com outras cargas rodando em paralelo. As rodadas abaixo são de uma cópia descartável do projeto no commit `a12f60b7` (base `b16c5be8`), com o `ork verify` da worktree e três claims representativas, por `core/scripts/medir-check.cjs`; o cache é isolado, então a primeira rodada do Agile paga o banco do Trivy frio. A duração de cada peça vem do `verify_run.duracaoMs` do ledger da cópia, e as razões abaixo são contra a rodada 4, do Classic, no mesmo commit; o pico soma o RSS da árvore do verify com a memória dos containers da varredura, como o `docker stats` conta.

| Rodada | Modo | Veredito | Parede, em % da do Classic | Razão contra o Classic | Preparo, contra o do Classic | `test`, em % do do Classic | `security_scan`, em % da do Classic | Pico agregado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Agile Check | aprovada | 70% | 1,43 vez | 10 vezes mais rápido (`tsgo`) | 101% (a integração, 38% do `test`, depois da varredura) | 85% | 4,86 GiB (1,22 vez o do Classic) |
| 2 | Agile Check | aprovada | 66% | 1,52 vez | 12 vezes mais rápido (`tsgo`) | 95% (integração 42%) | 43% | 4,47 GiB (1,12 vez) |
| 3 | Agile Check | aprovada | 67% | 1,49 vez | 12 vezes mais rápido (`tsgo`) | 96% (integração 40%) | 44% | 4,88 GiB (1,23 vez) |
| 4 | Classic Check | reprovada (um teste de scan com Docker real) | 100% | 1 | 6% da parede (`tsc`) | 65% da parede | 25% da parede | 3,98 GiB |

O Agile fica 1,43 a 1,52 vez mais rápido que o Classic no mesmo commit (de 30% a 34% a menos de parede), com três rodadas seguidas aprovadas, e longe das 5 vezes da meta. O ganho vem do preparo com o `tsgo` na árvore fria, da varredura ao lado dos testes e das claims contra o produto do preparo; a suíte em si leva o mesmo tempo nos dois modos (95% a 101% da do Classic), porque é presa em CPU. O pico do Agile fica de 12% a 23% acima do do Classic e passa do teto de 4 GB; o do Classic ficou abaixo dele.

A medição rodou antes de o CHECK voltar a tirar só os passos do preparo da frente das claims: hoje, na árvore fria, a claim com o build no meio da cadeia roda inteira e paga uma vez o build frio do `tsc`, e o preparo roda de novo antes da claim seguinte que o reaproveitaria (ou, sem ela, antes do grupo, que continua em paralelo); as claims seguintes voltam a reaproveitar o preparo.

A rodada do Classic reprovou no teste de integração que varre a fixture js com Docker real. Ele passa sozinho, e o condutor registra que já falhava na linha de base de 24/10 (a baseline da thread, gravada mais tarde no mesmo dia, passou): sob a carga do `npm test` inteiro, o Semgrep do catálogo estoura os 5 s por regra. No Agile, a lane de integração só começa depois da varredura do grupo (`check.agile.apos_a_varredura`), e as três rodadas passaram.

| Frente do Agile | Medição | Paridade |
| --- | --- | --- |
| Varredura em paralelo, com o banco do Trivy em cache e a imagem de lint pré-montada | Sozinha, contra a do Classic: o Agile frio leva 1,07 vez o tempo dela (o banco do Trivy a baixar) e o quente fica 2,1 vezes mais rápido | Zero achado novo e zero desaparecido entre 23.717, por impressão digital (HEAD `bd044b89`, base `b16c5be8`); na rodada fria o Semgrep do Agile estourou o prazo por regra, e o Agile passou a dar 30 s por regra |
| `tsgo` no preparo (TypeScript 7 nativo, `@typescript/native-preview` 7.0.0-dev.20260707.2) | Build frio de `dist` e `dist-test` de 6,8 a 8,5 vezes mais rápido que o do `tsc` 5.9.3; com o build incremental do `tsc` presente, o preparo roda o `tsc`, que então custa menos de 4% do `tsgo` frio | Typecheck igual (0 e 0 erros, 7 de 7 mutantes acusados igual) e o mesmo JavaScript token a token em 1.381 arquivos |
| `osv-scanner` no lugar de `trivy-vuln` + `npm-audit` | Varredura do Agile com ele ligado: 1,26 vez mais rápida que a do Classic sozinha e 1,68 vez mais lenta que a do Agile quente sem ele | Sem paridade: 46 vulnerabilidades no Classic contra 29, 17 só no Classic; fica desligado (`check.agile.osv_scanner: false`) |
| `oxlint` como primeiro passe | Atrás de `check.agile.oxlint`, desligado | Só acrescenta o passe, sem tirar regra do `eslint` |

O piso físico: com eficiência de paralelismo de 100% (a CPU da suíte na base, 628 arquivos e 5.718 testes, dividida pela cota de 7,2 CPUs), a suíte sozinha já ocupa 42% da parede do Classic da rodada 4. Sem cortar a CPU da suíte, o Agile não passa de 2,4 vezes o Classic com nenhuma distribuição, abaixo das 5 vezes da fatia 2. Sem reduzir cobertura, o alvo de tempo e o de memória voltam ao dono, como o critério de interrupção desta página manda.

O paralelismo do grupo também tem teto: com a lane hermética, a de integração e a varredura juntas acima da CPU, testes com prazo caem por falta de máquina (o scan com Docker real e o receptor do mensageiro caíram assim numa rodada de prova). O grupo do Agile não passa da CPU: a integração espera a varredura, a varredura roda poucas ferramentas por vez dentro do grupo, e a lane hermética deixa duas CPUs livres.

## Escopo e validação

- **Incluído:**
  - **Os dois modos (D2):** `check.mode: agile | classic` no `orkastery.yaml` e `ork verify --check classic|agile` na rodada; o modo e a origem dele em todo `verify_run`, no parecer do CHECK, no `pr-body.md` e no `ork thread status`; o Classic Check intacto, provado pelo retrato contra a base `b16c5be8`.
  - **Fatia 1 (redundância), no Agile Check:** lane hermética e lane de integração local separadas e paralelas; claims executando contra o produto do preparo, com guarda de hash, em vez de recompilar; varredura com ferramentas em paralelo; cache persistente do banco; imagem de lint pré-montada; reaproveitamento do relatório da base por SHA.
  - **Fatia 2 (ferramentas), no Agile Check:** `tsgo` no preparo e no build do manifesto, atrás de flag e com contrato de paridade de typecheck; `osv-scanner` em vez de `trivy-vuln` + `npm-audit`, só depois da comparação por impressão digital; `oxlint` como primeiro passe de lint; binários nativos onde o catálogo já declara `native`; orçamento de tempo por arquivo de teste para matar o long tail.
  - **Fatia 3 (seletividade, opcional e depois das duas):** mapa de impacto arquivo para testes nas rodadas intermediárias do GO e do CHECK.
  - `duracaoMs` por comando no `verify_run`, nos dois modos, para que a meta seja medida pelo ledger e não por cronômetro manual.
- **Fora de escopo:** trocar o runner de testes (`node:test`) por Bun ou Vitest, porque reescreve a semântica de 5.718 testes e quebra o critério de paridade; CodeQL, SBOM e DAST; reduzir cobertura, arquivos de teste ou categorias de varredura em qualquer fatia; mexer no CI hospedado além de manter `test:ci` equivalente; a divulgação no site e a versão no npm, que são decisão do dono no lançamento.
- **Entregáveis e critérios de aceite:**
  - o Classic Check roda a mesma lista de comandos e de ferramentas da base `b16c5be8`, na mesma ordem, e uma rodada real dele no mesmo commit dá os mesmos resultados de teste e de varredura da linha de base;
  - o Agile Check executa os mesmos arquivos e o mesmo conjunto de testes da linha de base, com a lista de arquivos de cada lane registrada no ledger;
  - as nove ferramentas de varredura continuam rodando no Agile, comparadas por impressão digital: zero achado novo ou desaparecido em relação à base;
  - `tsgo` só entra ligado no Agile se o typecheck for idêntico ao do `tsc` 5.9.3 no mesmo commit (mesmo conjunto de erros e nenhum erro novo);
  - `oxlint` só substitui o `eslint` no que ele cobre; regra type-aware continua coberta por quem a cobre hoje;
  - o Agile Check completo fica 5 vezes mais rápido que a linha de base em três rodadas consecutivas, medido pelo ledger, com o build da worktree numa cópia descartável do projeto (não atingido: 1,43 a 1,52 vez o Classic no mesmo commit; segue na [RM-074](RM-074-agile-check-em-3-minutos.md), pela D3, com a meta de pelo menos 3 vezes o Classic na mesma máquina, decidida pelo dono em 27/10/2026);
  - a máquina não passa de 4 GB de pico agregado no CHECK (não atingido: o pico do Agile ficou de 12% a 23% acima do do Classic, de 4,5 a 4,9 GiB; aceito pelo condutor nesta máquina de 31 GB e levado para a [RM-074](RM-074-agile-check-em-3-minutos.md), pela D3).
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads do próprio Orkastery por três rodadas de CHECK. Interrompe e volta ao dono se algum critério de paridade falhar, se o typecheck divergir do `tsc`, ou se a meta de 5 vezes não for atingida na fatia 2 (nesse caso a fatia 3 vira necessária e a meta é renegociada com o dono, sem reduzir cobertura). Frente sem paridade não entra no Agile por padrão: fica atrás de flag, e o desvio é registrado.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade máxima declarada pelo dono em 24/10/2026 ("já priorize a implementação disso agora em modo auto, quero lançar uma nova versão incluindo isso o mais rápido possível"). A posição no índice de prioridade do roadmap é decisão dele; esta página registra o pedido de execução imediata.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data fechada. As fatias 1 e 2 correm juntas na thread `#Auto` `ork-check5x` (alternativa B da D1), com a D2 por cima. Lançamento de versão nova (minor) ao fim da fatia 2, por decisão do dono.
- **Dependências e bloqueios:** o TypeScript 7 removeu `moduleResolution: node10`; o preparo do Agile usa `moduleResolution: bundler` só nos `tsconfig.tsgo*.json`, e o `tsc` 5.9.3 do Classic segue com os `tsconfig` de sempre; catálogo `assets/security-scan/tools.json` como fonte única das ferramentas do Classic, e `tools-agil.json` só para as do Agile atrás de flag; `integracoes-locais.ts` como fonte única da lista de integração; `verify_run` do ledger para a medição.

### Fatias

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Redundância | No Agile Check: duas lanes de teste (`hermetica`, o conjunto do `test:ci`, e `integracao`, com os 20 arquivos de `integracoes-locais.ts`) rodando em paralelo; claims reaproveitando o produto do preparo com guarda de hash; varredura com ferramentas em paralelo; cache persistente do banco; imagem de lint pré-montada; relatório da base reaproveitado por SHA; `duracaoMs` no `verify_run` nos dois modos | Medição de três CHECKs seguidos: CHECK completo 2,5 vezes mais rápido que a linha de base. O teste de integração do scan deixa de rodar dentro da lane hermética, e a lane hermética continua com o mesmo conjunto de arquivos do `test:ci`. Uma claim sem preparo válido recompila e registra o motivo; claim com hash divergente não usa o produto velho. Duas varreduras seguidas com a mesma base produzem o mesmo relatório e a segunda não rebaixa o banco. |
| F2 Ferramentas | No Agile Check: `tsgo` no preparo e no build do manifesto, atrás de flag; `osv-scanner` em vez de `trivy-vuln` + `npm-audit` depois da comparação; `oxlint` como primeiro passe; binários nativos onde o catálogo permite; orçamento de tempo por arquivo de teste | Medição de três CHECKs seguidos: CHECK completo 5 vezes mais rápido que a linha de base. Typecheck do `tsgo` idêntico ao do `tsc` no commit de comparação. Varredura com as nove ferramentas, comparação de impressão digital sem diferença. Nenhum arquivo de teste acima do orçamento. |
| F3 Seletividade (opcional) | Mapa de impacto arquivo para testes nas rodadas intermediárias; suíte completa permanece obrigatória no gate | Rodada parcial com a parte de teste em até 10% da parede do `npm test` da linha de base, com a lista de arquivos afetados provada a partir do diff; o gate continua rodando a suíte completa. |

- **Premissas / riscos / mitigação:**
  - **TypeScript 7 remove `moduleResolution: node10`** (já reproduzido: `TS5108` e `TS1479` no `smol-toml`). Mitigação: `bundler` só no preparo do Agile, com a comparação de erros contra o `tsc` 5.9.3 por `core/scripts/tsgo-paridade.cjs` (no GO: typecheck igual); se não houver paridade, o preparo do Agile volta ao `verify.preparo` e a meta é buscada nas outras frentes.
  - **`oxlint` não cobre regras type-aware.** Mitigação: entra como primeiro passe, não como substituto; o conjunto de regras type-aware continua com quem cobre hoje.
  - **`osv-scanner` pode não cobrir tudo que `trivy-vuln` + `npm-audit` cobrem hoje.** Mitigação: comparação por impressão digital antes de remover as duas ferramentas; sem paridade, elas continuam, e o `osv-scanner` fica atrás de flag (é o caso medido no GO).
  - **Mudar o cache de varredura pode mascarar achado novo.** Mitigação: o cache é só de banco de dados, nunca de resultado; o relatório por SHA continua sendo recalculado. O cache de regras do Semgrep não deu o mesmo resultado e ficou de fora, com a peça registrada.
  - **Duas lanes disputam CPU.** Mitigação: o limite `concurrency.max_parallel_heavy` vale para a rodada inteira, e a lane de integração roda com prioridade menor.
  - **A meta de 5 vezes pode não ser atingida sem reduzir cobertura.** Mitigação: a fatia 3 existe para isso, e a regra é explícita: cobertura não cai. Se a meta não for atingida, a decisão volta ao dono.
- **Não-objetivos:** trocar o runner de testes; reduzir a suíte; deixar de rodar a varredura no CHECK; otimizar o CI hospedado além de manter o mesmo conjunto de arquivos; remover o Classic Check.

### Decisões

**D1. Qual escopo executar agora. Decidida pelo dono em 24/10/2026: alternativa B, fatias 1 e 2 juntas, em modo `#Auto`, com lançamento de versão nova o mais rápido possível.** O texto do dono: "B) 1+2 juntas, siga! E já priorize a implementação disso agora em modo auto, quero lançar uma nova versão incluíndo isso o mais rápido possível." Consequência: a thread nasce `#Auto` e cobre F1 e F2; F3 fica registrada e só começa se a meta de 5 vezes não for atingida com F1 e F2.

**D2. Dois modos de CHECK, o Classic e o Agile. Decidida pelo dono em 24/10/2026, acima de qualquer trecho desta página que diga "no lugar de", "trocar" ou "substituir".** O texto do dono: "melhorias importantes para o processo de testes do orkastery (Fase Check), mas que ele não elimine o processo de Check atual, apenas adicione uma alternativa mais ágil de fase Check, deixando que exista a fase check da forma atual para que possamos configurar o Classic Check (atual) ou o Agile Check (novo, e padrão/default a partir do seu lançamento em produção)." Consequências:

1. O Classic Check é o CHECK de hoje, intacto: os mesmos comandos, a mesma ordem e as mesmas ferramentas (`trivy-vuln`, `npm-audit`, o `eslint` em container, a varredura em série e a recompilação por claim). Ele só ganha medição: `duracaoMs` por comando e o modo no `verify_run`.
2. Tudo das fatias 1 e 2 mora no Agile Check; "no lugar de" quer dizer "no Agile Check, em vez de".
3. O modo é configurável por projeto (`check.mode: agile | classic` no `orkastery.yaml`, validado, com erro que cita os dois valores) e por rodada (`ork verify --check classic|agile`, que vence o manifesto).
4. Sem a chave, vale o Agile; projeto que declara `classic` segue no Classic. O CHANGELOG diz em uma linha que o padrão mudou e como voltar.
5. O Agile nunca reduz cobertura em silêncio: a peça indisponível cai para o equivalente do Classic, e o ledger registra a peça, o motivo e o fallback. Os critérios de paridade valem para o Agile.
6. Todo CHECK diz o modo: o `verify_run` grava o modo efetivo e a origem (manifesto, opção ou padrão), e o parecer do CHECK, o `pr-body.md` e o status mostram "Agile Check" ou "Classic Check".
7. A prova de que o Classic ficou intacto: um teste compara a lista de comandos e de ferramentas do Classic com a da base `b16c5be8` (mesma lista, mesma ordem), e uma rodada real do Classic no mesmo commit dá os mesmos resultados de teste e de varredura da linha de base.
8. A documentação é esta página, o guia de configuração (`docs/guias/verificacao.md`, seção "Classic Check e Agile Check") e o CHANGELOG; a divulgação no site e no npm não é desta thread.

**D3. Lançar com F1 e F2; a meta de tempo vai para uma RM nova. Decidida pelo dono em 24/10/2026, às 13:23 (resposta 3a no Telegram, transmitida pelo condutor).** Diante da medição do GO, o dono escolheu lançar o ganho medido em vez de segurar a entrega. Consequências:

1. O Agile Check entra como padrão com as fatias 1 e 2, e o Classic Check continua disponível por `check.mode: classic` ou `--check classic`.
2. A meta de tempo fica registrada como não atingida (o Agile mediu de 1,43 a 1,52 vez o Classic no mesmo commit) e vai para uma RM nova, a [RM-074](RM-074-agile-check-em-3-minutos.md), com a fatia 3 (seletividade) e o piso de CPU da suíte (com paralelismo perfeito, 42% da parede do Classic).
3. O pico de 4,5 a 4,9 GiB do Agile fica registrado como não atingido contra os 4 GB e foi aceito pelo condutor nesta máquina de 31 GB; o teto de uma ferramenta por vez na varredura do grupo fica para a mesma RM nova.

### Dívida aceita no CHECK

O CHECK da `ork-check5x` teve quatro rodadas com GO-FIX e, a partir da quinta, o critério da RM-057, decidido pelo condutor: zero bloqueador é PASSOU, e aviso que sobrar vira dívida registrada aqui e no ledger. Vai para a RM nova da D3 ou para um follow-up:

- o motivo cru de cada ferramenta (a última linha do stderr, cortada em 200 caracteres sem redação) ainda chega ao relatório da varredura e às linhas de "não rodou" do `ork security-scan`, que vão ao trecho do ledger quando a varredura falha, nos dois modos; no Agile, o motivo da peça `classic-<ferramenta>` e o do trabalhador passam pela redação, e o da peça `imagem-de-lint` (a última linha do `docker build`) ainda não;
- a lane caída sem veredito que não seja por tempo (124, 125, 126 ou de 128 em diante antes do prazo de fora, sinal, lane que não rodou) deixa o `test` sem veredito no Agile, mais estrito que o comando único do Classic, que a compara com a baseline;
- o texto do gate do `test` sem veredito inteiro não diz qual lane ficou sem veredito nem por quê;
- a URL legítima no fim do motivo de uma peça também sai, junto com a que poderia levar login, e a expressão que acha essa URL percorre a linha inteira do stderr antes do corte;
- o snapshot pt-BR F3c tem datas sem ano, que passam a sair com o ano em 01/01/2027 e o deixam vermelho para todos nesse dia (anterior a esta thread);
- o caso de janeiro da legenda do fuso espera `GMT+0`, que o Node 20.20.2 e o 22.23.2 escrevem; um ICU antigo que escreva `GMT` o derrubaria;
- faltam casos para o teto de 180 s do build da imagem de lint, para o teto dos trabalhadores contado depois desse build, para a ligação do cache por usuário no trabalhador nativo, para a evidência das lanes com a raiz do estado diferente da worktree e para o `executado` do ramo do relógio na junção das lanes;
- o trabalhador da varredura recebe a especificação por arquivo e roda por string de shell, sem risco hoje; o caso com Docker real do `runScanAgil` só existe nas rodadas da medição; restam as limpezas de manutenção apontadas na rodada 1;
- a paridade do `tsgo` com o `tsc` é conferida a cada rodada nesta thread pela C70; em outro projeto que ligue o preparo com o `tsgo`, sem uma claim assim, não é;
- a tabela de estado gerada pelo `ork docs sincronizar` usa travessão nas células vazias.

## Fontes

- Medição de 24/10/2026 numa máquina de 8 vCPU e 31 GB, com outras cargas rodando em paralelo, sobre o checkout do projeto na versão 0.5.6: `npm test` (5.718 testes, 1,52 GB de pico), `tsc --build`, `tsc --build tsconfig.test.json` (2,16 GB), `ork security-scan` (23.422 achados) e `docker run` com imagem quente. As proporções estão em "Medição da linha de base"; os números brutos, na versão desta página do merge `90032a5` (PR #200).
- Sonda de `tsgo` com `@typescript/native-preview` 7.0.0-dev em 24/10/2026: typecheck completo de `src` + `test` 8,5 vezes mais rápido que o do `tsc` 5.9.3, com erro de configuração esperado (`moduleResolution: node10` removido).
- Medição do GO de 24/10/2026 na thread `ork-check5x`: o retrato do Classic contra a base (`core/test/fixtures/classic-retrato-b16c5be8.json`), a paridade da varredura por impressão digital (`core/scripts/check-paridade-scan.cjs`), a paridade do `tsgo` (`core/scripts/tsgo-paridade.cjs`) e as rodadas na cópia descartável (`core/scripts/medir-check.cjs`, com a duração de cada rodada no `verify_run` do ledger da cópia); o resumo de cada decisão está no ledger da thread.
- Código citado: `core/package.json`, `core/scripts/test-ci.js`, `core/scripts/test-lanes.cjs`, `core/src/integracoes-locais.ts`, `core/src/check-modo.ts`, `core/src/check-agil.ts`, `core/src/verify.ts`, `core/src/security-scan/run.ts`, `core/src/security-scan/agil.ts`, `core/src/security-scan/executor.ts`, `core/assets/security-scan/tools.json`, `core/assets/security-scan/tools-agil.json`, `orkastery.yaml`.
- Pesquisa de ferramentas de 24/10/2026: TypeScript 7 nativo (InfoQ, agosto de 2026); `oxlint` com 50 a 100x o ESLint (`oxc-project/bench-linter`); `osv-scanner` como gate rápido de SCA (comparativo de 2026); `ast-grep` como alternativa de SAST por AST.

## Estado com evidências

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): o Agile Check é o CHECK padrão, e o Classic Check volta com `check.mode: classic` no `orkastery.yaml` ou com `ork verify --check classic`. A meta de desempenho e a de memória seguem na [RM-074](RM-074-agile-check-em-3-minutos.md), pela D3.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `90032a5` · PR ##200 | 2026-10-27 | Julio |
| Testes | Aprovados | — | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0, @orkastery/cli no npm (o Agile Check como CHECK padrão; o Classic com check.mode classic) | 2026-10-27 | Julio |
| Exposição | Geral | — | 2026-10-27 | Julio |
| Habilitação | Concluída | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-check5x`; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** análise e medição da linha de base feitas por Hermes em 24/10/2026 a pedido do dono; a implementação vai pela thread `#Auto` `ork-check5x`; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** nenhuma de entrega nesta página: o Agile Check está na versão 0.6.0, e a meta de desempenho e a de memória seguem na [RM-074](RM-074-agile-check-em-3-minutos.md); responsável: Julio; sem data definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-24 | Item criado em Discovery com F1, F2 e F3 propostas, e D1 já decidida pela alternativa B | Medição de 24/10/2026 e pedido do dono de executar agora em `#Auto` | Julio |
| 2026-10-24 | D2: o Classic Check fica como o CHECK de hoje e o Agile Check, novo, vira o padrão; título e frase de abertura passam a dizer os dois modos | Pedido do dono de 24/10/2026, na abertura da `ork-check5x` | Julio |
| 2026-10-24 | GO da `ork-check5x`: Agile Check com as fatias 1 e 2, três rodadas seguidas aprovadas, de 1,43 a 1,52 vez mais rápidas que o Classic no mesmo commit; `osv-scanner` e `oxlint` atrás de flag; o alvo de tempo e o de 4 GB voltam ao dono | Seção "Medição do GO" | Condutor da thread |
| 2026-10-24 | D3: lançar com F1 e F2; o alvo de tempo e o de 4 GB ficam não atingidos e vão para uma RM nova, com a fatia 3 e o piso de CPU da suíte | Resposta 3a do dono no Telegram (24/10, 13:23) e decisão do condutor sobre a memória | Julio |
| 2026-10-27 | Em produção na 0.6.0: ciclo Disponível, exposição Geral e habilitação Concluída (o guia `docs/guias/verificacao.md` e o CHANGELOG saíram com a versão); a meta de desempenho e a de memória seguem na RM-074 | Tag `v0.6.0` (merge `7a282d80`, PR #204), com o merge `90032a5` (PR #200) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
| 2026-10-27 | Medições e metas da página em tempo de parede passam a razão contra o Classic Check e a percentual, com o `verify_run` do ledger como fonte; as metas da fatia 1 e da fatia 2, escritas em tempo de parede, viram 2,5 e 5 vezes a mesma linha de base | Regra do dono de 27/10/2026: o tempo absoluto depende do hardware; a duração absoluta fica no ledger | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
