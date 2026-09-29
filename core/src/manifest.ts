/**
 * Manifesto por projeto (`orkastery.yaml`), com `devmaster.yaml` lido como fallback
 * durante a migracao dos habitos.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerYaml, ValorYaml } from './yaml';
import { ConfigDeEmbedding, Manifesto, Modo } from './types';
import { modoAposentado, ORDEM_DOS_MODOS, parseModo, substitutosVivos } from './modos';
import { ORDEM_DOS_RUNTIMES, RUNTIME_PADRAO, runtimeConhecido } from './runtimes';
import { SANDBOX_PADRAO, SANDBOXES_DO_CODEX } from './adapters/codex';
import { validarAbbrev } from './slug';
import { exec, subirAte } from './util';
import { validarDelegacao } from './delegation';
import { lerFusoDoDono } from './horario';
import { ENVS_DE_PROVIDER_PAGO } from './runtime-ambiente';

export const NOME_MANIFESTO = 'orkastery.yaml';
export const NOME_MANIFESTO_LEGADO = 'devmaster.yaml';
export const DIR_ESTADO = '.orkastery';
/** Limite duro: o manifesto nao pode virar o novo arquivo de 100 KB. */
export const LIMITE_MANIFESTO_BYTES = 16384;

export interface ManifestoCarregado {
  caminho: string;
  raiz: string;
  legado: boolean;
  bytes: number;
  manifesto: Manifesto;
  erros: string[];
  avisos: string[];
}

/** Raiz do projeto: o diretorio que contem o manifesto; senao, a raiz do repositorio git. */
export function acharRaiz(dirInicial: string = process.cwd()): string {
  const porManifesto = subirAte(dirInicial, NOME_MANIFESTO);
  if (porManifesto) return porManifesto;
  const porLegado = subirAte(dirInicial, NOME_MANIFESTO_LEGADO);
  if (porLegado) return porLegado;
  const git = exec('git', ['rev-parse', '--show-toplevel'], dirInicial);
  if (git.ok) return git.stdout.trim();
  return path.resolve(dirInicial);
}

/** Caminho do diretorio de estado da raiz informada. */
export function dirEstado(raiz: string): string {
  return path.join(raiz, DIR_ESTADO);
}

function texto(v: ValorYaml, padrao: string): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : padrao;
}

function numero(v: ValorYaml, padrao: number): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : padrao;
}

/**
 * I-37 (D2): `verify.timeout_ms` e `verify.timeout_ms_por_comando`. Prazo so vale inteiro
 * positivo em milissegundos, entre 1 s e 24 h; o resto e erro do manifesto, porque um prazo
 * mal escrito que caisse no default em silencio mudaria o veredito sem ninguem saber.
 */
function prazosDoVerify(verify: Record<string, ValorYaml>, erros: string[]): Pick<Manifesto['verify'], 'timeout_ms' | 'timeout_ms_por_comando'> {
  const prazo = (chave: string, v: ValorYaml): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1_000 || n > 86_400_000) {
      erros.push(`${chave} precisa ser um inteiro em ms entre 1000 e 86400000 (recebido ${JSON.stringify(v)})`);
      return undefined;
    }
    return n;
  };
  const saida: Pick<Manifesto['verify'], 'timeout_ms' | 'timeout_ms_por_comando'> = {};
  const geral = prazo('verify.timeout_ms', verify.timeout_ms);
  if (geral !== undefined) saida.timeout_ms = geral;
  const brutos = mapa(verify.timeout_ms_por_comando);
  const porComando: NonNullable<Manifesto['verify']['timeout_ms_por_comando']> = {};
  for (const nome of Object.keys(brutos)) {
    if (!['build', 'test', 'typecheck'].includes(nome)) {
      erros.push(`verify.timeout_ms_por_comando.${nome}: so build, test e typecheck tem prazo proprio`);
      continue;
    }
    const n = prazo(`verify.timeout_ms_por_comando.${nome}`, brutos[nome]);
    if (n !== undefined) porComando[nome as 'build' | 'test' | 'typecheck'] = n;
  }
  if (Object.keys(porComando).length > 0) saida.timeout_ms_por_comando = porComando;
  return saida;
}

function booleano(v: ValorYaml, padrao: boolean): boolean {
  return typeof v === 'boolean' ? v : padrao;
}

function mapa(v: ValorYaml): Record<string, ValorYaml> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ValorYaml>) : {};
}

/** Mesmo contrato na leitura do YAML e nos consumidores de manifesto em memoria. */
export function validarOptInPlaybook(valor: unknown): boolean {
  if (valor === undefined) return false;
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.keys(valor).length !== 1 || !Object.hasOwn(valor, 'ativo') ||
      typeof (valor as { ativo?: unknown }).ativo !== 'boolean') {
    throw new Error('playbook deve conter somente ativo booleano explicito');
  }
  return (valor as { ativo: boolean }).ativo;
}

/** I-38 (D5): sem o bloco `memory.embedding`, os embeddings ficam desligados. */
export const EMBEDDING_PADRAO: Readonly<ConfigDeEmbedding> = Object.freeze({
  provider: 'none', model: '', dim: 1024, api_key_env: '', fallback_model: '', max_tokens_por_execucao: 1_000_000,
});

const MODELO_HF = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CHAVES_DE_EMBEDDING = ['provider', 'model', 'dim', 'api_key_env', 'fallback_model', 'max_tokens_por_execucao'];

/**
 * I-38 (D5): le e valida `memory.embedding`. A chave so entra pelo NOME da variavel: valor com
 * cara de chave ou DSN reprova o manifesto, e nome da lista de provider pago tambem, porque a
 * entrada do `ork` apagaria a variavel sob `subscription-only` e o preflight reprovaria o codex.
 */
function lerEmbedding(bruto: ValorYaml, variavelDaDsn: string, erros: string[]): ConfigDeEmbedding | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto !== 'object' || Array.isArray(bruto)) {
    erros.push('memory.embedding precisa ser um bloco com provider, model, dim, api_key_env, fallback_model e max_tokens_por_execucao');
    return undefined;
  }
  const e = bruto as Record<string, ValorYaml>;
  for (const chave of Object.keys(e)) {
    if (!CHAVES_DE_EMBEDDING.includes(chave)) {
      erros.push(`memory.embedding.${chave} nao existe (a chave entra pelo ambiente: declare so o NOME em api_key_env)`);
    }
  }
  const provider = texto(e.provider, EMBEDDING_PADRAO.provider).trim();
  if (provider !== 'none' && provider !== 'openrouter') {
    erros.push(`memory.embedding.provider invalido: "${provider}" (aceitos: none, openrouter)`);
  }
  const model = texto(e.model, '').trim();
  const apiKeyEnv = texto(e.api_key_env, '').trim();
  const fallback = texto(e.fallback_model, '').trim();
  const inteiro = (chave: string, v: ValorYaml, padrao: number, min: number, max: number): number => {
    if (v === undefined || v === null) return padrao;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) {
      erros.push(`memory.embedding.${chave} precisa ser inteiro entre ${min} e ${max} (recebido ${JSON.stringify(v)})`);
      return padrao;
    }
    return n;
  };
  const dim = inteiro('dim', e.dim, EMBEDDING_PADRAO.dim, 32, 4096);
  const teto = inteiro('max_tokens_por_execucao', e.max_tokens_por_execucao, EMBEDDING_PADRAO.max_tokens_por_execucao, 1, 10_000_000);
  if (apiKeyEnv.includes('://') || /^sk-/i.test(apiKeyEnv)) {
    erros.push('memory.embedding.api_key_env recebe o NOME da variavel de ambiente com a chave, nunca o valor da chave nem uma DSN');
  } else if (apiKeyEnv !== '' && !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv)) {
    erros.push('memory.embedding.api_key_env invalido: esperado nome de variavel de ambiente, [A-Z][A-Z0-9_]* (o valor recebido nao e repetido)');
  } else if ((ENVS_DE_PROVIDER_PAGO as readonly string[]).includes(apiKeyEnv)) {
    erros.push(`memory.embedding.api_key_env nao pode ser ${apiKeyEnv}: nomes de provider pago sao removidos sob subscription-only; use uma chave dedicada com nome proprio`);
  } else if (apiKeyEnv !== '' && apiKeyEnv === variavelDaDsn) {
    erros.push('memory.embedding.api_key_env nao pode repetir memory.database_url_env: a DSN nunca vai ao provider');
  }
  if (provider === 'openrouter') {
    if (!MODELO_HF.test(model)) erros.push(`memory.embedding.model invalido: "${model}" (esperado org/nome, por exemplo qwen/qwen3-embedding-8b)`);
    if (apiKeyEnv === '') erros.push('memory.embedding.api_key_env e obrigatorio com provider openrouter (o NOME da variavel com a chave dedicada)');
  }
  if (fallback !== '' && !MODELO_HF.test(fallback)) {
    erros.push(`memory.embedding.fallback_model invalido: "${fallback}" (esperado org/nome de um modelo do Hugging Face)`);
  }
  return { provider: provider === 'openrouter' ? 'openrouter' : 'none', model, dim, api_key_env: apiKeyEnv,
    fallback_model: fallback, max_tokens_por_execucao: teto };
}

/** I-38 (D5): leitura unica da configuracao de embedding, com o padrao `none`. */
export function configDeEmbedding(manifesto: Pick<Manifesto, 'memory'>): ConfigDeEmbedding {
  return { ...EMBEDDING_PADRAO, ...(manifesto.memory.embedding ?? {}) };
}

/** I-33 (N2): texto e numero que dizem sim ou nao sem ambiguidade; o resto nao e reconhecido. */
const BOOLEANOS_RECONHECIVEIS = new Map<string, boolean>([
  ['true', true], ['yes', true], ['on', true], ['sim', true], ['1', true],
  ['false', false], ['no', false], ['off', false], ['nao', false], ['n\u00e3o', false], ['0', false],
]);

function booleanoReconhecivel(v: unknown): boolean | null {
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== 'string') return null;
  return BOOLEANOS_RECONHECIVEIS.get(v.trim().toLowerCase()) ?? null;
}

/** Le e valida o manifesto. Nunca lanca: erros e avisos voltam na estrutura. */
export function carregarManifesto(dirInicial: string = process.cwd()): ManifestoCarregado | null {
  const raiz = acharRaiz(dirInicial);
  const candidatos = [
    { caminho: path.join(raiz, NOME_MANIFESTO), legado: false },
    { caminho: path.join(raiz, NOME_MANIFESTO_LEGADO), legado: true },
  ];
  const achado = candidatos.find((c) => fs.existsSync(c.caminho));
  if (!achado) return null;

  const bruto = fs.readFileSync(achado.caminho, 'utf8');
  const erros: string[] = [];
  const avisos: string[] = [];
  let dados: Record<string, ValorYaml> = {};
  try {
    dados = mapa(lerYaml(bruto));
  } catch (e) {
    erros.push((e as Error).message);
  }

  const project = mapa(dados.project);
  // I-35: fonte unica do fuso do dono. Valor invalido nao reprova o manifesto: avisa e cai
  // no fuso do sistema, porque um horario com rotulo certo vale mais que um comando parado.
  const fusoDoDono = lerFusoDoDono(mapa(dados.owner).timezone);
  if (fusoDoDono.aviso) avisos.push(fusoDoDono.aviso);
  const board = mapa(dados.board);
  const runtime = mapa(dados.runtime);
  const conduction = mapa(dados.conduction);
  if (conduction.delegation !== undefined && !validarDelegacao(conduction.delegation)) {
    erros.push('conduction.delegation exige thread, escopo premissas, prazo ISO, evidencia e delegado');
  }
  const worktree = mapa(dados.worktree);
  const verify = mapa(dados.verify);
  const ci = mapa(dados.ci);
  const concurrency = mapa(dados.concurrency);
  const handoff = mapa(dados.handoff);
  const retry = mapa(dados.retry);
  // I-33 (D14, N2): so booleano liga ou desliga a troca. Texto ou numero reconhecivel (`off`, "false", 0,
  // "no") vale o booleano que diz, com aviso; o resto vale o padrao documentado, tambem com aviso.
  const perfisDeRuntime = mapa(dados.runtime_profiles);
  const chaveDeRotacao = (nome: string, padrao: boolean): boolean => {
    const v = perfisDeRuntime[nome];
    if (v === undefined || v === null) return padrao;
    if (typeof v === 'boolean') return v;
    const lido = booleanoReconhecivel(v);
    if (lido !== null) {
      avisos.push(`runtime_profiles.${nome} deve ser true ou false; ${JSON.stringify(v)} lido como ${lido}`);
      return lido;
    }
    avisos.push(`runtime_profiles.${nome} deve ser true ou false; vale o padrao ${padrao} (${JSON.stringify(v)} nao reconhecido)`);
    return padrao;
  };
  const liveness = mapa(dados.liveness);
  const silencioMaxMin = numero(liveness.silencio_max_min, 10);
  if (!Number.isFinite(silencioMaxMin) || silencioMaxMin <= 0) erros.push('liveness.silencio_max_min deve ser positivo e finito');
  const memory = mapa(dados.memory);
  const audit = mapa(dados.audit);
  const fabrica = mapa(dados.fabrica);
  let playbook: Manifesto['playbook'];
  try {
    const ativo = validarOptInPlaybook(dados.playbook);
    if (dados.playbook !== undefined) playbook = { ativo };
  } catch (e) {
    erros.push((e as Error).message);
  }

  const abbrev = texto(project.abbrev, '');
  const checkAbbrev = validarAbbrev(abbrev);
  if (!checkAbbrev.ok) erros.push(checkAbbrev.erro as string);

  const nomeProjeto = texto(project.name, '');
  if (!nomeProjeto) erros.push('project.name ausente no manifesto');

  /**
   * I-43 (D6): o manifesto e a unica peca com motivo para DISTINGUIR modo aposentado
   * de modo inexistente, e por isso a distincao mora so aqui.
   *
   * `parseModo` continua estrito de proposito: ele e o portao de ESCRITA, e afrouxa-lo
   * deixaria `#Look` ser escrito de novo. Mas um `orkastery.yaml` que lista `look` estava
   * CERTO quando foi escrito, e existe assim nos quatro arquivos deste VPS. Tratar isso
   * como erro pintaria `ork doctor` de vermelho nos tres projetos no dia um, com uma
   * mensagem que culpa o usuario por um arquivo que ele nao errou.
   *
   * Entao: modo aposentado vira AVISO e sai da lista de permitidos; so valor
   * genuinamente desconhecido continua ERRO.
   */
  const brutoDefault = texto(conduction.default_mode, 'classic');
  const defaultModo = parseModo(brutoDefault);
  if (!defaultModo) {
    const substitutos = substitutosVivos().join(' ou ');
    erros.push(modoAposentado(brutoDefault.trim().toLowerCase())
      ? `conduction.default_mode aposentado: "${brutoDefault}" (use ${substitutos})`
      : `conduction.default_mode invalido: "${brutoDefault}"`);
  }

  const brutosPermitidos = Array.isArray(conduction.allowed_modes)
    ? (conduction.allowed_modes as ValorYaml[]).map((m) => texto(m, ''))
    : [...ORDEM_DOS_MODOS];
  const permitidos: Modo[] = [];
  for (const b of brutosPermitidos) {
    const m = parseModo(b);
    if (m) { permitidos.push(m); continue; }
    if (modoAposentado(b.trim().toLowerCase())) {
      avisos.push(`conduction.allowed_modes ignora modo aposentado "${b}"; use ${substitutosVivos().join(' ou ')}`);
      continue;
    }
    erros.push(`conduction.allowed_modes contem modo invalido: "${b}"`);
  }
  if (permitidos.length === 0) permitidos.push(...ORDEM_DOS_MODOS);
  if (defaultModo && !permitidos.includes(defaultModo)) {
    erros.push(`conduction.default_mode (${defaultModo}) fora de conduction.allowed_modes`);
  }

  const providerPolicy = texto(runtime.provider_policy, 'subscription-only');
  if (providerPolicy !== 'subscription-only' && providerPolicy !== 'any') {
    avisos.push(`runtime.provider_policy desconhecida: "${providerPolicy}"`);
  }

  // Runtime de despacho: so os homologados passam. Um typo aqui viraria erro apenas na
  // hora do despacho, com a thread ja aberta; reprovar no manifesto e mais barato.
  const adapterDeRuntime = texto(runtime.adapter, RUNTIME_PADRAO);
  if (!runtimeConhecido(adapterDeRuntime)) {
    erros.push(
      `runtime.adapter desconhecido: "${adapterDeRuntime}" (homologados: ${ORDEM_DOS_RUNTIMES.join(', ')})`
    );
  }
  const sandboxDoRuntime = texto(runtime.sandbox, SANDBOX_PADRAO);
  if (!(SANDBOXES_DO_CODEX as readonly string[]).includes(sandboxDoRuntime)) {
    erros.push(
      `runtime.sandbox invalido: "${sandboxDoRuntime}" (aceitos: ${SANDBOXES_DO_CODEX.join(', ')})`
    );
  }

  // Bloco B6, isolamento por tenant (precedente do incidente memory-orkmind):
  // `database_url_env` recebe o NOME da variavel de ambiente, nunca a string de conexao.
  // Uma DSN colada aqui e exatamente o defeito que fez a memoria de um produto escrever
  // na base de outro, entao ela reprova o manifesto em vez de degradar em silencio.
  const modoDeMemoria = texto(memory.mode, 'files');
  if (modoDeMemoria !== 'files' && modoDeMemoria !== 'orkmind') {
    erros.push(`memory.mode invalido: "${modoDeMemoria}" (esperado files ou orkmind)`);
  }
  const variavelDaDsn = texto(memory.database_url_env, '').trim();
  if (variavelDaDsn.includes('://')) {
    erros.push(
      'memory.database_url_env recebe o NOME da variavel de ambiente com a DSN, nunca a ' +
        'string de conexao (base propria por tenant, sem fallback para base alheia)'
    );
  } else if (variavelDaDsn !== '' && !/^[A-Z][A-Z0-9_]*$/.test(variavelDaDsn)) {
    erros.push(
      `memory.database_url_env invalido: "${variavelDaDsn}" (esperado nome de variavel de ambiente, [A-Z][A-Z0-9_]*)`
    );
  }
  if (modoDeMemoria === 'orkmind' && variavelDaDsn === '') {
    avisos.push(
      'memory.mode: orkmind sem memory.database_url_env: o regime efetivo cai para files ' +
        '(o `ork` nao adivinha DSN, e base alheia e pior do que base nenhuma)'
    );
  }
  const embedding = lerEmbedding(memory.embedding, variavelDaDsn, erros);

  const bytes = Buffer.byteLength(bruto, 'utf8');
  if (bytes > LIMITE_MANIFESTO_BYTES) {
    erros.push(
      `manifesto com ${bytes} bytes, acima do limite duro de ${LIMITE_MANIFESTO_BYTES} (prosa vai para memoria com tag, nao para o YAML)`
    );
  }
  if (achado.legado) {
    avisos.push(`lendo ${NOME_MANIFESTO_LEGADO} como fallback; migre para ${NOME_MANIFESTO}`);
  }

  const manifesto: Manifesto = {
    project: {
      name: nomeProjeto,
      abbrev,
      stage: (texto(project.stage, 'nascente') as Manifesto['project']['stage']) ?? 'nascente',
      repo_root: texto(project.repo_root, raiz),
    },
    ...(fusoDoDono.origem === 'manifesto' ? { owner: { timezone: fusoDoDono.fuso } } : {}),
    board: {
      adapter: texto(board.adapter, 'hermes-kanban'),
      default: texto(board.default, 'default'),
    },
    runtime: {
      adapter: adapterDeRuntime,
      model: texto(runtime.model, 'opus'),
      effort: texto(runtime.effort, 'high'),
      provider_policy: providerPolicy,
      sandbox: sandboxDoRuntime,
    },
    conduction: {
      default_mode: defaultModo ?? 'classic',
      allowed_modes: permitidos,
      ...(validarDelegacao(conduction.delegation) ? { delegation: conduction.delegation } : {}),
    },
    ...(playbook === undefined ? {} : { playbook }),
    worktree: {
      base_branch: texto(worktree.base_branch, 'main'),
      dir: texto(worktree.dir, '.claude/worktrees'),
      por_thread: booleano(worktree.por_thread, true),
    },
    verify: {
      build: verify.build === null || verify.build === undefined ? undefined : texto(verify.build, ''),
      test: verify.test === null || verify.test === undefined ? undefined : texto(verify.test, ''),
      ...prazosDoVerify(verify, erros),
      typecheck:
        verify.typecheck === null || verify.typecheck === undefined
          ? undefined
          : texto(verify.typecheck, ''),
      // I-54 (RM-037, D10): o preparo unico da rodada de verify, quando declarado.
      ...(typeof verify.preparo === 'string' && verify.preparo.trim() ? { preparo: verify.preparo.trim() } : {}),
    },
    ci: {
      required_for_ship: booleano(ci.required_for_ship, false),
      context: texto(ci.context, 'ork-verify'),
      command: ci.command === null || ci.command === undefined ? undefined : texto(ci.command, ''),
    },
    concurrency: {
      max_parallel_threads: numero(concurrency.max_parallel_threads, 3),
      stale_after_min: Math.max(1, Math.trunc(numero(concurrency.stale_after_min, 240))),
    },
    liveness: { silencio_max_min: silencioMaxMin },
    handoff: {
      rotate_above: numero(handoff.rotate_above, 0.7),
      force_rotate_above: numero(handoff.force_rotate_above, 0.85),
    },
    // I-33 (D16): troca por cota ligada por padrao, decisao do dono em 19/09/2026; o operador desliga aqui.
    runtime_profiles: {
      rotate_same_runtime_on_quota: chaveDeRotacao('rotate_same_runtime_on_quota', true),
      rotate_same_runtime_on_auth: chaveDeRotacao('rotate_same_runtime_on_auth', true),
    },
    // Bloco B3: o limite de escalacao tem padrao, e o padrao e conservador. Manifesto
    // sem bloco `retry:` continua andando com 3 tentativas e janela estimada de 60 min,
    // que e exatamente o que o B3 promete, nao um "sem limite" implicito.
    retry: {
      max_tentativas: Math.max(0, Math.trunc(numero(retry.max_tentativas, 3))),
      janela_padrao_min: Math.max(1, Math.trunc(numero(retry.janela_padrao_min, 60))),
      escalar_esforco: booleano(retry.escalar_esforco, true),
    },
    // Bloco B6: regime de memoria. `files` e o padrao e continua sendo o fallback
    // honesto; `orkmind` liga a camada semantica POR CIMA, e so liga quando a base
    // propria do tenant esta declarada por NOME de variavel de ambiente.
    memory: {
      mode: modoDeMemoria,
      database_url_env: variavelDaDsn,
      cli: texto(memory.cli, 'orkmind'),
      tenant: texto(memory.tenant, '') || nomeProjeto,
      timeout_ms: numero(memory.timeout_ms, 15000),
      ...(embedding ? { embedding } : {}),
    },
    // Bloco B5: governanca de custo dos auditores. Ausente no manifesto quer dizer
    // "nao declarada", nao "sem limite": a rodada avisa que so `eco` e o escopo
    // incremental estao governando o custo, em vez de fingir uma janela que ninguem escreveu.
    audit: {
      janela_ociosa: texto(audit.janela_ociosa, ''),
      effort: texto(audit.effort, 'eco'),
      since_padrao: texto(audit.since_padrao, '7d'),
      graphify: texto(audit.graphify, 'auto'),
    },
    // I-51 (RM-047): publicar o estado da fabrica empurra para o remoto, entao so com opt-in.
    fabrica: {
      compartilhada: booleano(fabrica.compartilhada, false),
      remoto: texto(fabrica.remoto, 'origin'),
    },
    policies: Object.fromEntries(
      Object.entries(mapa(dados.policies)).map(([k, v]) => [k, texto(v, '')])
    ),
  };

  return { caminho: achado.caminho, raiz, legado: achado.legado, bytes, manifesto, erros, avisos };
}

/** Carrega o manifesto ou encerra com mensagem acionavel (uso nos subcomandos). */
export function exigirManifesto(dirInicial: string = process.cwd()): ManifestoCarregado {
  const carregado = carregarManifesto(dirInicial);
  if (!carregado) {
    throw new Error(
      `manifesto ${NOME_MANIFESTO} nao encontrado a partir de ${dirInicial}. Rode: ork init`
    );
  }
  if (carregado.erros.length > 0) {
    throw new Error(
      `manifesto invalido (${carregado.caminho}):\n  - ${carregado.erros.join('\n  - ')}`
    );
  }
  return carregado;
}
