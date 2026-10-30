# Contrato do verify assíncrono no MCP

O MCP não mantém uma chamada aberta enquanto a suíte roda. `ork_verify` inicia a rodada no
processo do servidor, devolve o UUID imediatamente e `ork_verify_status` consulta o estado.
O worker chama o mesmo `verificar` do CLI, no mesmo HEAD e sob a mesma fila pesada.

## Ferramentas

```json
{"tool":"ork_verify","arguments":{"threadId":"ork-exemplo"}}
```

A resposta segue `ork.verify-mcp/v1` e contém `rodadaId`, `threadId`, vínculo de `despacho`,
`estado`, `lane`, `criadaEm` e `atualizadaEm`. `reutilizada` é `true` quando já havia uma
rodada viva para a thread. O modelo não fornece raiz, comando, PID, prazo ou lease.

```json
{"tool":"ork_verify_status","arguments":{"threadId":"ork-exemplo","rodadaId":"00000000-0000-4000-8000-000000000000"}}
```

`rodadaId` precisa ser UUID e pertencer à mesma thread. A consulta é somente leitura: ela
não inicia, não repete e não altera o veredito.

## Máquina de estados

| Estado | Significado |
| --- | --- |
| `na-fila` | Espera a fila pesada; `lane` é `fila-pesada` e `ocupantes` pode identificar quem segura a vez |
| `rodando` | O verify canônico executa a `lane` informada, como preparo, claim ou comando do manifesto |
| `concluido` | `veredito` contém `ok`, `commit`, `motivos`, modo do CHECK, texto e `resultado` completos do CLI |
| `falhou` | A infraestrutura não produziu veredito; `falha.motivo` é tipado e o resultado nunca é verde |

Falhas tipadas de infraestrutura são `verify.processo-morto`, `verify.worker-failed` e
`verify.lease-perdida`. As recusas canônicas `fila-pesada.ocupada` e
`conducao.em-andamento` preservam em `falha.recusa` o contrato completo que o CLI devolve.
Um processo morto é projetado assim pela consulta; uma nova inicialização reconcilia e
libera somente a lease exata da rodada anterior.

## Idempotência, fila e prazos

Uma rodada viva por thread é o máximo: repetir `ork_verify` devolve o mesmo `rodadaId`.
O worker adquire `worktree-write:<thread>` antes de nascer e espera a fila definida por
`concurrency.max_parallel_heavy`, por no máximo 20 s. Se a vez não chegar, o status terminal
devolve `ork.fila-pesada-recusa/v1` e libera a lease da worktree. Cada comando usa
`verify.timeout_ms_por_comando` e depois `verify.timeout_ms`; no manifesto deste projeto,
`test` tem 2.400 s. O transporte MCP não impõe o antigo teto total de 180 s.

O cliente deve consultar aproximadamente a cada 30–60 s, conservar só estado e lane durante
a espera e consumir o payload completo uma vez, no terminal. Um veredito concluído com
`ok: false` é resposta MCP de erro, mas preserva todo o resultado para o CHECK.

## Fronteiras de segurança

- o servidor fixa projeto, thread, host e despacho; argumentos não escolhem filesystem ou shell;
- estado e ponteiro ativo são gravados atomicamente sob a thread, com arquivos regulares do
  usuário, sem symlink/hard link e com limite de 16 MiB;
- o processo é identificado por PID e instante de início em `/proc`, quando disponível;
- o worker valida sua identidade e a lease antes de executar;
- a ferramenta de status é grant de consulta; iniciar continua restrito ao perfil `worktree`;
- o veredito vem do `verificar` canônico, não de self-report da sessão.

## Equivalência

Para o mesmo HEAD, claims, manifesto e modo do CHECK, `veredito.resultado` é o
`ResultadoVerify` do CLI e `veredito.texto` usa o mesmo renderer. O teste hermético cobre
início/consulta, fila ocupada, repetição, morte real do worker e igualdade do veredito no
mesmo HEAD (`core/test/mcp-verify-async.test.ts`).
