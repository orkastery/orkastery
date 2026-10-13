#!/usr/bin/env bash
# RM-037 (testes instaveis do CI de 03/10): roda um arquivo de teste N vezes, P de cada vez, com um
# laco ocupado por nucleo da maquina e com a manutencao automatica do git fazendo trabalho de verdade
# (repack geometrico e commit-graph a cada push e fetch), o atraso que derrubou o CI.
# Sai 0 so se todas as rodadas passarem; antes, imprime a conta e o erro de cada rodada que caiu.
#
# Uso: bash core/scripts/prova-laco-sob-carga.sh <N> <P> <arquivo.test.js> [padrao do nome do teste]
# O caminho do arquivo e relativo a raiz do repositorio (ex.: core/dist-test/test/x.test.js).
set -u
if [ $# -lt 3 ]; then
  echo "uso: $0 <N> <P> <arquivo.test.js> [padrao do nome do teste]" >&2
  exit 2
fi
N=$1
P=$2
ARQUIVO=$3
PADRAO=${4:-}
raiz=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
carga=()
encerrar() {
  for pid in "${carga[@]}"; do kill "$pid" 2>/dev/null; done
  rm -rf "$tmp"
}
trap encerrar EXIT

# A configuracao global de quem roda vale (include), e a manutencao ganha trabalho a cada vez.
{
  [ -f "$HOME/.gitconfig" ] && printf '[include]\n\tpath = %s\n' "$HOME/.gitconfig"
  printf '[maintenance]\n\tstrategy = geometric\n'
  printf '[maintenance "geometric-repack"]\n\tauto = -1\n'
  printf '[maintenance "commit-graph"]\n\tauto = -1\n'
} > "$tmp/gitconfig"

nucleos=$(nproc 2>/dev/null || echo 2)
for _ in $(seq 1 "$nucleos"); do
  ( while :; do :; done ) &
  carga+=($!)
done

args=(--test)
[ -n "$PADRAO" ] && args+=(--test-name-pattern="$PADRAO")
args+=("$raiz/$ARQUIVO")

feitas=0
while [ "$feitas" -lt "$N" ]; do
  lote=()
  for _ in $(seq 1 "$P"); do
    [ "$feitas" -ge "$N" ] && break
    feitas=$((feitas + 1))
    ( cd "$raiz" && GIT_CONFIG_GLOBAL="$tmp/gitconfig" node "${args[@]}" > "$tmp/rodada-$feitas.log" 2>&1 \
      || touch "$tmp/rodada-$feitas.falhou" ) &
    lote+=($!)
  done
  wait "${lote[@]}"
done

falhas=$(find "$tmp" -name 'rodada-*.falhou' | wc -l)
for marca in "$tmp"/rodada-*.falhou; do
  [ -e "$marca" ] || continue
  log="${marca%.falhou}.log"
  echo "caiu: $(basename "$log" .log): $(grep -m2 -E "not ok|error|Error" "$log" | tr -s " \n" " ")"
done
echo "$N rodadas, $P em paralelo, $nucleos lacos de carga: $falhas falha(s)"
[ "$falhas" -eq 0 ]
