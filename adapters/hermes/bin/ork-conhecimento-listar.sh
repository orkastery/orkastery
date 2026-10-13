#!/bin/sh
# RM-026 K7 (fatia 3): ork_conhecimento_listar, a mesma tool do MCP e do OpenClaw. Os documentos validos da pasta
# conhecimento.dir, com a versao e a fonte, e as lacunas tipadas, no JSON do nucleo (`ork conhecimento listar --json`).
# Somente leitura; o Hermes transporta o JSON como vem: lacuna e lacuna, nunca resposta.
# Argumentos continuam dados: [--colecao <nome>] [--projeto <nome>].
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Sem --projeto <nome> (que passa em "$@"), o
# nucleo usa o unico projeto conhecido da maquina ou devolve a escolha. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" conhecimento listar "$@" --json
