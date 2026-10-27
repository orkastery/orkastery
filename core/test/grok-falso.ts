/**
 * RM-067 (ork-grokbuild, D16): o `grok` falso dos testes. O `grok` não está instalado nesta máquina (P1 do GOAL): este
 * script em `sh` faz o papel dele no PATH, com o comportamento pedido por arquivos na pasta do stub.
 *
 *   - grava cada chamada (um argumento por linha) e a presença, nunca o valor, de `XAI_API_KEY`;
 *   - cria a pasta da sessão do `-s` (ou do `-r`) em `$GROK_HOME/sessions/<cwd com / trocada por ->/<id>/updates.jsonl`;
 *   - grava o artefato pedido, como uma sessão que escreveu o documento da fase;
 *   - RM-067 (F4): com `--trust`, lê o `AGENTS.md` do `--cwd` e guarda a cópia do que carregou; sem ele, não lê, como o
 *     guia de regras de projeto diz da partida headless (o carregamento na partida exige a pasta confiada);
 *   - escreve no stderr o texto pedido e, no stdout, a fixture do stream, com `<SESSAO>` trocado pelo id;
 *   - espera, se mandado, e sai com o código pedido, ou se mata com o sinal pedido.
 *
 * O `GROK_HOME` é sempre uma pasta temporária: nenhum teste toca a casa real do `grok`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');

function script(dir: string): string {
  return `#!/bin/sh
DIR='${dir}'
if [ "$1" = "--version" ]; then echo "grok 1.0.62"; exit 0; fi
N=$(ls "$DIR" | grep -c '^chamada-')
for a in "$@"; do printf '%s\\n' "$a"; done > "$DIR/chamada-$N"
if [ -n "\${XAI_API_KEY:-}" ]; then : > "$DIR/xai-visto"; fi
SESSAO=""; RETOMA=""; CWD=""; CONFIA=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s) SESSAO="$2"; shift 2 ;;
    -r) RETOMA="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --trust) CONFIA=1; shift ;;
    *) shift ;;
  esac
done
if [ -n "$CONFIA" ] && [ -f "$CWD/AGENTS.md" ]; then cp "$CWD/AGENTS.md" "$DIR/agents-carregado"; fi
ID="\${SESSAO:-$RETOMA}"
CASA="\${GROK_HOME:-$DIR/casa-padrao}"
if [ -n "$ID" ] && [ ! -f "$DIR/sem-sessao" ]; then
  GRUPO=$(printf '%s' "$CWD" | tr '/' '-')
  mkdir -p "$CASA/sessions/$GRUPO/$ID"
  printf '{"sessionUpdate":"user_message_chunk"}\\n' >> "$CASA/sessions/$GRUPO/$ID/updates.jsonl"
fi
if [ -f "$DIR/artefato" ]; then
  A=$(cat "$DIR/artefato"); mkdir -p "$(dirname "$A")"; printf '# artefato do grok falso\\n' > "$A"
fi
if [ -f "$DIR/stderr" ]; then cat "$DIR/stderr" >&2; fi
if [ -f "$DIR/stream" ]; then sed "s/<SESSAO>/$ID/g" "$DIR/stream"; fi
if [ -f "$DIR/espera" ]; then sleep "$(cat "$DIR/espera")"; fi
if [ -f "$DIR/sinal" ]; then kill -"$(cat "$DIR/sinal")" $$; fi
exit "$(cat "$DIR/saida" 2>/dev/null || echo 0)"
`;
}

export interface GrokFalso {
  /** A pasta do stub, primeira no PATH. */
  dir: string;
  /** O `GROK_HOME` temporário do teste. */
  casa: string;
  /** A fixture de `core/test/fixtures/grok/` que o stub escreve no stdout. */
  stream: (fixture: string) => void;
  /** O stream exato que o stub escreve (vazio: nenhum evento). */
  streamTexto: (texto: string) => void;
  /** O texto que o stub escreve no stderr. */
  stderr: (texto: string) => void;
  saida: (codigo: number) => void;
  sinal: (nome: 'TERM' | 'INT') => void;
  /** O stub não cria a pasta da sessão. */
  semSessao: () => void;
  /** O processo fica vivo por estes segundos antes de sair. */
  espera: (segundos: number) => void;
  /** O stub grava um documento neste caminho, como a sessão que escreveu o artefato da fase. */
  artefato: (caminho: string) => void;
  /** Cada chamada, com os argumentos na ordem. */
  chamadas: () => string[][];
  /** O filho recebeu `XAI_API_KEY` no ambiente? */
  xaiVisto: () => boolean;
  /** RM-067 (F4): o `AGENTS.md` que o filho carregou na partida (só com `--trust`), ou `null`. */
  agentsCarregado: () => string | null;
  restaurar: () => void;
}

export function grokFalso(nome: string): GrokFalso {
  const dir = dirTemporario(`grok-falso-${nome}`);
  const casa = path.join(dir, 'casa-grok');
  fs.mkdirSync(casa);
  fs.writeFileSync(path.join(dir, 'grok'), script(dir), { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, GROK_HOME: process.env.GROK_HOME };
  process.env.PATH = `${dir}${path.delimiter}${anterior.PATH ?? ''}`;
  process.env.GROK_HOME = casa;
  const gravar = (arquivo: string, conteudo: string) => fs.writeFileSync(path.join(dir, arquivo), conteudo);
  return {
    dir,
    casa,
    stream: (fixture) => fs.copyFileSync(path.join(RAIZ, 'core/test/fixtures/grok', fixture), path.join(dir, 'stream')),
    streamTexto: (texto) => gravar('stream', texto),
    stderr: (texto) => gravar('stderr', texto),
    saida: (codigo) => gravar('saida', String(codigo)),
    sinal: (nome) => gravar('sinal', nome),
    semSessao: () => gravar('sem-sessao', ''),
    espera: (segundos) => gravar('espera', String(segundos)),
    artefato: (caminho) => gravar('artefato', caminho),
    chamadas: () => fs.readdirSync(dir).filter((f) => f.startsWith('chamada-')).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(0, -1)),
    xaiVisto: () => fs.existsSync(path.join(dir, 'xai-visto')),
    agentsCarregado: () => fs.existsSync(path.join(dir, 'agents-carregado')) ? fs.readFileSync(path.join(dir, 'agents-carregado'), 'utf8') : null,
    restaurar: () => {
      for (const [k, v] of Object.entries(anterior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
