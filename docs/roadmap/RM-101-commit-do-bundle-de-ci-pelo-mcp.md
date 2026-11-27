---
id: RM-101
tipo: roadmap
titulo: Commit do bundle de CI pelo MCP
categoria: iniciativa
pai: null
features: []
owner: Condução do roadmap
atualizado_em: 2026-11-27T12:19:58-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 59bab85
    pr: null
sdlc:
  thread: ork-rm101bundled
  modo: Fast
  fase: GO
  status: fechada
---

# RM-101 — Commit do bundle de CI pelo MCP

> **Em uma frase:** a sessão registra pelo MCP o bundle de CI produzido pelo verify verde, sem claim artificial nem commit feito fora do núcleo.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** sessões de GO que usam o transporte MCP conseguem gerar o bundle oficial de CI, mas não conseguem registrá-lo pelo mesmo transporte. O caminho oficial fica incompleto e incentiva commit por fora do núcleo ou uma claim sem significado.
- **Evidências e fonte:** achado da condução de 25 e 26/11/2026. O `ork_git_commit` recusou `.ork-ci/<thread>.json` com `mcp.git.claim.missing`, e a condução precisou commitar o bundle por fora em mais de uma thread. Esta mesma thread reproduziu a recusa em 26/11/2026, e a condução commitou o bundle.
- **Objetivo/OKR:** fechar o GO pelo transporte autorizado, mantendo o bundle derivado ligado à rodada verde, ao HEAD e à thread que o produziu.
- **Hipótese:** se o núcleo reconhecer o bundle como artefato derivado com recibo próprio, então o MCP poderá commitá-lo sem claim artificial, enquanto arquivos comuns continuam exigindo claims.
- **Métrica principal / linha de base / meta / janela / fonte:** proporção de bundles gerados pelo fluxo oficial que são commitados pelo MCP sem desvio de transporte. A linha de base é o achado da condução; a meta e a janela serão definidas na fase GOAL; a fonte será o ledger e o recibo do commit.
- **Métricas de proteção:** nenhum arquivo comum perde a exigência de claim; bundle de outra thread, de outro HEAD ou de verify não verde é recusado; o conteúdo gerado não vira prova de si mesmo.

## Escopo e validação

- **Incluído:** recibo do `ork ci prepare`; vínculo entre bundle, thread, HEAD e rodada verde; exceção estreita no `ork_git_commit` para o bundle derivado; commit com HEAD esperado; resposta tipada para bundle ausente, alterado, obsoleto ou de outra thread.
- **Fora de escopo:** dispensar claims de arquivos de produto ou documentação; aceitar bundle editado pela sessão; commitar por shell; executar o CI; autorizar SHIP, push, PR ou merge.
- **Entregáveis e critérios de aceite:** depois do verify verde, `ork ci prepare <thread>` gera o bundle e o `ork_git_commit` o registra no HEAD esperado sem claim artificial; mudança no bundle, na rodada, na thread ou no HEAD recusa antes do commit; os demais paths continuam recusados sem claim; o recibo do commit identifica o artefato derivado sem declarar que ele verificou a si mesmo.
- **Comportamento dos caminhos:** qualquer `.ork-ci/*.json` que não seja o bundle da própria thread é recusado, mesmo com claim, inclusive `.ork-ci/bundle.json`; bundle alterado é recusado mesmo com claim no próprio caminho; a remoção de um bundle rastreado também é recusada como `bundle.missing`. O bundle derivado ocupa um commit exclusivo.
- **Piloto, medição e critérios de expansão/interrupção:** o piloto pelo MCP continua pendente até esta mudança estar no núcleo usado pela condução. Expandir quando uma thread posterior preparar e registrar o bundle pelo caminho oficial. Interromper se um arquivo arbitrário puder usar o recibo, se um bundle obsoleto for aceito ou se o objeto commitado divergir dos bytes conferidos.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta originada na condução da versão 0.6.11; sem prioridade atribuída nesta thread. O roadmap decide a posição antes de abrir trabalho.
- **Horizonte / alvo / previsão / confiança / marcos:** implementação em andamento na thread `ork-rm101bundled`, sem previsão de merge ou implantação. Marcos: contrato do recibo, guarda estreita no commit, provas de recusa e piloto posterior pelo MCP.
- **Dependências e bloqueios (ID, owner, próxima revisão):** contrato do bundle de CI, `ork ci prepare`, `ork_git_commit`, claims e verify; owner: Condução do roadmap; revisão quando o roadmap priorizar o item.
- **Premissas / riscos / mitigação:** o ledger, as claims, o índice, o gitdir e o marcador `.git` da worktree ficam fora do alcance de escrita da sessão. Essa fronteira sustenta o recibo de preparo. A exceção fica limitada ao path calculado, ao hash das claims ativas no commit, aos bytes produzidos e ao oid Git correspondente. O índice e o objeto commitado são conferidos. Uma rodada obsoleta, claims alteradas após a rodada, um recibo forjado fora dessa fronteira ou uma conversão de conteúdo são recusados.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** a sessão GO `ork-achados0611` separou o achado em item próprio porque o bundle é artefato derivado do fechamento, não uma alegação de produto. A decisão está registrada no ledger da thread.
- **Continuação futura:** atualizar a descrição pública de `ork_git_commit`, as instruções das sessões e as referências em português e inglês de `ork ci prepare` num ciclo que possa alterar contrato público. Esta entrega Fast preserva esses textos.

## Estado com evidências

A branch da thread implementa o contrato de derivação no preparo, incluindo o hash das claims da rodada. O commit MCP compara esse hash às claims ativas, confere modo e oid no índice, commita o índice sem pathspec, confirma o objeto e desfaz a ref se a confirmação divergir. A suíte dedicada cobre troca concorrente dos bytes e do modo, atributo `ident`, restauração do índice novo ou rastreado, caminhos Markdown sem claim, caminho de outra thread, commit misto, bundle alterado com claim e rodadas sem recibo, não verdes ou parciais. Merge, deploy, habilitação e piloto continuam fora desta entrega.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-27 | Condução do roadmap |
| Documentação | Em revisão | — | 2026-11-27 | Condução do roadmap |
| Código | Mesclado | commit `59bab85` | 2026-11-27 | Condução do roadmap |
| Testes | Em execução | — | 2026-11-27 | Condução do roadmap |
| Deploy | Não implantado | — | 2026-11-27 | Condução do roadmap |
| Exposição | Flag desligada | — | 2026-11-27 | Condução do roadmap |
| Habilitação | Pendente | — | 2026-11-27 | Condução do roadmap |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread do item; A: condução do roadmap; C: manutenção de claims, verify, CI e MCP; I: builders que fecham GO pelo transporte MCP.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO implementa a fatia em modo Fast e registra as decisões autônomas no ledger. O histórico identifica separadamente as correções posteriores ao CHECK independente.
- **Próxima ação, responsável e prazo:** concluir o verify oficial e o bundle final desta thread; o piloto funcional pelo MCP fica para uma thread posterior com o núcleo atualizado; responsável: condução do roadmap; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-26 | Proposta registrada em Discovery | Achado da condução de 25 e 26/11/2026: o bundle oficial foi recusado pelo MCP com `mcp.git.claim.missing` | sessão GO `ork-achados0611` (#Fast) |
| 2026-11-27 | Implementação iniciada na thread `ork-rm101bundled` | Contrato de derivação, guarda estreita do commit MCP e suíte dedicada na branch da thread | sessão GO (#Fast) |
| 2026-11-27 | Correção após o primeiro CHECK independente | Commit preso ao oid conferido, limpeza do índice, hash das claims e casos de ataque incorporados à suíte | sessão GO (#Fast) |
