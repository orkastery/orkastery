// A frase curta de cada motivo tipado de gate do nucleo (RM-059, Torre de Controle; D5 da thread). O painel
// mostra o bloqueio ao dono numa frase so, com acento. O teste do nucleo exige as mesmas chaves de
// `DESCRICAO_DO_MOTIVO` (core/src/gates.ts): motivo novo no nucleo reprova o teste ate ganhar frase. Modulo
// puro: so dados.

export const FRASE_DO_MOTIVO: Readonly<Record<string, string>> = {
  'artifact.missing': 'falta um artefato que a fase exige',
  'claims.failed': 'uma claim reprovou no HEAD',
  'claims.unverifiable': 'há claim sem comando de verificação',
  'concurrency.lease-indeterminado': 'não foi possível provar se a vaga está livre',
  'conducao.acao-necessaria': 'a condução precisa executar uma ação',
  'policy.violation': 'uma policy de bloqueio foi violada',
  'runtime.autoconferencia': 'o CHECK caiu no mesmo runtime do GO',
  'verify.regression': 'um teste que passava na baseline caiu',
  'verify.failed': 'a verificação falhou, sem baseline para comparar',
  'verify.timeout': 'a verificação estourou o prazo',
  'verify.sem-veredito': 'a verificação terminou sem veredito',
  'ci.failed': 'o CI independente não está verde',
  'runtime.unavailable': 'o runtime não está disponível',
  'runtime.silencio': 'a sessão parou de dar sinal',
  'runtime.rate-limited': 'bateu o limite de uso da assinatura',
  'runtime.quota-exhausted': 'a cota da conta acabou',
  'runtime.auth-missing': 'a conta do runtime precisa de login',
  'runtime.model-unavailable': 'o modelo pedido não está disponível',
  'runtime.profile-invalid': 'o perfil pedido não existe',
  'runtime.workspace-untrusted': 'o runtime pede que você confie na pasta',
  'runtime.consent-pending': 'o runtime pede que você aceite os termos',
  'cost.violation': 'o despacho iria para um provider pago',
  'tree.blocked': 'a árvore de destino do merge está ocupada',
  'lease.busy': 'outra thread segura a região',
  'lease.resume-unavailable': 'a retomada do lease não está disponível',
  'conducao.em-andamento': 'outra condução já roda nesta thread',
  'hitl.formato': 'o pedido ao dono saiu fora do formato',
  'human.pending': 'espera a sua autorização',
}

/** Os motivos que so o dono resolve (D6): a linha fica em "espera voce", nao em "parada". */
export const MOTIVOS_DO_DONO: readonly string[] = ['human.pending', 'runtime.workspace-untrusted', 'runtime.consent-pending',
  'runtime.auth-missing']

/** A frase do motivo; motivo que a tabela nao conhece aparece cru, nunca some. */
export function fraseDoMotivo(motivo: string): string {
  return Object.prototype.hasOwnProperty.call(FRASE_DO_MOTIVO, motivo) ? FRASE_DO_MOTIVO[motivo] as string : motivo
}
