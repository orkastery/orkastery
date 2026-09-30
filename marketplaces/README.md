# Marketplaces do Orkastery

> **Em uma frase:** o plugin do Orkastery pronto para o diretório da Anthropic e para o da OpenAI, gerado do catálogo do repositório, com o passo a passo de submissão para o dono.

Submeter e publicar são atos do dono. Nada aqui é enviado a portal nenhum por agente.

## O que existe aqui

| Caminho | O que é |
| --- | --- |
| [`claude-code/orkastery/`](claude-code/orkastery/README.md) | A pasta do plugin do Claude Code: 18 skills, 8 comandos, 6 subagentes e as checklists, sem hooks nem MCP |
| [`codex/orkastery/`](codex/orkastery/README.md) | A pasta do plugin de skills do Codex: a entrada `ork` e as 18 skills do catálogo |
| [`fontes/`](fontes/listagem.json) | Os textos da listagem: `listagem.json` (descrições, prompts, URLs) e os READMEs de cada host |
| [`PRIVACY.md`](PRIVACY.md) | A nota de privacidade que os dois portais pedem |
| [`formularios.md`](formularios.md) | O valor de cada campo dos dois portais, os casos de teste e as respostas de tratamento de dados |
| `../.claude-plugin/marketplace.json` e `../.agents/plugins/marketplace.json` | Os marketplaces próprios, na raiz do repositório |

As duas pastas `orkastery/` são **geradas**. Não edite a cópia: edite o catálogo ou a fonte e rode:

```bash
npm --prefix core run build
node core/scripts/gerar-marketplaces.cjs              # regenera
node core/scripts/gerar-marketplaces.cjs --verificar  # o que o CI roda
```

O guard `PreToolUse` e os sensores de sessão ficam de fora de propósito: instalado pelo diretório, o plugin vale para a conta inteira, e o guard barraria comandos em todos os repositórios da pessoa. Quem quer o guard usa `ork adapter install claude-code`, por projeto.

## 1. Instalar hoje, sem esperar revisão

Os dois marketplaces próprios ficam na raiz do repositório: a instalação não espera a revisão dos diretórios.

```bash
# Claude Code
claude plugin marketplace add orkastery/orkastery
claude plugin install orkastery@orkastery

# Codex
codex plugin marketplace add orkastery/orkastery
codex plugin add orkastery@orkastery
```

## 2. Diretório da Anthropic (Claude Code, claude.ai e Cowork)

**Antes:** plano pago do claude.ai (no Pro e no Max, pela própria conta; no Team e no Enterprise, um Owner) e o GitHub conectado nessa organização do claude.ai, com permissão de escrita em `orkastery/orkastery`. O `claude-plugins-official` não recebe submissão pelo portal; o caminho é o diretório.

Submeta pela organização do claude.ai que vai ser a dona da listagem: o portal dá cada pasta à primeira organização que a submete. A listagem aparece também no claude.ai e no Cowork, onde não há `ork`; o README do plugin diz que ele serve em sessões do Claude Code com o CLI instalado.

1. Abra [claude.ai/directory/manage](https://claude.ai/directory/manage), escolha **Submit new** e depois **Plugin bundle**.
2. Em **Source**: Repository `orkastery/orkastery`, Plugin path `marketplaces/claude-code/orkastery`, Branch or tag `main`. Clique **Validate**.
3. Achado **Blocking**: corrija na fonte, regenere, entre com PR e clique **Re-validate**. A validação vale para um commit só.
4. **Listing details** vem do `plugin.json` e do README: para mudar, edite `fontes/` e regenere.
5. **Data handling** e **Compliance**: respostas em [formularios.md](formularios.md#anthropic). O e-mail de contato é o da conta do dono, e não entra no repositório.
6. **Review and submit**: deixe **GitHub push webhook** (precisa de admin no repositório) e envie com **Submit for review**.
7. Acompanhe em **Submissions**, aba **Versions**. Versão aprovada só vai ao ar depois de **Publish**.

Versão nova: sobe junto com a versão do `@orkastery/cli`. Regenere, entre na `main`, e o diretório pega o commit pelo webhook ou pela checagem agendada.

## 3. Diretório da OpenAI (Codex e ChatGPT)

**Antes:** organização na OpenAI Platform com identidade verificada (pessoa ou empresa) e um papel com escrita em **Apps Management**.

1. Abra [platform.openai.com/plugins](https://platform.openai.com/plugins), crie o plugin e escolha **Skills only**.
2. **Info**: nome, descrições, identidade, logo, categoria e as quatro URLs, em [formularios.md](formularios.md#openai).
3. **Skills**: envie o pacote da pasta gerada. A página da OpenAI não diz o formato; o zip abaixo leva o manifesto, as skills e os assets, e o portal confirma na tela.

   ```bash
   (cd marketplaces/codex && zip -r /tmp/orkastery-codex-skills.zip orkastery)
   ```

4. **Prompts**, **Testing** (5 positivos e 3 negativos), **Global** e **Submit** (notas de versão): tudo em [formularios.md](formularios.md#openai).
5. **Submit for Review**. Depois da aprovação, o dono escolhe quando publicar.

## 4. O que o gerador confere e o que só o portal confere

| Conferido no CI por `--verificar` | Só o portal confere |
| --- | --- |
| Deriva entre a cópia e o catálogo, versão igual à do CLI | Nome já tomado ou parecido com marca de terceiro |
| Nome, campos e caminhos do manifesto, as 18 skills | Varredura de segurança e leitura por revisor |
| README com 40 palavras ou mais, `LICENSE`, contagens do README | Regras de política dos diretórios |
| Tipos de arquivo, tamanho, quantidade, symlink, arquivo de sistema | Tela de upload da OpenAI (formato do pacote) |
| Frontmatter YAML que faz parse, sem hooks, MCP nem `bin/` | |
| Interface do Codex: prompts, cor, logo e ícone | |
