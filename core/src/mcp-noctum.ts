/**
 * RM-058, fatia N6 (D12 da ork-rm058n6): as ferramentas do MCP que levam o pedido de abertura do arco até o núcleo e
 * a autorização do dono pelo diálogo nativo do host.
 *
 *  - `ork_noctum_propor`: o pedido de abertura vira proposta, com o resumo e o hash; não autoriza nada.
 *  - `ork_noctum_autorizar` e `ork_noctum_revogar`: o diálogo nativo do host (`criarDialogoDoArco` da N1, com a elicitação
 *    do servidor). Só identificadores nos argumentos, e o esquema recusa qualquer campo a mais: argumento de ferramenta
 *    nunca é resposta do dono. Sem formulário no cliente, a recusa vem antes de qualquer escrita.
 *  - `ork_noctum_status`: o retrato do arco, somente leitura.
 *
 * Nenhuma delas existe no servidor fixado numa thread (a sessão de fase): quem abre ou autoriza arco é o dono, nunca a
 * sessão filha. A fronteira do diálogo é a de `criarIngressoLocal`: a instalação do cliente MCP é confiável e o modelo não
 * responde por ela (limite dito na N1).
 */
import { z } from 'zod';
import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ManifestoCarregado } from './manifest';
import { ApresentacaoDoArco, criarDialogoDoArco, lerArco, perguntasDoArco, proporEnvelope, RespostaDoDialogo } from './noctum-arco';
import { textoDaPerguntaDoArco } from './noctum-pergunta';
import { comoResponderAoArco, entregarPerguntaDoArco } from './noctum-pergunta-canal';
import { codigosEmUso } from './pulse-resposta';
import { ID_DO_ARCO } from './noctum-envelope';
import { listarArcos, retratoDoArco } from './noctum-modo';

type Registrar = <S extends z.AnyZodObject>(nome: string, config: { description: string; inputSchema: S; annotations: Tool['annotations'] },
  executar: (args: z.infer<S>, extra: { signal: AbortSignal }) => Promise<CallToolResult>) => void;

export const FERRAMENTAS_DO_NOCTUM = ['ork_noctum_propor', 'ork_noctum_autorizar', 'ork_noctum_revogar', 'ork_noctum_status'] as const;

const resposta = (valor: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(valor) }] });
const arco = z.string().regex(ID_DO_ARCO);

export interface OpcoesDoNoctumNoMcp {
  raiz: string;
  carregar: () => ManifestoCarregado;
  host: 'claude-code' | 'codex';
  conexao: string;
  /** A elicitação do servidor; quem a fornece é o servidor, nunca os argumentos de uma ferramenta. */
  elicitar: (a: ApresentacaoDoArco, signal: AbortSignal) => Promise<RespostaDoDialogo>;
  /** O cliente oferece o formulário nativo? Sem ele, autorizar e revogar recusam antes de escrever. */
  temFormulario: () => boolean;
}

export function registrarFerramentasDoNoctum(registrar: Registrar, o: OpcoesDoNoctumNoMcp): void {
  const dialogo = criarDialogoDoArco(o.raiz, { host: o.host, connectionId: o.conexao }, o.elicitar);
  const exigirFormulario = () => {
    if (!o.temFormulario()) {
      throw Error('noctum.origem.sem-prova: este cliente não oferece o formulário nativo do host; o dono responde à pergunta do arco com a ' +
        'letra em reply no Telegram, com o código no Telegram, ou por um host com diálogo nativo');
    }
  };
  registrar('ork_noctum_propor', {
    description: 'Grava a proposta do envelope de um arco #Noctum (o pedido de abertura com os valores do dono: janela, destinos, ' +
      'orcamento, relatorio, trabalhos e capacidade) e devolve o resumo, o hash e a pergunta ao dono (codigo curto e alternativas), que sai ' +
      'tambem pelo canal dele. Nao autoriza nada: quem autoriza e o dono, respondendo a pergunta com a letra (em reply no Telegram, com o ' +
      'codigo no Telegram ou pelo dialogo nativo, ork_noctum_autorizar; o terminal nao grava resposta). Mostre a pergunta ao dono como ela vem; nunca responda por ele. Nunca ' +
      'invente valor do dono: campo que falta volta listado na recusa.',
    inputSchema: z.object({ pedido: z.record(z.unknown()) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ pedido }) => {
    o.carregar();
    // RM-057 (resposta curta, D4 e D9): a proposta é a pergunta ao dono, e ela sai também pelo canal dele quando ele tem um.
    const quando = new Date().toISOString();
    const r = proporEnvelope(o.raiz, pedido, quando, codigosEmUso(o.raiz));
    const q = r.codigo ? perguntasDoArco(o.raiz, r.arco, quando).find(x => x.codigo === r.codigo && x.situacao === 'pendente') : undefined;
    const entrega = q ? entregarPerguntaDoArco(o.raiz, q, { quando }) : null;
    return resposta({ ...r, autorizado: false,
      comoAutorizar: q ? comoResponderAoArco(q) : [`o envelope já vale no arco ${r.arco}: não há o que autorizar`],
      pergunta: q ? { codigo: q.codigo, prazo: q.prazo, entrega,
        texto: textoDaPerguntaDoArco(q, 'terminal', { quando, ...(entrega?.numero ? { numero: entrega.numero } : {}) }) } : null });
  });
  registrar('ork_noctum_autorizar', {
    description: 'Apresenta ao dono, pelo dialogo nativo do host, o envelope proposto do arco para autorizar. Somente o arco e o hash; ' +
      'nunca forneca resposta nos argumentos. Sem a escolha do dono no dialogo, nada muda.',
    inputSchema: z.object({ arco, envelopeSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args) => {
    o.carregar(); exigirFormulario();
    const e = await dialogo.autorizar(args.arco, args.envelopeSha256);
    return resposta({ arco: e.arco, situacao: e.situacao, versao: e.versao, envelopeSha256: e.envelopeSha256 });
  });
  registrar('ork_noctum_revogar', {
    description: 'Apresenta ao dono, pelo dialogo nativo do host, a revogacao do arco: terminal, nenhum efeito novo passa depois. Somente o ' +
      'arco; nunca forneca resposta nos argumentos.',
    inputSchema: z.object({ arco }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args) => {
    o.carregar(); exigirFormulario();
    const e = await dialogo.revogar(args.arco);
    return resposta({ arco: e.arco, situacao: e.situacao, versao: e.versao, envelopeSha256: e.envelopeSha256 });
  });
  registrar('ork_noctum_status', {
    description: 'Retrato de um arco #Noctum, somente leitura: situacao, janela, consumo medido por unidade com as lacunas, fila, ' +
      'fechamento, relatorio da manha com recibos e lacunas. Sem arco, a lista dos arcos. Transporte como vem: lacuna nao e zero.',
    inputSchema: z.object({ arco: arco.optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const carregado = o.carregar();
    if (!args.arco) {
      return resposta({ arcos: listarArcos(o.raiz).map(a => {
        try { return { arco: a, situacao: lerArco(o.raiz, a)?.situacao ?? 'sem-proposta' }; }
        catch { return { arco: a, situacao: 'ilegivel' }; }
      }) });
    }
    const r = retratoDoArco(carregado, args.arco);
    if (!r) throw Error(`noctum.efeito.sem-autorizacao: o arco ${args.arco} não tem proposta`);
    return resposta(r);
  });
}
