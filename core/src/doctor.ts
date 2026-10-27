/**
 * `ork doctor`: o que vale nesta maquina agora.
 *
 * Cada check tem nivel (`ok`, `warn`, `fail`) e, quando falha, a acao de correcao.
 * Qualquer `fail` faz o comando sair com codigo diferente de zero: e um gate, nao um relatorio.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as adapter from './adapters/claude-bg';
import * as codexAdapter from './adapters/codex';
import { carregarManifesto, configDeEmbedding, DIR_ESTADO, LIMITE_MANIFESTO_BYTES, NOME_MANIFESTO } from './manifest';
import { MODOS } from './modos';
import { chaveDeEmbeddingAceita, resolverRegime } from './orkmind';
import { ETAPAS_ONBOARDING, lerOnboarding } from './onboarding';
import { ManifestoCarregado } from './manifest';
import { lerFilaDeRetomada } from './ratelimit';
import { validarAbbrev } from './slug';
import { CHAVE_DO_FUSO, formatarDataHoraRotulada, fusoDoManifesto, legendaDoFuso, localizarTexto, normalizarFuso,
  rotuloDoFuso } from './horario';
import { chooseExecutor, defaultProbe, type Probe } from './security-scan/executor';
import { detectStacks } from './security-scan/detect';
import { loadTools, toolsFor } from './security-scan/tools';
import { LOOP_CATEGORIES } from './security-scan/types';
import { Check } from './types';
import { branchDoHead, exec, noPath, simbolo } from './util';
import { inventariarSessoes, InventarioDeSessoes } from './sessoes-inventario';
import { raizDoEstado } from './estado-thread';
import { memoryState } from './project-state';
import { ENVS_DE_PROVIDER_PAGO, nomesDeProviderAtivos, sessaoDespachada } from './runtime-ambiente';
import { resolverDsn, variaveisComDsn, variaveisComUrlComSenha } from './dsn-da-memoria';
import { StatusDeAuth } from './adapters/claude-bg';
import { diretorioDoPerfil, lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, RUNTIMES_COM_PERFIL } from './runtime-profiles';
import { sondasDeAmbiente } from './preflight';
import { configDoBloco, ConfigDeBlocoComFallback, lerSetup } from './setup';
import { batidaNoDoctor, BatidaNoDoctor, checarCronDoPulse, checarTransporteDoPulse, LeitorDoCrontab, lerCrontabDoSistema } from './doctor-pulse-cron';
import { comandoDeConfirmacao, recusaDePostura } from './postura-local';
import { COMANDO_CONFIRMAR_WORKTREE, recusaDePastaDasWorktrees } from './worktree-local';
import { avisoDaFabricaPedida, nomeDaMaquina } from './maquina';
import { checarRede } from './doctor-rede';
import { msg, nomeDoCheck } from './locale';

const real = (dir: string): string => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

/**
 * RM-064 T5: avisa quando o LLM que roda o doctor usa a mesma conta das fases vivas. Sessão de fase
 * despachada pelo `ork` (com a identidade do despacho no ambiente) não é o condutor e não entra na comparação.
 */
export function checarSeparacaoDaConducao(raiz: string, inventario: InventarioDeSessoes,
  env: NodeJS.ProcessEnv = process.env): Check | null {
  const runtime = env.CLAUDECODE ? 'claude-bg' : env.CODEX_THREAD_ID ? 'codex' : null;
  if (!runtime || sessaoDespachada(env)) return null;
  const dirAtual = runtime === 'claude-bg' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
  let perfil: string | null = null;
  try {
    if (dirAtual) {
      const p = lerPerfisComContas(raiz).perfis.find((x) => x.runtime === runtime &&
        real(diretorioDoPerfil(perfilDeDespacho(x))) === real(dirAtual));
      perfil = p?.id ?? null;
    }
  } catch { /* o check de contas relata o store inválido; aqui não inventamos perfil */ }
  const fases = inventario.sessoes.filter((s) => s.viva && s.runtime === runtime && s.perfil === perfil && s.vinculos.length > 0)
    .flatMap((s) => s.vinculos.map((v) => `${v.thread}:${v.fase}`));
  const conta = perfil ?? msg().doctor.contaDoAmbiente;
  return {
    nome: 'separacao da conducao',
    nivel: fases.length ? 'warn' : 'ok',
    detalhe: fases.length ? msg().doctor.condutorCompartilha(runtime, conta, fases.slice(0, 3).join(', '))
      : msg().doctor.condutorSeparado(runtime, conta),
    correcao: fases.length ? msg().doctor.condutorCompartilhaCorrecao : undefined,
  };
}

/**
 * Ensaio de 03/10/2026 (RM-049): o manifesto e achado subindo a partir do diretorio atual. Um
 * `orkastery.yaml` de uma pasta acima do repositorio (um `ork init` rodado por engano no HOME) era
 * lido como o deste projeto, com outro nome e outra abbrev, e o doctor dizia PRONTO. Vale o manifesto
 * dentro do repositorio ou na arvore principal dele (a worktree de thread le o da arvore principal).
 */
export function manifestoForaDoRepositorio(dirInicial: string, caminhoDoManifesto: string): Check | null {
  const topo = exec('git', ['rev-parse', '--show-toplevel'], dirInicial);
  if (!topo.ok) return null;
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const dirDoManifesto = real(path.dirname(caminhoDoManifesto));
  const dentro = (raiz: string) => { const r = path.relative(real(raiz), dirDoManifesto);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (dentro(topo.stdout.trim())) return null;
  const comum = exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], dirInicial);
  if (comum.ok && path.basename(comum.stdout.trim()) === '.git' && dentro(path.dirname(comum.stdout.trim()))) return null;
  return {
    nome: 'manifesto do repositorio',
    nivel: 'warn',
    detalhe: msg().doctor.manifestoForaDoRepo(NOME_MANIFESTO, caminhoDoManifesto, topo.stdout.trim()),
    correcao: msg().doctor.manifestoForaDoRepoCorrecao(topo.stdout.trim()),
  };
}

/**
 * I-33 (D7): check "contas por runtime". Cada perfil ativo tem o login conferido pelo proprio
 * CLI com o env dele (`claude auth status`, `codex login status`); o doctor so le e relata, sem
 * marcar o store. Runtime com perfis e nenhum pronto reprova: o despacho dele nao sairia.
 */
export function checarContas(raiz: string, auth: (p: PerfilDeDespacho) => StatusDeAuth =
  (p) => p.runtime === 'claude-bg' ? adapter.conferirAuth(p) : codexAdapter.conferirAuth(p)): Check {
  let perfis;
  try { perfis = lerPerfisComContas(raiz).perfis.filter(p => p.estado !== 'desativado'); }
  catch (e) {
    return { nome: 'contas por runtime', nivel: 'fail', detalhe: msg().doctor.storeInvalido((e as Error).message),
      correcao: msg().doctor.storeCorrecao };
  }
  if (perfis.length === 0) return { nome: 'contas por runtime', nivel: 'ok',
    detalhe: msg().doctor.semPerfis };
  const partes: string[] = [];
  let nivel: Check['nivel'] = 'ok';
  for (const runtime of RUNTIMES_COM_PERFIL) {
    const doRuntime = perfis.filter(p => p.runtime === runtime);
    if (doRuntime.length === 0) continue;
    const estados = doRuntime.map(p => {
      const a = auth(perfilDeDespacho(p));
      return { id: p.id, pronto: a.ok && perfilDisponivel(p),
        texto: !a.ok ? (a.pago ? msg().doctor.contaPaga : a.transitorio ? msg().doctor.contaInconclusiva : msg().doctor.contaSemLogin)
          : perfilDisponivel(p) ? msg().doctor.contaPronta : msg().doctor.contaFora(p.estado, p.esgotadoAte) };
    });
    const prontos = estados.filter(e => e.pronto).length;
    if (prontos === 0) nivel = 'fail';
    else if (prontos < estados.length && nivel === 'ok') nivel = 'warn';
    partes.push(`${runtime}: ${estados.map(e => `${e.id} ${e.texto}`).join(', ')}`);
  }
  return { nome: 'contas por runtime', nivel, detalhe: partes.join('; '),
    ...(nivel !== 'ok' ? { correcao: msg().doctor.contasCorrecao } : {}) };
}

/**
 * Variaveis que REDIRECIONAM o despacho do `claude` para um provider pago.
 * Presenca delas com politica `subscription-only` e bloqueante: o despacho passaria a cobrar
 * por token, fora da assinatura, sem ninguem pedir.
 */
const ENVS_QUE_REDIRECIONAM = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

function versaoNode(): number {
  return Number(process.versions.node.split('.')[0]);
}

/**
 * I-38 (T7): a chave de embedding aparece pelo NOME, nunca pelo valor. Ausente e aviso (a busca
 * cai para o fallback local ou para FTS e o regime segue); nome de provider pago e falha, porque a
 * entrada do `ork` apagaria a variavel sob `subscription-only` e o preflight reprovaria o codex.
 */
export function checarChaveDeEmbedding(carregado: ManifestoCarregado, env: NodeJS.ProcessEnv = process.env): Check {
  const nome = 'chave de embedding';
  const config = configDeEmbedding(carregado.manifesto);
  if (config.provider === 'none') return { nome, nivel: 'ok', detalhe: msg().doctor.embeddingNone };
  const variavel = config.api_key_env;
  if ((ENVS_DE_PROVIDER_PAGO as readonly string[]).includes(variavel)) {
    return { nome, nivel: 'fail', detalhe: msg().doctor.embeddingPago(variavel), correcao: msg().doctor.embeddingPagoCorrecao };
  }
  if (!variavel) {
    return { nome, nivel: 'fail', detalhe: msg().doctor.embeddingSemVariavel(config.provider),
      correcao: msg().doctor.embeddingSemVariavelCorrecao };
  }
  const valor = (env[variavel] ?? '').trim();
  // RM-069: a DSN da fonte declarada (a variavel ou o arquivo da pasta de segredos), pelo resolvedor unico.
  const dsn = resolverDsn(carregado.manifesto.memory, { env }).dsn;
  if (valor !== '' && !chaveDeEmbeddingAceita(valor, dsn)) {
    return { nome, nivel: 'fail', detalhe: msg().doctor.embeddingRecusada(variavel), correcao: msg().doctor.embeddingRecusadaCorrecao(variavel) };
  }
  if (valor !== '') {
    return { nome, nivel: 'ok', detalhe: msg().doctor.embeddingPresente(variavel, config.provider, config.model) };
  }
  return { nome, nivel: 'warn', detalhe: msg().doctor.embeddingAusente(variavel), correcao: msg().doctor.embeddingAusenteCorrecao(variavel) };
}

/**
 * RM-069 (G5): de onde vem a DSN da memoria, a variavel pelo NOME ou o arquivo pelo rotulo com `~`, nunca o valor. So
 * com `memory.mode: orkmind` e uma fonte declarada; a falha e aviso, porque memoria degradada nao bloqueia despacho.
 */
export function checarFonteDaDsn(carregado: ManifestoCarregado, env: NodeJS.ProcessEnv = process.env): Check | null {
  const memoria = carregado.manifesto.memory;
  if (memoria.mode !== 'orkmind') return null;
  const r = resolverDsn(memoria, { env });
  const nome = 'fonte da DSN';
  if (r.fonte === 'nenhuma') return null;
  if (r.fonte === 'ambiente') {
    return r.falha
      ? { nome, nivel: 'warn', detalhe: msg().doctor.dsnVariavelAusente(r.rotulo), correcao: msg().doctor.dsnVariavelAusenteCorrecao(r.rotulo) }
      : { nome, nivel: 'ok', detalhe: msg().doctor.dsnDaVariavel(r.rotulo) };
  }
  if (!r.falha) return { nome, nivel: 'ok', detalhe: msg().doctor.dsnDoArquivo(r.rotulo, r.permissao ?? '') };
  return { nome, nivel: 'warn', detalhe: msg().doctor.dsnArquivoFalhou(r.rotulo, r.falha, msg().doctor.dsnCausa(r.causa ?? '', r.permissao ?? '')),
    correcao: msg().doctor.dsnArquivoCorrecao(r.falha, r.rotulo) };
}

/**
 * RM-069 (G6, D8): a DSN no ambiente DESTE processo, pelo NOME da variavel, nunca o valor. Numa sessao despachada, as
 * variaveis com a DSN do projeto e toda URL com senha: o agente as le com `env`. Fora dela, so com a fonte de arquivo
 * lida, as variaveis que repetem a DSN do arquivo. Nos outros casos (fonte de ambiente fora do despacho), nenhum check.
 */
export function checarDsnNoAmbiente(carregado: ManifestoCarregado, env: NodeJS.ProcessEnv = process.env): Check | null {
  const despachada = sessaoDespachada(env);
  const r = resolverDsn(carregado.manifesto.memory, { env });
  if (!despachada && !(r.fonte === 'arquivo' && r.dsn)) return null;
  const nome = 'DSN no ambiente';
  const doProjeto = r.dsn ? variaveisComDsn(env, r.dsn) : [];
  const comSenha = despachada ? variaveisComUrlComSenha(env).filter((n) => !doProjeto.includes(n)) : [];
  if (doProjeto.length === 0 && comSenha.length === 0) {
    return { nome, nivel: 'ok', detalhe: despachada ? msg().doctor.dsnSessaoLimpa : msg().doctor.dsnProcessoLimpo };
  }
  return { nome, nivel: 'warn', detalhe: despachada ? msg().doctor.dsnNaSessao(doProjeto, comSenha) : msg().doctor.dsnNoProcesso(doProjeto),
    correcao: msg().doctor.dsnNoAmbienteCorrecao };
}

/** Acima disso a conferencia do dono do `.git` fica parcial (aviso), para o doctor nao pesar. */
export const TETO_DO_DONO_DO_GIT = 200_000;

/**
 * RM-037 (fatia 3, defeito 7): git rodado como root no repositorio do dono deixa objeto, pasta e
 * `FETCH_HEAD` com outro dono, e o git do dono deixa de gravar neles: o fetch travou em 29/09 e em
 * 01/10. O dono do repositorio e o dono do diretorio comum do git. O check acusa com a contagem, ate
 * tres exemplos e o `chown` exato; o doctor nunca roda nada. Fora de repositorio git, `null`.
 */
export function checarDonoDoGit(dirInicial: string,
  opcoes: { lstat?: (p: string) => fs.Stats; teto?: number } = {}): Check | null {
  const nome = 'dono do .git';
  const comum = exec('git', ['rev-parse', '--git-common-dir'], dirInicial);
  if (!comum.ok || !comum.stdout.trim()) return null;
  const dirComum = path.resolve(dirInicial, comum.stdout.trim());
  const lstat = opcoes.lstat ?? ((p: string) => fs.lstatSync(p));
  let raiz: fs.Stats;
  try { raiz = lstat(dirComum); } catch { return null; }
  const teto = opcoes.teto ?? TETO_DO_DONO_DO_GIT;
  const relativo = (f: string) => path.relative(path.dirname(dirComum), f);
  // A correcao sai pronta para copiar: caminho com caractere fora do conjunto seguro vai entre aspas simples.
  const noShell = (s: string) => /^[A-Za-z0-9._/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
  const estranhos: string[] = [], uids = new Set<number>();
  let total = 0, vistos = 0, parcial = false;
  const pilha = [dirComum];
  while (pilha.length > 0 && !parcial) {
    const atual = pilha.pop() as string;
    let nomes: string[];
    // Pasta que o dono nao consegue listar ja aparece pelo dono dela, na entrada de cima.
    try { nomes = fs.readdirSync(atual); } catch { continue; }
    for (const n of nomes) {
      if (++vistos > teto) { parcial = true; break; }
      const f = path.join(atual, n);
      let st: fs.Stats;
      try { st = lstat(f); } catch { continue; }
      if (st.uid !== raiz.uid) {
        total++;
        uids.add(st.uid);
        if (estranhos.length < 3) estranhos.push(relativo(f));
      }
      if (st.isDirectory()) pilha.push(f);
    }
  }
  if (total > 0) {
    return { nome, nivel: 'fail',
      detalhe: msg().doctor.donoOutro(total, relativo(dirComum), [...uids].sort((a, b) => a - b).join(', '), raiz.uid,
        `${estranhos.join(', ')}${total > estranhos.length ? ', ...' : ''}`, parcial ? teto : null),
      correcao: msg().doctor.donoCorrecao(`sudo chown -R ${raiz.uid}:${raiz.gid} ${noShell(dirComum)}`) };
  }
  if (parcial) {
    return { nome, nivel: 'warn', detalhe: msg().doctor.donoParcial(teto, relativo(dirComum)),
      correcao: msg().doctor.donoParcialCorrecao(`find ${noShell(dirComum)} -not -uid ${raiz.uid}`) };
  }
  return { nome, nivel: 'ok', detalhe: msg().doctor.donoOk(vistos, relativo(dirComum), raiz.uid) };
}

/** Checks locais; ler a entrevista não abre driver, banco, runtime ou rede. */
export function checarOnboarding(carregado: ManifestoCarregado): Check[] {
  const estado = lerOnboarding(carregado.raiz);
  const pendentes = ETAPAS_ONBOARDING.filter(e => estado.etapas[e] === null);
  const checks: Check[] = [{ nome: 'onboarding', nivel: pendentes.length ? 'warn' : 'ok',
    detalhe: pendentes.length ? msg().doctor.onboardingPendente(pendentes.length, pendentes.join(', ')) : msg().doctor.onboardingCompleto,
    ...(pendentes.length ? { correcao: 'ork onboarding' } : {}) }];
  const escolha = estado.etapas.memoria?.conteudo;
  const modo = escolha === 'sim' || escolha === true ? 'orkmind' :
    escolha === 'orkmind' || escolha === 'files' ? escolha :
    escolha && typeof escolha === 'object' && !Array.isArray(escolha) ? escolha.modo : null;
  if ((modo === 'orkmind' || modo === 'files') && modo !== carregado.manifesto.memory.mode) {
    checks.push({ nome: 'onboarding memoria', nivel: 'warn', detalhe: msg().doctor.entrevistaMemoria(modo, carregado.manifesto.memory.mode),
      correcao: msg().doctor.entrevistaMemoriaCorrecao(modo) });
  }
  // I-35: o fuso respondido na etapa maestro orienta owner.timezone, sem editar o manifesto. Com
  // `owner.timezone` na mesma resposta (gravado no manifesto pelo `onboarding set`), vale ele: no
  // ensaio da 0.5.0, o `fuso` legado da resposta anterior mandava desfazer a escolha explicita.
  const maestro = estado.etapas.maestro?.conteudo;
  const owner = maestro && typeof maestro === 'object' && !Array.isArray(maestro) ? maestro.owner : undefined;
  const fusoDoOwner = owner && typeof owner === 'object' && !Array.isArray(owner) ? (owner as Record<string, unknown>).timezone : undefined;
  // Owner invalido (so por edicao a mao: o `onboarding set` recusa) nao cala o fuso legado.
  const fusoDaEntrevista = maestro && typeof maestro === 'object' && !Array.isArray(maestro)
    ? normalizarFuso(fusoDoOwner) ?? normalizarFuso(maestro.fuso) : undefined;
  if (fusoDaEntrevista && fusoDaEntrevista !== carregado.manifesto.owner?.timezone) {
    checks.push({ nome: 'onboarding fuso', nivel: 'warn',
      detalhe: msg().doctor.entrevistaFuso(fusoDaEntrevista, carregado.manifesto.owner?.timezone, CHAVE_DO_FUSO),
      correcao: msg().doctor.entrevistaFusoCorrecao(CHAVE_DO_FUSO, fusoDaEntrevista) });
  }
  return checks;
}

/** Um bloco de modo, como o doctor e o setup o nomeiam: `#Classic 2`. */
export interface BlocoDeModo { tag: string; bloco: number }

/** Os blocos dos modos permitidos, separados pelo papel que o runtime pedido tem neles. */
export interface BlocosDoRuntime { principal: BlocoDeModo[]; fallback: BlocoDeModo[] }

/**
 * Fatia 2 do ensaio da 0.5.0 (P1): por qual runtime cada bloco dos modos de
 * `conduction.allowed_modes` despacha, pelo mesmo criterio do despacho sem opcao de CLI
 * (`resolverDespacho`: o bloco do setup vence `runtime.adapter`). Quem passou os blocos para o
 * Codex nao precisa do `claude`. Setup ilegivel devolve `null`: quem chama fica no lado seguro.
 */
export function blocosDoRuntime(carregado: ManifestoCarregado, runtime: string): BlocosDoRuntime | null {
  const { manifesto } = carregado;
  const r: BlocosDoRuntime = { principal: [], fallback: [] };
  try {
    const setup = lerSetup(carregado.raiz);
    for (const modo of manifesto.conduction.allowed_modes) {
      MODOS[modo].blocos.forEach((b, i) => {
        const doBloco = configDoBloco(setup, modo, b.fases[0]) as ConfigDeBlocoComFallback | null;
        const bloco = { tag: MODOS[modo].tag, bloco: i + 1 };
        if ((doBloco?.runtime ?? manifesto.runtime.adapter) === runtime) r.principal.push(bloco);
        else if (doBloco?.fallback?.some((f) => f.split(':')[0] === runtime)) r.fallback.push(bloco);
      });
    }
  } catch { return null; }
  return r;
}

/** `#Classic 1, 2; #Auto 1`: os blocos agrupados por modo, na ordem dos modos permitidos. */
function textoDosBlocos(blocos: readonly BlocoDeModo[]): string {
  const porModo = new Map<string, number[]>();
  for (const b of blocos) porModo.set(b.tag, [...(porModo.get(b.tag) ?? []), b.bloco]);
  return [...porModo].map(([tag, numeros]) => `${tag} ${numeros.join(', ')}`).join('; ');
}

/**
 * Ensaio de 03/10 (R1): com perfil ativo do runtime, quem confere o login e o check "contas por runtime";
 * sem perfil (ou com o store ilegivel, que aquele check reprova), o despacho usa o login do `claude` do processo.
 */
function temPerfilAtivo(carregado: ManifestoCarregado | null, runtime: string): boolean {
  if (!carregado || carregado.erros.length) return false;
  try { return lerPerfisComContas(carregado.raiz).perfis.some(p => p.runtime === runtime && p.estado !== 'desativado'); }
  catch { return false; }
}

/**
 * Fatia 2 do ensaio da 0.5.0 (P1): o `claude` so e obrigatorio quando algum bloco de modo permitido
 * despacha por ele. Sem manifesto, com manifesto invalido ou com setup ilegivel vale o padrao (todo
 * bloco no claude-bg), e a falta reprova como antes.
 */
export function checarRuntimeClaude(carregado: ManifestoCarregado | null, claude: string | null,
  versao: string | null, auth: StatusDeAuth | null = null): Check {
  const nome = 'runtime claude-bg';
  if (claude) {
    const detalhe = `${claude} (${versao ?? msg().doctor.versaoDesconhecida})`;
    // Ensaio de 03/10 (R1): sem perfil de conta, o despacho usa o login do proprio `claude`; sem ele, o
    // primeiro despacho falha. Conferencia inconclusiva (timeout, JSON ilegivel) nao prova falta de login.
    if (auth && !auth.ok && !auth.transitorio) {
      return { nome, nivel: 'warn', detalhe: msg().doctor.claudeSemLogin(detalhe, auth.detalhe),
        correcao: auth.pago ? msg().doctor.claudeLoginPago : msg().doctor.claudeLogin };
    }
    return { nome, nivel: 'ok', detalhe };
  }
  const blocos = carregado && carregado.erros.length === 0 ? blocosDoRuntime(carregado, 'claude-bg') : null;
  if (blocos && blocos.principal.length === 0) {
    // CHECK, rodada 1 (S6): as fases nao precisam dele, mas o `ork audit run` despacha sempre pelo claude-bg.
    return { nome, nivel: 'warn',
      detalhe: msg().doctor.claudeOpcional(blocos.fallback.length
        ? { blocos: blocos.fallback.length, texto: textoDosBlocos(blocos.fallback) } : null),
      correcao: msg().doctor.claudeOpcionalCorrecao };
  }
  return { nome, nivel: 'fail',
    detalhe: msg().doctor.claudeAusente(blocos ? { blocos: blocos.principal.length, texto: textoDosBlocos(blocos.principal) } : null),
    correcao: msg().doctor.claudeAusenteCorrecao };
}

/**
 * O despacho pelo Codex quando o projeto o elege: por `runtime.adapter: codex`, como antes, ou, desde
 * a fatia 2 do ensaio da 0.5.0 (P1), por bloco de modo permitido. A falta do `codex`, ou um sandbox
 * que nao executa, deixa de ser aviso: e exatamente o que bloquearia a fase. Sem nenhum dos dois, o
 * check nao sai.
 */
export function checarDespachoPeloCodex(carregado: ManifestoCarregado, codex: string | null,
  sonda: { ok: boolean } | null): Check | null {
  const pelaAdapter = carregado.manifesto.runtime.adapter === 'codex';
  const blocos = blocosDoRuntime(carregado, 'codex')?.principal ?? [];
  if (!pelaAdapter && blocos.length === 0) return null;
  const origem = msg().doctor.origemDoCodex(pelaAdapter, blocos.length ? { blocos: blocos.length, texto: textoDosBlocos(blocos) } : null);
  const sandboxConfigurado = carregado.manifesto.runtime.sandbox;
  const sandboxQuebrado = sonda !== null && !sonda.ok && sandboxConfigurado !== 'danger-full-access';
  // RM-047 (P1): a postura que afrouxa o sandbox so despacha com a confirmacao local desta maquina.
  const posturaSemConfirmacao = recusaDePostura(carregado.raiz, carregado.manifesto, 'codex') !== null;
  return {
    nome: 'despacho pelo codex',
    nivel: !codex ? 'fail' : sandboxQuebrado || posturaSemConfirmacao ? 'fail' : 'ok',
    detalhe: !codex
      ? msg().doctor.codexForaNoDespacho(origem)
      : sandboxQuebrado
        ? msg().doctor.codexSandboxQuebrado(origem, sandboxConfigurado)
        : posturaSemConfirmacao
          ? msg().doctor.codexSemConfirmacao(origem, sandboxConfigurado)
          : msg().doctor.codexSandboxOk(origem, sandboxConfigurado),
    correcao: !codex
      ? msg().doctor.codexForaNoDespachoCorrecao
      : sandboxQuebrado
        ? msg().doctor.codexSandboxQuebradoCorrecao(comandoDeConfirmacao('danger-full-access'))
        : posturaSemConfirmacao
          ? msg().doctor.codexSemConfirmacaoCorrecao(comandoDeConfirmacao(sandboxConfigurado))
          : undefined,
  };
}

/**
 * Check `security scan` (spec section 11): only when `verify.security_scan` is declared. `ok` with Docker (CLI and daemon);
 * without it, `ok` only when every loop-category tool for the detected stacks has an acceptable native binary (pip-audit
 * and govulncheck have none, so a Python or Go repo always lands on `warn`). Never `fail`: a missing scanner is the
 * `unavailable` of the ship gate, not a broken machine. The probe is injectable so tests never touch a real Docker.
 */
export function checarSecurityScan(carregado: ManifestoCarregado | null, probe: Probe = defaultProbe()): Check | null {
  if (!carregado || carregado.manifesto.verify.security_scan === undefined) return null;
  const nome = 'security scan';
  const m = msg().doctor;
  const tools = toolsFor(detectStacks(carregado.raiz).map(s => s.stack), loadTools());
  const faltando = tools.filter(t => LOOP_CATEGORIES.includes(t.category) && chooseExecutor(t, probe).kind === 'unavailable');
  if (probe.dockerCli() && probe.dockerDaemon()) return { nome, nivel: 'ok', detalhe: m.securityScanDocker };
  if (faltando.length === 0) return { nome, nivel: 'ok', detalhe: m.securityScanNativo };
  const lista = faltando.map(t => `${t.category}/${t.name}`).join(', ');
  const nativos = [...new Set(tools.filter(t => t.native && !t.install).map(t => t.native!.bin))].join(', ');
  return { nome, nivel: 'warn', detalhe: m.securityScanSemFerramenta(lista), correcao: m.securityScanCorrecao(nativos) };
}

/**
 * Roda todos os checks a partir do diretorio informado. RM-031: `analisadores` e o check do grafo
 * (`checarAnalisadoresDoGrafo` do CLI do grafo), que o `index.ts` passa: fora da familia do grafo so
 * ele e o worker do MCP a abrem (fronteira do KG1), e o doctor nao a importa.
 */
export function checar(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos(),
  lerCrontab: LeitorDoCrontab = lerCrontabDoSistema,
  conferirAuthDoClaude: () => StatusDeAuth = () => adapter.conferirAuth(null),
  analisadores?: () => Check, forja?: (carregado: ManifestoCarregado) => Check[]): Check[] {
  const checks: Check[] = [];

  const major = versaoNode();
  checks.push({
    nome: 'node',
    nivel: major >= 20 ? 'ok' : 'fail',
    detalhe: `v${process.versions.node}`,
    correcao: major >= 20 ? undefined : msg().doctor.instaleNode,
  });
  if (analisadores) checks.push(analisadores());

  const git = noPath('git');
  checks.push({
    nome: 'git',
    nivel: git ? 'ok' : 'fail',
    detalhe: git ?? msg().doctor.gitAusente,
    correcao: git ? undefined : msg().doctor.instaleGit,
  });

  const repo = exec('git', ['rev-parse', '--is-inside-work-tree'], dirInicial);
  const dentroDeRepo = repo.ok && repo.stdout.trim() === 'true';
  // Ensaio da 0.5.0: sem commit, o `rev-parse --abbrev-ref` respondia "HEAD"; a branch vem do
  // `symbolic-ref`, e a falta de commit fica dita.
  const semCommit = dentroDeRepo && !exec('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], dirInicial).ok;
  const branch = dentroDeRepo ? branchDoHead(dirInicial) ?? exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dirInicial).stdout.trim() : '';
  checks.push({
    nome: 'repositorio',
    nivel: dentroDeRepo ? 'ok' : 'fail',
    detalhe: dentroDeRepo ? msg().doctor.branch(branch, semCommit) : msg().doctor.foraDeRepo,
    correcao: dentroDeRepo ? undefined : msg().doctor.rodeDentroDeRepo,
  });
  if (dentroDeRepo) {
    const dono = checarDonoDoGit(dirInicial);
    if (dono) checks.push(dono);
  }

  // Fatia 2 do ensaio da 0.5.0 (P1): o manifesto e lido antes dos runtimes, porque e o setup dos
  // modos permitidos que diz se o `claude` e obrigatorio; a ordem das linhas do relatorio nao muda.
  const carregado = carregarManifesto(dirInicial);
  const scan = checarSecurityScan(carregado);
  if (scan) checks.push(scan);
  const claude = adapter.disponivel();
  const v = claude ? adapter.versao() : null;
  checks.push(checarRuntimeClaude(carregado, claude, v,
    claude && !temPerfilAtivo(carregado, 'claude-bg') ? conferirAuthDoClaude() : null));

  // Segundo runtime homologado. Ausente e `warn`, nao `fail`: o claude-bg segue sendo o
  // padrao, e um projeto que nunca pediu codex nao pode ficar bloqueado por ele.
  const codex = codexAdapter.disponivel();
  const codexVersao = codex ? codexAdapter.versao() : null;
  // CHECK, rodada 1 (S6): com o projeto despachando pelo codex, a falta dele nao e "opcional"; quem
  // reprova e o check `despacho pelo codex`, mais abaixo.
  const usaCodex = !!carregado && carregado.erros.length === 0 && (carregado.manifesto.runtime.adapter === 'codex' ||
    (blocosDoRuntime(carregado, 'codex')?.principal.length ?? 0) > 0);
  checks.push({
    nome: 'runtime codex',
    nivel: codex ? 'ok' : 'warn',
    detalhe: codex
      ? `${codex} (${codexVersao ?? msg().doctor.versaoDesconhecida})`
      : usaCodex
        ? msg().doctor.codexAusenteUsado
        : msg().doctor.codexAusenteOpcional,
    correcao: codex
      ? undefined
      : msg().doctor.instaleCodex,
  });

  // Pitfall MEDIDO em 06/09/2026: com o sandbox quebrado, o `codex exec` sai 0 e o agente
  // NARRA sucesso sem executar nada. A sonda e deterministica (roda `true`, sem LLM).
  let sondaDoCodex: { ok: boolean; detalhe: string } | null = null;
  if (codex) {
    sondaDoCodex = codexAdapter.sondarSandbox();
    checks.push({
      nome: 'sandbox do codex',
      nivel: sondaDoCodex.ok ? 'ok' : 'warn',
      detalhe: sondaDoCodex.ok
        ? msg().doctor.sandboxOk
        : msg().doctor.sandboxFalhou(sondaDoCodex.detalhe),
      correcao: sondaDoCodex.ok
        ? undefined
        : msg().doctor.sandboxCorrecao(comandoDeConfirmacao('danger-full-access')),
    });
  }

  if (!carregado) {
    checks.push({
      nome: 'manifesto',
      nivel: 'fail',
      detalhe: msg().doctor.manifestoAusente(NOME_MANIFESTO, dirInicial),
      // Ensaio de 03/10/2026 (RM-049): fora de repositorio, o `ork init` recusa; a correcao diz onde roda-lo.
      correcao: dentroDeRepo ? msg().doctor.rodeInit : msg().doctor.entreNoRepoEInit,
    });
  } else {
    checks.push({
      nome: 'manifesto',
      nivel: carregado.erros.length > 0 ? 'fail' : carregado.avisos.length > 0 ? 'warn' : 'ok',
      detalhe:
        carregado.erros.length > 0
          ? `${carregado.caminho}: ${carregado.erros.join('; ')}`
          : msg().doctor.manifestoOk(carregado.caminho, carregado.bytes, LIMITE_MANIFESTO_BYTES) +
            (carregado.avisos.length > 0 ? `; ${carregado.avisos.map((a) => msg().onboarding.avisoDaPreferencia(a)).join('; ')}` : ''),
      correcao: carregado.erros.length > 0 ? msg().doctor.corrijaManifesto : undefined,
    });
    if (dentroDeRepo) {
      const fora = manifestoForaDoRepositorio(dirInicial, carregado.caminho);
      if (fora) checks.push(fora);
    }

    checks.push(...checarOnboarding(carregado));
    const abbrev = carregado.manifesto.project.abbrev;
    const checkAbbrev = validarAbbrev(abbrev);
    checks.push({
      nome: 'abbrev do projeto',
      nivel: checkAbbrev.ok ? 'ok' : 'fail',
      detalhe: checkAbbrev.ok
        ? msg().doctor.abbrevOk(abbrev)
        : (checkAbbrev.erro as string),
      correcao: checkAbbrev.ok ? undefined : msg().doctor.abbrevCorrecao,
    });

    const cond = carregado.manifesto.conduction;
    checks.push({
      nome: 'modos de conducao',
      nivel: 'ok',
      detalhe: msg().doctor.modos(MODOS[cond.default_mode].tag, cond.allowed_modes.map((m) => MODOS[m].tag).join(', ')),
    });

    // I-35: o fuso em que todo horario chega ao dono; valor invalido avisa e nao para nada.
    const fuso = fusoDoManifesto(carregado);
    checks.push({
      nome: 'fuso do dono',
      nivel: fuso.aviso ? 'warn' : 'ok',
      detalhe: fuso.aviso ?? (fuso.origem === 'manifesto'
        ? msg().doctor.fusoDoManifesto(fuso.fuso, CHAVE_DO_FUSO, rotuloDoFuso(fuso.fuso))
        : msg().doctor.fusoDoSistema(fuso.fuso, CHAVE_DO_FUSO)),
      correcao: fuso.aviso ? msg().doctor.fusoCorrecao(CHAVE_DO_FUSO) : undefined,
    });

    // Quando o manifesto ou um bloco de modo permitido ELEGE o codex, a ausencia dele (ou um
    // sandbox que nao executa) deixa de ser aviso: e exatamente o que bloquearia a fase.
    const despachoPeloCodex = checarDespachoPeloCodex(carregado, codex, sondaDoCodex);
    if (despachoPeloCodex) checks.push(despachoPeloCodex);

    // RM-047 (P5): o manifesto pede a fabrica compartilhada, mas quem liga a publicacao e a maquina.
    const fabricaPedida = avisoDaFabricaPedida(carregado.manifesto);
    if (fabricaPedida) {
      checks.push({ nome: 'fabrica compartilhada', nivel: 'warn',
        detalhe: msg().doctor.fabricaPedida, correcao: msg().doctor.fabricaPedidaCorrecao });
    }

    // RM-047 (P3): worktree.dir fora da raiz so cria checkout com a confirmacao local desta maquina.
    const recusaDaPasta = recusaDePastaDasWorktrees(carregado.raiz, carregado.manifesto);
    if (recusaDaPasta) {
      checks.push({ nome: 'pasta das worktrees', nivel: 'fail',
        detalhe: msg().doctor.pastaForaDaRaiz(carregado.manifesto.worktree.dir),
        correcao: msg().doctor.pastaForaDaRaizCorrecao(COMANDO_CONFIRMAR_WORKTREE) });
    }

    const politica = carregado.manifesto.runtime.provider_policy;
    const soAssinatura = politica === 'subscription-only';
    const redirecionam = ENVS_QUE_REDIRECIONAM.filter(e => nomesHerdados.includes(e));
    const pagas = nomesHerdados;
    const bloqueia = soAssinatura && redirecionam.length > 0;
    checks.push({
      nome: 'custo e provider herdado',
      nivel: bloqueia ? 'fail' : soAssinatura && pagas.length > 0 ? 'warn' : 'ok',
      detalhe: bloqueia
        ? msg().doctor.politicaViolada(politica, redirecionam.join(', '))
        : pagas.length > 0
          ? msg().doctor.politicaComPaga(politica, pagas.join(', '))
          : msg().doctor.politicaLimpa(politica),
      correcao: bloqueia
        ? msg().doctor.removaDoAmbiente(redirecionam.join(', '))
        : pagas.length > 0
          ? msg().doctor.nuncaDespachePorPaga(pagas.join(', '))
          : undefined,
    });
    const efetivas = nomesDeProviderAtivos();
    checks.push({
      nome: 'provider efetivo da fabrica',
      nivel: soAssinatura && efetivas.length ? 'warn' : 'ok',
      detalhe: efetivas.length ? msg().doctor.providersAtivos(efetivas.join(', ')) : msg().doctor.nenhumProvider,
    });

    // Bloco B6: o regime de memoria e um CHECK, nao um detalhe do manifesto. Manifesto
    // que pede `orkmind` e nao consegue liga-lo vira `warn` com a correcao, nunca `fail`:
    // memoria semantica melhora o produto, e nao e requisito dele.
    const context = memoryState(carregado);
    const { estado } = resolverRegime(context.loaded.manifesto, null);
    checks.push({ nome: 'fonte da memoria', nivel: context.divergent ? 'warn' : 'ok',
      detalhe: msg().doctor.fonteDaMemoria(context.source, context.divergent) });
    checks.push({
      nome: 'regime de memoria',
      nivel: estado.efetivo === 'orkmind' ? 'ok' : estado.pedido === 'orkmind' ? 'warn' : 'ok',
      detalhe:
        estado.pedido === 'orkmind' && estado.efetivo === 'files'
          ? msg().doctor.regimeDegradado(estado.motivo, estado.detalhe)
          : estado.efetivo === 'orkmind'
            ? estado.fonteDaDsn === 'arquivo'
              ? msg().doctor.regimeOrkmindPorArquivo(estado.tenant, estado.arquivoDaDsn ?? '')
              : msg().doctor.regimeOrkmind(estado.tenant, estado.variavel)
            : msg().doctor.memoriaFiles,
      correcao: estado.pedido === 'orkmind' && estado.efetivo === 'files' ? estado.correcao : undefined,
    });
    // RM-069: a fonte da DSN e a DSN no ambiente, so quando ha o que dizer (fonte declarada ou sessao despachada).
    const fonteDaDsn = checarFonteDaDsn(context.loaded);
    if (fonteDaDsn) checks.push(fonteDaDsn);
    const dsnNoAmbiente = checarDsnNoAmbiente(context.loaded);
    if (dsnNoAmbiente) checks.push(dsnNoAmbiente);

    checks.push(checarChaveDeEmbedding(context.loaded));

    // Bloco B3: a fila de rate limit e estado do mundo, nao detalhe interno. Uma fase
    // esperando janela e uma fase que NAO esta rodando, e quem olha o doctor precisa
    // saber disso antes de concluir que a thread travou.
    const fila = lerFilaDeRetomada(carregado.raiz);
    const esperando = fila.filter((p) => p.estado === 'aguardando');
    const escalados = fila.filter((p) => p.estado === 'escalado');
    checks.push({
      nome: 'fila de rate limit',
      nivel: escalados.length > 0 ? 'warn' : 'ok',
      detalhe:
        fila.length === 0
          ? msg().doctor.filaVazia
          : msg().doctor.filaResumo(esperando.length, escalados.length) +
            (esperando.length > 0 ? msg().doctor.filaProxima(formatarDataHoraRotulada(esperando[0].liberaEm)) : ''),
      correcao:
        escalados.length > 0
          ? msg().doctor.filaEscaladoCorrecao
          : esperando.length > 0
            ? msg().doctor.filaEsperaCorrecao
            : undefined,
    });

    const dirEstadoProjeto = path.join(raizDoEstado(carregado.raiz), DIR_ESTADO);
    const threads = path.join(dirEstadoProjeto, 'threads');
    const qtd = fs.existsSync(threads)
      ? fs.readdirSync(threads, { withFileTypes: true }).filter((e) => e.isDirectory()).length
      : 0;
    checks.push({
      nome: 'estado do projeto',
      nivel: fs.existsSync(dirEstadoProjeto) ? 'ok' : 'warn',
      detalhe: fs.existsSync(dirEstadoProjeto)
        ? msg().doctor.estadoOk(dirEstadoProjeto, qtd)
        : msg().doctor.estadoAusente(dirEstadoProjeto),
      correcao: fs.existsSync(dirEstadoProjeto) ? undefined : msg().doctor.estadoCorrecao,
    });
    // RM-039 (B6): com o transporte do pulse configurado, a varredura tem de bater de 15 em 15
    // minutos; a instalacao antiga em `0 * * * *` vira aviso com a linha nova. Nunca edita o crontab.
    const cronDoPulse = checarCronDoPulse(path.join(dirEstadoProjeto, 'monitor'), raizDoEstado(carregado.raiz), lerCrontab);
    if (cronDoPulse) checks.push(cronDoPulse);
    // RM-063 (fatia 3, H4): a falha do transporte do pulse (e o desvio para o outro host configurado) aparece aqui.
    const transporte = checarTransporteDoPulse(path.join(dirEstadoProjeto, 'monitor'));
    if (transporte) checks.push(transporte);

    checks.push(checarContas(carregado.raiz));
    // I-33 (D7): umask e permissoes do estado, na mesma regra do sensor (sem bits 0o022).
    checks.push(...sondasDeAmbiente(carregado.raiz));
    // A forja do remoto (identidade, alcance, TLS, CLI, login, servidor, escopo, projeto, capacidades): so com o
    // manifesto valido, e so quando a entrada do CLI a passa, como os analisadores.
    if (forja && carregado.erros.length === 0) checks.push(...forja(carregado));

    {
      const inventario = inventariarSessoes(carregado.raiz, { global: true, todas: true });
      const separacao = checarSeparacaoDaConducao(carregado.raiz, inventario);
      if (separacao) checks.push(separacao);
      // Fatia 2 do ensaio da 0.5.0 (P1): binario ausente e fonte ausente, dita no detalhe.
      const ausentes = inventario.fontes.filter((f) => f.ausente).map((f) => f.origem);
      checks.push({
        nome: 'governanca de sessoes',
        nivel: inventario.ok && inventario.semThread === 0 ? 'ok' : 'warn',
        detalhe: msg().doctor.governanca({ usuario: inventario.escopo.usuario, total: inventario.total, semThread: inventario.semThread,
          ambiguas: inventario.ambiguas, ok: inventario.ok, ausentes: ausentes.map((o) => msg().doctor.fonteDaSessao(o)) }),
        correcao: inventario.ok && inventario.semThread === 0 ? undefined : msg().doctor.governancaCorrecao,
      });
    }
  }

  // RM-053 (fatia 2): a rede da pessoa e da maquina, nao do projeto; vale de qualquer diretorio.
  checks.push(checarRede());

  return checks;
}

/** Texto do relatorio, com o resumo "o que vale nesta maquina agora". */
export function relatorio(checks: Check[]): string {
  const linhas: string[] = [];
  const m = msg().doctor;
  linhas.push(m.titulo);
  linhas.push('');
  const largura = Math.max(...checks.map((c) => nomeDoCheck(c.nome).length));
  // I-35: o Check guarda o ISO (dado de maquina, tambem lido por teste); quem imprime para o dono
  // localiza. Vale para todo check, nao so o de contas: nenhum horario chega cru ao relatorio.
  let localizou = false;
  const local = (t: string): string => {
    const l = localizarTexto(t);
    if (l !== t) localizou = true;
    return l;
  };
  for (const c of checks) {
    linhas.push(`  ${simbolo(c.nivel)} ${nomeDoCheck(c.nome).padEnd(largura)}  ${local(c.detalhe)}`);
    if (c.nivel !== 'ok' && c.correcao) {
      linhas.push(`         ${' '.repeat(largura)}  ${m.correcao}: ${local(c.correcao)}`);
    }
  }
  // O fuso sai uma vez por mensagem, antes do veredito, que segue sendo a ultima linha.
  if (localizou && !linhas.some((l) => l.includes(legendaDoFuso()))) linhas.push(legendaDoFuso());
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  const avisos = checks.filter((c) => c.nivel === 'warn').length;
  linhas.push('');
  linhas.push(
    falhas > 0
      ? m.bloqueado(falhas, avisos)
      : m.pronto(avisos)
  );
  return linhas.join('\n');
}

/** Executa o doctor e devolve o codigo de saida (0 = pronto). */
export function doctor(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos(),
  analisadores?: () => Check, forja?: (carregado: ManifestoCarregado) => Check[]): { texto: string; codigo: number } {
  const checks = checar(dirInicial, nomesHerdados, undefined, undefined, analisadores, forja);
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  return { texto: relatorio(checks), codigo: falhas > 0 ? 1 : 0 };
}

export const CONTRATO_DO_DOCTOR = 'ork.doctor/v1' as const;

/**
 * RM-063 (fatia 3, H1): o `ork doctor --json`, que a batida do host (o heartbeat do OpenClaw e do Hermes) le de forma
 * deterministica. Os mesmos checks do texto, o veredito, e a batida da fabrica com a idade da ultima rodada e o aviso
 * pronto para o dono quando ela passou de 30 min; sem projeto, a batida e `null`.
 */
export interface DoctorJson {
  contrato: typeof CONTRATO_DO_DOCTOR;
  consultadoEm: string;
  veredito: 'pronto' | 'bloqueado';
  falhas: number;
  avisos: number;
  projeto: string | null;
  maquina: string;
  checks: Check[];
  /** A secao forja (rede e CLI da forja) so roda com `ork doctor --json --forja`; sem a flag, `nao-medida`. */
  forja: 'medida' | 'nao-medida';
  batida: BatidaNoDoctor | null;
}

export function doctorJson(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos(),
  analisadores?: () => Check, lerCrontab: LeitorDoCrontab = lerCrontabDoSistema,
  forja?: (carregado: ManifestoCarregado) => Check[]): { json: DoctorJson; codigo: number } {
  const checks = checar(dirInicial, nomesHerdados, lerCrontab, undefined, analisadores, forja);
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  const avisos = checks.filter((c) => c.nivel === 'warn').length;
  let carregado: ManifestoCarregado | null = null;
  try { carregado = carregarManifesto(dirInicial); } catch { carregado = null; }
  let batida: BatidaNoDoctor | null = null;
  if (carregado && !carregado.erros.length) {
    const raiz = raizDoEstado(carregado.raiz);
    try {
      batida = batidaNoDoctor(path.join(raiz, DIR_ESTADO, 'monitor'), raiz, { projeto: carregado.manifesto.project.name,
        maquina: nomeDaMaquina(), ler: lerCrontab });
    } catch { batida = null; }
  }
  return { codigo: falhas > 0 ? 1 : 0, json: { contrato: CONTRATO_DO_DOCTOR, consultadoEm: new Date().toISOString(),
    veredito: falhas > 0 ? 'bloqueado' : 'pronto', falhas, avisos, projeto: carregado?.manifesto.project.name ?? null,
    maquina: nomeDaMaquina(), checks, forja: forja ? 'medida' : 'nao-medida', batida } };
}
