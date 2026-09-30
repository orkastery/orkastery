/** Descoberta somente entre raízes permitidas. Nenhuma mutação ou busca na home. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { carregarManifesto } from './manifest';
import { raizDoEstado } from './estado-thread';
import { listarIds, lerThread } from './thread';
import { MaestroSnapshot } from './maestro-contract';
import { FORA_DA_CONSULTA, outrosProjetosConhecidos, raizParaExibir, remotoDoProjeto } from './projeto-alvo';

export interface MaestroContext {
  root: string; manifest: string; fingerprint: string;
  project: MaestroSnapshot['project'];
  /** RM-052: o que o panorama nao le, declarado no snapshot. */
  notConsulted?: string[];
}
export interface DiscoveryOptions {
  cwd: string;
  /** Configuração confiável do instalador; nunca root arbitrário de uma tool. */
  pinned?: string; allowedRoots?: readonly string[]; selected?: string;
  /** RM-052: contar os outros projetos desta maquina no "nao lido". O MCP, fixado num projeto, nao conta. */
  countOtherProjects?: boolean;
}

/**
 * RM-052: o panorama le threads, sessoes e filas deste projeto nesta maquina. Roadmap, reservas e
 * as outras maquinas NAO entram nele; quem le o panorama precisa saber disso para nao concluir
 * "roadmap vazio" a partir de zero threads, que foi o incidente de 29/09.
 */
function consultaDoMaestro(value: MaestroContext, countOtherProjects: boolean): MaestroContext {
  const loaded = carregarManifesto(value.root);
  const others = countOtherProjects ? outrosProjetosConhecidos(value.root) : 0;
  return { ...value, project: { ...value.project, root: raizParaExibir(value.root),
      remote: remotoDoProjeto(value.root, loaded?.manifesto.fabrica?.remoto ?? 'origin') },
    notConsulted: [FORA_DA_CONSULTA.roadmap, FORA_DA_CONSULTA.reservas, FORA_DA_CONSULTA.outrasMaquinas,
      ...(others > 0 ? [`outros projetos desta máquina: ${others} (ork projetos)`] : [])] };
}
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
function physical(file: string): string {
  const absolute = path.resolve(file);
  if (fs.realpathSync(absolute) !== absolute) throw Error('maestro.project.scope');
  return absolute;
}
function context(root: string, origin: MaestroContext['project']['origin']): MaestroContext {
  const real = physical(root);
  const manifest = ['orkastery.yaml', 'devmaster.yaml'].map(f => path.join(real, f)).find(f => fs.existsSync(f));
  if (!manifest) throw Error('maestro.project.missing');
  physical(manifest);
  const stat = fs.statSync(manifest);
  if (!stat.isFile() || stat.size > 16384) throw Error('maestro.project.scope');
  for (const name of ['.orkastery', '.orkastery/threads', '.orkastery/objectives']) {
    const file = path.join(real, name);
    if (fs.existsSync(file) && !inside(real, fs.realpathSync(file))) throw Error('maestro.project.scope');
  }
  const loaded = carregarManifesto(real);
  if (!loaded || loaded.raiz !== real || loaded.erros.length) throw Error('maestro.project.scope');
  const fingerprint = createHash('sha256').update(real).update(fs.readFileSync(manifest))
    .update(`${fs.statSync(real).dev}:${fs.statSync(real).ino}:${stat.ino}`).digest('hex');
  return { root: real, manifest, fingerprint, project: { id: loaded.manifesto.project.abbrev,
    name: loaded.manifesto.project.name, origin, fingerprint } };
}
function localRoot(cwd: string): string | undefined {
  let current = cwd;
  for (;;) {
    if (['orkastery.yaml', 'devmaster.yaml'].some(f => fs.existsSync(path.join(current, f)))) return current;
    const parent = path.dirname(current); if (parent === current) return undefined;
    current = parent;
  }
}
export function discoverMaestro(options: DiscoveryOptions): MaestroContext {
  const cwd = physical(options.cwd), nearest = localRoot(cwd);
  const candidates = [...new Set(options.pinned ? [options.pinned] : options.allowedRoots ?? (nearest ? [nearest] : []))].map(physical);
  if (!candidates.length) throw Error('maestro.project.missing');
  if (options.selected && !candidates.includes(path.resolve(options.selected))) throw Error('maestro.project.scope');
  const chosen = options.selected ? path.resolve(options.selected) : candidates.length === 1 ? candidates[0] : undefined;
  if (!chosen) throw Error('maestro.project.ambiguous');
  const origin: MaestroContext['project']['origin'] = options.selected ? 'selection' : options.pinned ? 'installation' : 'cwd';
  // Pin/seleção limitam candidatos; não dispensam o vínculo com o estado canônico.
  const canonical = raizDoEstado(chosen);
  if (canonical !== chosen) {
      const git = path.join(chosen, '.git'); physical(git);
      const match = /^gitdir: (.+)\s*$/.exec(fs.readFileSync(git, 'utf8'));
      if (!match) throw Error('maestro.project.scope');
      const gitdir = physical(path.resolve(chosen, match[1].trim()));
      const common = physical(path.join(canonical, '.git'));
      const worktrees = physical(path.join(common, 'worktrees'));
      if (path.dirname(gitdir) !== worktrees ||
          path.resolve(gitdir, fs.readFileSync(physical(path.join(gitdir, 'commondir')), 'utf8').trim()) !== common ||
          path.resolve(gitdir, fs.readFileSync(physical(path.join(gitdir, 'gitdir')), 'utf8').trim()) !== git) throw Error('maestro.project.scope');
      const localState = physical(path.join(chosen, '.orkastery/threads'));
      const bindings = listarIds(canonical).filter(id => lerThread(canonical, id).worktree === chosen);
      if (bindings.length !== 1) throw Error('maestro.project.scope');
      const bound = path.join(localState, bindings[0]);
      if (!fs.existsSync(bound) || fs.realpathSync(bound) !== path.join(canonical, '.orkastery/threads', bindings[0])) throw Error('maestro.project.scope');
      if (fs.existsSync(localState)) for (const name of fs.readdirSync(localState)) {
        const file = path.join(localState, name), target = path.join(canonical, '.orkastery/threads', name);
        if (fs.lstatSync(file).isSymbolicLink() && fs.realpathSync(file) !== target) throw Error('maestro.project.scope');
      }
      return consultaDoMaestro(context(canonical, 'worktree'), options.countOtherProjects !== false);
  }
  return consultaDoMaestro(context(chosen, origin), options.countOtherProjects !== false);
}
export function revalidateMaestroContext(value: MaestroContext): void {
  const current = context(value.root, value.project.origin);
  if (current.fingerprint !== value.fingerprint || current.manifest !== value.manifest) throw Error('maestro.snapshot.stale');
}
