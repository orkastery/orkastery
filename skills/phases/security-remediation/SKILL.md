---
name: security-remediation
description: "Correcao de achado do security scan no GO: corrige so o achado triado como real, exige rotacao declarada para segredo, sobe dependencia para a menor versao corrigida e prova pelo scan reexecutado. Roteia para ork fix e ork security-scan."
bucket: phases
roteia: "ork fix open | ork fix list | ork claims verificar | ork fix reverify | ork security-scan"
license: MIT
---

# Remediacao de seguranca

## O que esta skill e

Um roteador fino para a correcao que nasce de um achado `new` do laco do `ork security-scan`, depois que o `security-auditor` o triou como real. Ela vale so com `verify.security_scan` declarado e roda dentro do GO, na worktree da thread, com a conduta de [go-implementation](../go-implementation/SKILL.md).

## Como rotear

```bash
ork fix open <thread>
ork fix list <thread>
git ls-remote --heads <remoto> <branch>
ork security-scan
ork claims verificar <thread> <claim> --comando "<comando>"
ork fix reverify <thread>
ork decisao registrar <thread> ...
```

## O que a remediacao entrega

1. **So o achado.** A correcao muda o que o achado aponta (regra, `arquivo:linha`) e nada ao redor: refatoracao vizinha e scope creep, e esconde a correcao dentro do diff.
2. **Segredo sai do codigo E tem rotacao declarada.** Remover do arquivo nao desfaz o vazamento (`SEC 2`): o historico nao e limpo por corrigir o codigo. A correcao so fecha com a rotacao declarada ao dono da credencial, com data, e verificada, nao prometida. O valor do segredo nunca vai ao relatorio, ao commit ou ao prompt.
   - **Quem corrige tambem nunca imprime o valor.** A regra do auditor vale no GO: a linha do achado, as vizinhas e o commit que a trouxe nao vao a saida da sessao por ferramenta nenhuma (Read, `sed -n`, `head`, `cat`, `grep -n`, editor, `git show`, `git log -p`, diff). Edite sem ler, pelo numero do relatorio: apague a linha (`sed -i '<n>d' <arquivo>`) ou troque-a inteira (`sed -i '<n>s/.*/<substituto>/' <arquivo>`, com o substituto lendo a credencial do ambiente ou do cofre, nunca com o valor). Segredo de varias linhas (chave PEM): o fim do bloco sai so como numero (`command grep -n -- '-----END' <arquivo> | cut -d: -f1`) e o intervalo se apaga com `sed -i '<n>,<m>d' <arquivo>`. Confira pelo scan, nao pelo olho: o `fingerprint` do achado sai do relatorio novo. Na reescrita do historico abaixo, refaca os commits pelo mesmo caminho, sem `git diff` nem `git show` do commit do segredo.
   - **Segredo que entrou na thread sai do historico da thread.** O Gitleaks varre os commits de `<base>..HEAD`, e o achado continua `new` enquanto um commit da thread carregar o valor. Nunca so apague a linha num commit novo. Com a branch da thread fora de todo remoto (`git ls-remote --heads <remoto> <branch>` sai 0 e vazio para cada `git remote`; saida diferente de 0 e duvida, nao ausencia), reescreva so os commits da thread a partir do que trouxe o segredo: `git reset --soft <commit anterior ao segredo>`, com o alvo na base da thread ou depois dela (`git merge-base --is-ancestor <base> <alvo>`), e os commits de novo sem o valor, sem `push --force`. Reescrever commit ainda nao publicado da thread e o caminho que o metodo ja usa, e o `ork ship publicar` empurra sem forca: historia reescrita que ja estivesse publicada seria recusada no push de qualquer jeito.
   - **Branch ja publicada nao se reescreve.** O achado continua `new`, porque o commit segue em `<base>..HEAD`. A rotacao declarada e verificada continua obrigatoria, e a saida e uma dispensa que cita a rotacao declarada, decidida pelo dono: o achado volta ao CHECK como inconclusivo e, com a resposta, vira tipo A como qualquer dispensa.
3. **Dependencia sobe para a menor versao corrigida**, a que o relatorio indica, com a justificativa da escolha no commit. Pular para a ultima traz mudanca que ninguem pediu.
4. **A prova e o scan reexecutado.** A prova e o scan reexecutado por `ork fix reverify`, que o `ork` roda no HEAD real; o relato do agente de que "corrigiu" nao e prova. O achado precisa sair do relatorio novo, e nenhum `new` pode ter entrado. **O scan le so o HEAD commitado:** a arvore varrida e um checkout do commit HEAD, entao correcao, entrada de dispensa ou config ainda nao commitada e invisivel para ele. Commite antes de reexecutar.
5. **Dispensa e correcao tipo A**, e so quando o triador classificou falso positivo. A entrada vai ao `.ork-security/dismissals.json` com `fingerprint`, `tool`, `rule`, `file`, `reason`, `decidedBy`, `decisionRef` (a referencia da decisao registrada com `ork decisao registrar`) e `date`; sem motivo e sem decisao registrada, a config e invalida e o scan sai 1.
6. **Arquivo excluido nao se corrige.** Achado em caminho que a config do scan exclui volta a triagem: ou o achado e de outro arquivo, ou a exclusao e que esta errada, e mudar a exclusao e decisao registrada, nao atalho.
7. **Uma correcao por achado.** A spec do `ork fix open` traz, ao lado da correcao do comando `security_scan`, uma correcao por claim do CHECK, com o tipo e o texto do veredito (`ork fix list <thread>`): tipo B para o real, tipo A para o falso positivo. O tipo A fecha com a entrada de dispensa e com o comando que a prova anexado a claim (`ork claims verificar <thread> <claim> --comando "<comando>"`); a claim do real reprova e passa com o scan inteiro, entao o tipo B fecha quando o scan reexecutado sai sem achado `new` do laco, nao so quando este `fingerprint` some.

## O que o nucleo verifica por voce

O `ork security-scan` sai 1 com achado `new` no laco (todo segredo novo; dependencia, SAST, IaC e workflow novos em `high` ou `critical`) e com dispensa invalida. `ork fix reverify` da o veredito por correcao e recusa reexecucao parcial depois de tipo B. Ferramenta `unavailable` ou `failed` nunca conta como limpa.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Tirei o segredo do codigo, esta resolvido" | O segredo continua valido e continua no historico. Falta a rotacao declarada ao dono e verificada. |
| "Apaguei a linha num commit novo, o achado sai" | O Gitleaks varre `<base>..HEAD`: o commit antigo ainda carrega o valor e o achado continua `new`. Reescreva o historico nao publicado da thread e declare a rotacao. |
| "Ja que estou aqui, arrumo o resto do arquivo" | A correcao e so do achado. O resto vira proposta, com tarefa e commit proprios. |
| "Subo para a versao mais nova, e mais seguro" | A menor versao corrigida, com justificativa. A mais nova traz mudanca que ninguem avaliou. |
| "Funcionou aqui, o achado deve ter sumido" | A prova e o scan reexecutado, nao a impressao de quem corrigiu. |
| "E falso positivo, dispenso e pronto" | Dispensa exige a triagem, o motivo e a decisao registrada. Sem eles a config fica invalida. |

## Bandeiras vermelhas

- Segredo removido do arquivo sem rotacao declarada ao dono.
- Segredo da thread corrigido so por commit novo, com o commit que o trouxe ainda em `<base>..HEAD`.
- `push --force` para limpar o historico de branch publicada.
- Correcao fechada sem `ork fix reverify` e sem scan novo.
- Diff com mudanca que nao e o achado.
- Dependencia que pulou varias versoes sem justificativa.
- Entrada em `.ork-security/dismissals.json` sem `reason` ou sem `decisionRef`.
- Valor de segredo colado no commit, no relatorio ou no prompt.
- Linha do segredo lida ou impressa para editar (Read, `sed -n`, `cat`, `git show`) em vez da edicao pelo numero.
- Scan reexecutado com a correcao ou a dispensa ainda fora de commit.

## Verificacao antes de sair da correcao

Diff restrito ao achado, rotacao declarada e historico da thread sem o commit do segredo quando era segredo, versao justificada quando era dependencia, entrada de dispensa completa quando era tipo A, e o `ork fix reverify` verde com o achado fora do relatorio novo. Ver `SEC 1`, `SEC 2` e `SEC 10`.
