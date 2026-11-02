/**
 * RM-067 (ork-grokbuild, D16): o `grok` falso dos testes. O `grok` não está instalado nesta máquina (P1 do GOAL): este
 * script em `sh` faz o papel dele no PATH, com o comportamento pedido por arquivos na pasta do stub.
 *
 *   - grava cada chamada (um argumento por linha) e a presença, nunca o valor, de `XAI_API_KEY`;
 *   - cria a pasta da sessão do `-s` (ou do `-r`) em `$GROK_HOME/sessions/<cwd com / trocada por ->/<id>/updates.jsonl`;
 *   - grava o artefato pedido, como uma sessão que escreveu o documento da fase;
 *   - RM-067 (F4): com `--trust`, lê o `AGENTS.md` do `--cwd` e guarda a cópia do que carregou; sem ele, não lê, como o
 *     guia de regras de projeto diz da partida headless (o carregamento na partida exige a pasta confiada);
 *   - RM-067 (F4b): grava os valores de `GROK_CLAUDE_MCPS_ENABLED` e `GROK_CURSOR_MCPS_ENABLED` de cada chamada (não são
 *     segredo) e, com `--trust`, a cópia do `.grok/config.toml` do `--cwd`, a config de MCP que o filho carregaria;
 *   - RM-067 (F4c): grava o próprio pid e o do pai de cada chamada e, com `--trust`, a config da worktree e um roteiro na
 *     pasta do stub, roda um cliente MCP como o do `grok` (G16, G5): na forma `url`, lê o token da variável do
 *     `bearer_token_env_var` (ou relê o `bearer_token_file`) a cada requisição e manda `Authorization: Bearer <token>`, e
 *     guarda o token que viu, para o teste procurar vazamento dele; na forma `command`, sobe o servidor stdio como filho dele;
 *   - RM-067 (F4c, D11): se mandado, roda confinado pelo Landlock do kernel como o perfil `workspace` (escrita só nas pastas
 *     pedidas), pelo lançador de `fixtures/grok/landlock.py`, e os filhos herdam o confinamento; uma sonda tenta criar um
 *     arquivo fora delas e grava se conseguiu;
 *   - RM-067 (F5a): simula um comando de terminal, executa-o só quando o argv traz a regra fechada dele e, fora da lista,
 *     devolve a negação ao modelo antes de continuar ou de encerrar com `cancelled`, conforme o caso;
 *   - escreve no stderr o texto pedido e, no stdout, a fixture do stream, com `<SESSAO>` trocado pelo id;
 *   - espera, se mandado, e sai com o código pedido, ou se mata com o sinal pedido.
 *
 * O `GROK_HOME` é sempre uma pasta temporária: nenhum teste toca a casa real do `grok`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');

/** RM-067 (F4c): uma chamada do roteiro do cliente MCP do filho. */
export interface ChamadaMcp { nome: string; argumentos: Record<string, unknown> }
/** RM-067 (F4c): o que o cliente MCP do filho viu. */
export interface ResultadoMcp {
  ferramentas: string[];
  chamadas: { nome: string; isError: boolean; texto: string }[];
  /** O token que o cliente mandou (só da fixture: o teste procura vazamento dele no disco). */
  token?: string;
  erro?: string;
}

/**
 * RM-067 (F4c): o cliente MCP do `grok` falso, em CommonJS, com o SDK e o parser de TOML resolvidos daqui. Ele lê a entrada
 * `orkastery` da config que o filho carregou, chama as ferramentas do roteiro e grava o resultado na pasta do stub.
 */
function clienteMcp(): string {
  const r = (m: string) => JSON.stringify(require.resolve(m));
  return `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require(${r('smol-toml')});
const { Client } = require(${r('@modelcontextprotocol/sdk/client/index.js')});
const { StreamableHTTPClientTransport } = require(${r('@modelcontextprotocol/sdk/client/streamableHttp.js')});
const { StdioClientTransport } = require(${r('@modelcontextprotocol/sdk/client/stdio.js')});
(async () => {
  const [config, dir] = process.argv.slice(2);
  const roteiro = JSON.parse(fs.readFileSync(path.join(dir, 'mcp-roteiro.json'), 'utf8'));
  const entrada = parse(fs.readFileSync(config, 'utf8')).mcp_servers.orkastery;
  const resultado = { ferramentas: [], chamadas: [] };
  let transporte;
  if (entrada.url) {
    const token = () => entrada.bearer_token_env_var ? (process.env[entrada.bearer_token_env_var] || '')
      : fs.readFileSync(entrada.bearer_token_file, 'utf8').trim();
    resultado.token = token();
    const comToken = (url, init = {}) => {
      const cabecalhos = new Headers(init.headers);
      cabecalhos.set('Authorization', 'Bearer ' + token());
      return fetch(url, { ...init, headers: cabecalhos });
    };
    transporte = new StreamableHTTPClientTransport(new URL(entrada.url), { fetch: comToken });
  } else {
    transporte = new StdioClientTransport({ command: entrada.command, args: entrada.args,
      env: { ...process.env, ...(entrada.env || {}) }, stderr: 'ignore' });
  }
  const client = new Client({ name: 'grok-falso', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transporte);
    resultado.ferramentas = (await client.listTools()).tools.map((t) => t.name);
    for (const c of roteiro) {
      try {
        const r = await client.callTool({ name: c.nome, arguments: c.argumentos });
        resultado.chamadas.push({ nome: c.nome, isError: r.isError === true, texto: (r.content && r.content[0] && r.content[0].text) || '' });
      } catch (e) { resultado.chamadas.push({ nome: c.nome, isError: true, texto: String((e && e.message) || e) }); }
    }
  } catch (e) { resultado.erro = String((e && e.message) || e); }
  finally { try { await client.close(); } catch { /* o servidor ja saiu */ } }
  fs.writeFileSync(path.join(dir, 'mcp-resultado.json'), JSON.stringify(resultado));
})();
`;
}

/** RM-067 (F4c, D11): o lançador que confina o filho como o perfil `workspace`, com o Landlock do kernel. */
const LANDLOCK = path.join(RAIZ, 'core/test/fixtures/grok/landlock.py');

function script(dir: string): string {
  return `#!/bin/sh
DIR='${dir}'
NODE='${process.execPath}'
if [ "$1" = "--version" ]; then echo "grok 1.0.62"; exit 0; fi
if [ -f "$DIR/landlock" ] && [ -z "\${ORK_GROK_FALSO_CONFINADO:-}" ]; then
  export ORK_GROK_FALSO_CONFINADO=1
  exec python3 -I '${LANDLOCK}' "$DIR/landlock" "$0" "$@"
fi
N=$(ls "$DIR" | grep -c '^chamada-')
for a in "$@"; do printf '%s\\n' "$a"; done > "$DIR/chamada-$N"
printf '%s\\n%s\\n' "$$" "$PPID" > "$DIR/pid-$N"
if [ -f "$DIR/sonda" ]; then
  if touch "$(cat "$DIR/sonda")" 2> "$DIR/sonda.erro"; then echo gravou > "$DIR/sonda.resultado"; else echo recusada > "$DIR/sonda.resultado"; fi
fi
if [ -n "\${XAI_API_KEY:-}" ]; then : > "$DIR/xai-visto"; fi
printf '%s\\n%s\\n' "\${GROK_CLAUDE_MCPS_ENABLED-ausente}" "\${GROK_CURSOR_MCPS_ENABLED-ausente}" > "$DIR/compat-$N"
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
if [ -n "$CONFIA" ] && [ -f "$CWD/.grok/config.toml" ]; then cp "$CWD/.grok/config.toml" "$DIR/config-carregada"; fi
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
if [ -n "$CONFIA" ] && [ -f "$DIR/mcp-roteiro.json" ] && [ -f "$CWD/.grok/config.toml" ]; then
  if [ -f "$DIR/mcp-espera" ]; then
    I=0; while [ ! -f "$DIR/mcp-liberado" ] && [ "$I" -lt 600 ]; do sleep 0.1; I=$((I + 1)); done
  fi
  "$NODE" "$DIR/cliente-mcp.cjs" "$CWD/.grok/config.toml" "$DIR" 2> "$DIR/mcp-cliente.stderr"
fi
if [ -f "$DIR/stderr" ]; then cat "$DIR/stderr" >&2; fi
if [ -f "$DIR/comando-terminal" ]; then
  COMANDO=$(cat "$DIR/comando-terminal")
  BINARIO=$(printf '%s' "$COMANDO" | awk '{print $1}')
  if grep -Fqx -- "Bash($BINARIO)" "$DIR/chamada-$N" || grep -Fqx -- "Bash($BINARIO *)" "$DIR/chamada-$N"; then
    CODIGO=0
    sh -c "$COMANDO" > "$DIR/terminal.stdout" 2> "$DIR/terminal.stderr" || CODIGO=$?
    "$NODE" -e 'const [c,id,code]=process.argv.slice(1); const p=(x)=>process.stdout.write(JSON.stringify(x)+"\\n"); p({type:"tool_call",toolCallId:"call_terminal",title:"Bash",kind:"execute",status:"in_progress",toolName:"bash",rawInput:{command:c},content:[],locations:[]}); p({type:"tool_call_update",toolCallId:"call_terminal",status:"completed",content:[],rawOutput:{type:"Bash",command:c,exit_code:Number(code),output_for_prompt:"comando executado"},locations:[]}); p({type:"text",data:"A fase seguiu depois do comando permitido."}); p({type:"end",stopReason:"end_turn",sessionId:id,requestId:"req-terminal",usage:{input_tokens:10,output_tokens:2,total_tokens:12},num_turns:2});' "$COMANDO" "$ID" "$CODIGO"
  else
    : > "$DIR/terminal.negado"
    ENCERRA=0; if [ -f "$DIR/terminal-encerra" ]; then ENCERRA=1; fi
    "$NODE" -e 'const [c,id,encerra]=process.argv.slice(1); const p=(x)=>process.stdout.write(JSON.stringify(x)+"\\n"); p({type:"tool_call",toolCallId:"call_terminal",title:"Bash",kind:"execute",status:"in_progress",toolName:"bash",rawInput:{command:c},content:[],locations:[]}); p({type:"tool_call_update",toolCallId:"call_terminal",status:"completed",content:[],rawOutput:{type:"Bash",command:c,exit_code:null,output_for_prompt:"Denied by permission policy: "+c},locations:[]}); if(encerra!=="1") p({type:"text",data:"A negação foi recebida; a fase seguiu sem o comando."}); p({type:"end",stopReason:encerra==="1"?"cancelled":"end_turn",sessionId:id,requestId:"req-terminal",usage:{input_tokens:10,output_tokens:2,total_tokens:12},num_turns:2});' "$COMANDO" "$ID" "$ENCERRA"
  fi
elif [ -f "$DIR/stream" ]; then sed "s/<SESSAO>/$ID/g" "$DIR/stream"; fi
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
  /** RM-067 (F5a): o comando que o runtime simula; fora da lista pode encerrar o turno depois da negação. */
  comandoTerminal: (comando: string, encerraAoNegar?: boolean) => void;
  /** A saída do comando permitido, ou `null` quando ele não rodou. */
  saidaDoComandoTerminal: () => string | null;
  /** A política fechada negou o comando antes de executá-lo? */
  comandoTerminalNegado: () => boolean;
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
  /** RM-067 (F4b): os valores de `GROK_CLAUDE_MCPS_ENABLED` e `GROK_CURSOR_MCPS_ENABLED` de cada chamada (`ausente` sem ela). */
  compat: () => string[][];
  /** RM-067 (F4b): o `.grok/config.toml` do `--cwd` na última partida com `--trust`, ou `null`. */
  configCarregada: () => string | null;
  /**
   * RM-067 (F4c): o roteiro do cliente MCP do filho, que roda com `--trust` e a config da worktree. Com `esperar`, o
   * cliente só chama depois de `liberarMcp`: o `ork phase run` segura a trava HITL da thread até ver a sessão, e a
   * ferramenta que grava o ledger nessa janela recusa com `HITL ocupado`, como recusaria para uma sessão real.
   */
  mcp: (roteiro: ChamadaMcp[], opcoes?: { esperar?: boolean }) => void;
  /** RM-067 (F4c): deixa o cliente MCP do filho chamar o roteiro (com `esperar`). */
  liberarMcp: () => void;
  /** RM-067 (F4c): o que o cliente MCP do filho viu na última partida, ou `null` se ele não rodou. */
  mcpResultado: () => ResultadoMcp | null;
  /** RM-067 (F4c): o pid e o pai de cada chamada, na ordem. */
  pids: () => { pid: number; pai: number }[];
  /** RM-067 (F4c, D11): o filho roda confinado pelo Landlock, com escrita só nestas pastas, como o perfil `workspace`. */
  confinar: (pastas: string[]) => void;
  /** RM-067 (F4c, D11): o filho, já confinado, tenta criar este arquivo antes de tudo. */
  sonda: (caminho: string) => void;
  /** RM-067 (F4c, D11): se a sonda criou o arquivo, ou `null` se ela não rodou. */
  sondaResultado: () => 'gravou' | 'recusada' | null;
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
    comandoTerminal: (comando, encerraAoNegar = false) => {
      gravar('comando-terminal', comando);
      if (encerraAoNegar) gravar('terminal-encerra', '');
    },
    saidaDoComandoTerminal: () => fs.existsSync(path.join(dir, 'terminal.stdout'))
      ? fs.readFileSync(path.join(dir, 'terminal.stdout'), 'utf8') : null,
    comandoTerminalNegado: () => fs.existsSync(path.join(dir, 'terminal.negado')),
    espera: (segundos) => gravar('espera', String(segundos)),
    artefato: (caminho) => gravar('artefato', caminho),
    chamadas: () => fs.readdirSync(dir).filter((f) => f.startsWith('chamada-')).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(0, -1)),
    xaiVisto: () => fs.existsSync(path.join(dir, 'xai-visto')),
    agentsCarregado: () => fs.existsSync(path.join(dir, 'agents-carregado')) ? fs.readFileSync(path.join(dir, 'agents-carregado'), 'utf8') : null,
    compat: () => fs.readdirSync(dir).filter((f) => f.startsWith('compat-')).sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(0, -1)),
    configCarregada: () => fs.existsSync(path.join(dir, 'config-carregada')) ? fs.readFileSync(path.join(dir, 'config-carregada'), 'utf8') : null,
    mcp: (roteiro, opcoes = {}) => {
      fs.writeFileSync(path.join(dir, 'cliente-mcp.cjs'), clienteMcp());
      if (opcoes.esperar) gravar('mcp-espera', '');
      gravar('mcp-roteiro.json', JSON.stringify(roteiro));
    },
    liberarMcp: () => gravar('mcp-liberado', ''),
    mcpResultado: () => fs.existsSync(path.join(dir, 'mcp-resultado.json'))
      ? JSON.parse(fs.readFileSync(path.join(dir, 'mcp-resultado.json'), 'utf8')) as ResultadoMcp : null,
    pids: () => fs.readdirSync(dir).filter((f) => f.startsWith('pid-')).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
      .map((f) => { const [pid, pai] = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map(Number); return { pid, pai }; }),
    confinar: (pastas) => gravar('landlock', pastas.join('\n') + '\n'),
    sonda: (caminho) => gravar('sonda', caminho),
    sondaResultado: () => fs.existsSync(path.join(dir, 'sonda.resultado'))
      ? fs.readFileSync(path.join(dir, 'sonda.resultado'), 'utf8').trim() as 'gravou' | 'recusada' : null,
    restaurar: () => {
      for (const [k, v] of Object.entries(anterior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
