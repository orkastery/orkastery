/** D17: allowlist duravel do projeto; configuracao invalida impede a varredura. */
const fs = require('node:fs');
const path = require('node:path');

function lerEscopo(arquivo) {
  const stat = fs.lstatSync(arquivo);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('pulse.scope.special-file');
  let config;
  try { config = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch { throw Error('pulse.scope.invalid-json'); }
  if (![1, 2].includes(config?.versao) || (config.versao === 2 && config.activation !== 'receipt-required') || !Array.isArray(config.threads) || !config.threads.length ||
      config.threads.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) ||
      new Set(config.threads).size !== config.threads.length) throw Error('pulse.scope.invalid');
  // O nucleo aplica tambem a policy de threads protegidas antes de qualquer carimbo.
  return config.threads.join(',');
}

function escopoAtivo(arquivo) {
  const candidato = lerEscopo(arquivo);
  const api = [path.join(__dirname, '../core/dist'), path.join(__dirname, '../dist')]
    .find(p => fs.existsSync(path.join(p, 'write-activation.js')));
  if (!api) throw Error('pulse.scope.runtime-unavailable');
  const { exigirManifesto } = require(path.join(api, 'manifest.js'));
  const { lerAtivacao } = require(path.join(api, 'write-activation.js'));
  const c = exigirManifesto(path.dirname(path.dirname(arquivo)));
  let ativacao;
  try { ativacao = lerAtivacao(c); }
  catch (e) {
    process.stderr.write('pulse.scope.activation-pending: ' + (String(e.message).startsWith('write.activation.') ? e.message : 'invalid receipt') + '\n');
    return ''; // Observacao/alertas continuam; escrita nao foi autorizada.
  }
  if (!ativacao.ativa || !ativacao.plano.alvos.includes('pulse')) return '';
  const autorizado = ativacao.plano.threads.join(',');
  if (candidato !== autorizado) throw Error('pulse.scope.activation-conflict');
  return autorizado;
}
module.exports = { lerEscopo, escopoAtivo };
if (require.main === module) {
  try { process.stdout.write(escopoAtivo(process.argv[2])); }
  catch (e) {
    const mensagem = e.message.startsWith('pulse.scope.') ? e.message : 'pulse.scope.unreadable';
    process.stderr.write(mensagem + '\n');
    process.exitCode = 1;
  }
}
