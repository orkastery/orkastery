#!/usr/bin/env bash
# Varredura de cinco minutos. O núcleo consulta, deduplica e entrega sem LLM.
# Configure .orkastery/monitor/pulse-host.json com executável e argumentos do host.
set -euo pipefail
export PATH="${ORK_PULSE_RUNTIME_BIN:-$HOME/.local/bin}:$PATH"
ORK_PULSE_RAIZ="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ORK_PULSE_RAIZ/core/dist/pulse-delivery.js" ]; then
  ORK_PULSE_ALVO="${ORK_PULSE_PROJECT:-$ORK_PULSE_RAIZ}"
else
  ORK_PULSE_ALVO="${ORK_PULSE_PROJECT:-$PWD}"
fi
# Candidatos do projeto alvo. Versao legada ou rebuild sozinhos nunca autorizam escrita.
# O recibo de ork activation, validado pelo runtime atual, concede o escopo efetivo.
ORK_PULSE_ESCOPO_ARQUIVO="$ORK_PULSE_ALVO/monitor/pulse-write-scope.json"
if [ -e "$ORK_PULSE_ESCOPO_ARQUIVO" ] || [ -L "$ORK_PULSE_ESCOPO_ARQUIVO" ]; then
  ORK_PULSE_ESCOPO_CONFIGURADO="$(node "$ORK_PULSE_RAIZ/monitor/pulse-scope.cjs" "$ORK_PULSE_ESCOPO_ARQUIVO")"
  if [ -n "${ORK_PULSE_WRITE_SCOPE+x}" ] && [ "$ORK_PULSE_WRITE_SCOPE" != "$ORK_PULSE_ESCOPO_CONFIGURADO" ]; then
    echo 'pulse.scope.conflict: ambiente diverge da allowlist duravel' >&2
    exit 1
  fi
  export ORK_PULSE_WRITE_SCOPE="$ORK_PULSE_ESCOPO_CONFIGURADO"
fi
if [ -f "$ORK_PULSE_RAIZ/core/dist/pulse-delivery.js" ]; then
  exec node "$ORK_PULSE_RAIZ/core/dist/pulse-delivery.js" "$ORK_PULSE_ALVO"
fi
# No pacote npm, dist/ fica ao lado de monitor/. O projeto é o cwd do chamador.
exec node "$ORK_PULSE_RAIZ/dist/pulse-delivery.js" "$ORK_PULSE_ALVO"
