# Experiência de orquestração

[English](orchestration-experience.md) | **Português (Brasil)**

Configure como o agente conversa ao conduzir seu projeto: idioma, fuso horário, profundidade e ativação do pacote. As doze regras orientam mensagens, decisões, perguntas, comandos, roadmap, evidências, segurança, exemplos públicos, documentação, coordenação e entrega. Gates, permissões e identidade humana continuam no núcleo.

## Configurar no projeto

⌨️ No terminal, na raiz do projeto inicializado:

```bash
ork onboarding
ork experiencia show --json
ork onboarding set maestro --conteudo '{"owner":{"language":"pt-BR","timezone":"UTC","depth":"curta","experience":true}}' --por equipe
ork experiencia show --json
```

A pauta oferece ativar com os valores detectados, configurar ou desativar. O exemplo usa UTC, um fuso válido; escolha um nome IANA adequado ao projeto. `owner` na resposta `maestro` persiste as preferências em `orkastery.yaml`, preservando as outras respostas e seções. O campo legado `fuso` apenas orienta o manifesto, como antes. Uma consulta não inventa resposta, autoria ou aprovação.

| Campo | Valores | Quando ausente |
| --- | --- | --- |
| `owner.language` | Locale BCP-47, como `pt-BR` ou `en-US` | Locale do sistema |
| `owner.timezone` | Fuso IANA | Resolução de fuso do núcleo |
| `owner.depth` | `curta` ou `detalhada` | `curta` |
| `owner.experience` | `true` ou `false` | `true` |

`show --json` informa valores efetivos, origem e skill selecionada. Locales portugueses usam a variante pt-BR; demais locales usam a inglesa, mantendo o idioma de resposta configurado. Entrada inválida é recusada antes de gravar a entrevista. Valor inválido editado à mão no manifesto gera aviso e vale o padrão até ser corrigido pelo mesmo `onboarding set`; enquanto isso, `adapter install` pula o pacote (um `experience: "false"` não ativa nada) e `experiencia show` mostra o aviso. Configuração explícita prevalece sobre a detecção; repetir a mesma resposta volta a aplicá-la ao manifesto.

## Instalar e conferir descoberta

⌨️ No terminal, no mesmo projeto:

```bash
ork adapter install codex --dry-run
ork adapter install codex
```

Troque `codex` por `claude-code` ou `hermes` conforme o host. Claude Code recebe o catálogo e um bloco próprio em `CLAUDE.md`; Codex recebe o catálogo e um bloco em `AGENTS.md`. O bloco do `ork init` e conteúdo externo são preservados. O destino do catálogo pode ser configurado com `--dir`, que troca a pasta-base do host (`.claude` no Claude Code, `.agents` no Codex): o catálogo vai para `<dir>/plugins/orkastery` no Claude Code e para `<dir>/skills/orkastery` no Codex; o bloco fica na raiz do projeto e aponta o catálogo por caminho relativo ao projeto, para valer em outro clone. Catálogo fora do projeto pula o bloco com aviso. Sem manifesto nessa raiz, a instalação apenas copia o adaptador.

💬 No chat do host aberto nesse projeto, use a entrada Orkastery e confira a preferência efetiva. Claude Code também exige a ativação do plugin indicada pelo instalador; copiar arquivos não comprova descoberta nativa ou uso pelo modelo. Outra worktree precisa de sua instalação.

Hermes recebe as duas variantes ao lado da skill `orkastery-devmaster`, que consulta a configuração com `--projeto <nome>` antes de ativar o pacote. OpenClaw ainda não distribui essas skills; a lacuna permanece em [RM-051: pacote de experiência](../roadmap/RM-051-pacote-de-experiencia.md).

## Desativar ou remover

⌨️ No terminal, para desativar o pacote em todas as entradas que consultam as preferências:

```bash
ork onboarding set maestro --conteudo '{"owner":{"experience":false}}' --por equipe
ork adapter install codex
```

Repita `adapter install` para cada host instalado que possua bloco. O opt-out remove seu bloco gerenciado na reinstalação. Hermes respeita `experience:false` pela entrada da skill, mantendo os arquivos distribuídos.

⌨️ No terminal, para remover somente o bloco de um host:

```bash
ork experiencia uninstall codex --dry-run
ork experiencia uninstall codex
```

A remoção explícita aceita `codex` e `claude-code`, preserva o adaptador e não altera a preferência global. Uma instalação posterior pode reativar o bloco se `experience` continuar true. O recibo fica em `.orkastery/experiencia/<host>.json`. Sem mudanças externas, a remoção restaura os bytes anteriores, incluindo CRLF ou arquivo originalmente ausente. Mudanças externas fora do bloco permanecem, e uma linha acrescentada depois do bloco não se funde à última linha do arquivo.

Num clone novo, `CLAUDE.md` ou `AGENTS.md` chega com o bloco e sem o recibo. Um bloco igual ao gerado é adotado, sem duplicar. Sem o recibo, a remoção tira o bloco e a linha em branco anterior; só não sabe se o arquivo original terminava sem quebra de linha. Bloco editado ou duplicado, recibo incompatível ou arquivo de instruções por link (como `CLAUDE.md` apontando para `AGENTS.md`): `adapter install` pula só o pacote, com aviso, e instala o adaptador; `experiencia uninstall` recusa sem escrever. Corrija o arquivo à mão; não apague o recibo para forçar a instalação.

## Coordenar trabalho

⌨️ No terminal, antes de assumir um item:

```bash
ork roadmap reservas
ork fabrica
ork thread new "RM-012 exemplo de melhoria" --modo auto --roadmap RM-012 --dry-run
```

O exemplo exige um item real para a criação efetiva. O dry-run não reserva; sem `--dry-run`, `--roadmap` usa a reserva do núcleo. `RM-NNN` apenas no nome emite aviso e não associa automaticamente.

No MCP, `ork_roadmap_reservas` e `ork_fabrica` recebem `{}` (ou só `projeto` com o nome do projeto servido) e usam o projeto e `origin` fixados pelo servidor. A consulta roda fora do laço do servidor, que segue atendendo as outras ferramentas; cancelamento do host ou o prazo de 90 s encerram o processo da consulta. Retornam `atualizado`, `desatualizado` ou `indisponivel`; indisponibilidade tem `dados:null`, nunca uma falsa lista vazia. Consultas podem atualizar a cópia local das branches de estado, mas não reservam, publicam, fazem push ou assinam gates. Transporte permitido é o mesmo perfil GitHub SSH ou bare local autorizado na instalação; falha de perfil permanece indisponível.

## Evidência e limites

Testes focados cobrem preferências, blocos, clone sem recibo, conflitos, adaptadores e contratos MCP. Evals das skills são estáticos: não comprovam comportamento real de LLM. O ensaio `node core/scripts/testar-experiencia-e2e.cjs`, executado a partir do repositório do produto, instala um tarball local em prefixo e HOME temporários, usa o binário instalado e confere dry-run, reinstalação, clone sem recibo, opt-out, remoção e restauração. Exige dependências disponíveis no cache npm para instalação offline.

Publicado no `@orkastery/cli` 0.5.0 (tag `v0.5.0`), com o merge do PR #33. Commit local e resultado de teste local não são SHIP.
