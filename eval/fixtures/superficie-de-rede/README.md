# fixtures/superficie-de-rede

Tres servidores DELIBERADAMENTE vulneraveis (Express, FastAPI e gin), usados como alvo real
da varredura deterministica de superficie de ataque de rede do pack `security-privacy`
(regras SP8..SP12, extensao do bloco B5).

Nao sao codigo de producao, nao entram em build nenhum e nao sao importados por nada. Eles
existem para que `ork audit surface` tenha, dentro do proprio repositorio, uma superficie
com defeito conhecido para achar:

```bash
node core/dist/index.js audit surface eval/fixtures/superficie-de-rede
```

| Arquivo | O que ele publica de errado |
|---|---|
| `api-express.js` | CORS global com credenciais (SP11), console de admin e swagger abertos (SP9), rota de dado pessoal sem guarda (SP8) e sem esquema (SP12), `/login` sem limite de taxa (SP10) |
| `api_fastapi.py` | metricas internas expostas (SP9), criacao de pedido sem guarda (SP8) e sem modelo de entrada (SP12) |
| `api_gin.go` | `pprof` aberto (SP9), cobranca alterada por payload cru (SP8, SP12) |

Corrigir estes arquivos NAO e o objetivo: eles sao o gabarito. Se a varredura parar de achar
o que esta na tabela acima, quem regrediu foi a varredura.
