---
id: RM-049
tipo: roadmap
titulo: Lançamento do Orkastery, com documentação no site, marketplaces e anúncio
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-29T23:29:40-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: PR aberto
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-rm049marketp
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-049 — Lançamento do Orkastery, com documentação no site, marketplaces e anúncio

> **Em uma frase:** levar o Orkastery a quem constrói produto com agentes: documentação no site gerada do próprio repositório, plugin e skills nos marketplaces oficiais e um anúncio em inglês e português.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | PR aberto | Em execução | Não implantado | Flag desligada |

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
- **Fora de escopo:** mudar o comportamento do produto.
- **Entregáveis e critérios de aceite:** a documentação do site bate com `docs/` na checagem do CI; o plugin e as skills aparecem nos marketplaces; os textos são aprovados pelo dono.
- **Piloto, medição e critérios de expansão/interrupção:** itens 2 e 3 na thread `ork-rm049marketp`; medição: as regras bloqueantes dos dois checklists que se conferem offline estão no gerador do plugin e rodam no CI, e cada campo dos dois portais tem valor pronto no kit; expansão: listagem aprovada nos dois diretórios; interrupção: achado do portal que exija mudar o comportamento do produto.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** continuação da RM-046, por decisão do dono em 28/09/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** plugin do Claude Code e plugin de skills do Codex prontos para os diretórios e marketplace próprio no repositório, em PR em 29/09/2026; submissão aos portais e publicação do anúncio com o dono, na data que ele escolher.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-046 (o domínio orkastery.com servindo o site).
- **Premissas / riscos / mitigação:** a aprovação nos marketplaces depende de terceiros; o item não trava por ela, porque o marketplace próprio instala sem revisão. O tempo até o primeiro ciclo em máquina limpa não foi medido, e nenhum texto do anúncio promete tempo.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** escopo movido da RM-046 (Julio, 28/09/2026). Na thread `ork-rm049marketp` (29/09/2026, decisões autônomas no ledger): o plugin dos marketplaces sai sem hooks nem MCP, porque instalado pelo diretório vale para a conta toda; as pastas do plugin são geradas do catálogo e conferidas no CI; a versão do plugin é a do `@orkastery/cli`. Respostas do dono (29/09/2026): o marketplace próprio entra com o merge; privacidade em `marketplaces/PRIVACY.md` e termos pela `LICENSE` (MIT); o dono publica o anúncio, e nenhum agente publica em canal nenhum. Regra do dono (28/09/2026): o repositório público leva só o necessário, e rascunhos e plano de lançamento ficam fora dele.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-29 | Julio |
| Documentação | Em revisão | — | 2026-09-29 | Julio |
| Código | PR aberto | — | 2026-09-29 | Julio |
| Testes | Em execução | — | 2026-09-29 | Julio |
| Deploy | Não implantado | — | 2026-09-29 | Julio |
| Exposição | Flag desligada | — | 2026-09-29 | Julio |
| Habilitação | Pendente | — | 2026-09-29 | Julio |

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
