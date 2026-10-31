---
id: RM-078
tipo: roadmap
titulo: Recibo de verify e de revisão válido enquanto HEAD, claims e plano não mudam
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-31T12:00:00-03:00
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

# RM-078: Recibo de verify e de revisão válido enquanto HEAD, claims e plano não mudam

> **Em uma frase:** um GO que não muda HEAD, claims nem plano não invalida o verify nem a revisão; a prova vale pelo que foi provado, não pelo horário do despacho.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem paga um verify inteiro por um GO que só registrou uma decisão, ou por uma falha instável de outro módulo.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Cada GO novo invalidou o recibo do verify, mesmo sem mudar HEAD, claims ou plano; uma falha instável de outro módulo custou um verify inteiro.
  - Na 0.6.2, o verify já é amarrado ao commit: `ship-publicar.ts` aceita verify no HEAD ou num ancestral em que só `.ork-ci/` mudou depois.
  - A revisão ainda é amarrada ao horário do despacho: `noctum-provas.ts` marca a revisão como antiga se algum despacho de autor for posterior ao do CHECK, e conta como autor toda sessão de GO, mesmo sem commit.
  - Um GO sem commit vira `human.pending` em vez de ir à reavaliação do recibo ([RM-075](RM-075-fim-de-fase-lido-pelo-resultado.md)).
- **Objetivo/OKR:** nenhum verify ou CHECK refeito sem mudança no que foi provado.
- **Hipótese:** se o recibo for chaveado por HEAD, impressão digital das claims ativas e plano, então a esteira deixa de refazer prova sem mudança, porque a validade passa a depender do conteúdo, não do relógio.
- **Métrica principal / linha de base / meta / janela / fonte:** verifies e CHECKs refeitos sem mudança de HEAD, claims ou plano. Linha de base: a medir nos ledgers. Meta: zero. Janela: por release. Fonte: `verify_run` e `phase_dispatch` do ledger.
- **Métricas de proteção:** qualquer mudança de HEAD, claim ativa (id ou comando) ou plano invalida o recibo; a falha instável continua registrada ([RM-037](RM-037-verify-rapido-e-confiavel.md)).

## Escopo e validação

- **Incluído:**
  - chave do recibo = HEAD, hash das claims ativas (id e comandos de `verificar`) e sha256 do plano;
  - contar como autor só a sessão com commit confirmado;
  - dispensar a comparação por horário de despacho quando a equivalência da cadeia de commits já vale;
  - GO concluído sem commit, com HEAD igual, vai direto à reavaliação do recibo.
- **Fora de escopo:** reaproveitar verify entre commits diferentes; isso é da [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md) (M1) e da [RM-072](RM-072-check-cinco-vezes-mais-rapido.md).
- **Entregáveis e critérios de aceite:**
  - GO sem commit depois de um verify verde não exige novo verify;
  - mudar uma claim ativa ou o plano invalida o recibo;
  - um mutante por componente da chave morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads `#Auto` com GO de decisão.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 4ª da fila de achados de condução em rede (31/10/2026). Alta: é o maior custo de fluidez por evento.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-075](RM-075-fim-de-fase-lido-pelo-resultado.md) para o "GO sem mudança".
- **Premissas / riscos / mitigação:** comando de claim que depende de algo fora do HEAD (rede, relógio); mitigação: claims com dependência externa declarada continuam pedindo reexecução.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Só HEAD: simples, mas ignora mudança de claim.
  2. HEAD, claims e plano (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-31 | Julio |
| Documentação | Rascunho | — | 2026-10-31 | Julio |
| Código | Não iniciado | — | 2026-10-31 | Julio |
| Testes | Não iniciados | — | 2026-10-31 | Julio |
| Deploy | Não implantado | — | 2026-10-31 | Julio |
| Exposição | Flag desligada | — | 2026-10-31 | Julio |
| Habilitação | Pendente | — | 2026-10-31 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
