/**
 * RM-053 (D7): os projetos conhecidos desta maquina, na fronteira com a RM-052.
 *
 * A RM-052 e a dona do registro `~/.orkastery/projetos.json` (`ork.projetos/v1`); a rede so o LE,
 * por este adaptador, e nunca o grava. Campos lidos: `nome`, `raiz` (ou `caminho`) e `remoto` (ou
 * `remotos`, com preferencia por `origin`); o resto e ignorado. Se a forma final da RM-052 mudar,
 * so este arquivo muda.
 *
 * Enquanto o registro nao existe (ou e de outra versao), a lista cai na reserva: o projeto do
 * diretorio atual e os projetos do ultimo retrato desta maquina cujo caminho ainda tem manifesto.
 * A reserva do retrato e o que impede a lista de oscilar entre os crons de projetos diferentes.
 *
 * Remoto sai sem credencial: usuario e senha da URL somem inteiros, nao so redigidos.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { git } from './branch-de-estado';
import { raizDoEstado } from './estado-thread';
import { carregarManifesto, NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';
import { pastaDoUsuario } from './maquina';
import { comGitIsolado } from './rede-forja';

export const CONTRATO_DO_REGISTRO = 'ork.projetos/v1';
const NOME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export type FonteDoProjeto = 'registro' | 'cwd' | 'retrato';

export interface ProjetoConhecido {
  nome: string;
  /** URL do remoto, sem usuario nem senha; `null` sem remoto. */
  remoto: string | null;
  /** Raiz canonica do projeto nesta maquina. */
  caminho: string;
  fonte: FonteDoProjeto;
  /** O manifesto ainda esta no caminho? */
  presente: boolean;
}

export interface LeituraDoRegistro {
  arquivo: string;
  /** `ausente`: nao ha arquivo; `invalido`: ilegivel ou de outro contrato (ignorado). */
  estado: 'lido' | 'ausente' | 'invalido';
  projetos: ProjetoConhecido[];
}

/** Esquemas de remoto que o retrato mostra; outro esquema vira `null`. */
const ESQUEMAS = new Set(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git']);
/** Host: nome DNS ou IPv4 em conjunto fechado, ou IPv6 entre colchetes. */
const HOST_DO_REMOTO = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])$/;
/** Caminho: sem `@`, `:`, `\`, `?` ou `#`; `%` so fora de `%40` (@) e `%3A` (:). */
const CAMINHO_DO_REMOTO = /^\/(?:[A-Za-z0-9._~/+-]|%(?!40|3[Aa])[0-9A-Fa-f]{2})*$/;

/**
 * O remoto como pode ir ao retrato, MONTADO a partir de partes validadas (GO-FIX 3, U1 da revisao 3).
 *
 * Tres rodadas de revisao acharam variantes de senha passando pela limpeza do texto de entrada
 * (usuario:senha na forma scp; `\` num usuario de dominio, que o `URL` do WHATWG le como `/` e o
 * git nao; a propria saida vazada de uma versao anterior). Aqui a saida so tem esquema conhecido,
 * host em conjunto fechado, porta numerica e caminho sem `@`, `:` nem `\`: usuario, senha, query e
 * fragmento nunca sao copiados. Na duvida, `null` (o projeto continua, sem remoto).
 */
export function limparRemoto(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const texto = bruto.trim();
  // `\`: o WHATWG e o git discordam sobre onde ela termina o usuario; nao ha remoto legitimo com ela.
  if (!texto || texto.length > 500 || /[\s\x00-\x1f\x7f\\]/.test(texto)) return null;
  let esquema: string, host: string, porta = '', caminho: string;
  const url = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^/?#]*@)?([^/?#:@[\]]+|\[[^\]/?#@]*\])(?::(\d{1,5}))?(\/[^?#]*)?(?:[?#].*)?$/.exec(texto);
  if (url) {
    [esquema, host, porta, caminho] = [url[1].toLowerCase(), url[2], url[3] ?? '', url[4] ?? '/'];
  } else {
    if (/^[A-Za-z]:[/]/.test(texto)) return null;
    // Forma scp (`git@host:dono/repo.git`): vira `ssh://host/dono/repo.git`, a forma usual das forjas.
    const scp = /^(?:[^@\s:/]+@)?([A-Za-z0-9.-]{2,}):(?!\/\/)([^\s@]+)$/.exec(texto);
    if (!scp) return path.isAbsolute(texto) && CAMINHO_DO_REMOTO.test(texto) ? texto : null;
    [esquema, host, caminho] = ['ssh', scp[1], `/${scp[2].replace(/^\/+/, '')}`];
  }
  if (!ESQUEMAS.has(esquema) || !HOST_DO_REMOTO.test(host) || !CAMINHO_DO_REMOTO.test(caminho)) return null;
  if (porta && (Number(porta) < 1 || Number(porta) > 65535)) return null;
  return `${esquema}://${host.toLowerCase()}${porta ? `:${porta}` : ''}${caminho}`;
}

function temManifesto(dir: string): boolean {
  return [NOME_MANIFESTO, NOME_MANIFESTO_LEGADO].some((n) => fs.existsSync(path.join(dir, n)));
}

function remotoDe(v: Record<string, unknown>): string | null {
  if (typeof v.remoto === 'string') return limparRemoto(v.remoto);
  const remotos = v.remotos;
  if (Array.isArray(remotos)) {
    const lista = remotos.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
    const escolhido = lista.find((r) => r.nome === 'origin' || r.name === 'origin') ?? lista[0];
    return escolhido ? limparRemoto(escolhido.url) : null;
  }
  if (remotos && typeof remotos === 'object') {
    const mapa = remotos as Record<string, unknown>;
    return limparRemoto(mapa.origin ?? Object.values(mapa)[0]);
  }
  return null;
}

function projetoDoRegistro(bruto: unknown, nomeDaChave?: string): ProjetoConhecido | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const v = bruto as Record<string, unknown>;
  const nome = typeof v.nome === 'string' ? v.nome : nomeDaChave;
  const caminho = typeof v.raiz === 'string' ? v.raiz : typeof v.caminho === 'string' ? v.caminho : null;
  if (!nome || !NOME.test(nome) || !caminho || !path.isAbsolute(caminho) || caminho.length > 1024 || /[\x00-\x1f\x7f]/.test(caminho)) return null;
  const normal = path.normalize(caminho);
  return { nome, remoto: remotoDe(v), caminho: normal, fonte: 'registro', presente: temManifesto(normal) };
}

/** O registro da RM-052, lido de forma tolerante. Nunca lanca: registro ruim vira `invalido`. */
export function lerRegistroDeProjetos(arquivo: string = path.join(pastaDoUsuario(), 'projetos.json')): LeituraDoRegistro {
  let bruto: unknown;
  try {
    if (fs.statSync(arquivo).size > 1024 * 1024) return { arquivo, estado: 'invalido', projetos: [] };
    bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (e) {
    return { arquivo, estado: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'ausente' : 'invalido', projetos: [] };
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { arquivo, estado: 'invalido', projetos: [] };
  const v = bruto as Record<string, unknown>;
  if (v.contrato !== undefined && v.contrato !== CONTRATO_DO_REGISTRO) return { arquivo, estado: 'invalido', projetos: [] };
  const lista = Array.isArray(v.projetos) ? v.projetos.map((p) => projetoDoRegistro(p))
    : v.projetos && typeof v.projetos === 'object'
      ? Object.entries(v.projetos as Record<string, unknown>).map(([nome, p]) => projetoDoRegistro(p, nome)) : null;
  if (!lista) return { arquivo, estado: 'invalido', projetos: [] };
  return { arquivo, estado: 'lido', projetos: lista.filter((p): p is ProjetoConhecido => p !== null) };
}

/** O projeto do diretorio atual, pela raiz canonica (a arvore principal, nunca a worktree). */
export function projetoDoDiretorio(dir: string): ProjetoConhecido | null {
  let carregado;
  try { carregado = carregarManifesto(dir); } catch { return null; }
  if (!carregado || carregado.erros.length > 0) return null;
  let raiz: string;
  try { raiz = raizDoEstado(carregado.raiz); } catch { raiz = carregado.raiz; }
  const remoto = comGitIsolado(() => git(carregado.raiz, ['remote', 'get-url', carregado.manifesto.fabrica.remoto]));
  return { nome: carregado.manifesto.project.name, remoto: remoto.ok ? limparRemoto(remoto.stdout.trim()) : null,
    caminho: raiz, fonte: 'cwd', presente: true };
}

export interface OpcoesDosProjetos {
  /** O registro da RM-052; sem nada, `~/.orkastery/projetos.json`. */
  arquivo?: string;
  /** O diretorio de onde o `ork` foi chamado, quando ha projeto nele. */
  diretorio?: string | null;
  /** Os projetos do ultimo retrato publicado desta maquina. */
  anteriores?: readonly { nome: string; remoto: string | null; caminho: string | null }[];
}

const chave = (caminho: string) => { try { return fs.realpathSync(caminho); } catch { return path.normalize(caminho); } };

/**
 * Os projetos conhecidos: registro > diretorio atual > ultimo retrato, sem repetir raiz. So entram
 * do retrato os que ainda tem manifesto no caminho; do registro entram todos, com `presente`.
 */
export function projetosConhecidos(opcoes: OpcoesDosProjetos = {}): { registro: LeituraDoRegistro; projetos: ProjetoConhecido[] } {
  const registro = lerRegistroDeProjetos(opcoes.arquivo);
  const vistos = new Map<string, ProjetoConhecido>();
  const somar = (p: ProjetoConhecido | null) => {
    if (!p) return;
    const k = chave(p.caminho), atual = vistos.get(k);
    if (!atual) vistos.set(k, p);
    else if (!atual.remoto && p.remoto) vistos.set(k, { ...atual, remoto: p.remoto });
  };
  registro.projetos.forEach(somar);
  if (opcoes.diretorio) somar(projetoDoDiretorio(opcoes.diretorio));
  for (const a of opcoes.anteriores ?? []) {
    if (!a || typeof a.nome !== 'string' || !NOME.test(a.nome) || typeof a.caminho !== 'string' || !path.isAbsolute(a.caminho)) continue;
    if (!temManifesto(a.caminho)) continue;
    somar({ nome: a.nome, remoto: limparRemoto(a.remoto), caminho: path.normalize(a.caminho), fonte: 'retrato', presente: true });
  }
  const projetos = [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.caminho.localeCompare(b.caminho));
  return { registro, projetos };
}
