---
id: RM-072
tipo: roadmap
titulo: "CHECK 5x: mesma cobertura em no máximo três minutos"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-24T10:40:00-03:00
estado:
  ciclo: Discovery
  documentacao: Em revisão
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

# RM-072 — CHECK 5x: mesma cobertura em no máximo três minutos

> **Em uma frase:** a fase CHECK passa a rodar em no máximo três minutos, com os mesmos 350 arquivos de teste e as mesmas nove categorias de varredura, cortando redundância (scan duas vezes, build até cinco vezes) e serialização em vez de cobertura.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz o `ork`, e o próprio Orkastery. A fase CHECK é o gargalo do ciclo: numa máquina de 8 vCPU o `verify` completo levou de 19 a 20 minutos de parede e ~4.100 s de CPU, e boa parte disso é trabalho repetido, não verificação nova. Cada rodada de CHECK atrasa o GO-FIX e a entrega da thread.
- **Evidências e fonte:** medição feita por Hermes em 24/10/2026 na estação do dono (8 vCPU EPYC 9354P, 31 GB, com os dev servers do Supernova e o gateway do Hermes rodando em paralelo), sobre o checkout `~/orkastery-novo` na versão 0.5.6, logo após o ship da [RM-057](RM-057-hitl-por-alternativas.md). Números brutos na seção "Medição da linha de base".
- **Objetivo/OKR:** a fase CHECK deixa de ser o gargalo do ciclo, e o `ork` entrega uma versão a mais por dia sem aumentar o consumo de CPU da máquina.
- **Hipótese:** se o CHECK separar as lanes de teste, parar de recompilar por claim, rodar a varredura em paralelo com cache persistente e trocar as peças caras por equivalentes nativos, então o mesmo gate fecha em no máximo três minutos mantendo 100% dos arquivos de teste e das categorias de varredura, porque o custo hoje é redundância (o scan roda duas vezes, o build até cinco) e empacotamento ruim (436% de 800% de CPU), não trabalho útil.
- **Métrica principal / linha de base / meta / janela / fonte:** duração de parede de um `ork verify` completo no CHECK. Linha de base: 15 min 22 s só o comando `test`, ~19 a 20 min o CHECK inteiro, medido em 24/10/2026. Meta: no máximo 3 min (5x), com a mesma cobertura. Janela: a medir em três rodadas consecutivas de CHECK após a fatia 2. Fonte: `verify_run` no ledger, que passa a gravar `duracaoMs` por comando (hoje não grava).
- **Métricas de proteção:** o gate executa exatamente os mesmos 350 arquivos de teste e o mesmo conjunto de testes; as nove categorias de varredura continuam declaradas e comparadas por impressão digital contra a base; nenhum achado novo ou desaparecido além do que a linha de base já registra; nenhuma ferramenta sai do catálogo sem substituto de cobertura equivalente; a suíte de CI hermética (`test:ci`) continua com o mesmo conjunto de arquivos.

## Medição da linha de base (24/10/2026)

| Peça do CHECK | Tempo de parede | Pico de memória | Observação |
| --- | --- | --- | --- |
| `npm test` (build + build:test + 350 arquivos) | 15 min 22 s | 1,52 GB num processo | 5.718 testes, 4.023 s de CPU (2.475 user + 1.548 sys), média de 436% de CPU; 3 testes falham hoje |
| `tsc --build tsconfig.json` | 16,9 s | 990 MB | compilação do `src` |
| `tsc --build tsconfig.test.json` | 35,2 s | 2,16 GB | compilação de `src` + `test` |
| `ork security-scan` (9 ferramentas, HEAD e base) | 2 min 27 s | 490 MB no container maior | 23.422 achados, todos `existing`; eslint ~76 s e semgrep ~40 s do total; ferramentas em série |
| Recompilação por claim | 52 s por claim | 2,16 GB | toda claim começa com `npm run build && npm run build:test` |
| `docker run` com imagem quente | 0,62 s | - | 18 partidas de container por varredura (9 ferramentas, HEAD e base) |

Composição estimada de um CHECK: 52 s de preparo + 3 x 52 s de claims + 15 min 22 s de `test` + 2 min 27 s de `security_scan` = 19 a 20 min.

Dezesseis segundos de build contra quatro minutos de um único arquivo de teste (`locale-f3d-snapshot.test.js`, 3 min 55 s) mostram onde o tempo não está: o problema é distribuição e redundância, não a suíte em si.

## Escopo e validação

- **Incluído:**
  - **Fatia 1 (redundância):** lane hermética e lane de integração local separadas e paralelas no CHECK; claims executando contra o produto do preparo, com guarda de hash, em vez de recompilar; varredura com ferramentas em paralelo; cache persistente de banco e regras; imagem de lint pré-montada; reaproveitamento do relatório da base por SHA.
  - **Fatia 2 (ferramentas):** `tsgo` no preparo e no build do manifesto, atrás de flag e com contrato de paridade de typecheck; `osv-scanner` no lugar de `trivy-vuln` + `npm-audit`; `oxlint` como primeiro passe de lint; binários nativos onde o catálogo já declara `native`; orçamento de tempo por arquivo de teste para matar o long tail.
  - **Fatia 3 (seletividade, opcional e depois das duas):** mapa de impacto arquivo para testes nas rodadas intermediárias do GO e do CHECK.
  - `duracaoMs` por comando no `verify_run`, para que a meta seja medida pelo ledger e não por cronômetro manual.
- **Fora de escopo:** trocar o runner de testes (`node:test`) por Bun ou Vitest, porque reescreve a semântica de 5.718 testes e quebra o critério de paridade; CodeQL, SBOM e DAST; reduzir cobertura, arquivos de teste ou categorias de varredura em qualquer fatia; mexer no CI hospedado além de manter `test:ci` equivalente.
- **Entregáveis e critérios de aceite:**
  - o gate executa os mesmos 350 arquivos e o mesmo conjunto de testes da linha de base, com a lista de arquivos idêntica e registrada no ledger;
  - as nove categorias de varredura continuam rodando, comparadas por impressão digital: zero achado novo ou desaparecido em relação à base de 24/10/2026;
  - `tsgo` só entra em produção se o typecheck for idêntico ao do `tsc` 5.9.3 no mesmo commit (mesmo conjunto de erros e nenhum erro novo);
  - `oxlint` só substitui o `eslint` no que ele cobre; regra type-aware continua coberta por quem a cobre hoje;
  - o CHECK completo fica em no máximo 3 min de parede em três rodadas consecutivas, medido pelo ledger;
  - a máquina não passa de 4 GB de pico agregado no CHECK.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads do próprio Orkastery por três rodadas de CHECK. Interrompe e volta ao dono se algum critério de paridade falhar, se o typecheck divergir do `tsc`, ou se a meta de 3 min não for atingida na fatia 2 (nesse caso a fatia 3 vira necessária e a meta é renegociada com o dono, sem reduzir cobertura).

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade máxima declarada pelo dono em 24/10/2026 ("já priorize a implementação disso agora em modo auto, quero lançar uma nova versão incluindo isso o mais rápido possível"). A posição no índice de prioridade do roadmap é decisão dele; esta página registra o pedido de execução imediata.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data fechada. Fatias 1 e 2 correm na mesma thread `#Auto`, com fatia 2 começando só depois de a fatia 1 estar mesclada. Lançamento de versão nova (minor) ao fim da fatia 2.
- **Dependências e bloqueios:** `tsgo` estável (TypeScript 7, agosto de 2026) e remoção de `moduleResolution: node10` no `tsconfig`; catálogo `assets/security-scan/tools.json` como fonte única das ferramentas; `integracoes-locais.ts` como fonte única da lista de integração; `verify_run` do ledger para a medição.

### Fatias

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Redundância | Duas lanes de teste (`test` hermética e `test:integracao` com os 19 arquivos já listados) rodando em paralelo no CHECK; claims reaproveitando o produto do preparo com guarda de hash; varredura com ferramentas em paralelo; cache persistente de banco e regras; imagem de lint pré-montada; relatório da base reaproveitado por SHA; `duracaoMs` no `verify_run` | Medição de três CHECKs seguidos: CHECK completo em no máximo 6 min. O teste de integração do scan deixa de rodar dentro da lane hermética, e a lane hermética continua com o mesmo conjunto de arquivos do `test:ci`. Uma claim sem preparo válido recompila e registra o motivo; claim com hash divergente não usa o produto velho. Duas varreduras seguidas com a mesma base produzem o mesmo relatório e a segunda não rebaixa banco nem regras. |
| F2 Ferramentas | `tsgo` no preparo e no build do manifesto, atrás de flag; `osv-scanner` no lugar de `trivy-vuln` + `npm-audit`; `oxlint` como primeiro passe; binários nativos onde o catálogo permite; orçamento de tempo por arquivo de teste | Medição de três CHECKs seguidos: CHECK completo em no máximo 3 min. Typecheck do `tsgo` idêntico ao do `tsc` no commit de comparação. Varredura com as nove categorias, comparação de impressão digital sem diferença. Nenhum arquivo de teste acima do orçamento. |
| F3 Seletividade (opcional) | Mapa de impacto arquivo para testes nas rodadas intermediárias; suíte completa permanece obrigatória no gate | Rodada parcial abaixo de 90 s, com a lista de arquivos afetados provada a partir do diff; o gate continua rodando a suíte completa. |

- **Premissas / riscos / mitigação:**
  - **TypeScript 7 remove `moduleResolution: node10`** (já reproduzido: `TS5108` e `TS1479` no `smol-toml`). Mitigação: migração isolada em branch, com comparação de erros contra o `tsc` 5.9.3 e `tsgo` só ligado por flag até a paridade; se não houver paridade, `tsc` continua e a meta de 3 min é buscada nas outras frentes.
  - **`oxlint` não cobre regras type-aware.** Mitigação: entra como primeiro passe, não como substituto; o conjunto de regras type-aware continua com quem cobre hoje.
  - **`osv-scanner` pode não cobrir tudo que `trivy-vuln` + `npm-audit` cobrem hoje.** Mitigação: comparação por impressão digital antes de remover as duas ferramentas; enquanto não houver paridade, elas rodam em paralelo e a decisão de remoção é do dono.
  - **Mudar o cache de varredura pode mascarar achado novo.** Mitigação: o cache é só de banco de dados e de regras, nunca de resultado; o relatório por SHA continua sendo recalculado.
  - **Duas lanes disputam CPU.** Mitigação: o limite `concurrency.max_parallel_heavy` e o orçamento por arquivo passam a valer para as duas lanes, com a lane de integração com prioridade menor.
  - **Meta de 3 min pode não ser atingida sem reduzir cobertura.** Mitigação: a fatia 3 existe para isso, e a regra é explícita: cobertura não cai. Se a meta não for atingida, a decisão volta ao dono.
- **Não-objetivos:** trocar o runner de testes; reduzir a suíte; deixar de rodar a varredura no CHECK; otimizar o CI hospedado além de manter o mesmo conjunto de arquivos.

### Decisões

**D1. Qual escopo executar agora. Decidida pelo dono em 24/10/2026: alternativa B, fatias 1 e 2 juntas, em modo `#Auto`, com lançamento de versão nova o mais rápido possível.** O texto do dono: "B) 1+2 juntas, siga! E já priorize a implementação disso agora em modo auto, quero lançar uma nova versão incluíndo isso o mais rápido possível." Consequência: a thread nasce `#Auto` e cobre F1 e F2; F3 fica registrada e só começa se a meta de 3 min não for atingida com F1 e F2.

## Fontes

- Medição de 24/10/2026 nesta estação, sobre `~/orkastery-novo` na versão 0.5.6: `npm test` (15 min 22 s, 4.023 s de CPU, 1,52 GB de pico, 5.718 testes), `tsc --build` (16,9 s), `tsc --build tsconfig.test.json` (35,2 s, 2,16 GB), `ork security-scan` (2 min 27 s, 23.422 achados), `docker run` com imagem quente (0,62 s).
- Sonda de `tsgo` com `@typescript/native-preview` 7.0.0-dev em 24/10/2026: 4,1 s de typecheck completo de `src` + `test`, contra 35,2 s do `tsc` 5.9.3 (8,5x), com erro de configuração esperado (`moduleResolution: node10` removido).
- Código citado: `core/package.json`, `core/scripts/test-ci.js`, `core/src/integracoes-locais.ts`, `core/src/verify.ts`, `core/src/security-scan/run.ts`, `core/src/security-scan/executor.ts`, `core/assets/security-scan/tools.json`, `orkastery.yaml`.
- Pesquisa de ferramentas de 24/10/2026: TypeScript 7 nativo (InfoQ, agosto de 2026); `oxlint` com 50 a 100x o ESLint (`oxc-project/bench-linter`); `osv-scanner` como gate rápido de SCA (comparativo de 2026); `ast-grep` como alternativa de SAST por AST.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-24 | Julio |
| Documentação | Em revisão | — | 2026-10-24 | Julio |
| Código | Não iniciado | — | 2026-10-24 | Julio |
| Testes | Não iniciados | — | 2026-10-24 | Julio |
| Deploy | Não implantado | — | 2026-10-24 | Julio |
| Exposição | Flag desligada | — | 2026-10-24 | Julio |
| Habilitação | Pendente | — | 2026-10-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-check5x`, só para esta página; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** análise e medição feitas por Hermes em 24/10/2026 a pedido do dono; a implementação vai por thread `#Auto`; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** abrir a thread `#Auto` com esta página como escopo, despachar GOAL e conduzir F1 e F2 até o ship e a versão nova; responsável pelo despacho: Hermes; prazo: o mais rápido possível, por pedido do dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-24 | Item criado em Discovery com F1, F2 e F3 propostas, e D1 já decidida pela alternativa B | Medição de 24/10/2026 e pedido do dono de executar agora em `#Auto` | Julio |
