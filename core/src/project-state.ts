/** D3: estado da main validada; código e verificadores continuam na candidata. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { exigirManifesto, ManifestoCarregado, NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';

export interface ProjectState {
  root: string;
  codeRoot: string;
  linked: boolean;
}

export function projectState(root: string): ProjectState {
  try {
    const codeRoot = fs.realpathSync(root);
    const canonical = fs.realpathSync(raizDoEstado(codeRoot));
    return { root: canonical, codeRoot, linked: canonical !== codeRoot };
  } catch { throw new Error('project-state.root.invalid'); }
}

export function stateFile(root: string, name: 'portfolio.json' | 'onboarding.json'): string {
  const state = projectState(root);
  const target = path.join(state.root, '.orkastery', name);
  // Uma leitura da WT não pode criar uma segunda autoridade por falta da fonte.
  if (state.linked && !fs.existsSync(target)) throw new Error('project-state.source.missing');
  return target;
}

/** Diagnóstico separado da leitura: cópias locais nunca substituem a autoridade. */
export function stateFileStatus(root: string, name: 'portfolio.json' | 'onboarding.json') {
  const state = projectState(root);
  const source = stateFile(root, name);
  const local = path.join(state.codeRoot, '.orkastery', name);
  const divergent = state.linked && fs.existsSync(local) &&
    !fs.readFileSync(local).equals(fs.readFileSync(source));
  return { ...state, source, divergent };
}

/** Resolve somente a configuração de memória, sem trocar paths de código/build. */
export function memoryState(loaded: ManifestoCarregado): { loaded: ManifestoCarregado; source: string; divergent: boolean } {
  const state = projectState(loaded.raiz);
  if (!state.linked) return { loaded, source: loaded.caminho, divergent: false };
  try {
    if (![NOME_MANIFESTO, NOME_MANIFESTO_LEGADO].some(n => fs.existsSync(path.join(state.root, n)))) {
      throw new Error('missing');
    }
    const canonical = exigirManifesto(state.root);
    if (canonical.raiz !== state.root) throw new Error('invalid');
    return {
      loaded: { ...loaded, manifesto: { ...loaded.manifesto, memory: canonical.manifesto.memory } },
      source: canonical.caminho,
      divergent: JSON.stringify(loaded.manifesto.memory) !== JSON.stringify(canonical.manifesto.memory),
    };
  } catch { throw new Error('project-state.memory.unavailable'); }
}
