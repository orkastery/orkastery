#!/bin/sh
# RM-048 (item 7): o status report unico do roadmap, montado pelo nucleo. Somente leitura; o Hermes
# transporta o texto como vem, sem reescrever. Argumentos continuam dados.
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
exec "${ORK_BIN:-{{ork_bin}}}" roadmap status "$@"
