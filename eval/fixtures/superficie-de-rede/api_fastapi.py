# Fixture DELIBERADAMENTE vulneravel (SP8..SP12), sem valor de producao.
from fastapi import FastAPI, Request

app = FastAPI()


# SP9: metricas de cluster expostas sem restricao de rede.
@app.get("/internal/metrics")
async def metricas():
    return coletar_metricas()


# SP8 + SP12: cria pedido a partir do corpo cru, sem guarda e sem modelo de entrada.
@app.post("/pedidos")
async def criar_pedido(request: Request):
    corpo = await request.json()
    return salvar_pedido(corpo)
