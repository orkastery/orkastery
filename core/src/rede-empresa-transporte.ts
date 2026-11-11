/** RM-089 F1: CAS da branch única, injetável para a suíte hermética. */
import { buscarBranch, git, gravarNaBranch, MudancaNaBranch, OpcoesDeGit } from './branch-de-estado';

export const BRANCH_DA_REDE_EMPRESA = 'main';
export const TENTATIVAS_DA_REDE_EMPRESA = 5;
const CAMINHO = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json$/;

export interface PontaDaRedeEmpresa {
  id: string | null;
  atualizada: boolean;
  ler(caminho: string): string | null;
  /** Uma enumeração em lote da mesma snapshot; nunca busca a branch de novo. */
  listar?(prefixo: string): Array<{ caminho: string; conteudo: string }>;
}

export interface PortaDaBranchEmpresa {
  ler(): PontaDaRedeEmpresa;
  gravar(ponta: string | null, mudancas: readonly MudancaNaBranch[], mensagem: string): string | false;
}

export const CODIGO_DOCUMENTO_REMOTO_INVALIDO = 'rede-empresa.documento-remoto-invalido' as const;
export type CodigoDocumentoRemotoInvalido = typeof CODIGO_DOCUMENTO_REMOTO_INVALIDO;

export type LeituraDocumentoRemoto<T> =
  | { estado: 'presente'; valor: T }
  | { estado: 'ausente' }
  | { estado: 'invalido'; codigo: CodigoDocumentoRemotoInvalido }
  | { estado: 'indisponivel'; codigo: 'rede-empresa.forja-indisponivel' };

export class ErroDocumentoRemotoInvalido extends Error {
  readonly codigo = CODIGO_DOCUMENTO_REMOTO_INVALIDO;
  constructor() { super(CODIGO_DOCUMENTO_REMOTO_INVALIDO); }
}

/** Lê documento não confiável sem converter JSON/contrato inválido em ausência nem ecoar seu conteúdo. */
export function lerDocumentoRemoto<T>(ponta: PontaDaRedeEmpresa, caminho: string,
  valido: (valor: unknown) => valor is T): LeituraDocumentoRemoto<T> {
  if (!ponta.atualizada) return { estado: 'indisponivel', codigo: 'rede-empresa.forja-indisponivel' };
  let texto: string | null;
  try { texto = ponta.ler(caminho); }
  catch { return { estado: 'indisponivel', codigo: 'rede-empresa.forja-indisponivel' }; }
  if (texto === null) return { estado: 'ausente' };
  try {
    const valor = JSON.parse(texto) as unknown;
    return valido(valor) ? { estado: 'presente', valor }
      : { estado: 'invalido', codigo: CODIGO_DOCUMENTO_REMOTO_INVALIDO };
  } catch {
    return { estado: 'invalido', codigo: CODIGO_DOCUMENTO_REMOTO_INVALIDO };
  }
}

export type ResultadoDaTransacaoEmpresa =
  | { acao: 'publicou'; commit: string; tentativas: number }
  | { acao: 'sem-mudanca'; commit: string | null; tentativas: number }
  | { acao: 'pendente'; commit: string | null; tentativas: number; codigo: 'rede-empresa.forja-indisponivel' }
  | { acao: 'falhou'; commit: null; tentativas: number; codigo: 'rede-empresa.concorrencia' };

export interface MudancaDaRedeEmpresa { mudancas: readonly MudancaNaBranch[]; mensagem: string }

export function caminhoDaPublicacao(inscricaoId: string, projetoRef: string): string {
  const seguro = (v: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
  if (!seguro(inscricaoId) || !seguro(projetoRef)) throw new Error('rede-empresa.caminho-invalido');
  return `publicacoes/${inscricaoId}/${projetoRef}.json`;
}

function validarMudancas(mudancas: readonly MudancaNaBranch[]): void {
  if (!mudancas.length || mudancas.some((m) => !CAMINHO.test(m.caminho))) throw new Error('rede-empresa.caminho-invalido');
  if (new Set(mudancas.map((m) => m.caminho)).size !== mudancas.length) throw new Error('rede-empresa.caminho-repetido');
}

/** Recalcula em toda ponta; o callback anterior nunca é reaproveitado depois de push recusado. */
export function transacionarRedeEmpresa(porta: PortaDaBranchEmpresa,
  preparar: (ponta: PontaDaRedeEmpresa) => MudancaDaRedeEmpresa | null): ResultadoDaTransacaoEmpresa {
  for (let tentativa = 1; tentativa <= TENTATIVAS_DA_REDE_EMPRESA; tentativa++) {
    const ponta = porta.ler();
    if (!ponta.atualizada) return { acao: 'pendente', commit: ponta.id, tentativas: tentativa, codigo: 'rede-empresa.forja-indisponivel' };
    const mudanca = preparar(ponta);
    if (!mudanca) return { acao: 'sem-mudanca', commit: ponta.id, tentativas: tentativa };
    validarMudancas(mudanca.mudancas);
    const commit = porta.gravar(ponta.id, mudanca.mudancas, mudanca.mensagem);
    if (commit) return { acao: 'publicou', commit, tentativas: tentativa };
  }
  return { acao: 'falhou', commit: null, tentativas: TENTATIVAS_DA_REDE_EMPRESA, codigo: 'rede-empresa.concorrencia' };
}

/** Adaptador real do CAS para um cache Git já preparado e autenticado. */
export function portaGitDaRedeEmpresa(cache: string, remoto = 'origin', rede: OpcoesDeGit = {}): PortaDaBranchEmpresa {
  return {
    ler() {
      const lida = buscarBranch(cache, remoto, BRANCH_DA_REDE_EMPRESA, 'rede-empresa', rede.timeoutMs, rede.env);
      return { id: lida.ponta, atualizada: lida.atualizado,
        ler(caminho: string) {
          if (!CAMINHO.test(caminho) || !lida.ponta) return null;
          const r = git(cache, ['show', `${lida.ponta}:${caminho}`]);
          return r.ok ? r.stdout : null;
        },
        listar(prefixo: string) {
          if (!lida.ponta || !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\/$/.test(prefixo)) return [];
          const arvore = git(cache, ['ls-tree', '-r', lida.ponta, '--', prefixo], rede);
          if (!arvore.ok) return [];
          const entradas = arvore.stdout.split('\n').flatMap((linha) => {
            const m = /^[0-7]+ blob ([0-9a-f]{7,64})\t(.+\.json)$/.exec(linha);
            return m && CAMINHO.test(m[2]) ? [{ sha: m[1], caminho: m[2] }] : [];
          });
          if (!entradas.length) return [];
          const lote = git(cache, ['cat-file', '--batch'], { ...rede, input: `${entradas.map((e) => e.sha).join('\n')}\n` });
          if (!lote.ok) return [];
          const bytes = Buffer.from(lote.stdout, 'utf8');
          let offset = 0;
          const saida: Array<{ caminho: string; conteudo: string }> = [];
          for (const entrada of entradas) {
            const fimCabecalho = bytes.indexOf(10, offset);
            if (fimCabecalho < 0) return [];
            const cabecalho = bytes.subarray(offset, fimCabecalho).toString('utf8');
            const m = /^[0-9a-f]+ blob (\d+)$/.exec(cabecalho);
            if (!m) return [];
            const tamanho = Number(m[1]);
            const inicio = fimCabecalho + 1, fim = inicio + tamanho;
            if (!Number.isSafeInteger(tamanho) || fim >= bytes.length) return [];
            saida.push({ caminho: entrada.caminho, conteudo: bytes.subarray(inicio, fim).toString('utf8') });
            offset = fim + 1;
          }
          return saida;
        } };
    },
    gravar(ponta, mudancas, mensagem) {
      return gravarNaBranch(cache, remoto, BRANCH_DA_REDE_EMPRESA, ponta, mudancas, mensagem, 'rede-empresa', rede,
        { nome: 'Orkastery Network', email: 'network@users.noreply.invalid' });
    },
  };
}
