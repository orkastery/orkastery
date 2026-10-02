/** Inventário explícito da conta atual, com fontes e vínculos verificáveis. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { consultarSessoes } from './adapters/claude-bg';
import { consultarRollouts } from './adapters/codex';
import { raizDoEstado } from './estado-thread';
import { listarIds, lerThread } from './thread';
import { SessaoRuntime } from './types';

export interface VinculoDeSessao { raiz: string; thread: string; fase: string; origem: string }
export interface SessaoInventariada extends SessaoRuntime {
  runtime: 'claude-bg' | 'codex';
  vinculos: VinculoDeSessao[];
}
/**
 * Uma fonte consultada. `ausente`: o runtime nem existe nesta máquina (fatia 2 do ensaio da 0.5.0,
 * P1); a fonte vale, sem sessões, e `correcao` diz o que fazer para tê-la.
 */
export interface FonteDoInventario { origem: string; ok: boolean; detalhe: string; ausente?: boolean; correcao?: string }

export interface InventarioDeSessoes {
  ok: boolean;
  escopo: { usuario: string; global: boolean; historico: boolean; raiz: string };
  fontes: FonteDoInventario[];
  sessoes: SessaoInventariada[];
  total: number;
  semThread: number;
  ambiguas: number;
}

/** Projeto canônico mais próximo de cada cwd declarado, sem varrer o HOME inteiro. */
function raizesDeRegistros(cwds: string[]): { raizes: string[]; ancestraisPendentes: string[] } {
  const raizes = new Set<string>();
  const ancestrais = new Set<string>();
  for (const cwd of cwds) {
    let dir = path.resolve(cwd);
    let encontrou = false;
    for (;;) {
      if (fs.existsSync(dir)) {
        const canonica = raizDoEstado(dir);
        if (fs.existsSync(path.join(canonica, '.orkastery', 'threads'))) {
          if (encontrou) ancestrais.add(canonica);
          else raizes.add(canonica);
          encontrou = true;
        }
      }
      const pai = path.dirname(dir);
      if (pai === dir) break;
      dir = pai;
    }
  }
  return { raizes: [...raizes].sort(),
    ancestraisPendentes: [...ancestrais].filter(r => !raizes.has(r)).sort() };
}

export function inventariarSessoes(raiz: string, opcoes: { global?: boolean; todas?: boolean } = {}): InventarioDeSessoes {
  const canonica = raizDoEstado(raiz);
  const claude = consultarSessoes(undefined, opcoes.todas);
  const codex = consultarRollouts(opcoes.todas);
  const origemClaude = `claude agents --json${opcoes.todas ? ' --all' : ''}`;
  // Fatia 2 do ensaio da 0.5.0 (P1): como o diretório opcional do Codex, só o ENOENT antes da consulta
  // prova a fonte ausente; qualquer outra falha do `claude` continua deixando o inventário incompleto.
  const fontes: FonteDoInventario[] = [
    claude.ausente
      ? { origem: origemClaude, ok: true, ausente: true, detalhe: `${claude.detalhe}: nenhuma sessão claude-bg a listar`,
        correcao: 'para despachar e listar pelo claude-bg, instale o Claude Code e garanta `claude` no PATH' }
      : { origem: origemClaude, ok: claude.ok, detalhe: claude.detalhe },
    ...codex.resultadosFontes,
  ];
  const todas: SessaoInventariada[] = [
    ...claude.sessoes.map(s => ({ ...s, runtime: 'claude-bg' as const, vinculos: [] as VinculoDeSessao[] })),
    ...codex.sessoes.map(s => ({ ...s, runtime: 'codex' as const, vinculos: [] as VinculoDeSessao[] })),
  ];
  // O cruzamento usa o universo global mesmo quando a apresentação é local.
  try {
    const projetos = raizesDeRegistros([canonica, ...todas.map(s => s.cwd!)]);
    // Não abrir registros de um hospedeiro apenas por ancestralidade. Sem consultá-lo,
    // porém, não podemos descartar vínculos: a fonte pendente impede um falso zero global.
    // Se outro cwd declarar esse projeto, ele entra normalmente em projetos.raizes.
    for (const projeto of projetos.ancestraisPendentes) {
      fontes.push({ origem: path.join(projeto, '.orkastery/threads'), ok: false,
        detalhe: 'projeto ancestral não consultado; vínculos globais incompletos' });
    }
    for (const projeto of projetos.raizes) {
      const fonte = { origem: path.join(projeto, '.orkastery/threads'), ok: true, detalhe: '' };
      fontes.push(fonte);
      try {
        for (const id of listarIds(projeto)) {
          try {
            const t = lerThread(projeto, id);
            // O site também usa thread.json para recibos de entrega, sem registro de runtime.
            // Reconhecer o schema explícito não autoriza ignorar threads corrompidas.
            if ((t as unknown as { schema?: string }).schema === 'site-delivery/v1' &&
              !('sessoes' in t)) {
              fontes.push({ origem: path.join(fonte.origem, id, 'thread.json'), ok: true,
                detalhe: 'site-delivery/v1: recibo de entrega, sem contrato de registro de sessões' });
              continue;
            }
            if (t.id !== id || !Array.isArray(t.sessoes)) throw new Error('registro inválido');
            for (const s of t.sessoes) {
              if (!s || typeof s.sessionId !== 'string' || s.sessionId.length < 8) throw new Error('identidade inválida');
              const runtime = s.runtime ?? 'claude-bg';
              const candidatas = todas.filter(v => v.runtime === runtime &&
                (v.sessionId === s.sessionId || v.sessionId.startsWith(s.sessionId)));
              if (candidatas.length > 1) throw new Error('prefixo ambíguo');
              if (candidatas.length === 1) {
                const v = candidatas[0];
                if (!v.vinculos.some(r => r.raiz === projeto && r.thread === id)) {
                  v.vinculos.push({ raiz: projeto, thread: id, fase: s.fase, origem: path.join(projeto, '.orkastery/threads', id, 'thread.json') });
                }
              }
            }
          } catch {
            fonte.ok = false;
            fonte.detalhe = 'inventário parcial de registros; consulte os arquivos com erro';
            fontes.push({ origem: path.join(fonte.origem, id, 'thread.json'), ok: false,
              detalhe: 'registro de thread ilegível, inválido ou identidade ambígua' });
          }
        }
      } catch {
        fonte.ok = false;
        fonte.detalhe = 'registro de thread ilegível, inválido ou identidade ambígua';
      }
    }
  } catch {
    fontes.push({ origem: 'projetos dos cwds', ok: false, detalhe: 'não foi possível consultar os registros acessíveis' });
  }
  const sessoes = opcoes.global ? todas : todas.filter(s => {
    try { return raizDoEstado(s.cwd!) === canonica || s.cwd === canonica || s.cwd!.startsWith(canonica + path.sep); }
    catch { return false; }
  });
  const ambiguas = sessoes.filter(s => s.vinculos.length > 1).length;
  return {
    ok: fontes.every(f => f.ok) && ambiguas === 0,
    escopo: { usuario: os.userInfo().username, global: !!opcoes.global, historico: !!opcoes.todas, raiz: canonica },
    fontes, sessoes, total: sessoes.length,
    semThread: sessoes.filter(s => s.vinculos.length === 0).length, ambiguas,
  };
}
