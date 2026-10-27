/**
 * RM-067 (F1 da ork-grokbuild): runtime `grok`, o Grok Build headless da xAI. Nasceu só para despacho explícito
 * (`ork phase run --runtime grok`, D1); desde a F4, é runtime de bloco no setup, nunca o padrão do projeto, e desde a F4b
 * leva o MCP do `ork` pela config que o despacho grava na worktree (`gravarConfigDaWorktree`). Desde a F4c, o servidor
 * dessa config é um processo do `ork`, fora do sandbox do `grok` (`grok-mcp.ts`), e o `grok` se conecta a ele por `url`.
 *
 * O despacho roda `grok -p <prompt> --output-format streaming-json -s <id>` desanexado, pelo supervisor do `codex-runner`
 * (D6): o log do stream, o `.process.json` com a identidade do filho e o `.exit.json` com o código e o sinal do `close`
 * real. O id da sessão é escolhido pelo `ork` (D5), e a prova de que ela existe é a pasta
 * `<GROK_HOME>/sessions/<grupo>/<id>/` com o `updates.jsonl`, que o próprio runtime grava. O `ork` só lista nomes e lê o
 * tamanho e o mtime desse arquivo, nunca o conteúdo, e nunca abre o `auth.json`. O fim da sessão é do watcher
 * (`session-watcher-grok.ts`), pelo `end` do stream e pelo recibo do supervisor.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { ambienteDeAssinatura, ENVS_DE_PROVIDER_PAGO } from '../runtime-ambiente';
import { ContextoRuntime, validarContextoDoGrok } from '../runtime-context';
import { ambienteComPerfil, PerfilDeDespacho } from '../runtime-profiles';
import { SessaoRuntime } from '../types';
import { exec as executar, noPath } from '../util';
import { CONSULTAS_MCP, DespachoResultado, MUTACOES_WORKTREE, parseRateLimit, StatusDeAuth } from './claude-bg';
import { estadoProcesso, iniciarSupervisor, ProcessoCodex, ReciboCodex } from './codex-runner';
import { falhaDeContaDoTextoGrok, falhaDoErroGrok, lerStreamGrok, redigirTextoGrok } from './grok-events';
import { iniciarServidorDoGrok, ServidorDoGrokIniciado } from './grok-mcp';
import { TOOLS_DO_GRAFO } from '../mcp-grafo';
import type { PermissoesFilhoMcp } from '../mcp-install';

export const NOME_ADAPTER = 'grok';

/** De onde vem a prova de que a sessão existe (vai ao `phase_dispatch_verified`). */
export const FONTE_VERIFICACAO = 'pasta da sessao em $GROK_HOME/sessions';

/**
 * D4: o ambiente do filho é o da assinatura, sem as variáveis de provider pago e sem `XAI_API_KEY`. A D1 da RM-067 foi
 * decidida pelo dono em 27/10/2026 pela alternativa b (a assinatura agora): o filho autentica pelo login que o próprio
 * `grok` guardou no `GROK_HOME` do perfil, nunca pela chave. Tirar a variável do ambiente não lê nem copia a credencial.
 */
export const ENVS_REMOVIDAS_DO_DESPACHO = [...ENVS_DE_PROVIDER_PAGO, 'XAI_API_KEY'] as const;

/**
 * RM-067 (F4b, G4 e D5): o filho do `grok` nunca carrega o MCP de outros clientes. Por padrão, o `grok` lê a config de MCP
 * do Claude e a do Cursor (G16); as duas variáveis desligam essa leitura (`false` ou `0`, G5), com ou sem o MCP do `ork`.
 */
export const AMBIENTE_SEM_MCP_DE_OUTROS_CLIENTES: Readonly<Record<string, string>> = Object.freeze({
  GROK_CLAUDE_MCPS_ENABLED: '0', GROK_CURSOR_MCPS_ENABLED: '0',
});

/**
 * D3 e F4 (E7 da RM-067): a postura de sandbox do manifesto (vocabulário do Codex) no perfil do `grok` (`--sandbox`).
 * `workspace` é o piso, o perfil de toda postura que não afrouxa (o `grok` usa Landlock, não o bubblewrap do Codex). A
 * postura mais frouxa (`danger-full-access`) vira `off`, sem sandbox, e só despacha com `ork setup sandbox confirmar`
 * nesta máquina: sem a confirmação, o `ork phase run` e o `ork retry` recusam com `runtime.sandbox-nao-confirmado`
 * (`postura-local.ts`) antes de montar o comando. O `strict` do `grok` não tem postura do Orkastery que o peça. Nenhuma
 * postura aprova tudo: nunca `--yolo`, `--always-approve` nem `--permission-mode bypassPermissions`.
 */
export const PERFIL_DE_SANDBOX_DO_GROK: Readonly<Record<string, string>> = Object.freeze({
  'read-only': 'read-only',
  'workspace-write': 'workspace',
  'danger-full-access': 'off',
});
export const PERFIL_DE_SANDBOX_PADRAO = 'workspace';

/**
 * RM-067 (F4, E6): o esforço do Orkastery nos níveis canônicos do `grok` (`none`, `minimal`, `low`, `medium`, `high`,
 * `xhigh`, `max`, no guia headless). O `eco` vira `minimal`, para a escada de esforço (`eco` antes de `low`) seguir com
 * degraus distintos; os outros cinco têm o mesmo nome. Cada modelo só aceita os níveis que o próprio menu anuncia, e esse
 * menu só o runtime conhece (`grok models`): o nível que o modelo não anuncia é recusado pelo próprio `grok` no despacho.
 * Valor fora da tabela vai como veio, porque o `grok` também aceita o id de uma opção do menu do modelo.
 */
export const ESFORCO_DO_GROK: Readonly<Record<string, string>> = Object.freeze({
  eco: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
});

/** O nível do `--effort` do `grok` para o esforço do Orkastery (E6). */
export function esforcoDoGrok(effort: string): string {
  const chave = effort.trim().toLowerCase();
  return Object.hasOwn(ESFORCO_DO_GROK, chave) ? ESFORCO_DO_GROK[chave] : effort.trim();
}

/** O prefixo das ferramentas do servidor `orkastery` no `--allowedTools` do `claude-bg`. */
const PREFIXO_DO_CLAUDE = 'mcp__orkastery__';

/**
 * RM-067 (F4b, G2 e D1): as ferramentas do MCP do `ork` que um despacho do `grok` libera, as mesmas do `--allowedTools` do
 * `claude-bg` no mesmo caso, sem o prefixo: no PLAN que fecha o bloco, as consultas, `ork_artifact_write` e
 * `ork_decision_record`, em qualquer perfil; fora dele, as consultas e, no perfil `worktree`, `ork_git_status` e as seis
 * mutações. As consultas do grafo entram com a flag do manifesto da raiz. Montada na chamada, como no `claude-bg`: no
 * ciclo de imports, o valor importado pode ainda não existir quando este módulo carrega.
 */
export function ferramentasDoGrok(perfil: PermissoesFilhoMcp, plano: boolean, grafo: boolean): string[] {
  const semPrefixo = (nomes: readonly string[]) => nomes.map((n) => n.slice(PREFIXO_DO_CLAUDE.length));
  const consultas = [...semPrefixo(CONSULTAS_MCP), ...(grafo ? TOOLS_DO_GRAFO : [])];
  if (plano) return [...consultas, 'ork_artifact_write', 'ork_decision_record'];
  return perfil === 'worktree' ? [...consultas, 'ork_git_status', ...semPrefixo(MUTACOES_WORKTREE)] : consultas;
}

/**
 * RM-067 (F4b, G1): o que o servidor `--host grok` lista, para o perfil filho da instalação: a união dos dois casos de
 * `ferramentasDoGrok` (o PLAN e o resto do bloco). O headless não aprova ferramenta em diálogo, então o servidor não lista
 * nada que o `--allow` de algum despacho desse perfil não libere.
 */
export function ferramentasServidasAoGrok(perfil: PermissoesFilhoMcp, grafo: boolean): string[] {
  return [...new Set([...ferramentasDoGrok(perfil, false, grafo), ...ferramentasDoGrok(perfil, true, grafo)])];
}

/** D6: quanto o despacho espera a pasta da sessão ou o recibo do supervisor. */
export const ESPERA_PADRAO_MS = 60_000;

const ID_DE_SESSAO = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LIMITE_METADADO_BYTES = 65536;
const LIMITE_STDERR_BYTES = 4096;
/** O stderr do resultado: o despacho grava os primeiros 500 caracteres dele no ledger. */
const LIMITE_STDERR_NO_RESULTADO = 500;

export interface DespachoGrokPedido {
  prompt: string;
  /** Nome da sessão no Ork; o `grok` não tem `--name`, o id é que vincula. */
  nome: string;
  /** A worktree da thread: vai em `--cwd` e é o cwd do processo. */
  cwd: string;
  model?: string;
  effort?: string;
  /** A postura de sandbox do manifesto (`runtime.sandbox`). */
  sandbox?: string;
  /** PLAN que termina no próprio bloco: o `grok` roda em `read-only`, porque o PLAN não implementa. */
  colaboracao?: 'plan' | 'default';
  /** Diretório dos logs do despacho (`<thread>/sessoes`); obrigatório no despacho real. */
  logDir?: string;
  dryRun?: boolean;
  /** O id da sessão (`-s`); sem ele, o despacho gera um. */
  sessionId?: string;
  /** Espera máxima pela prova de existência, em ms (padrão `ESPERA_PADRAO_MS`). */
  esperaMs?: number;
  /** RM-067 (F3): o perfil de conta do despacho (`grokHome`); ausente, vale o `GROK_HOME` do processo. */
  perfil?: PerfilDeDespacho;
  /** I-36 (D4): identidade, thread e canal do despacho no ambiente da sessão filha. */
  ambienteExtra?: Record<string, string>;
  /** RM-067 (F4b): o contexto do MCP do projeto preparado; sem ele, o despacho fica como num projeto sem entrada MCP. */
  contextoRuntime?: ContextoRuntime;
  /** A thread do despacho, que o contexto tem de repetir. */
  vinculo?: { thread: string };
}

export interface DespachoGrokResultado extends DespachoResultado {
  logPath?: string;
  processoPath?: string;
  reciboPath?: string;
}

/** D4: o ambiente do despacho, sem provider pago e sem `XAI_API_KEY`; o `GROK_HOME` do processo fica. */
export function ambienteDoDespacho(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = ambienteDeAssinatura(base);
  for (const nome of ENVS_REMOVIDAS_DO_DESPACHO) delete env[nome];
  return env;
}

/**
 * O ambiente do filho: o do despacho, com o `GROK_HOME` do perfil (F3) e o contexto da condução por cima. Perfil de outro
 * runtime, ou sem `grokHome`, recusa: cair para a casa do processo seria despachar pela conta errada. RM-067 (F4b): as
 * duas variáveis que desligam o MCP de outros clientes vão por último, para nada as desfazer.
 */
export function ambienteDoFilho(pedido: Pick<DespachoGrokPedido, 'perfil' | 'ambienteExtra'>,
    base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (pedido.perfil && (pedido.perfil.runtime !== 'grok' || !pedido.perfil.grokHome))
    throw new Error('runtime.profiles.invalid: perfil sem grokHome no despacho grok');
  return { ...ambienteComPerfil(ambienteDoDespacho(base), pedido.perfil), ...(pedido.ambienteExtra ?? {}),
    ...AMBIENTE_SEM_MCP_DE_OUTROS_CLIENTES };
}

/**
 * RM-067 (F3): o login do perfil é sempre do próprio CLI, com o `GROK_HOME` do perfil: `grok login` pelo navegador ou
 * `grok login --device-auth` pelo código de dispositivo (G3, G4 da página). O `ork` nunca abre o `auth.json` que o
 * `grok` grava.
 */
export function comandoDeLogin(codigoDeDispositivo = false): string[] {
  return ['grok', 'login', ...(codigoDeDispositivo ? ['--device-auth'] : [])];
}

/**
 * RM-067 (F3): a conferência de login do perfil. O `grok` não documenta um comando de status do login (fontes da página),
 * e o `ork` nunca lê o `auth.json`: a conferência fica sem medida (`semConferencia`), o perfil segue no rodízio e quem
 * prova o login é o próprio despacho, cujo erro de login do runtime vira `runtime.auth-missing` e tira o perfil.
 */
export function conferirAuth(perfil?: PerfilDeDespacho | null): StatusDeAuth {
  try { ambienteDoFilho({ perfil: perfil ?? undefined }); }
  catch (e) { return { ok: false, detalhe: (e as Error).message }; }
  return { ok: true, semConferencia: true,
    detalhe: 'o grok nao documenta conferencia de login; o despacho prova o login (erro de login do runtime vira runtime.auth-missing)' };
}

/** O runtime está disponível? No PATH do ambiente informado (o do filho, no despacho). */
export function disponivel(env: NodeJS.ProcessEnv = process.env): string | null {
  return noPath('grok', env);
}

/** Versão do runtime, para quem lista os runtimes. */
export function versao(): string | null {
  const r = executar('grok', ['--version'], undefined, 30000, ambienteDoDespacho());
  return r.ok ? r.stdout.trim() : null;
}

/** A casa do `grok`: o `GROK_HOME` do ambiente ou `~/.grok`, como o guia de sessões diz. */
export function casaDoGrok(env: NodeJS.ProcessEnv = process.env): string {
  const valor = (env.GROK_HOME ?? '').trim();
  return valor !== '' ? valor : path.join(os.homedir(), '.grok');
}

/** D3: o perfil de sandbox do `grok` para a postura; fora da tabela, recusa tipada. */
export function perfilDeSandbox(sandbox: string | undefined, colaboracao?: 'plan' | 'default'): string {
  if (colaboracao === 'plan') return 'read-only';
  if (sandbox === undefined) return PERFIL_DE_SANDBOX_PADRAO;
  if (!Object.hasOwn(PERFIL_DE_SANDBOX_DO_GROK, sandbox)) {
    throw new Error(`runtime.unavailable: sandbox ${sandbox} sem perfil do grok`);
  }
  return PERFIL_DE_SANDBOX_DO_GROK[sandbox];
}

/** RM-067 (F4b): o contexto do MCP já validado no receptor do despacho. */
type ContextoDoGrok = ReturnType<typeof validarContextoDoGrok>;

/** O contexto do MCP do despacho, revalidado aqui como nos outros adaptadores; sem ele, `null`. */
function contextoDoDespacho(pedido: DespachoGrokPedido): ContextoDoGrok | null {
  if (!pedido.contextoRuntime) return null;
  if (pedido.vinculo && pedido.contextoRuntime.threadId !== pedido.vinculo.thread)
    throw new Error('runtime.context.scope: thread do contexto difere do despacho');
  return validarContextoDoGrok(pedido.contextoRuntime, pedido.cwd);
}

function comandoDoDespacho(pedido: DespachoGrokPedido, contexto: ContextoDoGrok | null): string[] {
  const args = ['-p', pedido.prompt, '--output-format', 'streaming-json'];
  if (pedido.sessionId) args.push('-s', pedido.sessionId);
  args.push('--cwd', pedido.cwd, '--trust');
  if (pedido.model) args.push('-m', pedido.model);
  if (pedido.effort?.trim()) args.push('--effort', esforcoDoGrok(pedido.effort));
  args.push('--sandbox', perfilDeSandbox(pedido.sandbox, pedido.colaboracao), '--no-auto-update');
  // RM-067 (F4b, G2): com o MCP do ork, uma regra por ferramenta liberada, no fim, para o despacho sem contexto ficar igual
  // e a retomada (que guarda o que vem depois do `-s`) levar as mesmas regras.
  if (contexto) {
    for (const ferramenta of ferramentasDoGrok(contexto.permissoesFilho, pedido.colaboracao === 'plan', contexto.grafoMcp))
      args.push('--allow', `MCPTool(orkastery__${ferramenta})`);
  }
  return ['grok', ...args];
}

/**
 * D2: a linha de comando exata do despacho (usada também pelo `--dry-run`). O prompt fica no argumento 2, que o ledger
 * mascara. Nunca `--yolo`, `--always-approve` nem `--permission-mode`.
 *
 * RM-067 (F4, E8): `--trust` confia a pasta do `--cwd`, a worktree da thread, que é o checkout do próprio projeto. O guia
 * de regras de projeto do `grok` diz que o `AGENTS.md` só carrega na partida com a pasta confiada (`--trust` ou a
 * concessão interativa, que o headless não tem), e o de permissões diz que a partida headless com instruções do projeto
 * exige `--trust`. A confiança também liga, nessa pasta, as regras de permissão do projeto e os hooks de projeto que o
 * `grok` lê; não aprova ferramenta nenhuma.
 *
 * RM-067 (F4b, G2): num projeto preparado, o comando leva no fim um `--allow MCPTool(orkastery__<ferramenta>)` por
 * ferramenta do MCP do `ork` que o caso libera (`ferramentasDoGrok`), e nenhuma outra regra.
 */
export function montarComando(pedido: DespachoGrokPedido): string[] {
  return comandoDoDespacho(pedido, contextoDoDespacho(pedido));
}

/** RM-067 (F4b, G3): a primeira linha da config que o `ork` grava na worktree; sem ela, o arquivo não é do `ork`. */
export const MARCA_DA_CONFIG_DO_FILHO = '# Gerado pelo ork para a sessao filha do grok; o ork reescreve este arquivo a cada despacho.';
/**
 * RM-067 (F4b, GO-FIX A2): o `.gitignore` da pasta `.grok` só esconde o que o `ork` grava nela, pelo nome. Regra ou arquivo
 * novo que a sessão deixe em `.grok/` (o `grok` lê `.grok/rules/` na partida) segue visível ao git e à prova do GO.
 */
export const IGNORADOS_DA_CONFIG_DO_FILHO = '/config.toml\n/.gitignore\n/.ork-*.tmp\n';
const LIMITE_DA_CONFIG_BYTES = 65536;

/** RM-067 (F4c, D7): como a sessão filha alcança o servidor do `ork`: a URL do loopback e o arquivo do token. */
export interface ConexaoDoFilhoGrok { url: string; bearerTokenFile: string }

/** D1 da F4c: a única URL que a config da worktree aceita, a do servidor do `ork` no loopback. */
const URL_DO_SERVIDOR_DO_ORK = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/mcp$/;

/**
 * RM-067 (F4b, G3 e G7; F4c, D7): o `.grok/config.toml` da worktree, com o servidor do `ork` vinculado à thread e ao
 * despacho. Desde a F4c, a entrada é a forma `url` do guia oficial (G16): a URL do servidor do `ork` no loopback e o
 * `bearer_token_file`, que o `grok` lê a cada requisição; nada de `command`, `args` ou `env`, porque o servidor não é mais
 * filho do `grok`. O `grok` expande `${VAR}` na `url` e no `bearer_token_file` (G16): valor com `$` recusa, porque o
 * servidor alcançado seria outro. O texto volta pelo parser de TOML e o documento inteiro tem de ser exatamente a entrada
 * pedida (GO-FIX S2).
 */
export function configDoFilho(conexao: ConexaoDoFilhoGrok, threadId: string): string {
  const campos: [string, string][] = [['url', conexao.url], ['bearer_token_file', conexao.bearerTokenFile]];
  const comCifrao = campos.find(([, valor]) => valor.includes('$'));
  if (comCifrao) throw new Error(`runtime.context.conflict: ${comCifrao[0]} do servidor do ork tem $, que o grok expandiria; use um caminho sem $`);
  if (!URL_DO_SERVIDOR_DO_ORK.test(conexao.url))
    throw new Error('runtime.context.conflict: a url do servidor do ork nao e a do loopback local (http://127.0.0.1:<porta>/mcp)');
  if (!path.isAbsolute(conexao.bearerTokenFile))
    throw new Error('runtime.context.conflict: o bearer_token_file do servidor do ork nao e um caminho absoluto');
  const texto = [MARCA_DA_CONFIG_DO_FILHO, `# thread ${threadId}`, '[mcp_servers.orkastery]',
    `url = ${JSON.stringify(conexao.url)}`, `bearer_token_file = ${JSON.stringify(conexao.bearerTokenFile)}`].join('\n') + '\n';
  let lido: string;
  try { lido = JSON.stringify(parse(texto)); }
  catch { throw new Error('runtime.context.conflict: a config do servidor do ork nao sai como TOML valido'); }
  const esperado = JSON.stringify({ mcp_servers: { orkastery: { url: conexao.url, bearer_token_file: conexao.bearerTokenFile } } });
  if (lido !== esperado) throw new Error('runtime.context.conflict: a config do servidor do ork nao volta igual pelo TOML');
  return texto;
}

/** O texto de um arquivo comum e pequeno, sem seguir link; ausente vira `null`, e o resto recusa. */
function textoDaWorktree(arquivo: string): string | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`runtime.context.conflict: .grok/${path.basename(arquivo)} da worktree e link ou ilegivel; o ork nao escreve por cima`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_DA_CONFIG_BYTES)
      throw new Error(`runtime.context.conflict: .grok/${path.basename(arquivo)} da worktree nao e arquivo comum pequeno`);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

/** Grava um arquivo pequeno por temporário e `rename`, na mesma pasta. */
function gravarNaWorktree(arquivo: string, texto: string): void {
  const temp = path.join(path.dirname(arquivo), `.ork-${randomUUID()}.tmp`);
  try { fs.writeFileSync(temp, texto, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, arquivo); }
  finally { fs.rmSync(temp, { force: true }); }
}

/**
 * RM-067 (F4b, G3 e D3): grava a config da sessão filha na worktree, fora do git e sem apagar arquivo de ninguém. Recusa
 * antes de escrever: `.grok` que é link ou não é pasta, `config.toml` ou `.gitignore` versionados, link no lugar de
 * arquivo e config sem a marca do `ork`. O `.gitignore` com os nomes dos arquivos do `ork` só nasce quando falta (nunca
 * reescreve o de outro), e o `git status` dos dois arquivos tem de sair vazio depois; se não sair, desfaz o que gravou e
 * recusa.
 */
export function gravarConfigDaWorktree(cwd: string, texto: string): void {
  const pasta = path.join(cwd, '.grok'), arquivo = path.join(pasta, 'config.toml'), ignorar = path.join(pasta, '.gitignore');
  const st = fs.lstatSync(pasta, { throwIfNoEntry: false });
  if (st && (st.isSymbolicLink() || !st.isDirectory()))
    throw new Error('runtime.context.worktree: .grok da worktree e link ou nao e pasta; o ork nao grava a config da sessao por ele');
  const git = (args: string[]): string => {
    const r = executar('git', args, cwd, 30000);
    if (!r.ok) throw new Error(`runtime.context.conflict: git ${args[0]} da worktree falhou`);
    return r.stdout.trim();
  };
  const versionados = git(['ls-files', '--', '.grok/config.toml', '.grok/.gitignore']);
  if (versionados) {
    throw new Error(`runtime.context.conflict: ${versionados.split('\n').join(', ')} versionado na worktree; ` +
      'o ork grava o servidor da sessao num arquivo fora do git');
  }
  const anterior = textoDaWorktree(arquivo);
  if (anterior !== null && !anterior.startsWith(`${MARCA_DA_CONFIG_DO_FILHO}\n`))
    throw new Error('runtime.context.conflict: .grok/config.toml da worktree nao e do ork; mova o arquivo para o ork gravar o servidor da sessao');
  const ignorarAntes = textoDaWorktree(ignorar);
  if (!st) fs.mkdirSync(pasta, { mode: 0o700 });
  try {
    if (ignorarAntes === null) gravarNaWorktree(ignorar, IGNORADOS_DA_CONFIG_DO_FILHO);
    gravarNaWorktree(arquivo, texto);
    if (git(['status', '--porcelain', '--untracked-files=all', '--', '.grok/config.toml', '.grok/.gitignore']))
      throw new Error('runtime.context.conflict: a config da sessao ficaria visivel ao git na worktree; confira o .gitignore de .grok');
  } catch (e) {
    // Desfaz só o que este despacho gravou: a config anterior do ork volta, e o que nasceu agora sai.
    if (anterior !== null) gravarNaWorktree(arquivo, anterior); else fs.rmSync(arquivo, { force: true });
    if (ignorarAntes === null) fs.rmSync(ignorar, { force: true });
    if (!st) { try { fs.rmdirSync(pasta); } catch { /* sobrou arquivo que não é deste despacho */ } }
    throw e;
  }
}

/**
 * D11: a retomada de uma sessão interrompida, derivada do comando do despacho (o do ledger tem o prompt mascarado): o
 * argumento 2 vira o texto da retomada e `-s <id>` vira `-r <id>`; o resto (cwd, modelo, esforço, sandbox) fica. O guia
 * diz que a sessão interrompida guarda o estado até a última ferramenta concluída. Comando que não é do `grok`, ou sem
 * `-s <id>`, devolve `null`.
 */
export function montarComandoDeRetomada(comando: readonly string[], sessionId: string, texto = 'continue'): string[] | null {
  if (comando[0] !== 'grok' || comando[1] !== '-p' || comando.length < 3) return null;
  const i = comando.indexOf('-s', 3);
  if (i < 0 || comando[i + 1] !== sessionId) return null;
  return [...comando.slice(0, 2), texto, ...comando.slice(3, i), '-r', sessionId, ...comando.slice(i + 2)];
}

/** A pasta da sessão no disco do runtime e o tamanho do `updates.jsonl`. */
export interface SessaoGrokEmDisco { dir: string; updates: string; tamanho: number; mtimeMs: number }

/**
 * D5: a pasta `<casa>/sessions/<grupo>/<id>/` com `updates.jsonl` arquivo comum. A codificação do cwd no nome do grupo
 * não é documentada, então a busca olha o id um nível abaixo de `sessions/`, sem seguir link. Exatamente um grupo com a
 * sessão, ou `null`: o id que aparece em dois grupos não prova qual é a sessão despachada.
 */
export function acharSessaoGrok(sessionId: string, casa: string = casaDoGrok()): SessaoGrokEmDisco | null {
  if (!ID_DE_SESSAO.test(sessionId)) return null;
  const raiz = path.join(casa, 'sessions');
  let grupos: fs.Dirent[];
  try {
    if (!fs.lstatSync(raiz).isDirectory()) return null;
    grupos = fs.readdirSync(raiz, { withFileTypes: true });
  } catch { return null; }
  const achadas: SessaoGrokEmDisco[] = [];
  for (const grupo of grupos) {
    if (!grupo.isDirectory()) continue;
    const dir = path.join(raiz, grupo.name, sessionId);
    try {
      if (!fs.lstatSync(dir).isDirectory()) continue;
      const updates = path.join(dir, 'updates.jsonl');
      const st = fs.lstatSync(updates);
      if (st.isFile()) achadas.push({ dir, updates, tamanho: st.size, mtimeMs: st.mtimeMs });
    } catch { /* o grupo não tem a sessão */ }
  }
  return achadas.length === 1 ? achadas[0] : null;
}

/** RM-067 (F4): o que o inventário leu de uma conta do `grok`. */
export interface ConsultaDeSessoesGrok {
  ok: boolean;
  /** A pasta `sessions/` da casa ainda não existe: a conta nunca abriu sessão nesta máquina. */
  ausente: boolean;
  sessoes: SessaoRuntime[];
  detalhe: string;
}

/**
 * RM-067 (F4): as sessões de uma casa do `grok` para o inventário (`ork sessions`), pela fonte que o próprio runtime grava:
 * cada pasta `<casa>/sessions/<grupo>/<id>/` com o `updates.jsonl`. Como na prova de existência (D5), o `ork` lista nomes
 * e lê o mtime e o tamanho do arquivo, nunca o conteúdo; a atividade é o mtime. O grupo é o cwd codificado, cuja
 * codificação o guia não documenta, então o cwd da sessão fica sem valor. Link e entrada estranha deixam a consulta
 * parcial (`ok: false`), nunca "zero sessões".
 */
export function consultarSessoesGrok(casa: string = casaDoGrok()): ConsultaDeSessoesGrok {
  const raiz = path.join(casa, 'sessions');
  let grupos: fs.Dirent[];
  try {
    const st = fs.lstatSync(raiz);
    if (!st.isDirectory()) return { ok: false, ausente: false, sessoes: [], detalhe: 'sessions nao e pasta comum' };
    grupos = fs.readdirSync(raiz, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, ausente: true, sessoes: [], detalhe: 'sem a pasta sessions' };
    return { ok: false, ausente: false, sessoes: [], detalhe: 'pasta sessions inacessivel' };
  }
  const sessoes: SessaoRuntime[] = [];
  let parcial = false;
  for (const grupo of grupos) {
    if (!grupo.isDirectory()) { parcial ||= grupo.isSymbolicLink(); continue; }
    let ids: fs.Dirent[];
    try { ids = fs.readdirSync(path.join(raiz, grupo.name), { withFileTypes: true }); }
    catch { parcial = true; continue; }
    for (const id of ids) {
      if (!ID_DE_SESSAO.test(id.name)) continue;
      if (!id.isDirectory()) { parcial ||= id.isSymbolicLink(); continue; }
      try {
        const st = fs.lstatSync(path.join(raiz, grupo.name, id.name, 'updates.jsonl'));
        if (st.isFile()) sessoes.push({ sessionId: id.name, kind: 'grok', atividadeEm: st.mtimeMs });
        else parcial = true;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') parcial = true; }
    }
  }
  return { ok: !parcial, ausente: false, sessoes,
    detalhe: parcial ? 'inventario parcial; a pasta sessions tem link ou entrada ilegivel' : '' };
}

/** JSON pequeno de metadado do supervisor, sem seguir link; ausente ou ilegível vira `null`. */
function lerMetadado<T>(arquivo: string): T | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_METADADO_BYTES) return null;
    const bytes = Buffer.alloc(st.size);
    fs.readSync(fd, bytes, 0, st.size, 0);
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch { return null; }
  finally { fs.closeSync(fd); }
}

/**
 * A cauda do stderr do filho, redigida e sem corte; ausente vira vazio. GO-FIX 1 (A4): a janela começa no meio de uma
 * linha, e esse pedaço sai inteiro antes da redação, para nenhum segredo cortado perder o prefixo que a redação reconhece.
 */
function caudaDoStderr(arquivo: string): string {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return ''; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return '';
    const n = Math.min(st.size, LIMITE_STDERR_BYTES), bytes = Buffer.alloc(n);
    fs.readSync(fd, bytes, 0, n, st.size - n);
    let texto = bytes.toString('utf8');
    if (st.size > n) {
      const quebra = texto.indexOf('\n');
      texto = quebra < 0 ? '' : texto.slice(quebra + 1);
    }
    return redigirTextoGrok(texto);
  } finally { fs.closeSync(fd); }
}

/**
 * GO-FIX 2 (N6): o fim do texto em até `limite` unidades UTF-16, a mesma unidade do `slice` de quem grava no ledger, que
 * assim não tira nada; o corte não começa na metade baixa de um par substituto.
 */
function fimDoTexto(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const fim = texto.slice(-limite);
  const primeira = fim.charCodeAt(0);
  return primeira >= 0xdc00 && primeira <= 0xdfff ? fim.slice(1) : fim;
}

const pausa = new Int32Array(new SharedArrayBuffer(4));

/**
 * D6: despacha a fase e confere no disco do runtime que a sessão existe. Nunca self-report: o id é do `ork`, a pasta é
 * do `grok`, e a falha antes da sessão vem do recibo do supervisor e do objeto `error` do stream.
 */
export function despachar(pedido: DespachoGrokPedido): DespachoGrokResultado {
  const sessionId = pedido.sessionId ?? randomUUID();
  const falha = (erro: string, extra: Partial<DespachoGrokResultado> = {}): DespachoGrokResultado =>
    ({ ok: false, comando: [], sessionId: null, verificada: false, stdout: '', stderr: '', erro, ...extra });
  let comando: string[];
  let ambiente: NodeJS.ProcessEnv;
  let contexto: ContextoDoGrok | null;
  try { contexto = contextoDoDespacho(pedido); }
  catch (e) { return falha(`runtime.unavailable: ${(e as Error).message}`); }
  try { comando = comandoDoDespacho({ ...pedido, sessionId }, contexto); ambiente = ambienteDoFilho(pedido); }
  catch (e) { return falha((e as Error).message); }
  if (pedido.dryRun) return { ok: true, comando, sessionId: null, verificada: false, stdout: '', stderr: '' };
  if (!disponivel(ambiente)) return falha('runtime.unavailable: binario grok nao encontrado no PATH', { comando });
  // O log nunca vai para a worktree: a prova do GO exige a worktree limpa.
  if (!pedido.logDir || !path.isAbsolute(pedido.logDir)) {
    return falha('runtime.unavailable: despacho grok sem o diretorio de logs da thread', { comando });
  }
  const logPath = path.join(pedido.logDir, `${sessionId}.grok.jsonl`);
  // RM-067 (F4c, D6 e D7): com o MCP, o servidor do ork sobe antes de tudo, fora do sandbox do grok, com as ferramentas do
  // --allow deste despacho; a config da worktree aponta para ele e vai antes do supervisor, porque o grok a lê na partida,
  // com a pasta confiada (F4b, G3). Toda falha depois de o servidor subir o encerra.
  let servidor: ServidorDoGrokIniciado | null = null;
  if (contexto) {
    const especificacao = contexto.servidor;
    if (!especificacao.dispatchId)
      return falha('runtime.unavailable: runtime.context.identity: o grok com o MCP do ork exige a identidade do despacho', { comando });
    try {
      servidor = iniciarServidorDoGrok({ projeto: especificacao.projeto, threadId: especificacao.threadId,
        dispatchId: especificacao.dispatchId, permissoesFilho: especificacao.permissoesFilho, transporteShip: especificacao.transporteShip,
        ferramentas: ferramentasDoGrok(contexto.permissoesFilho, pedido.colaboracao === 'plan', contexto.grafoMcp), logPath },
      pedido.cwd, { ...ambiente, ...(especificacao.env ?? {}) });
    } catch (e) { return falha((e as Error).message, { comando }); }
    try { gravarConfigDaWorktree(pedido.cwd, configDoFilho({ url: servidor.url, bearerTokenFile: servidor.tokenPath }, contexto.threadId)); }
    catch (e) { servidor.encerrar(); return falha(`runtime.unavailable: ${(e as Error).message}`, { comando }); }
  }
  let sensores: { processoPath: string; reciboPath: string };
  try { sensores = iniciarSupervisor(comando, pedido.cwd, logPath, ambiente); }
  catch (e) {
    servidor?.encerrar();
    return falha(`runtime.unavailable: o supervisor do grok nao iniciou (${(e as NodeJS.ErrnoException).code ?? 'erro'})`, { comando });
  }
  const base = { comando, logPath, ...sensores };
  const casa = casaDoGrok(ambiente);
  const prazo = Date.now() + (pedido.esperaMs ?? ESPERA_PADRAO_MS);
  for (;;) {
    if (acharSessaoGrok(sessionId, casa)) return { ok: true, sessionId, verificada: true, stdout: '', stderr: '', ...base };
    const recibo = lerMetadado<ReciboCodex>(sensores.reciboPath);
    if (recibo) return falhaAntesDaSessao(recibo, sessionId, base);
    if (Date.now() >= prazo) break;
    Atomics.wait(pausa, 0, 0, 100);
  }
  const recibo = lerMetadado<ReciboCodex>(sensores.reciboPath);
  if (recibo) return falhaAntesDaSessao(recibo, sessionId, base);
  // Filho vivo sem a pasta no prazo: a sessão segue, sem prova de existência ainda; o watcher a acompanha.
  const processo = lerMetadado<ProcessoCodex>(sensores.processoPath);
  if (processo?.filho && estadoProcesso(processo.filho) === 'vivo') {
    return { ok: true, sessionId, verificada: false, stdout: '', stderr: '', ...base };
  }
  servidor?.encerrar();
  return falha('runtime.unavailable: o supervisor do grok nao registrou o processo vivo no prazo', base);
}

/**
 * O processo terminou antes de a sessão existir. A falha da conta vem do objeto `error` do stream e, sem ele, do stderr
 * do próprio runtime; o rate limit de janela curta volta tipado para a fila; o resto é `runtime.unavailable` com o código.
 */
function falhaAntesDaSessao(recibo: ReciboCodex, sessionId: string,
    base: { comando: string[]; logPath: string; processoPath: string; reciboPath: string }): DespachoGrokResultado {
  const estado = lerStreamGrok(base.logPath, sessionId);
  const cauda = caudaDoStderr(`${base.logPath}.stderr`);
  const mensagem = estado?.erro?.mensagem ?? '';
  const texto = [mensagem, cauda].filter(Boolean).join('\n');
  const falhaDeConta = falhaDoErroGrok(estado?.erro ?? null) ?? (cauda ? falhaDeContaDoTextoGrok(cauda) : null);
  const rateLimit = falhaDeConta ? null : parseRateLimit(texto);
  // Ao ledger vai o fim da cauda, onde o erro mora; quem grava corta pelo começo.
  const stderr = fimDoTexto(cauda, LIMITE_STDERR_NO_RESULTADO);
  // O erro de spawn (o binário sumiu entre a conferência e o supervisor) vem antes do código, que o Node dá negativo.
  const codigo = recibo.erro ?? recibo.exitCode ?? recibo.signal ?? 'sem codigo';
  const erro = falhaDeConta ? `${falhaDeConta.motivo}: ${falhaDeConta.trecho}`
    : rateLimit ? `limite de uso do runtime atingido: ${rateLimit.trecho}`
    : `runtime.unavailable: o grok saiu ${codigo} antes de criar a sessao${mensagem ? `: ${mensagem}` : ''}`;
  return { ok: false, sessionId: null, verificada: false, stdout: '', stderr, erro, falhaDeConta, rateLimit, ...base };
}
