/**
 * RM-052 (T7): regressao do incidente de 29/09/2026.
 *
 * O dono perguntou pelo Telegram "orkastery maestro - qual e o status report do roadmap do
 * orkastery agora?". O OpenClaw rodava com cwd em `~/.openclaw/workspace` (manifesto do projeto
 * "workspace", sem remoto, 0 threads); as tools chamavam o `ork` sem projeto e a resposta foi o
 * panorama do workspace: "o roadmap esta vazio" e "outras maquinas: nenhuma publicou ainda".
 *
 * Aqui a mesma cena roda pela extensao OpenClaw real (SDK simulado, `ork` real de `core/dist`),
 * com o processo parado no cwd do "gateway". A tool nunca pode relatar o workspace como se fosse o
 * projeto pedido: com `projeto: orkastery` a resposta e o roadmap do orkastery; sem projeto, e a
 * escolha tipada; e nenhuma leitura de um projeto sem remoto diz "nenhuma publicou ainda".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const DIST_OPENCLAW = path.resolve(__dirname, '../../../adapters/openclaw/dist');

type Tool = { name: string; execute: (p: Record<string, unknown>, c: unknown, x: unknown) => Promise<string> };

function item(dir: string, id: string, titulo: string, ciclo: string, thread?: string): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, 'categoria: melhoria', 'pai: null', 'features: []',
    'owner: Dono', 'atualizado_em: 2026-09-29T10:00:00-03:00', 'estado:', `  ciclo: ${ciclo}`, '  documentacao: Rascunho',
    '  codigo: Não iniciado', '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada',
    '  habilitacao: Pendente', 'evidencias:', '  codigo:', '    commit: null', '    pr: null',
    'sdlc:', `  thread: ${thread ?? 'null'}`, '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-incidente.md`), fm);
}

/** A cena de 29/09: o orkastery com roadmap e thread; o workspace do gateway vazio e sem remoto. */
function cena(registrarWorkspace: boolean) {
  const orkastery = projetoTemporario('incidente-orkastery', true);
  const workspace: ProjetoDeTeste = projetoTemporario('incidente-workspace');
  init(workspace.dir, { nome: 'workspace', abbrev: 'wor', force: true });
  workspace.carregado = exigirManifesto(workspace.dir);
  const { thread } = novaThread(orkastery.carregado, { nome: 'projeto-alvo explicito', modo: 'auto' });
  item(orkastery.dir, 'RM-052', 'Projeto-alvo explícito e resposta honesta nos hosts', 'Em desenvolvimento', thread.id);
  item(orkastery.dir, 'RM-053', 'Orkastery Network', 'Refinamento');
  item(orkastery.dir, 'RM-048', 'HITL humano no centro', 'Concluído');
  const usuario = dirTemporario('incidente-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  registrarProjeto(orkastery.dir, 'fabrica entrar');
  if (registrarWorkspace) registrarProjeto(workspace.dir, 'init');
  return {
    orkastery, workspace, thread, usuario,
    limpar: () => {
      process.env.ORK_USUARIO_DIR = anterior;
      orkastery.limpar(); workspace.limpar(); fs.rmSync(usuario, { recursive: true, force: true });
    },
  };
}

/** A extensao OpenClaw instalada, com o gateway parado no cwd do workspace. */
async function gatewayNoWorkspace(cwd: string, corpo: (tools: Map<string, Tool>) => Promise<void>): Promise<void> {
  const dir = dirTemporario('incidente-openclaw');
  const antes = { cwd: process.cwd(), ORK_BIN: process.env.ORK_BIN, ORK_PROJETO: process.env.ORK_PROJETO,
    ORK_PROJETO_EXPLICITO: process.env.ORK_PROJETO_EXPLICITO };
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(path.join(DIST_OPENCLAW, f), path.join(dir, f));
    process.env.ORK_BIN = ORK;
    delete process.env.ORK_PROJETO; delete process.env.ORK_PROJETO_EXPLICITO;
    for (const nome of Object.keys(process.env)) if (nome.startsWith('ORK_HITL_')) delete process.env[nome];
    process.chdir(cwd);
    const importar = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: { tools: (f: (d: Tool) => Tool) => Tool[] } }>;
    const plugin = (await importar(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    await corpo(new Map(plugin.tools((d) => d).map((t) => [t.name, t])));
  } finally {
    process.chdir(antes.cwd);
    for (const [k, v] of Object.entries(antes)) if (k !== 'cwd') { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('incidente 29/09: o status do roadmap do orkastery, pedido do gateway no workspace, e o do orkastery', async () => {
  const c = cena(true);
  try {
    await gatewayNoWorkspace(c.workspace.dir, async (tools) => {
      const r = await tools.get('ork_roadmap_status')!.execute({ projeto: 'orkastery' }, {}, {});
      const linhas = r.split('\n');
      assert.match(linhas[0], /^Roadmap do Orkastery \(/, r);
      // Fatia 2 do ensaio da 0.5.0 (P7): o fuso vem logo abaixo do titulo, e o projeto consultado em seguida.
      assert.match(linhas[1], /^Horários (?:de Brasília|em .+)\.$/);
      assert.match(linhas[2], /^Projeto consultado: orkastery \(ork\) · .* · pela opção --projeto$/);
      assert.match(r, /• RM-052 Projeto-alvo explícito e resposta honesta nos hosts \(GOAL\)/);
      assert.match(r, /• RM-053 Orkastery Network/);
      assert.ok(!/workspace/i.test(linhas.slice(0, 3).join('\n').replace(/\/[^ ]*/g, '')), 'o workspace nao aparece como o consultado');
      assert.ok(!/Roadmap do Workspace/.test(r));
    });
  } finally { c.limpar(); }
});

test('incidente 29/09: sem projeto, a tool devolve a escolha; nunca o roadmap nem o board do workspace do cwd', async () => {
  const c = cena(true);
  try {
    await gatewayNoWorkspace(c.workspace.dir, async (tools) => {
      for (const nome of ['ork_roadmap_status', 'ork_board']) {
        const r = await tools.get(nome)!.execute({}, {}, {});
        assert.match(r, /^\[ork saiu com 4\]\nprojeto\.escolha: 2 projetos conhecidos nesta máquina/, `${nome}: ${r}`);
        assert.match(r, /• orkastery \(ork\)/);
        assert.match(r, /• workspace \(wor\)/);
        assert.ok(!/Roadmap do Workspace|Nenhuma thread ainda|nenhuma publicou ainda/.test(r), `${nome} nao relata o workspace`);
      }
      const maestro = await tools.get('ork_maestro')!.execute({}, {}, {});
      assert.match(maestro, /projeto\.escolha/);
    });
  } finally { c.limpar(); }
});

test('incidente 29/09: o cwd do gateway conta como candidato mesmo fora do registro; nunca vence em silencio', async () => {
  const c = cena(false);
  try {
    await gatewayNoWorkspace(c.workspace.dir, async (tools) => {
      const r = await tools.get('ork_roadmap_status')!.execute({}, {}, {});
      assert.match(r, /projeto\.escolha: 2 projetos conhecidos/, r);
    });
  } finally { c.limpar(); }
});

test('incidente 29/09: board e maestro do orkastery dizem que o roadmap nao foi lido; o workspace sem remoto nao diz "nenhuma publicou"', async () => {
  const c = cena(true);
  try {
    await gatewayNoWorkspace(c.workspace.dir, async (tools) => {
      const board = await tools.get('ork_board')!.execute({ projeto: 'orkastery' }, {}, {});
      assert.match(board, /^Projeto consultado: orkastery \(ork\) · /);
      assert.match(board, /^Não lido: roadmap \(ork network roadmap\) · /m);
      const snapshot = JSON.parse(await tools.get('ork_maestro')!.execute({ projeto: 'orkastery' }, {}, {}));
      assert.equal(snapshot.project.name, 'orkastery');
      assert.ok(snapshot.notConsulted.includes('roadmap (ork network roadmap)'));
      assert.equal(snapshot.sections.threads.coverage.total, 1, 'a thread do orkastery, nao as 0 do workspace');

      const doWorkspace = await tools.get('ork_board')!.execute({ projeto: 'workspace' }, {}, {});
      assert.match(doWorkspace, /^Projeto consultado: workspace \(wor\) · .* · sem remoto · pela opção --projeto$/m);
      assert.match(doWorkspace, /outras máquinas: o projeto não tem o remoto origin, nada foi lido de ork\/fabrica-estado/);
      assert.ok(!/nenhuma publicou ainda/.test(doWorkspace));
    });
  } finally { c.limpar(); }
});
