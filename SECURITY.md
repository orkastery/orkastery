# Política de segurança

## Reportar uma vulnerabilidade

Não abra issue pública para vulnerabilidade.

Use o canal privado do GitHub: **Security** > **Report a vulnerability** no repositório
[Orkastery/orkastery](https://github.com/orkastery/orkastery/security/advisories/new).

Inclua, se puder:

- o comando ou o passo que reproduz;
- a saída real observada;
- a saída de `ork doctor` da máquina onde ocorreu;
- o impacto que você enxerga.

Resposta esperada em até 7 dias. Vulnerabilidade confirmada e corrigida antes da divulgação, e o
crédito vai para quem reportou, salvo pedido em contrário.

To report in English, the same channel works. Please do not open a public issue.

---

## Superfície do produto

Vale saber o que o Orkastery é, antes de procurar o que ele expõe:

| Superfície | O que existe |
| --- | --- |
| Processo residente | **nenhum**. É um CLI, não um daemon |
| Porta de rede aberta | **nenhuma** |
| Servidor embutido | **nenhum** |
| Dependencias de runtime | **zero**. Sem árvore de deps transitivas para auditar |
| Chamada de LLM feita pelo núcleo | **nenhuma**. Não há cliente de API nem chave |
| Estado | Arquivos no repositório, sob `.orkastery/` |

O que ele **executa**: comandos declarados por você, no manifesto (`verify.build`,
`verify.test`, `verify.typecheck`, `verify.preparo`, `ci.command`), nas claims
(`--verificar "<comando>"`, o `--done` da thread, as correções do GO-FIX, os achados de auditoria)
e no bundle `.ork-ci/<thread>.json` do CI, além do binário do runtime adapter e do executável do
OrkMind (`memory.cli`, só nome no PATH ou caminho absoluto).

Isso é a superfície real, e ela merece a atenção: **um manifesto ou uma claim de origem não
confiável executam comando na sua máquina.** Trate `orkastery.yaml` e `claims.jsonl` de um
repositório de terceiros com o mesmo cuidado que você trata um `Makefile` ou um script de
`postinstall`.

Fora desses comandos declarados, um valor que vem do repositório (manifesto, estado em `.orkastery/`,
branches `ork/*`, arquivos de outra máquina) não vira opção de processo, executável nem caminho fora da
raiz. A matriz de cada chamada de processo e de cada caminho, com o que ainda depende de decisão, está em
[docs/referencia/fronteira-de-confianca.md](docs/referencia/fronteira-de-confianca.md).

---

## Segredos

O `ork` não coleta, não armazena e não transmite credencial.

A DSN da base do OrkMind **nunca** vai ao manifesto. O manifesto declara o **nome** da variável
de ambiente que a contém:

```yaml
memory:
  database_url_env: "MEUPRODUTO_ORKMIND_DATABASE_URL"   # o NOME, nunca o valor
```

Variável não declarada ou vazia **não** vira "usa a base padrão": vira degradação para o regime
`files`, com motivo tipado. Essa regra vem de um incidente real de vazamento de memória entre
tenants, e por isso ela é código, e não recomendação.

A policy `segredo_em_prompt: block` do manifesto barra segredo entrando no texto de um prompt,
em **qualquer** modo de condução, inclusive no `#Auto`.

---

## Custo e provider

A policy `provider_policy: subscription-only` declara que o projeto só despacha pela assinatura
local. Despacho redirecionado para provider pago vira `cost.violation`, o **único** motivo
tipado que jamais recebe retry automático: reexecutar uma violação de custo e gastar de novo.

O `ork doctor` avisa quando há credencial paga no ambiente, mesmo sem uso.

O projeto não faz, e não aceita PR que faça: spoofing de harness, extração de token OAuth,
compartilhamento de credencial, ou qualquer forma de contornar o canal oficial de um runtime.
A rotação automática entre contas do mesmo runtime só ocorre entre perfis que o próprio operador
cadastrou e autenticou pelo CLI oficial de cada runtime, para contas que ele tem direito de usar
sob os termos do provedor; a responsabilidade por esses termos é do operador. Ela nunca usa
perfil de API paga (D13), nunca acontece no rate limit comum e pode ser desligada pela chave
`runtime_profiles.rotate_same_runtime_on_quota` do manifesto. É a decisão do dono de 19/09/2026,
detalhada em "Perfis de conta por runtime (I-33)" abaixo.

### Perfis de conta por runtime (I-33)

A fronteira de `cost.violation` não muda com os perfis de conta: a remoção das variáveis de
provider pago do ambiente do filho continua valendo em todo despacho, com ou sem perfil, e a
rotação de perfil ou de runtime nunca introduz API key paga nem reexecuta violação de custo.

Isso é conferido por perfil, antes de todo despacho (D13): o preflight só aprova login de
assinatura, com `claude auth status --json` em `authMethod` `claude.ai`, sem `apiKeySource` e
com provider `firstParty`, e `codex login status` em "Logged in using ChatGPT". Perfil logado
por API key, `api_key_helper`, Console ou provider de nuvem fica no estado `provider-pago`,
nunca recebe despacho, aparece assim no `ork accounts list` e no `ork doctor` e só volta quando
o `ork accounts check` confere login de assinatura. Sem outro perfil elegível, o bloqueio é
`cost.violation`, sem retry. O `ork accounts add` roda `claude auth login --claudeai`, nunca o
login do Console.

O que o `ork` guarda e o que não guarda:

- o store `ork.runtime-profiles/v1` (`.orkastery/private/runtime-profiles.json`, arquivo 0600
  em pasta 0700, dono conferido) contém só identidade, diretório e estado de uso de cada perfil;
- o `ork` nunca lê, copia ou migra arquivo de credencial: o login é feito pelo próprio CLI do
  runtime (`claude auth login`, `codex login`) com o env do perfil, e a conferência também
  (`claude auth status`, `codex login status`);
- o perfil vai ao ledger só como identidade e diretório; nenhum valor de credencial entra em
  prompt, ledger, fila ou saída do CLI.

**Decisão do dono em 19/09/2026 (opção a):** consultado pela sessão condutora da thread
`ork-i33rotacaoco` sobre o achado A3 do CHECK `aa279e17`, com as três opções do parecer e o
alerta sobre a política anterior deste arquivo e os termos de uso dos provedores, o dono do
projeto escolheu permitir a rotação automática por cota ou crédito esgotado entre contas próprias
do operador no mesmo runtime, sem compartilhar credencial, mantendo o rate limit comum sem
rotação, com a condição de que perfil de API paga nunca receba despacho (D13, acima). Ela
substitui a proibição anterior de "multiplexação de conta para escapar de limite de uso". No
código:

- `runtime_profiles.rotate_same_runtime_on_quota: true` é o padrão: esgotamento da conta
  marca o perfil, e o mesmo prompt segue no próximo perfil ativo do mesmo runtime, depois no
  fallback entre runtimes da ordem do bloco e, sem destino, na fila durável até o prazo.
  Esgotamento é a conta sem cota, crédito ou saldo dito pelo provedor (`usage_limit_exceeded`,
  `insufficient_quota`, "out of credits", `billing_error`), com qualquer prazo, ou o limite do
  plano ("usage limit reached", "You've hit your ... limit") com prazo dito de 15 minutos ou
  mais (`JANELA_CURTA_MAX_MS`) ou sem prazo futuro. Com `false`, o operador desliga essa troca:
  o perfil esgotado segura o runtime até o prazo.
- rate limit comum nunca troca de perfil nem marca o perfil: é o que o provedor diz ser
  temporário e não a cota ("not your usage limit", "Request rejected (429)",
  `rate_limit_exceeded`, requisições ou tokens por minuto, servidor sobrecarregado), o limite do
  plano com prazo dito menor que 15 minutos e qualquer outro sinal de limite sem esgotamento
  (`429`, "rate limit", "too many requests", "quota exceeded"; o Retry-After só vale como prazo
  junto de um deles). Na recusa do despacho ele vira `runtime.rate-limited` e espera a janela na
  fila durável; no caminho terminal do turno fica com a classificação da I-34
  (`runtime.unavailable`), porque o observador não grava pedido na fila, e o `ork retry run`
  reexecuta o mesmo prompt sem esperar a janela, com o perfil da vez do runtime (o que falhou
  continua no rodízio), dentro de `retry.max_tentativas`. O critério entre os dois é um só,
  `naturezaDoLimite` em `core/src/adapters/claude-bg.ts`, descrito em
  [docs/guias/verificacao.md](docs/guias/verificacao.md).
- `runtime_profiles.rotate_same_runtime_on_auth: true` continua o padrão: login perdido é
  disponibilidade, não fuga de limite.
- perfil `provider-pago` nunca recebe despacho, com ou sem rotação.

A responsabilidade pelos termos de uso de cada provedor é do operador: cadastre perfis só para
contas que você tem direito de usar sob esses termos, faça o login pelo CLI oficial de cada
runtime e desligue a chave quando o seu plano não permitir a troca automática. O `ork` não
confere esses termos. A troca manual e explícita pelo operador (`ork accounts`, `ork setup`)
continua possível.

O núcleo não tem hoje comando para gravar no ledger uma decisão avulsa do dono fora de pausa de
bloco (`ork gate approve` está aposentado e `ork gate request` exige pausa correlacionada; é a
lacuna da D18 publicada pela I-34 na [RM-034](docs/roadmap/RM-034-conclusao-claude-bg.md)). Por isso esta decisão
(D16 da thread) fica registrada aqui, e não como evento do ledger.

---

## Auditoria da sua própria superfície

O `ork` traz uma varredura deterministica da superfície de ataque de rede, para o **seu**
produto, sem LLM:

```bash
ork audit surface            # sai != 0 quando ha achado: serve como gate de CI
ork audit surface --json
```

Ela cobre `SP8` a `SP12` (rota sem autenticação, endpoint de administração exposto, rota sem
limite de taxa, CORS permissivo, rota sem esquema de validação) sobre express, fastify, hono,
koa, NestJS, Next.js, FastAPI, Flask, Django, gin e echo.

Achado com leitura incerta sai com confiança `baixa` é o título diz **REQUER CONFIRMAÇÃO
HUMANA**. Ver [`docs/guias/auditoria.md`](docs/guias/auditoria.md).
