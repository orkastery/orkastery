#!/bin/sh
# RM-048 (item 7): o status report unico do roadmap, montado pelo nucleo. Somente leitura; o Hermes
# transporta o texto como vem, sem reescrever. Argumentos continuam dados.
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Sem --projeto <nome> (que passa em "$@"), o
# nucleo usa o unico projeto conhecido da maquina ou devolve a escolha. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" roadmap status "$@"
