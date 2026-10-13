/**
 * RM-058, fatia N3 (D1, D5, D6 e D7 da ork-rm058n3): o transporte entre as máquinas de um arco #Noctum.
 *
 * O meio é um ramo de estado no remoto do projeto, `ork/noctum-coordenacao`, gravado como as reservas da RM-047: commit em
 * cima da ponta lida e push sem força (`gravarNaBranch`). Duas máquinas que gravam juntas nunca perdem uma à outra: quem
 * perdeu a corrida relê e roda a regra de novo sobre o estado novo. Cada registro é assinado pela máquina que o escreveu,
 * com a chave Ed25519 derivada da chave local do núcleo (D5), e conferido com a chave que o dono autorizou no envelope
 * `v3` desta máquina. O retrato da rede (RM-053) e o da fábrica (RM-047) são descoberta: nada deles entra aqui.
 *
 * A leitura reprova inteira (D6): assinatura, caminho ou máquina que não conferem, arquivo apagado ou alterado (só a
 * batida é regravada, e nunca para trás no tempo) e história que não desce da última ponta vista por esta máquina recusam
 * a decisão com `noctum.coordenacao.adulterado`, sem usar a parte que conferiu. O registro de uma versão do envelope que
 * esta máquina ainda não autorizou é espera, não adulteração (`noctum.coordenacao.versao-nao-autorizada`). A última ponta
 * vista só avança depois que a leitura inteira conferiu, inclusive a coerência de quem chama. Sem leitura nova do remoto
 * nada é decidido (D7, `noctum.coordenacao.sem-remoto`): a cópia local do ramo nunca vira fato.
 *
 * Cada registro sai assinado sob a versão vigente aqui; o fim do que é desta máquina (recibo de fim, vaga solta, fim da
 * vez, entrega, revogação) sai também sob a última versão em que ela estava, depois de uma emenda que a tirou do arco. O
 * commit leva a identidade da máquina, nunca a do git de quem a usa.
 *
 * Limites ditos na página: a chave da máquina é legível pelo mesmo usuário do sistema, como a chave local da N1; quem tem
 * push no remoto pode apagar ou reescrever o ramo, e só a máquina que já viu o registro percebe.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign, verify } from 'node:crypto';
import { buscarBranch, exigirRemoto, gravarNaBranch, OpcoesDeGit } from './branch-de-estado';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { tentarTravaExclusiva } from './fila-pesada';
import { chaveLocal } from './hitl-local-receipt';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { versoesAutorizadas } from './noctum-arco';
import { canonico, ConteudoDoEnvelope, envelopeMultimaquina, ID_DO_ARCO, ID_DO_TRABALHO, RecusaDoArco } from './noctum-envelope';
import { redeDoFechamento } from './roadmap-reservas';

export const BRANCH_DE_COORDENACAO = 'ork/noctum-coordenacao';
export const CONTRATO_COORDENACAO = 'ork.noctum-coordenacao/v1' as const;
const CONTRATO_DA_VISTA = 'ork.noctum-coordenacao-vista/v1';
const PREFIXO = 'noctum';
const DOMINIO_DA_CHAVE = 'ork.noctum-maquina/v1';
/** O cabeçalho PKCS#8 de uma chave privada Ed25519; a semente de 32 bytes vem logo depois (o padrão do recibo público). */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export const TIPOS_DE_REGISTRO = ['autoridade', 'cessao', 'ordem', 'cancelamento', 'recibo', 'vaga', 'vaga-solta', 'vez', 'vez-fim',
  'entrega', 'batida', 'revogacao'] as const;
export type TipoDeRegistro = typeof TIPOS_DE_REGISTRO[number];
export const RECIBOS = ['aceita', 'recusada', 'concluida', 'encerrada'] as const;
export type TipoDeRecibo = typeof RECIBOS[number];

/** Tetos da leitura: um registro é um JSON curto, e um arco de uma noite não chega perto do número. */
export const TETO_DO_REGISTRO = 8 * 1024;
export const TETO_DE_REGISTROS = 10000;
/** Pushes recusados seguidos antes de desistir: o mesmo número das reservas da RM-047. */
export const TENTATIVAS_DE_GRAVAR = 5;

export const NOME_DE_MAQUINA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ID_DA_ORDEM = /^O-([a-z0-9][a-z0-9-]{0,31})-([1-9][0-9]{0,3})$/;
export const ID_DA_VAGA = /^V-([A-Za-z0-9][A-Za-z0-9._-]{0,63})-([1-9][0-9]{0,8})$/;
export const CHAVE_DO_DESTINO = /^[0-9a-f]{16}$/;

/** Os campos comuns de todo registro; o resto é do tipo e quem o confere é a coordenação. */
export interface DadosDoRegistro {
  contrato: typeof CONTRATO_COORDENACAO;
  tipo: TipoDeRegistro;
  arco: string;
  /** A versão autorizada do envelope sob a qual a máquina agiu. */
  envelopeSha256: string;
  /** A máquina que assina. */
  por: string;
  em: string;
  [campo: string]: unknown;
}

/** O que a regra de uma gravação devolve para cada registro novo: o tipo e os campos dele. */
export type CamposDoRegistro = { tipo: TipoDeRegistro } & Record<string, unknown>;

export interface RegistroLido { caminho: string; dados: DadosDoRegistro }

export interface VersaoDoEnvelope { versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope }

export interface LeituraDoRamo {
  arco: string;
  remoto: string;
  /** A ponta lida do remoto agora; `null` quando o ramo ainda não nasceu. */
  ponta: string | null;
  registros: RegistroLido[];
  /** As versões que o dono autorizou nesta máquina, na ordem do log; a última é a vigente. */
  versoes: VersaoDoEnvelope[];
  lidoEm: string;
}

export interface OpcoesDoTransporte {
  /** O remoto do ramo; sem ele, o `fabrica.remoto` do manifesto. */
  remoto?: string;
  /** O nome desta máquina; sem ele, a precedência de `nomeDaMaquina`. */
  maquina?: string;
  quando?: string;
  /** Prazo e ambiente do que vai à rede; sem ele, os do fechamento das reservas (15 s, git sem pergunta). */
  rede?: OpcoesDeGit;
}

const adulterado = (detalhe: string) => new RecusaDoArco('noctum.coordenacao.adulterado', `${detalhe}; o ramo de coordenação exige inspeção`);
const semRemoto = (detalhe: string) => new RecusaDoArco('noctum.coordenacao.sem-remoto', detalhe);
const foraDoEnvelope = (detalhe: string) => new RecusaDoArco('noctum.coordenacao.fora-do-envelope', detalhe);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const quatro = (n: unknown): string => {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 9999) throw adulterado(`número de registro inválido (${String(n)})`);
  return String(n).padStart(4, '0');
};
const primeiraLinha = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);

// ---------------------------------------------------------------------------
// Identidade da máquina (D5).
// ---------------------------------------------------------------------------

function chavePrivada(raiz: string): KeyObject {
  const semente = createHmac('sha256', chaveLocal(raiz, true)).update(DOMINIO_DA_CHAVE).digest();
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, semente]), format: 'der', type: 'pkcs8' });
}

/**
 * O nome e a chave pública Ed25519 (SPKI DER em base64) desta raiz de estado: é o que o dono põe em `maquinas` no envelope
 * `v3`. A chave privada nunca sai daqui; ela deriva da chave local do núcleo, que a raiz de estado guarda 0600.
 */
export function identidadeDaMaquina(raiz: string, nome?: string): { nome: string; chave: string } {
  return { nome: nomeDaMaquina(nome), chave: createPublicKey(chavePrivada(raiz)).export({ format: 'der', type: 'spki' }).toString('base64') };
}

export function assinarDados(raiz: string, dados: DadosDoRegistro): string {
  return sign(null, Buffer.from(canonico(dados), 'utf8'), chavePrivada(raiz)).toString('base64');
}

export function assinaturaConfere(chave: string, dados: unknown, assinatura: unknown): boolean {
  if (typeof assinatura !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(assinatura)) return false;
  try {
    const publica = createPublicKey({ key: Buffer.from(chave, 'base64'), format: 'der', type: 'spki' });
    return publica.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(canonico(dados), 'utf8'), publica, Buffer.from(assinatura, 'base64'));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// O caminho de cada registro sai dos dados dele.
// ---------------------------------------------------------------------------

/** O caminho do registro no ramo, recalculado dos dados; identificador fora do formato reprova. */
export function caminhoDoRegistro(d: DadosDoRegistro): string {
  if (typeof d.arco !== 'string' || !ID_DO_ARCO.test(d.arco)) throw adulterado('registro com arco inválido');
  const base = `arcos/${d.arco}`;
  const ordem = () => { if (typeof d.ordem !== 'string' || !ID_DA_ORDEM.test(d.ordem)) throw adulterado('registro com ordem inválida'); return d.ordem; };
  const vaga = () => { if (typeof d.vaga !== 'string' || !ID_DA_VAGA.test(d.vaga)) throw adulterado('registro com vaga inválida'); return d.vaga; };
  const chave = () => { if (typeof d.chave !== 'string' || !CHAVE_DO_DESTINO.test(d.chave)) throw adulterado('registro com destino inválido'); return d.chave; };
  switch (d.tipo) {
    case 'autoridade': return `${base}/autoridade/${quatro(d.geracao)}.json`;
    case 'cessao': return `${base}/cessoes/${quatro(d.geracao)}.json`;
    case 'ordem': return `${base}/ordens/${ordem()}.json`;
    case 'cancelamento': return `${base}/cancelamentos/${ordem()}.json`;
    case 'recibo':
      if (!(RECIBOS as readonly unknown[]).includes(d.recibo)) throw adulterado('recibo de tipo desconhecido');
      return `${base}/recibos/${ordem()}/${String(d.recibo)}.json`;
    case 'vaga': return `${base}/vagas/${vaga()}.json`;
    case 'vaga-solta': return `${base}/vagas/${vaga()}.solta.json`;
    case 'vez': return `${base}/integracao/${chave()}/${quatro(d.n)}.json`;
    case 'vez-fim': return `${base}/integracao/${chave()}/${quatro(d.n)}.fim.json`;
    case 'entrega':
      if (typeof d.trabalho !== 'string' || !ID_DO_TRABALHO.test(d.trabalho)) throw adulterado('entrega com trabalho inválido');
      return `${base}/entregas/${d.trabalho}.json`;
    case 'batida':
      if (typeof d.por !== 'string' || !NOME_DE_MAQUINA.test(d.por)) throw adulterado('batida com máquina inválida');
      return `${base}/batidas/${d.por}.json`;
    case 'revogacao':
      if (typeof d.por !== 'string' || !NOME_DE_MAQUINA.test(d.por)) throw adulterado('revogação com máquina inválida');
      return `${base}/revogacoes/${d.por}.json`;
    default: throw adulterado(`registro de tipo desconhecido (${String(d.tipo)})`);
  }
}

/** A batida é o único registro que a máquina regrava; todo o resto é só de acréscimo. */
const regravavel = (arco: string, caminho: string): boolean => new RegExp(`^arcos/${arco}/batidas/[^/]+[.]json$`).test(caminho);

// ---------------------------------------------------------------------------
// Git sem limite de saída pequeno: a árvore do arco e os blobs vêm de uma vez.
// ---------------------------------------------------------------------------

function gitBruto(raiz: string, args: string[], entrada?: string): { ok: boolean; saida: Buffer; erro: string } {
  const r = spawnSync('git', args, { cwd: raiz, input: entrada, maxBuffer: 256 * 1024 * 1024, timeout: 60000 });
  return { ok: r.status === 0 && !r.error, saida: r.stdout ?? Buffer.alloc(0), erro: (r.stderr ?? Buffer.alloc(0)).toString('utf8') };
}

/**
 * Os arquivos do arco na ponta: modo, objeto, tamanho e caminho. Só blob comum; link, executável ou submódulo reprovam, e o
 * tamanho confere antes de ler qualquer conteúdo (S5 da rodada 2: um blob enorme nunca entra na memória).
 */
function arquivosDaPonta(raiz: string, ponta: string, arco: string): Array<{ oid: string; caminho: string }> {
  const r = gitBruto(raiz, ['ls-tree', '-r', '-l', '-z', '--full-tree', ponta, '--', `arcos/${arco}/`]);
  if (!r.ok) throw semRemoto(`git ls-tree falhou: ${r.erro.trim().split('\n').pop() ?? ''}`);
  const entradas = r.saida.toString('utf8').split('\0').filter(Boolean);
  if (entradas.length > TETO_DE_REGISTROS) throw adulterado(`o arco tem ${entradas.length} registros, acima de ${TETO_DE_REGISTROS}`);
  return entradas.map((e) => {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)\t(.+)$/s.exec(e);
    if (!m || m[1] !== '100644' || m[2] !== 'blob') throw adulterado(`entrada que não é arquivo comum no ramo (${e.slice(0, 80)})`);
    if (Number(m[4]) > TETO_DO_REGISTRO) throw adulterado(`${m[5]} tem ${m[4]} bytes, acima de ${TETO_DO_REGISTRO}`);
    return { oid: m[3], caminho: m[5] };
  });
}

/** Os conteúdos dos blobs, numa chamada só de `git cat-file --batch`. */
function lerBlobs(raiz: string, oids: readonly string[]): Map<string, Buffer> {
  const conteudos = new Map<string, Buffer>();
  if (!oids.length) return conteudos;
  const r = gitBruto(raiz, ['cat-file', '--batch'], oids.join('\n') + '\n');
  if (!r.ok) throw semRemoto(`git cat-file falhou: ${r.erro.trim().split('\n').pop() ?? ''}`);
  let i = 0;
  for (const oid of oids) {
    const fim = r.saida.indexOf(0x0a, i);
    const cabeca = r.saida.subarray(i, fim).toString('utf8');
    const m = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(cabeca);
    if (!m || m[1] !== oid) throw adulterado(`blob ilegível no ramo (${cabeca.slice(0, 80)})`);
    const tamanho = Number(m[2]);
    if (tamanho > TETO_DO_REGISTRO) throw adulterado(`registro de ${tamanho} bytes, acima de ${TETO_DO_REGISTRO}`);
    conteudos.set(oid, r.saida.subarray(fim + 1, fim + 1 + tamanho));
    i = fim + 1 + tamanho + 1;
  }
  return conteudos;
}

// ---------------------------------------------------------------------------
// A última ponta vista por esta máquina (D6): a história só anda para a frente.
// ---------------------------------------------------------------------------

function dirDoArcoLocal(raiz: string, arco: string): string {
  if (typeof arco !== 'string' || !ID_DO_ARCO.test(arco)) throw new RecusaDoArco('noctum.envelope.invalido', 'identificador de arco inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum', 'arcos', arco]);
  const dir = path.join(principal, '.orkastery', 'noctum', 'arcos', arco);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * A última ponta vista por remoto e, quando esta máquina já viu o ramo adulterado, a marca (A-R2A-1 da rodada 2): a
 * detecção dura, e só a inspeção do dono a tira, apagando a última ponta vista.
 */
type Vista = Record<string, { ponta: string; vistoEm: string; adulterado?: { em: string; detalhe: string } }>;

function lerVista(dir: string): Vista {
  const arquivo = path.join(dir, 'coordenacao.json');
  let bruto: string;
  try {
    const fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) throw adulterado('a última ponta vista não é arquivo privado do núcleo');
      bruto = fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (e instanceof RecusaDoArco) throw e;
    throw adulterado('a última ponta vista não se lê');
  }
  let v: unknown;
  try { v = JSON.parse(bruto); } catch { throw adulterado('a última ponta vista não é JSON'); }
  if (!objeto(v) || v.contrato !== CONTRATO_DA_VISTA || !objeto(v.remotos)) throw adulterado('a última ponta vista fora do formato');
  const vista: Vista = {};
  for (const [remoto, x] of Object.entries(v.remotos)) {
    if (!objeto(x) || typeof x.ponta !== 'string' || !/^[0-9a-f]{40,64}$/.test(x.ponta) || typeof x.vistoEm !== 'string' ||
        (x.adulterado !== undefined && (!objeto(x.adulterado) || typeof x.adulterado.em !== 'string' || typeof x.adulterado.detalhe !== 'string'))) {
      throw adulterado('a última ponta vista fora do formato');
    }
    vista[remoto] = { ponta: x.ponta, vistoEm: x.vistoEm,
      ...(x.adulterado ? { adulterado: { em: x.adulterado.em as string, detalhe: x.adulterado.detalhe as string } } : {}) };
  }
  return vista;
}

function gravarVista(dir: string, vista: Vista): void {
  const temp = path.join(dir, `.coordenacao.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ contrato: CONTRATO_DA_VISTA, remotos: vista }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, path.join(dir, 'coordenacao.json'));
}

/** A trava curta da última ponta vista: dois processos desta máquina nunca a fazem andar para trás. */
function comTravaDaVista<T>(dir: string, executar: () => T): T {
  const prazo = Date.now() + 10000;
  for (;;) {
    const fd = tentarTravaExclusiva(path.join(dir, 'coordenacao.lock'));
    if (fd !== null) {
      try { return executar(); } finally { fs.closeSync(fd); }
    }
    if (Date.now() >= prazo) throw new RecusaDoArco('noctum.coordenacao.concorrencia', 'outro processo desta máquina segura a última ponta vista');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

const ancestral = (raiz: string, antigo: string, novo: string): boolean =>
  gitBruto(raiz, ['merge-base', '--is-ancestor', antigo, novo]).ok;

/** O `em` de um registro numa ponta, para comparar a batida antiga com a nova. */
function emDoRegistro(raiz: string, ponta: string, caminho: string): number {
  const r = gitBruto(raiz, ['show', `${ponta}:${caminho}`]);
  try { return Date.parse(String((JSON.parse(r.saida.toString('utf8')) as { dados: { em: string } }).dados.em)); } catch { return NaN; }
}

/**
 * Entre duas pontas da história, só acréscimo, salvo a batida, que nunca volta no tempo (D6 e S3 da revisão). Devolve a
 * violação que achou, `null` quando só houve acréscimo, ou `ilegivel` quando o diff não se leu.
 */
function violacaoDeAcrescimo(raiz: string, arco: string, de: string, para: string): string | null | 'ilegivel' {
  const diff = gitBruto(raiz, ['diff', '--name-status', '--no-renames', '-z', de, para, '--', `arcos/${arco}/`]);
  if (!diff.ok) return 'ilegivel';
  const partes = diff.saida.toString('utf8').split('\0').filter(Boolean);
  for (let i = 0; i + 1 < partes.length; i += 2) {
    const [status, caminho] = [partes[i], partes[i + 1]];
    if (status === 'A') continue;
    if (status === 'M' && regravavel(arco, caminho)) {
      if (!(emDoRegistro(raiz, para, caminho) >= emDoRegistro(raiz, de, caminho))) return `a batida ${caminho} voltou no tempo depois de vista`;
      continue;
    }
    return `o registro ${caminho} foi ${status === 'D' ? 'apagado' : 'alterado'} depois de visto`;
  }
  return null;
}

/**
 * Confere a ponta lida contra a última vista, com a trava da vista nas mãos de quem chama: `atras` quando outro processo
 * desta máquina já viu uma ponta mais nova e, entre as duas, só houve acréscimo (a leitura ficou velha, não adulterada).
 * Nos dois sentidos, o apagamento, a alteração e a história reescrita reprovam e marcam a vista (A-R2A-1 da rodada 2): o
 * que um processo desta máquina viu, nenhum outro faz esquecer.
 */
function relacaoComAVista(raiz: string, dir: string, remoto: string, arco: string, ponta: string | null, quando: string): 'ok' | 'atras' {
  const vista = lerVista(dir);
  const atual = vista[remoto];
  if (atual?.adulterado) {
    throw adulterado(`esta máquina já viu o ramo adulterado em ${atual.adulterado.em} (${atual.adulterado.detalhe}); a última ponta vista ` +
      'fica marcada até a inspeção');
  }
  const antiga = atual?.ponta ?? null;
  if (antiga === null) return 'ok';
  const reprovar = (detalhe: string): never => {
    gravarVista(dir, { ...vista, [remoto]: { ...atual!, adulterado: { em: quando, detalhe: detalhe.slice(0, 300) } } });
    throw adulterado(detalhe);
  };
  const conferir = (de: string, para: string): void => {
    const v = violacaoDeAcrescimo(raiz, arco, de, para);
    if (v === 'ilegivel') throw adulterado('o diff entre a última ponta vista e a nova não se lê');
    if (v) reprovar(v);
  };
  if (ponta === null) return reprovar(`o ramo ${BRANCH_DE_COORDENACAO} sumiu do remoto ${remoto} depois de visto`);
  if (ponta === antiga) return 'ok';
  if (ancestral(raiz, antiga, ponta)) { conferir(antiga, ponta); return 'ok'; }
  if (ancestral(raiz, ponta, antiga)) { conferir(ponta, antiga); return 'atras'; }
  return reprovar(`a história do ramo foi reescrita: a ponta ${ponta.slice(0, 12)} não desce da última vista ${antiga.slice(0, 12)}`);
}

/** Grava a ponta como a última vista; só com a trava da vista e depois de `relacaoComAVista` dizer `ok`. */
function gravarPonta(dir: string, remoto: string, ponta: string | null, quando: string): void {
  if (!ponta) return;
  const vista = lerVista(dir);
  if (vista[remoto]?.ponta === ponta) return;
  gravarVista(dir, { ...vista, [remoto]: { ponta, vistoEm: quando } });
}

/**
 * Avança a última ponta vista para o commit que esta máquina acabou de gravar, conferido nos dois sentidos contra a vista
 * de agora (outro processo pode ter visto uma ponta mais nova, e o registro gravado aqui não pode ter sumido dela).
 */
function avancarVista(raiz: string, dir: string, remoto: string, arco: string, ponta: string, quando: string): void {
  comTravaDaVista(dir, () => {
    if (relacaoComAVista(raiz, dir, remoto, arco, ponta, quando) === 'ok') gravarPonta(dir, remoto, ponta, quando);
  });
}

// ---------------------------------------------------------------------------
// Leitura e gravação.
// ---------------------------------------------------------------------------

function remotoDe(carregado: ManifestoCarregado, opcoes: OpcoesDoTransporte): string {
  try { return exigirRemoto(opcoes.remoto ?? carregado.manifesto.fabrica.remoto, PREFIXO); }
  catch (e) { throw semRemoto(primeiraLinha(e)); }
}

const redeDe = (raiz: string, opcoes: OpcoesDoTransporte): OpcoesDeGit => opcoes.rede ?? redeDoFechamento(raiz);

/** As versões autorizadas aqui que são de várias máquinas, pelo hash: só elas assinam no ramo. */
function chavesPorVersao(versoes: readonly VersaoDoEnvelope[]): Map<string, Map<string, string>> {
  const porHash = new Map<string, Map<string, string>>();
  for (const v of versoes) {
    if (envelopeMultimaquina(v.conteudo)) porHash.set(v.envelopeSha256, new Map(v.conteudo.maquinas.map(m => [m.nome, m.chave])));
  }
  return porHash;
}

function lerUmaVez(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoTransporte,
  conferir?: (leitura: LeituraDoRamo) => void): LeituraDoRamo | 'atras' {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? new Date().toISOString();
  const remoto = remotoDe(carregado, opcoes);
  const versoes = versoesAutorizadas(raiz, arco);
  if (!versoes.length) throw foraDoEnvelope(`o arco ${arco} não tem envelope autorizado nesta máquina`);
  const dir = dirDoArcoLocal(raiz, arco);
  const chaves = chavesPorVersao(versoes);
  const rede = redeDe(raiz, opcoes);
  let lida: { ponta: string | null; atualizado: boolean };
  try { lida = buscarBranch(raiz, remoto, BRANCH_DE_COORDENACAO, PREFIXO, rede.timeoutMs, rede.env); }
  catch (e) { throw semRemoto(primeiraLinha(e)); }
  if (!lida.atualizado) throw semRemoto(`não consegui ler ${BRANCH_DE_COORDENACAO} em ${remoto}; sem leitura nova, nada é decidido`);
  const registros: RegistroLido[] = [];
  if (lida.ponta) {
    const arquivos = arquivosDaPonta(raiz, lida.ponta, arco);
    const blobs = lerBlobs(raiz, arquivos.map(a => a.oid));
    for (const { oid, caminho } of arquivos) {
      let bruto: unknown;
      try { bruto = JSON.parse(blobs.get(oid)!.toString('utf8')); } catch { throw adulterado(`${caminho} não é JSON`); }
      if (!objeto(bruto) || Object.keys(bruto).sort().join(',') !== 'assinatura,dados' || !objeto(bruto.dados)) {
        throw adulterado(`${caminho} fora do formato`);
      }
      const d = bruto.dados as DadosDoRegistro;
      if (d.contrato !== CONTRATO_COORDENACAO || d.arco !== arco || !(TIPOS_DE_REGISTRO as readonly unknown[]).includes(d.tipo) ||
          typeof d.em !== 'string' || !Number.isFinite(Date.parse(d.em))) {
        throw adulterado(`${caminho} fora do contrato`);
      }
      const daVersao = typeof d.envelopeSha256 === 'string' ? chaves.get(d.envelopeSha256) : undefined;
      // A3 da revisão: a emenda que a outra máquina já autorizou e esta ainda não é espera, não adulteração.
      if (!daVersao) {
        throw new RecusaDoArco('noctum.coordenacao.versao-nao-autorizada', `${caminho} é de uma versão do envelope que esta máquina ` +
          'ainda não autorizou: se o dono autorizou uma emenda em outra máquina, autorize-a aqui; se não houve emenda, o ramo exige ' +
          'inspeção. Até lá, esta máquina não decide nem grava no ramo');
      }
      const chave = typeof d.por === 'string' ? daVersao.get(d.por) : undefined;
      if (!chave) throw adulterado(`${caminho} assinado por uma máquina fora do envelope (${String(d.por).slice(0, 64)})`);
      if (!assinaturaConfere(chave, d, bruto.assinatura)) throw adulterado(`${caminho} com assinatura que não confere`);
      if (caminhoDoRegistro(d) !== caminho) throw adulterado(`${caminho} não é o caminho dos dados dele`);
      registros.push({ caminho, dados: d });
    }
  }
  const leitura: LeituraDoRamo = { arco, remoto, ponta: lida.ponta, registros, versoes, lidoEm: quando };
  // A2 da revisão e A-R2A-1 da rodada 2: a história, a coerência de quem chama e o avanço da vista numa seção crítica só.
  // Nenhum outro processo desta máquina avança a vista entre conferir e gravar, e a vista só anda depois da coerência.
  return comTravaDaVista(dir, () => {
    if (relacaoComAVista(raiz, dir, remoto, arco, lida.ponta, quando) === 'atras') return 'atras' as const;
    conferir?.(leitura);
    gravarPonta(dir, remoto, lida.ponta, quando);
    return leitura;
  });
}

/**
 * A leitura conferida do ramo de coordenação do arco, nova do remoto. Lança a recusa tipada; nunca devolve leitura
 * parcial. Outro processo desta máquina que já viu uma ponta mais nova faz esta ler de novo; a ponta que continua atrás da
 * última vista depois de três leituras é o ramo que voltou atrás (push forçado para um commit antigo), e reprova.
 */
export function lerRamo(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoTransporte = {},
  conferir?: (leitura: LeituraDoRamo) => void): LeituraDoRamo {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const lida = lerUmaVez(carregado, arco, opcoes, conferir);
    if (lida !== 'atras') return lida;
  }
  throw adulterado('a história do ramo foi reescrita: a ponta do remoto voltou para trás da última vista por esta máquina');
}

/** A versão vigente aqui (a última autorizada) e esta máquina nela, com o mesmo nome e a mesma chave; senão, a recusa. */
export function euNaVersaoVigente(raiz: string, leitura: LeituraDoRamo, opcoes: OpcoesDoTransporte):
  { eu: { nome: string; chave: string }; vigente: VersaoDoEnvelope } {
  const vigente = leitura.versoes.at(-1)!;
  if (!envelopeMultimaquina(vigente.conteudo)) {
    throw foraDoEnvelope(`o envelope vigente do arco ${leitura.arco} é ${vigente.conteudo.contrato}, sem máquinas: só a v3 coordena`);
  }
  const eu = identidadeDaMaquina(raiz, opcoes.maquina);
  const listada = vigente.conteudo.maquinas.find(m => m.nome === eu.nome);
  if (!listada) throw foraDoEnvelope(`a máquina ${eu.nome} não está no envelope vigente do arco ${leitura.arco}`);
  if (listada.chave !== eu.chave) throw foraDoEnvelope(`a chave desta raiz não é a que o envelope dá à máquina ${eu.nome}`);
  return { eu, vigente };
}

/** Os registros com que uma máquina fecha o que é dela; só eles saem sob uma versão anterior do envelope (A4 da revisão). */
const ehFechamento = (c: CamposDoRegistro): boolean => c.tipo === 'vaga-solta' || c.tipo === 'vez-fim' || c.tipo === 'entrega' ||
  c.tipo === 'revogacao' || (c.tipo === 'recibo' && (c.recibo === 'concluida' || c.recibo === 'encerrada'));

/**
 * A versão sob a qual esta máquina assina: a vigente; ou, quando uma emenda a tirou do arco, a última versão autorizada em
 * que ela está com a mesma chave, e só para fechar o que é dela (fim de ordem, vaga, vez e entrega). O leitor confere cada
 * registro com as chaves da versão que ele diz.
 */
function versaoParaAssinar(raiz: string, leitura: LeituraDoRamo, opcoes: OpcoesDoTransporte, novos: readonly CamposDoRegistro[]):
  { eu: { nome: string; chave: string }; vigente: VersaoDoEnvelope } {
  try { return euNaVersaoVigente(raiz, leitura, opcoes); }
  catch (e) {
    if (!(e instanceof RecusaDoArco) || e.motivo !== 'noctum.coordenacao.fora-do-envelope' || !novos.every(ehFechamento)) throw e;
    const eu = identidadeDaMaquina(raiz, opcoes.maquina);
    const antiga = [...leitura.versoes].reverse().find(v => envelopeMultimaquina(v.conteudo) &&
      v.conteudo.maquinas.some(m => m.nome === eu.nome && m.chave === eu.chave));
    if (!antiga) throw e;
    return { eu, vigente: antiga };
  }
}

/** A identidade dos commits do ramo de coordenação: a máquina, num domínio reservado que não entrega e-mail. */
export const identidadeDoCommit = (maquina: string): { nome: string; email: string } => ({ nome: `ork-noctum ${maquina}`, email: 'ork-noctum@noctum.invalid' });

export interface ResultadoDaGravacao<T> {
  resultado: T;
  /** O commit novo do ramo, ou `null` quando a regra não tinha nada a gravar. */
  commit: string | null;
  /** Os registros gravados, já com os campos comuns. */
  gravados: DadosDoRegistro[];
  /** A leitura sobre a qual a regra rodou da última vez. */
  leitura: LeituraDoRamo;
}

/**
 * Grava os registros que a regra pede, assinados por esta máquina sob a versão vigente do envelope, numa versão nova do
 * ramo em cima da ponta lida. Push recusado: relê e roda a regra de novo, até `TENTATIVAS_DE_GRAVAR`. A regra pode lançar a
 * recusa tipada e deve ser idempotente, porque um push de resultado incerto é repetido sobre a leitura seguinte.
 */
export function gravarNoRamo<T>(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoTransporte,
  regra: (leitura: LeituraDoRamo) => { novos: CamposDoRegistro[]; resultado: T }, conferir?: (leitura: LeituraDoRamo) => void): ResultadoDaGravacao<T> {
  const { raiz } = carregado;
  const quando = opcoes.quando ?? new Date().toISOString();
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_GRAVAR; tentativa++) {
    const leitura = lerRamo(carregado, arco, { ...opcoes, quando }, conferir);
    const { novos, resultado } = regra(leitura);
    if (!novos.length) return { resultado, commit: null, gravados: [], leitura };
    const { eu, vigente } = versaoParaAssinar(raiz, leitura, opcoes, novos);
    const existentes = new Set(leitura.registros.map(r => r.caminho));
    const mudancas: Array<{ caminho: string; conteudo: string }> = [];
    const gravados: DadosDoRegistro[] = [];
    for (const campos of novos) {
      // B1 da rodada 2: o que se assina é o que o leitor vai ler, sem campo `undefined` nem objeto que o JSON transforma.
      const dados = JSON.parse(JSON.stringify({ ...campos, contrato: CONTRATO_COORDENACAO, arco, envelopeSha256: vigente.envelopeSha256,
        por: eu.nome, em: quando })) as DadosDoRegistro;
      const caminho = caminhoDoRegistro(dados);
      // S3 da revisão: a batida desta máquina nunca volta no tempo, nem quando o relógio daqui volta.
      const anterior = dados.tipo === 'batida' ? leitura.registros.find(r => r.caminho === caminho)?.dados.em : undefined;
      if (anterior && Date.parse(anterior) > Date.parse(quando)) dados.em = anterior;
      if ((existentes.has(caminho) && !regravavel(arco, caminho)) || mudancas.some(m => m.caminho === caminho)) {
        throw new RecusaDoArco('noctum.coordenacao.concorrencia', `o registro ${caminho} já existe; a regra não é idempotente nele`);
      }
      const conteudo = JSON.stringify({ dados, assinatura: assinarDados(raiz, dados) }) + '\n';
      if (Buffer.byteLength(conteudo) > TETO_DO_REGISTRO) throw new RecusaDoArco('noctum.envelope.invalido', `o registro ${caminho} passa de ${TETO_DO_REGISTRO} bytes`);
      mudancas.push({ caminho, conteudo });
      gravados.push(dados);
    }
    // B1 da rodada 2: quem grava confere com a régua de quem lê, em memória e antes do push. O registro que as máquinas
    // reprovariam (e que travaria o arco em todas) fica aqui, como pedido inválido, e nada vai ao ramo.
    if (conferir) {
      const trocados = new Set(mudancas.map(m => m.caminho));
      const projetada: LeituraDoRamo = { ...leitura, registros: [...leitura.registros.filter(r => !trocados.has(r.caminho)),
        ...gravados.map((dados, i) => ({ caminho: mudancas[i].caminho, dados }))] };
      try { conferir(projetada); }
      catch (e) {
        if (!(e instanceof RecusaDoArco) || e.motivo !== 'noctum.coordenacao.adulterado') throw e;
        const porque = e.message.slice(`${e.motivo}: `.length).replace(/; o ramo de coordenação exige inspeção$/, '');
        throw new RecusaDoArco('noctum.envelope.invalido', `as máquinas reprovariam o que esta gravação pede (${porque}); nada foi ao ramo`);
      }
    }
    const tipos = [...new Set(gravados.map(g => g.tipo))].join(', ');
    let commit: string | false;
    try {
      // S6 da revisão: o commit leva o nome da máquina, nunca o nome e o e-mail do git de quem a usa.
      commit = gravarNaBranch(raiz, leitura.remoto, BRANCH_DE_COORDENACAO, leitura.ponta, mudancas,
        `noctum: ${arco}, ${tipos} por ${eu.nome}`, PREFIXO, redeDe(raiz, opcoes), identidadeDoCommit(eu.nome));
    } catch (e) { throw semRemoto(primeiraLinha(e)); }
    if (commit) {
      avancarVista(raiz, dirDoArcoLocal(raiz, arco), leitura.remoto, arco, commit, quando);
      return { resultado, commit, gravados, leitura };
    }
  }
  throw new RecusaDoArco('noctum.coordenacao.concorrencia', `${TENTATIVAS_DE_GRAVAR} pushes recusados seguidos no ramo de coordenação; tente de novo em instantes`);
}

/** As cabeças das branches pedidas no remoto, numa chamada de `git ls-remote`, só leitura. */
export function cabecasNoRemoto(carregado: ManifestoCarregado, branches: readonly string[], opcoes: OpcoesDoTransporte = {}): Map<string, string | null> {
  const { raiz } = carregado;
  const remoto = remotoDe(carregado, opcoes);
  const rede = redeDe(raiz, opcoes);
  const r = spawnSync('git', ['ls-remote', '--', remoto, ...branches.map(b => `refs/heads/${b}`)],
    { cwd: raiz, encoding: 'utf8', timeout: rede.timeoutMs ?? 15000, env: { ...process.env, ...rede.env } });
  if (r.status !== 0 || r.error) throw semRemoto(`git ls-remote falhou em ${remoto}: ${(r.stderr ?? '').trim().split('\n').pop() ?? ''}`);
  const cabecas = new Map<string, string | null>(branches.map(b => [b, null]));
  for (const linha of String(r.stdout).split('\n')) {
    const m = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(linha.trim());
    if (m && cabecas.has(m[2])) cabecas.set(m[2], m[1]);
  }
  return cabecas;
}
