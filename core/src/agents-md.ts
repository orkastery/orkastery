/** Bloco de instrucoes do Orkastery em AGENTS.md, preservando todo texto humano. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Manifesto } from './types';
import { gravar } from './util';

export const INICIO_AGENTS_ORK = '<!-- orkastery:begin -->';
export const FIM_AGENTS_ORK = '<!-- orkastery:end -->';

export interface ResultadoAgentsMd {
  caminho: string;
  estado: 'criado' | 'atualizado' | 'inalterado';
}

function seguro(valor: string): string {
  return valor.replace(/[\r\n\0`]+/g, ' ').trim();
}

export function blocoAgentsMd(manifesto: Manifesto): string {
  const comandos = Object.entries(manifesto.verify)
    .filter((item): item is [string, string] => typeof item[1] === 'string' && item[1].trim() !== '')
    .map(([nome, comando]) => `- ${seguro(nome)}: \`${seguro(comando)}\``);
  return `${INICIO_AGENTS_ORK}
## Orkastery

Projeto: **${seguro(manifesto.project.name)}** (${seguro(manifesto.project.abbrev)}). Branch base: \`${seguro(manifesto.worktree.base_branch)}\`.

- Comece com \`ork doctor\`, \`ork onboarding\` e \`ork thread status <thread>\`.
- Conduza o ciclo GOAL → PLAN → GO → CHECK → SHIP → MASTER pelo \`ork\`.
- Respeite o modo da thread: ${manifesto.conduction.allowed_modes.map(m => `#${m[0].toUpperCase()}${m.slice(1)}`).join(', ')}.
- Edite produto somente na worktree vinculada; estado em \`.orkastery/\` pertence ao núcleo.
- PLAN não implementa. GO usa commits atômicos. CHECK não corrige. SHIP acontece por \`ork ship\`.
- Toda alegação exige claim e comando reproduzível; self-report não é evidência.
- MASTER por omissão só da sua thread: \`ork master <thread> --aceitar-omissao\`; sem a thread, fecha também as entregas de outras frentes.
${comandos.length ? `\nVerificações do manifesto:\n\n${comandos.join('\n')}\n` : ''}
Este bloco é mantido por \`ork init\`. Edite livremente o restante do arquivo.
${FIM_AGENTS_ORK}`;
}

/** Cria ou substitui somente o bloco delimitado. Marcadores ambiguos recusam sem escrita. */
export function atualizarAgentsMd(raiz: string, manifesto: Manifesto): ResultadoAgentsMd {
  const caminho = path.join(raiz, 'AGENTS.md');
  const anterior = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : '';
  const inicios = anterior.split(INICIO_AGENTS_ORK).length - 1;
  const fins = anterior.split(FIM_AGENTS_ORK).length - 1;
  if (inicios !== fins || inicios > 1 || (inicios === 1 && anterior.indexOf(INICIO_AGENTS_ORK) > anterior.indexOf(FIM_AGENTS_ORK))) {
    throw new Error('AGENTS.md possui marcadores Orkastery ambiguos; corrija o bloco antes de rodar ork init');
  }
  const bloco = blocoAgentsMd(manifesto);
  const proximo = inicios === 1
    ? anterior.slice(0, anterior.indexOf(INICIO_AGENTS_ORK)) + bloco + anterior.slice(anterior.indexOf(FIM_AGENTS_ORK) + FIM_AGENTS_ORK.length)
    : anterior === '' ? bloco + '\n' : anterior + (anterior.endsWith('\n') ? '\n' : '\n\n') + bloco + '\n';
  if (proximo === anterior) return { caminho, estado: 'inalterado' };
  gravar(caminho, proximo);
  return { caminho, estado: anterior === '' ? 'criado' : 'atualizado' };
}
