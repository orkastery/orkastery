/** RM-089 F1: ciclo da inscrição na mesma branch das publicações. */
import type { ContaNaForja } from './forja/contrato';
import { AdesaoRedeEmpresa, gravarAdesaoRedeEmpresa } from './rede-empresa-config';
import { CONTRATO_INSCRICAO_EMPRESA, CONTRATO_POLITICA_EMPRESA, ehInscricaoDaEmpresa, ehPoliticaDaEmpresa,
  InscricaoDaEmpresa, MaestroRef, PoliticaDaEmpresa, ReferenciaDaForja } from './rede-empresa-contrato';
import { lerDocumentoRemoto, PortaDaBranchEmpresa, ResultadoDaTransacaoEmpresa, transacionarRedeEmpresa,
  type CodigoDocumentoRemotoInvalido } from './rede-empresa-transporte';

export type CodigoDaInscricaoEmpresa = CodigoDocumentoRemotoInvalido
  | 'rede-empresa.politica-ausente' | 'rede-empresa.politica-incompativel'
  | 'rede-empresa.inscricao-ausente' | 'rede-empresa.inscricao-inativa' | 'rede-empresa.identidade-divergente'
  | 'rede-empresa.rede-divergente' | 'rede-empresa.projeto-nao-autorizado' | 'rede-empresa.saida-negada'
  | 'rede-empresa.forja-indisponivel' | 'rede-empresa.concorrencia';

export type ResultadoInscricaoEmpresa<T> =
  | { ok: true; valor: T; transacao: ResultadoDaTransacaoEmpresa }
  | { ok: false; codigo: CodigoDaInscricaoEmpresa; transacao?: ResultadoDaTransacaoEmpresa };

export interface RegistroDeInscricao {
  inscricaoId: string;
  rede: ReferenciaDaForja;
  maestroRef: MaestroRef;
  loginAtual: string;
  projetos: ReferenciaDaForja[];
  politicaVersao: string;
  agora: string;
}

const caminhoDaInscricao = (id: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error('rede-empresa.inscricao-invalida');
  return `inscricoes/${id}.json`;
};
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const mesmaRef = (a: ReferenciaDaForja, b: ReferenciaDaForja): boolean =>
  a.forja === b.forja && a.host.toLowerCase() === b.host.toLowerCase() && a.caminho.toLowerCase() === b.caminho.toLowerCase();
const mesmaConta = (a: MaestroRef, conta: ContaNaForja, forja: MaestroRef['forja'], host: string): boolean =>
  a.forja === forja && a.host.toLowerCase() === host.toLowerCase() && a.accountId === conta.accountId;

function daTransacao<T>(t: ResultadoDaTransacaoEmpresa, valor: T): ResultadoInscricaoEmpresa<T> {
  if (t.acao === 'pendente') return { ok: false, codigo: 'rede-empresa.forja-indisponivel', transacao: t };
  if (t.acao === 'falhou') return { ok: false, codigo: 'rede-empresa.concorrencia', transacao: t };
  return { ok: true, valor, transacao: t };
}

export function criarPoliticaEmpresa(porta: PortaDaBranchEmpresa, versao: string, saida: PoliticaDaEmpresa['saida']): ResultadoInscricaoEmpresa<PoliticaDaEmpresa> {
  const politica: PoliticaDaEmpresa = { contrato: CONTRATO_POLITICA_EMPRESA, versao, saida, publicacaoMinima: 1 };
  const t = transacionarRedeEmpresa(porta, (ponta) => ponta.ler('politica.json') === json(politica) ? null
    : { mensagem: `rede empresa: politica ${versao}`, mudancas: [{ caminho: 'politica.json', conteudo: json(politica) }] });
  return daTransacao(t, politica);
}

export function registrarInscricaoEmpresa(porta: PortaDaBranchEmpresa, pedido: RegistroDeInscricao): ResultadoInscricaoEmpresa<InscricaoDaEmpresa> {
  let resultado: InscricaoDaEmpresa | null = null;
  let falha: CodigoDaInscricaoEmpresa | null = null;
  const t = transacionarRedeEmpresa(porta, (ponta) => {
    const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
    if (politicaLida.estado !== 'presente') {
      falha = politicaLida.estado === 'ausente' ? 'rede-empresa.politica-ausente' : politicaLida.codigo;
      return null;
    }
    const politica = politicaLida.valor;
    if (politica.versao !== pedido.politicaVersao) { falha = 'rede-empresa.politica-incompativel'; return null; }
    const atualLida = lerDocumentoRemoto(ponta, caminhoDaInscricao(pedido.inscricaoId), ehInscricaoDaEmpresa);
    if (atualLida.estado === 'invalido' || atualLida.estado === 'indisponivel') { falha = atualLida.codigo; return null; }
    const atual = atualLida.estado === 'presente' ? atualLida.valor : null;
    resultado = atual ?? { contrato: CONTRATO_INSCRICAO_EMPRESA, inscricaoId: pedido.inscricaoId, rede: pedido.rede,
      maestroRef: pedido.maestroRef, loginAtual: pedido.loginAtual, projetos: pedido.projetos, politicaVersao: pedido.politicaVersao,
      estado: 'pendente', registradaEm: pedido.agora, aceitaEm: null, atualizadaEm: pedido.agora };
    return atual ? null : { mensagem: `rede empresa: registra ${pedido.inscricaoId}`,
      mudancas: [{ caminho: caminhoDaInscricao(pedido.inscricaoId), conteudo: json(resultado) }] };
  });
  if (falha) return { ok: false, codigo: falha, transacao: t };
  return daTransacao(t, resultado!);
}

export interface AceiteDaInscricao {
  inscricaoId: string;
  conta: ContaNaForja;
  forja: MaestroRef['forja'];
  host: string;
  rede: ReferenciaDaForja;
  projetosAcessiveis: ReferenciaDaForja[];
  agora: string;
  empresa: ReferenciaDaForja;
  env?: NodeJS.ProcessEnv;
}

export function aceitarInscricaoEmpresa(porta: PortaDaBranchEmpresa, pedido: AceiteDaInscricao): ResultadoInscricaoEmpresa<InscricaoDaEmpresa> {
  let resultado: InscricaoDaEmpresa | null = null;
  let falha: CodigoDaInscricaoEmpresa | null = null;
  const t = transacionarRedeEmpresa(porta, (ponta) => {
    const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
    if (politicaLida.estado !== 'presente') {
      falha = politicaLida.estado === 'ausente' ? 'rede-empresa.politica-ausente' : politicaLida.codigo;
      return null;
    }
    const atualLida = lerDocumentoRemoto(ponta, caminhoDaInscricao(pedido.inscricaoId), ehInscricaoDaEmpresa);
    if (atualLida.estado !== 'presente') {
      falha = atualLida.estado === 'ausente' ? 'rede-empresa.inscricao-ausente' : atualLida.codigo;
      return null;
    }
    const politica = politicaLida.valor, atual = atualLida.valor;
    if (politica.versao !== atual.politicaVersao) { falha = 'rede-empresa.politica-incompativel'; return null; }
    if (atual.estado !== 'pendente' && atual.estado !== 'ativa') { falha = 'rede-empresa.inscricao-inativa'; return null; }
    if (!mesmaConta(atual.maestroRef, pedido.conta, pedido.forja, pedido.host)) { falha = 'rede-empresa.identidade-divergente'; return null; }
    if (!mesmaRef(atual.rede, pedido.rede)) { falha = 'rede-empresa.rede-divergente'; return null; }
    if (!atual.projetos.every((p) => pedido.projetosAcessiveis.some((a) => mesmaRef(p, a)))) {
      falha = 'rede-empresa.projeto-nao-autorizado'; return null;
    }
    resultado = { ...atual, loginAtual: pedido.conta.login, estado: 'ativa', aceitaEm: atual.aceitaEm ?? pedido.agora, atualizadaEm: pedido.agora };
    return JSON.stringify(resultado) === JSON.stringify(atual) ? null : { mensagem: `rede empresa: aceita ${pedido.inscricaoId}`,
      mudancas: [{ caminho: caminhoDaInscricao(pedido.inscricaoId), conteudo: json(resultado) }] };
  });
  if (falha) return { ok: false, codigo: falha, transacao: t };
  const r = daTransacao(t, resultado!);
  if (r.ok) {
    const adesao: AdesaoRedeEmpresa = { inscricaoId: r.valor.inscricaoId, empresa: pedido.empresa, rede: r.valor.rede,
      maestroRef: r.valor.maestroRef, loginAtual: r.valor.loginAtual, politicaVersao: r.valor.politicaVersao,
      projetos: r.valor.projetos, estado: r.valor.estado, ultimaPublicacao: null, pendencia: null };
    gravarAdesaoRedeEmpresa(adesao, pedido.env);
  }
  return r;
}

function transicao(porta: PortaDaBranchEmpresa, inscricaoId: string, estado: 'revogada' | 'encerrada', agora: string,
  conta?: { conta: ContaNaForja; forja: MaestroRef['forja']; host: string }): ResultadoInscricaoEmpresa<InscricaoDaEmpresa> {
  let resultado: InscricaoDaEmpresa | null = null;
  let falha: CodigoDaInscricaoEmpresa | null = null;
  const t = transacionarRedeEmpresa(porta, (ponta) => {
    const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
    if (politicaLida.estado === 'invalido' || politicaLida.estado === 'indisponivel') { falha = politicaLida.codigo; return null; }
    const atualLida = lerDocumentoRemoto(ponta, caminhoDaInscricao(inscricaoId), ehInscricaoDaEmpresa);
    if (atualLida.estado !== 'presente') {
      falha = atualLida.estado === 'ausente' ? 'rede-empresa.inscricao-ausente' : atualLida.codigo;
      return null;
    }
    const politica = politicaLida.estado === 'presente' ? politicaLida.valor : null;
    const atual = atualLida.valor;
    if (estado === 'encerrada' && (!politica || politica.saida !== 'permitida')) { falha = 'rede-empresa.saida-negada'; return null; }
    if (conta && !mesmaConta(atual.maestroRef, conta.conta, conta.forja, conta.host)) { falha = 'rede-empresa.identidade-divergente'; return null; }
    if (atual.estado === estado) { resultado = atual; return null; }
    if (atual.estado !== 'ativa' && atual.estado !== 'pendente') { falha = 'rede-empresa.inscricao-inativa'; return null; }
    resultado = { ...atual, estado, atualizadaEm: agora };
    return { mensagem: `rede empresa: ${estado} ${inscricaoId}`,
      mudancas: [{ caminho: caminhoDaInscricao(inscricaoId), conteudo: json(resultado) }] };
  });
  if (falha) return { ok: false, codigo: falha, transacao: t };
  return daTransacao(t, resultado!);
}

export const revogarInscricaoEmpresa = (porta: PortaDaBranchEmpresa, inscricaoId: string, agora: string) =>
  transicao(porta, inscricaoId, 'revogada', agora);

export const sairDaRedeEmpresa = (porta: PortaDaBranchEmpresa, inscricaoId: string, agora: string,
  conta: ContaNaForja, forja: MaestroRef['forja'], host: string) =>
  transicao(porta, inscricaoId, 'encerrada', agora, { conta, forja, host });

export function resumoDoAceite(inscricao: InscricaoDaEmpresa, empresa: ReferenciaDaForja): {
  empresa: ReferenciaDaForja; politicaVersao: string; projetos: ReferenciaDaForja[]; maestroRef: MaestroRef;
  categorias: readonly string[] } {
  return { empresa, politicaVersao: inscricao.politicaVersao, projetos: inscricao.projetos, maestroRef: inscricao.maestroRef,
    categorias: ['itens', 'reservas', 'trabalhos', 'fontes', 'lacunas'] };
}
