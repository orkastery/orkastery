/**
 * O contrato neutro da forja. Os tipos abaixo moram aqui e `forja.ts` os
 * reexporta com o mesmo nome; nenhum depende de `gh` ou `glab`.
 */

export type TipoDeForja = 'github' | 'gitlab';

/** Os tipos de forja que o registro conhece, na ordem em que a sondagem os tenta. Sem import: o manifesto o le. */
export const TIPOS_DE_FORJA: readonly TipoDeForja[] = ['github', 'gitlab'];

/** O repositorio na forja: `repo` e `dono/nome` no GitHub e o caminho completo no GitLab. */
export interface IdentidadeDaForja { tipo: TipoDeForja; host: string; repo: string }

export type CodigoDeErroDaForja = 'forja.ausente' | 'forja.sem-login' | 'forja.nao-encontrado' | 'forja.tempo-esgotado'
  | 'forja.inacessivel' | 'forja.resposta-invalida'
  // A chamada a API (`forja/api.ts`), pelo status HTTP e pela lista paginada.
  | 'forja.sem-permissao' | 'forja.nao-achei' | 'forja.limite' | 'forja.conflito' | 'forja.indisponivel' | 'forja.pedido-recusado'
  | 'forja.incompleto'
  // A identidade, as capacidades e a versao da forja.
  | 'forja.desconhecida' | 'forja.ambigua' | 'forja.remoto-divergente' | 'forja.sem-capacidade' | 'forja.versao-abaixo-do-piso';

/** `tentarEm` (ISO) so no `forja.limite`: do `Retry-After` ou do reset da cota. */
export interface ErroDaForja { codigo: CodigoDeErroDaForja; detalhe: string; tentarEm?: string }

/** De onde veio um valor da identidade: o bloco `forja:`, o remoto, a sondagem pela CLI ou o padrao. */
export type OrigemDoValor = 'manifesto' | 'remoto' | 'sondagem' | 'padrao';

/** A forja do projeto, resolvida do bloco `forja:`, do remoto e da sondagem (`forja/resolver.ts`). */
export interface ForjaResolvida {
  tipo: TipoDeForja;
  /** O host da web e da API, sem porta, em minusculas. */
  host: string;
  /** A porta HTTPS da web e da API; `null` e a padrao. */
  porta: number | null;
  /** O subcaminho da instancia (`/gitlab`), sem barra final; `''` sem subcaminho. */
  caminhoBase: string;
  /** O host e a porta do SSH; `null` e o proprio host e a porta 22. */
  sshHost: string | null;
  sshPorta: number | null;
  /** O arquivo PEM da CA interna; `null` usa a CA do sistema. */
  ca: string | null;
  /** O caminho completo do projeto, sem o caminho base: `dono/nome` ou `grupo/sub/projeto`. */
  repo: string;
  /** De onde veio cada valor, para o `doctor` mostrar. */
  origem: { tipo: OrigemDoValor; host: OrigemDoValor; porta: OrigemDoValor; caminhoBase: OrigemDoValor };
}

export interface SaidaDoExecutor { status: number | null; stdout: string; stderr: string; sinal?: string | null; erro?: string }

/** Quem roda a CLI da forja. Os testes trocam por uma resposta gravada. */
export type ExecutorDaForja = (cmd: 'gh' | 'glab', args: readonly string[], entrada: string, timeoutMs: number) => SaidaDoExecutor;

export type EstadoDoCheck = 'verde' | 'vermelho' | 'pendente' | 'bloqueado';
export type FonteDoCheck = 'check-run' | 'commit-status' | 'pipeline-job';
/** Um check de um commit, na forma neutra. `ordem` desempata o mais novo (id numerico da forja). */
export interface CheckNoCommit {
  nome: string; fonte: FonteDoCheck; produtor: string | null; status: string; conclusao: string | null;
  url: string | null; concluidoEm: string | null; ordem: number;
}
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: ErroDaForja };

/** Um pedido de mesclagem (PR/MR) lido da forja, na forma neutra. `null` nos campos que a resposta não trouxe válidos. */
export interface PedidoMesclado {
  numero: number; mesclado: boolean; mergeSha: string | null; headSha: string | null; base: string | null;
  branch: string | null; titulo: string | null; corpo: string | null; url: string | null;
}
