/**
 * RM-063 (F6): ociosidade e alerta.
 *
 * Pedido do dono de 12/10/2026: "Você não pode deixar a máquina parada sem me avisar." No maquina-b, de 03 a 12/10, a
 * maquina ficou dias sem sessao viva com item do roadmap reservado para ela, e nenhum canal disse nada. Aqui mora a
 * leitura que faz disso um alerta: a maquina esta ociosa quando o projeto tem vaga livre (as vagas ocupadas, pela mesma
 * regra do portao de vaga do despacho, abaixo de `concurrency.max_parallel_threads`) e ha trabalho reservado para ela no
 * roadmap (`ork/roadmap-reservas`) que ninguem trabalha agora. O alerta leva as proximas threads sugeridas, ate o numero
 * de vagas livres, cada uma com o passo do condutor do nucleo e o comando.
 *
 * Leitura pura: as reservas vem da ultima copia local da branch de reservas (sem rede), e quem dedupe o alerta por
 * episodio e a varredura (`pulse-delivery`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sessoesQueOcupam } from './board';
import { conducaoDaThread } from './conducao';
import { passosDoCondutor, PassoDoCondutor } from './conducao-sentinela';
import { raizDoEstado } from './estado-thread';
import { lerLedger } from './ledger';
import { textoDoCatalogo } from './locale';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { arcoDoPasso, guardaOsCaminhosManuais, lerArcosDaRaiz } from './noctum-guarda';
import { pendenciaDoDono } from './parado-no-condutor';
import { ReservaDeItem, reservasLocais } from './roadmap-reservas';
import { dirThread, lerThread, listarIds } from './thread';
import { Thread } from './types';

/** Uma proxima thread sugerida: o item reservado, a thread dele (quando ha) e o passo com o comando. */
export interface SugestaoDeTrabalho {
  item: string;
  titulo: string | null;
  thread: string | null;
  fase: string | null;
  /** O que fazer, em linguagem simples. */
  passo: string;
  comando: string;
}

export interface MaquinaOciosa {
  maquina: string;
  limite: number;
  ocupadas: number;
  livres: number;
  /** Os itens reservados para esta maquina que ninguem trabalha agora. */
  reservados: number;
  /** As proximas threads sugeridas, ate o numero de vagas livres. */
  sugeridas: SugestaoDeTrabalho[];
  /** De onde vieram as reservas. */
  fonte: string;
}

export interface OpcoesDaOciosidade {
  quando?: string;
  maquina?: string;
  /** As reservas; sem a opcao, a ultima copia local da branch de reservas do remoto do manifesto. */
  reservas?: () => readonly ReservaDeItem[];
  /** As vagas ocupadas; sem a opcao, o portao de vaga do despacho (`sessoesQueOcupam`). */
  ocupadas?: () => number;
  /** O passo do condutor de cada thread; sem a opcao, o do nucleo (`passosDoCondutor`). */
  passos?: () => readonly PassoDoCondutor[];
}

const ITEM = /^RM-\d{3}$/;

/** O titulo do item, do frontmatter da pagina dele em `docs/roadmap/` (`null` sem a pagina). */
function tituloDoItem(raiz: string, item: string): string | null {
  const dir = path.join(raiz, 'docs', 'roadmap');
  let arquivo: string | undefined;
  try { arquivo = fs.readdirSync(dir).find((f) => f.startsWith(`${item}-`) && f.endsWith('.md')); } catch { return null; }
  if (!arquivo) return null;
  let texto: string;
  try { texto = fs.readFileSync(path.join(dir, arquivo), 'utf8').slice(0, 8192); } catch { return null; }
  const m = /^titulo:\s*(.+)$/m.exec(texto);
  return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\p{Cc}/gu, ' ').slice(0, 120) || null : null;
}

/** A thread que trabalha o item: a da reserva, quando existe aqui; senao a aberta mais recente do item. */
function threadDoItem(threads: readonly Thread[], r: ReservaDeItem): Thread | null {
  const daReserva = r.thread ? threads.find((t) => t.id === r.thread) ?? null : null;
  if (daReserva) return daReserva;
  return threads.filter((t) => t.roadmap === r.item && t.status !== 'fechada')
    .sort((a, b) => String(b.atualizadaEm ?? '').localeCompare(String(a.atualizadaEm ?? '')))[0] ?? null;
}

/** O passo do condutor de uma thread parada, como a sugestao o diz, com o comando. */
function passoDaSugestao(t: Thread, passo: PassoDoCondutor | undefined): { passo: string; comando: string } {
  if (passo?.acao === 'despachar' && passo.fase) {
    const fase = passo.fase;
    return { passo: textoDoCatalogo((m) => m.pulse.ociosa.despachar(fase)),
      comando: `ork phase run ${t.id} ${fase} --prompt "$(ork prompt render ${t.id} ${fase})"` };
  }
  if (passo?.acao === 'retomar') return { passo: textoDoCatalogo((m) => m.pulse.ociosa.retomar), comando: `ork retry run ${t.id}` };
  if (passo?.acao === 'avisar' && passo.proximoPasso) {
    const proximo = passo.proximoPasso;
    return { passo: proximo, comando: `ork thread status ${t.id}` };
  }
  return { passo: textoDoCatalogo((m) => m.pulse.ociosa.verAThread(t.faseAtual)), comando: `ork thread status ${t.id}` };
}

/**
 * A maquina esta ociosa? `null` quando nao esta: sem vaga livre, ou sem trabalho reservado para ela que ninguem
 * trabalha agora. Fica de fora do trabalho reservado o item cuja thread esta fechada (a reserva e orfa), cuja thread
 * alguem conduz agora e cuja thread espera o dono (o passo e dele, e a fila do dono ja o mostra).
 */
export function maquinaOciosa(carregado: ManifestoCarregado, opcoes: OpcoesDaOciosidade = {}): MaquinaOciosa | null {
  const raiz = raizDoEstado(carregado.raiz);
  const doProjeto = { ...carregado, raiz };
  const quando = opcoes.quando ?? new Date().toISOString();
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  const limite = Math.max(1, carregado.manifesto.concurrency.max_parallel_threads);
  const ocupadas = opcoes.ocupadas ? opcoes.ocupadas() : sessoesQueOcupam(doProjeto, { quando }).length;
  if (ocupadas >= limite) return null;
  const remoto = carregado.manifesto.fabrica.remoto;
  const reservas = (opcoes.reservas ? opcoes.reservas() : reservasLocais(raiz, remoto))
    .filter((r) => r.maquina === maquina && ITEM.test(r.item));
  if (!reservas.length) return null;
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) { try { threads.push(lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }
  // RM-058, integracao (T1.2): o trabalho de um arco #Noctum nao e sugerido. A thread que o arco segura ou retem fica com
  // ele, e o item da lista de um arco que guarda (sem thread aberta ainda) e o arco que abre.
  const arcos = lerArcosDaRaiz(raiz, quando);
  const itensDosArcos = new Set<string>();
  for (const { estado, proposta } of arcos.lidos.values()) {
    const guarda = guardaOsCaminhosManuais({ arco: estado.arco, situacao: estado.situacao, origem: 'envelope' });
    for (const w of guarda ? estado.conteudo?.trabalhos ?? [] : []) itensDosArcos.add(w.item);
    for (const w of estado.situacao === 'proposto' || guarda ? proposta?.trabalhos ?? [] : []) itensDosArcos.add(w.item);
  }
  const paradas: { r: ReservaDeItem; t: Thread | null }[] = [];
  for (const r of reservas) {
    const t = threadDoItem(threads, r);
    if (t?.status === 'fechada') continue;
    if (!t && itensDosArcos.has(r.item)) continue;
    if (t) {
      let conduzida = true;
      try { conduzida = conducaoDaThread(raiz, t.id, { agora: new Date(quando) }) !== null; } catch { conduzida = true; }
      if (conduzida) continue;
      let eventos: ReturnType<typeof lerLedger> = [];
      try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { eventos = []; }
      let doDono: string | null = null;
      try { doDono = pendenciaDoDono(t, eventos, quando); } catch { doDono = null; }
      if (doDono) continue;
      if (arcoDoPasso(raiz, arcos, t.id, eventos)) continue;
    }
    paradas.push({ r, t });
  }
  if (!paradas.length) return null;
  // A thread que ja existe vem antes (retomar custa menos que abrir), e a reserva mais antiga primeiro.
  paradas.sort((a, b) => Number(!a.t) - Number(!b.t) || a.r.desdeEm.localeCompare(b.r.desdeEm) || a.r.item.localeCompare(b.r.item));
  const livres = limite - ocupadas;
  const escolhidas = paradas.slice(0, livres);
  let passos: readonly PassoDoCondutor[] = [];
  if (escolhidas.some((x) => x.t)) {
    try { passos = opcoes.passos ? opcoes.passos() : passosDoCondutor(doProjeto, { quando }); } catch { passos = []; }
  }
  const sugeridas = escolhidas.map(({ r, t }): SugestaoDeTrabalho => {
    const titulo = tituloDoItem(raiz, r.item);
    if (!t) {
      const nome = (titulo ?? r.item).replace(/"/g, "'");
      return { item: r.item, titulo, thread: null, fase: null, passo: textoDoCatalogo((m) => m.pulse.ociosa.abrir),
        comando: `ork thread new "${nome}" --modo auto --roadmap ${r.item}` };
    }
    const { passo, comando } = passoDaSugestao(t, passos.find((p) => p.thread === t.id));
    return { item: r.item, titulo, thread: t.id, fase: t.faseAtual, passo, comando };
  });
  return { maquina, limite, ocupadas, livres, reservados: paradas.length, sugeridas,
    fonte: `copia local de ${remoto}/ork/roadmap-reservas` };
}
