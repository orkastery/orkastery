/**
 * Manifesto por projeto (`orkastery.yaml`), com `devmaster.yaml` lido como fallback
 * durante a migracao dos habitos.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerYaml, ValorYaml } from './yaml';
import { ConfigDeEmbedding, ConfigDoAgile, Manifesto, Modo } from './types';
import { modoAposentado, ORDEM_DOS_MODOS, parseModo, substitutosVivos } from './modos';
import { ORDEM_DOS_RUNTIMES, RUNTIME_PADRAO, runtimeConhecido, runtimeDeBloco } from './runtimes';
import { SANDBOX_PADRAO, SANDBOXES_DO_CODEX } from './adapters/codex';
import { validarAbbrev } from './slug';
import { exec, subirAte } from './util';
import { validarDelegacao } from './delegation';
import { lerFusoDoDono } from './horario';
import { validarPreferencias } from './experiencia';
import { ENVS_DE_PROVIDER_PAGO } from './runtime-ambiente';
import { LIMITE_TIMEOUT_DO_UNIVERSO_MS, MODELO_DE_EMBEDDING, TIMEOUT_DO_UNIVERSO_MS } from './orkmind';
import { arquivoDaDsnValido, PREFIXO_DO_ARQUIVO_DA_DSN } from './dsn-da-memoria';
import { ErroDoCatalogo } from './locale';
import { TIPOS_DE_FORJA, TipoDeForja } from './forja/contrato';
import { branchValida } from './branch-de-estado';
import { lerModo, MODOS_DO_CHECK } from './check-modo';

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

let diretorioFixado: string | null = null;

/**
 * RM-052: o projeto-alvo fixado pelo CLI (`--projeto`, `ORK_PROJETO`, host sem cwd) vira o ponto
 * de partida padrao das raizes. Sem ele, vale o cwd, como sempre. Quem fixa e `fixarProjetoAlvo`.
 */
export function fixarDiretorioDoProjeto(dir: string | null): void {
  diretorioFixado = dir;
}

/** De onde as raizes padrao partem: o projeto-alvo fixado ou, sem ele, o cwd do processo. */
export function diretorioDoProjeto(): string {
  return diretorioFixado ?? process.cwd();
}

/** Raiz do projeto: o diretorio que contem o manifesto; senao, a raiz do repositorio git. */
export function acharRaiz(dirInicial: string = diretorioDoProjeto()): string {
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
  // RM-047 (fronteira de confiança): `.orkastery` versionado como link levaria o estado para fora da raiz.
  const dir = path.join(raiz, DIR_ESTADO);
  if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new ErroDoCatalogo((m) => m.estado.dirEstadoLink(DIR_ESTADO));
  }
  return dir;
}

function texto(v: ValorYaml, padrao: string): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : padrao;
}

function numero(v: ValorYaml, padrao: number): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : padrao;
}

/**
 * RM-058 N2: as vagas da fila pesada, inteiras de 0 a 64. So o 0 escrito desliga a fila; fracao positiva sobe para 1 e
 * valor sem sentido volta ao padrao 1, nunca a "sem fila".
 */
function vagasPesadas(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 1;
  return v === 0 ? 0 : Math.min(64, Math.max(1, Math.trunc(v)));
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
    if (!['build', 'test', 'typecheck', 'security_scan'].includes(nome)) {
      erros.push(`verify.timeout_ms_por_comando.${nome}: so build, test, typecheck e security_scan tem prazo proprio`);
      continue;
    }
    const n = prazo(`verify.timeout_ms_por_comando.${nome}`, brutos[nome]);
    if (n !== undefined) porComando[nome as 'build' | 'test' | 'typecheck' | 'security_scan'] = n;
  }
  if (Object.keys(porComando).length > 0) saida.timeout_ms_por_comando = porComando;
  return saida;
}

/**
 * RM-037 (defeitos de 19 e 20/10/2026, defeito 2): `worktree.dependencias`, o comando que o `ork` roda dentro de toda
 * worktree nova da thread. So vale texto: outro tipo e erro do manifesto, porque um preparo mal escrito que sumisse em
 * silencio deixaria a worktree nova sem as dependencias, como antes. Texto vazio e o mesmo que nenhum.
 */
function dependenciasDaWorktree(v: ValorYaml, erros: string[]): { dependencias?: string } {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'string') {
    erros.push(`worktree.dependencias precisa ser o comando, em texto (recebido ${exibir(v)})`);
    return {};
  }
  const comando = v.trim();
  return comando ? { dependencias: comando } : {};
}

/** O caminho de um projeto: dois segmentos ou mais (os subgrupos do GitLab). */
const CAMINHO_DE_PROJETO = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;

/**
 * RM-037 (rm037defeito, defeito 5): `ci.external_repositories`, mapa do caminho do projeto (`dono/nome` no GitHub,
 * `grupo/sub/projeto` no GitLab) para o check exigido no head do PR (texto vazio ou nulo: repositorio sem CI). Forma
 * invalida e erro do manifesto, nunca adivinhada.
 */
function repositoriosExternos(v: ValorYaml, erros: string[]): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) {
    erros.push('ci.external_repositories deve ser um mapa "dono/nome": "check exigido" (vazio para repositorio sem CI)');
    return {};
  }
  const r: Record<string, string> = {};
  for (const [repo, check] of Object.entries(v)) {
    if (!CAMINHO_DE_PROJETO.test(repo) || repo.split('/').some((p) => p === '.' || p === '..')) {
      erros.push(`ci.external_repositories: "${repo}" nao e dono/nome do GitHub nem grupo/subgrupo/projeto do GitLab`);
      continue;
    }
    if (check !== null && typeof check !== 'string') { erros.push(`ci.external_repositories.${repo}: o check exigido e texto (vazio para sem CI)`); continue; }
    r[repo] = (check ?? '').trim();
  }
  return r;
}

function booleano(v: ValorYaml, padrao: boolean): boolean {
  return typeof v === 'boolean' ? v : padrao;
}

function mapa(v: ValorYaml): Record<string, ValorYaml> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ValorYaml>) : {};
}

/**
 * RM-031 KG5 (D2): `grafo.mcp` so liga com o booleano `true`. Ausente vale `false`; texto que parece
 * booleano, outro tipo ou `grafo` que nao e mapa tambem valem `false`, com aviso: ligar expoe as tools
 * do grafo, e na duvida fica desligado. Chave desconhecida em `grafo` so avisa.
 */
function lerGrafo(v: ValorYaml | undefined, avisos: string[]): Manifesto['grafo'] {
  const mostrar = (x: ValorYaml): string => JSON.stringify(x).slice(0, 80);
  if (v === undefined || v === null) return { mcp: false };
  if (typeof v !== 'object' || Array.isArray(v)) {
    avisos.push(`grafo deve ser um mapa com mcp: true ou false; vale mcp: false (${mostrar(v)} nao reconhecido)`);
    return { mcp: false };
  }
  for (const chave of Object.keys(v)) if (chave !== 'mcp') avisos.push(`grafo.${chave} desconhecida; o bloco grafo so tem mcp`);
  const mcp = v.mcp;
  if (mcp === undefined || mcp === null || typeof mcp === 'boolean') return { mcp: mcp === true };
  avisos.push(`grafo.mcp deve ser true ou false; vale false (${mostrar(mcp)} nao reconhecido)`);
  return { mcp: false };
}

/**
 * RM-072 (D1 da ork-check5x): o bloco `check`. `mode` aceita `agile` e `classic` (sem diferenca de caixa); outro valor e
 * erro do manifesto com os dois valores aceitos, porque um modo mal escrito que caisse no padrao em silencio mudaria o
 * CHECK sem ninguem saber. Ausente, `mode` vale o padrao na hora da rodada. Chave desconhecida so avisa.
 */
function lerCheck(v: ValorYaml | undefined, erros: string[], avisos: string[]): Manifesto['check'] {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    erros.push(`check precisa ser um mapa com mode: ${MODOS_DO_CHECK.join(' ou ')} (recebido ${exibir(v)})`);
    return undefined;
  }
  for (const chave of Object.keys(v)) {
    if (!['mode', 'agile'].includes(chave)) avisos.push(`check.${chave} desconhecida; o bloco check tem mode e agile`);
  }
  const check: NonNullable<Manifesto['check']> = {};
  if (v.mode !== undefined && v.mode !== null) {
    const modo = lerModo(v.mode);
    if (modo) check.mode = modo;
    else erros.push(`check.mode invalido: ${exibir(v.mode)} (aceitos: ${MODOS_DO_CHECK.join(', ')})`);
  }
  const agile = lerAgile(v.agile, erros, avisos);
  if (agile) check.agile = agile;
  return check;
}

/** Nome de lane: o que vira `test:<lane>` no ledger. */
const NOME_DE_LANE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * RM-072 (D3): o bloco `check.agile`. Cada chave liga uma peca do Agile; tipo errado e erro do manifesto, porque uma
 * peca mal escrita que sumisse em silencio mudaria o que o CHECK roda. `produto` so aceita caminho relativo dentro da
 * raiz, fora do estado do `ork` e do `.git` (o hash da guarda le esses arquivos).
 */
function lerAgile(v: ValorYaml | undefined, erros: string[], avisos: string[]): ConfigDoAgile | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    erros.push(`check.agile precisa ser um mapa (recebido ${exibir(v)})`);
    return undefined;
  }
  const conhecidas = ['produto', 'preparo', 'test', 'apos_a_varredura', 'osv_scanner', 'oxlint'];
  for (const chave of Object.keys(v)) {
    if (!conhecidas.includes(chave)) avisos.push(`check.agile.${chave} desconhecida; o bloco check.agile tem ${conhecidas.join(', ')}`);
  }
  const agile: ConfigDoAgile = {};
  if (v.produto !== undefined && v.produto !== null) {
    const lista = Array.isArray(v.produto) ? v.produto : [v.produto];
    const validos: string[] = [];
    for (const item of lista) {
      const caminho = typeof item === 'string' ? item.trim().replace(/\/+$/, '') : '';
      const normal = caminho ? path.posix.normalize(caminho) : '';
      if (!caminho || path.isAbsolute(caminho) || normal.startsWith('..') || /^(\.orkastery|\.git)(\/|$)/.test(normal)) {
        erros.push(`check.agile.produto: ${exibir(item)} precisa ser um caminho relativo dentro da raiz, fora de .orkastery e .git`);
      } else validos.push(normal);
    }
    if (validos.length) agile.produto = validos;
  }
  if (v.preparo !== undefined && v.preparo !== null) {
    if (typeof v.preparo === 'string' && v.preparo.trim()) agile.preparo = v.preparo.trim();
    else erros.push(`check.agile.preparo precisa ser o comando, em texto (recebido ${exibir(v.preparo)})`);
  }
  if (v.test !== undefined && v.test !== null) {
    if (typeof v.test !== 'object' || Array.isArray(v.test)) {
      erros.push(`check.agile.test precisa ser um mapa de lane para comando (recebido ${exibir(v.test)})`);
    } else {
      const lanes: Record<string, string> = {};
      for (const [lane, comando] of Object.entries(v.test)) {
        if (!NOME_DE_LANE.test(lane)) erros.push(`check.agile.test.${lane}: nome de lane aceita [a-z0-9-], ate 32 caracteres`);
        else if (typeof comando !== 'string' || !comando.trim()) erros.push(`check.agile.test.${lane} precisa ser o comando, em texto`);
        else lanes[lane] = comando.trim();
      }
      if (Object.keys(lanes).length) agile.test = lanes;
    }
  }
  if (v.apos_a_varredura !== undefined && v.apos_a_varredura !== null) {
    const validas: string[] = [];
    for (const item of Array.isArray(v.apos_a_varredura) ? v.apos_a_varredura : [v.apos_a_varredura]) {
      if (typeof item === 'string' && agile.test && Object.hasOwn(agile.test, item)) validas.push(item);
      else erros.push(`check.agile.apos_a_varredura: ${exibir(item)} precisa ser uma lane de check.agile.test`);
    }
    if (validas.length) agile.apos_a_varredura = validas;
  }
  for (const chave of ['osv_scanner', 'oxlint'] as const) {
    const valor = v[chave];
    if (valor === undefined || valor === null) continue;
    if (typeof valor === 'boolean') agile[chave] = valor;
    else erros.push(`check.agile.${chave} precisa ser true ou false (recebido ${exibir(valor)})`);
  }
  return agile;
}

/** RM-059 (T10.4): os limites dos tetos de agent teams, os mesmos que o Portao de Tarefas aceita do ambiente. */
export const TETO_MAXIMO_DE_TEAMMATES = 8;
export const TETO_MAXIMO_DE_CUSTO_USD = 500;

/**
 * RM-059 (T10.4, D11 da thread ork-rm059portao): agent teams no despacho do GO, so em piloto. `runtime.agent_teams`
 * liga com `ligado: true` e os dois tetos validos: `teammates` inteiro de 1 a 8 e `custo_usd` maior que 0 e ate 500,
 * escrito como numero decimal simples. Ausente ou `ligado: false` fica desligado sem aviso; ligado com teto invalido,
 * outro tipo ou chave desconhecida avisa e fica desligado, nunca erro: a chave e experimental e nao para a fabrica.
 */
function lerAgentTeams(v: ValorYaml | undefined, avisos: string[]): Manifesto['runtime']['agent_teams'] {
  const mostrar = (x: ValorYaml | undefined): string => (x === undefined ? 'ausente' : JSON.stringify(x).slice(0, 80));
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    avisos.push(`runtime.agent_teams deve ser um mapa com ligado, teammates e custo_usd; fica desligado (${mostrar(v)} nao reconhecido)`);
    return undefined;
  }
  for (const chave of Object.keys(v)) {
    if (!['ligado', 'teammates', 'custo_usd'].includes(chave)) avisos.push(`runtime.agent_teams.${chave} desconhecida; o bloco so tem ligado, teammates e custo_usd`);
  }
  if (v.ligado !== true) {
    if (v.ligado !== undefined && v.ligado !== null && v.ligado !== false) {
      avisos.push(`runtime.agent_teams.ligado deve ser true ou false; fica desligado (${mostrar(v.ligado)} nao reconhecido)`);
    }
    return undefined;
  }
  const teammates = v.teammates;
  const custo = v.custo_usd;
  const tetoOk = typeof teammates === 'number' && Number.isInteger(teammates) && teammates >= 1 && teammates <= TETO_MAXIMO_DE_TEAMMATES;
  const custoOk = typeof custo === 'number' && /^\d+(?:\.\d+)?$/.test(String(custo)) && custo > 0 && custo <= TETO_MAXIMO_DE_CUSTO_USD;
  if (!tetoOk || !custoOk) {
    avisos.push(`runtime.agent_teams ligado sem teto valido (teammates inteiro de 1 a ${TETO_MAXIMO_DE_TEAMMATES} e custo_usd maior que 0 ` +
      `e ate ${TETO_MAXIMO_DE_CUSTO_USD}; recebido teammates ${mostrar(teammates)} e custo_usd ${mostrar(custo)}); fica desligado`);
    return undefined;
  }
  return { teammates: teammates as number, custo_usd: custo as number };
}

/**
 * RM-026 K7 (D1): `conhecimento.dir`, a pasta dos documentos `ork.conhecimento/v1`. Sem o bloco, o projeto nao
 * declarou conhecimento. Bloco que nao e mapa e `dir` vazio avisam e ficam declarados com `dir` vazio, que o
 * leitor (`conhecimento.ts`) recusa com `conhecimento.dir-invalido`: quem declarou nao ouve que nao declarou.
 * Chave desconhecida so avisa. Ler a pasta nao executa nada, e a regra do caminho mora no leitor.
 */
function lerBlocoConhecimento(v: ValorYaml | undefined, avisos: string[]): Manifesto['conhecimento'] {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    avisos.push('conhecimento deve ser um mapa com dir: <pasta dentro da raiz>; o leitor recusa ate corrigir');
    return { dir: '' };
  }
  for (const chave of Object.keys(v)) if (chave !== 'dir') avisos.push(`conhecimento.${chave} desconhecida; o bloco conhecimento so tem dir`);
  const dir = texto(v.dir, '').trim();
  if (!dir) avisos.push('conhecimento.dir deve ser uma pasta dentro da raiz, como docs/conhecimento; o leitor recusa ate corrigir');
  return { dir };
}

/** Nome de host sem esquema, porta, caminho ou credencial; um rotulo so vale (`localhost`). */
const HOST_DA_FORJA = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const CHAVES_DA_FORJA = ['tipo', 'host', 'porta', 'caminho_base', 'ssh_host', 'ssh_porta', 'ca'];

/**
 * O bloco opcional `forja:`. Ausente, nada muda: tudo vem do remoto e da sondagem. Valor fora da forma e erro do
 * manifesto, nunca adivinhado: um host ou uma porta errados mandariam a consulta, e o login da CLI, a outro servidor.
 * Chave desconhecida so avisa. `caminho_base` `/` e o mesmo que nenhum subcaminho.
 */
function lerBlocoForja(v: ValorYaml | undefined, erros: string[], avisos: string[]): Manifesto['forja'] {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    erros.push(`forja deve ser um mapa com ${CHAVES_DA_FORJA.join(', ')} (recebido ${exibir(v)})`);
    return undefined;
  }
  for (const chave of Object.keys(v)) {
    if (!CHAVES_DA_FORJA.includes(chave)) avisos.push(`forja.${chave} desconhecida; o bloco forja tem ${CHAVES_DA_FORJA.join(', ')}`);
  }
  const forja: NonNullable<Manifesto['forja']> = {};
  if (v.tipo !== undefined && v.tipo !== null) {
    if (typeof v.tipo === 'string' && (TIPOS_DE_FORJA as readonly string[]).includes(v.tipo)) forja.tipo = v.tipo as TipoDeForja;
    else erros.push(`forja.tipo aceita ${TIPOS_DE_FORJA.join(' ou ')} (recebido ${exibir(v.tipo)})`);
  }
  for (const chave of ['host', 'ssh_host'] as const) {
    const x = v[chave];
    if (x === undefined || x === null) continue;
    const t = typeof x === 'string' ? x.trim().toLowerCase() : '';
    if (HOST_DA_FORJA.test(t)) forja[chave] = t;
    else erros.push(`forja.${chave} deve ser um nome de host sem esquema, porta ou caminho (recebido ${exibir(x)})`);
  }
  for (const chave of ['porta', 'ssh_porta'] as const) {
    const x = v[chave];
    if (x === undefined || x === null) continue;
    if (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 65535) forja[chave] = x;
    else erros.push(`forja.${chave} deve ser um inteiro de 1 a 65535 (recebido ${exibir(x)})`);
  }
  if (v.caminho_base !== undefined && v.caminho_base !== null) {
    const t = typeof v.caminho_base === 'string' ? v.caminho_base.trim().replace(/\/+$/, '') : null;
    const valido = t !== null && (t === '' || (/^(?:\/[A-Za-z0-9._~-]+)+$/.test(t) && !t.split('/').some((p) => p === '.' || p === '..')));
    if (!valido) erros.push(`forja.caminho_base deve ser um caminho absoluto como /gitlab, sem .. (recebido ${exibir(v.caminho_base)})`);
    else if (t) forja.caminho_base = t;
  }
  if (forja.caminho_base && forja.tipo === 'github') {
    erros.push('forja.caminho_base só vale para forja servida em subcaminho (gitlab); o GitHub não tem');
  }
  if (v.ca !== undefined && v.ca !== null) {
    if (typeof v.ca === 'string' && path.isAbsolute(v.ca) && path.normalize(v.ca) === v.ca) forja.ca = v.ca;
    else erros.push(`forja.ca deve ser o caminho absoluto de um arquivo PEM (recebido ${exibir(v.ca)})`);
  }
  return forja;
}

/** Um produtor: o slug de um app ou de um job, ou `status:<login>`. */
const PRODUTOR = /^(?:status:)?[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/**
 * `ci.produtor`: quem pode publicar o check exigido. Ausente: o padrao da forja. Lista vazia e erro (o gate nunca
 * ficaria verde), e entrada que nao e produtor tambem: nunca se adivinha quem aprova.
 */
function lerProdutores(v: ValorYaml | undefined, erros: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const lista = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null;
  if (!lista || lista.length === 0 || lista.length > 20) {
    erros.push('ci.produtor deve ser uma lista de 1 a 20 produtores (app, job ou status:<login>), como [github-actions]');
    return undefined;
  }
  const saida: string[] = [];
  for (const x of lista) {
    const t = typeof x === 'string' ? x.trim() : '';
    if (!PRODUTOR.test(t)) { erros.push(`ci.produtor: ${exibir(x)} não é um produtor (app, job ou status:<login>)`); continue; }
    if (!saida.includes(t)) saida.push(t);
  }
  return saida.length ? saida : undefined;
}

/**
 * RM-058, integração (T6, D10 da ork-rm058integra): `ci.contexts`, os checks que a proteção da base exige, um por nome, na
 * ordem. Lista vazia, item que não é texto de uma linha e nome repetido são erro do manifesto: a prova do CI nunca fica
 * verde por um contexto que ninguém publica, e nunca se adivinha qual faltou.
 */
function lerContextos(v: ValorYaml | undefined, erros: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) {
    erros.push('ci.contexts deve ser uma lista de 1 a 20 contextos de CI (os checks que a proteção da base exige), como ["ork-verify"]');
    return undefined;
  }
  const saida: string[] = [];
  for (const x of v) {
    const t = typeof x === 'string' ? x.trim() : '';
    if (!t || t.length > 200 || /[\r\n]/.test(t)) { erros.push(`ci.contexts: ${exibir(x)} não é o nome de um contexto de CI (texto de uma linha)`); continue; }
    if (saida.includes(t)) { erros.push(`ci.contexts: "${t}" aparece duas vezes`); continue; }
    saida.push(t);
  }
  return saida.length === v.length ? saida : undefined;
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

const CHAVES_DE_EMBEDDING = ['provider', 'model', 'dim', 'api_key_env', 'fallback_model', 'max_tokens_por_execucao'];

/** Valor que parece segredo (URL, prefixo de chave, sequencia longa) nunca e repetido num erro. */
function exibir(v: ValorYaml): string {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return /:\/\/|\bsk-|[A-Za-z0-9_-]{32,}/.test(t) ? '(valor omitido: parece segredo)' : JSON.stringify(v);
}

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
    erros.push(`memory.embedding.provider invalido: ${exibir(provider)} (aceitos: none, openrouter)`);
  }
  const model = texto(e.model, '').trim();
  const apiKeyEnv = texto(e.api_key_env, '').trim();
  const fallback = texto(e.fallback_model, '').trim();
  const inteiro = (chave: string, v: ValorYaml, padrao: number, min: number, max: number): number => {
    if (v === undefined || v === null) return padrao;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) {
      erros.push(`memory.embedding.${chave} precisa ser inteiro entre ${min} e ${max} (recebido ${exibir(v)})`);
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
    if (!MODELO_DE_EMBEDDING.test(model)) erros.push(`memory.embedding.model invalido: ${exibir(model)} (esperado org/nome, por exemplo qwen/qwen3-embedding-8b)`);
    if (apiKeyEnv === '') erros.push('memory.embedding.api_key_env e obrigatorio com provider openrouter (o NOME da variavel com a chave dedicada)');
  }
  if (fallback !== '' && !MODELO_DE_EMBEDDING.test(fallback)) {
    erros.push(`memory.embedding.fallback_model invalido: ${exibir(fallback)} (esperado org/nome de um modelo do Hugging Face)`);
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
export function carregarManifesto(dirInicial: string = diretorioDoProjeto()): ManifestoCarregado | null {
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
  // Preferência inválida segue o fuso: avisa e cai no padrão, sem parar os comandos (e o próprio
  // onboarding set, que é o caminho para corrigir).
  const preferencias: NonNullable<Manifesto['owner']> = {};
  for (const chave of ['language', 'depth', 'experience'] as const) {
    const valor = mapa(dados.owner)[chave];
    if (valor === undefined) continue;
    try { Object.assign(preferencias, validarPreferencias({ [chave]: valor })); }
    catch (e) { avisos.push(`${(e as Error).message}; vale o padrão até corrigir`); }
  }
  if (fusoDoDono.origem === 'manifesto') preferencias.timezone = fusoDoDono.fuso;
  const board = mapa(dados.board);
  const runtime = mapa(dados.runtime);
  const conduction = mapa(dados.conduction);
  if (conduction.delegation !== undefined && !validarDelegacao(conduction.delegation)) {
    erros.push('conduction.delegation exige thread, escopo premissas, prazo ISO, evidencia e delegado');
  }
  const worktree = mapa(dados.worktree);
  // RM-047 (fronteira de confiança): a base vai ao git em rev-parse, log, fetch e worktree add. Nome que o
  // git não aceita como branch (começa com `-`, tem `..`) viraria opção dele; a regra é a do check-ref-format.
  if (worktree.base_branch !== undefined && worktree.base_branch !== null && !branchValida(texto(worktree.base_branch, ''))) {
    erros.push(`worktree.base_branch invalido: ${JSON.stringify(texto(worktree.base_branch, '')).slice(0, 60)} ` +
      '(esperado nome de branch do git, sem "-" no começo e sem "..")');
  }
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
  // RM-056 (D2): opt-in. Valor desconhecido vale o padrao `ordem`, com aviso.
  const distribuicaoDePerfis = (): 'ordem' | 'carga' => {
    const v = perfisDeRuntime.distribuir;
    if (v === undefined || v === null || v === 'ordem') return 'ordem';
    if (v === 'carga') return 'carga';
    avisos.push(`runtime_profiles.distribuir aceita ordem ou carga; vale o padrao ordem (${JSON.stringify(v)} nao reconhecido)`);
    return 'ordem';
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

  const forja = lerBlocoForja(dados.forja, erros, avisos);
  const produtores = lerProdutores(ci.produtor, erros);
  const contextos = lerContextos(ci.contexts, erros);

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
  if (runtimeConhecido(adapterDeRuntime) && !runtimeDeBloco(adapterDeRuntime)) {
    // RM-067 (D1 da ork-grokbuild): homologado so para despacho explicito, nunca o padrao do projeto.
    erros.push(
      `runtime.adapter so por despacho explicito: "${adapterDeRuntime}" entra por ork phase run --runtime ${adapterDeRuntime} ` +
      `(o padrao aceita: ${ORDEM_DOS_RUNTIMES.join(', ')})`
    );
  } else if (!runtimeDeBloco(adapterDeRuntime)) {
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
  // RM-059 (T10.4): agent teams no despacho do GO, so no piloto e desligado por padrao.
  const agentTeams = lerAgentTeams(runtime.agent_teams, avisos);

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
    // RM-069 (D3): o valor nao entra no erro; uma DSN `chave=valor` colada aqui sairia inteira.
    erros.push('memory.database_url_env invalido (valor omitido): esperado nome de variavel de ambiente, [A-Z][A-Z0-9_]*');
  }
  // RM-069 (G2, G3): a fonte de arquivo so nomeia arquivo da pasta de segredos do `ork`, e nunca junto da variavel.
  const arquivoDaDsn = texto(memory.database_url_file, '').trim();
  if (arquivoDaDsn.includes('://')) {
    erros.push(
      `memory.database_url_file recebe o CAMINHO do arquivo com a DSN (${PREFIXO_DO_ARQUIVO_DA_DSN}<nome>), ` +
        'nunca a string de conexao'
    );
  } else if (arquivoDaDsn !== '' && !arquivoDaDsnValido(arquivoDaDsn)) {
    erros.push(
      `memory.database_url_file invalido (valor omitido): esperado ${PREFIXO_DO_ARQUIVO_DA_DSN}<nome>, arquivo 0600 do ` +
        'dono na pasta de segredos do ork (o manifesto nao escolhe outro caminho)'
    );
  }
  if (variavelDaDsn !== '' && arquivoDaDsn !== '') {
    erros.push(
      'memory.database_url_env e memory.database_url_file sao exclusivos: declare uma fonte so ' +
        '(o ork nunca cai de uma para a outra)'
    );
  }
  // RM-047 (fronteira de confiança): `memory.cli` escolhe o executável que o `ork doctor`, a memória e o
  // `ork brain` rodam. Caminho relativo apontaria para um arquivo do próprio clone; só nome procurado no
  // PATH (o `orkmind` instalado) ou caminho absoluto escolhido por quem instalou.
  const cliDaMemoria = texto(memory.cli, 'orkmind');
  if (!cliDaMemoriaValido(cliDaMemoria)) {
    erros.push(`memory.cli invalido: ${JSON.stringify(cliDaMemoria).slice(0, 60)} ` +
      '(esperado nome de executável no PATH, como orkmind, ou caminho absoluto; caminho relativo não é aceito)');
  }
  if (modoDeMemoria === 'orkmind' && variavelDaDsn === '' && arquivoDaDsn === '') {
    avisos.push(
      'memory.mode: orkmind sem memory.database_url_file nem memory.database_url_env: o regime efetivo cai para files ' +
        '(o `ork` nao adivinha DSN, e base alheia e pior do que base nenhuma)'
    );
  }
  const embedding = lerEmbedding(memory.embedding, variavelDaDsn, erros);
  const prazoDoUniverso = memory.universo_timeout_ms === undefined ? TIMEOUT_DO_UNIVERSO_MS : memory.universo_timeout_ms;
  if (typeof prazoDoUniverso !== 'number' || !Number.isSafeInteger(prazoDoUniverso) || prazoDoUniverso <= 0 ||
      prazoDoUniverso > LIMITE_TIMEOUT_DO_UNIVERSO_MS) {
    erros.push('memory.universo_timeout_ms: esperado inteiro em ms entre 1 e 86400000 (24 h; valor omitido)');
  }

  const bytes = Buffer.byteLength(bruto, 'utf8');
  if (bytes > LIMITE_MANIFESTO_BYTES) {
    erros.push(
      `manifesto com ${bytes} bytes, acima do limite duro de ${LIMITE_MANIFESTO_BYTES} (prosa vai para memoria com tag, nao para o YAML)`
    );
  }
  if (achado.legado) {
    avisos.push(`lendo ${NOME_MANIFESTO_LEGADO} como fallback; migre para ${NOME_MANIFESTO}`);
  }
  const conhecimento = lerBlocoConhecimento(dados.conhecimento, avisos);
  const check = lerCheck(dados.check, erros, avisos);

  const manifesto: Manifesto = {
    project: {
      name: nomeProjeto,
      abbrev,
      stage: (texto(project.stage, 'nascente') as Manifesto['project']['stage']) ?? 'nascente',
      repo_root: texto(project.repo_root, raiz),
    },
    ...(Object.keys(preferencias).length ? { owner: preferencias } : {}),
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
      ...(agentTeams ? { agent_teams: agentTeams } : {}),
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
      // P4 do ensaio da 0.5.0: o `ork thread new` cria a worktree sem flag quando a chave diz true. Ausente le
      // false, para o projeto que nunca a declarou seguir como era.
      por_thread: booleano(worktree.por_thread, false),
      ...dependenciasDaWorktree(worktree.dependencias, erros),
    },
    verify: {
      build: verify.build === null || verify.build === undefined ? undefined : texto(verify.build, ''),
      test: verify.test === null || verify.test === undefined ? undefined : texto(verify.test, ''),
      ...prazosDoVerify(verify, erros),
      typecheck:
        verify.typecheck === null || verify.typecheck === undefined
          ? undefined
          : texto(verify.typecheck, ''),
      security_scan:
        verify.security_scan === null || verify.security_scan === undefined
          ? undefined
          : texto(verify.security_scan, ''),
      // I-54 (RM-037, D10): o preparo unico da rodada de verify, quando declarado.
      ...(typeof verify.preparo === 'string' && verify.preparo.trim() ? { preparo: verify.preparo.trim() } : {}),
    },
    ...(check ? { check } : {}),
    ci: {
      required_for_ship: booleano(ci.required_for_ship, false),
      context: texto(ci.context, 'ork-verify'),
      ...(contextos ? { contexts: contextos } : {}),
      command: ci.command === null || ci.command === undefined ? undefined : texto(ci.command, ''),
      external_repositories: repositoriosExternos(ci.external_repositories, erros),
      ...(produtores ? { produtor: produtores } : {}),
    },
    concurrency: {
      max_parallel_threads: numero(concurrency.max_parallel_threads, 3),
      stale_after_min: Math.max(1, Math.trunc(numero(concurrency.stale_after_min, 240))),
      // RM-058 N2 (D9): uma operacao pesada por vez nesta raiz, por padrao; 0 desliga a fila.
      max_parallel_heavy: vagasPesadas(numero(concurrency.max_parallel_heavy, 1)),
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
      distribuir: distribuicaoDePerfis(),
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
      ...(arquivoDaDsn ? { database_url_file: arquivoDaDsn } : {}),
      cli: texto(memory.cli, 'orkmind'),
      tenant: texto(memory.tenant, '') || nomeProjeto,
      timeout_ms: numero(memory.timeout_ms, 15000),
      universo_timeout_ms: typeof prazoDoUniverso === 'number' ? prazoDoUniverso : TIMEOUT_DO_UNIVERSO_MS,
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
    // RM-031 KG5 (D2): expor as tools do grafo no MCP e opt-in do dono.
    grafo: lerGrafo(dados.grafo, avisos),
    ...(conhecimento ? { conhecimento } : {}),
    ...(forja ? { forja } : {}),
    policies: Object.fromEntries(
      Object.entries(mapa(dados.policies)).map(([k, v]) => [k, texto(v, '')])
    ),
  };

  return { caminho: achado.caminho, raiz, legado: achado.legado, bytes, manifesto, erros, avisos };
}

/**
 * RM-047: `memory.cli` aceito. Nome simples (procurado no PATH, sem barra e sem `-` no começo) ou caminho
 * absoluto normalizado. Caminho relativo (`./bin/x`, `bin/x`) resolveria dentro do repositório clonado.
 */
export function cliDaMemoriaValido(cli: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (cli === '' || /[\x00-\x1f\x7f]/.test(cli)) return false;
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(cli)) return true;
  return path.isAbsolute(cli) && path.normalize(cli) === cli;
}

/** Os comandos de verify e o comando do CI de um manifesto. */
export interface ComandosDoManifesto {
  typecheck: string | undefined;
  build: string | undefined;
  test: string | undefined;
  securityScan: string | undefined;
  ciCommand: string | undefined;
}

/**
 * RM-059 (A15 da revisao da ork-rm059pista): os comandos de verify e o do CI de um `orkastery.yaml` lido como texto (o
 * do HEAD de uma branch, pelo `git show`), com as mesmas regras do `carregarManifesto`. `null` quando o texto nao abre.
 */
export function comandosDoTextoDoManifesto(bruto: string): ComandosDoManifesto | null {
  let dados: Record<string, ValorYaml>;
  try {
    dados = mapa(lerYaml(bruto));
  } catch {
    return null;
  }
  const verify = mapa(dados.verify), ci = mapa(dados.ci);
  const opcional = (v: ValorYaml | undefined): string | undefined => (v === null || v === undefined ? undefined : texto(v, ''));
  return { typecheck: opcional(verify.typecheck), build: opcional(verify.build), test: opcional(verify.test), securityScan: opcional(verify.security_scan), ciCommand: opcional(ci.command) };
}

/** Carrega o manifesto ou encerra com mensagem acionavel (uso nos subcomandos). */
export function exigirManifesto(dirInicial: string = diretorioDoProjeto()): ManifestoCarregado {
  const carregado = carregarManifesto(dirInicial);
  if (!carregado) {
    throw new ErroDoCatalogo((m) => m.cli.manifestoNaoEncontrado(NOME_MANIFESTO, dirInicial));
  }
  if (carregado.erros.length > 0) {
    throw new Error(
      `manifesto invalido (${carregado.caminho}):\n  - ${carregado.erros.join('\n  - ')}`
    );
  }
  return carregado;
}
