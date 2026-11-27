import type { ResultadoCi } from './ci';
import { nomeDecisorioGithub } from './ci-fabrica-github';
import type { EntradaDoShipComFabrica } from './ship';
import { configuracaoDaFabricaNoTextoDoManifesto, ManifestoCarregado, NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';
import { chamadorDaApi, ChamadorDaApi } from './forja/api';
import { dirDoCacheDaForja } from './forja/cache';
import type { ForjaResolvida } from './forja/contrato';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { pedidosDaBranchGitlab } from './forja/gitlab/pedidos';
import { resolverForja } from './forja/resolver';
import { branchValida, exigirRemoto } from './branch-de-estado';
import { exec } from './util';

export interface ConsultaDaFabricaNoShip {
  remoto: string;
  origem: string;
  destino: string;
  head: string;
  ci: Pick<ResultadoCi, 'state'>;
  prazoMs: number;
  /** Prazo da primeira leitura quando a operação não deve entrar no laço, como no dry-run. */
  prazoDaPrimeiraLeituraMs?: number;
}

export type ResultadoDaFabricaNoShip = { ok: true; entrada: EntradaDoShipComFabrica } |
  { ok: false; codigo: 'ci.fabrica.prova-ausente' };
export type PortaDaFabricaNoShip = (consulta: ConsultaDaFabricaNoShip) => ResultadoDaFabricaNoShip;

export interface DependenciasDaFabricaNoShip {
  lerManifestoDestino?: (destino: string, remoto: string) => string | null;
  resolver?: (remoto: string) => ForjaResolvida | null;
  criarApi?: (forja: ForjaResolvida) => ChamadorDaApi;
  agoraMs?: () => number;
  esperar?: (ms: number) => void;
}

const dormir = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const PRAZO_MINIMO_DA_LEITURA_GITLAB_MS = 1000;

function lerManifestoDaBranch(raiz: string, remoto: string, destino: string): string | null {
  if (!branchValida(destino)) return null;
  const nomeDoRemoto = exigirRemoto(remoto, 'ship');
  for (const ref of [`refs/remotes/${nomeDoRemoto}/${destino}`, `refs/heads/${destino}`]) {
    for (const arquivo of [NOME_MANIFESTO, NOME_MANIFESTO_LEGADO]) {
      const r = exec('git', ['show', '--no-ext-diff', '--end-of-options', `${ref}:./${arquivo}`], raiz);
      if (r.ok) return r.stdout;
    }
  }
  return null;
}

function resolverDoProjeto(carregado: ManifestoCarregado, remoto: string): ForjaResolvida | null {
  const nome = exigirRemoto(remoto, 'ship');
  const url = exec('git', ['remote', 'get-url', '--', nome], carregado.raiz);
  const endereco = url.ok ? lerEnderecoDoRemoto(url.stdout.trim()) : null;
  if (!endereco) return null;
  const r = resolverForja({ endereco, manifesto: carregado.manifesto.forja,
    cache: dirDoCacheDaForja(carregado.raiz) });
  return r.ok ? r.valor : null;
}

function entradaBase(c: ConsultaDaFabricaNoShip, nivel: 'observar' | 'avisar' | 'exigir',
  forja: 'github' | 'gitlab'): EntradaDoShipComFabrica {
  return { configurada: true, nivel, forja, destino: c.destino, head: c.head, resultado: null, ci: c.ci };
}

function consultarGithub(api: ChamadorDaApi, forja: ForjaResolvida, c: ConsultaDaFabricaNoShip,
  nivel: 'observar' | 'avisar' | 'exigir', appId: number): ResultadoDaFabricaNoShip {
  const nome = nomeDecisorioGithub(c.destino);
  const caminho = `repos/${forja.repo}/commits/${c.head}/check-runs?check_name=${encodeURIComponent(nome)}&filter=latest&per_page=100`;
  const r = api({ metodo: 'GET', caminho, prazoMs: c.prazoDaPrimeiraLeituraMs ?? c.prazoMs });
  if (!r.ok || r.valor.cabecalhos['x-next-page']) return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
  const corpo = r.valor.corpo as { total_count?: unknown; check_runs?: unknown } | null;
  if (!corpo || typeof corpo !== 'object' || !Array.isArray(corpo.check_runs)
      || (typeof corpo.total_count === 'number' && corpo.check_runs.length < corpo.total_count)) {
    return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
  }
  const runs = corpo.check_runs.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
    .filter((v) => v.name === nome && v.head_sha === c.head)
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
  const run = runs[0], app = run?.app;
  const appLido = app && typeof app === 'object' && !Array.isArray(app) ? (app as Record<string, unknown>).id : null;
  const verde = run?.status === 'completed' && run.conclusion === 'success' && appLido === appId;
  const base = entradaBase(c, nivel, 'github');
  return { ok: true, entrada: { ...base,
    resultado: verde ? { valido: true, destino: c.destino, head: c.head, githubAppId: appId } : null,
    github: { appIdEsperado: appId, checkVerde: verde } } };
}

function consultarGitlab(api: ChamadorDaApi, forja: ForjaResolvida, c: ConsultaDaFabricaNoShip,
  nivel: 'observar' | 'avisar' | 'exigir', contaDaFabrica: number,
  agoraMs: () => number, esperar: (ms: number) => void): ResultadoDaFabricaNoShip {
  const fim = agoraMs() + Math.max(0, c.prazoMs);
  const pendente = (): ResultadoDaFabricaNoShip => {
    const base = entradaBase(c, nivel, 'gitlab');
    return { ok: true, entrada: { ...base, resultado: { valido: true, destino: c.destino, head: c.head },
      gitlab: { estado: 'pendente' } } };
  };
  let primeiraLeitura = true;
  for (;;) {
    const antesDaLeitura = agoraMs();
    if (!primeiraLeitura && antesDaLeitura >= fim) return pendente();
    const prazoDaLeitura = primeiraLeitura && c.prazoDaPrimeiraLeituraMs !== undefined
      ? c.prazoDaPrimeiraLeituraMs : fim - antesDaLeitura;
    const lidos = pedidosDaBranchGitlab({ repositorio: forja.repo, base: c.destino, branch: c.origem,
      prazoMs: Math.max(PRAZO_MINIMO_DA_LEITURA_GITLAB_MS, prazoDaLeitura), api });
    primeiraLeitura = false;
    if (lidos.erro) {
      if (c.prazoMs > 0 && agoraMs() >= fim) return pendente();
      return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
    }
    const maisNovo = lidos.prs[0];
    const exato = maisNovo?.head === c.head ? maisNovo : undefined;
    if (exato?.estado === 'mesclado' && exato.mescladoPorId === contaDaFabrica) {
      const base = entradaBase(c, nivel, 'gitlab');
      return { ok: true, entrada: { ...base, resultado: { valido: true, destino: c.destino, head: c.head },
        gitlab: { estado: 'mesclado', shaMesclado: exato.head, mergeSha: exato.mergeSha ?? exato.head,
          numero: exato.numero, mescladoPorId: contaDaFabrica } } };
    }
    const divergente = (maisNovo ? [maisNovo] : []).find((p) => p.estado === 'mesclado' && p.head !== c.head
      && p.mescladoPorId === contaDaFabrica);
    if (divergente) {
      const base = entradaBase(c, nivel, 'gitlab');
      return { ok: true, entrada: { ...base, resultado: { valido: true, destino: c.destino, head: c.head },
        gitlab: { estado: 'mesclado', shaMesclado: divergente.head, mergeSha: divergente.mergeSha ?? divergente.head,
          numero: divergente.numero, mescladoPorId: contaDaFabrica } } };
    }
    if (maisNovo?.estado === 'mesclado') return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
    const agora = agoraMs();
    if (agora >= fim) return pendente();
    esperar(Math.min(1000, fim - agora));
  }
}

/** Porta instalada pelo CLI e pelo MCP. A configuração vem sempre da branch de destino. */
export function criarPortaDaFabricaNoShip(carregado: ManifestoCarregado,
  deps: DependenciasDaFabricaNoShip = {}): PortaDaFabricaNoShip {
  const ler = deps.lerManifestoDestino ?? ((destino, remoto) => lerManifestoDaBranch(carregado.raiz, remoto, destino));
  const resolver = deps.resolver ?? ((remoto) => resolverDoProjeto(carregado, remoto));
  const criarApi = deps.criarApi ?? ((forja) => chamadorDaApi(forja));
  const agoraMs = deps.agoraMs ?? Date.now, esperar = deps.esperar ?? dormir;
  return (c) => {
    const bruto = ler(c.destino, c.remoto);
    if (bruto === null) {
      return { ok: true, entrada: { ...entradaBase(c, 'observar', 'github'), configurada: false } };
    }
    const manifesto = configuracaoDaFabricaNoTextoDoManifesto(bruto);
    if (!manifesto) return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
    const nivel = manifesto.politicaRecibo ?? 'observar';
    const config = manifesto.fabricaCi;
    if (!config) {
      if (nivel === 'exigir' && manifesto.fabricaCiInvalida) return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
      return { ok: true, entrada: { ...entradaBase(c, nivel, 'github'), configurada: false } };
    }
    if (nivel !== 'exigir') {
      const tipo = config.gitlab_user_id !== undefined && config.github_app_id === undefined ? 'gitlab' : 'github';
      return { ok: true, entrada: entradaBase(c, nivel, tipo) };
    }
    const forja = resolver(c.remoto);
    if (!forja) return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
    const api = criarApi(forja);
    if (forja.tipo === 'github') {
      return config.github_app_id === undefined ? { ok: false, codigo: 'ci.fabrica.prova-ausente' }
        : consultarGithub(api, forja, c, nivel, config.github_app_id);
    }
    return config.gitlab_user_id === undefined ? { ok: false, codigo: 'ci.fabrica.prova-ausente' }
      : consultarGitlab(api, forja, c, nivel, config.gitlab_user_id, agoraMs, esperar);
  };
}
