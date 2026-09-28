#!/usr/bin/env bash
# Executar às sextas; falha de envio pode ser repetida sem repetir páginas confirmadas.
set -euo pipefail
ORK_DIGEST_RAIZ="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$ORK_DIGEST_RAIZ"
exec node core/dist/index.js master digest enviar
