---
id: RM-062
tipo: roadmap
titulo: Repositório público sem dado privado
categoria: melhoria
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-12T09:37:54-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
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
  thread: ork-rm062privado
  modo: "#Fast"
  fase: GO
  status: aberta
---

# RM-062 — Repositório público sem dado privado

> **Em uma frase:** nada que seja privado do dono entra em repositório público, nem em linha, nem em nome de arquivo, nem em JSON de evidência, e o que escapar vira achado no CI e correção por PR, com relatório honesto do que ficou no histórico.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Decisão do dono de 12/10/2026:** o arquivo de evidência da [RM-040](RM-040-estado-de-conta-compartilhado.md) que levava o nome de uma máquina do dono é renomeado por PR para um nome genérico, e o erro não se repete: "não volte nunca a cometer esse erro, inclua esse aprendizado como item de melhoria do orkastery no roadmap". Esta página é esse item.

Relações: [RM-046](RM-046-go-to-open-source.md) (GoToOpenSource), [RM-047](RM-047-fabrica-em-varias-maquinas.md) (fronteira de confiança) e [RM-053](RM-053-orkastery-network.md) (Orkastery Network). Detalhes em [Relação com outros itens](#relação-com-outros-itens).

## Problema e resultado

- **Público e problema:** o repositório do Orkastery é público, e a fábrica o alimenta por threads que gravam evidência da máquina onde rodam. Dado privado do dono (nome de máquina, caminho de home, e-mail pessoal, nome de cliente, data ou plano de lançamento, meta pessoal) chegou ao repositório dentro do nome de um arquivo de evidência, gravado por uma thread. Quando o achado apareceu, a condução o tratou como "já era público". Vazamento antigo continua sendo vazamento, e nome de arquivo também é conteúdo: aparece na listagem do repositório, na URL e no histórico.
- **Evidências e fonte:**
  - o arquivo de evidência da RM-040, gravado em 03/10/2026, levava no nome o hostname de uma máquina do dono, e o mesmo nome estava no campo `maquina` de outros recibos, em páginas do roadmap, em contratos e em bundles de claims;
  - a correção desta thread (`ork-rm062privado`) renomeia o arquivo para `maquina-b-2026-10-03.json` e generaliza o nome nos arquivos versionados; o nome antigo continua nos commits anteriores, porque o histórico não é reescrito.
- **Objetivo:** o repositório público e os dois sites públicos nunca mais recebem dado privado do dono por descuido de uma thread, de um agente ou de uma pessoa.
- **Resultado esperado:**
  - **nada privado entra:** nem em linha de código ou de doc, nem em nome de arquivo, nem em JSON de evidência, nem em mensagem de commit ou bundle de CI;
  - **o que escapar é achado:** o CI do núcleo e o dos sites reprovam o PR com o arquivo e a linha, sem imprimir o termo privado inteiro;
  - **a correção é por PR:** o achado vira correção por PR, com texto honesto sobre o que fica no histórico;
  - **evidência nasce genérica:** quem grava recibo de máquina grava `maquina-a`, `maquina-b`, nunca o hostname.
- **Hipótese:** se a barreira roda no CI, no `ork verify` e no `ork ci prepare`, com padrões genéricos mais uma lista local que fica fora do git, então o dado privado é pego antes do commit final e, no pior caso, antes do merge, porque a verificação deixa de depender de alguém notar.
- **Métrica principal / linha de base / meta / janela / fonte:** ocorrências de termo privado em arquivo versionado e em nome de arquivo, medidas por `git grep` e `git ls-files` com os padrões e a lista local. Linha de base: 59 ocorrências do hostname em 24 arquivos, e 1 nome de arquivo, em 12/10/2026, antes da correção desta thread. Meta: 0 a cada PR. Janela: cada PR, no CI.
- **Métricas de proteção:**
  - falso positivo baixo: padrões genéricos têm lista de exceções por caminho (exemplos de documentação como `/home/usuario`) e a lista é revisada em PR;
  - a lista local de termos privados nunca vai ao git, ao bundle, ao ledger ou a log de CI;
  - o relatório do achado não repete o termo privado: diz o arquivo, a linha e o padrão.

## Escopo e validação

- **Incluído:**
  - barreira de dado privado no CI do núcleo e dos sites públicos, em linhas e em nomes de arquivo;
  - a mesma barreira em `ork verify` e em `ork ci prepare`, antes do commit final;
  - nome genérico de máquina por construção nas threads que gravam evidência de rede;
  - relatório honesto quando algo escapou.
- **Fora de escopo:**
  - reescrever o histórico do git de commits já publicados; o PR de correção diz que o nome antigo segue nos commits anteriores, e a decisão de reescrever é do dono, caso a caso;
  - rotação de segredo (token, chave): é outra classe de achado, com a varredura de segredos já existente;
  - dado privado fora do repositório (conversa, ledger local, `.orkastery/`), que não é publicado.

### Fatias

| Fatia | Resultado | Critério de aceite verificável | Dependências |
| --- | --- | --- | --- |
| F1: Barreira no CI | O CI do núcleo e o dos sites varrem as linhas e os nomes de arquivo versionados. Padrões genéricos: `/home/<usuário>`, e-mails fora da lista permitida, hostnames. Mais uma lista local de termos privados, fora do git, lida só na máquina de quem roda | Um arquivo de teste com cada padrão reprova; um nome de arquivo com termo da lista reprova; a lista local ausente no CI não derruba a varredura dos padrões genéricos; o relatório não imprime o termo privado inteiro | Nenhuma |
| F2: Barreira no `ork verify` e no `ork ci prepare` | A mesma varredura roda antes do commit final da thread, sobre o diff e sobre os nomes de arquivo, e o `ork ci prepare` recusa gerar o bundle com achado | `ork verify` falha com o achado; o bundle não é gerado com termo privado; o caminho com a lista local ausente passa só pelos padrões genéricos e diz isso | F1 |
| F3: Nome genérico por construção | Thread que grava evidência usa nome genérico de máquina; a evidência de rede grava `maquina-a`, `maquina-b`, nunca o hostname, e o mapa entre nome genérico e máquina real fica só na lista local | Teste do gravador de evidência: o JSON e o nome do arquivo não têm o hostname, mesmo quando o ambiente o fornece | F1 |
| F4: Relatório honesto do escape | Quando algo escapou, o relatório do PR diz o que foi corrigido, o que continua no histórico (commits anteriores) e a decisão do dono sobre reescrever ou não | Modelo de texto no guia de PR e teste que confere as três partes (corrigido, no histórico, decisão) | F1 |

Os aceites acima são o que cada fatia terá de provar; não são provas já executadas. A correção do arquivo de evidência da RM-040 é a ação imediata desta thread, anterior às fatias, e não conta como F1.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** a decisão do dono de 12/10/2026 põe o item em desenvolvimento. A posição no [índice de prioridade](README.md#prioridade-para-a-comunidade-de-product-builders) segue com o dono; esta página não inventa uma pontuação.
- **Horizonte / alvo / previsão / confiança / marcos:** marcos F1, F2, F3 e F4, na ordem. Sem data de entrega nesta página.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a F1 não depende de outro item; a F3 toca o gravador de evidência de rede da [RM-053](RM-053-orkastery-network.md), que fica em outra frente, e por isso entra depois do merge dela.
- **Premissas / riscos / mitigação:**

| Risco | Probabilidade / impacto | Mitigação e contingência |
| --- | --- | --- |
| Falso positivo em exemplo de documentação (`/home/usuario`, e-mail de exemplo) | Alta / baixo | Lista de exceções por caminho e por padrão, revisada em PR; começar só avisando e passar a reprovar quando o ruído for zero |
| A lista local não existe no CI | Certa / médio | O CI usa só os padrões genéricos; a lista local roda no `ork verify` e no `ork ci prepare` da máquina do dono e da fábrica |
| O relatório do achado vira um novo vazamento | Média / alto | O relatório mostra arquivo, linha e padrão, nunca o termo; teste confere |
| Histórico continua com o dado | Certa / médio | Dito com honestidade no PR; reescrever histórico público é decisão do dono, caso a caso |

- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - **D1. O achado de dado privado é corrigido por PR, nunca tratado como "já era público".** Decidida pelo dono em 12/10/2026. Alternativas descartadas: deixar como está porque já estava público; reescrever o histórico agora. Como mudar: o dono registra outra escolha. Custo de reverter: baixo, só texto de página e de processo.
  - **D2. Nome genérico de máquina é `maquina-a`, `maquina-b`, e assim por diante.** Decidida na thread `ork-rm062privado`, em #Fast, a partir do exemplo do pedido do dono. O mapa para a máquina real fica fora do git.

### Relação com outros itens

- **[RM-046](RM-046-go-to-open-source.md), GoToOpenSource:** abrir o repositório exige que nada privado esteja nele; esta página é a barreira permanente que a RM-046 pressupõe, além da auditoria feita uma vez.
- **[RM-047](RM-047-fabrica-em-varias-maquinas.md), fronteira de confiança:** a RM-047 trata do que o clone confia; esta trata do que o clone publica. As duas fecham a fronteira nos dois sentidos.
- **[RM-053](RM-053-orkastery-network.md), Orkastery Network:** a rede é quem grava recibos por máquina; a F3 faz esses recibos nascerem com o nome genérico.

### Não-objetivos

- Reescrever o histórico do git.
- Substituir a varredura de segredos.
- Publicar versão ou tag por causa desta página.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-12 | Julio |
| Documentação | Em revisão | — | 2026-10-12 | Julio |
| Código | Branch criada | — | 2026-10-12 | Julio |
| Testes | Não iniciados | — | 2026-10-12 | Julio |
| Deploy | Não implantado | — | 2026-10-12 | Julio |
| Exposição | Flag desligada | — | 2026-10-12 | Julio |
| Habilitação | Pendente | — | 2026-10-12 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery nas fatias; A: Julio; C: —; I: quem contribui com o repositório.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente Claude Code redigiu esta página e fez a correção dos nomes em #Fast, restrito à documentação e aos nomes de arquivo. Revisor humano: Julio.
- **Próxima ação, responsável e prazo:** abrir a F1 (barreira no CI); responsável: fábrica; sem data definida nesta página.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado em Desenvolvimento, com F1 a F4; arquivo de evidência da RM-040 renomeado para nome genérico | Decisão do dono de 12/10/2026 (item 5.a); o nome antigo continua nos commits anteriores | Julio |
