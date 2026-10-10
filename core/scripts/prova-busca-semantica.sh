#!/usr/bin/env bash
# I-38 (T6, D12): prova reexecutavel da busca por significado na memoria do tenant.
#
# Para cada par "termo canonico|parafrase", imprime lado a lado:
#   alvo             o que o FTS do termo canonico acha (a entrada que a parafrase descreve);
#   tag equivalente  memory search --tags com project do tenant e domain = palavras da parafrase;
#   FTS da parafrase memory search --texto "<parafrase>" --modo fts;
#   semantica        top 5 de memory search --texto "<parafrase>" --modo vetor.
# Exclusiva e um alvo que aparece no top 5 semantico e fica fora da tag e do FTS da parafrase.
# Sai 1 se nenhum par der exclusiva, 2 se um par vier malformado.
#
# Diagnostico (RM-038, 10/10/2026), sem mudar o criterio acima: a busca vetorial pede o ranking
# inteiro na mesma chamada (ate o limite da busca) e a prova imprime, por par, a posicao e a
# similaridade de cada alvo nesse ranking e quantas entradas da busca tem vetor coerente no indice.
# A exclusiva continua julgada so nos 5 primeiros da mesma resposta.
#
# Uso: bash core/scripts/prova-busca-semantica.sh ["termo|parafrase" ...]
# Roda o CLI deste checkout contra o manifesto do diretorio corrente. Custo com o primario do
# OpenRouter: uma consulta embedada por par (cerca de 20 tokens cada); com o fallback local, so CPU.
set -euo pipefail

CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/index.js"
ork() { node "$CLI" "$@"; }

# set -e encerra a prova na falha; preserve antes o JSON com o motivo tipado no stderr.
buscar() {
  local resposta codigo
  if resposta=$(ork memory search "$@"); then
    printf '%s\n' "$resposta"
  else
    codigo=$?
    printf '%s\n' "$resposta" >&2
    return "$codigo"
  fi
}

if [ "$#" -gt 0 ]; then
  PARES=("$@")
else
  PARES=("rotacao|trocar de conta quando acaba a cota" "handoff|esquecimento da memoria entre sessoes")
fi

# Le o JSON do stdin e imprime "colecao/id" por linha: resultados da busca por texto ou entradas da busca por tag.
ids() {
  node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const itens = Array.isArray(r) ? r : (r.resultados || []);
    for (const e of itens.slice(0, Number(process.argv[1]) || itens.length)) console.log(`${e.collection}/${e.id}`);
  ' "${1:-0}"
}
linha() { if [ -n "$1" ]; then printf '%s' "$1" | paste -sd ',' - | sed 's/,/, /g'; else echo '(nenhuma)'; fi; }

TENANT=$(ork memory status --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).tenant)')
echo "Prova da busca por significado (I-38), tenant ${TENANT}"
exclusivas=0
n=0
for par in "${PARES[@]}"; do
  n=$((n + 1))
  termo="${par%%|*}"
  frase="${par#*|}"
  if [ "$termo" = "$par" ] || [ -z "$termo" ] || [ -z "$frase" ]; then
    echo "par malformado: \"$par\" (use \"termo canonico|parafrase\")" >&2
    exit 2
  fi
  tags=$(node -e '
    const palavras = process.argv[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [];
    console.log(JSON.stringify({ project: [process.argv[1]], domain: [...new Set(palavras)] }));
  ' "$TENANT" "$frase")
  alvo_json=$(buscar --texto "$termo" --modo fts --limite 100 --json)
  alvo=$(printf '%s' "$alvo_json" | ids)
  tag_json=$(buscar --tags "$tags" --json)
  tag=$(printf '%s' "$tag_json" | ids)
  fts_json=$(buscar --texto "$frase" --modo fts --limite 100 --json)
  fts=$(printf '%s' "$fts_json" | ids)
  # Uma consulta embedada por par: o ranking inteiro serve ao diagnostico, e a exclusiva olha so os 5 primeiros.
  semantica_json=$(buscar --texto "$frase" --modo vetor --limite 100 --json)
  semantica=$(printf '%s' "$semantica_json" | ids 5)
  origem=$(printf '%s' "$semantica_json" | node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log(`${r.origem}${r.modeloUsado ? " " + r.modeloUsado : ""}${r.motivo ? ", motivo " + r.motivo : ""}`);
  ')
  posicoes=$(printf '%s' "$semantica_json" | node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const itens = r.resultados || [];
    const c = r.coberturaDoIndice;
    const alvos = process.argv[1].split(String.fromCharCode(10)).filter(Boolean);
    if (!alvos.length) { console.log("(nenhum alvo)"); process.exit(0); }
    if (r.origem !== "primario" && r.origem !== "fallback") { console.log(`(sem ranking vetorial: origem ${r.origem})`); process.exit(0); }
    console.log(alvos.map((a) => {
      const i = itens.findIndex((e) => `${e.collection}/${e.id}` === a);
      if (i < 0) {
        // A resposta traz todos os vetores coerentes quando cabe no limite: alvo fora dela nao tem vetor.
        return c && itens.length >= c.coerentes ? `${a} sem vetor coerente no indice` : `${a} fora dos ${itens.length} primeiros do ranking vetorial`;
      }
      const sim = typeof itens[i].similaridade === "number" ? ` (similaridade ${itens[i].similaridade})` : "";
      return `${a} na posicao ${i + 1}${sim}`;
    }).join(", "));
  ' "$alvo")
  cobertura=$(printf '%s' "$semantica_json" | node -e '
    const c = JSON.parse(require("fs").readFileSync(0, "utf8")).coberturaDoIndice;
    console.log(c ? `${c.coerentes} de ${c.universo} entrada(s) da busca com vetor coerente` : "(nao informada)");
  ')
  echo ""
  echo "par ${n}: termo \"${termo}\" | parafrase \"${frase}\""
  echo "  alvo (FTS do termo)      $(linha "$alvo")"
  echo "  tag equivalente          $(linha "$tag")"
  echo "  FTS da parafrase         $(linha "$fts")"
  echo "  semantica top 5          $(linha "$semantica")  [origem ${origem}]"
  echo "  posicao dos alvos        ${posicoes}"
  echo "  cobertura do indice      ${cobertura}"
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if grep -qxF "$id" <<<"$alvo" && ! grep -qxF "$id" <<<"$tag" && ! grep -qxF "$id" <<<"$fts"; then
      echo "  exclusiva da busca semantica: ${id}"
      exclusivas=$((exclusivas + 1))
    fi
  done <<<"$semantica"
done
echo ""
if [ "$exclusivas" -eq 0 ]; then
  echo "resultado: nenhum par teve alvo alcancado so pela semantica (confira a origem acima e ork memory status)"
  exit 1
fi
echo "resultado: ${exclusivas} alvo(s) alcancado(s) so pela semantica em ${#PARES[@]} par(es)"
