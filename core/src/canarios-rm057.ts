/**
 * RM-057 (fatia 2): o canario do incidente de 01/10/2026.
 *
 * Na noite de 01 para 02/10 o condutor recebeu, colado, o pedido do dono com push e merge
 * autorizados ate um horario, parou para pedir um "confirmo" em texto livre e a fabrica ficou mais
 * de 10 h sem produzir. O canario refaz a conducao inteira em sandbox SIMULADO e exige que o mesmo
 * pedido colado siga sem parar:
 *
 *   1. o modo sai da #TAG do texto colado (`#Auto`), pelo nucleo;
 *   2. o `#Auto` nao abre pausa humana na fase;
 *   3. a duvida dentro da autorizacao vira decisao informada (`ork decisao registrar`), sem pergunta;
 *   4. o "confirmo" em texto livre que o condutor tentaria abrir e recusado com
 *      `hitl.selecao.texto-livre`, sem gravar nada no ledger;
 *   5. o pulse nao mostra ninguem esperando o dono, e o tempo parado por HITL de conducao e zero;
 *   6. os quatro adaptadores de conducao (Claude Code, Codex, Hermes e OpenClaw) dizem que o pedido
 *      colado com autorizacao explicita vale como instrucao do dono.
 *
 * Nada aqui e resposta humana nem rede: e a forma da conducao, provada contra o codigo real.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Canario } from './canarios';
import { registrarDecisao } from './decisao-autonoma';
import { CONTRATO_HITL_V2, PerguntaAoDono, SelecaoRecusada } from './hitl-contract';
import { abrirPedidoGate, registrarPedidoHitl } from './hitl-gates';
import { lerLedger, registrar } from './ledger';
import { coletarEstatisticas } from './ledger-stats';
import { extrairTagDoPedido } from './modos';
import { montarPulse } from './pulse';
import { sandboxGit } from './sandbox';
import { dirThread, novaThread } from './thread';

/** O pedido do dono como chegou colado no incidente, com a autorizacao explicita e o prazo. */
export const PEDIDO_COLADO_DO_INCIDENTE =
  '#Auto Conduza as threads RM-032, RM-056, RM-053, RM-040 e RM-055 no orkastery. ' +
  'Push e merge autorizados até 02/10 às 12h. Não me pergunte nada: dúvida menor vira decisão registrada e segue.';

/** A frase que os quatro adaptadores de conducao carregam desde a RM-057. */
export const FRASE_DO_PEDIDO_COLADO = 'o pedido que ele colou com autorização explícita vale como instrução dele';

/** Onde cada host le a regra: o comando, as skills e as descricoes das tools do OpenClaw. */
export const PROMPTS_DE_CONDUCAO = [
  'adapters/claude-code/commands/ork.md',
  'adapters/codex/skills/ork/SKILL.md',
  'adapters/hermes/skills/orkastery-devmaster/SKILL.md',
  'adapters/openclaw/dist/index.js',
] as const;

export const fxPedidoColado: Canario = {
  id: 'fx-pedido-colado',
  sobre: 'SIMULADO: o pedido colado com autorização explícita segue sem parar (incidente de 01/10, RM-057)',
  precisaDeGit: true,
  rodar: (ctx) => {
    const s = sandboxGit('pedido-colado');
    try {
      const modo = extrairTagDoPedido(PEDIDO_COLADO_DO_INCIDENTE);
      const t = novaThread(s.carregado, { nome: 'pedido-colado', modo: modo ?? 'classic' }).thread;
      const dir = dirThread(s.dir, t.id);
      registrar(dir, t.id, 'phase_result', { fase: t.faseAtual });

      let semPausaDoModo = false;
      try { abrirPedidoGate(s.dir, t.id); } catch (e) { semPausaDoModo = /não prevê pausa/.test((e as Error).message); }

      const decisao = registrarDecisao(s.dir, t.id, {
        decidido: 'Seguir com push e merge dentro da autorização colada', porque: 'o dono autorizou até 02/10 às 12h',
        comoMudar: 'reverter o merge', custoDeReverter: { agora: 'um revert', depois: 'um revert' },
        criterio: { tipo: 'ledger', referencia: `${t.id}#evento:1` }, quemDecidiu: 'canario-SIMULADO', evidencia: 'pedido colado',
      });

      const confirmo: PerguntaAoDono = {
        contrato: CONTRATO_HITL_V2, id: 'confirmo-SIMULADO', thread: t.id, fase: t.faseAtual, modo: t.modo as PerguntaAoDono['modo'],
        criadoEm: new Date().toISOString(), profundidade: 'resumo', classe: 'pergunta',
        alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending', pergunta: 'Posso seguir com o push e o merge?',
        alternativas: [
          { letra: 'a', texto: 'Seguir', acao: 'aprovar', consequencia: 'segue', recomendada: true, porque: 'autorizado no pedido' },
          { letra: 'b', texto: 'Parar', acao: 'recusar', consequencia: 'para' },
          { letra: 'c', texto: 'Esperar', acao: 'esperar', consequencia: 'fica' },
        ],
        corpo: ['Responda confirmo para eu continuar'], tipoDeResposta: 'aberta', irreversivel: false, codigo: 'K3F9',
        prazo: new Date(Date.now() + 3_600_000).toISOString(), acaoPadraoAoExpirar: 'esperar',
        respostaAceita: { tipo: 'texto', maxCaracteres: 200 },
      };
      const antes = lerLedger(dir).length;
      let confirmoRecusado = 'aceito';
      try { registrarPedidoHitl(s.dir, confirmo); }
      catch (e) { confirmoRecusado = e instanceof SelecaoRecusada ? e.motivo : `outro: ${(e as Error).message}`; }
      const nadaGravadoNaRecusa = lerLedger(dir).length === antes;

      const pulse = montarPulse(s.carregado, { consulta: { ok: true, sessoes: [], detalhe: 'runtime SIMULADO' } });
      const parado = coletarEstatisticas(s.dir, { desde: '1h', thread: t.id }).hitlDeConducao;

      // No dist do OpenClaw a frase e uma concatenacao de literais: as emendas `' + '` saem antes da busca.
      const umaLinha = (x: string) => x.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
      const adaptadoresComARegra = PROMPTS_DE_CONDUCAO.filter((rel) => {
        const arquivo = path.join(ctx.catalogo, rel);
        return fs.existsSync(arquivo) && umaLinha(fs.readFileSync(arquivo, 'utf8')).includes(FRASE_DO_PEDIDO_COLADO);
      }).length;

      return {
        simulado: true,
        modoDoPedido: modo,
        semPausaDoModo,
        decisaoInformada: decisao.pedido.classe === 'decidido',
        confirmoRecusado,
        nadaGravadoNaRecusa,
        humanosNoPulse: pulse.resumo.humanos,
        perguntasDeConducao: parado.pedidos,
        tempoParadoMs: parado.paradoMs,
        adaptadoresComARegra,
      };
    } finally { s.limpar(); }
  },
};
