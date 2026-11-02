/**
 * RM-072 (D9 da ork-check5x): o trabalhador da varredura do Agile Check. Recebe o arquivo com uma ferramenta, as
 * unidades dela, a config da rodada e o contexto (arvores do HEAD e da base, shas, prazo), roda o mesmo `scanTool` do
 * Classic com um guarda de rodada proprio (containers e saidas brutas dele) e imprime o resultado em JSON. Quem chama e o
 * `runScanAgil`, um trabalhador por ferramenta, ao mesmo tempo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultProbe, type Probe } from './executor';
import { RoundGuard } from './guard';
import { scanTool, type TrabalhoDaFerramenta } from './run';
import { consultarCacheIncremental, gravarCacheIncremental } from './incremental';
import type { ToolSpec } from './types';

/**
 * S6 do CHECK: o binario nativo usa o cache por usuario que o Docker monta (o caminho do host no lugar do caminho do
 * container), e nao o `/tmp` compartilhado do catalogo, onde outro usuario da maquina deixaria um banco do Trivy.
 */
export function comCacheNoHost(t: ToolSpec): ToolSpec {
  if (!t.cacheMounts?.length) return t;
  const trocar = (args: string[]): string[] => {
    let resposta = args;
    for (const m of t.cacheMounts ?? []) resposta = resposta.map((a) => a.split(m.container).join(m.host));
    return resposta;
  };
  return { ...t, args: trocar(t.args), ...(t.argsByStack
    ? { argsByStack: Object.fromEntries(Object.entries(t.argsByStack).map(([stack, args]) => [stack, trocar(args ?? [])])) }
    : {}) };
}

/** Semgrep é a garantia por arquivo: roda apenas conteúdo mudado e conserva os achados dos demais arquivos. */
function semgrepIncremental(trabalho: TrabalhoDaFerramenta, ferramenta: ToolSpec,
  consulta: ReturnType<typeof consultarCacheIncremental>, executar: (tool: ToolSpec, units: TrabalhoDaFerramenta['units'],
    somenteHead?: boolean) => ReturnType<typeof scanTool>): ReturnType<typeof scanTool> | null {
  if (ferramenta.name !== 'semgrep' || !consulta.anterior || consulta.escopo !== 'arquivo' || !ferramenta.argsByStack) return null;
  if (new Set(trabalho.units.map((u) => u.stack)).size !== trabalho.units.length) return null;
  const existentes = consulta.alterados.filter((arquivo) => {
    try { return fs.statSync(path.join(trabalho.ctx.headTree, arquivo)).isFile(); } catch { return false; }
  });
  const argsByStack: NonNullable<ToolSpec['argsByStack']> = {};
  const unidades = trabalho.units.filter((unidade) => {
    const prefixo = unidade.dir === '.' ? '' : `${unidade.dir.replace(/\\/g, '/')}/`;
    const alvos = existentes.filter((arquivo) => !prefixo || arquivo.startsWith(prefixo));
    const base = unidade.stack ? ferramenta.argsByStack?.[unidade.stack] : undefined;
    if (!base?.length || alvos.length === 0 || !unidade.stack) return false;
    argsByStack[unidade.stack] = [...base.slice(0, -1), ...alvos.map((arquivo) => `{src}/${arquivo}`)];
    return true;
  });
  const mudaram = new Set(consulta.alterados);
  const preservados = consulta.anterior.head.filter((achado) => !mudaram.has(achado.file));
  if (unidades.length === 0) return { ...consulta.anterior, head: preservados };
  const parcial = executar({ ...ferramenta, argsByStack }, unidades, true);
  if (parcial.run.state !== 'ran') return parcial;
  const novos = parcial.head.filter((achado) => mudaram.has(achado.file));
  return { ...parcial, head: [...preservados, ...novos], base: consulta.anterior.base };
}

if (require.main === module) {
  const trabalho = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as TrabalhoDaFerramenta;
  const guard = new RoundGuard(trabalho.ctx.mainRoot);
  try {
    const { deadline, ...resto } = trabalho.ctx;
    // RM-072 (D12): com o binario nativo na versao do catalogo, o Agile o usa antes do Docker (o probe sem Docker faz o
    // chooseExecutor escolher o nativo); sem ele, o Docker, como no Classic.
    const sonda = defaultProbe();
    const probe: Probe = trabalho.nativoPrimeiro ? { ...sonda, dockerCli: () => false, dockerDaemon: () => false } : sonda;
    const ferramenta = trabalho.nativoPrimeiro ? comCacheNoHost(trabalho.tool) : trabalho.tool;
    const executar = (tool: ToolSpec, units: TrabalhoDaFerramenta['units'], somenteHead = false) => scanTool(tool, units, trabalho.config,
      { ...resto, ...(somenteHead ? { base: resto.head, baseTree: resto.headTree, rangeCommits: 0 } : {}),
        deadline: deadline ?? Infinity, probe, guard, images: new Map() });
    const consulta = trabalho.incremental ? consultarCacheIncremental(trabalho, ferramenta) : null;
    const r = consulta?.reutilizado ?? (consulta ? semgrepIncremental(trabalho, ferramenta, consulta, executar) : null)
      ?? executar(ferramenta, trabalho.units);
    if (trabalho.incremental && !consulta?.reutilizado) gravarCacheIncremental(trabalho, ferramenta, r);
    process.stdout.write(JSON.stringify(r));
  } finally {
    guard.close();
  }
}
