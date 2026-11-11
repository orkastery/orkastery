/** RM-089 F1: projeção fechada e publicação na rede coletiva. */
import { createHash } from 'node:crypto';
import type { ContextoDaVarredura } from './dado-privado';
import { varrerTexto } from './dado-privado';
import type { ProjetoNoPanorama } from './network-roadmap';
import { procurarSegredos } from './policies';
import { adesaoRedeEmpresa, gravarAdesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_PUBLICACAO_EMPRESA, ehInscricaoDaEmpresa, ehPoliticaDaEmpresa, ehPublicacaoDaEmpresa,
  ehTipoDeLacunaPublicada, type InscricaoDaEmpresa, type LacunaPublicada, type PublicacaoDaEmpresa,
  type ReferenciaDaForja } from './rede-empresa-contrato';
import { caminhoDaPublicacao, type PortaDaBranchEmpresa, type ResultadoDaTransacaoEmpresa,
  transacionarRedeEmpresa } from './rede-empresa-transporte';

const FASES = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const;
type FasePublicada = typeof FASES[number];

export type CodigoDaPublicacaoEmpresa = 'rede-empresa.politica-ausente' | 'rede-empresa.politica-incompativel'
  | 'rede-empresa.inscricao-ausente' | 'rede-empresa.inscricao-inativa' | 'rede-empresa.projeto-nao-autorizado'
  | 'rede-empresa.projecao-invalida' | 'rede-empresa.dado-privado' | 'rede-empresa.segredo'
  | 'rede-empresa.forja-indisponivel' | 'rede-empresa.concorrencia';

export type ResultadoPublicacaoEmpresa =
  | { ok: true; valor: PublicacaoDaEmpresa; transacao: ResultadoDaTransacaoEmpresa }
  | { ok: false; codigo: CodigoDaPublicacaoEmpresa; transacao?: ResultadoDaTransacaoEmpresa };

export interface PedidoDePublicacaoEmpresa {
  inscricaoId: string;
  projetoRef: string;
  projeto: ReferenciaDaForja;
  panorama: ProjetoNoPanorama;
  agora: string;
  privacidade: ContextoDaVarredura;
  env?: NodeJS.ProcessEnv;
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const ler = <T>(texto: string | null, valido: (v: unknown) => v is T): T | null => {
  if (!texto) return null;
  try { const v = JSON.parse(texto) as unknown; return valido(v) ? v : null; } catch { return null; }
};
const caminhoDaInscricao = (id: string): string => `inscricoes/${id}.json`;
const mesmaRef = (a: ReferenciaDaForja, b: ReferenciaDaForja): boolean =>
  a.forja === b.forja && a.host.toLowerCase() === b.host.toLowerCase() && a.caminho.toLowerCase() === b.caminho.toLowerCase();
const fase = (v: string): FasePublicada | null => FASES.includes(v.toUpperCase() as FasePublicada)
  ? v.toUpperCase() as FasePublicada : null;
const threadRef = (inscricaoId: string, id: string): string =>
  `thread-${createHash('sha256').update(`${inscricaoId}\n${id}`, 'utf8').digest('hex').slice(0, 24)}`;

function montarProjecao(inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa): PublicacaoDaEmpresa | null {
  const itens = (pedido.panorama.roadmap?.grupos ?? []).flatMap((g) => g.itens)
    .map((item) => ({ id: item.id, estado: item.grupo }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reservas = (pedido.panorama.reservas ?? []).map((reserva) => ({ itemId: reserva.item,
    ...(reserva.thread ? { threadRef: threadRef(inscricao.inscricaoId, reserva.thread) } : {}), iniciadaEm: reserva.desdeEm }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  const trabalhos = (pedido.panorama.maquinas ?? []).flatMap((maquina) => maquina.ativas).flatMap((trabalho) => {
    const f = fase(trabalho.fase);
    return f ? [{ threadRef: threadRef(inscricao.inscricaoId, trabalho.id), fase: f,
      ...(trabalho.roadmap ? { itemId: trabalho.roadmap } : {}) }] : [];
  }).sort((a, b) => a.threadRef.localeCompare(b.threadRef));
  const fontes = pedido.panorama.fontes.map((fonte) => ({ parte: fonte.parte, atualizado: fonte.atualizado,
    lidoEm: fonte.lidoEm, ...(fonte.commit ? { commit: fonte.commit } : {}) }));
  const lacunas: LacunaPublicada[] = [];
  for (const lacuna of pedido.panorama.lacunas) {
    if (!ehTipoDeLacunaPublicada(lacuna.tipo)) return null;
    lacunas.push({ tipo: lacuna.tipo, parte: lacuna.parte });
  }
  return { contrato: CONTRATO_PUBLICACAO_EMPRESA, politicaVersao: inscricao.politicaVersao,
    inscricaoId: inscricao.inscricaoId, publicadoEm: pedido.agora,
    maestro: { ...inscricao.maestroRef, loginAtual: inscricao.loginAtual }, rede: inscricao.rede, projeto: pedido.projeto,
    itens, reservas, trabalhos, fontes, lacunas };
}

/** Valida o contrato e aplica as mesmas barreiras de dado privado e segredo antes de formar o blob. */
export function projetarPublicacaoEmpresa(inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa):
{ ok: true; valor: PublicacaoDaEmpresa; texto: string } | { ok: false; codigo: CodigoDaPublicacaoEmpresa } {
  const valor = montarProjecao(inscricao, pedido);
  if (!valor || !ehPublicacaoDaEmpresa(valor)) return { ok: false, codigo: 'rede-empresa.projecao-invalida' };
  const texto = json(valor);
  const varredura = varrerTexto(pedido.privacidade, caminhoDaPublicacao(inscricao.inscricaoId, pedido.projetoRef), texto);
  if (varredura.erro || varredura.achados.length) return { ok: false, codigo: 'rede-empresa.dado-privado' };
  if (procurarSegredos(texto).length) return { ok: false, codigo: 'rede-empresa.segredo' };
  return { ok: true, valor, texto };
}

function atualizarConfig(pedido: PedidoDePublicacaoEmpresa, inscricao: InscricaoDaEmpresa | null,
  pendencia: { codigo: string; em: string } | null, ultimaPublicacao?: string): void {
  const atual = adesaoRedeEmpresa(pedido.inscricaoId, pedido.env);
  if (!atual) return;
  gravarAdesaoRedeEmpresa({ ...atual, ...(inscricao ? { estado: inscricao.estado, loginAtual: inscricao.loginAtual,
    politicaVersao: inscricao.politicaVersao } : {}),
  ...(ultimaPublicacao ? { ultimaPublicacao } : {}), pendencia }, pedido.env);
}

/** Cada tentativa relê política e inscrição e recompõe a projeção sobre a ponta nova. */
export function publicarNaRedeEmpresa(porta: PortaDaBranchEmpresa, pedido: PedidoDePublicacaoEmpresa): ResultadoPublicacaoEmpresa {
  let publicacao: PublicacaoDaEmpresa | null = null;
  let inscricao: InscricaoDaEmpresa | null = null;
  let falha: CodigoDaPublicacaoEmpresa | null = null;
  const t = transacionarRedeEmpresa(porta, (ponta) => {
    const politica = ler(ponta.ler('politica.json'), ehPoliticaDaEmpresa);
    inscricao = ler(ponta.ler(caminhoDaInscricao(pedido.inscricaoId)), ehInscricaoDaEmpresa);
    if (!politica || !inscricao) { falha = !politica ? 'rede-empresa.politica-ausente' : 'rede-empresa.inscricao-ausente'; return null; }
    if (politica.versao !== inscricao.politicaVersao) { falha = 'rede-empresa.politica-incompativel'; return null; }
    if (inscricao.estado !== 'ativa') { falha = 'rede-empresa.inscricao-inativa'; return null; }
    if (!inscricao.projetos.some((p) => mesmaRef(p, pedido.projeto))) { falha = 'rede-empresa.projeto-nao-autorizado'; return null; }
    const projetada = projetarPublicacaoEmpresa(inscricao, pedido);
    if (!projetada.ok) { falha = projetada.codigo; return null; }
    const caminho = caminhoDaPublicacao(pedido.inscricaoId, pedido.projetoRef);
    const anterior = ler(ponta.ler(caminho), ehPublicacaoDaEmpresa);
    const semInstante = (p: PublicacaoDaEmpresa): string => JSON.stringify({ ...p, publicadoEm: '' });
    if (anterior && semInstante(anterior) === semInstante(projetada.valor)) { publicacao = anterior; return null; }
    publicacao = projetada.valor;
    return { mensagem: `rede empresa: publica ${pedido.inscricaoId}/${pedido.projetoRef}`,
      mudancas: [{ caminho, conteudo: projetada.texto }] };
  });
  if (falha) return { ok: false, codigo: falha, transacao: t };
  if (t.acao === 'pendente') {
    atualizarConfig(pedido, inscricao, { codigo: t.codigo, em: pedido.agora });
    return { ok: false, codigo: t.codigo, transacao: t };
  }
  if (t.acao === 'falhou') {
    atualizarConfig(pedido, inscricao, { codigo: t.codigo, em: pedido.agora });
    return { ok: false, codigo: t.codigo, transacao: t };
  }
  atualizarConfig(pedido, inscricao, null, publicacao!.publicadoEm);
  return { ok: true, valor: publicacao!, transacao: t };
}
