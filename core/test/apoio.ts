/** Apoio dos testes do bloco B1: repositorios git temporarios, com e sem remoto. */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { init } from '../src/init';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { exec } from '../src/util';
import { lerLedger } from '../src/ledger';
import { estadoProcesso, IdentidadeProcesso } from '../src/adapters/codex-runner';
import { adicionarPerfil } from '../src/runtime-profiles';
import { ENV_HITL_VERIFIERS } from '../src/hitl-public-receipt';

// I-49: o registro compartilhado de contas dos testes vive numa pasta propria, nunca no home
// de quem roda a suite. Vale para os processos filhos, que herdam o ambiente.
if (!process.env.ORK_CONTAS_DIR) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-contas-'));
  process.env.ORK_CONTAS_DIR = path.join(base, 'private');
  process.once('exit', () => fs.rmSync(base, { recursive: true, force: true }));
}
// I-51: nenhum teste publica o estado da fabrica em segundo plano; quem testa a publicacao chama
// `publicarMaquina` direto, contra um remoto bare temporario.
if (process.env.ORK_FABRICA_PUBLICAR === undefined) process.env.ORK_FABRICA_PUBLICAR = '0';
// I-51: a configuracao da maquina (`~/.orkastery/maquina.json`) dos testes tambem e propria.
if (!process.env.ORK_USUARIO_DIR) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-usuario-'));
  process.env.ORK_USUARIO_DIR = base;
  process.once('exit', () => fs.rmSync(base, { recursive: true, force: true }));
}

/**
 * I-35 (GO-FIX 1): zera a autoridade HITL herdada do shell de quem roda a suite.
 *
 * Quem exporta ORK_HITL_INGRESS_KEY* de verdade na propria maquina muda o que o
 * nucleo produz: `validarContextoRuntime` deriva ORK_RECEIPT_VERIFIERS e passa a
 * injetar `env` na entrada MCP do filho, e o adaptador OpenClaw falha fechado
 * quando nao consegue os verificadores. Os testes que comparam a forma dessa
 * entrada ou o caminho feliz do adaptador descrevem um host SEM credencial
 * provisionada, entao o veredito deles nao pode depender do ambiente de quem
 * executa. Mesma disciplina do TZ fixo: o cenario vem do teste, nunca do shell.
 *
 * Vale para o processo inteiro. O `node --test` isola cada arquivo em um
 * processo proprio, entao chamar no escopo do modulo nao vaza para outro
 * arquivo. Os testes que PRECISAM de autoridade HITL montam as proprias chaves
 * de fixture e nao chamam esta funcao.
 */
export function semAutoridadeHitlNoAmbiente(): void {
  for (const nome of Object.keys(process.env))
    if (nome.startsWith('ORK_HITL_') || nome === ENV_HITL_VERIFIERS) delete process.env[nome];
}

/** Diretorio temporario com caminho real (o macOS e o /tmp do linux usam symlink). */
export function dirTemporario(nome: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-test-${nome}-`)));
}

function configurarGit(dir: string): void {
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
}

/** Commita um arquivo no diretorio informado e devolve o sha do commit. */
export function commitar(dir: string, arquivo: string, conteudo: string, mensagem: string): string {
  const destino = path.join(dir, arquivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, 'utf8');
  exec('git', ['add', '--', arquivo], dir);
  exec('git', ['commit', '-m', mensagem], dir);
  return exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
}

export interface ProjetoDeTeste {
  dir: string;
  /** Recarregado por `ajustarManifesto` quando o teste mexe no `orkastery.yaml`. */
  carregado: ManifestoCarregado;
  /** Caminho do repositorio bare que serve de `origin`, quando o projeto tem remoto. */
  remoto: string | null;
  limpar: () => void;
}

/**
 * I-34 (achado 1 do CHECK 2764ac5f): o despacho claude-bg inicia um watcher destacado que
 * escreve na pasta da thread. Apagar o projeto com ele vivo corre com o `rmSync` (ENOTEMPTY)
 * e deixa resíduo em `/tmp`. Cada watcher é encerrado pela identidade gravada em
 * `session_watcher_started`, nunca por pid solto, e a limpeza espera o processo sumir.
 */
export function encerrarWatchers(dir: string): void {
  const threads = path.join(dir, '.orkastery', 'threads');
  if (!fs.existsSync(threads)) return;
  const encerrados: IdentidadeProcesso[] = [];
  for (const id of fs.readdirSync(threads)) {
    for (const e of lerLedger(path.join(threads, id))) {
      const identidade = e.identidade as IdentidadeProcesso | undefined;
      if (e.tipo !== 'session_watcher_started' || !identidade || estadoProcesso(identidade) !== 'vivo') continue;
      try { process.kill(identidade.pid, 'SIGTERM'); encerrados.push(identidade); } catch { /* já saiu */ }
    }
  }
  const prazo = Date.now() + 5000, pausa = new Int32Array(new SharedArrayBuffer(4));
  while (encerrados.some(v => estadoProcesso(v) === 'vivo') && Date.now() < prazo) Atomics.wait(pausa, 0, 0, 10);
}

/** Projeto git temporario com manifesto do `ork` gerado pelo proprio `ork init`. */
export function projetoTemporario(nome: string, comRemoto = false): ProjetoDeTeste {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-b', 'main'], dir);
  configurarGit(dir);
  commitar(dir, 'README.md', '# projeto de teste\n', 'inicial');

  let remoto: string | null = null;
  if (comRemoto) {
    remoto = dirTemporario(`${nome}-origin`);
    exec('git', ['init', '--bare', '-b', 'main'], remoto);
    exec('git', ['remote', 'add', 'origin', remoto], dir);
    exec('git', ['push', '-u', 'origin', 'main'], dir);
  }

  init(dir, { nome: 'orkastery', abbrev: 'ork' });
  const carregado = exigirManifesto(dir);
  return {
    dir,
    carregado,
    remoto,
    limpar: () => {
      encerrarWatchers(dir);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (remoto) fs.rmSync(remoto, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** sha de uma branch local do repositorio. */
export function shaDaBranch(dir: string, branch: string): string {
  return exec('git', ['rev-parse', '--verify', branch], dir).stdout.trim();
}

/** sha que o REMOTO reporta para a branch (a mesma prova que o `ork ship` usa). */
export function shaNoRemotoDeTeste(dir: string, remoto: string, branch: string): string {
  const r = exec('git', ['ls-remote', remoto, `refs/heads/${branch}`], dir);
  return r.stdout.split(/\s+/)[0] ?? '';
}

// ---------------------------------------------------------------------------
// Bloco B3: runtime FALSO para provar retry e retomada sem despachar de verdade.
// ---------------------------------------------------------------------------

/**
 * Stub do binario `claude` usado pelos testes de autonomia.
 *
 * Existe porque o criterio de sucesso do B3 e "a fase morta por rate limit e retomada
 * sem intervencao humana": provar isso com `--dry-run` provaria so a intencao. O stub
 * deixa o caminho REAL rodar (despacho, extracao de sessionId, re-verificacao em
 * `claude agents --json`), com o runtime trocado por um script que a gente controla.
 */
const SCRIPT_DO_RUNTIME = `#!/bin/sh
DIR="$ORK_STUB_DIR"
if [ "$1" = "--version" ]; then echo "stub de teste 0.0.1"; exit 0; fi
if [ "$1" = "agents" ]; then
  if [ -f "$DIR/sessao" ]; then
    ESTADO="working"
    if [ -f "$DIR/state" ]; then ESTADO="$(cat "$DIR/state")"; fi
    EXTRA=""
    if [ -f "$DIR/pid" ]; then EXTRA="$EXTRA,\\"pid\\":$(cat "$DIR/pid")"; fi
    if [ -f "$DIR/status" ]; then EXTRA="$EXTRA,\\"status\\":\\"$(cat "$DIR/status")\\""; fi
    printf '[{"id":"%s","sessionId":"%s","name":"%s","cwd":"%s","kind":"background","state":"%s","startedAt":%s%s}]\\n' \\
      "$(cut -c1-8 "$DIR/sessao")" "$(cat "$DIR/sessao")" \\
      "$(cat "$DIR/nome" 2>/dev/null)" "$(cat "$DIR/cwd" 2>/dev/null)" \\
      "$ESTADO" "$(cat "$DIR/started" 2>/dev/null || echo "$(date +%s)000")" "$EXTRA"
  else
    echo '[]'
  fi
  exit 0
fi
if [ "$1" = "logs" ]; then
  if [ -f "$DIR/logs" ]; then
    cat "$DIR/logs"
    exit 0
  fi
  echo "Couldn't read logs for $2 - job not found - it may have already exited" >&2
  exit 1
fi
nome=""
anterior=""
for a in "$@"; do
  if [ "$anterior" = "--name" ]; then nome="$a"; fi
  anterior="$a"
done
printf '%s' "$nome" > "$DIR/nome"
pwd > "$DIR/cwd"
echo "$nome" >> "$DIR/chamadas"
printf '%s' "$ORK_DISPATCH_ID" > "$DIR/dispatch-id"
printf '%s' "$ORK_CANAL" > "$DIR/canal"
if [ -f "$DIR/rate-limit" ]; then
  rm -f "$DIR/rate-limit"
  cat "$DIR/stderr" >&2
  exit 1
fi
SESSAO="11111111-2222-3333-4444-555555555555"
printf '%s' "$SESSAO" > "$DIR/sessao"
echo "Background agent started: $SESSAO"
exit 0
`;

export interface RuntimeFalso {
  dir: string;
  /** UUID que o stub devolve como sessao despachada. */
  sessionId: string;
  /** Faz o PROXIMO despacho morrer com este stderr (e so o proximo). */
  proximoDespachoMorreDeRateLimit: (stderr: string) => void;
  /** Troca o `state` que o `claude agents --json` reporta para a sessao despachada. */
  estadoDaSessao: (state: string) => void;
  /** I-34: `pid` do processo vivo (ou `null` para omitir, como o CLI faz depois da morte). */
  pidDaSessao: (pid: number | null) => void;
  /** I-34: `status` (`idle`/`busy`) que só aparece enquanto o processo vive. */
  statusDaSessao: (status: string | null) => void;
  /** Define o dump de tela que o `claude logs` devolve (sem isso, "job not found"). */
  telaDaSessao: (texto: string | null) => void;
  /** Slugs (`--name`) que o runtime recebeu, em ordem. */
  chamadas: () => string[];
  restaurar: () => void;
}

/** Instala o stub do `claude` no PATH deste processo de teste. */
export function runtimeFalso(nome: string): RuntimeFalso {
  const dir = dirTemporario(`runtime-${nome}`);
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, SCRIPT_DO_RUNTIME, { encoding: 'utf8', mode: 0o755 });
  const pathAnterior = process.env.PATH ?? '';
  const stubAnterior = process.env.ORK_STUB_DIR;
  process.env.PATH = `${dir}:${pathAnterior}`;
  process.env.ORK_STUB_DIR = dir;
  // I-34: sessão viva tem `pid` no `claude agents`; o do processo de teste é uma prova de vida real.
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid), 'utf8');
  return {
    dir,
    sessionId: '11111111-2222-3333-4444-555555555555',
    estadoDaSessao: (state: string) => {
      fs.writeFileSync(path.join(dir, 'state'), state, 'utf8');
    },
    pidDaSessao: (pid: number | null) => {
      if (pid === null) fs.rmSync(path.join(dir, 'pid'), { force: true });
      else fs.writeFileSync(path.join(dir, 'pid'), String(pid), 'utf8');
    },
    statusDaSessao: (status: string | null) => {
      if (status === null) fs.rmSync(path.join(dir, 'status'), { force: true });
      else fs.writeFileSync(path.join(dir, 'status'), status, 'utf8');
    },
    telaDaSessao: (texto: string | null) => {
      const arquivo = path.join(dir, 'logs');
      if (texto === null) fs.rmSync(arquivo, { force: true });
      else fs.writeFileSync(arquivo, texto, 'utf8');
    },
    proximoDespachoMorreDeRateLimit: (stderr: string) => {
      fs.writeFileSync(path.join(dir, 'stderr'), stderr, 'utf8');
      fs.writeFileSync(path.join(dir, 'rate-limit'), '1', 'utf8');
      fs.rmSync(path.join(dir, 'sessao'), { force: true });
    },
    chamadas: () => {
      const arquivo = path.join(dir, 'chamadas');
      if (!fs.existsSync(arquivo)) return [];
      return fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.trim() !== '');
    },
    restaurar: () => {
      process.env.PATH = pathAnterior;
      if (stubAnterior === undefined) delete process.env.ORK_STUB_DIR;
      else process.env.ORK_STUB_DIR = stubAnterior;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Troca um trecho do `orkastery.yaml` do projeto de teste e recarrega o manifesto. */
/**
 * I-33 (D14, D16): liga EXPLICITAMENTE a troca automatica por cota entre perfis do MESMO runtime.
 * Desde a D16 ela ja vem ligada por padrao; os testes da D5 continuam declarando a chave que exercitam.
 */
export function ligarRotacaoPorCota(p: ProjetoDeTeste): void {
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nruntime_profiles:\n  rotate_same_runtime_on_quota: true\n');
  p.carregado = exigirManifesto(p.dir);
  if (p.carregado.manifesto.runtime_profiles.rotate_same_runtime_on_quota !== true) throw new Error('chave de rotacao nao lida');
}

/** I-33 (D16): o operador desliga a troca por cota no manifesto; a chave continua existindo para isso. */
export function desligarRotacaoPorCota(p: ProjetoDeTeste): void {
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nruntime_profiles:\n  rotate_same_runtime_on_quota: false\n');
  p.carregado = exigirManifesto(p.dir);
  if (p.carregado.manifesto.runtime_profiles.rotate_same_runtime_on_quota !== false) throw new Error('chave de rotacao nao lida');
}

export function ajustarManifesto(p: ProjetoDeTeste, de: RegExp | string, para: string): void {
  const caminho = path.join(p.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(caminho, 'utf8');
  const novo = typeof de === 'string' ? bruto.replace(de, para) : bruto.replace(de, para);
  if (novo === bruto) throw new Error(`ajustarManifesto nao casou: ${String(de)}`);
  fs.writeFileSync(caminho, novo, 'utf8');
  p.carregado = exigirManifesto(p.dir);
}

// ---------------------------------------------------------------------------
// I-33: runtime POR CONTA, para provar perfis sem tocar em conta real.
// ---------------------------------------------------------------------------

/**
 * Stub do `claude` que responde por conta (`CLAUDE_CONFIG_DIR`): `auth status` aprova so com o
 * marcador de login da conta (assinatura `claude.ai`; com `.stub-pago`, login por `api_key_helper`; com
 * `.stub-auth-lixo` ou `.stub-auth-sinal`, resposta ilegivel ou morte sem codigo de saida), o `--bg` recusa com a frase gravada em `.stub-falha` da conta, e
 * `agents` so lista a sessao para a conta que a despachou, no estado de `$DIR/state`. Cada
 * chamada grava `<subcomando> <CLAUDE_CONFIG_DIR>` em `envs`: e a captura de env que prova
 * por qual conta o `ork` falou. Os marcadores sao do stub (o CLI simulado), nunca do `ork`.
 */
const SCRIPT_POR_CONTA = `#!/bin/sh
DIR="$ORK_CONTA_STUB_DIR"
echo "$1 $CLAUDE_CONFIG_DIR" >> "$DIR/envs"
if [ "$1" = "--version" ]; then echo "stub por conta 0.0.1"; exit 0; fi
if [ "$1" = "auth" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-auth-lixo" ]; then echo "resposta ilegivel do stub"; exit 0; fi
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-auth-sinal" ]; then kill -9 $$; fi
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-pago" ]; then
    printf '{"loggedIn":true,"authMethod":"api_key_helper","apiProvider":"firstParty","apiKeySource":"apiKeyHelper","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"
    exit 0
  fi
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-logado" ]; then L=true; else L=false; fi
  printf '{"loggedIn":%s,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$L" "$CLAUDE_CONFIG_DIR"
  [ "$L" = true ] && exit 0 || exit 1
fi
if [ "$1" = "agents" ]; then
  ESTADO=working; [ -f "$DIR/state" ] && ESTADO="$(cat "$DIR/state")"
  if [ -f "$DIR/conta" ] && [ "$(cat "$DIR/conta")" = "$CLAUDE_CONFIG_DIR" ]; then
    printf '[{"id":"%s","sessionId":"%s","name":"x","cwd":"%s","kind":"background","state":"%s","pid":%s}]\\n' \\
      "$(cut -c1-8 "$DIR/sessao")" "$(cat "$DIR/sessao")" "$(cat "$DIR/cwd")" "$ESTADO" "$(cat "$DIR/pid")"
  else echo '[]'; fi
  exit 0
fi
if [ "$1" = "logs" ] || [ "$1" = "stop" ]; then exit 0; fi
if [ -f "$CLAUDE_CONFIG_DIR/.stub-falha" ]; then cat "$CLAUDE_CONFIG_DIR/.stub-falha" >&2; exit 1; fi
N=$(cat "$DIR/n" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$DIR/n"
SESSAO=$(printf '99999999-0000-4000-8000-%012d' "$N")
printf '%s' "$SESSAO" > "$DIR/sessao"
printf '%s' "$CLAUDE_CONFIG_DIR" > "$DIR/conta"
pwd > "$DIR/cwd"
echo "Background agent started: $SESSAO"
exit 0
`;

export interface RuntimePorConta {
  dir: string;
  /** Cria o diretorio da conta, o marcador de login e a falha do `--bg`, e cadastra o perfil. */
  conta: (raiz: string, id: string, opcoes?: { logado?: boolean; falha?: string; pago?: boolean }) => string;
  /** Troca a falha do `--bg` da conta (null remove: a conta voltou a despachar). */
  falhaDaConta: (dirConta: string, falha: string | null) => void;
  estadoDaSessao: (state: string) => void;
  /** Linhas `<subcomando> <CLAUDE_CONFIG_DIR>` na ordem das chamadas. */
  envs: () => string[];
  restaurar: () => void;
}

export function runtimePorConta(nome: string): RuntimePorConta {
  const dir = dirTemporario(`conta-${nome}`);
  fs.writeFileSync(path.join(dir, 'claude'), SCRIPT_POR_CONTA, { encoding: 'utf8', mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid), 'utf8');
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_CONTA_STUB_DIR, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${dir}:${anterior.PATH ?? ''}`;
  process.env.ORK_CONTA_STUB_DIR = dir;
  // O processo `ork` do teste fica numa conta sem login: so o perfil despacha.
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'conta-do-processo');
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return {
    dir,
    conta: (raiz, id, opcoes = {}) => {
      const conta = path.join(raiz, 'contas', id);
      fs.mkdirSync(conta, { recursive: true });
      if (opcoes.logado !== false) fs.writeFileSync(path.join(conta, '.stub-logado'), '');
      if (opcoes.pago) fs.writeFileSync(path.join(conta, '.stub-pago'), '');
      if (opcoes.falha) fs.writeFileSync(path.join(conta, '.stub-falha'), opcoes.falha);
      adicionarPerfil(raiz, { id, runtime: 'claude-bg', dir: conta });
      return conta;
    },
    falhaDaConta: (conta, falha) => {
      if (falha === null) fs.rmSync(path.join(conta, '.stub-falha'), { force: true });
      else fs.writeFileSync(path.join(conta, '.stub-falha'), falha);
    },
    estadoDaSessao: (state) => fs.writeFileSync(path.join(dir, 'state'), state, 'utf8'),
    envs: () => fs.existsSync(path.join(dir, 'envs')) ? fs.readFileSync(path.join(dir, 'envs'), 'utf8').trim().split('\n') : [],
    restaurar: () => {
      volta('PATH', anterior.PATH); volta('ORK_CONTA_STUB_DIR', anterior.STUB); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
