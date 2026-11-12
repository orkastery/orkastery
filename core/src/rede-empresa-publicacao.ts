/** RM-089 F1: projeção fechada e publicação na rede coletiva. */
import { createHash } from 'node:crypto';
import type { ContextoDaVarredura } from './dado-privado';
import { varrerTexto } from './dado-privado';
import type { ContaNaForja } from './forja/contrato';
import type { ProjetoNoPanorama } from './network-roadmap';
import { procurarSegredos } from './policies';
import { adesaoRedeEmpresa, gravarAdesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_POLITICA_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V3,
  ehInscricaoDaEmpresa, ehPoliticaDaEmpresa, ehPublicacaoDaEmpresa,
  ehTipoDeLacunaPublicada, type InscricaoDaEmpresa, type LacunaPublicada, type PublicacaoDaEmpresa,
  type PublicacaoDaEmpresaV2, type PublicacaoDaEmpresaV3, type ReferenciaDaForja, type TrabalhoPublicadoV3 } from './rede-empresa-contrato';
import { caminhoDaPublicacao, type PortaDaBranchEmpresa, type ResultadoDaTransacaoEmpresa,
  lerDocumentoRemoto, transacionarRedeEmpresa, type CodigoDocumentoRemotoInvalido } from './rede-empresa-transporte';
import { mesmaProjectKey, normalizarProjeto, type EspelhoDeProjeto } from './rede-empresa-projeto';
import { caminhoDaPublicacaoV3, normalizarCaminhosDoTrabalho, type CaminhosPorThread } from './rede-empresa-trabalho';

const FASES = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const;
type FasePublicada = typeof FASES[number];

export type CodigoDaPublicacaoEmpresa = CodigoDocumentoRemotoInvalido
  | 'rede-empresa.politica-ausente' | 'rede-empresa.politica-incompativel'
  | 'rede-empresa.inscricao-ausente' | 'rede-empresa.inscricao-inativa' | 'rede-empresa.projeto-nao-autorizado'
  | 'rede-empresa.identidade-divergente'
  | 'rede-empresa.projecao-invalida' | 'rede-empresa.dado-privado' | 'rede-empresa.segredo'
  | 'rede-empresa.forja-indisponivel' | 'rede-empresa.concorrencia';

export type ResultadoPublicacaoEmpresa =
  | { ok: true; valor: PublicacaoDaEmpresaV2; valorV3: PublicacaoDaEmpresaV3; transacao: ResultadoDaTransacaoEmpresa }
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
  caminhosPorThread?: CaminhosPorThread;
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

function montarProjecoes(inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa,
  espelhos: readonly EspelhoDeProjeto[]): { v2: PublicacaoDaEmpresaV2; v3: PublicacaoDaEmpresaV3 } | null {
  const itens = (pedido.panorama.roadmap?.grupos ?? []).flatMap((g) => g.itens)
    .map((item) => ({ id: item.id, estado: item.grupo }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const reservas = (pedido.panorama.reservas ?? []).map((reserva) => ({ itemId: reserva.item,
    ...(reserva.thread ? { threadRef: threadRef(inscricao.inscricaoId, reserva.thread) } : {}), iniciadaEm: reserva.desdeEm }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  const trabalhosComId = (pedido.panorama.maquinas ?? []).flatMap((maquina) => maquina.ativas).flatMap((trabalho) => {
    const f = fase(trabalho.fase);
    return f ? [{ id: trabalho.id, threadRef: threadRef(inscricao.inscricaoId, trabalho.id), fase: f,
      ...(trabalho.roadmap ? { itemId: trabalho.roadmap } : {}), instante: trabalho.atualizadaEm ?? pedido.agora }] : [];
  }).sort((a, b) => a.threadRef.localeCompare(b.threadRef));
  const trabalhos = trabalhosComId.map(({ id: _id, instante: _instante, ...trabalho }) => trabalho);
  const trabalhosV3: TrabalhoPublicadoV3[] = [];
  for (const trabalho of trabalhosComId) {
    const caminhos = normalizarCaminhosDoTrabalho(pedido.caminhosPorThread?.[trabalho.id] ?? []);
    if (!caminhos) return null;
    trabalhosV3.push({ threadRef: trabalho.threadRef, fase: trabalho.fase, ...(trabalho.itemId ? { itemId: trabalho.itemId } : {}),
      caminhos, instanteLocal: { valor: trabalho.instante, fonte: 'auto-relato-autenticado' } });
  }
  const fontes = pedido.panorama.fontes.map((fonte) => ({ parte: fonte.parte, atualizado: fonte.atualizado,
    lidoEm: fonte.lidoEm, ...(fonte.commit ? { commit: fonte.commit } : {}) }));
  const lacunas: LacunaPublicada[] = [];
  for (const lacuna of pedido.panorama.lacunas) {
    if (!ehTipoDeLacunaPublicada(lacuna.tipo)) return null;
    lacunas.push({ tipo: lacuna.tipo, parte: lacuna.parte });
  }
  const projectKey = normalizarProjeto(pedido.projeto, { espelhos }).projectKey;
  const base = { projectKey, politicaVersao: inscricao.politicaVersao,
    inscricaoId: inscricao.inscricaoId, publicadoEm: pedido.agora,
    maestro: { ...inscricao.maestroRef, loginAtual: inscricao.loginAtual }, rede: inscricao.rede, projeto: pedido.projeto,
    itens, reservas, fontes, lacunas };
  return { v2: { ...base, contrato: CONTRATO_PUBLICACAO_EMPRESA_V2, trabalhos },
    v3: { ...base, contrato: CONTRATO_PUBLICACAO_EMPRESA_V3, trabalhos: trabalhosV3 } };
}

/** Valida o contrato e aplica as mesmas barreiras de dado privado e segredo antes de formar o blob. */
export function projetarPublicacaoEmpresa(inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa,
  espelhos: readonly EspelhoDeProjeto[] = []):
{ ok: true; valor: PublicacaoDaEmpresa; texto: string } | { ok: false; codigo: CodigoDaPublicacaoEmpresa } {
  const valor = montarProjecoes(inscricao, pedido, espelhos)?.v2 ?? null;
  if (!valor || !ehPublicacaoDaEmpresa(valor)) return { ok: false, codigo: 'rede-empresa.projecao-invalida' };
  const texto = json(valor);
  const varredura = varrerTexto(pedido.privacidade, caminhoDaPublicacao(inscricao.inscricaoId, pedido.projetoRef), texto);
  if (varredura.erro || varredura.achados.length) return { ok: false, codigo: 'rede-empresa.dado-privado' };
  if (procurarSegredos(texto).length) return { ok: false, codigo: 'rede-empresa.segredo' };
  return { ok: true, valor, texto };
}

export function projetarPublicacoesEmpresa(inscricao: InscricaoDaEmpresa, pedido: PedidoDePublicacaoEmpresa,
  espelhos: readonly EspelhoDeProjeto[] = []):
{ ok: true; v2: PublicacaoDaEmpresaV2; v3: PublicacaoDaEmpresaV3; textoV2: string; textoV3: string }
| { ok: false; codigo: CodigoDaPublicacaoEmpresa } {
  const valores = montarProjecoes(inscricao, pedido, espelhos);
  if (!valores || !ehPublicacaoDaEmpresa(valores.v2) || !ehPublicacaoDaEmpresa(valores.v3))
    return { ok: false, codigo: 'rede-empresa.projecao-invalida' };
  const textoV2 = json(valores.v2), textoV3 = json(valores.v3);
  for (const [caminho, texto] of [[caminhoDaPublicacao(inscricao.inscricaoId, pedido.projetoRef), textoV2],
    [caminhoDaPublicacaoV3(inscricao.inscricaoId, pedido.projetoRef), textoV3]] as const) {
    const varredura = varrerTexto(pedido.privacidade, caminho, texto);
    if (varredura.erro || varredura.achados.length) return { ok: false, codigo: 'rede-empresa.dado-privado' };
    if (procurarSegredos(texto).length) return { ok: false, codigo: 'rede-empresa.segredo' };
  }
  return { ok: true, ...valores, textoV2, textoV3 };
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
  let publicacao: PublicacaoDaEmpresaV2 | null = null;
  let publicacaoV3: PublicacaoDaEmpresaV3 | null = null;
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
    const projetada = projetarPublicacoesEmpresa(inscricao, pedido, espelhos);
    if (!projetada.ok) { falha = projetada.codigo; return null; }
    const caminho = caminhoDaPublicacao(pedido.inscricaoId, pedido.projetoRef);
    const caminhoV3 = caminhoDaPublicacaoV3(pedido.inscricaoId, pedido.projetoRef);
    const anteriorLida = lerDocumentoRemoto(ponta, caminho, ehPublicacaoDaEmpresa);
    if (anteriorLida.estado === 'invalido' || anteriorLida.estado === 'indisponivel') { falha = anteriorLida.codigo; return null; }
    const anterior = anteriorLida.estado === 'presente' ? anteriorLida.valor : null;
    const anteriorV3Lida = lerDocumentoRemoto(ponta, caminhoV3, ehPublicacaoDaEmpresa);
    if (anteriorV3Lida.estado === 'invalido' || anteriorV3Lida.estado === 'indisponivel') { falha = anteriorV3Lida.codigo; return null; }
    const anteriorV3 = anteriorV3Lida.estado === 'presente' && anteriorV3Lida.valor.contrato === CONTRATO_PUBLICACAO_EMPRESA_V3
      ? anteriorV3Lida.valor : null;
    const semInstante = (p: PublicacaoDaEmpresa): string => JSON.stringify({ ...p, publicadoEm: '' });
    if (anterior?.contrato === CONTRATO_PUBLICACAO_EMPRESA_V2 && anteriorV3
      && semInstante(anterior) === semInstante(projetada.v2) && semInstante(anteriorV3) === semInstante(projetada.v3)) {
      publicacao = anterior; publicacaoV3 = anteriorV3; return null;
    }
    publicacao = projetada.v2; publicacaoV3 = projetada.v3;
    return { mensagem: `rede empresa: publica ${pedido.inscricaoId}/${pedido.projetoRef}`,
      mudancas: [{ caminho, conteudo: projetada.textoV2 }, { caminho: caminhoV3, conteudo: projetada.textoV3 }] };
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
  return { ok: true, valor: publicacao!, valorV3: publicacaoV3!, transacao: t };
}
