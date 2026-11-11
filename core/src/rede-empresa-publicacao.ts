/** RM-089 F1: projeção fechada e publicação na rede coletiva. */
import { createHash } from 'node:crypto';
import type { ContextoDaVarredura } from './dado-privado';
import { varrerTexto } from './dado-privado';
import type { ContaNaForja } from './forja/contrato';
import type { ProjetoNoPanorama } from './network-roadmap';
import { procurarSegredos } from './policies';
import { adesaoRedeEmpresa, gravarAdesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_POLITICA_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V2, ehInscricaoDaEmpresa, ehPoliticaDaEmpresa, ehPublicacaoDaEmpresa,
  ehTipoDeLacunaPublicada, type InscricaoDaEmpresa, type LacunaPublicada, type PublicacaoDaEmpresa,
  type ReferenciaDaForja } from './rede-empresa-contrato';
import { caminhoDaPublicacao, type PortaDaBranchEmpresa, type ResultadoDaTransacaoEmpresa,
  lerDocumentoRemoto, transacionarRedeEmpresa, type CodigoDocumentoRemotoInvalido } from './rede-empresa-transporte';
import { mesmaProjectKey, normalizarProjeto } from './rede-empresa-projeto';

const FASES = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const;
type FasePublicada = typeof FASES[number];

export type CodigoDaPublicacaoEmpresa = CodigoDocumentoRemotoInvalido
  | 'rede-empresa.politica-ausente' | 'rede-empresa.politica-incompativel'
  | 'rede-empresa.inscricao-ausente' | 'rede-empresa.inscricao-inativa' | 'rede-empresa.projeto-nao-autorizado'
  | 'rede-empresa.identidade-divergente'
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
  conta: ContaNaForja;
  forja: InscricaoDaEmpresa['maestroRef']['forja'];
  host: string;
  agora: string;
  privacidade: ContextoDaVarredura;
  env?: NodeJS.ProcessEnv;
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const caminhoDaInscricao = (id: string): string => `inscricoes/${id}.json`;
const mesmaConta = (inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa): boolean =>
  inscricao.maestroRef.forja === pedido.forja && inscricao.maestroRef.host.toLowerCase() === pedido.host.toLowerCase()
  && inscricao.maestroRef.accountId === pedido.conta.accountId;
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
  const projectKey = normalizarProjeto(pedido.projeto).projectKey;
  return { contrato: CONTRATO_PUBLICACAO_EMPRESA_V2, projectKey, politicaVersao: inscricao.politicaVersao,
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
    const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
    if (politicaLida.estado !== 'presente') {
      falha = politicaLida.estado === 'ausente' ? 'rede-empresa.politica-ausente' : politicaLida.codigo;
      return null;
    }
    const inscricaoLida = lerDocumentoRemoto(ponta, caminhoDaInscricao(pedido.inscricaoId), ehInscricaoDaEmpresa);
    if (inscricaoLida.estado !== 'presente') {
      falha = inscricaoLida.estado === 'ausente' ? 'rede-empresa.inscricao-ausente' : inscricaoLida.codigo;
      return null;
    }
    const politica = politicaLida.valor;
    inscricao = inscricaoLida.valor;
    if (politica.versao !== inscricao.politicaVersao) { falha = 'rede-empresa.politica-incompativel'; return null; }
    if (inscricao.estado !== 'ativa') { falha = 'rede-empresa.inscricao-inativa'; return null; }
    if (!mesmaConta(inscricao, pedido)) { falha = 'rede-empresa.identidade-divergente'; return null; }
    const espelhos = politica.contrato === CONTRATO_POLITICA_EMPRESA_V2 ? politica.espelhos : [];
    if (!inscricao.projetos.some((p) => mesmaProjectKey(p, pedido.projeto, espelhos))) { falha = 'rede-empresa.projeto-nao-autorizado'; return null; }
    const projetada = projetarPublicacaoEmpresa(inscricao, pedido);
    if (!projetada.ok) { falha = projetada.codigo; return null; }
    const caminho = caminhoDaPublicacao(pedido.inscricaoId, pedido.projetoRef);
    const anteriorLida = lerDocumentoRemoto(ponta, caminho, ehPublicacaoDaEmpresa);
    if (anteriorLida.estado === 'invalido' || anteriorLida.estado === 'indisponivel') { falha = anteriorLida.codigo; return null; }
    const anterior = anteriorLida.estado === 'presente' ? anteriorLida.valor : null;
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
