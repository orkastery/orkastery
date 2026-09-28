#!/usr/bin/env node
// Somente leitura. Ausência de coletor oficial nunca vira evidência produzida pelo agente.
const HOSTS = ['codex','claude-code','hermes','openclaw'];
const SCOPES = ['hosts','sites','delivery'];
const text = value => typeof value === 'string' && value.trim().length > 0;
function provedShip(ship) {
  return ship?.tipo === 'ship_done' && ship.pushVerificado === true &&
    typeof ship.mergeSha === 'string' && /^[a-f0-9]{40}$/.test(ship.mergeSha) &&
    ship.shaRemoto === ship.mergeSha && text(ship.fonteDaProva);
}
// Diagnóstico de candidatos, nunca autenticação. Nenhum campo declarativo libera live.
function inspectCandidate(candidate, ship, scope = 'hosts') {
  if (!SCOPES.includes(scope)) throw Error('maestro.live.arguments');
  const errors=[];
  if (!provedShip(ship)) errors.push('maestro.live.ship-unproved');
  if (candidate?.kind!=='native-capture' || candidate.simulated!==false || candidate.author==='agent' || candidate.selfReport!==false)
    errors.push('maestro.live.self-report');
  if (candidate?.deliveredSha!==ship?.mergeSha) errors.push('maestro.live.version-mismatch');
  const hosts=Array.isArray(candidate?.hosts)?candidate.hosts:[];
  const sessions = new Set();
  for(const host of scope === 'sites' ? [] : HOSTS) {
    const matches=hosts.filter(r=>r?.host===host);
    if(matches.length!==1){errors.push('maestro.live.host-missing');continue;}
    const r=matches[0];
    if(r.newSession!==true || r.reusedSession!==false || !text(r.sessionId) || sessions.has(r.sessionId))
      errors.push('maestro.live.session-unproved');
    sessions.add(r.sessionId);
    if(r.authentication!=='ok' || r.snapshotOrigin!=='canonical' || r.phrase!=='orkastery maestro' ||
        !/^[a-f0-9]{64}$/.test(r.installedHash??'') || typeof r.nativeReference!=='string' || !r.nativeReference)
      errors.push('maestro.live.host-unproved');
    if (!text(r.actionReference) || !text(r.readbackReference) || !text(r.hitlReference))
      errors.push('maestro.live.journey-unproved');
  }
  for (const site of scope === 'hosts' ? [] : ['orkastery','orkmind']) {
    const matches = (Array.isArray(candidate?.sites) ? candidate.sites : []).filter(r => r?.site === site);
    if (matches.length !== 1) { errors.push('maestro.live.site-missing'); continue; }
    const r = matches[0];
    if (!text(r.publicationReference) || !text(r.readbackReference) ||
        !/^[a-f0-9]{64}$/.test(r.servedHash ?? '') || r.servedHash !== r.publishedHash)
      errors.push('maestro.live.site-unproved');
  }
  // A forma do candidato não autentica referências. Precisa de readback do coletor.
  errors.push('maestro.live.native-receipt-source-unavailable');
  return [...new Set(errors)];
}
function verifyCanonical(root, threadId, scope) {
  if(typeof threadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId) || !SCOPES.includes(scope))
    throw Error('maestro.live.arguments');
  const {lerThread,dirThread}=require('../dist/thread.js');
  const {lerLedger}=require('../dist/ledger.js');
  const {lerMasterLog}=require('../dist/master.js');
  const thread=lerThread(root,threadId), events=lerLedger(dirThread(root,threadId));
  const validLedger = events.every(e => e && e.thread === threadId && text(e.tipo) && e.tipo !== 'ledger_corrupted');
  const ship=events.filter(e=>e && e.thread === threadId && ['ship_done','ship_started','ship_blocked'].includes(e.tipo)).at(-1);
  const errors=[];
  if (!validLedger) errors.push('maestro.live.ledger-invalid');
  if (!validLedger || !provedShip(ship)) errors.push('maestro.live.ship-unproved');
  // O core observado fornece SHIP e MASTER, mas não um coletor autenticado de
  // ativação por host/site. Não reconhecer um event type inventado como recibo.
  errors.push('maestro.live.native-receipt-source-unavailable');
  if(scope==='delivery' && !lerMasterLog(root,threadId)) errors.push('maestro.live.master-pending');
  return {ok:false,thread:thread.id,scope,ship:validLedger && provedShip(ship) ? ship.mergeSha : null,
    sources:{ship:'ledger',master:scope === 'delivery' ? 'master-log' : null,live:'unavailable'},errors};
}
function main(argv=process.argv.slice(2)) {
  if(argv.length!==4 || argv[0]!=='--thread' || argv[2]!=='--scope') throw Error('maestro.live.arguments');
  const {exigirManifesto}=require('../dist/manifest.js');
  const result=verifyCanonical(exigirManifesto().raiz,argv[1],argv[3]);
  console.log(JSON.stringify(result));return 1;
}
module.exports={inspectCandidate,verifyCanonical,main};
if(require.main===module){try{process.exitCode=main();}catch(e){console.error(JSON.stringify({ok:false,error:/^maestro\.live\./.test(e.message)?e.message:'maestro.live.unavailable'}));process.exitCode=1;}}
