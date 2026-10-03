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
import { Check } from './types';
import { branchDoHead, exec, noPath, simbolo } from './util';
import { inventariarSessoes } from './sessoes-inventario';
import { raizDoEstado } from './estado-thread';
import { memoryState } from './project-state';
import { ENVS_DE_PROVIDER_PAGO, nomesDeProviderAtivos } from './runtime-ambiente';
import { StatusDeAuth } from './adapters/claude-bg';
import { lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, RUNTIMES_COM_PERFIL } from './runtime-profiles';
import { sondasDeAmbiente } from './preflight';
import { configDoBloco, ConfigDeBlocoComFallback, lerSetup } from './setup';
import { checarCronDoPulse, LeitorDoCrontab, lerCrontabDoSistema } from './doctor-pulse-cron';

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
    return { nome: 'contas por runtime', nivel: 'fail', detalhe: `store de perfis invalido: ${(e as Error).message}`,
      correcao: 'o store fica em .orkastery/private/runtime-profiles.json (arquivo 0600, pasta 0700)' };
  }
  if (perfis.length === 0) return { nome: 'contas por runtime', nivel: 'ok',
    detalhe: 'nenhum perfil configurado: cada runtime despacha pelo ambiente do processo' };
  const partes: string[] = [];
  let nivel: Check['nivel'] = 'ok';
  for (const runtime of RUNTIMES_COM_PERFIL) {
    const doRuntime = perfis.filter(p => p.runtime === runtime);
    if (doRuntime.length === 0) continue;
    const estados = doRuntime.map(p => {
      const a = auth(perfilDeDespacho(p));
      return { id: p.id, pronto: a.ok && perfilDisponivel(p),
        texto: !a.ok ? (a.pago ? 'provider pago (nunca despacha)' : a.transitorio ? 'conferencia de login inconclusiva' : 'sem login')
          : perfilDisponivel(p) ? 'pronto' : `${p.estado}${p.esgotadoAte ? ` ate ${p.esgotadoAte}` : ''}` };
    });
    const prontos = estados.filter(e => e.pronto).length;
    if (prontos === 0) nivel = 'fail';
    else if (prontos < estados.length && nivel === 'ok') nivel = 'warn';
    partes.push(`${runtime}: ${estados.map(e => `${e.id} ${e.texto}`).join(', ')}`);
  }
  return { nome: 'contas por runtime', nivel, detalhe: partes.join('; '),
    ...(nivel !== 'ok' ? { correcao: 'ork accounts check marca os perfis (sem-auth, provider-pago); ork accounts add refaz o login de assinatura pelo proprio CLI, nunca copiando credencial' } : {}) };
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
  if (config.provider === 'none') return { nome, nivel: 'ok', detalhe: 'memory.embedding com provider none: busca por significado desligada' };
  const variavel = config.api_key_env;
  if ((ENVS_DE_PROVIDER_PAGO as readonly string[]).includes(variavel)) {
    return { nome, nivel: 'fail', detalhe: `memory.embedding.api_key_env declara ${variavel}, nome da lista de provider pago`,
      correcao: 'use uma chave dedicada ao Orkastery com nome proprio, por exemplo ORKASTERY_EMBEDDING_API_KEY' };
  }
  if (!variavel) {
    return { nome, nivel: 'fail', detalhe: `memory.embedding com provider ${config.provider} sem api_key_env`,
      correcao: 'declare em memory.embedding.api_key_env o NOME da variavel com a chave dedicada' };
  }
  const valor = (env[variavel] ?? '').trim();
  const dsn = carregado.manifesto.memory.database_url_env ? (env[carregado.manifesto.memory.database_url_env] ?? '') : '';
  if (valor !== '' && !chaveDeEmbeddingAceita(valor, dsn)) {
    return { nome, nivel: 'fail', detalhe: `${variavel} tem valor recusado: parece URL, DSN ou texto com espaco (valor nunca impresso)`,
      correcao: `confira se ${variavel} guarda a chave dedicada, e nao outra credencial` };
  }
  if (valor !== '') {
    return { nome, nivel: 'ok', detalhe: `${variavel} presente no ambiente (valor nunca impresso); ${config.provider} ${config.model}` };
  }
  return { nome, nivel: 'warn', detalhe: `${variavel} ausente do ambiente: a busca por significado usa o fallback local ou cai para FTS; o regime nao muda`,
    correcao: `exporte ${variavel} com a chave dedicada ao Orkastery (com limite de credito no painel do provider)` };
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
      detalhe: `${total} entrada(s) de ${relativo(dirComum)} com outro dono (uid ${[...uids].sort((a, b) => a - b).join(', ')}; o do ` +
        `repositorio e ${raiz.uid}): ${estranhos.join(', ')}${total > estranhos.length ? ', ...' : ''}; o git do dono nao grava nelas, ` +
        `e o fetch e o commit falham${parcial ? ` (conferencia parcial: mais de ${teto} entradas)` : ''}`,
      correcao: `sudo chown -R ${raiz.uid}:${raiz.gid} ${noShell(dirComum)} (o ork nao roda isso sozinho)` };
  }
  if (parcial) {
    return { nome, nivel: 'warn', detalhe: `mais de ${teto} entradas em ${relativo(dirComum)}: conferencia parcial, sem outro dono ate aqui`,
      correcao: `confira o resto com: find ${noShell(dirComum)} -not -uid ${raiz.uid}` };
  }
  return { nome, nivel: 'ok', detalhe: `${vistos} entradas de ${relativo(dirComum)} com o dono do repositorio (uid ${raiz.uid})` };
}

/** Checks locais; ler a entrevista não abre driver, banco, runtime ou rede. */
export function checarOnboarding(carregado: ManifestoCarregado): Check[] {
  const estado = lerOnboarding(carregado.raiz);
  const pendentes = ETAPAS_ONBOARDING.filter(e => estado.etapas[e] === null);
  const checks: Check[] = [{ nome: 'onboarding', nivel: pendentes.length ? 'warn' : 'ok',
    detalhe: pendentes.length ? `${pendentes.length} etapa(s) pendente(s): ${pendentes.join(', ')}` : '9 etapas respondidas',
    ...(pendentes.length ? { correcao: 'ork onboarding' } : {}) }];
  const escolha = estado.etapas.memoria?.conteudo;
  const modo = escolha === 'sim' || escolha === true ? 'orkmind' :
    escolha === 'orkmind' || escolha === 'files' ? escolha :
    escolha && typeof escolha === 'object' && !Array.isArray(escolha) ? escolha.modo : null;
  if ((modo === 'orkmind' || modo === 'files') && modo !== carregado.manifesto.memory.mode) {
    checks.push({ nome: 'onboarding memoria', nivel: 'warn', detalhe: `entrevista escolheu ${modo}; manifesto declara ${carregado.manifesto.memory.mode}`,
      correcao: `revise memory.mode: ${modo} em orkastery.yaml; a entrevista não altera o manifesto` });
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
      detalhe: `entrevista informou ${fusoDaEntrevista}; manifesto declara ${carregado.manifesto.owner?.timezone ?? `${CHAVE_DO_FUSO} ausente`}`,
      correcao: `revise ${CHAVE_DO_FUSO}: "${fusoDaEntrevista}" em orkastery.yaml; a entrevista não altera o manifesto` });
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
 * Fatia 2 do ensaio da 0.5.0 (P1): o `claude` so e obrigatorio quando algum bloco de modo permitido
 * despacha por ele. Sem manifesto, com manifesto invalido ou com setup ilegivel vale o padrao (todo
 * bloco no claude-bg), e a falta reprova como antes.
 */
export function checarRuntimeClaude(carregado: ManifestoCarregado | null, claude: string | null,
  versao: string | null): Check {
  const nome = 'runtime claude-bg';
  if (claude) return { nome, nivel: 'ok', detalhe: `${claude} (${versao ?? 'versao desconhecida'})` };
  const blocos = carregado && carregado.erros.length === 0 ? blocosDoRuntime(carregado, 'claude-bg') : null;
  if (blocos && blocos.principal.length === 0) {
    // CHECK, rodada 1 (S6): as fases nao precisam dele, mas o `ork audit run` despacha sempre pelo claude-bg.
    return { nome, nivel: 'warn',
      detalhe: 'binario `claude` fora do PATH (opcional para as fases: nenhum bloco dos modos permitidos despacha pelo claude-bg' +
        (blocos.fallback.length
          ? `; o fallback de ${blocos.fallback.length} bloco(s) cai nele e falharia: ${textoDosBlocos(blocos.fallback)}` : '') +
        '; o ork audit run ainda despacha por ele)',
      correcao: 'para despachar pelo claude-bg (e rodar ork audit run), instale o Claude Code e garanta `claude` no PATH' };
  }
  return { nome, nivel: 'fail',
    detalhe: 'binario `claude` fora do PATH' + (blocos
      ? `; ${blocos.principal.length} bloco(s) dos modos permitidos despacham por ele (${textoDosBlocos(blocos.principal)})` : ''),
    correcao: 'instale o Claude Code e garanta `claude` no PATH; so com o Codex, passe cada bloco para ele ' +
      '(ork setup <modo> --bloco N --runtime codex --model <modelo>) ou tire o modo de conduction.allowed_modes ' +
      '(mantenha o conduction.default_mode entre os permitidos)' };
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
  const origem = [pelaAdapter ? 'runtime.adapter: codex' : '',
    blocos.length ? `${blocos.length} bloco(s) dos modos permitidos no codex (${textoDosBlocos(blocos)})` : '']
    .filter(Boolean).join(' e ');
  const sandboxConfigurado = carregado.manifesto.runtime.sandbox;
  const sandboxQuebrado = sonda !== null && !sonda.ok && sandboxConfigurado !== 'danger-full-access';
  return {
    nome: 'despacho pelo codex',
    nivel: !codex ? 'fail' : sandboxQuebrado ? 'fail' : 'ok',
    detalhe: !codex
      ? `${origem}, mas o binario \`codex\` esta fora do PATH`
      : sandboxQuebrado
        ? `${origem} com sandbox "${sandboxConfigurado}", mas o sandbox nao executa nesta maquina (o agente narraria sucesso sem rodar nada)`
        : `${origem} com sandbox "${sandboxConfigurado}"`,
    correcao: !codex
      ? 'instale o Codex CLI e autentique com `codex login` (assinatura, nunca API key)'
      : sandboxQuebrado
        ? 'instale o bubblewrap do sistema, ou declare runtime.sandbox: danger-full-access ciente do risco'
        : undefined,
  };
}

/**
 * Roda todos os checks a partir do diretorio informado. RM-031: `analisadores` e o check do grafo
 * (`checarAnalisadoresDoGrafo` do CLI do grafo), que o `index.ts` passa: fora da familia do grafo so
 * ele e o worker do MCP a abrem (fronteira do KG1), e o doctor nao a importa.
 */
export function checar(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos(),
  lerCrontab: LeitorDoCrontab = lerCrontabDoSistema, analisadores?: () => Check): Check[] {
  const checks: Check[] = [];

  const major = versaoNode();
  checks.push({
    nome: 'node',
    nivel: major >= 20 ? 'ok' : 'fail',
    detalhe: `v${process.versions.node}`,
    correcao: major >= 20 ? undefined : 'instale Node 20 ou superior',
  });
  if (analisadores) checks.push(analisadores());

  const git = noPath('git');
  checks.push({
    nome: 'git',
    nivel: git ? 'ok' : 'fail',
    detalhe: git ?? 'nao encontrado no PATH',
    correcao: git ? undefined : 'instale o git',
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
    detalhe: dentroDeRepo ? `branch ${branch}${semCommit ? ' (sem commit)' : ''}` : 'fora de um repositorio git',
    correcao: dentroDeRepo ? undefined : 'rode o ork dentro de um repositorio git',
  });
  if (dentroDeRepo) {
    const dono = checarDonoDoGit(dirInicial);
    if (dono) checks.push(dono);
  }

  // Fatia 2 do ensaio da 0.5.0 (P1): o manifesto e lido antes dos runtimes, porque e o setup dos
  // modos permitidos que diz se o `claude` e obrigatorio; a ordem das linhas do relatorio nao muda.
  const carregado = carregarManifesto(dirInicial);
  const claude = adapter.disponivel();
  const v = claude ? adapter.versao() : null;
  checks.push(checarRuntimeClaude(carregado, claude, v));

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
      ? `${codex} (${codexVersao ?? 'versao desconhecida'})`
      : usaCodex
        ? 'binario `codex` fora do PATH (o projeto despacha por ele: veja despacho pelo codex)'
        : 'binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)',
    correcao: codex
      ? undefined
      : 'para despachar pelo codex, instale o Codex CLI e autentique com `codex login`',
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
        ? '`codex sandbox true` executa nesta maquina'
        : `sonda \`codex sandbox true\` falhou: ${sondaDoCodex.detalhe}`,
      correcao: sondaDoCodex.ok
        ? undefined
        : 'instale o pacote bubblewrap do sistema (o bwrap embutido nao cria user namespace ' +
          'nesta maquina) ou declare runtime.sandbox: danger-full-access ciente do risco',
    });
  }

  if (!carregado) {
    checks.push({
      nome: 'manifesto',
      nivel: 'fail',
      detalhe: `${NOME_MANIFESTO} nao encontrado a partir de ${dirInicial}`,
      correcao: 'ork init',
    });
  } else {
    checks.push({
      nome: 'manifesto',
      nivel: carregado.erros.length > 0 ? 'fail' : carregado.avisos.length > 0 ? 'warn' : 'ok',
      detalhe:
        carregado.erros.length > 0
          ? `${carregado.caminho}: ${carregado.erros.join('; ')}`
          : `${carregado.caminho} (${carregado.bytes} B de ${LIMITE_MANIFESTO_BYTES})` +
            (carregado.avisos.length > 0 ? `; ${carregado.avisos.join('; ')}` : ''),
      correcao: carregado.erros.length > 0 ? 'corrija o manifesto e rode ork doctor de novo' : undefined,
    });

    checks.push(...checarOnboarding(carregado));
    const abbrev = carregado.manifesto.project.abbrev;
    const checkAbbrev = validarAbbrev(abbrev);
    checks.push({
      nome: 'abbrev do projeto',
      nivel: checkAbbrev.ok ? 'ok' : 'fail',
      detalhe: checkAbbrev.ok
        ? `"${abbrev}" (parte 1 do slug de sessao)`
        : (checkAbbrev.erro as string),
      correcao: checkAbbrev.ok ? undefined : 'defina project.abbrev com ate 3 caracteres [a-z0-9]',
    });

    const cond = carregado.manifesto.conduction;
    checks.push({
      nome: 'modos de conducao',
      nivel: 'ok',
      detalhe:
        `padrao ${MODOS[cond.default_mode].tag}; ` +
        `permitidos ${cond.allowed_modes.map((m) => MODOS[m].tag).join(', ')}`,
    });

    // I-35: o fuso em que todo horario chega ao dono; valor invalido avisa e nao para nada.
    const fuso = fusoDoManifesto(carregado);
    checks.push({
      nome: 'fuso do dono',
      nivel: fuso.aviso ? 'warn' : 'ok',
      detalhe: fuso.aviso ?? (fuso.origem === 'manifesto'
        ? `${fuso.fuso} (${CHAVE_DO_FUSO}); horarios para pessoas em ${rotuloDoFuso(fuso.fuso)}`
        : `${fuso.fuso} (fuso do sistema; ${CHAVE_DO_FUSO} nao configurado)`),
      correcao: fuso.aviso ? `corrija ${CHAVE_DO_FUSO} com um nome IANA` : undefined,
    });

    // Quando o manifesto ou um bloco de modo permitido ELEGE o codex, a ausencia dele (ou um
    // sandbox que nao executa) deixa de ser aviso: e exatamente o que bloquearia a fase.
    const despachoPeloCodex = checarDespachoPeloCodex(carregado, codex, sondaDoCodex);
    if (despachoPeloCodex) checks.push(despachoPeloCodex);

    const politica = carregado.manifesto.runtime.provider_policy;
    const soAssinatura = politica === 'subscription-only';
    const redirecionam = ENVS_QUE_REDIRECIONAM.filter(e => nomesHerdados.includes(e));
    const pagas = nomesHerdados;
    const bloqueia = soAssinatura && redirecionam.length > 0;
    checks.push({
      nome: 'custo e provider herdado',
      nivel: bloqueia ? 'fail' : soAssinatura && pagas.length > 0 ? 'warn' : 'ok',
      detalhe: bloqueia
        ? `politica ${politica} violada: ${redirecionam.join(', ')} redireciona o despacho do claude`
        : pagas.length > 0
          ? `politica ${politica}; despacho segue na assinatura local, mas ha credencial paga no ambiente: ${pagas.join(', ')}`
          : `politica ${politica}; nenhuma variavel de provider pago ativa`,
      correcao: bloqueia
        ? `remova do ambiente: ${redirecionam.join(', ')} (o despacho usa a assinatura Claude local)`
        : pagas.length > 0
          ? `nenhuma acao obrigatoria; nunca despache fase por ${pagas.join(', ')}`
          : undefined,
    });
    const efetivas = nomesDeProviderAtivos();
    checks.push({
      nome: 'provider efetivo da fabrica',
      nivel: soAssinatura && efetivas.length ? 'warn' : 'ok',
      detalhe: efetivas.length ? `nomes ativos: ${efetivas.join(', ')}` : 'nenhum nome da lista de provider ativo',
    });

    // Bloco B6: o regime de memoria e um CHECK, nao um detalhe do manifesto. Manifesto
    // que pede `orkmind` e nao consegue liga-lo vira `warn` com a correcao, nunca `fail`:
    // memoria semantica melhora o produto, e nao e requisito dele.
    const context = memoryState(carregado);
    const { estado } = resolverRegime(context.loaded.manifesto, null);
    checks.push({ nome: 'fonte da memoria', nivel: context.divergent ? 'warn' : 'ok',
      detalhe: `${context.source}${context.divergent ? ' (cópia da worktree divergente preservada)' : ''}` });
    checks.push({
      nome: 'regime de memoria',
      nivel: estado.efetivo === 'orkmind' ? 'ok' : estado.pedido === 'orkmind' ? 'warn' : 'ok',
      detalhe:
        estado.pedido === 'orkmind' && estado.efetivo === 'files'
          ? `pedido orkmind, efetivo files (${estado.motivo}): ${estado.detalhe}`
          : estado.efetivo === 'orkmind'
            ? `orkmind ativo no tenant "${estado.tenant}" pela variavel ${estado.variavel}`
            : 'files (fallback honesto: handoff por arquivos, ponteiro path#ancora)',
      correcao: estado.pedido === 'orkmind' && estado.efetivo === 'files' ? estado.correcao : undefined,
    });

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
          ? 'vazia: nenhuma fase morreu por limite de uso neste projeto'
          : `${esperando.length} aguardando janela, ${escalados.length} escalado(s) para humano` +
            (esperando.length > 0 ? `; proxima janela em ${formatarDataHoraRotulada(esperando[0].liberaEm)}` : ''),
      correcao:
        escalados.length > 0
          ? `pedido escalado alem do limite de retry.max_tentativas: ork retry list e ork gate request <thread>`
          : esperando.length > 0
            ? 'ork retry resume retoma o que ja liberou'
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
        ? `${dirEstadoProjeto} (${qtd} thread(s))`
        : `${dirEstadoProjeto} ausente`,
      correcao: fs.existsSync(dirEstadoProjeto) ? undefined : 'ork init cria o diretorio de estado',
    });
    // RM-039 (B6): com o transporte do pulse configurado, a varredura tem de bater de 15 em 15
    // minutos; a instalacao antiga em `0 * * * *` vira aviso com a linha nova. Nunca edita o crontab.
    const cronDoPulse = checarCronDoPulse(path.join(dirEstadoProjeto, 'monitor'), raizDoEstado(carregado.raiz), lerCrontab);
    if (cronDoPulse) checks.push(cronDoPulse);

    checks.push(checarContas(carregado.raiz));
    // I-33 (D7): umask e permissoes do estado, na mesma regra do sensor (sem bits 0o022).
    checks.push(...sondasDeAmbiente(carregado.raiz));

    {
      const inventario = inventariarSessoes(carregado.raiz, { global: true, todas: true });
      // Fatia 2 do ensaio da 0.5.0 (P1): binario ausente e fonte ausente, dita no detalhe.
      const ausentes = inventario.fontes.filter((f) => f.ausente).map((f) => f.origem);
      checks.push({
        nome: 'governanca de sessoes',
        nivel: inventario.ok && inventario.semThread === 0 ? 'ok' : 'warn',
        detalhe: `${inventario.escopo.usuario}, Claude e Codex, global com histórico: ${inventario.total} sessões; ` +
          `${inventario.semThread} sem thread; ${inventario.ambiguas} ambíguas; ` +
          `inventário ${inventario.ok ? 'válido' : 'INCOMPLETO (zero não comprovado)'}` +
          (ausentes.length ? `; fonte ausente: ${ausentes.join(', ')}` : ''),
        correcao: inventario.ok && inventario.semThread === 0 ? undefined :
          'ork sessions --global --all --json; adote identidades sem vínculo com ork sessions adopt <id>',
      });
    }
  }

  return checks;
}

/** Texto do relatorio, com o resumo "o que vale nesta maquina agora". */
export function relatorio(checks: Check[]): string {
  const linhas: string[] = [];
  linhas.push('ork doctor: o que vale nesta maquina agora');
  linhas.push('');
  const largura = Math.max(...checks.map((c) => c.nome.length));
  // I-35: o Check guarda o ISO (dado de maquina, tambem lido por teste); quem imprime para o dono
  // localiza. Vale para todo check, nao so o de contas: nenhum horario chega cru ao relatorio.
  let localizou = false;
  const local = (t: string): string => {
    const l = localizarTexto(t);
    if (l !== t) localizou = true;
    return l;
  };
  for (const c of checks) {
    linhas.push(`  ${simbolo(c.nivel)} ${c.nome.padEnd(largura)}  ${local(c.detalhe)}`);
    if (c.nivel !== 'ok' && c.correcao) {
      linhas.push(`         ${' '.repeat(largura)}  correcao: ${local(c.correcao)}`);
    }
  }
  // O fuso sai uma vez por mensagem, antes do veredito, que segue sendo a ultima linha.
  if (localizou && !linhas.some((l) => l.includes(legendaDoFuso()))) linhas.push(legendaDoFuso());
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  const avisos = checks.filter((c) => c.nivel === 'warn').length;
  linhas.push('');
  linhas.push(
    falhas > 0
      ? `Veredito: BLOQUEADO (${falhas} fail, ${avisos} warn). Corrija os itens acima antes de despachar fase.`
      : `Veredito: PRONTO (${avisos} warn). Despacho de fase liberado por \`ork phase run\`.`
  );
  return linhas.join('\n');
}

/** Executa o doctor e devolve o codigo de saida (0 = pronto). */
export function doctor(dirInicial: string = process.cwd(), nomesHerdados = nomesDeProviderAtivos(),
  analisadores?: () => Check): { texto: string; codigo: number } {
  const checks = checar(dirInicial, nomesHerdados, undefined, analisadores);
  const falhas = checks.filter((c) => c.nivel === 'fail').length;
  return { texto: relatorio(checks), codigo: falhas > 0 ? 1 : 0 };
}
