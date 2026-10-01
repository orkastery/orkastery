#!/bin/sh
# RM-054 (fatia 2): o roadmap da rede, montado pelo nucleo (`ork network roadmap`): o status report
# com as threads de todas as maquinas, as reservas, a fonte e a hora de cada parte e as lacunas.
# Somente leitura; o Hermes transporta o texto como vem, sem reescrever. Argumentos continuam dados.
set -eu
export ORK_CANAL="${ORK_CANAL:-hermes}"
# RM-052 (D3): o cwd do gateway nao escolhe projeto. Com ORK_PROJETO_EXPLICITO=1 o nucleo aceita no
# --projeto (que passa em "$@") so o nome registrado ou a forja (github:dono/repo), e o projeto do
# diretorio do gateway so entra se estiver no registro. ORK_PROJETO_EXPLICITO=0 desliga.
export ORK_PROJETO_EXPLICITO="${ORK_PROJETO_EXPLICITO:-1}"
exec "${ORK_BIN:-{{ork_bin}}}" network roadmap "$@"
