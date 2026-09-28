/** Preparacao prospectiva exclusivamente offline; dados privados entram por recibo restrito. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { estadoCanonico } from './estado-thread';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exigirManifesto, ManifestoCarregado } from './manifest';
import { exigirEscopoDeEscrita, validarDiretorioDeThread } from './escopo-escrita';
import { abrirMemoria, gravarPolicies } from './memoria';
import { camposNativos, DriverEmMemoria, agenteProspectivoValido } from './orkmind';

export const hashProspectivo = (s: string) => createHash('sha256').update(s).digest('hex');
export const CAMPOS_NATIVOS = camposNativos();
export interface SnapshotNativo {
  tenant: string; observadoEm: string; ids: string[];
  entries: Array<Record<string, unknown> & { id: string; content: string; content_hash: string;
    tags: Record<string, string[]>; metadata: Record<string, unknown> }>;
}
export interface AutoriaProspectiva { agente: string; revisao: string; reciboSha256: string; tenantNativo?: string }

export function prepararVersaoProspectiva(carregado: ManifestoCarregado, recibo: SnapshotNativo, autoria: AutoriaProspectiva) {
  const m = carregado.manifesto;
  const tenant = m.memory.tenant || m.project.name;
  if (recibo.tenant !== (autoria.tenantNativo ?? tenant)) throw new Error('memory.tenant.mismatch');
  if (!/^[a-f0-9]{64}$/.test(autoria.reciboSha256) || !/^[a-f0-9]{40}$/.test(autoria.revisao) ||
      !agenteProspectivoValido(autoria.agente)) throw new Error('memory.prospective.authorship');
  if (recibo.ids.length !== 3 || new Set(recibo.ids).size !== 3 || recibo.entries.length !== 3 ||
      new Set(recibo.entries.map(e => e.id)).size !== 3 || recibo.entries.some(e => !recibo.ids.includes(e.id)) ||
      recibo.ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('memory.prospective.scope');
  const driver = new DriverEmMemoria();
  const local = { ...carregado, manifesto: { ...m, memory: { ...m.memory, mode: 'orkmind' as const } } };
  const publicacao = gravarPolicies(abrirMemoria(local, { driver }), m);
  if (publicacao.falhas || driver.tudo().length !== 3) throw new Error('memory.prospective.manifest-changed');
  const hashes = new Set<string>();
  const entradas = [...recibo.entries].sort((a, b) => a.id.localeCompare(b.id)).map(old => {
    if (CAMPOS_NATIVOS.some(k => !(k in old))) throw new Error('memory.prospective.snapshot-incomplete');
    const atual = driver.tudo().find(e => hashProspectivo(e.content) === old.content_hash);
    if (!atual || hashProspectivo(old.content) !== old.content_hash || hashes.has(old.content_hash)) throw new Error('memory.prospective.hash-mismatch');
    hashes.add(old.content_hash);
    if (old.collection !== 'rule' || old.source !== 'agent' || old.priority !== 'high' || old.mandatory !== false ||
        old.protected !== false || old.version !== 1 || old.author_id !== null || old.visibility !== 'private' ||
        old.scope !== 'project' || Object.keys(old.metadata).length || (old.tags.editors ?? []).length ||
        old.tags.project?.length !== 1 || old.tags.project[0] !== tenant) throw new Error('memory.prospective.legacy-changed');
    const tags = Object.fromEntries([...new Set([...Object.keys(old.tags), ...Object.keys(atual.tags)])].map(k =>
      [k, [...new Set([...(old.tags[k] ?? []), ...(atual.tags[k] ?? [])])].sort()]));
    const originalJson = JSON.stringify(old);
    const marcador = { schema: 'ork.prospective-origin/v1', historicalOrigin: 'unknown', source: 'agent',
      agent: autoria.agente, revision: autoria.revisao, receiptSha256: autoria.reciboSha256,
      entryId: old.id, originalJson, originalSha256: hashProspectivo(originalJson) };
    const proposta: SnapshotNativo['entries'][number] = { ...structuredClone(old), tags,
      metadata: { ...structuredClone(atual.metadata), orkastery_prospective: marcador } };
    return { id: old.id, sha256: old.content_hash, origemHistorica: 'desconhecida', antes: structuredClone(old), proposta };
  });
  return { versao: 2, tipo: 'memory.prospective.preparation', executavel: false, aplicacaoDisponivel: false,
    impedimento: 'memory.legacy.provenance-collision', liberaShip: false, novaObservacaoOperacional: false,
    motivo: 'memory.prospective.preconditions-missing', entradas, autoriaProspectiva: { ...autoria, source: 'agent' },
    faltantes: ['autoridade nativa identificada para as entradas privadas orfas; nao omitir requester apos recusa',
      'recibo transacional e arquivo integral duravel; locks e compare integral na mesma transacao',
      'rollback compensatorio testado e CHECK independente no HEAD da operacao',
      'decisao tipada do condutor antes de qualquer aplicacao'],
  };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const value = (key: string) => args[args.indexOf(key) + 1];
    const flags = ['--recibo', '--recibo-sha256', '--operadora', '--escopo', '--agente', '--tenant-nativo'];
    if (args[0] !== '--dry-run' || args.length !== 1 + flags.length * 2 ||
        flags.some(flag => args.filter(a => a === flag).length !== 1) ||
        args.some(a => a.startsWith('--') && !['--dry-run', ...flags].includes(a))) throw new Error('memory.prospective.apply-unavailable');
    for (const flag of flags) if (!value(flag) || value(flag).startsWith('--')) throw new Error('memory.prospective.arguments');
    const c = exigirManifesto();
    const escopo = exigirEscopoDeEscrita(value('--escopo').split(','));
    if (!escopo.has(value('--operadora'))) throw new Error('scope.thread.unauthorized');
    for (const id of escopo) validarDiretorioDeThread(c.raiz, id);
    const evidence = path.join(estadoCanonico(c.raiz, value('--operadora')), 'evidence');
    const arquivo = path.resolve(value('--recibo'));
    const evidenceLocal = path.join(c.raiz, '.orkastery/threads', value('--operadora'), 'evidence');
    if (![evidence, evidenceLocal].includes(path.dirname(arquivo))) throw new Error('scope.receipt.unauthorized');
    const fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bruto: string;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || (st.mode & 0o777) !== 0o600 || st.uid !== process.getuid?.() ||
          !fs.realpathSync(arquivo).startsWith(fs.realpathSync(evidence) + path.sep)) throw new Error('scope.receipt.unauthorized');
      bruto = fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
    if (hashProspectivo(bruto) !== value('--recibo-sha256')) throw new Error('memory.prospective.receipt-mismatch');
    const plano = prepararVersaoProspectiva(c, JSON.parse(bruto), { reciboSha256: hashProspectivo(bruto),
      agente: value('--agente'), tenantNativo: value('--tenant-nativo'),
      revisao: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: c.raiz, encoding: 'utf8' }).trim() });
    // O plano integral continua privado: stdout e somente resumo, sem IDs, hashes de linhas ou conteudo.
    console.log(JSON.stringify({ ...plano, entradas: undefined, quantidade: plano.entradas.length,
      operadora: value('--operadora'), escopo: [...escopo], manifestoSha256: hashProspectivo(fs.readFileSync(c.caminho, 'utf8')) }, null, 2));
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    console.error(JSON.stringify({ erro: /^(memory|scope)\.[a-z.-]+$/.test(message) ? message : 'memory.prospective.invalid-input' }));
    process.exitCode = 1;
  }
}
