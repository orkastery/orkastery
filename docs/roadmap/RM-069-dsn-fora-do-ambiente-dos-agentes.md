---
id: RM-069
tipo: roadmap
titulo: DSN com senha fora do ambiente dos agentes
categoria: melhoria
pai: null
features: [FEAT-017]
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 780eca0
    pr: "#189"
  testes:
    resolvedor: core/test/dsn-da-memoria.test.ts (DM1 a DM29 e DR1 a DR9)
    doctor: core/test/dsn-doctor.test.ts (DD1 a DD13)
    saida: core/test/dsn-saida.test.ts (DS1 a DS5) e core/test/mutantes/dsn-da-memoria.json (M1 a M15)
  deploy:
    release: v0.6.0, @orkastery/cli no npm (memory.database_url_file)
sdlc:
  thread: ork-dsnforadoamb
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-069: DSN com senha fora do ambiente dos agentes

> **Em uma frase:** o `ork` lê a DSN da memória de um arquivo `0600` do dono em `~/.orkastery/segredos/`, para o host deixar de exportá-la e nenhuma sessão de agente ter a senha do banco em `env`.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

**Decisão do dono de 20/10/2026 (opção 4a):** as DSNs saem do ambiente herdado pelos agentes e o `ork` passa a ler do cofre. A rotação das senhas (opção 4b) não faz parte deste item.

## Problema e resultado

- **Público e problema/oportunidade:** quem roda o `ork` com a memória no OrkMind e despacha agentes por um host que repassa o próprio ambiente às sessões. O gateway do Hermes carrega o arquivo de ambiente dele (`~/.hermes/.env`) e passa as variáveis a tudo o que dispara: os daemons do `claude` de cada conta, as sessões reserva, o observador de sessão e o `ork mcp serve`. Toda sessão despachada herdava a DSN com senha.
- **Evidências e fonte:** uma sessão de agente rodou `env | grep` e duas URLs de banco com senha entraram na transcrição e no contexto do modelo. Depois, `env | cut -d= -f1` dentro de outra sessão despachada listou, só pelo nome, as duas variáveis com DSN ao lado de `ORK_DISPATCH_ID` e `ORK_DISPATCH_THREAD`. O núcleo só sabia ler a DSN do ambiente (`memory.database_url_env`, em `core/src/orkmind.ts`, no cliente e na migração do Company Brain e no `ork doctor`), então tirar a variável do host derrubava a memória.
- **Objetivo/OKR:** a DSN sai do ambiente que os agentes herdam; o `ork` a lê de um arquivo do dono no momento do uso, e ela continua indo só ao processo filho do `orkmind`.
- **Hipótese:** se o `ork` ler a DSN de um arquivo `0600` na pasta de segredos e o host deixar de exportá-la, então nenhuma sessão despachada a terá em `env`, porque a DSN passa a existir só no arquivo e no ambiente do processo filho do `orkmind`.
- **Métrica principal / linha de base / meta / janela / fonte:** variáveis com DSN no ambiente de uma sessão despachada, contadas pelo nome. Linha de base, na abertura do item: 2. Meta: 0 depois da migração da máquina. Fonte: o check `DSN no ambiente` do `ork doctor` rodado dentro da sessão despachada e a contagem em `/proc/<pid>/environ` de cada processo de agente, feita na migração (contagem, nunca valor).
- **Métricas de proteção:** a memória continua ligada (`ork memory status` com regime efetivo `orkmind`); nenhum valor de DSN em saída, erro, ledger ou bundle; quem continua com `memory.database_url_env` não muda de comportamento, fora a barreira de saída, que vale nas duas fontes.

## Escopo e validação

- **Incluído:**
  - **Fonte de arquivo:** `memory.database_url_file` no manifesto, com o caminho e nunca o valor. Só vale a forma `~/.orkastery/segredos/<nome>`, na pasta do usuário do `ork` (que segue `ORKASTERY_HOME` e `ORK_USUARIO_DIR`). O arquivo é comum, do usuário que roda o `ork`, com permissão `0600` ou `0400` exata (bits especiais não passam), até 4 KiB e uma linha só com a DSN (`esquema://...`, em UTF-8, sem espaço nem caractere de controle), sem a forma `NOME=valor`. A pasta do usuário do `ork` sai do caminho real da casa do usuário (`HOME`): vinda de `ORK_USUARIO_DIR` ou `ORKASTERY_HOME`, só vale como caminho absoluto sem `..`, dentro da casa e pasta do próprio usuário. Nenhuma pasta da casa até o arquivo pode ser link simbólico, nem o arquivo: o `ork` confere cada uma pelo `lstat` e o caminho real antes de abrir, e fora dessa regra recusa sem abrir nada. O que fica acima da casa é do sistema e vale pelo caminho real. É lido a cada uso.
  - **Uma fonte só:** `memory.database_url_env` e `memory.database_url_file` são exclusivos, e o `ork` nunca cai de uma para a outra.
  - **Resolvedor único:** o driver do OrkMind, o cliente do Company Brain, a migração do Brain e o check da chave de embedding leem a DSN pelo mesmo resolvedor; a DSN vai só ao ambiente do filho (`ORKMIND_DATABASE_URL`).
  - **Degradação tipada:** arquivo ausente, inseguro ou inválido leva ao regime `files` com `dsn.arquivo-ausente`, `dsn.arquivo-inseguro` ou `dsn.arquivo-invalido` e a correção, sem o valor.
  - **`ork doctor`:** o check `fonte da DSN` diz a variável pelo nome ou o arquivo pelo caminho com `~`, nunca o valor; o check `DSN no ambiente`, numa sessão despachada, lista pelo nome as variáveis com a DSN do projeto ou com URL com senha.
  - **`ork memory status`:** mostra a fonte de arquivo.
  - **Barreira de saída:** a resposta do processo filho (o cliente e a migração do Company Brain e o driver do OrkMind) que repete a DSN ou a senha dela, de qualquer tamanho, é recusada inteira com `brain.transport.secret`, `brain.migration.secret` ou `memory.transport.secret`, sem o valor, nas duas fontes; nenhuma saída do `ork doctor` ou do `ork memory status` a repete. Custo (D20): com senha curta ou comum, o `ork` também recusa a resposta legítima que tiver o mesmo trecho, e o check `DSN no ambiente` acusa mais variáveis; a barreira prefere a recusa ao vazamento, então use senha longa e aleatória.
- **Fora de escopo:** a migração de cada máquina (abaixo, feita por quem opera a máquina); o agente do Infisical renderizando o arquivo (limite declarado, sem código: o agente pode gravar em `~/.orkastery/segredos/<nome>` com `0600` e o `ork` lê igual); a rotação das senhas; isolamento por outro usuário ou por um intermediário; a varredura do prompt por URL com senha; Windows, onde a conferência de dono e de modo não existe e o arquivo é recusado.
- **Limite:** o agente roda com o mesmo usuário do dono e pode ler um arquivo `0600` dele. O ganho é que a senha deixa de aparecer em `env`, na transcrição e no contexto do modelo por acidente. Isolamento forte pediria outro usuário ou um intermediário.
- **Entregáveis e critérios de aceite:**
  - manifesto: a forma aceita e as recusadas, as duas fontes juntas reprovadas, nenhum erro com o valor;
  - resolvedor: cada recusa com o motivo certo, a da raiz e a do caminho antes de abrir o arquivo, e nenhum detalhe com o valor;
  - consumidores: com a fonte de arquivo, a DSN chega ao filho só em `ORKMIND_DATABASE_URL`;
  - `ork doctor` e `ork memory status`: a fonte dita sem o valor; numa sessão despachada, os nomes das variáveis com DSN;
  - barreira de saída: nenhuma resposta, erro ou saída dos consumidores repete a DSN ou a senha, com um mutante que desfaz cada correção;
  - cada critério com teste na suíte, com DSNs inventadas e ambiente injetado.
- **Migração de uma instalação** (feita por quem opera a máquina, depois de o `ork` com este item estar instalado):
  1. Atualize o `ork`: o `ork` sem este item não conhece `memory.database_url_file` e, sem `database_url_env`, cai para `files`.
  2. Crie a pasta e o arquivo sem passar a DSN pelo histórico do shell: `install -d -m 700 ~/.orkastery/segredos`, depois `(umask 077; cat > ~/.orkastery/segredos/<nome>)`, cole a DSN e feche com Ctrl-D.
  3. Troque `memory.database_url_env` por `memory.database_url_file: "~/.orkastery/segredos/<nome>"` no manifesto.
  4. Tire a variável do arquivo de ambiente do host (com backup). Um serviço que precise da DSN, como a API do OrkMind, a recebe pelo `EnvironmentFile` do próprio serviço, nunca pelo gateway que repassa o ambiente aos agentes.
  5. Reinicie o gateway do host.
  6. Confira: `ork memory status` com o regime `orkmind` e a fonte de arquivo; `ork doctor` dentro de uma sessão despachada sem variável com DSN; a contagem das variáveis em `/proc/<pid>/environ` de cada processo de agente (contagem, nunca o valor).
- **Piloto, medição e critérios de expansão/interrupção:** o piloto é a migração da máquina da fábrica, depois do merge. Expande com a release que levar o código. Interrompe se a memória cair para `files` sem motivo de arquivo ou se algum valor de DSN aparecer em saída, erro, ledger ou bundle.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** alta, pela decisão do dono acima, depois de uma credencial de banco entrar no contexto de um modelo.
- **Horizonte / alvo / previsão / confiança / marcos:** uma thread #Auto (GOAL, PLAN e GO na mesma sessão), CHECK independente em outro runtime, SHIP e a migração da máquina da fábrica depois do merge.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a migração depende do `ork` instalado com este item; nenhum bloqueio de outro item.
- **Premissas / riscos / mitigação:**
  - o manifesto vem do repositório: um caminho livre deixaria um clone apontar a DSN para qualquer arquivo `0600` do dono (chave SSH, credencial de nuvem) e mandá-lo ao `memory.cli` que o mesmo manifesto escolhe; mitigação: só a pasta de segredos do `ork` (veja a [fronteira de confiança](../referencia/fronteira-de-confianca.md));
  - a pasta do usuário vem do ambiente: `ORK_USUARIO_DIR` ou `ORKASTERY_HOME` apontados para fora da casa, com `..` ou por um link levariam a leitura para outro lugar; mitigação: a casa pelo caminho real, a raiz dentro dela e do próprio usuário, e cada pasta conferida até o arquivo (D24);
  - o valor vazar pela correção: nenhum texto repete a DSN, e o caminho sai sempre com `~`;
  - teste que lê o ambiente real: os testes injetam o ambiente e usam DSNs inventadas.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** G1 a G6 (fase GOAL), D1 a D13 (fase PLAN), D14 a D16 (GO), D17 a D23 (GO-FIX 1, depois do CHECK independente) e D24 e D25 (GO-FIX 2, depois da segunda rodada do CHECK; a D24 reverte a D17), da sessão da thread `ork-dsnforadoamb`, registradas no ledger dela por `ork decisao registrar`, com o que muda e o custo de reverter. As principais:
  - G1: Infisical como limite declarado, sem código;
  - G2: uma fonte só, sem fallback entre fontes;
  - G3: o arquivo só na pasta de segredos do `ork`;
  - G4: a regra do arquivo (dono, modo, sem link, tamanho, uma linha);
  - G5: os checks novos do doctor avisam e nunca reprovam;
  - G6: o detector de URL com senha só em sessão despachada;
  - D10: o manifesto deste repositório só troca de fonte na migração;
  - D24 (no lugar da D17): a pasta do usuário do `ork` pelo caminho real da casa, sem `..` nem link desde `HOME`, e cada pasta conferida até o arquivo, antes de abrir;
  - D25: as causas `raiz` e `dono-da-pasta`, e as correções que citam a casa;
  - D18 e D19: a permissão exata e o contrato inteiro do conteúdo, conferido antes de qualquer aparo;
  - D20 e D21: a senha de qualquer tamanho é fragmento, e a resposta do filho com ela ou com a DSN é recusada inteira; o custo é recusar também a resposta legítima com o mesmo trecho quando a senha é curta ou comum;
  - D22: a página sem data exata além da data da decisão do dono, fora o que o gerador escreve.

## Estado com evidências

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): `memory.database_url_file` declara a DSN por um arquivo da pasta de segredos do `ork`; quem segue com `memory.database_url_env` não muda. O guia é o [de memória e handoff](../guias/memoria-e-handoff.md), e a fronteira, a [de confiança](../referencia/fronteira-de-confianca.md).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `780eca0` · PR ##189 | 2026-10-27 | Julio |
| Testes | Aprovados | resolvedor: core/test/dsn-da-memoria.test.ts (DM1 a DM29 e DR1 a DR9) · doctor: core/test/dsn-doctor.test.ts (DD1 a DD13) · saida: core/test/dsn-saida.test.ts (DS1 a DS5) e core/test/mutantes/dsn-da-memoria.json (M1 a M15) | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0, @orkastery/cli no npm (memory.database_url_file) | 2026-10-27 | Julio |
| Exposição | Geral | — | 2026-10-27 | Julio |
| Habilitação | Concluída | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão da thread `ork-dsnforadoamb`; A: Julio; C: o CHECK independente; I: a condutora da fábrica.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** uma sessão #Auto fez GOAL, PLAN e GO, com as decisões registradas no ledger; o CHECK roda em outro runtime; o dono aprova a entrega pelo modo da thread.
- **Próxima ação, responsável e prazo:** a migração da máquina da fábrica para o arquivo, pela condutora; o CHECK, o SHIP e a versão 0.6.0 já passaram.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-20 | Decisão 4a do dono: o item abre, a DSN sai do ambiente dos agentes e o `ork` passa a ler um arquivo do dono | Credencial de banco no contexto de um modelo | Julio |
| 2026-10-27 | Em produção na 0.6.0: ciclo Disponível, exposição Geral (a chave vale para toda instalação que a declarar) e habilitação Concluída (o guia de memória e a fronteira de confiança saíram com a versão) | Tag `v0.6.0`, com o merge `780eca0` (PR #189) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
