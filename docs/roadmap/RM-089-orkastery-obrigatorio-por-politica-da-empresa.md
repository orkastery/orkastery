---
id: RM-089
tipo: roadmap
titulo: Orkastery obrigatório por política da empresa, com telemetria de SDLC agêntico
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-10T21:52:44-03:00
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

# RM-089 — Orkastery obrigatório por política da empresa, com telemetria de SDLC agêntico

> **Em uma frase:** a empresa aplica uma política verificável na forja e reúne telemetria OpenTelemetry das redes inscritas para governar o SDLC agêntico sem impor ferramenta de desenvolvimento nem backend.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e pedidos do dono

Pedido feito pelo dono no terminal em 10/11/2026:

> "O que podemos criar no orkastery pra que empresas que querem tornar o uso do orkastery obrigatório tenham essa possibilidade de ativar essa trava? Nesse caso, travaríamos no próprio terminal/CLI do run time orquestrador ou travaríamos no Git? &#91;...&#93; como poderíamos criar travas/mecanismos que façam o uso do orkastery obrigatório quando essa for a diretriz da empresa?"

A condução propôs como base, e o dono aceitou, que a trava vinculante fique no Git e na forja e que o terminal seja o caminho fácil. Uma trava apenas local é contornável pelo uso direto do runtime ou pela remoção de um hook; o check obrigatório da forja alcança toda mudança destinada à branch protegida, inclusive a produzida na IDE com um copiloto.

O dono ampliou o pedido antes da abertura:

> "adicione na proposta a possibilidade de que um product builder ative telemetria da sua orkastery network, fazendo com que toda sua atividade de desenvolvimento, prompts, commits, threads e fases produzam logs no padrão open telemetry para um servidor de telemetria da empresa.
>
> E uma empresa que opte por ativar as travas no Git também possa acumular telemetria de SDLC ou Agentic SDLC de vários product builders num servidor opentelemetry central, acumulando dados que possam ajudar a entender a maturidade dos product builders da empresa. &#91;...&#93;
>
> Pra isso a empresa precisa poder criar uma Orkastery Network que sincroniza as orkastery networks de todos os builders. Faça a RM-089 abranger essa importante melhoria e despache essa melhoria para Discovery e Planejamento/Documentação imediatamente."

## Problema e resultado

- **Público e problema/oportunidade:** uma empresa que adota o Orkastery como política não tem hoje uma garantia na forja de que toda mudança passou por thread, claims, verify e CHECK, nem uma visão correlacionada e consentânea com sua política de privacidade sobre o SDLC agêntico de seus maestros. A exigência local não basta, e a telemetria nativa dos runtimes não conhece sozinha a thread, a fase e as decisões do Orkastery.
- **Evidências e fonte:** [`core/src/ci.ts`](../../core/src/ci.ts) exige bundle ausente com `ci.bundle.ausente` quando o nome da branch começa por `ork/`; uma `feature/x` sem recibo ainda pode executar somente os comandos do manifesto. O job [`ork-verify`](../../.github/workflows/ci.yml) e o [template para GitLab](../../templates/ork-verify/template.yml) já chamam `ci run`, mas a política empresarial, o recibo para qualquer branch e a telemetria correlacionada ainda não existem.
- **Objetivo/OKR:** permitir que a empresa observe, avise ou exija o recibo do Orkastery na fronteira da forja e, quando habilitado, receba por OTLP evidências correlacionadas de entrega, qualidade e decisões de cada rede inscrita.
- **Hipótese:** se a regra vinculante morar no check obrigatório da organização, se branches externas puderem ser adotadas sem trocar a ferramenta do maestro e se os eventos nativos forem correlacionados ao ledger, então a empresa consegue aplicar a diretriz e analisar maturidade com rastreabilidade, sem depender de hooks locais nem duplicar telemetria.
- **Métrica principal / linha de base / meta / janela / fonte:** cobertura de merges com recibo válido, calculada como merges na branch protegida com recibo válido dividido pelos merges incluídos na política. A linha de base será levantada no piloto a partir dos checks da forja e dos recibos. Meta e janela: **A definir pelo dono**. Nenhuma meta numérica é proposta nesta Discovery.
- **Métricas de proteção:** vazamento de segredo ou dado privado na exportação; eventos duplicados entre runtime e Orkastery; exceções sem justificativa; bloqueios fora do escopo da política; alteração ou exportação de credenciais locais.

### Relações com o roadmap

- A [RM-053](RM-053-orkastery-network.md) continua sendo a rede pessoal do maestro e mantém credenciais locais; a RM-089 adiciona sua inscrição e sincronização seletiva com uma rede da empresa.
- A [RM-026](RM-026-workspace-empresarial.md) é a referência para o workspace e a rede de equipe que a RM-053 deixou fora do próprio escopo; a RM-089 especifica a política, a inscrição e a telemetria dessa rede empresarial, sem reescrever a RM-026.
- A [RM-047](RM-047-fabrica-em-varias-maquinas.md) fornece o contexto da fábrica distribuída; a RM-089 precisa preservar identidade, revogação e recibos verificáveis entre máquinas.
- A [RM-065](RM-065-gitlab-com-paridade-ao-github.md) exige que política, check e recibo tenham comportamento equivalente nas forjas GitHub e GitLab, respeitando as capacidades oficiais de cada uma.
- A [RM-048](RM-048-hitl-humano-no-centro.md) fornece perguntas e decisões HITL que entram na telemetria e no placar de decisões, sem transferir decisão humana para a empresa ou para o coletor.

## Escopo e validação

- **Incluído:**
  - política da empresa por repositório ou time com níveis `observar`, `avisar` e `exigir`;
  - recibo de thread exigível para PR vindo de qualquer nome de branch;
  - adoção de trabalho externo, orientação no adapter e exceção auditável;
  - exportação OpenTelemetry da rede pessoal do maestro, desligada por padrão;
  - rede da empresa que sincroniza dados autorizados das redes inscritas;
  - coletor central compatível com OTLP e analytics de maturidade com origem declarada;
  - recibo forte assinado pela fábrica da empresa e CHECK independente.
- **Fora de escopo:** escolher ou hospedar um backend obrigatório; fornecer interpretação jurídica da LGPD; guardar credencial da rede pessoal na rede da empresa; definir meta numérica de produtividade; ranquear pessoas sem decisão do dono; construir código, teste ou workflow nesta thread de documentação; reescrever as páginas relacionadas.
- **Entregáveis e critérios de aceite:** cada fatia abaixo tem uma prova observável; a documentação oficial sustenta as capacidades externas e tudo que ela não sustenta fica marcado como **não confirmado**.
- **Piloto, medição e critérios de expansão/interrupção:** **A definir pelo dono**. O piloto deverá começar em `observar`, provar correlação e redação de dados e somente avançar após as decisões D1–D5. Interromper a expansão diante de segredo exportado, evento duplicado, recibo aceito para SHA diferente ou exceção sem rastro.

### Política empresarial e recibos

A política é versionada por repositório ou time e tem três níveis:

| Nível | Efeito no PR | Resultado verificável |
| --- | --- | --- |
| `observar` | Mede e publica o resultado sem bloquear | O relatório mostra presença, validade ou ausência do recibo |
| `avisar` | Comenta o que falta no PR sem reprovar o check | O comentário aponta a ação `ork thread new` ou `ork adotar` |
| `exigir` | Reprova o check quando o recibo obrigatório está ausente ou inválido | A regra da organização impede o merge na branch protegida |

O arquivo de política tem dono definido por `CODEOWNERS`. A regra que torna o status check obrigatório pertence à organização na forja, fora da alteração comum do PR. O [GitHub documenta rulesets com status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) e [aprovação por responsáveis no `CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners). O GitLab documenta [branches protegidas](https://docs.gitlab.com/user/project/repository/branches/protected/), [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/) e [external status checks capazes de bloquear o merge](https://docs.gitlab.com/user/project/merge_requests/status_checks/). O mecanismo administrativo exato e os tiers necessários para cada instalação GitLab serão validados na fatia de paridade; fora dessas fontes, ficam **não confirmados**.

No nível `exigir`, o nome da branch de origem não concede exceção. Todo PR destinado à branch protegida precisa de um recibo de thread:

- **Recibo básico:** referencia HEAD, thread, claims e rodada; o CI confere o SHA e executa novamente as claims e o verify da thread.
- **Recibo forte:** é assinado pela fábrica da empresa com chave mantida no cofre dela, nunca na máquina do maestro. Contém HEAD, thread, tag, veredito e um CHECK independente produzido por conta nativa diferente da conta construtora. O CI confere assinatura, emissor e SHA antes de aceitar.

`ork adotar <branch>` incorpora em uma thread a branch criada fora da fábrica, na IDE ou com o runtime direto, preserva os commits, roda verify e CHECK independente e gera o recibo. O maestro continua usando sua ferramenta; a forja exige a evidência, não a interface de edição.

O `ork adapter install` detecta uma sessão fora de thread, avisa e oferece `ork thread new` ou `ork adotar`. Em máquinas gerenciadas, o Claude Code permite [configurações gerenciadas com precedência administrativa](https://code.claude.com/docs/en/managed-settings), inclusive para parâmetros de telemetria. O Codex documenta [requisitos administrativos em `requirements.toml`](https://developers.openai.com/codex/config-reference), mas equivalência completa à imposição central descrita para o Claude Code é **não confirmada**; para os demais runtimes, a imposição central é **não confirmada**.

Um hotfix urgente pode usar uma exceção auditável autorizada pela política. A justificativa, o alcance, o responsável e o recibo dispensado entram no ledger; o responsável pela política recebe aviso; o relatório de conformidade mostra a exceção. Quem autoriza, o prazo e a revisão posterior são **não confirmados** até decisão de governança da empresa.

### Telemetria OpenTelemetry da rede do maestro

A exportação fica desligada por padrão. Quando o maestro ou a política autorizada a liga, a rede pessoal envia sinais por [OTLP](https://opentelemetry.io/docs/specs/otlp/) ao [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) indicado pela empresa. O desenho é neutro quanto ao fornecedor: qualquer backend que receba OTLP pode ser usado, e o Orkastery não impõe backend próprio.

O fluxo inclui threads, fases, despachos, prompts, commits, verify, CHECK, decisões, perguntas HITL, exceções e merges. O modelo reutiliza as convenções semânticas oficiais de [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [VCS](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/) e [CI/CD](https://opentelemetry.io/docs/specs/semconv/cicd/) quando houver campo correspondente. Atributos próprios só cobrem conceitos sem equivalência publicada:

- `orkastery.thread.id`, `orkastery.phase.name`, `orkastery.dispatch.id` e `orkastery.mode`;
- `orkastery.decision.id`, `orkastery.claim.id` e `orkastery.ledger.sequence`;
- `orkastery.verify.round_id`, `orkastery.check.mode` e `orkastery.receipt.id`;
- `orkastery.exception.id`, `orkastery.network.id` e `orkastery.maestro.id`.

Esses nomes são proposta inicial e serão revistos contra a versão estável das convenções na construção. Modelo, runtime, repositório, commit, pipeline e operação GenAI não ganham duplicata `orkastery.*` quando já tiverem atributo semântico oficial.

Segredo nunca sai da máquina. Todo dado privado passa pela política `dado_privado` antes da exportação. A política deve permitir bloquear, redigir ou resumir o conteúdo antes do exporter. Se o texto do prompt sai ou não é a decisão D2; enquanto ela estiver aberta, o contrato não presume autorização para texto completo.

#### O que os runtimes já exportam

| Runtime | Capacidade oficial | Integração proposta sem duplicação |
| --- | --- | --- |
| Claude Code | A [documentação de monitoramento](https://code.claude.com/docs/en/monitoring-usage) descreve métricas, eventos e traces opcionais por OpenTelemetry; prompts ficam redigidos por padrão e a exportação de conteúdo é opt-in | O adapter associa o identificador nativo da sessão a thread, fase e despacho e injeta atributos de recurso autorizados; o Orkastery não reemite prompt, resposta nem resultado de ferramenta já emitido pelo runtime |
| Codex | A [configuração avançada](https://developers.openai.com/codex/config-advanced) descreve OpenTelemetry opt-in para logs, métricas e traces; o texto do prompt não é exportado por padrão | A associação registrada pelo adapter liga conversa/sessão à thread e à fase; `otel.span_attributes` pode levar atributos estáticos documentados, enquanto a ligação dinâmica fica em um evento de correlação, sem copiar o conteúdo nativo |

Cada sessão nativa produz um único vínculo de correlação com `thread`, `phase`, `dispatch` e identidade pseudonimizada do maestro. O collector combina esse vínculo com os sinais do runtime e com o ledger. A ausência de identificador correlacionável em algum runtime será registrada como **não confirmada**, não suprida por inferência de horário ou conteúdo.

### Orkastery Network da empresa

A empresa cria uma rede própria e cada maestro inscreve sua Orkastery Network pessoal segundo a decisão D3. O contrato cobre:

- **Inscrição:** convite ou política apresenta rede, escopo de dados, destino OTLP, retenção declarada e versão da política; a adesão gera identidade revogável da inscrição.
- **Identidade do maestro:** um identificador pseudonimizado e estável na rede da empresa liga recibos e telemetria sem exportar credencial pessoal. A vinculação com identidade corporativa e seus responsáveis é **não confirmada** até o desenho de acesso e LGPD.
- **O que sincroniza:** somente os conjuntos escolhidos na D4, com schema e versão explícitos.
- **Direção:** telemetria e recibos fluem da rede pessoal para a rede da empresa; política, schema, revogação e confirmação de recebimento fluem da empresa para a rede pessoal. Escrita da empresa no ledger pessoal é **não confirmada** e não faz parte desta proposta.
- **Revogação e saída:** a empresa pode revogar a inscrição, e o maestro pode sair quando a política permitir; novos envios cessam, credenciais locais são preservadas e o destino dos dados já recebidos segue a política declarada. Retenção, exclusão e portabilidade permanecem **não confirmadas** até revisão jurídica e decisão do dono.
- **Credenciais:** continuam locais, como na RM-053; a rede empresarial recebe recibos e sinais autorizados, nunca tokens dos runtimes ou da forja.

### Coletor central e analytics de maturidade

A empresa que ativa a política pode reunir os sinais das redes inscritas em um collector OTLP central. Cada indicador mostra fórmula, população, janela escolhida no painel e origem. Não há meta numérica nesta proposta.

| Indicador | Definição | Fonte verificável |
| --- | --- | --- |
| Cobertura de merges com recibo | Merges incluídos na política com recibo válido dividido por todos os merges incluídos | Check da forja, recibo e evento de merge |
| Verdade sustentada na primeira tentativa | Threads cujo primeiro veredito terminal verde permaneceu válido até o merge dividido pelas threads mescladas | Rodadas de verify, HEAD do recibo e merge |
| Retrabalho apontado pelo CHECK | Contagem de achados e ciclos GO-FIX por thread e parcela de merges com retrabalho | Parecer do CHECK, transições de fase e ledger |
| Decisões, perguntas e reversões | Contagens separadas de decisões autônomas, perguntas HITL e decisões depois revertidas; nenhuma soma vira nota sem D5 | Eventos de decisão e HITL no ledger |
| Exceções | Contagem e parcela de merges com exceção, agrupadas por motivo e política | Ledger, recibo e relatório da forja |
| Uso dos modos | Distribuição de threads e merges por `#Classic`, `#Maestro`, `#Auto` e `#Fast` | Estado da thread, ledger e recibo |

As [métricas DORA](https://dora.dev/guides/dora-metrics/) que cabem no mesmo conjunto são:

- frequência de deploy: eventos de deploy bem-sucedido na janela escolhida;
- lead time de mudança: intervalo entre o commit que entrou na entrega e o deploy correspondente;
- taxa de falha de mudança: deploys que causaram degradação e exigiram remediação divididos pelos deploys;
- tempo de recuperação de deploy falho: intervalo entre a falha observada e a recuperação do serviço;
- taxa de retrabalho de deploy: deploys não planejados de correção divididos pelos deploys.

O ledger sozinho não prova deploy, falha de produção ou recuperação. Esses indicadores só aparecem quando a empresa fornece eventos correlacionáveis de CI/CD e incidente; sem eles, o resultado é **não confirmado**, nunca estimado. Métricas de processo agêntico complementam DORA e não são tratadas como produtividade individual sem a decisão D5.

## Fatias e critérios de aceite

A ordem abaixo preserva a sugestão do pedido: estabelece a fronteira verificável, cria o caminho de regularização, reduz atrito, adiciona governança e então amplia telemetria e garantias. A ordem pode mudar por decisão do dono antes da construção.

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Política e `exigir` no `ork ci run`, com GitHub e GitLab | Um PR de branch `ork/*` e outro de `feature/*` produzem o mesmo resultado para cada nível; em `exigir`, ausência, SHA divergente ou recibo inválido reprova o check obrigatório nas duas forjas |
| F2 | `ork adotar <branch>` | Uma branch criada fora da fábrica entra em thread sem perder commits, passa por verify e CHECK independente e recebe recibo ligado ao HEAD |
| F3 | Aviso no terminal pelo adapter | Uma sessão fora de thread recebe aviso e escolhas `thread new` e `adotar`; uma sessão já vinculada não recebe aviso duplicado |
| F4 | Exceção auditável | Um hotfix autorizado registra justificativa e responsável no ledger, avisa o responsável pela política e aparece no relatório; uma exceção sem autorização não libera o merge |
| F5 | Exportação OpenTelemetry do maestro | Com a flag desligada não há exportação; ligada, envia OTLP correlacionado, aplica `dado_privado`, não duplica eventos nativos e passa por um Collector compatível |
| F6 | Orkastery Network da empresa | Inscrição, identidade, sincronização escolhida, revogação e saída funcionam sem transferir credenciais da rede pessoal |
| F7 | Coletor central e analytics de maturidade | Dados de redes inscritas geram cada indicador com fórmula, população e link para ledger ou telemetria; indicador sem fonte aparece como não confirmado |
| F8 | Recibo assinado pela fábrica da empresa | O CI aceita assinatura da fábrica para o mesmo SHA e rejeita chave, emissor ou SHA divergente; o recibo contém veredito e CHECK de conta diferente da construtora |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Discovery e documentação despachadas em 10/11/2026 a pedido do dono; prioridade de construção a definir pelo dono.
- **Horizonte / alvo / previsão / confiança / marcos:** meta e piloto: **A definir pelo dono**. Marcos propostos são F1 a F8; não há previsão de implantação nesta Discovery.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-053, RM-026, RM-047, RM-065 e RM-048; decisões D1–D5 pelo dono; revisão jurídica e de segurança antes do piloto; owner: Julio; próxima revisão no planejamento da primeira fatia.
- **Premissas / riscos / mitigação:** detalhados abaixo; capacidades não cobertas pelas fontes oficiais permanecem não confirmadas.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1–D5 estão abertas para o dono. A condução não escolheu nenhuma alternativa.

### Decisões abertas do dono

Em todas as alternativas de D1, o maestro vê o schema, o destino, a política vigente e exatamente quais campos sua rede envia. A [Lei nº 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf) é a fonte legal citada; base legal, papéis, retenção, direitos e obrigações aplicáveis a este desenho são **não confirmados** nesta Discovery e exigem avaliação da empresa. A recomendação abaixo é de produto, não interpretação jurídica.

#### D1 — Visibilidade da analytics por maestro

- **A.** Só o maestro vê seu dado individual; a empresa vê agregados por time. **Recomendada**, por reduzir exposição individual enquanto preserva transparência ao titular do fluxo.
- **B.** O maestro e pessoas autorizadas da empresa veem o dado individual, com finalidade e acesso auditados.
- **C.** Ninguém vê analytics individual; maestro e empresa veem somente agregados por time, embora o maestro continue vendo o payload que envia.

#### D2 — Conteúdo dos prompts na telemetria

- **A.** Metadados por padrão — tamanho, hash, fase, runtime e modelo — e texto completo somente por opção da empresa, depois de redação e `dado_privado`. **Recomendada**, por acompanhar os padrões opt-in documentados pelos runtimes.
- **B.** Texto completo sempre que a telemetria estiver ligada, com redação obrigatória antes da exportação.
- **C.** Nunca exportar texto; somente metadados e correlação.

#### D3 — Quem liga a telemetria na rede da empresa

- **A.** O maestro liga e desliga na rede pessoal.
- **B.** A política da empresa define a ativação no ato da inscrição, com apresentação prévia do payload e destino. **Recomendada**, por manter uma regra explícita e separada da trava de merge.
- **C.** A ativação ocorre automaticamente quando a política do repositório usa `exigir`.

#### D4 — O que a Orkastery Network da empresa sincroniza

- **A.** Telemetria e recibos apenas. **Recomendada**, por entregar governança e analytics com menor superfície de dados.
- **B.** Telemetria, recibos, retratos e roadmap.
- **C.** Tudo da alternativa B e a memória do OrkMind autorizada pela política.

#### D5 — Base do modelo de maturidade

- **A.** DORA para entrega, acrescido dos indicadores agênticos desta página, exibidos separadamente e sem nota composta. **Recomendada**, por preservar fórmulas rastreáveis e evitar peso arbitrário.
- **B.** Índice composto próprio do Orkastery, com pesos definidos pela empresa e trilha de cada componente.
- **C.** Estágios qualitativos de maturidade, avaliados por critérios observáveis, sem ranking entre maestros.

### Premissas e riscos

- **Privacidade e monitoramento de pessoas sob a LGPD:** analytics individual pode afetar pessoas e relações de trabalho. Mitigação: transparência do payload, acesso mínimo, trilha de consulta, D1 explícita e avaliação da empresa à luz da [Lei nº 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf). Interpretação jurídica e adequação de cada uso são **não confirmadas**.
- **Vazamento de segredo ou dado de cliente:** prompts, resultados de ferramenta e atributos podem carregar conteúdo sensível. Mitigação: exportação desligada, bloqueio de segredo, `dado_privado` antes do exporter, redação, allowlist de atributos e testes com marcadores sintéticos.
- **Resistência dos desenvolvedores à trava:** bloqueio abrupto pode deslocar trabalho para fora do fluxo. Mitigação: adoção gradual por `observar` e `avisar`, orientação do adapter e `ork adotar` para preservar a ferramenta existente.
- **Contorno pela forja:** um PR pode tentar alterar política ou check. Mitigação: regra da organização, status check obrigatório e `CODEOWNERS` fora da aprovação do autor; detalhes de administração dependentes do plano da forja ficam **não confirmados** até o piloto.
- **Custo e volume da telemetria:** prompts e eventos de alta cardinalidade podem aumentar armazenamento e processamento. Mitigação: amostragem, filtros, limites por tipo, retenção declarada e métricas de volume antes de habilitar conteúdo; nenhum custo é estimado nesta Discovery.

## Fontes oficiais

- OpenTelemetry: [OTLP](https://opentelemetry.io/docs/specs/otlp/), [Collector](https://opentelemetry.io/docs/collector/), [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [VCS](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/) e [CI/CD](https://opentelemetry.io/docs/specs/semconv/cicd/).
- Runtimes: [monitoramento OpenTelemetry do Claude Code](https://code.claude.com/docs/en/monitoring-usage), [configurações gerenciadas do Claude Code](https://code.claude.com/docs/en/managed-settings), [OpenTelemetry no Codex](https://developers.openai.com/codex/config-advanced) e [referência de configuração do Codex](https://developers.openai.com/codex/config-reference).
- GitHub: [rulesets e status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) e [`CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
- GitLab: [branches protegidas](https://docs.gitlab.com/user/project/repository/branches/protected/), [external status checks](https://docs.gitlab.com/user/project/merge_requests/status_checks/) e [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/).
- Métricas de entrega: [DORA metrics](https://dora.dev/guides/dora-metrics/).
- Privacidade: [Lei nº 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf).

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

- **RACI (R / A / C / I):** R: equipe Orkastery; A: Julio; C: segurança, privacidade, administradores das forjas e maestros do piloto; I: times inscritos na rede da empresa.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO consolidou o rascunho e as fontes em modo `#Fast`; D1–D5, prioridade e piloto permanecem para o dono; revisão humana ocorrerá na condução e no planejamento da construção.
- **Próxima ação, responsável e prazo:** dono decide D1–D5 e a prioridade de construção; prazo a definir pelo dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-10 | RM-089 aberta em Discovery; documentação despachada; código, testes e implantação não iniciados | Pedidos do dono no terminal e fontes oficiais listadas nesta página | Dono definiu o problema; sessão GO organizou a proposta sem decidir D1–D5 |
