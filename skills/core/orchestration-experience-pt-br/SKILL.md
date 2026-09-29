---
name: orchestration-experience-pt-br
description: "Experiência de conversa para quem conduz projetos com Orkastery: preferências, decisões, fatos e coordenação pelo núcleo."
bucket: core
roteia: "ork experiencia show | ork onboarding | ork roadmap status | ork observe"
license: MIT
---

# Experiência de orquestração

Use em projeto configurado com Orkastery. Consulte `ork experiencia show --json` no
projeto da sessão. Se `experience` for false, não ative este pacote. A configuração
explícita prevalece; defaults detectados não significam que o humano respondeu.
A etapa `maestro` de `ork onboarding` apresenta ativar, configurar e desativar.
Metodologia, validação e autorização pertencem ao núcleo; esta skill só orienta a conversa.

## 1. Idioma e horário

Use `language`, `timezone` e `depth` efetivos. Responda no idioma configurado, traduzindo
citações quando preciso. Use a apresentação localizada do núcleo (I-35), incluindo
`prazoLocal`; não mostre ISO com Z ao humano nem altere timestamps do ledger.
UTC é válido quando escolhido ou detectado pelo núcleo, sem impor um fuso pessoal.

## 2. Mensagem

Estado em uma linha; o que mudou em até quatro tópicos; o que precisa da pessoa
(geralmente nada); próximo passo em uma linha. Respeite `curta` ou `detalhada`.
No máximo uma tabela. SHA, arquivo e teste só quando solicitados ou relevantes para
a decisão. Não narre a investigação. Ofereça detalhes. ID de item sempre com nome curto.

## 3. Decisões

Decida autonomamente só com critério escrito, alternativas piores por esse critério,
reversão possível antes da entrega e erro barato e observável. Se faltar condição,
apresente o tradeoff: irreversibilidade, dinheiro ou mudança de escopo exigem decisão.
Use `ork decisao registrar` pelo transporte autorizado: quem decidiu, evidência, razão,
critério, como mudar e custo de reverter agora/depois. Informe as decisões no próximo
resumo, uma linha por Dn. Decisão tomada não pode desaparecer da conversa.

## 4. Perguntas e HITL

Use a apresentação do núcleo (RM-048/I-41) e `ork_request_decision` na sessão condutora.
Transporte como vem: modo de responder primeiro, recomendação única ✅, custos e
reversibilidade ↩️ ou irreversibilidade ⚠️; perguntas reais são apresentadas imediatamente.
O núcleo controla lotes de até cinco objetivas, até quatro opções, pedido curto de até
15 linhas; abertas vêm depois, uma por vez, até duas. Não reimplemente o formatador.
Silêncio não é aprovação humana. Prazo não assina gate; preserve ingresso HMAC e
identidade nativa. Sessão filha nunca responde pelo dono. Sem transporte, relate a pendência.

## 5. Destino dos comandos

Indique um destino por linha: 💬 no chat, ⌨️ no terminal, 🌐 no navegador.
Não misture mensagem ao agente, comando de shell e página na mesma instrução.

## 6. Roadmap

Consulte `ork_roadmap_status` ou `ork roadmap status` e transporte o texto do núcleo,
sem recriar grupos, contagens ou formato. Use IDs com nome curto. `#HITL` só marca
pendência humana atual comprovada; confira repositório, ledger e recibos de publicação.
Página antiga não vence estado medido. Grupos e sua ordem pertencem ao núcleo (RM-048).

## 7. Fatos antes do relato

Leia estado, eventos, log e HEAD antes de afirmar. Use `ork_observe`/`ork observe` e os
mecanismos de parada do núcleo; respeite limiares configurados, sem inventar oito minutos
fixos ou prometer vigilância permanente. Skill não cria monitor. Mostre a falha real e
passos pulados. Sem sessão ativa, deixe checkpoint. Claim cadastrada não é prova verificada.

## 8. Operação

Use dry-run quando o comando o suporta; caso contrário, ensaie em projeto temporário.
Não invente flags. Segredos ficam no cofre local: só referências públicas na conversa.
Ação externa ou difícil de desfazer respeita autorização prévia explícita e gates nativos.
Não altere runtime, provider, perfil ou sandbox para contornar recusa.

## 9. Produto público

Exemplos neutros: sem pessoas, clientes, e-mails, IDs de chat, hosts, caminhos ou metas
pessoais. Só publique fatos necessários ao produto. Contexto privado fica fora do repositório.

## 10. Documentação

Resposta primeiro, frases curtas e uma ideia por linha. Afirmações conferíveis no código,
IDs estáveis e campos previsíveis servem a pessoas, verificadores e agentes. Divergência
é defeito. Fatos de produto nas docs; microdecisões de condução no ledger.

## 11. Canais e máquinas

Antes de pegar item, consulte `ork_roadmap_reservas`/`ork roadmap reservas` e
`ork_fabrica`/`ork fabrica`. Indisponibilidade não é lista vazia; informe cópia desatualizada.
Crie trabalho autorizado com `ork thread new` e `--roadmap RM-NNN` para associação pelo
núcleo. Consultar não reserva. Coordene canais da mesma pessoa; não encerre sessão alheia.
Sessão despachada retoma a fase recebida, sem abrir outra orquestração.

## 12. Entrega

Alinhe comportamento, changelog, docs, versão e distribuição aplicáveis. Use `ork verify`,
`ork ship` e `ork master` pelos gates, distinguindo commit, teste local, recibo oficial e
publicação. Não afirme entrega sem prova. Respeite limite de sessão e versão decididos.

## Racionalizacoes comuns

| Desculpa | Realidade |
| --- | --- |
| “#Auto deixa aprovar pelo dono” | Silêncio não é aprovação humana; HMAC não muda. |
| “O teste deve passar” | Execute; claim cadastrada não é recibo oficial. |
| “Instalar a skill concede acesso” | Preferências não alteram permissões nativas. |

## Bandeiras vermelhas

Autoria inventada, estado suposto, segredo público, reserva inferida de consulta ou
metodologia duplicada no host. Evals estáticos não comprovam comportamento real de LLM.
