---
id: RM-090
tipo: roadmap
titulo: Telemetria compatível com OpenTelemetry e Grafana para SDLC Analytics
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-10T22:47:15-03:00
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

# RM-090 — Telemetria compatível com OpenTelemetry e Grafana para SDLC Analytics

> **Em uma frase:** todos os prompts e os dados de condução das threads e fases do ork viram logs no padrão OpenTelemetry, legíveis no Grafana, para a SDLC Analytics do builder e da empresa.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e pedidos do dono

O dono ampliou a proposta original no terminal em 10/11/2026:

> "adicione na proposta a possibilidade de que um product builder ative telemetria da sua orkastery network, fazendo com que toda sua atividade de desenvolvimento, prompts, commits, threads e fases produzam logs no padrão open telemetry para um servidor de telemetria da empresa.
>
> E uma empresa que opte por ativar as travas no Git também possa acumular telemetria de SDLC ou Agentic SDLC de vários product builders num servidor opentelemetry central, acumulando dados que possam ajudar a entender a maturidade dos product builders da empresa."

Na segunda rodada, o dono separou esta evolução da rede coletiva:

> "Precisa ficar claro, estamos criando duas coisas diferentes, a primeira é o orkastery network coletivo, para empresas, que agrega os roadmaps organizados por projeto e garante que um builder não esteja criando o que outro já está criando, e ajuda nos merges na Main. a segunda grande evolução aqui é a telemetria compatível com otel (open telemetry e grafana), onde todos os prompts e dados de condução das threads/fases ork viram logs pra SDLC Analytics."

Esta página registra a segunda evolução. A rede coletiva e a trava empresarial estão na [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md).

## Problema e resultado

- **Público e problema/oportunidade:** o builder e a empresa não têm hoje logs OpenTelemetry correlacionados que reúnam prompts, threads, fases, decisões, HITL, verify, CHECK, commits e merges. A telemetria nativa dos runtimes não conhece sozinha o ledger, a fase e as decisões do Orkastery.
- **Evidências e fonte:** Claude Code e Codex já documentam exportação OpenTelemetry opt-in, mas com contratos próprios. O ledger do ork contém o rastro da condução, sem um exporter OTLP nem painéis de referência para Grafana.
- **Objetivo/OKR:** transformar os prompts e os dados de condução em logs OTLP correlacionados, removidos de segredo e dado privado antes de sair da máquina, para leitura no servidor escolhido pelo builder ou no coletor central da empresa.
- **Hipótese:** se o ledger e os prompts produzirem logs OpenTelemetry, e se os eventos nativos dos runtimes forem correlacionados em vez de copiados, então builder e empresa conseguem analisar a condução com origem declarada e backend substituível.
- **Métrica principal / linha de base / meta / janela / fonte:** eventos de condução com log correlacionado e consultável por thread, fase e maestro. Linha de base, meta e janela: **A definir pelo dono**. Nenhuma meta numérica é proposta nesta Discovery.
- **Métricas de proteção:** segredo ou dado privado exportado; prompt duplicado entre runtime e ork; log sem thread ou fase quando o vínculo existe; acesso individual sem transparência; volume sem origem ou política de retenção.

### Relação com a RM-089

A RM-090 funciona sem a RM-089: o builder liga a telemetria e aponta a própria rede para o servidor OTLP dele. Quando a empresa usa a [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md), a política da inscrição distribui o endereço do coletor central, liga a telemetria e avisa o maestro. Os logs seguem diretamente da máquina ao coletor; eles não passam pela rede coletiva.

## Escopo e validação

- **Incluído:** logs OpenTelemetry de condução; texto completo dos prompts depois da remoção; correlação com Claude Code e Codex; configuração de coletor de referência; painéis de referência para Grafana; coletor central; SDLC Analytics por maestro e por time; visibilidade e ativação conforme D1 a D3.
- **Fora de escopo:** impor ou hospedar um backend; escolher uma distribuição obrigatória do Collector; rede coletiva, prevenção de duplicidade, ajuda nos merges e trava no Git, que ficam na RM-089; memória do OrkMind; interpretação jurídica da LGPD; meta numérica de produtividade; construção de código, teste ou workflow nesta thread de documentação.
- **Entregáveis e critérios de aceite:** cada fatia abaixo tem uma prova observável; as configurações e painéis são referências portáveis, e qualquer backend que receba OTLP continua válido.
- **Piloto, medição e critérios de expansão/interrupção:** **A definir pelo dono**. O piloto prova remoção local, correlação, consulta e transparência antes de reunir builders. A expansão é interrompida diante de segredo exportado, dado privado sem remoção, duplicação de conteúdo, acesso indevido ou volume sem controle.

### Logs como sinal principal

O sinal principal desta página é o log OpenTelemetry. Cada mudança de estado relevante gera um `LogRecord` com horário, corpo estruturado, atributos de recurso e vínculo com thread e fase. O fluxo cobre:

- abertura e encerramento de thread e mudança de fase;
- decisão autônoma ou do dono, pergunta e resposta HITL;
- início e veredito de verify e CHECK;
- commit e merge ligados ao HEAD;
- prompt completo depois da remoção de segredo e de dado privado;
- falha de exportação, remoção aplicada e evento recusado antes de sair da máquina.

Traces entram somente para ligar um log do ork à sessão, à geração ou à ferramenta que o runtime já representa com `trace_id` e `span_id`. Métricas entram somente como agregações derivadas dos logs para volume, saúde do exporter e painéis de maturidade. Nem trace nem métrica substitui o log e o ledger como fonte da condução.

O modelo reutiliza as convenções semânticas oficiais de [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [VCS](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/) e [CI/CD](https://opentelemetry.io/docs/specs/semconv/cicd/) quando houver campo correspondente. Atributos próprios cobrem somente conceitos sem equivalência publicada:

- `orkastery.thread.id`, `orkastery.phase.name`, `orkastery.dispatch.id` e `orkastery.mode`;
- `orkastery.decision.id`, `orkastery.claim.id` e `orkastery.ledger.sequence`;
- `orkastery.verify.round_id`, `orkastery.check.mode` e `orkastery.receipt.id`;
- `orkastery.network.id` e `orkastery.maestro.id`.

Os nomes são proposta inicial e serão revistos contra a versão estável das convenções na construção. Modelo, runtime, repositório, commit, pipeline e operação GenAI não ganham duplicata `orkastery.*` quando já tiverem atributo oficial.

### Prompts e remoção local

Conforme a D2, o texto completo dos prompts entra sempre na telemetria ligada. Antes de deixar a máquina, o pipeline remove segredo e aplica a política `dado_privado`; o log exportado preserva o restante do texto e registra a versão da política de remoção. Credenciais nunca entram na configuração de referência nem no log.

O risco residual é que um segredo novo ou um dado sensível não classificado atravesse os filtros. A mitigação combina detectores de segredo, regras de `dado_privado`, campos permitidos, prévia do que a máquina envia, acesso auditado, retenção declarada e testes com marcadores sintéticos. Quando a remoção não consegue decidir com segurança, o evento é recusado localmente e a falha aparece sem o conteúdo. A adequação jurídica desse processamento é **não confirmada** e precisa de avaliação da empresa.

### Correlação com os runtimes

| Runtime | Capacidade oficial | Integração proposta sem duplicação |
| --- | --- | --- |
| Claude Code | A [documentação de monitoramento](https://code.claude.com/docs/en/monitoring-usage) descreve métricas, eventos e traces opcionais por OpenTelemetry; a exportação de conteúdo tem controles próprios | O adapter associa o identificador nativo da sessão a thread, fase e despacho; o Orkastery não reemite evento que o runtime já enviou e registra somente o vínculo e os eventos do ledger que não têm equivalente |
| Codex | A [configuração avançada](https://developers.openai.com/codex/config-advanced) descreve OpenTelemetry opt-in para logs, métricas e traces e controles próprios para conteúdo | A associação da conversa ou sessão liga o sinal nativo à thread e à fase; atributos estáticos usam a configuração documentada, e a ligação dinâmica fica num evento de correlação sem copiar o evento nativo |

Cada sessão nativa produz um vínculo de correlação com thread, fase, despacho e identidade do maestro. O Collector combina esse vínculo com os sinais do runtime e com os logs derivados do ledger. A ausência de identificador correlacionável em algum runtime aparece como **não confirmada**, nunca é inferida por horário ou por conteúdo.

### Coletor de referência e Grafana

A documentação oficial do Grafana descreve [ingestão OTLP de logs, métricas e traces](https://grafana.com/docs/opentelemetry/ingest/) e [ingestão de logs OTLP no Loki por um OpenTelemetry Collector](https://grafana.com/docs/loki/latest/send-data/otel/). O Grafana também documenta [provisionamento versionável de dashboards](https://grafana.com/docs/grafana/latest/administration/provisioning/).

A entrega inclui uma configuração de Collector de referência, sem endpoint, credencial ou backend fixo, com este contrato:

- receiver OTLP para os logs do ork e para os sinais correlacionáveis dos runtimes;
- processadores de validação, remoção adicional, limites, correlação e lote;
- pipeline principal de logs e, quando presentes, pipelines auxiliares de traces e métricas;
- exporter OTLP configurável para qualquer backend compatível;
- falha fechada para registro sem os atributos obrigatórios ou com conteúdo rejeitado pela política.

A entrega também inclui painéis de referência provisionáveis no Grafana:

- condução por thread e fase, com decisões, HITL, verify, CHECK, commit e merge;
- prompts e remoções, com acesso ao texto conforme a política e sem mostrar conteúdo recusado;
- correlação dos logs do ork com os sinais do runtime;
- maturidade por maestro e por time, com fórmula e fonte de cada indicador;
- saúde e volume da exportação, sem meta numérica embutida.

Grafana é a interface de referência, não um backend obrigatório. Grafana Cloud, uma pilha própria com Loki ou qualquer outro destino que receba OTLP pode cumprir o contrato; diferenças de armazenamento e consulta ficam na configuração do destino.

### Coletor central e SDLC Analytics

Fora de uma empresa, o builder liga a telemetria e escolhe o servidor. Na empresa, todos os builders inscritos enviam ao coletor central conforme D3, e as pessoas autorizadas consultam os dados conforme D1. A SDLC Analytics mede a maturidade de cada maestro e de cada time sem meta numérica.

| Indicador | Definição | Fonte verificável |
| --- | --- | --- |
| Cobertura de merges com recibo | Merges incluídos na política com recibo válido em relação aos merges incluídos | Log do check, recibo e evento de merge |
| Verdade sustentada na primeira tentativa | Threads cujo primeiro veredito terminal verde permaneceu válido até o merge em relação às threads mescladas | Logs de verify, HEAD do recibo e merge |
| Retrabalho apontado pelo CHECK | Achados e ciclos GO-FIX por thread, exibidos sem meta | Parecer do CHECK, transições de fase e ledger |
| Decisões, perguntas e reversões | Contagens separadas de decisões autônomas, HITL e decisões revertidas; nenhuma soma vira nota sem D4 | Logs de decisão e HITL derivados do ledger |
| Exceções | Ocorrências agrupadas por motivo e política | Ledger, recibo e log da forja |
| Uso dos modos | Distribuição das threads e merges por modo | Estado da thread, ledger e recibo |

As [métricas DORA](https://dora.dev/guides/dora-metrics/) só aparecem quando a empresa fornece eventos correlacionáveis de deploy e incidente. O ledger sozinho não prova deploy, falha de produção ou recuperação; sem esses eventos, o resultado fica **não confirmado**, nunca estimado. Os indicadores do processo agêntico complementam DORA e não são tratados como produtividade individual sem a decisão D4.

## Fatias e critérios de aceite

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Logs de condução a partir do ledger | Thread, fase, decisão, HITL, verify, CHECK, commit e merge geram logs OTLP consultáveis com fonte, ordem e correlação; evento sem vínculo obrigatório é recusado ou marcado como lacuna |
| F2 | Prompts com remoção local | O texto completo restante chega ao destino; marcadores de segredo e `dado_privado` não saem da máquina; falha da remoção recusa o evento sem copiar o conteúdo |
| F3 | Correlação com Claude Code e Codex | Uma sessão de cada runtime liga os sinais nativos à thread e à fase; o teste de identidade mostra que o Orkastery não duplica o evento nativo |
| F4 | Coletor e painéis de referência para Grafana | A configuração recebe OTLP, aplica os processadores e exporta para dois destinos compatíveis trocando somente o exporter; os painéis provisionáveis consultam condução, prompts, correlação, maturidade e saúde |
| F5 | SDLC Analytics por maestro e por time | Cada indicador mostra fórmula, população, fonte e lacunas; pessoas autorizadas da empresa veem individual e agregado, e cada maestro vê tudo o que a máquina dele envia |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Discovery e documentação despachadas em 10/11/2026 a pedido do dono; prioridade de construção a definir pelo dono.
- **Horizonte / alvo / previsão / confiança / marcos:** meta e piloto: **A definir pelo dono**. Marcos propostos são F1 a F5; não há previsão de implantação nesta Discovery.
- **Dependências e bloqueios (ID, owner, próxima revisão):** integrações oficiais de OpenTelemetry dos runtimes; RM-089 somente para distribuição empresarial do endereço do coletor; D4 pelo dono; revisão jurídica, de segurança e de retenção antes do piloto; owner: Julio; próxima revisão no planejamento da primeira fatia.
- **Premissas / riscos / mitigação:** detalhados abaixo; capacidades não cobertas pelas fontes oficiais permanecem não confirmadas.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1 e D2 foram decididas pelo dono no terminal em 10/11/2026; D3 foi decidida pela condução a partir da resposta de D1 e pode ser revertida pelo dono; D4 continua aberta ao dono.

### Decisões

#### D1 — Visibilidade

Resposta do dono em 10/11/2026: `"1a (a empresa ve tudo)"`; foi escolhida a alternativa **A**.

- **A. Escolhida.** Pessoas autorizadas da empresa veem o dado individual de cada maestro e o agregado. O maestro é avisado na inscrição e vê tudo o que sai da máquina dele.
- **B.** O maestro vê o próprio dado individual, e a empresa vê somente agregados por time.
- **C.** Maestro e empresa veem somente analytics agregada por time, embora o maestro continue vendo o payload enviado pela máquina.

A [Lei nº 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf) é a fonte legal citada. Base legal, papéis, retenção, direitos e obrigações aplicáveis são **não confirmados** nesta Discovery e exigem avaliação da empresa; esta página não faz interpretação jurídica.

#### D2 — Texto dos prompts

Resposta do dono em 10/11/2026: `"2b"`; foi escolhida a alternativa **B**.

- **A.** Metadados por padrão — tamanho, hash, fase, runtime e modelo — e texto completo somente por opção da empresa, depois da remoção.
- **B. Escolhida.** O texto completo restante vai sempre que a telemetria está ligada, com remoção obrigatória de segredo e de dado privado antes de sair da máquina.
- **C.** Nunca exportar texto; somente metadados e correlação.

O risco residual e a mitigação estão em [Prompts e remoção local](#prompts-e-remoção-local). A decisão autoriza o texto completo depois da remoção; não autoriza segredo, dado privado nem exportação quando a limpeza falha.

#### D3 — Quem liga a telemetria

Decisão da condução em 10/11/2026, derivada da resposta `"a empresa ve tudo"`, reversível pelo dono: fora de uma empresa, o builder liga a telemetria; na empresa, foi escolhida a alternativa **B**.

- **A.** Mesmo na empresa, somente o maestro liga e desliga a telemetria na rede pessoal.
- **B. Escolhida.** A política da empresa liga a telemetria ao inscrever o maestro na rede coletiva, apresenta payload e destino e avisa o maestro; fora da empresa, o builder liga.
- **C.** A política liga somente quando o repositório usa o nível `exigir` da RM-089.

O dono pode reverter D3 sem mudar o schema dos logs: a reversão altera a origem da ativação e a política de inscrição.

#### D4 — Base do modelo de maturidade

- **A. Recomendada.** DORA para entrega, acrescido dos indicadores agênticos desta página, exibidos separadamente e sem nota composta. Preserva fórmulas rastreáveis e evita peso arbitrário.
- **B.** Índice composto próprio do Orkastery, com pesos definidos pela empresa e trilha de cada componente.
- **C.** Estágios qualitativos de maturidade, avaliados por critérios observáveis, sem ranking entre maestros.

D4 continua aberta ao dono.

### Premissas e riscos

- **Privacidade e monitoramento de pessoas sob a LGPD:** a empresa vê analytics individual conforme D1. Mitigação: aviso na inscrição, prévia do payload, acesso mínimo e auditado, finalidade e retenção declaradas e avaliação da empresa à luz da [Lei nº 13.709/2018](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf). A adequação de cada uso é **não confirmada**.
- **Vazamento de segredo ou dado privado:** o texto completo aumenta a superfície de exposição. Mitigação: remoção antes do exporter, recusa local quando a limpeza falha, campos permitidos, detectores em camadas, testes com marcadores sintéticos e revisão da política.
- **Volume e custo:** prompts completos e logs de alta cardinalidade podem aumentar armazenamento e processamento. Mitigação: medição por tipo, limites, lote, retenção declarada, atributos controlados e painéis de saúde; custo e limite adequados são **não confirmados**, e não há meta numérica.
- **Duplicação com runtimes:** o mesmo prompt ou evento pode sair duas vezes. Mitigação: vínculo de correlação, identidade de evento e regra de não reemitir conteúdo nativo.
- **Perda de contexto:** remoção pode tornar o log insuficiente para análise. Mitigação: registrar a regra aplicada e a categoria removida sem o valor; a qualidade aceitável é **não confirmada** até o piloto.

## Fontes oficiais

- OpenTelemetry: [logs](https://opentelemetry.io/docs/concepts/signals/logs/), [OTLP](https://opentelemetry.io/docs/specs/otlp/), [Collector](https://opentelemetry.io/docs/collector/), [GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [VCS](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/) e [CI/CD](https://opentelemetry.io/docs/specs/semconv/cicd/).
- Grafana: [ingestão OTLP](https://grafana.com/docs/opentelemetry/ingest/), [logs OTLP no Loki por Collector](https://grafana.com/docs/loki/latest/send-data/otel/) e [provisionamento de dashboards](https://grafana.com/docs/grafana/latest/administration/provisioning/).
- Runtimes: [monitoramento OpenTelemetry do Claude Code](https://code.claude.com/docs/en/monitoring-usage), [OpenTelemetry no Codex](https://developers.openai.com/codex/config-advanced) e [referência de configuração do Codex](https://developers.openai.com/codex/config-reference).
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

- **RACI (R / A / C / I):** R: equipe Orkastery; A: Julio; C: segurança, privacidade, observabilidade e maestros inscritos; I: times da empresa.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO separou a telemetria da rede coletiva em modo `#Fast`; o dono decidiu D1 e D2; a condução decidiu D3 com reversão explícita pelo dono; D4 aguarda decisão do dono.
- **Próxima ação, responsável e prazo:** dono decide D4 e a prioridade de construção; prazo a definir pelo dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-10 | Telemetria foi proposta dentro da RM-089, junto com a rede coletiva e a trava empresarial | Pedido do dono no terminal na primeira rodada | Julio |
| 2026-11-10 | RM-090 criada para logs OpenTelemetry e Grafana, com D1 e D2 respondidas e D3 decidida de forma reversível | Esclarecimento do dono, respostas `"1a (a empresa ve tudo)"` e `"2b"`, e critério de ativação derivado pela condução | Julio em D1 e D2; sessão GO em D3 |
