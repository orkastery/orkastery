// Apoio dos testes do kit da ponte. O kit nao tem disco: a lista de autoridade que a guarda le chega por
// este `fs.read` de baixo. E uma lista reduzida, com os mesmos ids e as mesmas formas da real; a lista
// real (adapters/claude-code/mods/autoridade.json) e conferida item a item pelo teste do nucleo.
export const LISTA = JSON.stringify({
  formato: 'ork.mods-autoridade/v1',
  regra: 'nenhum mod aprova gate, permissao, nota do MASTER, push ou tag pelo dono, nem fala como o dono',
  ganchosProibidos: [
    { id: 'elicitation', evento: 'classic.Elicitation', porque: 'responderia o dialogo nativo' },
    { id: 'permission-request', evento: 'classic.PermissionRequest', porque: 'aprovaria permissao' },
  ],
  decisoesProibidas: [{ id: 'tool-check-allow', evento: 'tool.check', decisao: 'allow', porque: 'aprovaria chamada' }],
  chamadasProibidas: [
    { id: 'prompt-submit', chamada: 'prompt.submit', porque: 'manda texto como o dono' },
    { id: 'session-append-usuario', chamada: 'session.append', tipo: 'user', porque: 'linha de usuario' },
  ],
  argvProibido: [
    { id: 'gate-answer', sequencia: ['gate', 'answer'], porque: 'responde gate pelo dono' },
    { id: 'master-nota', sequencia: ['master'], opcao: '--score', porque: 'da a nota do MASTER' },
    { id: 'git-push', programa: 'git', subcomando: 'push', porque: 'publica sem prova' },
    { id: 'git-tag', programa: 'git', subcomando: 'tag', porque: 'tag e do dono' },
    { id: 'gh', programa: 'gh', porque: 'PR e merge fora do nucleo' },
  ],
  ambienteProibido: [{ id: 'hitl-env', prefixo: 'ORK_HITL_', porque: 'ingresso humano' }],
  caminhosProibidos: [{ id: 'hermes-env', trecho: '.hermes/.env', porque: 'segredos do canal do dono' }],
  reservadosAPonte: [
    { id: 'processos', evento: 'process.*', porque: 'a guarda vigia os processos' },
    { id: 'arquivos', evento: 'fs.*', porque: 'a lista sai do disco' },
    { id: 'registro', evento: 'plugin.register', porque: 'so a ponte confere os mods' },
  ],
  permitidos: [{ id: 'decisao-autonoma', sequencia: ['decisao', 'registrar'], porque: 'decisao autonoma do nucleo' }],
})

/**
 * O disco de baixo dos testes: a lista ao lado dos mods (ou `semLista` para provar que a guarda fecha) e,
 * para os outros caminhos, o que `outros` responder.
 */
export function comDisco(on, opcoes: { semLista?: boolean; outros?: (caminho: string) => string } = {}) {
  on('fs.read', ($, e) => {
    if (String(e.path).endsWith('/autoridade.json')) {
      if (opcoes.semLista) throw new Error(`ENOENT: ${e.path}`)
      return { value: LISTA }
    }
    if (opcoes.outros) return { value: opcoes.outros(String(e.path)) }
    throw new Error(`ENOENT: ${e.path}`)
  })
}
