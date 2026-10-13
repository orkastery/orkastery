#!/bin/sh
# RM-026 K7 (fatia 3): ork_conhecimento_mostrar, a mesma tool do MCP e do OpenClaw. Um documento pelo id (doc-...),
# com o corpo, a versao, a fonte e as referencias conferidas, e as lacunas tipadas, no JSON do nucleo
# (`ork conhecimento mostrar <doc-id> --json`). Somente leitura; o Hermes transporta o JSON como vem: lacuna e lacuna,
# nunca resposta. Argumentos continuam dados: <doc-id> [--projeto <nome>].
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Sem --projeto <nome> (que passa em "$@"), o
# nucleo usa o unico projeto conhecido da maquina ou devolve a escolha. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
# O --json vai no fim: com ele antes, o parser do CLI leria o id como o valor de --json.
exec "${ORK_BIN:-{{ork_bin}}}" conhecimento mostrar "$@" --json
