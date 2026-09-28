/** Migracao aditiva de fontes canonicas. Nenhum arquivo ou registro antigo e removido. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ManifestoCarregado } from './manifest';
import { raizDoEstado } from './estado-thread';
import { dirThread, lerThread } from './thread';
import { lerLedger, registrar } from './ledger';
import { exigirEscopoDeEscrita, validarDiretorioDeThread } from './escopo-escrita';
import { abrirMemoria, prepararHandoffGovernado } from './memoria';
import { DriverDeMemoria, resolverRegime } from './orkmind';
import { Handoff, PedidoDeHandoff, ResultadoDeHandoff } from './types';

export interface FonteDeHandoff {
  arquivo: string;
  sha256: string;
  bytes: number;
  formato: string;
  tenant: string | null;
  thread: string | null;
  origem: string | null;
  destino: string | null;
  incluir: boolean;
  motivo: string;
  bloqueante: boolean;
}
export interface InventarioDeHandoffs {
  tenant: string;
  fontes: FonteDeHandoff[];
  incluidos: number;
  excluidos: number;
}
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function arquivos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('memory.inventory.special-file');
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.isSymbolicLink() || (!e.isFile() && !e.isDirectory())) throw new Error('memory.inventory.special-file');
    const nome = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(nome) : [nome];
  });
}

/**
 * O repositorio alvo que um handoff em Markdown declara na linha `Repo alvo: <caminho>`.
 *
 * So a declaracao explicita conta: o nome solto no texto nunca classifica tenant. O tenant e o
 * ultimo segmento do caminho, normalizado (`/srv/projetos/Outro-Board` vira `outro-board`).
 */
export function repositorioAlvoDeclarado(texto: string): { nome: string; tenant: string } | null {
  const linha = /^\s*Repo alvo:\s*`?([^`\n]+?)`?\s*\.?\s*$/mi.exec(texto);
  const nome = linha?.[1].replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.trim();
  if (!nome) return null;
  const tenant = nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return tenant ? { nome, tenant } : null;
}

/**
 * Inclui o snapshot atual e todo o historico das threads EXPLICITAMENTE autorizadas, e so isso.
 * D23: a caixa compartilhada `.orkastery/handoffs` e as threads fora da allowlist nao sao
 * consultadas, enumeradas, lidas nem hasheadas em nenhum ponto -- a allowlist limita a LEITURA,
 * nao apenas a selecao. Por isso `incluidos`/`excluidos` contam somente fontes autorizadas
 * efetivamente inspecionadas: a ausencia de uma fonte fora do escopo neste resultado nao afirma
 * que ela nao existe nem classifica o tenant dela.
 */
export function inventariarHandoffs(carregado: ManifestoCarregado, escopo?: readonly string[]): InventarioDeHandoffs {
  const autorizadas = exigirEscopoDeEscrita(escopo);
  const raiz = raizDoEstado(carregado.raiz), estado = path.join(raiz, '.orkastery');
  const tenant = carregado.manifesto.memory.tenant || carregado.manifesto.project.name;
  const candidatos = new Map<string, string>();
  const threads = path.join(estado, 'threads');
  for (const id of autorizadas) {
    validarDiretorioDeThread(carregado.raiz, id);
    const dir = path.join(threads, id), atual = path.join(dir, 'handoff.json');
    if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw new Error('memory.inventory.thread-invalid');
    if (fs.existsSync(atual)) candidatos.set(atual, id);
    for (const nome of arquivos(path.join(dir, 'handoffs'))) candidatos.set(nome, id);
  }
  const fontes = [...candidatos].sort(([a], [b]) => a.localeCompare(b)).map(([absoluto, dono]): FonteDeHandoff => {
    // Invariante da allowlist: nenhum candidato nasce fora dela, porque nada fora dela e percorrido.
    if (!autorizadas.has(dono)) throw new Error('scope.thread.unauthorized');
    if (fs.lstatSync(absoluto).isSymbolicLink()) throw new Error('memory.inventory.special-file');
    const bytes = fs.readFileSync(absoluto), texto = bytes.toString('utf8');
    const formato = path.extname(absoluto).slice(1).toLowerCase();
    const fonte: FonteDeHandoff = { arquivo: path.relative(raiz, absoluto).split(path.sep).join('/'),
      sha256: hash(bytes), bytes: bytes.length, formato, tenant: null, thread: dono,
      origem: null, destino: null, incluir: false, motivo: 'origem_nao_confirmada', bloqueante: false };
    // Declaracao explicita do repositorio alvo de OUTRO projeto, nao uma ocorrencia casual do nome.
    const alvo = formato === 'md' ? repositorioAlvoDeclarado(texto) : null;
    if (alvo && alvo.tenant !== tenant) {
      return { ...fonte, tenant: alvo.tenant, origem: `${alvo.nome} (declarado na fonte)`,
        destino: alvo.nome, motivo: 'tenant_externo_reservado' };
    }
    let h: Handoff | undefined;
    if (formato === 'json') { try { h = JSON.parse(texto) as Handoff; } catch { fonte.motivo = 'json_invalido'; } }
    // A propriedade vem do diretorio autorizado que continha o arquivo; `h.thread` declarado
    // dentro do proprio JSON nunca autoriza nada, so e conferido contra o dono real mais abaixo.
    const id = dono;
    if (!fs.existsSync(path.join(threads, id, 'thread.json'))) return fonte;
    const thread = lerThread(carregado.raiz, id);
    fonte.thread = id;
    fonte.tenant = thread.projeto.name === carregado.manifesto.project.name ? tenant : thread.projeto.name;
    if (fonte.tenant !== tenant) return { ...fonte, motivo: 'tenant_externo_reservado' };
    if (formato !== 'json') return { ...fonte, motivo: 'formato_sem_contrato' };
    if (!h || h.thread !== id || h.versao !== 1 || !h.de?.slug || !h.para?.slug ||
        !Array.isArray(h.inline) || !Array.isArray(h.pointers) || !Array.isArray(h.summaries)) {
      return { ...fonte, motivo: 'handoff_invalido', bloqueante: true };
    }
    return { ...fonte, origem: `${h.de.slug}:${h.de.fase ?? 'desconhecida'}`,
      destino: `${h.para.slug}:${h.para.fase ?? 'desconhecida'}`, incluir: true, motivo: 'tenant_confirmado' };
  });
  return { tenant, fontes, incluidos: fontes.filter(f => f.incluir).length, excluidos: fontes.filter(f => !f.incluir).length };
}

function lerFonte(carregado: ManifestoCarregado, fonte: FonteDeHandoff): string {
  const raiz = raizDoEstado(carregado.raiz), absoluto = path.resolve(raiz, fonte.arquivo);
  if (!absoluto.startsWith(path.join(raiz, '.orkastery') + path.sep) ||
      !fs.realpathSync(absoluto).startsWith(fs.realpathSync(path.join(raiz, '.orkastery')) + path.sep)) {
    throw new Error('memory.migration.source-outside-state');
  }
  const bytes = fs.readFileSync(absoluto);
  if (hash(bytes) !== fonte.sha256 || bytes.length !== fonte.bytes) throw new Error('memory.migration.source-changed');
  const texto = bytes.toString('utf8');
  if (!Buffer.from(texto).equals(bytes)) throw new Error('memory.migration.invalid-utf8');
  return texto;
}

/** Readback de manutencao pela biblioteca instalada. Nao altera filtros do recall. */
export function verificarHandoffMigrado(driver: DriverDeMemoria, p: PedidoDeHandoff, r: ResultadoDeHandoff) {
  if (!r.ok || !r.readback || !r.id || !r.session_entry_id || !r.package_entry_id || !r.package_id || !driver.recuperar) {
    throw new Error('memory.migration.readback-missing');
  }
  const session = driver.recuperar('session', r.session_entry_id);
  const handoff = driver.recuperar('handoff', r.id);
  const pacote = driver.recuperar('semantic_log', r.package_entry_id);
  if (!session || !handoff || !pacote || handoff.parent_id !== session.id || pacote.parent_id !== session.id ||
      session.metadata.session_id !== p.sessionId || handoff.metadata.package_id !== r.package_id ||
      pacote.metadata.package_id !== r.package_id || handoff.metadata.package_entry_id !== pacote.id ||
      !isDeepStrictEqual(JSON.parse(pacote.content), p.payload)) throw new Error('memory.migration.readback-mismatch');
  for (const entry of [session, handoff, pacote]) {
    if (entry.source !== 'agent' || entry.mandatory || entry.priority === 'critical' ||
        !Object.entries(p.tags).every(([k, values]) => values.every(v => entry.tags[k]?.includes(v)))) {
      throw new Error('memory.migration.readback-tags');
    }
  }
  for (const entry of [handoff, pacote]) for (const [k, value] of Object.entries(p.metadata)) {
    if (!isDeepStrictEqual(entry.metadata[k], value)) throw new Error('memory.migration.readback-provenance');
  }
  if (handoff.metadata.orkastery_identity !== p.identidade || pacote.metadata.orkastery_identity !== p.identidade) {
    throw new Error('memory.migration.readback-identity');
  }
  return { session: session.id, handoff: handoff.id, semantic_log: pacote.id, parent_id: session.id,
    package_id: r.package_id, sha256: p.metadata.sha256, tags: p.tags, originalIntegral: true };
}

export interface OpcoesDeMigracao {
  operadora: string;
  /** Mesmo ID recupera resultados terminais e retoma apenas entradas sem recibo.
   * Para retentar uma falha, usar outro ID (ou omitir para gerar nova tentativa). */
  operacaoId?: string;
  escopo: readonly string[];
  driver?: DriverDeMemoria;
  inventario?: InventarioDeHandoffs;
}

export function migrarHandoffs(carregado: ManifestoCarregado, opcoes: OpcoesDeMigracao) {
  const operacaoId = opcoes.operacaoId ?? randomUUID();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(operacaoId)) throw new Error('memory.migration.operation-invalid');
  const autorizadas = exigirEscopoDeEscrita(opcoes?.escopo);
  if (!autorizadas.has(opcoes.operadora)) throw new Error('scope.thread.unauthorized');
  validarDiretorioDeThread(carregado.raiz, opcoes.operadora);
  const operadora = lerThread(carregado.raiz, opcoes.operadora);
  if (operadora.projeto.name !== carregado.manifesto.project.name) throw new Error('memory.tenant.mismatch');
  const auditoria = dirThread(carregado.raiz, operadora.id);
  const atual = inventariarHandoffs(carregado, opcoes.escopo), inventario = opcoes.inventario ?? atual;
  if (!isDeepStrictEqual(inventario.fontes.map(f => [f.arquivo, f.thread, f.incluir, f.tenant]), atual.fontes.map(f => [f.arquivo, f.thread, f.incluir, f.tenant]))) {
    throw new Error('memory.migration.incomplete-inventory');
  }
  const tenant = carregado.manifesto.memory.tenant || carregado.manifesto.project.name;
  if (inventario.tenant !== tenant || inventario.fontes.some(f => f.incluir && f.tenant !== tenant)) throw new Error('memory.tenant.mismatch');
  if (inventario.fontes.some(f => f.bloqueante)) throw new Error('memory.migration.invalid-inventory');
  // Preflight de todas as fontes antes da primeira escrita. Snapshot nao autoriza outro tenant.
  const pedidos = inventario.fontes.filter(f => f.incluir).map(fonte => {
    if (!fonte.thread || !autorizadas.has(fonte.thread)) throw new Error('scope.thread.unauthorized');
    const texto = lerFonte(carregado, fonte), thread = lerThread(carregado.raiz, fonte.thread);
    return { fonte, pedido: prepararHandoffGovernado(carregado.manifesto, thread, JSON.parse(texto), fonte.arquivo, texto, carregado.raiz) };
  });
  const operacaoHash = hash(JSON.stringify({ tenant, operadora: operadora.id, escopo: [...autorizadas].sort(),
    fontes: pedidos.map(({ fonte, pedido }) => [fonte.arquivo, fonte.sha256, pedido.identidade]) }));
  const eventos = lerLedger(auditoria);
  const recibos = eventos.filter(e => ['memory_migrated', 'memory_migration_failed', 'memory_migration_attempt'].includes(e.tipo));
  if (recibos.some(e => e.operacaoId === operacaoId && e.operacaoHash !== operacaoHash)) {
    throw new Error('memory.migration.operation-conflict');
  }
  const publicados = new Set(recibos.filter(e => e.tipo === 'memory_migrated').map(e => e.identidade));
  const anteriores = new Map(recibos.filter(e => e.operacaoId === operacaoId).map(e => [e.identidade, e]));
  const driver = opcoes.driver ?? resolverRegime(carregado.manifesto, null).driver;
  if (!driver?.contagens || !driver.recuperar || !driver.submeterHandoff) throw new Error('memory.migration.unavailable');
  const memoria = abrirMemoria(carregado, { driver });
  if (!memoria.ativo) throw new Error('memory.migration.unavailable');
  const antes = driver.contagens(); // Erro de leitura reprova; nunca assume base vazia.
  const resultados = pedidos.map(({ fonte, pedido }) => {
    const anterior = anteriores.get(pedido.identidade);
    if (anterior) {
      return { arquivo: fonte.arquivo, sha256: fonte.sha256, identidade: pedido.identidade,
        ok: anterior.tipo !== 'memory_migration_failed', replay: true,
        gravacao: anterior.gravacao as ResultadoDeHandoff | null,
        readback: anterior.readback as ReturnType<typeof verificarHandoffMigrado> | null,
        erro: anterior.tipo === 'memory_migration_failed' ? String(anterior.erro) : null };
    }
    try {
      if (!fonte.thread || !autorizadas.has(fonte.thread)) throw new Error('scope.thread.unauthorized');
      validarDiretorioDeThread(carregado.raiz, fonte.thread);
      validarDiretorioDeThread(carregado.raiz, operadora.id);
      lerFonte(carregado, fonte);
      const gravacao = memoria.submeterHandoff(pedido);
      const readback = verificarHandoffMigrado(driver, pedido, gravacao);
      lerFonte(carregado, fonte);
      const r = { arquivo: fonte.arquivo, sha256: fonte.sha256, identidade: pedido.identidade, ok: true,
        gravacao, readback, erro: null, replay: false };
      const evento = registrar(auditoria, operadora.id, publicados.has(pedido.identidade) ? 'memory_migration_attempt' : 'memory_migrated',
        { tenant, fonteThread: fonte.thread, operacaoId, operacaoHash, ...r });
      anteriores.set(pedido.identidade, evento);
      publicados.add(pedido.identidade);
      return r;
    } catch (e) {
      // Nunca propaga texto arbitrario da fonte ou do subprocesso ao CLI/ledger.
      const codigo = e instanceof Error && /^memory\.(migration\.[a-z-]+|tenant\.mismatch)$/.test(e.message) ? e.message : 'memory.migration.failed';
      const r = { arquivo: fonte.arquivo, sha256: fonte.sha256, identidade: pedido.identidade, ok: false,
        gravacao: null, readback: null, erro: codigo, replay: false };
      const evento = registrar(auditoria, operadora.id, 'memory_migration_failed', { tenant, fonteThread: fonte.thread, operacaoId, operacaoHash, ...r });
      anteriores.set(pedido.identidade, evento);
      return r;
    }
  });
  const depois = driver.contagens();
  if (Object.entries(antes).some(([c, n]) => (depois[c] ?? 0) < n)) throw new Error('memory.migration.count-decreased');
  const falhas = resultados.filter(r => !r.ok).length;
  return { ok: falhas === 0, operacaoId, inventario, antes, depois, resultados, falhas,
    replay: resultados.length > 0 && resultados.every(r => r.replay),
    contrato: 'mesmo ID recupera terminais e retoma somente sem recibo; falha exige novo ID para nova tentativa' };
}
