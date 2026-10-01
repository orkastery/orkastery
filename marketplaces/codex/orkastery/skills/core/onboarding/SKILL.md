---
name: onboarding
description: "Conduz ou retoma a entrevista de configuração do projeto pela pauta de ork onboarding. Use para registrar respostas públicas, consultar pendências, resetar uma resposta ou publicar a entrevista na memória."
bucket: core
roteia: "ork onboarding | ork doctor"
license: MIT
---

# Onboarding do projeto

Consulte `ork onboarding` para obter a pauta e `ork onboarding show --json` para retomar
as etapas pendentes. A ordem, o contrato e a validação pertencem ao núcleo; não mantenha
uma lista paralela de etapas na skill ou no host. Não crie thread para apenas entrevistar.

Conduza as perguntas da pauta, usando as respostas do builder. Grave cada resposta pública
com `ork onboarding set <etapa> --conteudo <JSON> --por <quem>`. Transporte o JSON como dado,
com escaping adequado ao shell. Não invente resposta nem autoria; `owner` é o default do CLI,
não uma declaração de que o humano respondeu.

Na etapa maestro, consulte `ork experiencia show --json` e apresente a opção recomendada
detectada, configurar e desativar. Grave somente a escolha recebida em `owner`, com
`language`, `timezone`, `depth` e `experience`. O núcleo persiste essas chaves no manifesto,
preservando as demais respostas. Exemplo de opt-out:
`ork onboarding set maestro --conteudo '{"owner":{"experience":false}}' --por equipe`.
Sem resposta, mantenha a pergunta pendente: defaults efetivos não são autoria humana.

Peça somente referências de variáveis nas etapas sensíveis. Valores secretos ficam em
`~/.hermes/.env`; não leia esse arquivo nem leve credenciais para conversa, onboarding ou ledger.
Se o builder fornecer um segredo, não o repita: oriente a configuração local e registre apenas
a referência pública aceita pelo núcleo.

Repetir conteúdo idêntico preserva autoria, carimbo e eventos. Reset exige pedido explícito:
use `ork onboarding reset [etapa]` (omitir etapa limpa todas). Releia o estado depois da operação.

A publicação opcional usa `ork onboarding sync --json`. Regime files ou driver indisponível
produz degradação tipada; a entrevista pode concluir em arquivos. Não anuncie memória publicada
quando o resultado informa degradação. A escolha registrada orienta `memory.mode` no manifesto,
sem alterá-lo automaticamente. `ork doctor` mostra pendências e divergência de escolha.

Ao concluir, apresente o estado medido por `ork onboarding show --json` e eventuais pendências.
Eval estrutural não prova comportamento de LLM nem semanas de operação; essa metade permanece
unavailable até existir execução observada.

## Racionalizacoes comuns

| Desculpa | Resposta |
|---|---|
| "Guardar o token aqui é mais rápido" | Guarde somente referências; valores ficam no arquivo local de segredos. |
| "#Auto permite inventar o restante" | As respostas vêm do builder; autonomia não cria fatos. |
| "Files significa onboarding incompleto" | A entrevista local conclui; relate o motivo da degradação sem afirmar publicação. |

## Bandeiras vermelhas

- Lista de etapas ou validação copiada do núcleo para o host.
- Credencial em resposta, prompt ou ledger.
- Reset sem pedido do builder ou autoria humana inferida.
- Publicação declarada sem conferir o resultado de sync.
