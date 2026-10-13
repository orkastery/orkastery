/** Bloco de instrucoes do Orkastery em AGENTS.md, preservando todo texto humano. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Manifesto } from './types';
import { ErroDoCatalogo, Locale, LOCALE_PADRAO, msg } from './locale';
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

/**
 * O bloco do `ork init` no `AGENTS.md`. RM-061 (F3a, D1 e D2): o texto sai na lingua pedida, pela familia `gerados`
 * do catalogo; os marcadores, o titulo e as verificacoes do manifesto sao os mesmos nas duas linguas. Sem locale,
 * pt-BR: so o `ork init` passa a lingua do dono.
 */
export function blocoAgentsMd(manifesto: Manifesto, locale: Locale = LOCALE_PADRAO): string {
  const t = msg(locale).gerados.agents;
  const comandos = Object.entries(manifesto.verify)
    .filter((item): item is [string, string] => typeof item[1] === 'string' && item[1].trim() !== '')
    .map(([nome, comando]) => `- ${seguro(nome)}: \`${seguro(comando)}\``);
  const modos = manifesto.conduction.allowed_modes.map(m => `#${m[0].toUpperCase()}${m.slice(1)}`).join(', ');
  return `${INICIO_AGENTS_ORK}
## Orkastery

${t.projeto(seguro(manifesto.project.name), seguro(manifesto.project.abbrev), seguro(manifesto.worktree.base_branch))}

- ${t.comece}
- ${t.ciclo}
- ${t.modo(modos)}
- ${t.worktree}
- ${t.fases}
- ${t.claims}
- ${t.master}
${comandos.length ? `\n${t.verificacoes}\n\n${comandos.join('\n')}\n` : ''}
${t.rodape}
${FIM_AGENTS_ORK}`;
}

/** Cria ou substitui somente o bloco delimitado, no `locale` pedido. Marcadores ambiguos recusam sem escrita. */
export function atualizarAgentsMd(raiz: string, manifesto: Manifesto, locale: Locale = LOCALE_PADRAO): ResultadoAgentsMd {
  const caminho = path.join(raiz, 'AGENTS.md');
  const anterior = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : '';
  const inicios = anterior.split(INICIO_AGENTS_ORK).length - 1;
  const fins = anterior.split(FIM_AGENTS_ORK).length - 1;
  if (inicios !== fins || inicios > 1 || (inicios === 1 && anterior.indexOf(INICIO_AGENTS_ORK) > anterior.indexOf(FIM_AGENTS_ORK))) {
    // RM-061 (F3a): a recusa sai no locale do comando, remontada pela entrada do CLI (D14 da F2a).
    throw new ErroDoCatalogo((m) => m.gerados.agents.marcadoresAmbiguos);
  }
  const bloco = blocoAgentsMd(manifesto, locale);
  const proximo = inicios === 1
    ? anterior.slice(0, anterior.indexOf(INICIO_AGENTS_ORK)) + bloco + anterior.slice(anterior.indexOf(FIM_AGENTS_ORK) + FIM_AGENTS_ORK.length)
    : anterior === '' ? bloco + '\n' : anterior + (anterior.endsWith('\n') ? '\n' : '\n\n') + bloco + '\n';
  if (proximo === anterior) return { caminho, estado: 'inalterado' };
  gravar(caminho, proximo);
  return { caminho, estado: anterior === '' ? 'criado' : 'atualizado' };
}
