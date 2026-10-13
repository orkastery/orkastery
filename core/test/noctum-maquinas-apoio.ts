/**
 * RM-058 (N3): o apoio comum dos testes entre máquinas. Chaves, contas, máquinas e pedidos são SIMULADOS; as "máquinas"
 * são raízes de estado de teste, e nada toca remoto, reserva ou raiz de verdade.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { buscarBranch, gravarNaBranch } from '../src/branch-de-estado';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { CONTRATO_ENVELOPE_V3 } from '../src/noctum-envelope';
import { BRANCH_DE_COORDENACAO, identidadeDaMaquina } from '../src/noctum-transporte';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario } from './apoio';
import { autorizarPedido, OpcoesDoArco, pedidoV2, TrabalhoSimulado } from './noctum-apoio';

/** Uma chave pública Ed25519 SIMULADA e estável, derivada só do nome dado (SPKI DER em base64). */
export function chaveSimulada(semente: string): string {
  const seed = createHash('sha256').update(`chave-SIMULADA-do-teste:${semente}`).digest();
  const privada = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8' });
  return createPublicKey(privada).export({ format: 'der', type: 'spki' }).toString('base64');
}

export interface OpcoesDoArcoV3 extends OpcoesDoArco {
  trabalhos: Array<TrabalhoSimulado & { maquina?: string }>;
  maquinas: Array<{ nome: string; chave: string }>;
  /** As permissões no destino `exemplo/produto`; sem elas, push, PR e merge (o merge só com a vez de integrar). */
  permissoes?: string[];
  /** O limite de cada conta somando as máquinas; sem ele, o mesmo de cada máquina (o mais apertado que o contrato aceita). */
  global?: Array<{ conta: string; sessoes: number }>;
}

/** O pedido de abertura `v3`: o `v2` do apoio da N2 mais as máquinas e o limite global. Os trabalhos vêm como dados. */
export function pedidoV3(arco: string, o: OpcoesDoArcoV3): Record<string, unknown> {
  const v2 = pedidoV2(arco, o);
  const capacidade = v2.capacidade as { porConta: Array<{ conta: string; sessoes: number }> };
  return { ...v2, contrato: CONTRATO_ENVELOPE_V3, maquinas: o.maquinas.map(m => ({ ...m })),
    destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: o.permissoes ?? ['push', 'pr', 'merge'] }],
    capacidadeGlobal: { porConta: o.global ?? capacidade.porConta.map(c => ({ conta: c.conta, sessoes: c.sessoes })) } };
}

// ---------------------------------------------------------------------------
// Duas máquinas: dois clones do mesmo remoto de fixture, cada um com a própria raiz de estado.
// ---------------------------------------------------------------------------

export const MAQUINA_A = 'maquina-a';
export const MAQUINA_B = 'maquina-b';

export interface MaquinaDeTeste { nome: string; dir: string; carregado: ManifestoCarregado }

export interface DuasMaquinas {
  a: MaquinaDeTeste;
  b: MaquinaDeTeste;
  /** O repositório bare que serve de `origin` aos dois clones. */
  remoto: string;
  arco: string;
  /** O hash do envelope que o dono autorizou nas duas raízes. */
  hash: string;
  /** O pedido de abertura, para uma emenda no teste. */
  pedido: Record<string, unknown>;
  limpar: () => void;
}

/** O segundo clone ganha identidade de git própria e a pasta de estado que o `ork init` criaria (ela não vai ao git). */
export function cloneDoRemoto(remoto: string, nome: string, usuario: string): string {
  const dir = path.join(dirTemporario(nome), 'clone');
  exec('git', ['clone', '-q', remoto, dir]);
  exec('git', ['config', 'user.email', `${usuario.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@orkastery.local`], dir);
  exec('git', ['config', 'user.name', usuario], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.mkdirSync(path.join(dir, '.orkastery', 'threads'), { recursive: true });
  return dir;
}

/**
 * O projeto com os itens do roadmap no remoto, a máquina A (o clone que criou) e a máquina B (outro clone), e o mesmo
 * envelope `v3` autorizado pelo ingresso simulado nas duas raízes. Nada sai da pasta temporária.
 */
export function duasMaquinas(nome: string, o: Omit<OpcoesDoArcoV3, 'maquinas'> & { arco?: string }): DuasMaquinas {
  const p = projetoTemporario(nome, true);
  const itens = [...new Set(o.trabalhos.map(t => t.item))];
  for (const item of itens) commitar(p.dir, `docs/roadmap/${item}-simulado.md`, `# ${item} SIMULADO\n`, `roadmap: ${item}`);
  // O manifesto vai junto: a outra máquina clona um projeto do ork.
  const versionados = ['orkastery.yaml', 'AGENTS.md'].filter(f => fs.existsSync(path.join(p.dir, f)));
  assert.ok(exec('git', ['add', '--', ...versionados], p.dir).ok);
  assert.ok(exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir).ok);
  assert.ok(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok);
  const b = cloneDoRemoto(p.remoto as string, `${nome}-b`, 'Builder B');
  const arco = o.arco ?? 'arco-n3';
  const maquinas = [identidadeDaMaquina(p.dir, MAQUINA_A), identidadeDaMaquina(b, MAQUINA_B)];
  const pedido = pedidoV3(arco, { ...o, maquinas });
  const hash = autorizarPedido(p.dir, arco, pedido);
  assert.equal(autorizarPedido(b, arco, pedido), hash, 'o mesmo envelope nas duas raízes');
  return {
    a: { nome: MAQUINA_A, dir: p.dir, carregado: exigirManifesto(p.dir) },
    b: { nome: MAQUINA_B, dir: b, carregado: exigirManifesto(b) },
    remoto: p.remoto as string, arco, hash, pedido,
    limpar: () => { p.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
}

/** Grava no ramo de coordenação sem passar pelo núcleo: é o que um agente com push faria à mão. */
export function gravarCru(dir: string, mudancas: Array<{ caminho: string; conteudo: string | null }>, mensagem = 'SIMULADO: escrita à mão'): string {
  const { ponta } = buscarBranch(dir, 'origin', BRANCH_DE_COORDENACAO, 'teste');
  const commit = gravarNaBranch(dir, 'origin', BRANCH_DE_COORDENACAO, ponta, mudancas, mensagem, 'teste');
  assert.ok(commit, 'a escrita à mão entrou no ramo');
  return commit;
}

/** O conteúdo de um registro do ramo, lido do remoto agora. */
export function registroCru(dir: string, caminho: string): string {
  buscarBranch(dir, 'origin', BRANCH_DE_COORDENACAO, 'teste');
  return exec('git', ['show', `refs/remotes/origin/${BRANCH_DE_COORDENACAO}:${caminho}`], dir).stdout;
}
