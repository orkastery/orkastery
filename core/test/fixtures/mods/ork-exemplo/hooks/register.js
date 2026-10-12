// Mod de exemplo dos testes do nucleo (RM-059): segue a convencao ork.mod/v1 e nao muda a sessao.
// O modulo e .js e o teste do mod e .tsx: o build:test do nucleo compila test/**/*.ts e deixa os dois de fora.

/** @type {import('claude-code').Register} */
export const register = on => {
  on('classic.SessionStart', ($, e, next) => {
    $.ui.status('ork-exemplo: sessao de fase')
    return next(e)
  })
}
