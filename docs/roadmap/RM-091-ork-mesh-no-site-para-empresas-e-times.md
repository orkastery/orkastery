---
id: RM-091
tipo: roadmap
titulo: Ork Mesh no site, para empresas e times
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-11T18:10:04-03:00
estado:
  ciclo: Em desenvolvimento
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

# RM-091 — Ork Mesh no site, para empresas e times

> **Em uma frase:** o site explica a Ork Mesh a empresas e times de builders, separa o que já está disponível do que ainda está em desenvolvimento e leva quem decide a um caminho de adoção.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e nome

Pedido do dono no terminal, em 11/11/2026:

> "planeje uma evolução para o website do orkastery ter uma sessão voltada para empresas e times de Builders que trabalham em estruturas coletivas, mostrando o conceito da Ork Mesh"

Na mesma data, o dono escolheu a alternativa **A**: abrir o item no roadmap, com o título "Ork Mesh no site, para empresas e times", e construir junto com a 0.6.9.

**Ork Mesh**, também chamada **Ork Building Mesh**, é o nome dado pelo dono à rede da [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md): as Orkastery Networks dos builders são consolidadas numa Orkastery Network da empresa, mantida em um repositório privado na forja, de onde o Ork lê projetos, roadmaps, reservas e threads.

## Problema e resultado

- **Público e problema/oportunidade:** quem decide a adoção em uma empresa ou em um time de builders precisa entender o que a rede coletiva compartilha, o que permanece local, como a política no Git funciona e quais capacidades já estão disponíveis. O site ainda não reúne esse caminho.
- **Evidências e fonte:** pedido do dono de 11/11/2026; contrato da rede coletiva na [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md); telemetria e SDLC Analytics na [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md); regras de site na [RM-060](RM-060-site-como-produto.md); rede pessoal na [RM-053](RM-053-orkastery-network.md).
- **Objetivo/OKR:** publicar uma página bilíngue que explique a Ork Mesh com paridade, privacidade, estado rastreável e um caminho de adoção gradual.
- **Hipótese:** se a página separar capacidades por estado e mostrar o fluxo coletivo sem expor dados privados, então quem decide consegue avaliar a adoção com base no produto real.
- **Métrica principal / linha de base / meta / janela / fonte:** a definir na construção do site, sem número inventado nesta página. A fonte será a medição do site e o estado do roadmap lido no build.
- **Métricas de proteção:** nenhuma promessa acima do estado do roadmap; nenhum dado privado, nome de cliente ou configuração de hardware; paridade entre pt-BR e inglês.

## Escopo e validação

- **Incluído:** a página `<https://orkastery.com/empresas/>` em pt-BR e `<https://orkastery.com/en/companies/>` em inglês, no repositório do site `<https://orkastery.com/>`, com o item "Empresas" na navegação.
- **Fora de escopo:** mudar o produto. A página descreve somente o que a RM-089 e a RM-090 entregam e mostra o estado real de cada capacidade.
- **Entregáveis e critérios de aceite:** as quatro fatias abaixo; cada uma declara uma prova verificável no repositório do site ou no build do conteúdo.
- **Piloto, medição e critérios de expansão/interrupção:** começar com a página marcada pelo estado do roadmap; interromper a publicação se houver promessa sem lastro, dado privado, nome de cliente ou configuração de hardware.

### Estrutura da página

1. **Abertura:** o símbolo da marca é apresentado em uma sequência visual que mostra a formação da Ork Mesh.
2. **As três perguntas de quem decide:** o que a empresa coordena, o que permanece na máquina do builder e o que a política pode exigir no Git.
3. **Ork Mesh:** diagrama interativo com o que vai para a rede da empresa e o que fica na máquina.
4. **Entrada na rede:** cinco passos com os comandos `ork network empresa ...`.
5. **Trava no Git:** simulador dos níveis `observar`, `avisar` e `exigir`.
6. **Duplicidade e reserva:** aviso de trabalho já reservado, colaboração e acordo registrado.
7. **Telemetria e SDLC Analytics:** privacidade declarada e maturidade por indicadores separados, sem nota única.
8. **Como adotar:** piloto em `observar`, avanço para `avisar` e, depois da validação, `exigir`.
9. **As perguntas de quem decide:** respostas sobre estado, privacidade, governança, forja, telemetria e implantação.
10. **Contato:** caminho para conversar sobre piloto e adoção.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Página e diagrama em pt-BR e inglês | As rotas `<https://orkastery.com/empresas/>` e `<https://orkastery.com/en/companies/>` passam pelo build e pelo teste de paridade; seções, estados, ações e conteúdo do diagrama têm correspondência entre os idiomas |
| F2 | Cartão de times na home e item "Empresas" na navegação | O teste de navegação prova que o cartão da home e o item nos dois idiomas levam à rota correspondente, sem link quebrado |
| F3 | Categoria "Empresas" na documentação do site | O build inclui a categoria nos dois idiomas e confere que os guias do núcleo sobre política de recibo, rede coletiva e telemetria estão sincronizados com a versão publicada |
| F4 | Selo de estado em cada bloco | O build lê o roadmap e aceita somente "disponível na 0.6.9", "em desenvolvimento" ou "planejado"; um estado ausente, divergente ou sem origem reprova o build |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Junto com a 0.6.9 (decisão do dono em 11/11/2026). Pontuação não se aplica; é uma decisão direta do dono.
- **Horizonte / alvo / previsão / confiança / marcos:** marcos F1 a F4; sem previsão adicional nesta página. A publicação segue a aprovação definida pela RM-060.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-089, RM-090, RM-060 e RM-053; owner: Julio; próxima revisão no planejamento da construção no repositório do site.
- **Premissas / riscos / mitigação:**
  - o site pode prometer mais do que existe; a F4 lê o estado do roadmap no build e reprova divergências;
  - dado privado ou nome de cliente pode chegar ao conteúdo público; a checagem de conteúdo recusa ambos;
  - número ou configuração de hardware pode expor ambiente e envelhecer o texto; a checagem de conteúdo recusa essa informação.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** em 11/11/2026, o dono escolheu abrir a RM-091 e construí-la junto com a 0.6.9; o nome público é Ork Mesh, também Ork Building Mesh.

### Relações com o roadmap

- **[RM-089](RM-089-orkastery-network-coletiva-da-empresa.md):** fonte do contrato da rede coletiva, da duplicidade, das reservas e da política no Git.
- **[RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md):** fonte da telemetria, da privacidade e da SDLC Analytics sem nota composta.
- **[RM-060](RM-060-site-como-produto.md):** define build, paridade, revisão e publicação do site como produto.
- **[RM-053](RM-053-orkastery-network.md):** define a Orkastery Network pessoal que se inscreve na rede coletiva.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-11 | Julio |
| Documentação | Rascunho | — | 2026-11-11 | Julio |
| Código | Não iniciado | — | 2026-11-11 | Julio |
| Testes | Não iniciados | — | 2026-11-11 | Julio |
| Deploy | Não implantado | — | 2026-11-11 | Julio |
| Exposição | Flag desligada | — | 2026-11-11 | Julio |
| Habilitação | Pendente | — | 2026-11-11 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: equipe do site; A: Julio; C: builders, segurança, privacidade e responsáveis pela documentação; I: empresas e times interessados.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** esta página foi aberta pela sessão de GO da thread `ork-rm091orkmesh`, em modo `#Fast`, a partir do pedido e das decisões do dono; a construção do site terá revisão no repositório próprio.
- **Próxima ação, responsável e prazo:** planejar F1 a F4 no repositório do site para a 0.6.9; responsável: equipe do site.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-11 | RM-091 criada em desenvolvimento; código e testes não iniciados; não implantada; flag desligada | Pedido do dono no terminal e escolha da alternativa A para construir junto com a 0.6.9 | Julio |
