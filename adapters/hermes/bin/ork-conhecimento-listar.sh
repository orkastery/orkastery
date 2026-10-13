#!/bin/sh
# RM-026 K7 (fatia 3): ork_conhecimento_listar, a mesma tool do MCP e do OpenClaw. Os documentos validos da pasta
# conhecimento.dir, com a versao e a fonte, e as lacunas tipadas, no JSON do nucleo (`ork conhecimento listar --json`).
# Somente leitura; o Hermes transporta o JSON como vem: lacuna e lacuna, nunca resposta.
# Argumentos continuam dados: [--colecao <nome>] [--projeto <nome>].
set -eu
# A tool do modelo nao herda a autoridade da callback humana, como no rodarOrk do OpenClaw: a consulta do
# conhecimento nao usa recibo, e o memory.cli que o manifesto escolhe (P6) nunca recebe chave do HITL.
for nome in $(env | sed -n 's/^\(ORK_HITL_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$nome"; done
unset ORK_RECEIPT_VERIFIERS
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Sem --projeto <nome> (que passa em "$@"), o
# nucleo usa o unico projeto conhecido da maquina ou devolve a escolha. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" conhecimento listar "$@" --json
