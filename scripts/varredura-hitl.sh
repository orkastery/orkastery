#!/usr/bin/env bash
#
# varredura-hitl.sh: a rotina periodica do orquestrador para nao perder sessao travada.
#
# O INCIDENTE QUE ESTE SCRIPT EVITA (05/09/2026)
#   Uma sessao `claude --bg` da Factory ficou parada em `state: blocked` pedindo o codigo
#   2FA do `npm publish`. Ninguem soube: o orquestrador dependia de o humano perguntar, e
#   o `ork monitor` nao pegava porque aquela sessao nao tinha thread no ork.
#
# O QUE ELE FAZ
#   1. roda `ork sessions hitl --json`, que classifica TODAS as sessoes do runtime;
#   2. compara com a varredura anterior e imprime SO o que e novidade, para o aviso nao
#      virar ruido diario que o humano aprende a ignorar;
#   3. sai com codigo 10 quando ha novidade, 0 quando nao ha e 1 quando nao deu para
#      consultar o runtime. E o codigo que o cron e o orquestrador leem.
#
# O QUE ELE NAO FAZ, DE PROPOSITO
#   - nao responde prompt nenhum por conta propria: quem decide e o humano;
#   - nao mata sessao;
#   - nao grava nada dentro do projeto (o cache de "ja avisei" e do ORQUESTRADOR, e mora
#     em ~/.orkastery, nao no repositorio).
#
# USO
#   scripts/varredura-hitl.sh                 # so a novidade desde a ultima varredura
#   scripts/varredura-hitl.sh --repetir       # tudo que esta parado agora
#   scripts/varredura-hitl.sh --json          # o radar cru, para o orquestrador consumir
#   scripts/varredura-hitl.sh --ork <caminho> # aponta outro binario/dist do ork
#
# CRON (a cada 10 minutos, guardando o ultimo aviso):
#   */10 * * * * /caminho/scripts/varredura-hitl.sh >> ~/.orkastery/hitl.log 2>&1
#
set -euo pipefail

REPETIR=0
SO_JSON=0
ORK_BIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repetir) REPETIR=1 ;;
    --json) SO_JSON=1 ;;
    --ork) shift; ORK_BIN="${1:-}" ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "opcao desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

# O ork pode estar instalado, ou ser o dist deste repositorio.
if [ -z "$ORK_BIN" ]; then
  AQUI="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$AQUI/../core/dist/index.js" ]; then
    ORK_BIN="node $AQUI/../core/dist/index.js"
  elif command -v ork >/dev/null 2>&1; then
    ORK_BIN="ork"
  else
    echo "ork nao encontrado: instale o pacote ou rode npm run build em core/" >&2
    exit 1
  fi
fi

ESTADO_DIR="${ORKASTERY_HOME:-$HOME/.orkastery}"
CACHE="$ESTADO_DIR/hitl-avisado.json"
mkdir -p "$ESTADO_DIR"

RADAR="$($ORK_BIN sessions hitl --json --so-paradas 2>/dev/null || true)"
if [ -z "$RADAR" ]; then
  echo "[fail] nao deu para consultar o runtime: o radar HITL nao respondeu" >&2
  exit 1
fi

if [ "$SO_JSON" = "1" ]; then
  printf '%s\n' "$RADAR"
  exit 0
fi

# O diff e a formatacao do aviso ficam no node: ele ja e dependencia do ork, e assim o
# script nao depende de jq estar instalado na maquina.
printf '%s' "$RADAR" | REPETIR="$REPETIR" CACHE="$CACHE" node -e '
const fs = require("fs");
let bruto = "";
process.stdin.on("data", (c) => (bruto += c));
process.stdin.on("end", () => {
  const radar = JSON.parse(bruto);
  const cache = process.env.CACHE;
  const repetir = process.env.REPETIR === "1";
  if (!radar.runtimeConsultado) {
    console.error("[fail] " + radar.runtimeDetalhe);
    process.exit(1);
  }

  // A assinatura e o par sessao+classe: a MESMA sessao que muda de classe (a que travou
  // e depois morreu, por exemplo) e novidade de novo, e tem de voltar a avisar.
  const assinatura = (s) => s.sessionId + "|" + s.classe + "|" + (s.tipoDeHitl ?? "");
  let vistas = [];
  try {
    vistas = JSON.parse(fs.readFileSync(cache, "utf8")).vistas ?? [];
  } catch { /* primeira varredura da maquina: tudo e novidade */ }

  const novas = repetir
    ? radar.sessoes
    : radar.sessoes.filter((s) => !vistas.includes(assinatura(s)));

  fs.writeFileSync(
    cache,
    JSON.stringify({ atualizadoEm: radar.consultadoEm, vistas: radar.sessoes.map(assinatura) }, null, 2)
  );

  if (novas.length === 0) {
    console.log(
      "Nada novo: " + radar.resumo.precisamDeHumano + " sessao(oes) parada(s), todas ja avisadas."
    );
    process.exit(0);
  }

  // I-35: nada de horario cru (o consultadoEm e ISO em UTC). A idade de cada sessao, abaixo,
  // ja diz ha quanto tempo ela espera, como no texto do `ork sessions hitl`.
  console.log("AVISO: " + novas.length + " sessao(oes) esperando o humano agora");
  for (const s of novas) {
    console.log("");
    console.log("  " + s.nome + " (" + s.id + ") [" + s.classe + (s.tipoDeHitl ? "/" + s.tipoDeHitl : "") + "]");
    console.log("    o que trava : " + (s.pergunta || s.detalhe));
    console.log("    onde        : " + s.cwd + (s.thread ? " (thread " + s.thread.id + ", fase " + s.thread.fase + ")" : " (fora do ork)"));
    console.log("    parada ha   : " + (s.idadeMin < 1 ? "menos de 1" : s.idadeMin) + " min (idade da sessao)");
    if (s.alternativas.length > 0) {
      console.log("    alternativas:");
      for (const a of s.alternativas) console.log("      - " + a);
    }
    console.log("    recomendo   : " + s.recomendacao);
    // Na sessao abandonada o attach nao serve para nada: o job nao existe mais.
    console.log(
      "    ver / abrir : " + s.comandos.logs +
        (s.classe === "abandonada" ? "  (o job ja saiu: attach nao resolve)" : "  |  " + s.comandos.attach)
    );
  }
  process.exit(10);
});
'
