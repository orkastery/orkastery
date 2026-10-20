---
name: security-remediation
description: "Correcao de achado do security scan no GO: corrige so o achado triado como real, exige rotacao declarada para segredo, sobe dependencia para a menor versao corrigida e prova pelo scan reexecutado. Roteia para ork fix e ork security-scan."
bucket: phases
roteia: "ork fix open | ork fix reverify | ork security-scan"
license: MIT
---

# Remediacao de seguranca

## O que esta skill e

Um roteador fino para a correcao que nasce de um achado `new` do laco do `ork security-scan`, depois que o `security-auditor` o triou como real. Ela vale so com `verify.security_scan` declarado e roda dentro do GO, na worktree da thread, com a conduta de [go-implementation](../go-implementation/SKILL.md).

## Como rotear

```bash
ork fix open <thread>
ork security-scan
ork fix reverify <thread>
ork decisao registrar <thread> ...
```

## O que a remediacao entrega

1. **So o achado.** A correcao muda o que o achado aponta (regra, `arquivo:linha`) e nada ao redor: refatoracao vizinha e scope creep, e esconde a correcao dentro do diff.
2. **Segredo sai do codigo E tem rotacao declarada.** Remover do arquivo nao desfaz o vazamento (`SEC 2`): o historico nao e limpo por corrigir o codigo. A correcao so fecha com a rotacao declarada ao dono da credencial, com data, e verificada, nao prometida. O valor do segredo nunca vai ao relatorio, ao commit ou ao prompt.
3. **Dependencia sobe para a menor versao corrigida**, a que o relatorio indica, com a justificativa da escolha no commit. Pular para a ultima traz mudanca que ninguem pediu.
4. **A prova e o scan reexecutado.** A prova e o scan reexecutado por `ork fix reverify`, que o `ork` roda no HEAD real; o relato do agente de que "corrigiu" nao e prova. O achado precisa sair do relatorio novo, e nenhum `new` pode ter entrado.
5. **Dispensa e correcao tipo A**, e so quando o triador classificou falso positivo. A entrada vai ao `.ork-security/dismissals.json` com `fingerprint`, `tool`, `rule`, `file`, `reason`, `decidedBy`, `decisionRef` (a referencia da decisao registrada com `ork decisao registrar`) e `date`; sem motivo e sem decisao registrada, a config e invalida e o scan sai 1.
6. **Arquivo excluido nao se corrige.** Achado em caminho que a config do scan exclui volta a triagem: ou o achado e de outro arquivo, ou a exclusao e que esta errada, e mudar a exclusao e decisao registrada, nao atalho.

## O que o nucleo verifica por voce

O `ork security-scan` sai 1 com achado `new` no laco (todo segredo novo; dependencia, SAST, IaC e workflow novos em `high` ou `critical`) e com dispensa invalida. `ork fix reverify` da o veredito por correcao e recusa reexecucao parcial depois de tipo B. Ferramenta `unavailable` ou `failed` nunca conta como limpa.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Tirei o segredo do codigo, esta resolvido" | O segredo continua valido e continua no historico. Falta a rotacao declarada ao dono e verificada. |
| "Ja que estou aqui, arrumo o resto do arquivo" | A correcao e so do achado. O resto vira proposta, com tarefa e commit proprios. |
| "Subo para a versao mais nova, e mais seguro" | A menor versao corrigida, com justificativa. A mais nova traz mudanca que ninguem avaliou. |
| "Funcionou aqui, o achado deve ter sumido" | A prova e o scan reexecutado, nao a impressao de quem corrigiu. |
| "E falso positivo, dispenso e pronto" | Dispensa exige a triagem, o motivo e a decisao registrada. Sem eles a config fica invalida. |

## Bandeiras vermelhas

- Segredo removido do arquivo sem rotacao declarada ao dono.
- Correcao fechada sem `ork fix reverify` e sem scan novo.
- Diff com mudanca que nao e o achado.
- Dependencia que pulou varias versoes sem justificativa.
- Entrada em `.ork-security/dismissals.json` sem `reason` ou sem `decisionRef`.
- Valor de segredo colado no commit, no relatorio ou no prompt.

## Verificacao antes de sair da correcao

Diff restrito ao achado, rotacao declarada quando era segredo, versao justificada quando era dependencia, entrada de dispensa completa quando era tipo A, e o `ork fix reverify` verde com o achado fora do relatorio novo. Ver `SEC 1`, `SEC 2` e `SEC 10`.
