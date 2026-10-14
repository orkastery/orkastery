'use strict';

/**
 * RM-064 T1: reconhece apenas o fato de a conta ter esgotado. O chamador persiste
 * o código devolvido, nunca os textos que serviram de entrada.
 */
function accountFailure(h) {
  const partes = [h?.message, h?.reason, h?.stop_reason, h?.error?.message, h?.error?.code]
    .filter((v) => typeof v === 'string').join('\n');
  return /(?:you(?:'|’)ve hit your (?:weekly|session|individual spend|usage) limit|seu limite de uso foi atingido|usage_limit_(?:exceeded|reached)|insufficient_quota|out of credits|spend (?:cap|limit))/i.test(partes)
    ? 'runtime.quota-exhausted' : null;
}

module.exports = { accountFailure };
