/**
 * RM-072 (D9 da ork-check5x): o trabalhador da varredura do Agile Check. Recebe o arquivo com uma ferramenta, as
 * unidades dela, a config da rodada e o contexto (arvores do HEAD e da base, shas, prazo), roda o mesmo `scanTool` do
 * Classic com um guarda de rodada proprio (containers e saidas brutas dele) e imprime o resultado em JSON. Quem chama e o
 * `runScanAgil`, um trabalhador por ferramenta, ao mesmo tempo.
 */
import * as fs from 'node:fs';
import { defaultProbe, type Probe } from './executor';
import { RoundGuard } from './guard';
import { scanTool, type TrabalhoDaFerramenta } from './run';

if (require.main === module) {
  const trabalho = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as TrabalhoDaFerramenta;
  const guard = new RoundGuard(trabalho.ctx.mainRoot);
  try {
    const { deadline, ...resto } = trabalho.ctx;
    // RM-072 (D12): com o binario nativo na versao do catalogo, o Agile o usa antes do Docker (o probe sem Docker faz o
    // chooseExecutor escolher o nativo); sem ele, o Docker, como no Classic.
    const sonda = defaultProbe();
    const probe: Probe = trabalho.nativoPrimeiro ? { ...sonda, dockerCli: () => false, dockerDaemon: () => false } : sonda;
    const r = scanTool(trabalho.tool, trabalho.units, trabalho.config,
      { ...resto, deadline: deadline ?? Infinity, probe, guard, images: new Map() });
    process.stdout.write(JSON.stringify(r));
  } finally {
    guard.close();
  }
}
