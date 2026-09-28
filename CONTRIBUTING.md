# Contribuindo com o Orkastery

Obrigado por considerar contribuir. Este documento diz o que o projeto espera, e por que.

Contributions in English are welcome. The codebase, comments and documentation are written in
Brazilian Portuguese, and a pull request that follows that convention is easier to merge, but a
clear technical contribution in English will never be turned away for language alone.

---

## O princípio que orienta tudo

> Nada entra sem evidência executável.

Este projeto existe porque self-report não vale como prova. Isso se aplica a quem contribui
exatamente como se aplica aos agentes que o produto conduz. Não há exceção para humanos, e não
há exceção para mantenedores.

Na prática: toda mudança de comportamento vem com o comando que a comprova, e o comando roda
nesta árvore.

---

## Antes de abrir um PR

```bash
cd core
npm install
npm run build
npm test                          # a suite inteira, 209 testes hoje
node dist/index.js eval           # canarios de comportamento + corpus das skills
node dist/index.js audit surface  # varredura da superficie de rede (sai != 0 se achar)
```

Os quatro precisam passar. Se um deles falhava **antes** da sua mudança, diga isso no PR: e
dívida pré-existente, e não é sua. E a mesma distinção que o `ork verify --baseline` faz, e ela
vale para gente também.

---

## O que um bom PR traz

| Parte | O que traz |
| --- | --- |
| **O problema** | O que estava errado, com o comando ou o passo que reproduz |
| **A mudança** | O que você fez, e o que você deliberadamente não fez |
| **A prova** | O comando que passa agora e falhava antes, com a saída real colada |
| **O risco** | O que pode quebrar, e o que fica sem cobertura |

Um PR que descreve o problema em uma linha e cola a saída de um teste novo vale mais do que um
PR com três paragrafos de contexto e nenhum comando.

---

## Regras de código

### Vocabularios fixos não são extensiveis num PR de feature

Fases, modos, ciclos, motivos tipados de gate, ações de retry, classes de falha do POSTMORTEM,
famílias de lease e o contrato do MASTER log são **contratos**. Mudar um deles é uma mudança de
contrato, e ela precisa do próprio PR, com a justificativa separada.

Se você precisou de um motivo de gate novo para resolver o seu problema, isso é um sinal
interessante e vale conversar antes de codar.

### Dependências de runtime contadas

O núcleo tem quatro dependências de runtime, todas com versão fixa: `@modelcontextprotocol/sdk`
(servidor MCP), `zod` e `zod-to-json-schema` (esquemas dos contratos) e `smol-toml`
(leitura da configuração TOML do Codex). Todo o resto é Node.js e git.

Dependência nova é decisão de produto: abra uma issue antes. A regra `RU3` do próprio pack de
auditoria existe para pegar exatamente esse caso ("dependência nova para fazer o que a stack já
instalada faz").

### Sem número inventado

Onde a medida não existe, escreva `unavailable` e não decida por ela. Nunca substitua uma
lacuna por zero, por estimativa não declarada, ou por um valor plausível. Esta regra tem teste
(`fx-schema-drift`) e ela é o coração do produto.

### Idioma

Código, comentários, mensagens de commit, labels de CLI e documentação seguem o português do
Brasil, **sem travessão longo** (o caractere U+2014). O CLI é autodocumentado no mesmo idioma.

---

## Skills

Uma skill fina vive em `skills/<familia>/<nome>/SKILL.md` e tem corpus próprio em
`eval/casos/<nome>.json`.

> **Skill sem corpus não entra no catálogo.**

O corpus atual: 17 skills, 87 casos, 174 assercoes. Uma skill nova sem casos é uma instrução que
ninguém sabe se funciona, e o projeto já tem um produto inteiro dedicado a não aceitar isso.

```bash
node dist/index.js eval --skill <nome>
```

---

## Este projeto se conduz com ele mesmo

Uma contribuição aceita não é mergeada na mão. Ela entra pelo ciclo:

```bash
ork thread new "aplicar o PR #NN" --ciclo merge-branch --branch pr-NN --modo classic
```

Ela passa por GOAL, PLAN, GO, CHECK, SHIP e MASTER, recebe score de 0 a 5, e o ledger da thread
fica publicado. Isso significa duas coisas para você:

1. Pode demorar mais do que um merge comum, principalmente se a baseline do seu PR for
   desconhecida.
2. O que aconteceu com a sua contribuição fica registrado, incluindo o que reprovou e por quê.

Quando a entrega sai pelo próprio PR (o CI independente verde no SHA exato e o merge com o
assunto `ship(<thread>): ...`), o mantenedor registra a entrega na thread e fecha o ciclo:

```bash
ork ship registrar-pr <thread>     # o merge no remoto e o CI verde viram ship_done
ork master --aceitar-omissao       # a entrega fecha pelo MASTER; a nota humana sobrescreve
```

---

## Publicar uma versão (mantenedores)

A publicação no npm sai do CI, nunca de uma máquina: o workflow
[`publicar.yml`](.github/workflows/publicar.yml) usa Trusted Publishing, sem token nem senha.

1. A versão nova entra na `main` por PR: `version` em `core/package.json` e a seção dela no
   [CHANGELOG](CHANGELOG.md). A versão do `ork` sai do `package.json`.
2. Com o CI verde na `main`, crie a tag no commit do merge: `git tag v0.3.0 <sha>` e
   `git push origin v0.3.0`.
3. O workflow confere que a tag bate com o `package.json` e está na `main`, roda os canários e
   publica. Confira com `npm view @orkastery/cli version`.

---

## Reportando um bug

Abra uma issue com:

- o comando exato que você rodou;
- a saída real (não a descrição dela);
- a saída de `ork doctor`, que diz o que vale na sua máquina;
- o que você esperava.

Bug de documentação vale issue tanto quanto bug de código. Se o README diz que algo funciona e
na sua máquina não funciona, isso é um defeito do projeto, não um mal-entendido seu.

---

## Segurança

Não abra issue pública para vulnerabilidade. Ver [SECURITY.md](SECURITY.md).
