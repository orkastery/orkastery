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

/** Tira usuario e senha de uma URL de remoto; texto que nao e URL de remoto vira `null`. */
export function limparRemoto(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const url = bruto.trim();
  if (!url || url.length > 500 || /[\s\x00-\x1f\x7f]/.test(url)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      u.username = '';
      u.password = '';
      return u.toString();
    } catch { return null; }
  }
  // Forma scp do git (`git@host:dono/repo.git`): o usuario e o de transporte, nunca segredo; senha nao cabe aqui.
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(url) || path.isAbsolute(url)) return url;
  return null;
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
  const remoto = git(carregado.raiz, ['remote', 'get-url', carregado.manifesto.fabrica.remoto]);
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
