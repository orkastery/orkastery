#!/bin/sh
# RM-026 K7 (fatia 3): ork_conhecimento_colecoes, a mesma tool do MCP e do OpenClaw. As colecoes e os documentos de
# cada uma, e as lacunas tipadas, no JSON do nucleo (`ork conhecimento colecoes --json`). Somente leitura; o Hermes
# transporta o JSON como vem: lacuna e lacuna, nunca resposta. Argumentos continuam dados: [--projeto <nome>].
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Sem --projeto <nome> (que passa em "$@"), o
# nucleo usa o unico projeto conhecido da maquina ou devolve a escolha. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" conhecimento colecoes "$@" --json
