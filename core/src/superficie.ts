/**
 * Varredura DETERMINISTICA da superficie de ataque de rede (extensao do pack
 * `security-privacy`, bloco B5).
 *
 * O pack cobria seguranca de codigo (segredo, entrada sem validacao, CVE) e LGPD. O que
 * ele NAO cobria era a superficie que o produto publica na rede: as rotas e os endpoints
 * expostos. Estas regras fecham essa lacuna, no MESMO contrato de achado do B5 (evidencia
 * arquivo:linha, impacto, fix sugerido, passo irreversivel, estimativa e claim de
 * reexecucao), gravadas no MESMO board de divida.
 *
 * Tres decisoes estruturais moram aqui:
 *
 *   1. A deteccao e deterministica e roda sem LLM: ela localiza as definicoes de rota por
 *      framework (express, fastify, hono, koa, NestJS, Next.js, FastAPI, Flask, Django,
 *      gin, echo) e confere a presenca de guarda de autenticacao, limite de taxa, esquema
 *      de validacao e restricao de rede NO BLOCO da rota e no arquivo.
 *   2. O comando de reexecucao de cada achado sai da MESMA lista de marcadores que a
 *      deteccao usou (`grep -qEi` sobre a mesma alternancia). Detector e claim nunca
 *      divergem, porque nao existem duas listas.
 *   3. Onde a leitura nao da confianca (middleware que o `ork` nao reconhece, framework
 *      nao identificado, marcador presente no arquivo mas fora do bloco da rota), o achado
 *      sai com confianca `baixa`, severidade `menor` e o titulo diz REQUER CONFIRMACAO
 *      HUMANA. Falso positivo disfarcado de certeza e o defeito que este modulo evita.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EscopoDaRodada, SeveridadeDeAchado } from './types';
import { exec, tabela } from './util';

// ---------------------------------------------------------------------------
// Regras novas do pack (SP8..SP12)
// ---------------------------------------------------------------------------

/** As regras de superficie de ataque que esta varredura produz. */
export type RegraDeSuperficie = 'SP8' | 'SP9' | 'SP10' | 'SP11' | 'SP12';

/** Ordem canonica das regras novas, usada no catalogo e nas saidas. */
export const REGRAS_DE_SUPERFICIE: readonly RegraDeSuperficie[] = ['SP8', 'SP9', 'SP10', 'SP11', 'SP12'];

/**
 * Confianca da leitura.
 *
 * `alta`  o framework foi reconhecido e o marcador nao existe em lugar nenhum do arquivo;
 * `media` o framework foi inferido pela forma da chamada, ou o marcador existe no arquivo
 *         mas fora do bloco da rota (pode estar cobrindo a rota por outro caminho);
 * `baixa` ha middleware que o `ork` nao sabe classificar. O achado vale como aviso e pede
 *         confirmacao humana: nunca sai como certeza.
 */
export type ConfiancaDaVarredura = 'alta' | 'media' | 'baixa';

/** O que cada nivel de confianca significa, dito por extenso em toda saida. */
export const DESCRICAO_DA_CONFIANCA: Readonly<Record<ConfiancaDaVarredura, string>> = {
  alta: 'framework reconhecido e nenhum marcador do controle no arquivo inteiro',
  media: 'framework inferido pela forma da chamada, ou marcador presente no arquivo e ausente no bloco da rota',
  baixa: 'ha middleware que o ork nao classifica: REQUER CONFIRMACAO HUMANA antes de virar trabalho',
};

// ---------------------------------------------------------------------------
// Marcadores: fonte UNICA do detector e do comando de reexecucao
// ---------------------------------------------------------------------------

/**
 * Cada lista abaixo e um fragmento de ERE (o dialeto do `grep -E`), escrito para servir aos
 * DOIS lados: o detector monta `new RegExp(lista.join('|'), 'i')` e a claim do achado monta
 * `grep -qEi '<a mesma alternancia>'`. Nenhuma lista pode conter aspas simples, porque a
 * alternancia viaja dentro de aspas simples no comando de shell.
 */
export const MARCADORES_DE_AUTH: readonly string[] = [
  'auth',
  'guard',
  'jwt',
  'token',
  'session',
  'sessao',
  'permiss',
  'login',
  'current[_-]?user',
  'usuario[_-]?atual',
  'rbac',
  'acl',
  'api[_-]?key',
  'bearer',
  'passport',
  'clerk',
  'principal',
  'protect',
  'require[_-]?user',
  'is[_-]?admin',
  'ensure[_-]?logged',
];

/** Middleware de limite de taxa, cota ou rpm. */
export const MARCADORES_DE_RATE_LIMIT: readonly string[] = [
  'rate[_-]?limit',
  'ratelimit',
  'limiter',
  'throttl',
  'slowapi',
  'slow[_-]?down',
  'token[_-]?bucket',
  'leaky[_-]?bucket',
  'quota',
  'rpm',
  'requests[_-]?per',
  'brute[_-]?force',
  'cooldown',
  'tollbooth',
];

/** Esquema/validacao de payload declarado na borda. */
export const MARCADORES_DE_VALIDACAO: readonly string[] = [
  'schema',
  'zod',
  'joi',
  'yup',
  'valibot',
  'ajv',
  'celebrate',
  'validat',
  'validac',
  'pydantic',
  'base[_-]?model',
  'serializer',
  'dto',
  'safe[_-]?parse',
  'should[_-]?bind',
  'binding:',
  'marshmallow',
  'superstruct',
  'typebox',
  // Parametro anotado com um tipo de entrada declarado (`pedido: PedidoIn`, `body: UserDto`):
  // e assim que FastAPI, NestJS e afins declaram o esquema da borda. O sufixo e o que separa
  // o modelo de entrada do objeto cru da requisicao (`request: Request` NAO casa aqui).
  ':[ ]*[a-z0-9_]*(in|out|schema|model|payload|body|dto|input|create|update|form)[ ]*[,)=]',
];

/**
 * Middleware conhecido que NAO e guarda: o `ork` sabe o que ele faz, e por isso ele nao
 * derruba a confianca do achado. Sem esta lista, um `app.use(cors(...))` deixaria toda
 * rota do arquivo com confianca `baixa`, e a varredura inteira viraria "talvez".
 */
export const MARCADORES_NEUTROS: readonly string[] = [
  'cors',
  'helmet',
  'morgan',
  'logger',
  'logging',
  'compress',
  'body[_-]?parser',
  'urlencoded',
  'cookie[_-]?parser',
  'express\\.(json|static|urlencoded|raw|text)',
  'static',
  'favicon',
  'timeout',
  'request[_-]?id',
  'trace',
  'otel',
  'sentry',
  'etag',
  'gzip',
  'multer',
  'upload',
];

/** Restricao de REDE (o outro jeito legitimo de proteger endpoint de operacao). */
export const MARCADORES_DE_RESTRICAO_DE_REDE: readonly string[] = [
  'allow[_-]?list',
  'white[_-]?list',
  'ip[_-]?filter',
  'ip[_-]?allow',
  '127\\.0\\.0\\.1',
  'localhost',
  'private[_-]?network',
  'vpn',
  'basic[_-]?auth',
  'mtls',
  'mutual[_-]?tls',
  'firewall',
  'cidr',
  'trusted[_-]?prox',
];

/** Caminho de endpoint privado de administracao/operacao. */
export const CAMINHOS_ADMINISTRATIVOS: readonly string[] = [
  'admin',
  'console',
  'debug',
  'swagger',
  'openapi',
  'api[_-]?docs',
  'apidocs',
  'redoc',
  'graphiql',
  'playground',
  'metrics',
  'actuator',
  'pprof',
  'profiler',
  'internal',
  'cluster',
  'nodes',
  'dump',
  'phpmyadmin',
  'adminer',
  'kibana',
  'prometheus',
  'flower',
];

/** Caminho de saude/estado, que so vira achado quando o corpo devolve DETALHE de infra. */
export const CAMINHOS_DE_SAUDE: readonly string[] = ['health', 'healthz', 'readyz', 'livez', 'status', 'ping'];

/** O que torna um health check um vazamento de metadados de infraestrutura. */
export const MARCADORES_DE_SAUDE_DETALHADA: readonly string[] = [
  'version',
  'versao',
  'env',
  'hostname',
  'database',
  'uptime',
  'memory',
  'memoria',
  'dependenc',
  'commit',
  'build',
  'migration',
  'disk',
];

/** Caminhos historicamente sujeitos a brute-force, enumeracao e DDoS de aplicacao. */
export const CAMINHOS_SENSIVEIS_A_FORCA_BRUTA: readonly string[] = [
  'login',
  'signin',
  'sign[_-]in',
  'log[_-]in',
  'auth',
  'token',
  'session',
  'password',
  'senha',
  'reset',
  'forgot',
  'esqueci',
  'otp',
  'mfa',
  '2fa',
  'verify',
  'confirm',
  'register',
  'signup',
  'sign[_-]up',
  'cadastro',
  'invite',
  'convite',
  'contact',
  'contato',
  'subscribe',
  'newsletter',
  'search',
  'busca',
  'export',
  'upload',
  'download',
  'checkout',
  'payment',
  'pagamento',
  'pix',
  'coupon',
  'cupom',
];

/**
 * Caminhos publicos POR NATUREZA: rota sem auth aqui e projeto, nao defeito.
 *
 * Sem esta lista, o SP8 acusaria a tela de login de nao exigir login, que e o falso
 * positivo mais obvio possivel numa varredura de superficie. Elas continuam sujeitas ao
 * SP10 (justamente as que mais precisam de limite de taxa) e ao SP12.
 */
export const CAMINHOS_PUBLICOS_POR_NATUREZA: readonly string[] = [
  'login',
  'signin',
  'sign[_-]in',
  'log[_-]in',
  'logout',
  'signup',
  'sign[_-]up',
  'register',
  'cadastro',
  'oauth',
  'callback',
  'webhook',
  'health',
  'healthz',
  'readyz',
  'livez',
  'ping',
  'public',
  'static',
  'assets',
  'favicon',
  'robots',
  'sitemap',
  'forgot',
  'reset',
  'verify',
  'confirm',
  'contact',
  'contato',
  'newsletter',
  'subscribe',
  'landing',
  'home',
  'index',
];

/** Caminho que sinaliza dado sensivel trafegando na rota (usado pelo SP11). */
export const CAMINHOS_DE_DADO_SENSIVEL: readonly string[] = [
  'user',
  'usuario',
  'account',
  'conta',
  'profile',
  'perfil',
  'customer',
  'cliente',
  'payment',
  'pagamento',
  'card',
  'cartao',
  'cpf',
  'cnpj',
  'email',
  'phone',
  'telefone',
  'address',
  'endereco',
  'order',
  'pedido',
  'admin',
  'token',
  'session',
  'auth',
  'password',
  'senha',
  'billing',
  'invoice',
  'fatura',
  'document',
  'medical',
  'saude',
  'patient',
  'paciente',
];

/**
 * Ancora de CONFIGURACAO de CORS em qualquer uma das stacks reconhecidas.
 *
 * As ancoras sao sintaticas (`cors(`, `allow_origins=`, o nome do header) e nao a palavra
 * solta: `cors` mencionado numa lista de constantes nao e configuracao de CORS, e foi
 * exatamente assim que a primeira versao desta varredura acusou o proprio `superficie.ts`.
 * `[ ]*` no lugar de `\s*` de proposito: a alternancia precisa valer ao mesmo tempo como
 * RegExp do JavaScript (o detector) e como ERE do `grep -E` POSIX (a claim). `\s` nao existe
 * no ERE portatil, e `[[:space:]]` nao existe no JavaScript: so a classe literal serve aos dois.
 */
export const ANCORAS_DE_CORS: readonly string[] = [
  'cors[ ]*\\(',
  'corsmiddleware',
  'cors_allow_all_origins',
  'allow_origins[ ]*=',
  'allowedorigins[ ]*[:=]',
  'allowallorigins[ ]*[:=]',
  'access-control-allow-origin',
];

/**
 * A linha e so um item de lista de texto (`'access-control-allow-origin',`)?
 *
 * Tabela de constantes nao e configuracao: esta guarda e o que mantem a varredura fora do
 * proprio catalogo de marcadores dela.
 */
export function ehLinhaDeDados(linha: string): boolean {
  return /^\s*['"`][^'"`]*['"`]\s*,?\s*$/.test(linha);
}

/** Origem global: o `*` do CORS em cada dialeto. */
export const MARCADORES_DE_ORIGEM_GLOBAL: readonly string[] = [
  'origin[^,;)]{0,20}\\*',
  'origin:[ ]*true',
  'allow_origins[^]]{0,20}\\*',
  'allowallorigins[^,;}]{0,20}true',
  'cors_allow_all_origins[^,;}]{0,20}true',
  'access-control-allow-origin[^,;)]{0,20}\\*',
];

/** Credenciais junto com a origem global: a combinacao que o navegador so aceita por engano. */
export const MARCADORES_DE_CREDENCIAIS_NO_CORS: readonly string[] = [
  'credentials[^,;)]{0,20}true',
  'allow_credentials[^,;)]{0,20}true',
  'allowcredentials[^,;}]{0,20}true',
  'access-control-allow-credentials',
  'withcredentials[^,;)]{0,20}true',
];

/** Acesso a entrada da requisicao no corpo da rota (usado pelo SP12). */
export const MARCADORES_DE_ENTRADA: readonly string[] = [
  'req\\.(body|query|params)',
  'request\\.(body|query|args|json|form)',
  'c\\.req\\.',
  'ctx\\.(query|request|params)',
  '\\.getquery',
  '\\.param\\(',
  '\\.query\\(',
  'shouldbind',
  'body\\(',
  'formdata',
];

/** Monta o regex do detector a partir da MESMA lista que vai para o `grep -E` da claim. */
export function padraoDe(fontes: readonly string[]): RegExp {
  return new RegExp(fontes.join('|'), 'i');
}

/** A alternancia como o `grep -E` a recebe (fonte unica com o detector). */
export function alternanciaDe(fontes: readonly string[]): string {
  return fontes.join('|');
}

// ---------------------------------------------------------------------------
// Frameworks reconhecidos
// ---------------------------------------------------------------------------

export type LinguagemDeRota = 'js' | 'py' | 'go';

export interface DefinicaoDeFramework {
  id: string;
  nome: string;
  linguagem: LinguagemDeRota;
  /** Assinaturas de import/uso que identificam o framework dentro do arquivo. */
  assinaturas: readonly string[];
}

/** Os frameworks cujas definicoes de rota esta varredura sabe ler. */
export const FRAMEWORKS: readonly DefinicaoDeFramework[] = [
  { id: 'express', nome: 'Express', linguagem: 'js', assinaturas: ['from [\'"]express', 'require\\([\'"]express'] },
  { id: 'fastify', nome: 'Fastify', linguagem: 'js', assinaturas: ['from [\'"]fastify', 'require\\([\'"]fastify'] },
  { id: 'hono', nome: 'Hono', linguagem: 'js', assinaturas: ['from [\'"]hono', 'require\\([\'"]hono'] },
  { id: 'koa', nome: 'Koa', linguagem: 'js', assinaturas: ['from [\'"]koa', 'require\\([\'"]koa'] },
  { id: 'nestjs', nome: 'NestJS', linguagem: 'js', assinaturas: ['@nestjs/common', '@nestjs/core'] },
  { id: 'next', nome: 'Next.js (route handler)', linguagem: 'js', assinaturas: ['next/server', 'next/navigation'] },
  { id: 'fastapi', nome: 'FastAPI', linguagem: 'py', assinaturas: ['from fastapi', 'import fastapi'] },
  { id: 'flask', nome: 'Flask', linguagem: 'py', assinaturas: ['from flask', 'import flask'] },
  { id: 'django', nome: 'Django', linguagem: 'py', assinaturas: ['from django', 'django\\.urls'] },
  { id: 'gin', nome: 'gin', linguagem: 'go', assinaturas: ['gin-gonic/gin'] },
  { id: 'echo', nome: 'echo', linguagem: 'go', assinaturas: ['labstack/echo'] },
];

/** Extensoes que a varredura le. */
export const EXTENSOES_DE_ROTA: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go'];

/** Diretorios e arquivos que nao sao superficie do produto. */
export const EXCLUSOES_DA_VARREDURA: readonly RegExp[] = [
  /(^|\/)(node_modules|dist|dist-test|build|out|vendor|coverage|\.next|\.venv|venv|__pycache__|\.git)\//,
  /(^|\/)\.orkastery\//,
  /(\.|_)(test|spec)\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /_test\.go$/,
  /(^|\/)test_[^/]*\.py$/,
];

/** Teto de arquivos lidos numa varredura (governanca de custo, igual ao escopo da rodada). */
export const LIMITE_DE_ARQUIVOS = 2000;

/** Teto de bytes por arquivo lido. */
export const LIMITE_DE_BYTES_POR_ARQUIVO = 400 * 1024;

/** Quantos achados uma regra pode produzir numa varredura antes de truncar (dito em voz alta). */
export const LIMITE_PADRAO_POR_REGRA = 10;

/** Linhas antes e depois da definicao que compoem o BLOCO da rota. */
export const LINHAS_ANTES_DO_BLOCO = 3;
export const LINHAS_DEPOIS_DO_BLOCO = 12;

// ---------------------------------------------------------------------------
// Leitura dos arquivos candidatos
// ---------------------------------------------------------------------------

/**
 * Caminhos do repositorio, ou a arvore lida na mao quando nao ha git.
 *
 * `--others --exclude-standard` entra de proposito: codigo ainda nao commitado tambem esta
 * publicado na superficie de quem roda o servidor, e uma varredura que so olhasse o que ja
 * esta no indice diria "superficie limpa" sobre a rota que acabou de ser escrita.
 */
export function arquivosVersionados(raiz: string): string[] {
  const r = exec('git', ['ls-files', '--cached', '--others', '--exclude-standard'], raiz);
  if (r.ok && r.stdout.trim() !== '') {
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
  }
  const saida: string[] = [];
  const andar = (dir: string): void => {
    if (saida.length >= LIMITE_DE_ARQUIVOS) return;
    let entradas: fs.Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const completo = path.join(dir, e.name);
      const relativo = path.relative(raiz, completo).split(path.sep).join('/');
      if (EXCLUSOES_DA_VARREDURA.some((x) => x.test(relativo + (e.isDirectory() ? '/' : '')))) continue;
      if (e.isDirectory()) andar(completo);
      else saida.push(relativo);
    }
  };
  andar(raiz);
  return saida.sort();
}

export interface OpcoesDaVarredura {
  /** Escopo incremental da rodada: quando ele traz arquivos, a varredura le so eles. */
  escopo?: EscopoDaRodada;
  /** Subdiretorio alvo (`ork audit surface <dir>`). */
  dir?: string;
  /** So esta regra. */
  regra?: RegraDeSuperficie;
  /** Teto de achados por regra. */
  limitePorRegra?: number;
}

/** Os arquivos que a varredura vai ler, ja filtrados por extensao e por exclusao. */
export function arquivosDaVarredura(raiz: string, opcoes: OpcoesDaVarredura = {}): string[] {
  const escopo = opcoes.escopo;
  const brutos =
    escopo && escopo.incremental && escopo.arquivos.length > 0 ? escopo.arquivos : arquivosVersionados(raiz);
  const prefixo = opcoes.dir ? opcoes.dir.replace(/^\.\/+/, '').replace(/\/+$/, '') + '/' : '';
  return brutos
    .map((a) => a.split(path.sep).join('/'))
    .filter((a) => EXTENSOES_DE_ROTA.includes(path.extname(a)))
    .filter((a) => !EXCLUSOES_DA_VARREDURA.some((x) => x.test(a)))
    .filter((a) => (prefixo === '' ? true : a.startsWith(prefixo)))
    .filter((a) => {
      const completo = path.join(raiz, a);
      try {
        const st = fs.statSync(completo);
        return st.isFile() && st.size <= LIMITE_DE_BYTES_POR_ARQUIVO;
      } catch {
        return false;
      }
    })
    .slice(0, LIMITE_DE_ARQUIVOS);
}

/** Linguagem do arquivo pela extensao. */
export function linguagemDoArquivo(arquivo: string): LinguagemDeRota | null {
  const ext = path.extname(arquivo);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'js';
  if (ext === '.py') return 'py';
  if (ext === '.go') return 'go';
  return null;
}

/** O framework declarado pelo proprio arquivo, ou null quando nada o identifica. */
export function frameworkDoArquivo(arquivo: string, conteudo: string): DefinicaoDeFramework | null {
  const lingua = linguagemDoArquivo(arquivo);
  for (const f of FRAMEWORKS) {
    if (lingua !== null && f.linguagem !== lingua) continue;
    if (f.assinaturas.some((a) => new RegExp(a, 'i').test(conteudo))) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extracao das definicoes de rota
// ---------------------------------------------------------------------------

/** Uma definicao de rota encontrada no codigo. */
export interface RotaDetectada {
  arquivo: string;
  /** Linha 1-based da definicao. */
  linha: number;
  /** `GET`, `POST`, ..., `USE` (montagem de subarvore) ou `ROTA` (urlconf do Django). */
  metodo: string;
  caminho: string;
  /** Id do framework reconhecido, ou `generico` quando so a forma da chamada identificou. */
  framework: string;
  linguagem: LinguagemDeRota;
  texto: string;
  /** Primeira e ultima linha do bloco lido em volta da definicao (1-based, inclusivo). */
  inicioDoBloco: number;
  fimDoBloco: number;
  bloco: string;
  /** Middlewares declarados entre o caminho e o handler. */
  middlewares: string[];
  /** Middlewares que o `ork` NAO sabe classificar: e o que derruba a confianca. */
  desconhecidos: string[];
  /** `app.use('/admin', adminRouter)`: monta uma subarvore inteira, nao uma rota so. */
  montagem: boolean;
}

/** Nomes de receptor que denunciam um roteador, quando o framework nao se identificou. */
const RECEPTORES_DE_ROTA =
  /^(app|router|server|api|apirouter|fastify|hono|koa|instance|routes|r|e|mux|srv|http|admin|v\d+|[a-z_$][\w$]*(router|app|server|api))$/i;

const METODOS_JS = 'get|post|put|patch|delete|del|options|head|all|use';
const METODOS_PY = 'get|post|put|patch|delete|options|head|route';
const METODOS_GO = 'GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Group';

/**
 * O caminho da rota pode ser removido do texto antes da procura por marcadores?
 *
 * Sem esta remocao, `/internal/metrics` casaria com o marcador de restricao de rede e
 * `/auth/token` casaria com o marcador de autenticacao: a rota se protegeria sozinha pelo
 * proprio nome, e as rotas mais sensiveis seriam justamente as invisiveis. Caminho com
 * aspas simples, `@` ou `|` fica de fora porque ele nao viaja em seguranca dentro do
 * comando de shell que a claim reexecuta.
 */
export function podeRemoverCaminho(caminho: string): boolean {
  return caminho.length >= 3 && !/['@|]/.test(caminho);
}

/** O caminho escapado para o `sed` (BRE), com `@` de delimitador. */
export function caminhoParaSed(caminho: string): string {
  return caminho.replace(/[\\.[\]^$*]/g, (c) => '\\' + c);
}

/**
 * O texto sem comentario de linha.
 *
 * MEDIDO nesta extensao: um comentario em portugues com a palavra "guarda" casa com o
 * marcador `guard`, e "sem oAuth" casa com `auth`. Sem este recorte, a rota mais mal
 * protegida do arquivo (a que tem um TODO em cima dizendo que falta auth) seria justamente
 * a que a varredura daria por protegida. O comando da claim faz o MESMO recorte com `sed`.
 */
export function semComentarios(texto: string): string {
  return texto
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/#.*$/, ''))
    .join('\n');
}

/** O texto sem o caminho da rota (o MESMO recorte que o comando da claim faz com `sed`). */
export function semOCaminho(texto: string, caminho: string): string {
  return podeRemoverCaminho(caminho) ? texto.split(caminho).join(' ') : texto;
}

/** Escapa o texto para caber dentro de um ERE do `grep -E`. */
export function escaparParaEre(texto: string): string {
  return texto.replace(/[\\.[\]{}()*+?^$|\/]/g, (c) => '\\' + c);
}

/**
 * Os argumentos entre o caminho e o handler.
 *
 * O ultimo token identificador e o handler e sai da conta; o que sobra sao middlewares
 * declarados na propria rota. Middleware que nao casa com nenhuma lista de marcadores vira
 * `desconhecido`, e um desconhecido derruba a confianca do achado para `baixa`: pode ser
 * exatamente a guarda que o `ork` nao conhece.
 */
export function analisarArgumentos(resto: string): { middlewares: string[]; desconhecidos: string[] } {
  const corpo = resto.replace(/\)\s*;?\s*$/, '');
  const tokens: string[] = [];
  let atual = '';
  let profundidade = 0;
  for (const c of corpo) {
    if (c === '(' || c === '[' || c === '{') profundidade++;
    if (c === ')' || c === ']' || c === '}') profundidade--;
    if (c === ',' && profundidade <= 0) {
      tokens.push(atual.trim());
      atual = '';
      continue;
    }
    atual += c;
  }
  tokens.push(atual.trim());
  const identificadores = tokens
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .filter((t) => /^[A-Za-z_$][\w$.]*(\(.*\))?$/.test(t));
  // O ULTIMO ARGUMENTO da chamada, quando e um identificador simples, e o handler da rota e
  // nao um middleware. Quando o ultimo argumento e uma funcao inline, todo identificador que
  // veio antes dela e middleware, e nenhum deles pode ser descartado como handler.
  const ultimo = tokens[tokens.length - 1]?.trim() ?? '';
  const ultimoEhHandlerNomeado =
    identificadores.length > 0 &&
    identificadores[identificadores.length - 1] === ultimo &&
    /^[A-Za-z_$][\w$.]*$/.test(ultimo);
  const semHandler = ultimoEhHandlerNomeado ? identificadores.slice(0, -1) : identificadores;
  const conhecidos = padraoDe([
    ...MARCADORES_DE_AUTH,
    ...MARCADORES_DE_RATE_LIMIT,
    ...MARCADORES_DE_VALIDACAO,
    ...MARCADORES_DE_RESTRICAO_DE_REDE,
    ...MARCADORES_NEUTROS,
  ]);
  return {
    middlewares: semHandler,
    desconhecidos: semHandler.filter((m) => !conhecidos.test(m)),
  };
}

/** O caminho de rota que um arquivo do Next.js (app router ou pages/api) publica. */
export function caminhoDoNext(arquivo: string): string | null {
  const normalizado = arquivo.split(path.sep).join('/');
  const app = /(^|\/)(?:src\/)?app\/(.*)\/route\.[jt]sx?$/.exec(normalizado);
  if (app) {
    const segmentos = app[2]
      .split('/')
      .filter((s) => s !== '' && !/^\(.*\)$/.test(s))
      .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1'));
    return '/' + segmentos.join('/');
  }
  const pages = /(^|\/)(?:src\/)?pages\/api\/(.*)\.[jt]sx?$/.exec(normalizado);
  if (pages) {
    const semIndice = pages[2].replace(/\/?index$/, '');
    const segmentos = semIndice
      .split('/')
      .filter((s) => s !== '')
      .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1'));
    return '/api/' + segmentos.join('/');
  }
  return null;
}

/** Bloco lido em volta de uma linha, com as fronteiras que a claim vai reexecutar. */
function blocoEmVolta(linhas: string[], linha: number): { inicio: number; fim: number; texto: string } {
  const inicio = Math.max(1, linha - LINHAS_ANTES_DO_BLOCO);
  const fim = Math.min(linhas.length, linha + LINHAS_DEPOIS_DO_BLOCO);
  return { inicio, fim, texto: linhas.slice(inicio - 1, fim).join('\n') };
}

/**
 * As definicoes de rota de um arquivo.
 *
 * A deteccao e por FORMA da definicao, framework a framework, e nunca por "parece uma
 * rota": quando o arquivo nao declara framework nenhum, so passa a chamada cujo receptor
 * tem cara de roteador E cujo primeiro argumento e um caminho comecando em `/`. E o que
 * mantem `axios.get(url)` fora da lista.
 */
export function rotasDoArquivo(arquivo: string, conteudo: string): RotaDetectada[] {
  const lingua = linguagemDoArquivo(arquivo);
  if (lingua === null) return [];
  const framework = frameworkDoArquivo(arquivo, conteudo);
  const linhas = conteudo.split('\n');
  const rotas: RotaDetectada[] = [];

  const registrar = (
    linha: number,
    metodo: string,
    caminho: string,
    resto: string,
    montagem = false
  ): void => {
    const bloco = blocoEmVolta(linhas, linha);
    const { middlewares, desconhecidos } = analisarArgumentos(resto);
    rotas.push({
      arquivo,
      linha,
      metodo: metodo.toUpperCase(),
      caminho,
      framework: framework?.id ?? 'generico',
      linguagem: lingua,
      texto: (linhas[linha - 1] ?? '').trim(),
      inicioDoBloco: bloco.inicio,
      fimDoBloco: bloco.fim,
      bloco: bloco.texto,
      middlewares,
      desconhecidos,
      montagem,
    });
  };

  const prefixoDeControlador = (ate: number): string => {
    for (let i = ate - 1; i >= 0; i--) {
      const c = /@Controller\s*\(\s*['"`]([^'"`]*)['"`]/.exec(linhas[i] ?? '');
      if (c) return '/' + c[1].replace(/^\/+/, '');
      if (/^\s*@Controller\s*\(\s*\)/.test(linhas[i] ?? '')) return '';
    }
    return '';
  };

  const caminhoNext = caminhoDoNext(arquivo);

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const n = i + 1;

    if (lingua === 'js') {
      // NestJS: @Get('x') dentro de um @Controller('admin').
      const nest = /^\s*@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(linha);
      if (nest) {
        const sufixo = (nest[2] ?? '').replace(/^\/+/, '');
        const prefixo = prefixoDeControlador(i);
        registrar(n, nest[1], `${prefixo}${sufixo === '' ? '' : '/' + sufixo}` || '/', '');
        continue;
      }
      // Next.js: o metodo exportado e a rota, e o caminho vem do proprio arquivo.
      const next = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/.exec(linha);
      if (next && caminhoNext !== null) {
        registrar(n, next[1], caminhoNext, '');
        continue;
      }
      // express / fastify / hono / koa-router: receptor.metodo('/caminho', ...).
      const js = new RegExp(
        `^\\s*(?:(?:const|let|var)\\s+[\\w$]+\\s*=\\s*)?([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${METODOS_JS})\\s*\\(\\s*(['"\`])([^'"\`]*)\\3\\s*(.*)$`
      ).exec(linha);
      if (js) {
        const receptor = js[1];
        const caminho = js[4];
        if (!caminho.startsWith('/')) continue;
        if (framework === null && !RECEPTORES_DE_ROTA.test(receptor)) continue;
        const metodo = js[2].toLowerCase();
        registrar(n, metodo === 'del' ? 'delete' : metodo, caminho, js[5], metodo === 'use');
        continue;
      }
      // fastify.route({ method: 'GET', url: '/x' }).
      const fastifyRoute = /^\s*[A-Za-z_$][\w$]*\s*\.\s*route\s*\(\s*\{/.exec(linha);
      if (fastifyRoute) {
        const bloco = blocoEmVolta(linhas, n).texto;
        const metodo = /method\s*:\s*['"`]([A-Za-z]+)['"`]/.exec(bloco);
        const url = /url\s*:\s*['"`]([^'"`]*)['"`]/.exec(bloco);
        if (metodo && url) registrar(n, metodo[1], url[1], '');
        continue;
      }
      continue;
    }

    if (lingua === 'py') {
      // FastAPI / Flask: @app.get("/x") e @bp.route("/x", methods=["POST"]).
      const py = new RegExp(`^\\s*@([A-Za-z_][\\w.]*)\\s*\\.\\s*(${METODOS_PY})\\s*\\(\\s*(['"])([^'"]*)\\3(.*)$`).exec(
        linha
      );
      if (py) {
        const caminho = py[4];
        if (!caminho.startsWith('/')) continue;
        const metodos = /methods\s*=\s*\[([^\]]*)\]/.exec(py[5]);
        if (py[2].toLowerCase() === 'route' && metodos) {
          for (const m of metodos[1].split(',')) {
            const nome = m.replace(/['"\s]/g, '');
            if (nome !== '') registrar(n, nome, caminho, py[5]);
          }
        } else {
          registrar(n, py[2] === 'route' ? 'GET' : py[2], caminho, py[5]);
        }
        continue;
      }
      // Django urlconf: path('admin/', ...) e re_path(r'^admin/', ...).
      const dj = /^\s*(?:re_)?path\s*\(\s*r?(['"])([^'"]*)\1\s*,(.*)$/.exec(linha);
      if (dj) {
        registrar(n, 'ROTA', '/' + dj[2].replace(/^[\^/]+/, ''), dj[3]);
        continue;
      }
      continue;
    }

    // gin / echo: r.GET("/x", handler) e grupo r.Group("/admin").
    const go = new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*\\.\\s*(${METODOS_GO})\\s*\\(\\s*"([^"]*)"\\s*(.*)$`).exec(linha);
    if (go) {
      const caminho = go[3];
      if (!caminho.startsWith('/')) continue;
      if (framework === null && !RECEPTORES_DE_ROTA.test(go[1])) continue;
      registrar(n, go[2] === 'Group' ? 'USE' : go[2], caminho, go[4], go[2] === 'Group');
    }
  }

  // O bloco de uma rota nao invade a rota seguinte. Sem este corte, a guarda (ou o esquema)
  // da rota de baixo contaria como se fosse da rota de cima, e o oposto tambem: um
  // `c.Param("id")` do vizinho faria um GET sem entrada nenhuma parecer que consome payload.
  rotas.sort((a, b) => a.linha - b.linha);
  for (let i = 0; i < rotas.length; i++) {
    const anterior = rotas[i - 1];
    const proxima = rotas[i + 1];
    let inicio = rotas[i].inicioDoBloco;
    let fim = rotas[i].fimDoBloco;
    if (anterior && anterior.linha !== rotas[i].linha) inicio = Math.max(inicio, anterior.linha + 1);
    if (proxima && proxima.linha !== rotas[i].linha) fim = Math.min(fim, proxima.linha - 1);
    inicio = Math.min(inicio, rotas[i].linha);
    fim = Math.max(fim, rotas[i].linha);
    rotas[i] = {
      ...rotas[i],
      inicioDoBloco: inicio,
      fimDoBloco: fim,
      bloco: linhas.slice(inicio - 1, fim).join('\n'),
    };
  }

  return rotas;
}

// ---------------------------------------------------------------------------
// Contexto do arquivo: middleware global e marcadores fora do bloco da rota
// ---------------------------------------------------------------------------

export interface ContextoDoArquivo {
  arquivo: string;
  framework: DefinicaoDeFramework | null;
  /** Ha middleware GLOBAL de autenticacao montado no arquivo. */
  authGlobal: boolean;
  /** Ha middleware GLOBAL de limite de taxa montado no arquivo. */
  rateLimitGlobal: boolean;
  /** Middleware global que o `ork` nao classifica: derruba a confianca de todo o arquivo. */
  globaisDesconhecidos: string[];
}

/** As formas de montar middleware GLOBAL em cada stack reconhecida. */
const LINHAS_DE_MIDDLEWARE_GLOBAL: readonly RegExp[] = [
  /^\s*[A-Za-z_$][\w$]*\s*\.\s*use\s*\(\s*(?!['"`]\/)(.*)$/,
  /useGlobalGuards\s*\((.*)$/,
  /APP_GUARD/,
  /addHook\s*\(\s*['"`][^'"`]*['"`]\s*,(.*)$/,
  /add_middleware\s*\((.*)$/,
  /before_request/,
  /(?:APIRouter|include_router)\s*\((?=[^)]*dependencies)(.*)$/,
  /^\s*[A-Za-z_]\w*\s*\.\s*Use\s*\((.*)$/,
];

/** O que o arquivo inteiro diz sobre guardas, limites e validacao. */
export function contextoDoArquivo(arquivo: string, conteudo: string): ContextoDoArquivo {
  const auth = padraoDe(MARCADORES_DE_AUTH);
  const rate = padraoDe(MARCADORES_DE_RATE_LIMIT);
  const conhecidos = padraoDe([
    ...MARCADORES_DE_AUTH,
    ...MARCADORES_DE_RATE_LIMIT,
    ...MARCADORES_DE_VALIDACAO,
    ...MARCADORES_NEUTROS,
  ]);
  let authGlobal = false;
  let rateLimitGlobal = false;
  const globaisDesconhecidos: string[] = [];

  for (const linha of semComentarios(conteudo).split('\n')) {
    for (const forma of LINHAS_DE_MIDDLEWARE_GLOBAL) {
      const casado = forma.exec(linha);
      if (!casado) continue;
      const argumento = (casado[1] ?? linha).trim();
      if (auth.test(argumento)) authGlobal = true;
      else if (rate.test(argumento)) rateLimitGlobal = true;
      else if (!conhecidos.test(argumento)) {
        const nome = /^[A-Za-z_$][\w$.]*/.exec(argumento)?.[0] ?? argumento.slice(0, 30);
        if (nome !== '' && !globaisDesconhecidos.includes(nome)) globaisDesconhecidos.push(nome);
      }
      break;
    }
  }

  return {
    arquivo,
    framework: frameworkDoArquivo(arquivo, conteudo),
    authGlobal,
    rateLimitGlobal,
    globaisDesconhecidos,
  };
}

// ---------------------------------------------------------------------------
// Os achados de superficie
// ---------------------------------------------------------------------------

/** Um achado da varredura, no vocabulario do board de divida do B5. */
export interface AchadoDeSuperficie {
  regra: RegraDeSuperficie;
  arquivo: string;
  linha: number;
  confianca: ConfiancaDaVarredura;
  severidade: SeveridadeDeAchado;
  titulo: string;
  descricao: string;
  alegacao: string;
  verificar: string[];
  impacto: string;
  fix: string;
  irreversivel: string;
  estimativa: string;
  framework: string;
  /** `GET /admin/users`, para a tabela do CLI. */
  rota: string;
}

/** A proposta fixa de cada regra: impacto, fix, estimativa e passo irreversivel. */
export const PROPOSTA_POR_REGRA: Readonly<
  Record<RegraDeSuperficie, { impacto: string; fix: string; estimativa: string; irreversivel: string }>
> = {
  SP8: {
    impacto:
      'a rota executa para quem nao provou quem e: o dado e a acao que ela expoe ficam ao alcance de qualquer requisicao da internet',
    fix: 'exigir a guarda de autenticacao/autorizacao na definicao da rota, ou no roteador que a monta',
    estimativa: '2h',
    irreversivel: 'nenhum',
  },
  SP9: {
    impacto:
      'endpoint de administracao/operacao exposto entrega superficie de administracao e metadados de infraestrutura a quem so deveria ver o produto',
    fix: 'restringir por rede (allowlist ou rede interna) ou exigir oAuth/basic auth no endpoint, e tirar o detalhe de infra da resposta publica',
    estimativa: '4h',
    irreversivel: 'nenhum',
  },
  SP10: {
    impacto:
      'sem limite de taxa a rota aceita brute-force de credencial, enumeracao de recurso e DDoS de aplicacao pelo preco de uma requisicao',
    fix: 'aplicar middleware de limite de taxa por IP e por identidade na rota, ou no roteador que a monta',
    estimativa: '2h',
    irreversivel: 'nenhum',
  },
  SP11: {
    impacto:
      'origem global com credenciais deixa qualquer site ler, pelo navegador da vitima, a resposta autenticada dela',
    fix: 'trocar o curinga por lista explicita de origens e so entao manter o envio de credenciais',
    estimativa: '1h',
    irreversivel: 'nenhum',
  },
  SP12: {
    impacto:
      'sem esquema na borda o handler recebe payload arbitrario: o erro aparece no meio da regra de negocio, ou nao aparece',
    fix: 'declarar o esquema de entrada na definicao da rota e recusar payload invalido antes do handler',
    estimativa: '3h',
    irreversivel: 'nenhum',
  },
};

/** Peso das severidades, para ordenar o que fica quando a regra atinge o teto. */
const PESO_DA_SEVERIDADE: Readonly<Record<SeveridadeDeAchado, number>> = { critico: 0, maior: 1, menor: 2 };
const PESO_DA_CONFIANCA: Readonly<Record<ConfiancaDaVarredura, number>> = { alta: 0, media: 1, baixa: 2 };

/** O caminho da rota (ou o arquivo, no Django) em minusculas, para casar com as listas. */
function casaCaminho(caminho: string, fontes: readonly string[]): boolean {
  return padraoDe(fontes).test(caminho);
}

/** `sed -n 'Np' arquivo | grep -qE '<ancora>'`: prova que a evidencia continua naquela linha. */
export function comandoDaLinha(arquivo: string, linha: number, ancora: string): string {
  return `sed -n '${linha}p' '${arquivo}'${filtroDaEvidencia('')} | grep -qEi '${ancora}'`;
}

/**
 * O `sed` que reproduz, no shell, o recorte que o detector fez em memoria: fora comentario
 * de linha, fora o proprio caminho da rota. A ordem e a mesma dos dois lados.
 */
export function filtroDaEvidencia(caminho: string): string {
  const expressoes = [`-e 's@//.*@@'`, `-e 's@#.*@@'`];
  if (podeRemoverCaminho(caminho)) expressoes.push(`-e 's@${caminhoParaSed(caminho)}@ @g'`);
  return ` | sed ${expressoes.join(' ')}`;
}

/**
 * Prova que o marcador NAO existe (no arquivo inteiro ou so no bloco da rota).
 *
 * O recorte do caminho e o mesmo que o detector fez em memoria: quem reexecuta a claim le
 * exatamente o texto que produziu o achado.
 */
export function comandoDeAusencia(
  arquivo: string,
  fontes: readonly string[],
  escopo: { inicio: number; fim: number } | null,
  caminho = ''
): string {
  const fonte =
    escopo === null ? `cat '${arquivo}'` : `sed -n '${escopo.inicio},${escopo.fim}p' '${arquivo}'`;
  return `! ${fonte}${filtroDaEvidencia(caminho)} | grep -qEi '${alternanciaDe(fontes)}'`;
}

/** Prova que o marcador ESTA la, no bloco citado. */
export function comandoDePresenca(
  arquivo: string,
  fontes: readonly string[],
  escopo: { inicio: number; fim: number }
): string {
  return (
    `sed -n '${escopo.inicio},${escopo.fim}p' '${arquivo}'${filtroDaEvidencia('')}` +
    ` | grep -qEi '${alternanciaDe(fontes)}'`
  );
}

/** A ancora que prova a linha: o caminho da rota, ou o metodo quando o caminho tem aspas. */
function ancoraDaRota(rota: RotaDetectada): string {
  if (rota.caminho !== '' && !rota.caminho.includes("'")) return escaparParaEre(rota.caminho);
  return escaparParaEre(rota.metodo);
}

/**
 * A confianca do achado.
 *
 * Middleware nao classificado derruba para `baixa` (pode ser a guarda que o `ork` nao
 * conhece); marcador presente no arquivo mas ausente no bloco derruba um nivel (pode estar
 * cobrindo a rota por um caminho que a leitura de bloco nao ve).
 */
export function confiancaDoAchado(
  rota: RotaDetectada,
  ctx: ContextoDoArquivo,
  escopoDeBloco: boolean
): ConfiancaDaVarredura {
  if (rota.desconhecidos.length > 0 || ctx.globaisDesconhecidos.length > 0) return 'baixa';
  const base: ConfiancaDaVarredura = ctx.framework === null ? 'media' : 'alta';
  if (!escopoDeBloco) return base;
  return base === 'alta' ? 'media' : 'baixa';
}

/** Severidade final: confianca `baixa` nunca passa de `menor`, porque ela pede confirmacao. */
export function severidadeDoAchado(
  desejada: SeveridadeDeAchado,
  confianca: ConfiancaDaVarredura
): SeveridadeDeAchado {
  if (confianca === 'baixa') return 'menor';
  if (confianca === 'media' && desejada === 'critico') return 'maior';
  return desejada;
}

/** O sufixo que marca, no proprio titulo, o achado que nao e certeza. */
export const SUFIXO_DE_CONFIRMACAO = ' (requer confirmacao humana)';

function montarAchado(entrada: {
  regra: RegraDeSuperficie;
  arquivo: string;
  linha: number;
  confianca: ConfiancaDaVarredura;
  severidadeDesejada: SeveridadeDeAchado;
  titulo: string;
  descricao: string;
  alegacao: string;
  verificar: string[];
  framework: string;
  rota: string;
}): AchadoDeSuperficie {
  const severidade = severidadeDoAchado(entrada.severidadeDesejada, entrada.confianca);
  const proposta = PROPOSTA_POR_REGRA[entrada.regra];
  return {
    regra: entrada.regra,
    arquivo: entrada.arquivo,
    linha: entrada.linha,
    confianca: entrada.confianca,
    severidade,
    titulo: entrada.titulo + (entrada.confianca === 'baixa' ? SUFIXO_DE_CONFIRMACAO : ''),
    descricao:
      entrada.descricao +
      ` Confianca ${entrada.confianca}: ${DESCRICAO_DA_CONFIANCA[entrada.confianca]}.` +
      ' Varredura deterministica do `ork` (ork audit surface), sem LLM no meio.',
    alegacao: entrada.alegacao,
    verificar: entrada.verificar,
    impacto: proposta.impacto,
    fix: proposta.fix,
    irreversivel: proposta.irreversivel,
    estimativa: proposta.estimativa,
    framework: entrada.framework,
    rota: entrada.rota,
  };
}

/** Os achados de uma rota: SP8, SP9, SP10 e SP12. */
export function achadosDaRota(
  rota: RotaDetectada,
  ctx: ContextoDoArquivo,
  conteudo: string
): AchadoDeSuperficie[] {
  const achados: AchadoDeSuperficie[] = [];
  const alvo = `${rota.metodo} ${rota.caminho}`;
  const ondeEstaDefinida = `${rota.arquivo}:${rota.linha}`;
  const bloco = { inicio: rota.inicioDoBloco, fim: rota.fimDoBloco };
  const nomeDoFramework = FRAMEWORKS.find((f) => f.id === rota.framework)?.nome ?? 'framework nao identificado';
  const mutante = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(rota.metodo);

  // O caminho da rota sai do texto antes da procura, e o comando da claim faz o MESMO
  // recorte com `sed`. Sem isso, `/auth/token` se declararia protegida pelo proprio nome.
  const blocoLimpo = semOCaminho(semComentarios(rota.bloco), rota.caminho);
  const arquivoLimpo = semOCaminho(semComentarios(conteudo), rota.caminho);
  const temAuthNoArquivo = padraoDe(MARCADORES_DE_AUTH).test(arquivoLimpo);
  const temRateLimitNoArquivo = padraoDe(MARCADORES_DE_RATE_LIMIT).test(arquivoLimpo);
  const temValidacaoNoArquivo = padraoDe(MARCADORES_DE_VALIDACAO).test(arquivoLimpo);

  const authNoBloco = padraoDe(MARCADORES_DE_AUTH).test(blocoLimpo);
  const protegida = authNoBloco || ctx.authGlobal;

  // SP9: endpoint privado de administracao/operacao exposto.
  const administrativo = casaCaminho(rota.caminho, CAMINHOS_ADMINISTRATIVOS);
  const saudeDetalhada =
    casaCaminho(rota.caminho, CAMINHOS_DE_SAUDE) && padraoDe(MARCADORES_DE_SAUDE_DETALHADA).test(blocoLimpo);
  const guardasDoSP9 = [...MARCADORES_DE_AUTH, ...MARCADORES_DE_RESTRICAO_DE_REDE];
  const restricaoNoBloco = padraoDe(guardasDoSP9).test(blocoLimpo);
  if ((administrativo || saudeDetalhada) && !restricaoNoBloco && !ctx.authGlobal) {
    const noArquivo = padraoDe(guardasDoSP9).test(arquivoLimpo);
    const confianca = confiancaDoAchado(rota, ctx, noArquivo);
    achados.push(
      montarAchado({
        regra: 'SP9',
        arquivo: rota.arquivo,
        linha: rota.linha,
        confianca,
        severidadeDesejada: 'critico',
        titulo: `endpoint ${administrativo ? 'de administracao/operacao' : 'de saude detalhado'} ${alvo} exposto sem restricao de rede nem oAuth`,
        descricao:
          `${nomeDoFramework} publica ${alvo} em ${ondeEstaDefinida}` +
          (saudeDetalhada ? ', e o corpo da resposta devolve detalhe de infraestrutura' : '') +
          `. Nao ha allowlist de rede, basic auth nem oAuth ${noArquivo ? 'no bloco da rota' : 'no arquivo'}.`,
        alegacao: `o endpoint ${alvo} definido em ${ondeEstaDefinida} nao tem restricao de rede nem guarda de autenticacao ${noArquivo ? 'no bloco da definicao' : 'em nenhum ponto do arquivo'}`,
        verificar: [
          comandoDaLinha(rota.arquivo, rota.linha, ancoraDaRota(rota)),
          comandoDeAusencia(rota.arquivo, guardasDoSP9, noArquivo ? bloco : null, rota.caminho),
        ],
        framework: rota.framework,
        rota: alvo,
      })
    );
  }

  // SP8: espaco de rota declarado em producao sem camada de autenticacao/autorizacao.
  // Um endpoint que ja saiu como SP9 nao volta como SP8: e a mesma linha, e o SP9 e a
  // afirmacao mais forte sobre ela.
  const jaSaiuComoSP9 = achados.length > 0;
  const publicaPorNatureza = casaCaminho(rota.caminho, CAMINHOS_PUBLICOS_POR_NATUREZA);
  if (!jaSaiuComoSP9 && !rota.montagem && !protegida && !publicaPorNatureza) {
    const confianca = confiancaDoAchado(rota, ctx, temAuthNoArquivo);
    achados.push(
      montarAchado({
        regra: 'SP8',
        arquivo: rota.arquivo,
        linha: rota.linha,
        confianca,
        severidadeDesejada: 'maior',
        titulo: `rota ${alvo} exposta sem camada de autenticacao/autorizacao`,
        descricao:
          `${nomeDoFramework} declara ${alvo} em ${ondeEstaDefinida} sem guarda de autenticacao ` +
          `${temAuthNoArquivo ? 'no bloco da rota (ha marcador de auth no arquivo, mas fora dela)' : 'em nenhum ponto do arquivo'}` +
          `${rota.middlewares.length > 0 ? `. Middlewares lidos na rota: ${rota.middlewares.join(', ')}` : ''}.`,
        alegacao: `a rota ${alvo} definida em ${ondeEstaDefinida} nao tem guarda de autenticacao ${temAuthNoArquivo ? 'no bloco da definicao' : 'em nenhum ponto do arquivo'}`,
        verificar: [
          comandoDaLinha(rota.arquivo, rota.linha, ancoraDaRota(rota)),
          comandoDeAusencia(rota.arquivo, MARCADORES_DE_AUTH, temAuthNoArquivo ? bloco : null, rota.caminho),
        ],
        framework: rota.framework,
        rota: alvo,
      })
    );
  }

  // SP10: rota sem limite de taxa.
  const rateNoBloco = padraoDe(MARCADORES_DE_RATE_LIMIT).test(blocoLimpo);
  const sensivelAForcaBruta = casaCaminho(rota.caminho, CAMINHOS_SENSIVEIS_A_FORCA_BRUTA);
  if (!rota.montagem && !rateNoBloco && !ctx.rateLimitGlobal && (sensivelAForcaBruta || (!protegida && mutante))) {
    const confianca = confiancaDoAchado(rota, ctx, temRateLimitNoArquivo);
    achados.push(
      montarAchado({
        regra: 'SP10',
        arquivo: rota.arquivo,
        linha: rota.linha,
        confianca,
        severidadeDesejada: sensivelAForcaBruta ? 'maior' : 'menor',
        titulo: `rota ${alvo} sem limite de taxa${sensivelAForcaBruta ? ' num caminho sujeito a brute-force' : ''}`,
        descricao:
          `${nomeDoFramework} declara ${alvo} em ${ondeEstaDefinida} sem middleware de limite, cota ou rpm ` +
          `${temRateLimitNoArquivo ? 'no bloco da rota' : 'em nenhum ponto do arquivo'}.` +
          (sensivelAForcaBruta
            ? ' O caminho e de uma classe historicamente atacada por forca bruta e enumeracao.'
            : ' A rota e publica e altera estado, o que a deixa exposta a DDoS de aplicacao.'),
        alegacao: `a rota ${alvo} definida em ${ondeEstaDefinida} nao tem limite de taxa ${temRateLimitNoArquivo ? 'no bloco da definicao' : 'em nenhum ponto do arquivo'}`,
        verificar: [
          comandoDaLinha(rota.arquivo, rota.linha, ancoraDaRota(rota)),
          comandoDeAusencia(
            rota.arquivo,
            MARCADORES_DE_RATE_LIMIT,
            temRateLimitNoArquivo ? bloco : null,
            rota.caminho
          ),
        ],
        framework: rota.framework,
        rota: alvo,
      })
    );
  }

  // SP12: definicao de rota sem esquema de payload na borda.
  const validacaoNoBloco = padraoDe(MARCADORES_DE_VALIDACAO).test(blocoLimpo);
  const consomeEntrada = mutante || padraoDe(MARCADORES_DE_ENTRADA).test(blocoLimpo);
  if (!rota.montagem && consomeEntrada && !validacaoNoBloco) {
    const confianca = confiancaDoAchado(rota, ctx, temValidacaoNoArquivo);
    achados.push(
      montarAchado({
        regra: 'SP12',
        arquivo: rota.arquivo,
        linha: rota.linha,
        confianca,
        severidadeDesejada: 'maior',
        titulo: `rota ${alvo} sem esquema de validacao do payload na definicao`,
        descricao:
          `${nomeDoFramework} declara ${alvo} em ${ondeEstaDefinida} e a rota consome entrada da requisicao, ` +
          `mas nao ha esquema nem validador declarado ${temValidacaoNoArquivo ? 'no bloco da rota' : 'em nenhum ponto do arquivo'}. ` +
          'Complementa o SP6, que olha o USO do dado dentro do handler.',
        alegacao: `a definicao da rota ${alvo} em ${ondeEstaDefinida} nao declara esquema de validacao de payload ${temValidacaoNoArquivo ? 'no bloco da definicao' : 'em nenhum ponto do arquivo'}`,
        verificar: [
          comandoDaLinha(rota.arquivo, rota.linha, ancoraDaRota(rota)),
          comandoDeAusencia(
            rota.arquivo,
            MARCADORES_DE_VALIDACAO,
            temValidacaoNoArquivo ? bloco : null,
            rota.caminho
          ),
        ],
        framework: rota.framework,
        rota: alvo,
      })
    );
  }

  return achados;
}

/**
 * SP11: CORS permissivo demais.
 *
 * A ancora e a linha de configuracao do CORS, e nao a rota: e la que o defeito mora. O
 * achado so nasce quando ha origem global E (credenciais habilitadas OU dado sensivel
 * trafegando no arquivo), porque `origin: *` num endpoint publico de leitura e escolha
 * legitima, e acusar isso seria ruido.
 */
export function achadosDeCors(
  arquivo: string,
  conteudo: string,
  ctx: ContextoDoArquivo,
  rotas: RotaDetectada[]
): AchadoDeSuperficie[] {
  // Sem comentario, pelo mesmo motivo das regras de rota: uma prosa que explica CORS nao e
  // configuracao de CORS. Foi assim que esta varredura acusou o proprio `superficie.ts`, na
  // linha do comentario que documenta a ancora.
  const linhas = semComentarios(conteudo).split('\n');
  const ancora = padraoDe(ANCORAS_DE_CORS);
  const origemGlobal = padraoDe(MARCADORES_DE_ORIGEM_GLOBAL);
  const credenciais = padraoDe(MARCADORES_DE_CREDENCIAIS_NO_CORS);
  // Dado sensivel medido pelo CAMINHO das rotas do arquivo, e nao pela prosa dele: qualquer
  // arquivo menciona `user` ou `token` em alguma linha, e essa leitura larga faria todo
  // `origin: *` do mundo virar achado.
  const sensivel = rotas.some((r) => casaCaminho(r.caminho, CAMINHOS_DE_DADO_SENSIVEL));

  for (let i = 0; i < linhas.length; i++) {
    if (!ancora.test(linhas[i]) || ehLinhaDeDados(linhas[i])) continue;
    const bloco = blocoEmVolta(linhas, i + 1);
    const temGlobal = origemGlobal.test(bloco.texto);
    const temCredenciais = credenciais.test(bloco.texto);
    if (!temGlobal) continue;
    if (!temCredenciais && !sensivel) continue;
    const escopo = { inicio: bloco.inicio, fim: bloco.fim };
    const confianca: ConfiancaDaVarredura =
      ctx.framework !== null && temCredenciais ? 'alta' : ctx.framework !== null ? 'media' : 'media';
    const verificar = [
      comandoDaLinha(arquivo, i + 1, alternanciaDe(ANCORAS_DE_CORS)),
      comandoDePresenca(arquivo, MARCADORES_DE_ORIGEM_GLOBAL, escopo),
    ];
    if (temCredenciais) verificar.push(comandoDePresenca(arquivo, MARCADORES_DE_CREDENCIAIS_NO_CORS, escopo));
    // Um achado por arquivo: a mesma configuracao de CORS repetida em varias linhas e a
    // mesma leitura contada duas vezes, e ela inflaria a recorrencia por regra.
    return [
      montarAchado({
        regra: 'SP11',
        arquivo,
        linha: i + 1,
        confianca,
        severidadeDesejada: temCredenciais ? 'critico' : 'maior',
        titulo: `CORS com origem global${temCredenciais ? ' E credenciais habilitadas' : ''} em ${arquivo}`,
        descricao:
          `A configuracao de CORS em ${arquivo}:${i + 1} libera origem global` +
          (temCredenciais
            ? ' com envio de credenciais, combinacao que expoe resposta autenticada a qualquer site.'
            : ' num arquivo que declara rota com dado sensivel.') +
          ' Fechar a origem pode quebrar cliente ja integrado, o que se corrige reabrindo a origem especifica, e por isso o passo continua reversivel.',
        alegacao: `a configuracao de CORS em ${arquivo}:${i + 1} declara origem global${temCredenciais ? ' com credenciais habilitadas' : ''}`,
        verificar,
        framework: ctx.framework?.id ?? 'generico',
        rota: 'configuracao de CORS',
      }),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// A varredura
// ---------------------------------------------------------------------------

/** Quantos achados de uma regra ficaram de fora do teto (dito em voz alta, nunca omitido). */
export interface TruncamentoDaVarredura {
  regra: RegraDeSuperficie;
  ocultos: number;
}

export interface ResultadoDaVarredura {
  raiz: string;
  arquivosLidos: number;
  arquivosComRota: number;
  rotas: number;
  /** Frameworks reconhecidos nos arquivos lidos. */
  frameworks: string[];
  achados: AchadoDeSuperficie[];
  truncados: TruncamentoDaVarredura[];
  limitePorRegra: number;
  detalhe: string;
}

/**
 * A varredura deterministica da superficie de ataque de rede.
 *
 * Le os arquivos do escopo, extrai as definicoes de rota por framework e devolve os
 * achados SP8..SP12 ja ordenados por severidade e confianca. Nao toca em disco, nao grava
 * estado e nao despacha nada: quem registra no board e o `auditrun.ts`.
 */
export function varrerSuperficie(raiz: string, opcoes: OpcoesDaVarredura = {}): ResultadoDaVarredura {
  const limite = opcoes.limitePorRegra ?? LIMITE_PADRAO_POR_REGRA;
  const arquivos = arquivosDaVarredura(raiz, opcoes);
  const frameworks = new Set<string>();
  const brutos: AchadoDeSuperficie[] = [];
  let arquivosComRota = 0;
  let totalDeRotas = 0;

  for (const arquivo of arquivos) {
    let conteudo: string;
    try {
      conteudo = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    } catch {
      continue;
    }
    const ctx = contextoDoArquivo(arquivo, conteudo);
    const rotas = rotasDoArquivo(arquivo, conteudo);
    if (rotas.length > 0) {
      arquivosComRota++;
      totalDeRotas += rotas.length;
      if (ctx.framework) frameworks.add(ctx.framework.nome);
    }
    for (const rota of rotas) brutos.push(...achadosDaRota(rota, ctx, conteudo));
    brutos.push(...achadosDeCors(arquivo, conteudo, ctx, rotas));
  }

  const filtrados = opcoes.regra ? brutos.filter((a) => a.regra === opcoes.regra) : brutos;
  const achados: AchadoDeSuperficie[] = [];
  const truncados: TruncamentoDaVarredura[] = [];
  for (const regra of REGRAS_DE_SUPERFICIE) {
    const daRegra = filtrados
      .filter((a) => a.regra === regra)
      .sort(
        (a, b) =>
          PESO_DA_SEVERIDADE[a.severidade] - PESO_DA_SEVERIDADE[b.severidade] ||
          PESO_DA_CONFIANCA[a.confianca] - PESO_DA_CONFIANCA[b.confianca] ||
          a.arquivo.localeCompare(b.arquivo) ||
          a.linha - b.linha
      );
    achados.push(...daRegra.slice(0, limite));
    if (daRegra.length > limite) truncados.push({ regra, ocultos: daRegra.length - limite });
  }

  const detalhe =
    arquivos.length === 0
      ? 'nenhum arquivo de codigo no escopo: a varredura de superficie nao leu nada (isto NAO e o mesmo que superficie limpa)'
      : `${arquivos.length} arquivo(s) lido(s), ${arquivosComRota} com definicao de rota, ${totalDeRotas} rota(s), ` +
        `${achados.length} achado(s) de superficie` +
        (truncados.length > 0
          ? `; teto de ${limite} por regra atingido em ${truncados.map((t) => `${t.regra} (+${t.ocultos})`).join(', ')}`
          : '');

  return {
    raiz,
    arquivosLidos: arquivos.length,
    arquivosComRota,
    rotas: totalDeRotas,
    frameworks: [...frameworks].sort(),
    achados,
    truncados,
    limitePorRegra: limite,
    detalhe,
  };
}

// ---------------------------------------------------------------------------
// Saidas
// ---------------------------------------------------------------------------

/**
 * O achado da varredura no formato bruto que `ork audit ingest` ja aceita.
 *
 * De proposito o tipo aqui e estrutural: `superficie.ts` nao importa `auditrun.ts` (seria
 * ciclo), e o `AchadoBruto` de la aceita este objeto por ter exatamente estes campos.
 */
export interface EntradaBrutaDeSuperficie {
  regra: string;
  severidade: string;
  titulo: string;
  arquivo: string;
  descricao: string;
  alegacao: string;
  verificar: string[];
  impacto: string;
  fix: string;
  irreversivel: string;
  estimativa: string;
}

/** Converte o achado da varredura na entrada bruta do board de divida. */
export function entradaBrutaDaSuperficie(a: AchadoDeSuperficie): EntradaBrutaDeSuperficie {
  return {
    regra: a.regra,
    severidade: a.severidade,
    titulo: a.titulo,
    arquivo: `${a.arquivo}:${a.linha}`,
    descricao: a.descricao,
    alegacao: a.alegacao,
    verificar: a.verificar,
    impacto: a.impacto,
    fix: a.fix,
    irreversivel: a.irreversivel,
    estimativa: a.estimativa,
  };
}

/** Tabela dos achados da varredura. */
export function tabelaDaVarredura(r: ResultadoDaVarredura): string {
  if (r.achados.length === 0) {
    return `Nenhum achado de superficie de ataque. ${r.detalhe}`;
  }
  const linhas = r.achados.map((a) => [
    a.regra,
    a.severidade,
    a.confianca,
    a.framework,
    a.rota,
    `${a.arquivo}:${a.linha}`,
    a.titulo,
  ]);
  return tabela(['REGRA', 'SEVERIDADE', 'CONFIANCA', 'FRAMEWORK', 'ROTA', 'EVIDENCIA', 'TITULO'], linhas);
}

/** Texto completo de `ork audit surface`. */
export function textoDaVarredura(r: ResultadoDaVarredura): string {
  const L: string[] = [];
  L.push('Varredura deterministica da superficie de ataque de rede (pack security-privacy, SP8..SP12)');
  L.push('');
  L.push(`  raiz          ${r.raiz}`);
  L.push(`  escopo        ${r.detalhe}`);
  L.push(`  frameworks    ${r.frameworks.length > 0 ? r.frameworks.join(', ') : '(nenhum reconhecido)'}`);
  L.push(`  teto          ${r.limitePorRegra} achado(s) por regra`);
  L.push('');
  L.push(tabelaDaVarredura(r));
  L.push('');
  for (const t of r.truncados) {
    L.push(`  ATENCAO: ${t.ocultos} achado(s) de ${t.regra} ficaram fora do teto desta varredura.`);
  }
  const baixas = r.achados.filter((a) => a.confianca === 'baixa').length;
  if (baixas > 0) {
    L.push(
      `  ${baixas} achado(s) sairam com confianca baixa: ${DESCRICAO_DA_CONFIANCA.baixa}`
    );
  }
  L.push('');
  L.push('Cada achado carrega o comando que o reexecuta no HEAD real (o auditor nao tem self-report).');
  L.push('Para registrar no board de divida de uma rodada: ork audit surface --registrar <rodada>');
  return L.join('\n');
}

/** O bloco que a rodada deixa no `FORMATO.md` para o auditor nao repetir o que ja foi achado. */
export function blocoDoFormato(r: ResultadoDaVarredura, registrados: boolean): string {
  const L: string[] = [];
  L.push('## Superficie de ataque de rede (SP8..SP12): ja varrida pelo `ork`');
  L.push('');
  L.push(
    'As regras SP8 a SP12 tem varredura DETERMINISTICA no proprio `ork` ' +
      '(`ork audit surface`), que roda junto com esta rodada. Resultado desta rodada:'
  );
  L.push('');
  L.push(`- ${r.detalhe}`);
  L.push(`- frameworks reconhecidos: ${r.frameworks.length > 0 ? r.frameworks.join(', ') : '(nenhum)'}`);
  L.push(
    `- achados ${registrados ? 'JA REGISTRADOS no board' : 'encontrados e NAO registrados (rodada em --dry-run)'}: ` +
      (r.achados.length === 0
        ? 'nenhum'
        : r.achados.map((a) => `${a.regra} em ${a.arquivo}:${a.linha}`).join('; '))
  );
  L.push('');
  L.push(
    'NAO repita os achados acima. Sobre SP8..SP12, escreva apenas o que a varredura ' +
      'deterministica nao alcanca (autorizacao por objeto, rota gerada em tempo de execucao, ' +
      'proxy ou gateway na frente do servico) e o que os achados de confianca `baixa` pedem: ' +
      'confirmacao humana com a evidencia que decide.'
  );
  return L.join('\n');
}
