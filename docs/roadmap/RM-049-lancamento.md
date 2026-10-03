---
id: RM-049
tipo: roadmap
titulo: Lançamento do Orkastery, com documentação no site, marketplaces e anúncio
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-03T06:50:27-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 7202e47
    pr: 90
    ensaio: "73df05b1, PR #74"
    achados: "0080d87f, PR #77"
    recibos: "7202e479, PR #90"
    p4: "e7c465a5, PR #51"
  testes:
    ci: verde no PR (run 36660154276) e no push da v0.5.0 (run 36815186450); no push do merge, a suíte passou e o CHECK independente reprovou a claim S9, que compara a branch com a main (run 36660497346)
  deploy:
    release: Marketplace próprio em marketplaces/; P4 incluído na v0.5.2; ensaio, achados e recibos posteriores na main
sdlc:
  thread: ork-rm049recibos
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-049 — Lançamento do Orkastery, com documentação no site, marketplaces e anúncio

> **Em uma frase:** levar o Orkastery a quem constrói produto com agentes: documentação no site gerada do próprio repositório, plugin e skills nos marketplaces oficiais e um anúncio em inglês e português.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem constrói produto com agentes ainda não encontra o Orkastery; a documentação do site é escrita à mão, só em português, e pode divergir do repositório.
- **Evidências e fonte:** a [RM-046](RM-046-go-to-open-source.md) deixou no ar o repositório público, o pacote no npm e os sites; faltam os canais de chegada.
- **Objetivo/OKR:** quem chega pelo anúncio ou pelo marketplace instala e roda o primeiro ciclo em até 5 minutos.
- **Hipótese:** Se a documentação do site sair do mesmo docs-as-code do repositório, em inglês e português, e o plugin estiver nos marketplaces oficiais, então o caminho do anúncio ao primeiro ciclo não quebra, porque não existem duas versões da verdade.
- **Métrica principal / linha de base / meta / janela / fonte:** adoção (instalações do `@orkastery/cli` e primeiros ciclos); a meta fica com o dono.
- **Métricas de proteção:** nenhum dado pessoal ou interno publicado; a documentação do site nunca diverge da do repositório.

## Escopo e validação

- **Incluído:**
  1. documentação do orkastery.com gerada no build a partir de `docs/`, em inglês e português;
  2. plugin do Claude Code e skills do Codex nos marketplaces oficiais;
  3. textos do anúncio, entregues ao dono fora do repositório público. Publicar é ato do dono.
- **Fora de escopo dos marketplaces:** mudar o comportamento do produto. As fatias posteriores do ensaio corrigiram os atritos da primeira experiência, incluindo P4 (`worktree.por_thread`), com evidências abaixo.
- **Entregáveis e critérios de aceite:** a documentação do site bate com `docs/` na checagem do CI; o plugin e as skills aparecem nos marketplaces; os textos são aprovados pelo dono.
- **Piloto, medição e critérios de expansão/interrupção:** itens 2 e 3 na thread `ork-rm049marketp`; medição: as regras bloqueantes dos dois checklists que se conferem offline estão no gerador do plugin e rodam no CI, e cada campo dos dois portais tem valor pronto no kit; expansão: listagem aprovada nos dois diretórios; interrupção: achado do portal que exija mudar o comportamento do produto.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** continuação da RM-046, por decisão do dono em 28/09/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** plugin do Claude Code e plugin de skills do Codex prontos para os diretórios e marketplace próprio no repositório, em PR em 29/09/2026; submissão aos portais e publicação do anúncio com o dono, na data que ele escolher.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-046 (o domínio orkastery.com servindo o site).
- **Premissas / riscos / mitigação:** a aprovação nos marketplaces depende de terceiros; o item não trava por ela, porque o marketplace próprio instala sem revisão. O tempo até o primeiro ciclo em máquina limpa não foi medido, e nenhum texto do anúncio promete tempo.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** escopo movido da RM-046 (Julio, 28/09/2026). Na thread `ork-rm049marketp` (29/09/2026, decisões autônomas no ledger): o plugin dos marketplaces sai sem hooks nem MCP, porque instalado pelo diretório vale para a conta toda; as pastas do plugin são geradas do catálogo e conferidas no CI; a versão do plugin é a do `@orkastery/cli`. Respostas do dono (29/09/2026): o marketplace próprio entra com o merge; privacidade em `marketplaces/PRIVACY.md` e termos pela `LICENSE` (MIT); o dono publica o anúncio, e nenhum agente publica em canal nenhum. Regra do dono (28/09/2026): o repositório público leva só o necessário, e rascunhos e plano de lançamento ficam fora dele.

## Estado com evidências

- Item 2, só o plugin nos marketplaces: na `main` pelo PR #26 (merge `f0b7925`), na versão 0.5.0 (tag `v0.5.0`, merge `2418a4e`, PR #36). O marketplace próprio fica em `marketplaces/` no repositório, fora do pacote do npm.
- CI: verde no PR #26 (run 36660154276) e no push da versão 0.5.0 (run 36815186450). No push do merge, a suíte passou (1995 aprovados, 1 pulado, 0 falhas) e o CHECK independente reprovou só a claim S9 da thread, que compara a branch com a `main` (run 36660497346).
- Ensaio de primeira experiência sobre a `main` de 03/10/2026 (thread `ork-rm049ensaiod`): o tarball do `npm pack` num prefixo isolado com HOME temporário, o README e o quickstart num repositório de brinquedo, a primeira thread em #Fast. Recibos: [rodada da `main`](evidencias/RM-049/ensaio-2026-10-03.json), com cada atrito, a prova e a recomendação, e [rodada do candidato](evidencias/RM-049/ensaio-2026-10-03-candidato.json), refazendo os passos corrigidos. Corrigidos 7 defeitos (E1 a E7) e 2 da documentação (Q1, Q2) no PR #74 (merge `73df05b1`); R1, R2 e R4 a R8, no PR #77 (merge `0080d87f`). O ajuste dos recibos também está na `main`, pelo PR #90 (merge `7202e479`). No recibo, cada achado corrigido cita o PR e o commit, e o R3 segue registrado, com a decisão do dono. O teste `rm049-recibos-de-ensaio` confere todo `ensaio-*.json`: achado corrigido cita um commit que está na `main`, e achado registrado não cita commit.
- P4 do ensaio está na `main` em `e7c465a5`, incluído na versão 0.5.2 (`6b2899a6`). Com `worktree.por_thread: true`, `ork thread new` cria a worktree e a branch da thread, inclusive com `--from-finding`; chave ausente ou `false` mantém a criação sem worktree automática. `--sem-worktree` opta pela raiz e avisa as consequências; combinações incompatíveis recusam antes de reservar o item. `--dry-run` mostra o destino, e a criação a partir de outra worktree usa a pasta da árvore principal. Sem commit no repositório, a worktree automática espera o primeiro commit. Prova: `core/test/p4-worktree-por-thread.test.ts`.
- Seguem em aberto: o item 1 (documentação do site gerada de `docs/`), a submissão aos diretórios oficiais e o item 3, todos com o dono.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `7202e47` · PR #90 · ensaio: 73df05b1, PR #74 · achados: 0080d87f, PR #77 · recibos: 7202e479, PR #90 · p4: e7c465a5, PR #51 | 2026-10-03 | Julio |
| Testes | Aprovados | ci: verde no PR (run 36660154276) e no push da v0.5.0 (run 36815186450); no push do merge, a suíte passou e o CHECK independente reprovou a claim S9, que compara a branch com a main (run 36660497346) | 2026-10-03 | Julio |
| Deploy | Produção | release: Marketplace próprio em marketplaces/; P4 incluído na v0.5.2; ensaio, achados e recibos posteriores na main | 2026-10-03 | Julio |
| Exposição | Flag desligada | — | 2026-10-03 | Julio |
| Habilitação | Pendente | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: agentes do Orkastery · A: Julio · C: — · I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** execução por agente dentro do modo da thread; publicar e anunciar são atos do dono.
- **Próxima ação, responsável e prazo:** o dono submete nos dois portais pelo guia `marketplaces/README.md`, valida os textos do anúncio com o condutor e publica (Julio).

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-28 | proposto | escopo restante da RM-046 (H6 do dono) | Julio |
| 2026-09-29 | Itens 2 e 3 em PR | Thread `ork-rm049marketp` (#Auto): plugin e skills prontos para os diretórios, marketplace próprio, guia de submissão e rascunhos do anúncio; item 1 em outra thread | Julio |
| 2026-09-29 | Rascunhos do anúncio fora do PR | Regra do dono (28/09/2026): o repositório público leva só o necessário; os textos vão ao dono pelo condutor | Julio |
| 2026-09-29 | Plugin nos marketplaces mesclado na `main`; entra na versão 0.5.0 | PR #26, merge `f0b7925`; tag `v0.5.0` | Julio |
| 2026-10-03 | Terceiro ensaio de primeira experiência, sobre a `main` | Thread `ork-rm049ensaiod` (#Auto): 9 correções e 8 achados com recomendação, recibos em `evidencias/RM-049/` | Julio |
| 2026-10-03 | Recibo do ensaio com o estado real dos achados | Thread `ork-rm049recibos` (#Auto): R1, R2 e R4 a R8 em `corrigido` com o PR #77 e o commit, E1 a E7, Q1 e Q2 com o PR #74 e o commit, R3 registrado; teste de guarda `rm049-recibos-de-ensaio` | Condutor #Auto, por delegação do dono |
| 2026-10-03 | Ensaio, achados, recibos e P4 já mesclados; frentes restantes seguem abertas | `73df05b1` (PR #74), `0080d87f` (PR #77), `7202e479` (recibos, PR #90) e `e7c465a5` (P4, PR #51) | Codex (agente, #Fast), revisão pendente |
