/**
 * A6 do backlog autonomo 2: cala SO o `ExperimentalWarning` do MockTimers nos testes que usam
 * `t.mock.timers`. No Node 20 e 22 do CI, ele saia 3 vezes por job e escondia os avisos que importam.
 *
 * Por que calar e nao trocar pelo relogio injetavel: o prazo de 2 s do `observeWithDeadline`, a janela
 * de 5 min do ingresso local e o `Date` do `validateObjective` nao aceitam relogio de fora, e injeta-lo
 * mudaria a assinatura de codigo de producao so para o teste (decisao no ledger da `ork-suiteeinstal`).
 *
 * Qualquer outro aviso, inclusive outro `ExperimentalWarning`, segue para o `process.emitWarning`
 * original. Importe pelo efeito, antes de habilitar o mock: `import './sem-aviso-mocktimers';`.
 */
export const AVISO_DO_MOCKTIMERS = 'The MockTimers API is an experimental feature';

const MARCA = Symbol.for('orkastery.teste.semAvisoMockTimers');
type ProcessoMarcado = NodeJS.Process & { [MARCA]?: true };

if (!(process as ProcessoMarcado)[MARCA]) {
  (process as ProcessoMarcado)[MARCA] = true;
  const original = process.emitWarning;
  process.emitWarning = function emitWarning(this: NodeJS.Process, aviso: string | Error, ...resto: unknown[]): void {
    const texto = typeof aviso === 'string' ? aviso : aviso?.message;
    if (typeof texto === 'string' && texto.startsWith(AVISO_DO_MOCKTIMERS)) return;
    return (original as (...args: unknown[]) => void).call(process, aviso, ...resto);
  } as typeof process.emitWarning;
}
