/**
 * RM-061, F3d (snapshot pt-BR): `setup` (entrevista, tabela, edicao, worktree, sandbox e as recusas do contrato de
 * prazo dos blocos), `projetos` (registro e resolucao do projeto-alvo), `modos` e `ciclos`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tabelaDeVariantes } from '../src/ciclos';
import { exigirManifesto } from '../src/manifest';
import { ORDEM_DOS_MODOS, tabelaDeModos } from '../src/modos';
import { textoDaMigracaoModos } from '../src/modos-migracao';
import { ErroDeProjeto } from '../src/projeto-alvo';
import {
  consumirPrazoDoBloco, herdarPrazoDoBloco, iniciarPrazoDoBloco, lerSetup, limitesDoBloco, setupPadrao, validarFallback,
  validarLimitesDeBloco,
} from '../src/setup';
import { IdentidadeDoPrazo, LimitesDeBloco, Manifesto, PrazoDeBloco, SetupDeConducao } from '../src/types';
import { exec } from '../src/util';
import {
  Ambiente, ambiente, caso, Casos, dirFixo, dirTemp, erro, ork, orkComEnv, projeto, repoComCommit, T0, texto,
} from './locale-f3d-apoio';

const LIMITES: LimitesDeBloco = { duracaoMs: 10_000, maxChildren: 2, maxDepth: 1, maxRetries: 2 };
const IDENTIDADE: IdentidadeDoPrazo = { threadId: 'fixture', execucaoId: 'execucao-1', modo: 'classic', bloco: 3 };
const INICIO = 1_000_000;

function setupCompleto(): SetupDeConducao {
  const setup = setupPadrao();
  for (const modo of ORDEM_DOS_MODOS) {
    for (const bloco of setup.modos[modo].blocos) bloco.limites = { ...LIMITES };
  }
  return setup;
}

/** Um manifesto com o playbook ligado, lido de uma pasta temporaria (nada vai ao HOME de quem roda). */
function manifestoComPlaybook(): Manifesto {
  const dir = dirTemp('setup-playbook', '<PLAYBOOK>');
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: fix\n\nplaybook:\n  ativo: true\n');
  return exigirManifesto(dir).manifesto;
}

/** O `lerSetup` sobre um `.orkastery/setup.json` bruto (ou uma pasta no lugar dele). */
function setupBruto(nome: string, bruto: unknown): string {
  const dir = dirTemp(`setup-${nome}`, '<SETUP>');
  fs.mkdirSync(path.join(dir, '.orkastery'), { recursive: true });
  const arquivo = path.join(dir, '.orkastery', 'setup.json');
  if (bruto === null) fs.mkdirSync(arquivo);
  else fs.writeFileSync(arquivo, JSON.stringify(bruto));
  return erro(() => lerSetup(dir));
}

function casosDoContratoDoSetup(casos: Casos): void {
  caso(casos, 'setup: fallback sem modelo', () => erro(() => validarFallback(['codex'], 'claude-bg')));
  caso(casos, 'setup: fallback de runtime desconhecido', () => erro(() => validarFallback(['gpt:modelo'], 'claude-bg')));
  caso(casos, 'setup: fallback que repete o runtime', () => erro(() => validarFallback(['codex:gpt-5.5', 'codex:outro'], 'claude-bg')));
  caso(casos, 'setup: limites que nao sao objeto', () => erro(() => validarLimitesDeBloco(null)));
  caso(casos, 'setup: limites com campos a menos', () => erro(() => validarLimitesDeBloco({ duracaoMs: 1 })));
  caso(casos, 'setup: duracao zero', () => erro(() => validarLimitesDeBloco({ ...LIMITES, duracaoMs: 0 })));
  caso(casos, 'setup: retries negativo', () => erro(() => validarLimitesDeBloco({ ...LIMITES, maxRetries: -1 })));
  caso(casos, 'setup: arquivo ilegivel', () => setupBruto('ilegivel', null));
  caso(casos, 'setup: contrato incompativel', () => setupBruto('contrato', { contrato: 'x' }));
  caso(casos, 'setup: modos em lista', () => setupBruto('modos', { modos: [] }));
  caso(casos, 'setup: blocos que nao sao lista', () => setupBruto('blocos', { modos: { classic: { blocos: {} } } }));
  caso(casos, 'setup: bloco que nao e objeto', () => setupBruto('bloco', { modos: { classic: { blocos: ['x'] } } }));
  caso(casos, 'setup: bloco com limites sem runtime conhecido', () => setupBruto('runtime', {
    modos: { classic: { blocos: [{ runtime: 'x', limites: LIMITES }] } } }));
  caso(casos, 'setup: limites sem contrato', () => setupBruto('limites', {
    modos: { classic: { blocos: [{ runtime: 'claude-bg', model: 'm', effort: 'e', limites: LIMITES }] } } }));

  const manifesto = manifestoComPlaybook();
  const completo = setupCompleto();
  caso(casos, 'setup: playbook sem modo permitido valido', () => erro(() => limitesDoBloco(
    { ...manifesto, conduction: { ...manifesto.conduction, allowed_modes: ['x'] } } as never, completo, 'classic', 'GO')));
  caso(casos, 'setup: playbook sem limites', () => erro(() => limitesDoBloco(manifesto, setupPadrao(), 'classic', 'GO')));
  const incompleto = setupCompleto();
  incompleto.modos.classic.blocos = incompleto.modos.classic.blocos.slice(0, 2);
  caso(casos, 'setup: playbook sem todos os blocos', () => erro(() => limitesDoBloco(manifesto, incompleto, 'classic', 'GO')));
  caso(casos, 'setup: fase fora do modo', () => erro(() => limitesDoBloco(manifesto, completo, 'classic', 'VOO')));
  caso(casos, 'setup: identidade de outro bloco', () => erro(() => iniciarPrazoDoBloco(manifesto, completo, { ...IDENTIDADE, bloco: 1 }, 'GO', INICIO)));
  caso(casos, 'setup: inicio negativo', () => erro(() => iniciarPrazoDoBloco(manifesto, completo, IDENTIDADE, 'GO', -1)));
  caso(casos, 'setup: identidade sem thread', () => erro(() => iniciarPrazoDoBloco(manifesto, completo, { ...IDENTIDADE, threadId: '' }, 'GO', INICIO)));
  caso(casos, 'setup: identidade de bloco que nao existe', () => erro(() => iniciarPrazoDoBloco(manifesto, completo,
    { ...IDENTIDADE, bloco: 99 }, 'GO', INICIO)));
  caso(casos, 'setup: identidade com campo a mais', () => erro(() => iniciarPrazoDoBloco(manifesto, completo,
    { ...IDENTIDADE, extra: 1 } as never, 'GO', INICIO)));

  const prazo = iniciarPrazoDoBloco(manifesto, completo, IDENTIDADE, 'GO', INICIO) as PrazoDeBloco;
  caso(casos, 'setup: prazo de outra versao', () => erro(() => consumirPrazoDoBloco({ ...prazo, versao: 2 } as never, IDENTIDADE, INICIO)));
  caso(casos, 'setup: prazo de outra execucao', () => erro(() => consumirPrazoDoBloco(prazo, { ...IDENTIDADE, execucaoId: 'outra' }, INICIO)));
  caso(casos, 'setup: prazo inconsistente', () => erro(() => consumirPrazoDoBloco({ ...prazo, deadlineMs: prazo.deadlineMs + 1 }, IDENTIDADE, INICIO)));
  caso(casos, 'setup: prazo com campo a mais', () => erro(() => consumirPrazoDoBloco({ ...prazo, extra: 1 } as never, IDENTIDADE, INICIO)));
  caso(casos, 'setup: relogio que volta', () => erro(() => consumirPrazoDoBloco(prazo, IDENTIDADE, INICIO - 1)));
  caso(casos, 'setup: espera com processo ativo', () => erro(() => consumirPrazoDoBloco(prazo, IDENTIDADE, INICIO,
    { tipo: 'espera_lease', processosAtivos: 1 } as never)));
  caso(casos, 'setup: atividade desconhecida', () => erro(() => consumirPrazoDoBloco(prazo, IDENTIDADE, INICIO, { tipo: 'outra' } as never)));
  caso(casos, 'setup: heranca de prazo expirado', () => erro(() => herdarPrazoDoBloco(prazo, IDENTIDADE, INICIO + LIMITES.duracaoMs)));
  caso(casos, 'setup: heranca que amplia', () => erro(() => herdarPrazoDoBloco(prazo, IDENTIDADE, INICIO + 1, { ...LIMITES, maxChildren: 5 })));
  caso(casos, 'setup: heranca reduzida ja expirada', () => erro(() => herdarPrazoDoBloco(prazo, IDENTIDADE, INICIO + 10,
    { ...LIMITES, duracaoMs: 5 })));
}

function casosDoSetupNoCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('setup', 'loc', amb);
  caso(casos, 'cli setup: entrevista', () => texto(ork(repo, amb, 'setup')));
  caso(casos, 'cli setup: modo classic', () => texto(ork(repo, amb, 'setup', 'classic')));
  caso(casos, 'cli setup: modo desconhecido', () => texto(ork(repo, amb, 'setup', 'voar')));
  caso(casos, 'cli setup: editar sem bloco', () => texto(ork(repo, amb, 'setup', 'classic', '--runtime', 'codex')));
  caso(casos, 'cli setup: bloco sem edicao', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1')));
  caso(casos, 'cli setup: bloco que nao existe', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '9', '--effort', 'high')));
  caso(casos, 'cli setup: runtime desconhecido', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1', '--runtime', 'gpt')));
  caso(casos, 'cli setup: runtime sem modelo', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1', '--runtime', 'codex')));
  caso(casos, 'cli setup: fallback invalido', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1', '--fallback', 'codex')));
  caso(casos, 'cli setup: editar bloco', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1', '--runtime', 'codex',
    '--model', 'gpt-5.5', '--effort', 'high', '--fallback', 'claude-bg:opus')));
  caso(casos, 'cli setup: entrevista com bloco customizado', () => texto(ork(repo, amb, 'setup')));
  caso(casos, 'cli setup: reset do modo', () => texto(ork(repo, amb, 'setup', 'classic', '--reset')));
  caso(casos, 'cli setup: reset geral', () => texto(ork(repo, amb, 'setup', '--reset')));
  caso(casos, 'cli setup: versionar', () => texto(ork(repo, amb, 'setup', 'versionar')));
  caso(casos, 'cli setup: versionar de novo', () => texto(ork(repo, amb, 'setup', 'versionar')));
  caso(casos, 'cli setup: modo com setup versionado', () => texto(ork(repo, amb, 'setup', 'auto')));
  const versionado = path.join(repo, 'orkastery.setup.json');
  const setup = JSON.parse(fs.readFileSync(versionado, 'utf8')) as SetupDeConducao;
  // Modelo vazio com runtime diferente do default do modo: a leitura o deixa pendente.
  setup.modos.classic.blocos[0] = { runtime: 'codex', model: '', effort: 'high' };
  fs.writeFileSync(versionado, JSON.stringify(setup, null, 2));
  caso(casos, 'cli setup: modo com modelo pendente', () => texto(ork(repo, amb, 'setup', 'classic')));
  caso(casos, 'cli setup: entrevista com modelo pendente', () => texto(ork(repo, amb, 'setup')));
  caso(casos, 'cli setup: editar com modelo pendente', () => texto(ork(repo, amb, 'setup', 'classic', '--bloco', '1', '--effort', 'high')));

  caso(casos, 'cli setup: worktree', () => texto(ork(repo, amb, 'setup', 'worktree')));
  const yaml = path.join(repo, 'orkastery.yaml');
  const foraDaRaiz = dirTemp('setup-fora-wt', '<FORA_WT>');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('dir: ".claude/worktrees"', `dir: "${foraDaRaiz}"`)
    .replace('sandbox: workspace-write', 'sandbox: danger-full-access'));
  caso(casos, 'cli setup: worktree fora da raiz', () => texto(ork(repo, amb, 'setup', 'worktree')));
  caso(casos, 'cli setup: worktree confirmar', () => texto(ork(repo, amb, 'setup', 'worktree', 'confirmar')));
  caso(casos, 'cli setup: worktree confirmada', () => texto(ork(repo, amb, 'setup', 'worktree')));
  caso(casos, 'cli setup: worktree revogar', () => texto(ork(repo, amb, 'setup', 'worktree', 'revogar')));
  caso(casos, 'cli setup: worktree revogar de novo', () => texto(ork(repo, amb, 'setup', 'worktree', 'revogar')));
  caso(casos, 'cli setup: worktree subcomando desconhecido', () => texto(ork(repo, amb, 'setup', 'worktree', 'voar')));
  caso(casos, 'cli setup: sandbox sem confirmacao', () => texto(ork(repo, amb, 'setup', 'sandbox')));
  caso(casos, 'cli setup: sandbox confirmar sem postura', () => texto(ork(repo, amb, 'setup', 'sandbox', 'confirmar')));
  caso(casos, 'cli setup: sandbox confirmar', () => texto(ork(repo, amb, 'setup', 'sandbox', 'confirmar', 'danger-full-access')));
  caso(casos, 'cli setup: sandbox confirmada', () => texto(ork(repo, amb, 'setup', 'sandbox')));
  caso(casos, 'cli setup: sandbox revogar', () => texto(ork(repo, amb, 'setup', 'sandbox', 'revogar')));
  caso(casos, 'cli setup: sandbox revogar de novo', () => texto(ork(repo, amb, 'setup', 'sandbox', 'revogar')));
  caso(casos, 'cli setup: sandbox subcomando desconhecido', () => texto(ork(repo, amb, 'setup', 'sandbox', 'voar')));
}

function casosDosProjetos(casos: Casos): void {
  caso(casos, 'projetos: recusa com candidatos', () => new ErroDeProjeto('projeto.ambiguo', '"loja" casa 2 projetos', [
    { nome: 'loja', abbrev: '', raiz: '/srv/loja', remoto: null, presente: false },
    { nome: 'loja', abbrev: 'loj', raiz: '/srv/loja-2', remoto: 'github.com/p/loja', presente: true },
  ], 'escolha um').texto);
  // Uma casa so destes casos: o registro comeca vazio e nada vai ao HOME de quem roda. Casas e projetos ficam em
  // pastas de comprimento fixo em /tmp: a coluna RAIZ da tabela nao muda com o TMPDIR, e projeto e casa sao ambos
  // temporarios para o registro (que recusa projeto de pasta temporaria numa casa duravel).
  const amb = ambiente('projetos', true);
  const fora = dirFixo('ork-f3d-projetos-fora', '<FORA>');
  caso(casos, 'cli projetos: list vazio', () => texto(ork(fora, amb, 'projetos')));
  const loja = repoComCommit('projetos-loja', '<LOJA>', true);
  caso(casos, 'cli projetos: registrar sem manifesto', () => texto(ork(fora, amb, 'projetos', 'registrar', loja)));
  ork(loja, amb, 'init', '--name', 'loja', '--abbrev', 'loj');
  caso(casos, 'cli projetos: list com o projeto do init', () => texto(ork(fora, amb, 'projetos')));
  caso(casos, 'cli projetos: registrar', () => texto(ork(fora, amb, 'projetos', 'registrar', loja)));
  caso(casos, 'cli projetos: registrar com caminho e --projeto', () => texto(ork(fora, amb, 'projetos', 'registrar', loja, '--projeto', 'loja')));
  caso(casos, 'cli projetos: esquecer sem alvo', () => texto(ork(fora, amb, 'projetos', 'esquecer')));
  caso(casos, 'cli projetos: esquecer o que nao esta', () => texto(ork(fora, amb, 'projetos', 'esquecer', 'nada')));
  caso(casos, 'cli projetos: subcomando desconhecido', () => texto(ork(fora, amb, 'projetos', 'voar')));
  caso(casos, 'cli projetos: --projeto sem valor', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', '')));
  caso(casos, 'cli projetos: --projeto com nome invalido', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', 'Nome Invalido!')));
  caso(casos, 'cli projetos: --projeto com caminho que nao existe', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', path.join(fora, 'nao-existe'))));
  caso(casos, 'cli projetos: --projeto sem manifesto', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', fora)));
  caso(casos, 'cli projetos: --projeto que nao esta no registro', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', 'outra')));
  const copia = repoComCommit('projetos-copia', '<COPIA>', true);
  ork(copia, amb, 'init', '--name', 'loja', '--abbrev', 'loj');
  caso(casos, 'cli projetos: --projeto ambiguo', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', 'loja')));
  caso(casos, 'cli projetos: esquecer', () => texto(ork(fora, amb, 'projetos', 'esquecer', copia)));
  fs.renameSync(path.join(loja, 'orkastery.yaml'), path.join(loja, 'orkastery.yaml.fora'));
  caso(casos, 'cli projetos: --projeto sem o manifesto na raiz', () => texto(ork(fora, amb, 'thread', 'list', '--projeto', 'loja')));
  fs.renameSync(path.join(loja, 'orkastery.yaml.fora'), path.join(loja, 'orkastery.yaml'));
  const host = { ORK_PROJETO_EXPLICITO: '1' };
  caso(casos, 'cli projetos: host com caminho', () => texto(orkComEnv(fora, amb, host, 'thread', 'list', '--projeto', loja)));
  const outra = repoComCommit('projetos-outra', '<OUTRA>', true);
  ork(outra, amb, 'init', '--name', 'outra', '--abbrev', 'out');
  caso(casos, 'cli projetos: host sem projeto pedido', () => texto(orkComEnv(fora, amb, host, 'thread', 'list')));
  const vazio = ambiente('projetos-vazio', true);
  caso(casos, 'cli projetos: host sem projeto conhecido', () => texto(orkComEnv(fora, vazio, host, 'thread', 'list')));
  const invalido = repoComCommit('projetos-invalido', '<INVALIDO>', true);
  fs.writeFileSync(path.join(invalido, 'orkastery.yaml'), 'project:\n  name: "invalido"\n  abbrev: "inv"\nverify:\n  timeout_ms: 5\n');
  caso(casos, 'cli projetos: registrar com manifesto invalido', () => texto(ork(fora, amb, 'projetos', 'registrar', invalido)));
  const segredo = repoComCommit('projetos-segredo', '<SEGREDO>', true);
  ork(segredo, amb, 'init', '--name', 'segredo', '--abbrev', 'seg');
  exec('git', ['remote', 'add', 'origin', `https://github.com/ghp_${'a1B2'.repeat(9)}/repo.git`], segredo);
  caso(casos, 'cli projetos: registrar com segredo no remoto', () => texto(ork(fora, amb, 'projetos', 'registrar', segredo)));
  fs.rmSync(outra, { recursive: true, force: true });
  caso(casos, 'cli projetos: list com projeto ausente do disco', () => texto(ork(fora, amb, 'projetos')));

  // Um registro que ja carrega segredo: a entrada nova e limpa, mas o arquivo inteiro e recusado.
  const comSegredo = ambiente('projetos-registro-segredo', true);
  fs.mkdirSync(path.join(comSegredo.casa, '.orkastery'), { recursive: true });
  fs.writeFileSync(path.join(comSegredo.casa, '.orkastery', 'projetos.json'), JSON.stringify({ contrato: 'ork.projetos/v1', atualizadoEm: T0,
    projetos: [{ nome: 'velho', abbrev: 'vel', raiz: '/srv/velho', remoto: `https://github.com/ghp_${'a1B2'.repeat(9)}/velho.git`,
      registradoEm: T0, atualizadoEm: T0, fonte: 'init' }] }));
  caso(casos, 'cli projetos: registrar com segredo no registro', () => texto(ork(fora, comSegredo, 'projetos', 'registrar', loja)));

  // O registro travado por um processo vivo (este): o init avisa e segue, o registrar recusa.
  const travado = ambiente('projetos-travado', true);
  fs.mkdirSync(path.join(travado.casa, '.orkastery'), { recursive: true });
  fs.writeFileSync(path.join(travado.casa, '.orkastery', 'projetos.json.lock'), JSON.stringify({ pid: process.pid }));
  const novo = repoComCommit('projetos-novo', '<NOVO>', true);
  caso(casos, 'cli projetos: init com o registro travado', () => texto(ork(novo, travado, 'init', '--name', 'novo', '--abbrev', 'nov')));
}

function casosDosModos(casos: Casos): void {
  caso(casos, 'modos: tabela', () => tabelaDeModos());
  caso(casos, 'ciclos: tabela', () => tabelaDeVariantes());
  const mudancas = [{ arquivo: 'orkastery.yaml', campo: 'conduction.default_mode', de: 'look', para: 'classic' },
    { arquivo: '.orkastery/setup.json', campo: 'modos.ork', de: '(bloco unico)', para: '(removido)' }];
  caso(casos, 'modos: migracao sem nada', () => textoDaMigracaoModos({ dryRun: false, mudancas: [], backup: null }));
  caso(casos, 'modos: migracao simulada', () => textoDaMigracaoModos({ dryRun: true, mudancas, backup: null } as never));
  caso(casos, 'modos: migracao aplicada', () => textoDaMigracaoModos({ dryRun: false, mudancas, backup: '.orkastery/backup/x' } as never));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoContratoDoSetup(casos);
  casosDoSetupNoCli(casos, amb);
  casosDosProjetos(casos);
  casosDosModos(casos);
}
