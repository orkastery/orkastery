/**
 * RM-057 (resposta curta, D4 da ork-rm057respost): a pergunta do arco #Noctum no canal do dono.
 *
 * A pergunta sai pelo transporte do pulse (`.orkastery/monitor/pulse-host.json`, local, fora do git), o mesmo canal que o
 * onboarding grava para o dono, e entra no lote servido com número: o dono responde "a" ou "sim" em reply, "<código> a"
 * de qualquer chat autorizado, a palavra solta no chat em que ela saiu, ou o número com a letra ("1a"). Sem transporte, a
 * pergunta fica só no terminal de quem propôs. O registro só acontece com o recibo do transporte.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { PerguntaDoArco, textoDaPerguntaDoArco } from './noctum-pergunta';
import { entregarPeloTransporte } from './pulse-delivery';
import { PerguntaDoArcoServida, servirPerguntaDoArco } from './pulse-resposta';
import { hostDoTransporte, TransportePulse } from './transporte-do-canal';

export interface EntregaDaPerguntaDoArco extends PerguntaDoArcoServida {
  /** O que aconteceu, em uma linha, sem caminho de máquina. */
  detalhe: string;
}

/**
 * RM-057 (resposta curta, D9 da ork-rm057respost): como o dono responde à pergunta do arco, sem linha para copiar. O
 * `/ork noctum <arco> autorizar <sha256>` dos gateways segue aceito, mas não é mais ensinado.
 */
export function comoResponderAoArco(p: PerguntaDoArco): string[] {
  const ato = p.ato === 'autorizar' ? 'autoriza' : 'revoga';
  // GO-FIX 1 (achados 1 e 2): o reply vale só para a mensagem da pergunta, e o terminal só grava o que o Claude Code diz
  // que o dono digitou; o texto ensina o que de fato vale.
  return [`Em reply à mensagem da pergunta ${p.codigo} no Telegram, responda com a letra (a ${ato}; b e c não mudam nada)`,
    `De qualquer chat autorizado do Telegram, mande ${p.codigo} a`,
    `No terminal do Claude Code, ${p.codigo} a vale quando o Claude Code marca o prompt como digitado por você (o campo source do evento)`,
    p.ato === 'autorizar' ? `No host com diálogo nativo: a ferramenta ork_noctum_autorizar com o arco ${p.arco}`
      : `No host com diálogo nativo: a ferramenta ork_noctum_revogar com o arco ${p.arco}`];
}

const semEntrega = (detalhe: string): EntregaDaPerguntaDoArco =>
  ({ numero: null, entregue: false, jaServida: false, host: null, destino: null, mensagens: [], detalhe });

/** Entrega a pergunta ao canal do dono, uma vez, com o número no título; a mesma pergunta em aberto não sai de novo. */
export function entregarPerguntaDoArco(raiz: string, p: PerguntaDoArco, opcoes: { quando?: string; estadoDir?: string } = {}): EntregaDaPerguntaDoArco {
  const quando = opcoes.quando ?? new Date().toISOString();
  const dir = opcoes.estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor');
  const arquivo = path.join(dir, 'pulse-host.json');
  if (!fs.existsSync(arquivo)) return semEntrega('sem transporte do canal (pulse-host.json): a pergunta fica no terminal');
  let config: TransportePulse;
  try { config = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as TransportePulse; }
  catch { return semEntrega('o transporte do canal não se lê'); }
  const destinoDo = (host: string | null): string | null => host === null ? null
    : [config, ...(Array.isArray(config.alternativos) ? config.alternativos : [])].find(t => hostDoTransporte(t) === host)?.destino ?? null;
  try {
    const r = servirPerguntaDoArco(raiz, p, { quando, estadoDir: dir, entregar: numero => {
      const e = entregarPeloTransporte(raiz, textoDaPerguntaDoArco(p, 'telegram', { quando, numero }), { dir, oQue: 'noctum-pergunta', quando });
      // GO-FIX 1 (achado 2): os ids da mensagem entregue prendem o reply do dono a ESTA mensagem, e a nenhuma outra.
      return { ok: e.ok, host: e.host, destino: destinoDo(e.host), mensagens: e.mensagens };
    } });
    return { ...r, detalhe: r.entregue ? `entregue pelo ${r.host}` : r.jaServida ? `já tinha saído como a pergunta ${r.numero}`
      : 'o transporte do canal não confirmou a entrega' };
  } catch (e) {
    return semEntrega(`não consegui entregar a pergunta: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
