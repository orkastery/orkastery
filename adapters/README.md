# adapters/

Adaptadores de host (Camada 1): Claude Code, Codex, Hermes e OpenClaw.

Eles traduzem intenção em chamada de `ork`, apresentam gates ao humano e registram decisões.
**Zero regra de negócio.** Nem o parse da #TAG de modo é reimplementado aqui: o host chama
`ork modos --do-pedido`, que usa a `extrairTagDoPedido` do núcleo, e a validação contra
`conduction.allowed_modes` também é do núcleo.

| Host | O que entra | Instalação |
| --- | --- | --- |
| [claude-code](claude-code/README.md) | Plugin com as skills do catálogo, subagentes de fase, `/goal` ... `/master` e o guard `PreToolUse` | `ork adapter install claude-code` |
| codex | Entrada `$ork` e o catálogo de condução em skills locais do projeto | `ork adapter install codex` |
| [hermes](hermes/README.md) | Skill roteadora fina, plugin de ingresso HITL e scripts de abertura de thread | `ork adapter install hermes` |
| [openclaw](openclaw/README.md) | Extensão (`package.json`, `dist/index.js` e manifesto) com as tools `ork_*`, instalada em `extensions/orkastery` | `ork adapter install openclaw` |

Cada README traz os **3 pitfalls de instalação** do seu host: os três jeitos conhecidos de a
instalação "dar certo" e não funcionar. O instalador cita os mesmos três ao terminar, e o
`--dry-run` mostra o que ele faria sem escrever nada.

Os adaptadores de RUNTIME (Camada 3) são outra coisa e ficam em `core/src/adapters/`, porque quem
os chama é o núcleo: `claude-bg` e `codex`. O Claude Code aparece nas duas camadas, com papéis
diferentes, e confundir as duas é o jeito mais rápido de prometer um motor que não existe.

## Paridade Maestro

A frase `orkastery maestro` consulta o mesmo contrato do núcleo nas quatro
instalações: MCP no Codex e no Claude, wrapper argv no Hermes e tool argv no OpenClaw.
O instalador inclui entrada, callback e recibo de arquivos; instalação não prova
ativação em sessão nova. `maestro-parity.test.ts` compara o contrato canônico e
instalações temporárias. Os testes específicos de cada adaptador exercitam o
transporte fixture; os recibos live são uma etapa posterior e separada.

Usabilidade HITL é prioridade máxima: recomendação, opções claras e canal disponível
associado ao pedido. MCP local conserva elicitation; Telegram segue disponível
quando configurado. Ingresso nativo Hermes/Discord e OpenClaw depende de callback
autenticado e binding privado; terminal Hermes/ACP não está homologado.
