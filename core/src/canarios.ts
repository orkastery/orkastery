/**
 * Os 7 canarios de `ork eval` (6 do bloco B4 + fx-codex-dry da homologacao do codex).
 *
 * Canario nao e teste unitario: e um comportamento inteiro do produto, exercitado ponta a
 * ponta contra git de verdade, que precisa continuar acontecendo depois de qualquer mudanca.
 * Cada um nasce de um jeito conhecido de o trabalho de um agente parecer certo e nao ser:
 *
 *   fx-happy         o ciclo que funciona, para o eval nao provar so o que quebra
 *   fx-hallucination arquivo citado que nao existe: a alegacao reprova na reexecucao
 *   fx-stale-base    a base andou embaixo da thread e o `ork` percebe antes do merge
 *   fx-wiki-destroy  comando destrutivo em massa barrado pelo guard e pela policy
 *   fx-schema-drift  o contrato congelado do MASTER log recusa mutacao
 *   fx-concurrency   duas threads na mesma regiao: a segunda entra na fila, nao escreve
 *
 * A DIVISAO DE TRABALHO E DELIBERADA: o executor aqui e codigo tipado, e o que se espera dele
 * e dado versionado em `eval/fixtures/<id>/caso.json`. Assim a expectativa e revisavel por
 * quem nao le TypeScript, e mudar o comportamento esperado e um diff que aparece na revisao.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from './claims';
import { adquirirRegiao } from './leases';
import { validarMasterLog } from './master';
import { avaliarPolicies, bloqueantes } from './policies';
import { rodarFase } from './phase';
import { editarBloco } from './setup';
import { commitar, gitDisponivel, sandboxGit } from './sandbox';
import { novaThread, listarIds, lerThread, dirThread } from './thread';
import { verificar } from './verify';
import { auditarWorktree, garantirWorktree } from './worktree';
import { CANARIOS_PULSE } from './canarios-pulse';
import { CANARIO_SENSORES } from './canarios-sensores';
import { CANARIOS_HITL } from './canarios-hitl';
import { CANARIOS_I43 } from './canarios-i43';
import { createObjective, reviseObjective } from './objective';
import { discoverMaestro } from './maestro-discovery';
import { readMaestro, runMaestroCli } from './maestro-cli';
import { performMaestroAction } from './maestro-actions';
import { lerLedger } from './ledger';

/** O que um canario observou no mundo real, comparado depois com o `esperado` da fixture. */
export type Observado = Record<string, unknown>;

export interface Canario {
  id: string;
  sobre: string;
  /** `git` e obrigatorio? Sem ele o canario sai `unavailable`, nunca `passing`. */
  precisaDeGit: boolean;
  rodar: (ctx: ContextoDeCanario) => Observado;
}

export interface ContextoDeCanario {
  /** Raiz do catalogo do produto, para os canarios que exercitam arquivo do produto. */
  catalogo: string;
}

function comSandbox<T>(nome: string, fn: (s: ReturnType<typeof sandboxGit>) => T): T {
  const s = sandboxGit(nome);
  try {
    return fn(s);
  } finally {
    s.limpar();
  }
}

/** fx-happy: o ciclo que funciona, do `thread new` ao `verify` verde. */
const fxHappy: Canario = {
  id: 'fx-happy',
  sobre: 'thread aberta, fase montada com prompt gravado e claim verificada no HEAD real',
  precisaDeGit: true,
  rodar: () =>
    comSandbox('happy', (s) => {
      const { thread } = novaThread(s.carregado, { nome: 'checkout', modo: 'classic' });
      const corrida = rodarFase(s.carregado, thread.id, {
        fase: 'GOAL',
        prompt: 'Mapear o objetivo do checkout',
        dryRun: true,
      });
      adicionarClaim(s.dir, thread.id, {
        arquivo: 'README.md',
        alegacao: 'o README do projeto existe e esta versionado',
        verificar: ['test -f README.md'],
        fase: 'GOAL',
      });
      const v = verificar(s.carregado, thread.id, { soClaims: true });
      return {
        slug: thread.slug,
        modo: thread.modo,
        pausas: thread.blocos.filter((b) => b.pausa).length,
        promptGravado: fs.existsSync(corrida.promptPath),
        promptSha256Hex: /^[0-9a-f]{64}$/.test(corrida.promptSha256),
        despachoBloqueado: corrida.bloqueado,
        verifyOk: v.ok,
        motivos: v.motivos,
      };
    }),
};

/** fx-hallucination: a citacao sem lastro reprova na reexecucao, com motivo tipado. */
const fxHallucination: Canario = {
  id: 'fx-hallucination',
  sobre: 'arquivo e teste citados pelo agente que nao existem no repositorio',
  precisaDeGit: true,
  rodar: () =>
    comSandbox('hallucination', (s) => {
      const { thread } = novaThread(s.carregado, { nome: 'alucinada', modo: 'auto' });
      adicionarClaim(s.dir, thread.id, {
        arquivo: 'src/pagamentos.ts',
        alegacao: 'implementei src/pagamentos.ts e o teste de pagamento passa',
        verificar: ['test -f src/pagamentos.ts'],
        fase: 'GO',
      });
      adicionarClaim(s.dir, thread.id, {
        arquivo: 'README.md',
        alegacao: 'nao existe nenhum TODO em lugar nenhum do repositorio',
        fase: 'GO',
      });
      const v = verificar(s.carregado, thread.id, { soClaims: true });
      return {
        // O modo mais autonomo do espectro nao afrouxa a verificacao: `#Auto` reprova igual.
        modo: thread.modo,
        verifyOk: v.ok,
        motivos: [...new Set(v.motivos)].sort(),
        claimsReprovadas: v.claims.filter((c) => !c.verificado).length,
      };
    }),
};

/** fx-stale-base: a base andou embaixo da thread e o `ork` percebe antes do merge. */
const fxStaleBase: Canario = {
  id: 'fx-stale-base',
  sobre: 'a branch base avancou depois de a thread carimbar a sua base',
  precisaDeGit: true,
  rodar: () =>
    comSandbox('stalebase', (s) => {
      const { thread } = novaThread(s.carregado, {
        nome: 'baseandou',
        modo: 'classic',
        criarWorktree: true,
      });
      garantirWorktree(s.carregado, thread.id);
      const antes = auditarWorktree(s.carregado, thread.id);
      commitar(s.dir, 'MUDOU.md', '# a base andou\n', 'commit na base depois da thread');
      const depois = auditarWorktree(s.carregado, thread.id);
      const checkBase = depois.checks.find((c) => c.nome === 'base');
      return {
        auditavaAntes: antes.ok,
        auditaDepois: depois.ok,
        checkDaBase: checkBase ? checkBase.nivel : 'ausente',
        correcao: checkBase?.correcao ?? '',
      };
    }),
};

/** fx-wiki-destroy: comando destrutivo em massa barrado no host e na entrega. */
const fxWikiDestroy: Canario = {
  id: 'fx-wiki-destroy',
  sobre: 'agente tenta apagar trabalho alheio em massa, no host e na entrega',
  precisaDeGit: false,
  rodar: (ctx) => {
    const guard = path.join(ctx.catalogo, 'adapters', 'claude-code', 'hooks', 'ork-guard.js');
    const decidir = (comando: string): { decisao: string; codigo: number } => {
      const entrada = JSON.stringify({ tool_name: 'Bash', tool_input: { command: comando } });
      try {
        const saida = execFileSync(process.execPath, [guard], {
          input: entrada,
          encoding: 'utf8',
          // stderr capturado: o guard fala com o host, nao com a saida do `ork eval`.
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { decisao: JSON.parse(saida).hookSpecificOutput.permissionDecision, codigo: 0 };
      } catch (e) {
        const erro = e as { status?: number; stdout?: string };
        const saida = JSON.parse(erro.stdout ?? '{}') as {
          hookSpecificOutput?: { permissionDecision?: string };
        };
        return {
          decisao: saida.hookSpecificOutput?.permissionDecision ?? 'sem-decisao',
          codigo: erro.status ?? -1,
        };
      }
    };

    // A outra metade do canario: a policy bloqueante do nucleo, que reprova entregar em cima
    // da propria base. Guard do host e policy do nucleo sao defesas independentes de proposito.
    const manifesto = {
      runtime: { provider_policy: 'subscription-only' },
      policies: { push_direto_na_base: 'block' },
    } as unknown as Parameters<typeof avaliarPolicies>[0];
    const violacoes = avaliarPolicies(manifesto, {
      gate: 'ship',
      de: 'main',
      para: 'main',
      baseBranch: 'main',
    });

    return {
      gitAddEmMassa: decidir('git add -A').decisao,
      codigoDoGitAdd: decidir('git add -A').codigo,
      removeRecursivo: decidir('rm -rf $ALVO/').decisao,
      resetDestrutivo: decidir('git reset --hard origin/main').decisao,
      forcePush: decidir('git push --force origin main').decisao,
      comandoDoOrkPassa: decidir('ork ship ork-x --para main').decisao,
      addNomeadoPassa: decidir('git add -- src/pagamentos.ts').decisao,
      policyDoShipBloqueia: bloqueantes(violacoes).length,
    };
  },
};

/** fx-schema-drift: o contrato congelado do MASTER log recusa mutacao. */
const fxSchemaDrift: Canario = {
  id: 'fx-schema-drift',
  sobre: 'MASTER log com contrato, escala ou catalogo de classes alterados',
  precisaDeGit: false,
  rodar: (ctx) => {
    const caminho = path.join(ctx.catalogo, 'eval', 'fixtures', 'b2-master-log', 'caso.json');
    const fixture = JSON.parse(fs.readFileSync(caminho, 'utf8')) as {
      valido: Record<string, unknown>;
    };
    const erroDe = (mudanca: Record<string, unknown>): number =>
      validarMasterLog({ ...fixture.valido, ...mudanca }).length;
    return {
      validoPassa: validarMasterLog(fixture.valido).length === 0,
      contratoTrocado: erroDe({ contrato: 'ork.master-log/v2' }) > 0,
      scoreForaDaEscala: erroDe({ score: 7 }) > 0,
      classeInventada: erroDe({ classesDeFalha: ['quase-deu-certo'] }) > 0,
      faseForaDoCiclo: erroDe({ fases: ['GOAL', 'F7'] }) > 0,
      justificativaVazia: erroDe({ justificativa: '' }) > 0,
      evidenciaAusente: erroDe({ evidencia: { eventos: 0 } }) > 0,
    };
  },
};

/** fx-concurrency: duas threads na mesma regiao, a segunda entra na fila. */
const fxConcurrency: Canario = {
  id: 'fx-concurrency',
  sobre: 'duas threads pedindo regiao que se cruza, com fila FIFO em vez de escrita por cima',
  precisaDeGit: true,
  rodar: () =>
    comSandbox('concurrency', (s) => {
      const a = novaThread(s.carregado, { nome: 'primeira', modo: 'classic' }).thread;
      const b = novaThread(s.carregado, { nome: 'segunda', modo: 'maestro' }).thread;
      const pedidoA = adquirirRegiao(s.dir, 'path:core/src/**', {
        thread: a.id,
        motivo: 'GO da primeira',
      });
      const pedidoB = adquirirRegiao(s.dir, 'path:core/src/board.ts', {
        thread: b.id,
        motivo: 'GO da segunda',
      });
      return {
        primeiraAdquiriu: pedidoA.ok,
        segundaAdquiriu: pedidoB.ok,
        segundaNaFila: pedidoB.esperando,
        posicaoDaSegunda: pedidoB.posicaoNaFila,
        motivoDaSegunda: pedidoB.motivo,
        colidiuComAThread: pedidoB.colidiuCom ? pedidoB.colidiuCom.thread : null,
        threadDaPrimeira: a.id,
      };
    }),
};

/**
 * fx-codex-dry: o runtime codex despacha pelo caminho real do setup, sem rede.
 *
 * Nasce da homologacao do segundo runtime (thread ork-homologarcod): um `setup.json`
 * apontando o bloco para o codex tem de mudar o COMANDO que o despacho monta, e o
 * default sem setup tem de continuar saindo pelo claude-bg byte a byte (paridade sem
 * downgrade). Tudo em dry-run: canario nao gasta assinatura de ninguem.
 */
const fxCodexDry: Canario = {
  id: 'fx-codex-dry',
  sobre: 'setup do bloco levando o despacho ao codex, com o claude-bg intacto como padrao',
  precisaDeGit: true,
  rodar: () =>
    comSandbox('codex-dry', (s) => {
      const padrao = novaThread(s.carregado, { nome: 'entrega padrao', modo: 'auto' }).thread;
      const semSetup = rodarFase(s.carregado, padrao.id, {
        fase: 'GOAL',
        prompt: 'Mapear o objetivo',
        dryRun: true,
      });

      editarBloco(s.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' });
      const custom = novaThread(s.carregado, { nome: 'entrega codex', modo: 'auto' }).thread;
      const comSetup = rodarFase(s.carregado, custom.id, {
        fase: 'GOAL',
        prompt: 'Mapear o objetivo',
        dryRun: true,
      });

      return {
        padraoRuntime: semSetup.runtime,
        padraoComando: semSetup.comando[0],
        codexRuntime: comSetup.runtime,
        codexComando: comSetup.comando.slice(0, 2).join(' '),
        codexModel: comSetup.model,
        codexEffort: comSetup.effort,
        codexHeadless: comSetup.comando[1] === 'app-server' && comSetup.comando.includes('--listen') && comSetup.comando.includes('stdio://'),
        nadaDespachado: semSetup.dryRun && comSetup.dryRun,
      };
    }),
};

/** fx-objective-oscillation: revisões repetidas pausam o objetivo em vez de rodar para sempre. */
const fxObjectiveOscillation: Canario = {
  id: 'fx-objective-oscillation',
  sobre: 'Objective Envelope revisado três vezes aciona a guarda de oscilação',
  precisaDeGit: true,
  rodar: () => comSandbox('objective-oscillation', (s) => {
    let objective = createObjective(s.carregado, { title: 'checkout premium', request: 'entregar valor', doneWhen: ['prova verde'] });
    for (let revision = 1; revision <= 3; revision++) objective = reviseObjective(s.dir, objective.id, `entregar valor v${revision}`);
    return {
      threads: objective.threads.length,
      revisions: objective.revisions,
      state: objective.status,
      reason: objective.pauseReason,
      history: objective.envelopeHistory.length,
      currentVersion: objective.envelope.version,
    };
  }),
};

/** Projeto temporário real; nenhum host/humano real é simulado como ativação live. */
const fxMaestroBootstrap: Canario = {
  id: 'fx-maestro-bootstrap',
  sobre: 'SIMULADO: consulta limpa, ação com readback e policy block no modo Auto',
  precisaDeGit: true,
  rodar: () => comSandbox('maestro-bootstrap', s => {
    const before = listarIds(s.dir).length;
    let raw = '';
    const exit = runMaestroCli(['--json'], s.dir, {}, { out: v => { raw = v; }, err: () => {} });
    const clean = JSON.parse(raw);
    const createsThread = listarIds(s.dir).length !== before;
    const t = novaThread(s.carregado, { nome: 'Canário Maestro', modo: 'auto' }).thread;
    const context = discoverMaestro({ cwd: s.dir });
    const snapshot = () => readMaestro(context, { host: { tools: ['ork_thread_status', 'ork_phase_run'], child: true } });
    const state = snapshot();
    let calls = 0;
    const result = performMaestroAction(context, { id: `thread.status:${t.id}`, expectedFingerprint: state.fingerprint }, {
      snapshot, receipts: () => null, readback: id => lerThread(s.dir, id),
      operations: { 'thread.status': id => { calls++; return lerThread(s.dir, id); } },
    });
    // A policy real corre antes do despacho e não grava o prompt sensível.
    s.carregado.manifesto.policies = { segredo_em_prompt: 'block' };
    const blocked = rodarFase(s.carregado, t.id, { fase: 'GOAL', dryRun: true,
      prompt: 'FIXTURE sintética ' + 'sk-ant-' + 'x'.repeat(24) });
    const event = lerLedger(dirThread(s.dir, t.id)).find(e => e.tipo === 'gate_blocked' && e.motivo === 'policy.violation');
    return {
      simulado: true, contract: clean.schema, queryExit: exit, createsThread,
      childRedispatch: state.sections.nextActions.items.some(i => i.action?.operation === 'phase' && i.action.available),
      actionCalls: calls, readbackMatches: (result.readback as typeof t).id === t.id && (result.receipt as typeof t).id === t.id,
      autoPolicyBlocked: blocked.bloqueado && blocked.motivo === 'policy.violation' && !!event?.reprovaEmTodoModo,
      noDispatch: !lerLedger(dirThread(s.dir, t.id)).some(e => e.tipo === 'phase_dispatch'),
      promptNotWritten: !fs.existsSync(blocked.promptPath),
    };
  }),
};

/** Os canarios registrados, na ordem em que o `ork eval` os roda. */
export const CANARIOS: readonly Canario[] = [
  fxHappy,
  fxHallucination,
  fxStaleBase,
  fxWikiDestroy,
  fxSchemaDrift,
  fxConcurrency,
  fxCodexDry,
  fxObjectiveOscillation,
  fxMaestroBootstrap,
  ...CANARIOS_PULSE,
  CANARIO_SENSORES,
  ...CANARIOS_HITL,
  ...CANARIOS_I43,
];

/** Um canario por id, ou null quando a fixture aponta para um canario que nao existe. */
export function canarioPorId(id: string): Canario | null {
  return CANARIOS.find((c) => c.id === id) ?? null;
}

export { gitDisponivel };
