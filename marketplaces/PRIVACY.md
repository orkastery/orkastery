# Privacy

**English** · [Português](#privacidade)

This note covers the Orkastery plugin for Claude Code and for Codex, and the `ork` CLI they route to.

- **The plugin collects nothing.** It ships Markdown and images only: skills, commands, subagents and checklists. It has no hooks, no MCP server of its own, no scripts, and it makes no network requests.
- **The `ork` CLI runs on your machine.** It keeps its state as files under `.orkastery/` in your repository. It runs no hosted service, opens no network port and calls no model API; while a phase runs, it may keep local helper processes for that session, such as the session watcher. The source is in this repository, under the MIT license.
- **Network access only goes where you point it.** It happens through programs you already use and configure yourself, such as your git remote when a thread ships, or an optional integration you set up, like an OrkMind memory database or a notification channel.
- **The maintainers receive no data.** Nothing is sent to them: no remote telemetry, no account and no analytics. The metrics the CLI computes (`ork ledger stats`) come from your local ledger and stay there.
- **Credentials.** The CLI does not collect, store or transmit credentials. See [SECURITY.md](../SECURITY.md) for the full surface and for how to report a vulnerability.

The coding agent you run (Claude Code or Codex) is covered by its own provider's terms and privacy policy.

Questions: open an issue at [github.com/orkastery/orkastery](https://github.com/orkastery/orkastery/issues).

## Privacidade

Esta nota cobre o plugin do Orkastery para o Claude Code e para o Codex, e o CLI `ork` para onde eles roteiam.

- **O plugin não coleta nada.** Ele só leva Markdown e imagens: skills, comandos, subagentes e checklists. Não tem hook, não tem servidor MCP próprio, não tem script e não faz requisição de rede.
- **O CLI `ork` roda na sua máquina.** Ele guarda o estado em arquivos sob `.orkastery/` no seu repositório. Não roda serviço hospedado, não abre porta de rede e não chama API de modelo; enquanto uma fase roda, pode manter processos auxiliares locais daquela sessão, como o observador de sessão. O código está neste repositório, sob a licença MIT.
- **A rede só vai aonde você aponta.** O acesso acontece pelos programas que você já usa e configura, como o remoto do git quando uma thread é entregue, ou uma integração opcional que você liga, como a base de memória do OrkMind ou um canal de notificação.
- **Os mantenedores não recebem dado nenhum.** Nada é enviado a eles: nem telemetria remota, nem conta, nem analytics. As métricas que o CLI calcula (`ork ledger stats`) saem do ledger local e ficam nele.
- **Credenciais.** O CLI não coleta, não armazena e não transmite credencial. Veja o [SECURITY.md](../SECURITY.md) para a superfície completa e para relatar uma vulnerabilidade.

O agente que você usa (Claude Code ou Codex) segue os termos e a política de privacidade do próprio fornecedor.

Dúvidas: abra uma issue em [github.com/orkastery/orkastery](https://github.com/orkastery/orkastery/issues).
