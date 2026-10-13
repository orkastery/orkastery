#!/bin/sh
# RM-054 (fatia 3): as maquinas da pessoa na Orkastery Network (RM-053), montadas pelo nucleo
# (`ork network status`): a casa, a batida de cada maquina, forjas, runtimes, hosts e projetos, a
# fonte e as lacunas. Somente leitura; o Hermes transporta o texto como vem. Argumentos continuam dados.
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao e projeto. Com ORK_PROJETO_EXPLICITO=1 o nucleo nao le o projeto
# do diretorio do gateway; a rede vem da casa, do registro e dos retratos. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" network status "$@"
