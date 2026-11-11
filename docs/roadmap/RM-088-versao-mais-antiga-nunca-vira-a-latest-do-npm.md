---
id: RM-088
tipo: roadmap
titulo: Versão mais antiga nunca vira a latest do npm
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-10T11:20:00-03:00
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

# RM-088: Versão mais antiga nunca vira a latest do npm

> **Em uma frase:** a publicação compara versões por SemVer e impede que uma versão mais antiga substitua a `latest` do `@orkastery/cli`.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem instala `@orkastery/cli` sem informar uma versão pode receber uma versão mais antiga se tags de release forem publicadas fora de ordem, porque o workflow atual publica sem `--tag` e a `latest` acompanha a publicação.
- **Evidências e fonte:** achado de condução de 08/11/2026. As tags `v0.6.7` e `v0.6.8` precisaram ser enviadas em ordem, com a `v0.6.8` somente depois de o npm mostrar a `v0.6.7`. O job `publicar` de [`.github/workflows/publicar.yml`](../../.github/workflows/publicar.yml) executa `npm publish --access public`, sem `--tag`. A documentação oficial confirma que `npm publish` usa `latest` por padrão e que uma publicação com `--tag` usa outra dist-tag.
- **Decisão do dono:** em 10/11/2026, no terminal, o dono respondeu "1a" à escolha sobre a guarda de versão: abrir um item no roadmap e fazê-lo junto com a próxima versão.
- **Objetivo/OKR:** nenhuma publicação de versão anterior muda a `latest`, e uma instalação sem versão continua recebendo a versão estável mais nova já publicada.
- **Hipótese:** se o job decidir a dist-tag comparando por SemVer a versão da tag com a `latest` do registro antes de publicar, então releases fora de ordem permanecem disponíveis sem rebaixar a instalação padrão.
- **Métrica principal / linha de base / meta / janela / fonte:** versões menores publicadas como `latest`. Linha de base: risco observado na publicação ordenada de `v0.6.7` e `v0.6.8`. Meta: nenhuma. Janela: a definir pelo dono. Fonte: resultado do job de publicação e dist-tags do pacote no registro.
- **Métricas de proteção:** uma versão igual não é republicada; falha de consulta ao registro não libera publicação como `latest`; a primeira publicação continua possível por uma exceção explícita; Trusted Publishing, gatilho e demais passos do job permanecem inalterados.

## Escopo e validação

- **Incluído:**
  - antes de `npm publish`, comparar por SemVer a versão da tag com a versão apontada por `latest` no registro;
  - se a versão da tag for maior, publicar com `latest`, preservando o comportamento atual;
  - se for igual, falhar com mensagem clara de que a versão já está publicada;
  - se for menor, publicar com uma dist-tag própria que não seja `latest`, sem mover a `latest` existente;
  - se o registro estiver inacessível ou o pacote existente não tiver `latest`, falhar antes da publicação, sem assumir que é seguro usar `latest`;
  - tratar a primeira publicação como exceção explícita: somente a ausência inequívoca do pacote permite publicar como `latest`. A forma de distinguir essa ausência de uma falha do registro ainda é **não confirmada** e deve ser validada na construção;
  - documentar a política de publicação e registrar a mudança no CHANGELOG.
- **Fora de escopo:** mudar o Trusted Publishing, o gatilho por tag ou os demais passos do job `publicar`.
- **Entregáveis e critérios de aceite:**
  - regra de decisão isolada no núcleo, coberta por testes sem rede;
  - workflow consome a dist-tag decidida antes de publicar e nunca cai implicitamente em `latest` nos casos de erro ou versão menor;
  - documentação e CHANGELOG descrevem a guarda, a primeira publicação e a decisão D1 ratificada;
  - `node core/dist/index.js docs verificar` conclui com sucesso e a RM-088 aparece no índice do roadmap.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono.

### Fatias

#### F1 — Regra de versão no núcleo

- **Entrega:** script do núcleo que recebe a versão da tag e o estado consultado da `latest`, compara por SemVer e devolve a ação de publicação ou uma falha tipada, sem fazer rede.
- **Critério de aceite verificável:** testes unitários sem rede cobrem versão maior, igual e menor, registro inacessível, pacote existente sem `latest` e primeira publicação inequivocamente identificada; cada caso prova a dist-tag ou a mensagem de falha esperada.

#### F2 — Guarda no workflow de publicação

- **Entrega:** passo em [`.github/workflows/publicar.yml`](../../.github/workflows/publicar.yml), antes de `npm publish`, que consulta o registro, chama a regra da F1 e passa ao publish a dist-tag escolhida pela regra.
- **Critério de aceite verificável:** teste do workflow prova a ordem do passo e a passagem explícita da dist-tag; cenários de versão menor, igual, consulta indisponível e pacote existente sem `latest` não executam publicação como `latest`.

#### F3 — Documentação de publicação e CHANGELOG

- **Entrega:** documentação operacional explica a comparação, as falhas fechadas, a exceção de primeira publicação e a política ratificada em D1; o CHANGELOG registra a guarda.
- **Critério de aceite verificável:** `node core/dist/index.js docs verificar` conclui com sucesso, os documentos citam o comportamento efetivo do script e do workflow, e o CHANGELOG contém a mudança sem promessa não implementada.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Junto com a próxima versão do ork depois da 0.6.8 (decisão do dono em 10/11/2026). Pontuação: não se aplica; decisão direta do dono.
- **Horizonte / alvo / previsão / confiança / marcos:** Meta: A definir pelo dono. Piloto: A definir pelo dono. Marcos: F1, F2 e F3, nessa ordem.
- **Dependências e bloqueios (ID, owner, próxima revisão):** `@orkastery/cli` já publicado com uma `latest` consultável; owner: Julio; próxima revisão no planejamento da próxima versão. A ratificação de D1 é necessária antes da construção da regra.
- **Premissas / riscos / mitigação:**
  - premissa: a versão da tag continua igual à versão do pacote, guarda já existente no workflow;
  - risco: uma resposta ambígua do registro parecer primeira publicação; mitigação: falhar fechada e aceitar a exceção somente com ausência inequívoca do pacote;
  - risco: comparar versões como texto ordenar SemVer incorretamente; mitigação: comparação SemVer no script e casos de teste sem rede;
  - risco: uma dist-tag inválida ou com significado pouco claro dificultar a operação; mitigação: D1 ratificada e validação do nome contra as regras do npm;
  - risco: pré-release alcançar `latest` ou colidir com a política de versões estáveis; mitigação: regra explícita em D1 antes da implementação.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - **D0 — Quando fazer:** decidido pelo dono em 10/11/2026 pela resposta "1a": abrir a RM-088 e construir junto com a próxima versão do ork depois da 0.6.8.
  - **D1 — Nome da dist-tag e regra para pré-release:** decisão do dono, pendente. As opções abaixo são propostas; nenhuma está escolhida por esta página.
    1. Uma dist-tag fixa para toda versão estável menor e recusa de qualquer pré-release até uma política separada. É simples, mas bloqueia a publicação de `-rc` e `-beta`.
    2. Uma dist-tag fixa para versões estáveis menores e uma dist-tag derivada do identificador da pré-release, como `rc` ou `beta` (**recomendada**). Mantém `latest` reservada à versão estável maior e torna explícito o canal da pré-release; os nomes exatos ainda dependem do dono.
    3. Uma dist-tag por linha de versão, com pré-releases na tag da própria linha. Preserva mais linhas nomeadas, mas aumenta a quantidade de tags e a política operacional.

## Fontes e pontos não confirmados

- [npm publish, documentação oficial](https://docs.npmjs.com/cli/v11/commands/npm-publish/): a configuração `tag` tem `latest` como padrão e uma combinação de nome e versão já publicada faz o publish falhar.
- [npm dist-tag, documentação oficial](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/): publicar sem `--tag` move `latest`; publicar com `--tag` usa outra tag; instalações sem versão usam `latest`; outras tags não têm significado especial imposto pelo npm.
- [Adding dist-tags to packages, documentação oficial](https://docs.npmjs.com/adding-dist-tags-to-packages/): uso de `npm publish --tag` e restrições de nomes que compartilham o espaço de versões SemVer.
- [Workflow atual de publicação](../../.github/workflows/publicar.yml): origem do comportamento a alterar na futura construção.
- **Não confirmado pelas fontes:** o nome da dist-tag do Orkastery, a política do produto para pré-releases e a resposta exata do registro que distinguirá com segurança a primeira publicação de pacote inacessível ou existente sem `latest`.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-10 | Julio |
| Documentação | Rascunho | — | 2026-11-10 | Julio |
| Código | Não iniciado | — | 2026-11-10 | Julio |
| Testes | Não iniciados | — | 2026-11-10 | Julio |
| Deploy | Não implantado | — | 2026-11-10 | Julio |
| Exposição | Flag desligada | — | 2026-11-10 | Julio |
| Habilitação | Pendente | — | 2026-11-10 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que construir o item; A: Julio; C: dono e revisor do workflow de publicação; I: pessoas que publicam e instalam o CLI.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela sessão de GO a partir do achado de condução e da decisão "1a"; D1 permanece reservada ao dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono ratifica D1 no planejamento da próxima versão; a condução então planeja F1, F2 e F3.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-10 | Item criado em Discovery; código e testes não iniciados; não implantado; flag desligada; habilitação pendente | Achado de condução de 08/11/2026 e resposta "1a" do dono em 10/11/2026 | Dono para a janela; sessão de GO para o registro |
