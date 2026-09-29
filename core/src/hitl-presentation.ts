/** D5: preparação determinística e limitada, sem delegar leitura de artefatos ao host. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirThread, lerThread } from './thread';
import { raizDoEstado } from './estado-thread';
import { lerClaims } from './claims';
import { lerLedger } from './ledger';
import { redigirSegredos } from './hitl';
import { alvoDoPedido, chaveDaEscolha, ehV2, escolhasDoPedido, expiracaoDoPedido, PedidoHitl,
  PedidoHitlQualquer, prazoDoPedido, ProfundidadeHitl, profundidadeDoModo, recomendacaoDoPedido,
  respostaAceitaDoPedido, textoDoPedido, validarPedidoHitl } from './hitl-contract';
import { Canal, CanalOferecido, ofertaDeCanais, ofertaNativa, reservaDoPedido } from './hitl-canais';
import { provenNativeOffer } from './hitl-native-offer';
import { formatarDataHoraRotulada, formatarPrazo } from './horario';
import { entradaDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';

/**
 * I-35: prazo do pedido no fuso do dono, absoluto e rotulado, para JSON de exibição
 * (`ork gate context` e `ork_hitl_pending`). `pedido.prazo` continua o ISO assinado.
 */
export function prazoLocalDoPedido(pedido: PedidoHitlQualquer, agora?: string): string {
  return formatarDataHoraRotulada(prazoDoPedido(pedido), { agora });
}

/**
 * Apresentação não altera o pedido assinado nem escolhe uma resposta pelo humano.
 *
 * I-41: as duas versões saem por aqui. O texto de um `ork.hitl/v1` continua byte a byte o de
 * antes; o que o v2 acrescenta é a consequência de cada alternativa e o porquê da recomendada,
 * e o que ele troca é o número pela letra. Um `decidido` não passa por aqui de propósito: ele
 * não tem escolha a oferecer, e montar um diálogo para um fato consumado é pedir ação por engano.
 */
export function apresentarDecisao(pedido: PedidoHitlQualquer, agora?: string, desde?: string | null): { mensagem: string; escolhas: { const: string; title: string }[] } {
  validarPedidoHitl(pedido);
  const aceita = respostaAceitaDoPedido(pedido);
  if (!aceita) throw new Error('decisão informada não tem diálogo: ela não pede nada');
  const livre = aceita.tipo === 'texto';
  const escolhas = escolhasDoPedido(pedido).map(o => ({ const: chaveDaEscolha(pedido, o.numero), title: redigirSegredos(o.texto) }));
  // RM-048 (D1): a pergunta v2 sai pelo contrato curto, o mesmo do Telegram e do lote. O v1 fica
  // byte a byte abaixo: recibo antigo continua batendo com o texto que o dono viu.
  if (ehV2(pedido) && pedido.classe === 'pergunta') {
    const curto = montarPedidoCurto(entradaDoPedido(pedido, desde ?? pedido.criadoEm),
      { quando: agora ?? new Date().toISOString(), responder: livre ? { tipo: 'texto' } : { tipo: 'dialogo' } });
    return { mensagem: textoDoPedidoCurto(curto, 'terminal'), escolhas };
  }
  const expiracao = expiracaoDoPedido(pedido);
  const linhas = [
    `Orkastery · ${pedido.fase}`,
    `• Decisão: ${redigirSegredos(textoDoPedido(pedido))}`,
    `• Recomendo: ${redigirSegredos(recomendacaoDoPedido(pedido))}`,
    ...escolhas.map(o => `  ${o.const}. ${o.title}`),
    livre ? '• Resposta: escreva sua resposta; o texto será enviado literalmente.'
      : '• Resposta: selecione uma opção no diálogo. Se necessário, digite o número.',
    ...(livre && escolhas.length ? ['  Exemplo: digitar “2” envia o texto “2”, sem selecionar a segunda opção.'] : []),
    `• Prazo: ${formatarPrazo(prazoDoPedido(pedido), { rotulo: true, agora })}. Sem resposta, ${
      expiracao === 'esperar' ? 'aguardamos' : expiracao === 'seguir-recomendada' ? 'sigo com a recomendada' : 'o pedido será escalado'}.`,
  ];
  return { mensagem: linhas.join('\n'), escolhas };
}

export interface ApresentacaoHitl {
  profundidade: ReturnType<typeof profundidadeDoModo>;
  artefato: string; claims: string; riscos: string; diff: string;
}
const limitar = (texto: string, limite: number) => {
  const seguro = redigirSegredos(texto);
  return seguro.length > limite ? seguro.slice(0, limite) + '\n[trecho limitado]' : seguro;
};

/** Somente arquivos regulares dentro do domicílio canônico; não segue link externo. */
function lerArtefato(dir: string, nome: string): string {
  const arquivo = path.join(dir, nome);
  try {
    const real = fs.realpathSync(arquivo);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) return '[artefato externo recusado]';
    const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 65536) return '[artefato indisponível ou acima de 64 KiB]';
      return fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/**
 * D1/T6: a profundidade vem do PEDIDO quando ha um; o modo so da o default.
 *
 * Antes, o bloco de evidencia era escolhido pelo modo da thread, e nem o emissor nem o dono
 * tinham como pedir mais evidencia para uma pergunta que precisava dela. Quem chama passa a
 * profundidade do pedido aberto; sem pedido, o default do modo continua valendo exatamente como
 * antes, e e por isso que nenhuma superficie que nao conhece pedido muda de comportamento.
 */
export function apresentarHitl(raiz: string, id: string, profundidadeDoPedido?: ProfundidadeHitl): ApresentacaoHitl {
  const t = lerThread(raiz, id), profundidade = profundidadeDoPedido ?? profundidadeDoModo(t.modo);
  const dir = dirThread(raiz, id);
  const artefato = lerArtefato(dir, `${t.faseAtual}.md`) || lerArtefato(dir, `${t.faseAtual.toLowerCase()}.md`);
  const claims = lerClaims(raiz, id).slice(0, 20).map(c => `${c.id}: ${c.estado}; ${c.alegacao}; verify: ${c.verificar.join(' && ')}`).join('\n');
  const riscos = artefato.split('\n').filter(l => /risco|limita[cç][aã]o|pend[eê]n|bloque|n[aã]o comprovad/i.test(l)).join('\n');
  let diff = '[diff indisponível]';
  const cwd = t.worktree || raiz;
  try {
    if (raizDoEstado(cwd) === raizDoEstado(raiz) && /^[a-f0-9]{40}$/.test(t.base.commit)) {
      const r = spawnSync('git', ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv',
        ...(profundidade === 'profunda' ? ['--unified=2'] : ['--stat']), t.base.commit, 'HEAD', '--',
        'core/src', 'adapters', 'scripts', 'docs', 'eval'], { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024 });
      if (r.status === 0) diff = r.stdout || '[sem diff de produto]';
    }
  } catch { /* falha de consulta permanece explícita */ }
  return { profundidade, artefato: profundidade === 'resumo' ? '' : limitar(artefato || '[artefato ausente]', profundidade === 'profunda' ? 1200 : 500),
    claims: limitar(claims || '[claims ausentes]', profundidade === 'resumo' ? 250 : 600),
    riscos: limitar(riscos || '[riscos não descritos no artefato]', 350),
    diff: profundidade === 'resumo' ? '' : limitar(diff, profundidade === 'profunda' ? 800 : 350) };
}

/** Leitura pura: nunca cria pedido ou aprovação durante uma consulta do pulse. */
export function pedidoHitlAberto(raiz: string, id: string, fase: string | null, sessionId: string | null): PedidoHitlQualquer | undefined {
  const eventos = lerLedger(dirThread(raiz, id));
  const ultimoDespacho = eventos.filter(e => e.tipo === 'phase_dispatch').at(-1)?.ts ?? '';
  for (const e of [...eventos].reverse()) {
    if (e.tipo !== 'hitl_requested' || e.ts < ultimoDespacho) continue;
    try {
      // I-41 (T4): as duas versoes sao oferecidas, e `decidido` NUNCA. Um fato consumado nao
      // segura fase, nao tem caminho de resposta e nao pode aparecer como coisa a responder;
      // `alvoDoPedido` devolve `undefined` para ele, e a linha abaixo o descarta por isso.
      validarPedidoHitl(e.pedido);
      const p = e.pedido;
      const alvo = alvoDoPedido(p);
      if (!alvo) continue;
      if (p.fase !== fase || (sessionId ? alvo.tipo !== 'session' || alvo.sessionId !== sessionId : alvo.tipo !== 'gate')) continue;
      if (!eventos.some(r => ['human_gate', 'session_answered'].includes(r.tipo) && r.pedidoId === p.id)) return p;
    } catch { /* pedido inválido não é oferecido como resposta */ }
  }
  return undefined;
}

/**
 * FX6: a oferta de canais que acompanha um pedido HITL REAL.
 *
 * `ofertaDeCanais` existia desde D12 e era chamada de um lugar so: o canario. No caminho de
 * producao o humano via a pergunta e um `comandoResposta`, e nada dizia por quais canais dava
 * para responder AGORA nem por que os outros nao serviam. Uma oferta que so aparece em
 * simulacao nao e oferta; e uma tabela bonita, como a propria narrativa de D12 admitia.
 *
 * As pre-condicoes sao reais e lidas na hora: as variaveis de cada canal saem do ambiente do
 * processo que esta respondendo a consulta, e `conexoesMcp` traz apenas os hosts com conexao
 * MCP viva conhecida por quem chama. O Pulse, que roda em cron e nao e uma conexao MCP,
 * passa a lista vazia de proposito: dizer `disponivel` ali seria inventar uma conexao.
 */
export function ofertaDoPedido(pedido: PedidoHitlQualquer, conexoesMcp: readonly Canal[] = [],
  nativo?: { callback: unknown; raiz: string }): readonly CanalOferecido[] {
  validarPedidoHitl(pedido);
  const channels = ofertaDeCanais({ env: process.env as Record<string, string | undefined>, conexoesMcp });
  if (nativo === undefined) return channels;
  const proved = provenNativeOffer(pedido, nativo.callback);
  // Reserva lida na hora da oferta: callback provada não anuncia canal que o ingresso recusaria.
  // Ledger sem este pedido não prova ausência de reserva.
  let reserva: string;
  try {
    const eventos = lerLedger(dirThread(nativo.raiz, pedido.thread));
    reserva = eventos.some(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === pedido.id)
      ? reservaDoPedido(eventos, pedido.id) : 'hitl.channel.unverified';
  } catch { reserva = 'hitl.channel.unverified'; }
  return [...channels, ...(['hermes', 'openclaw'] as const).map(host => {
    const oferta = ofertaNativa(host, proved === host);
    return oferta.estado === 'disponivel' && reserva ? { ...oferta, estado: 'indisponivel' as const, motivo: reserva } : oferta;
  })];
}
