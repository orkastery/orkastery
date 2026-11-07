---
id: RM-078
tipo: roadmap
titulo: Recibo de verify e de revisão válido enquanto HEAD, claims e plano não mudam
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-06T12:00:00-03:00
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
    commit: b771cfa
    pr: null
sdlc:
  thread: ork-rm078recibod
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-078: Recibo de verify e de revisão válido enquanto HEAD, claims e plano não mudam

> **Em uma frase:** um GO que não muda HEAD, claims nem plano preserva o verify e a revisão, salvo quando uma claim declara dependência externa de rede ou relógio; a prova vale pelo conteúdo e pela cadeia de commits.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem paga um verify inteiro por um GO que só registrou uma decisão, ou por uma falha instável de outro módulo.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Cada GO novo invalidou o recibo do verify, mesmo sem mudar HEAD, claims ou plano; uma falha instável de outro módulo custou um verify inteiro.
  - Na 0.6.2, o verify já é amarrado ao commit: `ship-publicar.ts` aceita verify no HEAD ou num ancestral em que só `.ork-ci/` mudou depois.
  - Antes desta entrega, a revisão era amarrada ao horário do despacho: `noctum-provas.ts` marcava a revisão como antiga por um despacho posterior ao CHECK e contava como autora uma sessão sem commit.
  - Antes da [RM-075](RM-075-fim-de-fase-lido-pelo-resultado.md), um GO sem commit virava `human.pending` em vez de ir à reavaliação do recibo.
- **Objetivo/OKR:** nenhum verify ou CHECK refeito sem mudança no que foi provado.
- **Hipótese:** se o recibo for chaveado por HEAD, impressão digital das claims ativas e plano, então a esteira deixa de refazer prova sem mudança, porque a validade passa a depender do conteúdo, não do relógio.
- **Métrica principal / linha de base / meta / janela / fonte:** verifies e CHECKs refeitos sem mudança de HEAD, claims ou plano. Linha de base: a medir nos ledgers. Meta: zero. Janela: por release. Fonte: `verify_run` e `phase_dispatch` do ledger.
- **Métricas de proteção:** qualquer mudança de HEAD, claim ativa (id ou comando) ou plano invalida o recibo; a falha instável continua registrada ([RM-037](RM-037-verify-rapido-e-confiavel.md)).

## Escopo e validação

- **Incluído:**
  - chave do recibo = HEAD, hash das claims ativas (id e comandos de `verificar`) e sha256 do plano;
  - contar como autor só a sessão com commit confirmado;
  - dispensar a comparação por horário de despacho quando a equivalência da cadeia de commits já vale;
  - GO concluído sem commit, com HEAD igual, vai direto à reavaliação do recibo;
  - claim com dependência externa declarada de rede ou relógio exige novo verify depois dessa reavaliação, mesmo com a chave igual.
- **Fora de escopo:** reaproveitar verify entre commits diferentes; isso é da [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md) (M1) e da [RM-072](RM-072-check-cinco-vezes-mais-rapido.md).
- **Entregáveis e critérios de aceite:**
  - GO sem commit depois de um verify verde não exige novo verify;
  - mudar uma claim ativa ou o plano invalida o recibo;
  - claim com dependência externa declarada exige novo verify depois de GO sem mudança;
  - só sessão com commit confirmado na cadeia entra como autora;
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

A thread `ork-rm078recibod` implementa a chave canônica em `core/src/recibo-prova.ts`, grava o recibo no
`verify_run` e o reavalia em `core/src/noctum-provas.ts`. Os casos focados estão em
`core/test/rm078-recibo.test.ts`; os mutantes de HEAD, claims e plano estão em
`core/test/mutantes/rm078.json`.

O commit `6c3ea33f` tentou estabilizar o HEAD artificial dos cenários de idioma ao fixar a data do commit
da fixture, mas não bastou: `git commit --amend` ignora `GIT_AUTHOR_DATE` e mantém a data de autor
original. A correção efetiva está em `f51f33a5`, que passa `--date=`, confere as datas de autor e de
committer e prova o mesmo HEAD com o teste focado e o mutante, e em `dd570a0e`, que alinha o formato UTC
e é o commit do verify verde.

Em separado, `b771cfa0` alinha o mutante M15 à autoria por commit confirmado na cadeia.

O verify oficial no commit `1145660b` caiu uma vez no caso de idioma e passou quando repetido no mesmo
HEAD do produto; a comparação continua incluindo a asserção do `recibo.sha256`. O recibo terminal verde
posterior a estes commits e à narrativa é a evidência que fecha este GO; CHECK independente e SHIP
continuam com a condução.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-06 | Julio |
| Documentação | Em revisão | — | 2026-11-06 | Julio |
| Código | Branch criada | commit `b771cfa` | 2026-11-06 | Julio |
| Testes | Em execução | — | 2026-11-06 | Julio |
| Deploy | Não implantado | — | 2026-11-06 | Julio |
| Exposição | Flag desligada | — | 2026-11-06 | Julio |
| Habilitação | Pendente | — | 2026-11-06 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
| 2026-11-06 | Implementação e testes focados em andamento | Thread `ork-rm078recibod`, commits atômicos até `f9685ef` | Codex, modo `#Auto` |
| 2026-11-06 | GO-FIX corrige o F2b e, em separado, atualiza M15 para autoria por commit confirmado na cadeia | Tentativa insuficiente em `6c3ea33f`; correção do F2b em `f51f33a5`, com `--date=`, conferência das datas, teste focado e mutante, e em `dd570a0e`, com formato UTC e verify verde; correção do M15 em `b771cfa0` | Codex, modo `#Auto` |
