#!/usr/bin/env node
// Auditoria de narrativa candidata. Não carimba execução de testes ou recibo live.
const fs = require('node:fs');
const path = require('node:path');
const SCOPES = { snapshot: 'read-only', 'same-harness': 'proven-sessions',
  'native-hitl': 'callback-only-live-pending', 'host-parity': 'simulated-installations' };
function verifyDocs(root, matrix, documents) {
  const errors = [];
  if (matrix.schema !== 'ork.maestro-capabilities/v1' || matrix.thread !== 'ork-i32bootstrap' ||
      matrix.humanUsabilityPriority !== 'maximum') errors.push('maestro.docs.contract');
  if (matrix.stage !== 'candidate-go' || matrix.liveReceipts !== null) errors.push('maestro.docs.live-receipt-unverified');
  const ids = new Set();
  for (const c of matrix.capabilities ?? []) {
    if (!Object.hasOwn(SCOPES,c.id) || c.scope !== SCOPES[c.id] || ids.has(c.id)) errors.push('maestro.docs.capability-drift');
    ids.add(c.id);
    if (!Array.isArray(c.claims) || !c.claims.length || c.claims.some(id => !/^C[1-9][0-9]*$/.test(id)) ||
        !Array.isArray(c.evidence) || !c.evidence.length || typeof c.command !== 'string' || !c.command.trim()) errors.push('maestro.docs.evidence-missing');
    for (const file of c.evidence ?? []) {
      if (typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..') ||
          !fs.existsSync(path.join(root,file)) || !fs.realpathSync(path.join(root,file)).startsWith(fs.realpathSync(root)+path.sep))
        errors.push('maestro.docs.evidence-missing');
    }
  }
  if (ids.size !== Object.keys(SCOPES).length) errors.push('maestro.docs.capability-missing');
  for (const file of matrix.documents ?? []) {
    const doc = documents[file];
    const current = typeof doc === 'string' && /<!-- maestro-i32:begin -->([\s\S]*?)<!-- maestro-i32:end -->/.exec(doc)?.[1];
    if (!current) { errors.push('maestro.docs.section-missing'); continue; }
    if (!/orkastery maestro/.test(current) || !/HITL/.test(current) || !/prioridade máxima/i.test(current) ||
        !/candidat|pendente|pacote local/i.test(current)) errors.push('maestro.docs.journey-missing');
    if (/\b(?:oferece|inclui|habilita|com) controle web/i.test(current) ||
        /(?:quatro hosts|todos os hosts).{0,40}(?:ativados|homologados|publicados)/i.test(current) ||
        /(?:I-32.{0,40}100%|Telegram (?:é )?obrigatório)/i.test(current)) errors.push('maestro.docs.unsupported-promise');
  }
  if (!Array.isArray(matrix.documents) || matrix.documents.length < 4) errors.push('maestro.docs.documents-missing');
  if (['README.md', 'README.pt-BR.md'].some((f) => documents[f]?.includes('Interface de onboarding/cockpit do ecossistema'))) errors.push('maestro.docs.web-conflict');
  return [...new Set(errors)];
}
function main(root = path.resolve(__dirname,'../..')) {
  const matrix = JSON.parse(fs.readFileSync(path.join(root,'docs/referencia/maestro-capacidades.json'),'utf8'));
  const documents = Object.fromEntries(matrix.documents.map(file => [file, fs.readFileSync(path.join(root,file),'utf8')]));
  const errors = verifyDocs(root,matrix,documents);
  console.log(JSON.stringify({ ok: !errors.length, scope: 'candidate-documentation-only', officialVerify: 'pending', errors }));
  return errors.length ? 1 : 0;
}
module.exports = { verifyDocs, main };
if (require.main === module) { try { process.exitCode = main(); } catch { console.error('maestro.docs.unavailable'); process.exitCode = 1; } }
