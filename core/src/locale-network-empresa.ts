/** Mensagens acionáveis da rede coletiva; o código JSON não é traduzido. */
import type { Locale } from './locale';

export interface TextoDaFalhaEmpresa { mensagem: string; acao: string }

const PT: Record<string, TextoDaFalhaEmpresa> = {
  'rede-empresa.uso': { mensagem: 'os argumentos da rede coletiva são inválidos', acao: 'confira o uso e informe referências no formato github:dono/repo ou gitlab:grupo/repo' },
  'rede-empresa.config-ausente': { mensagem: 'a inscrição não está configurada nesta máquina', acao: 'o maestro deve rodar `ork network empresa aceitar` antes de publicar, consultar ou sair' },
  'rede-empresa.config-invalida': { mensagem: 'a configuração local da rede coletiva tem JSON ou contrato inválido', acao: 'corrija ou remova `rede-empresa.json` e repita `ork network empresa aceitar`; o conteúdo inválido não é exibido' },
  'rede-empresa.documento-remoto-invalido': { mensagem: 'a rede coletiva contém um documento com JSON ou contrato inválido', acao: 'a administração deve corrigir o documento no repositório privado e repetir; o conteúdo inválido não é exibido' },
  'rede-empresa.politica-ausente': { mensagem: 'a rede coletiva não tem política válida', acao: 'a administração deve rodar `ork network empresa criar` e confirmar a política' },
  'rede-empresa.politica-incompativel': { mensagem: 'a versão da política diverge da inscrição', acao: 'consulte o status e refaça a inscrição com a versão vigente' },
  'rede-empresa.inscricao-ausente': { mensagem: 'a inscrição não existe na rede coletiva', acao: 'a empresa deve rodar `ork network empresa inscrever`; depois o maestro roda `ork network empresa aceitar`' },
  'rede-empresa.inscricao-inativa': { mensagem: 'a inscrição não está ativa', acao: 'consulte o status e peça uma nova inscrição se ela foi revogada ou encerrada' },
  'rede-empresa.identidade-divergente': { mensagem: 'a conta autenticada não é a conta vinculada ao aceite', acao: 'entre na forja com a conta correta e repita; não troque o identificador da inscrição' },
  'rede-empresa.rede-divergente': { mensagem: 'a rede pessoal diverge da inscrição', acao: 'use a referência registrada ou peça à administração uma nova inscrição' },
  'rede-empresa.projeto-nao-autorizado': { mensagem: 'o projeto não está autorizado na inscrição', acao: 'publique apenas projetos listados no status ou peça à administração para atualizar a inscrição' },
  'rede-empresa.saida-negada': { mensagem: 'a política vigente não permite saída autônoma', acao: 'peça à administração para revogar a inscrição' },
  'rede-empresa.projecao-invalida': { mensagem: 'a projeção excede o contrato fechado', acao: 'reduza o volume de entrada ou atualize o Orkastery; não remova a barreira de privacidade' },
  'rede-empresa.dado-privado': { mensagem: 'a projeção contém dado privado ou a varredura não pôde concluir', acao: 'remova o dado da origem ou corrija a varredura e repita; o valor encontrado não é exibido' },
  'rede-empresa.segredo': { mensagem: 'a projeção contém padrão de segredo', acao: 'revogue o segredo, remova-o da origem e repita sem copiar o valor para logs ou argumentos' },
  'rede-empresa.forja-indisponivel': { mensagem: 'a forja não pôde ser lida; a publicação ficou pendente', acao: 'confira login, acesso e alcance da forja e repita `ork network empresa publicar`' },
  'rede-empresa.concorrencia': { mensagem: 'a branch avançou em todas as tentativas', acao: 'aguarde a outra escrita terminar e repita; não use `force`' },
  'rede-empresa.repositorio-publico': { mensagem: 'o repositório da rede coletiva não é privado', acao: 'torne o repositório privado na forja antes de inscrever ou publicar' },
  'forja.ausente': { mensagem: 'a CLI da forja não está disponível', acao: 'instale `gh` ou `glab`, faça login no host correto e repita' },
  'forja.sem-login': { mensagem: 'a CLI da forja não tem login válido no host', acao: 'rode `gh auth login` ou `glab auth login` para o host correto e repita' },
  'forja.sem-permissao': { mensagem: 'a conta não tem permissão para a operação', acao: 'confirme acesso ao dono, à rede privada e aos projetos e repita' },
  'forja.nao-achei': { mensagem: 'a forja não encontrou o dono ou repositório', acao: 'confira host e caminho e peça acesso antes de repetir' },
  'forja.pedido-recusado': { mensagem: 'a forja recusou o pedido', acao: 'confira dono, nome, visibilidade e permissões e repita' },
  'forja.indisponivel': { mensagem: 'a forja não respondeu', acao: 'confira login, acesso e alcance da forja e repita' },
  'forja.limite': { mensagem: 'a forja limitou as chamadas', acao: 'aguarde a janela indicada pela forja e repita' },
  'forja.conflito': { mensagem: 'a forja encontrou uma alteração concorrente', acao: 'releia o status e repita sem `force`' },
};

const EN: Record<string, TextoDaFalhaEmpresa> = {
  'rede-empresa.uso': { mensagem: 'the collective network arguments are invalid', acao: 'check usage and provide references as github:owner/repo or gitlab:group/repo' },
  'rede-empresa.config-ausente': { mensagem: 'this machine has no configuration for the enrollment', acao: 'the maestro must run `ork network empresa aceitar` before publishing, checking status, or leaving' },
  'rede-empresa.config-invalida': { mensagem: 'the local collective-network configuration has invalid JSON or contract data', acao: 'repair or remove `rede-empresa.json` and run `ork network empresa aceitar` again; invalid content is not displayed' },
  'rede-empresa.documento-remoto-invalido': { mensagem: 'the collective network contains a document with invalid JSON or contract data', acao: 'an administrator must repair the document in the private repository and retry; invalid content is not displayed' },
  'rede-empresa.politica-ausente': { mensagem: 'the collective network has no valid policy', acao: 'an administrator must run `ork network empresa criar` and confirm the policy' },
  'rede-empresa.politica-incompativel': { mensagem: 'the policy version does not match the enrollment', acao: 'check status and enroll again with the current version' },
  'rede-empresa.inscricao-ausente': { mensagem: 'the enrollment does not exist in the collective network', acao: 'the company must run `ork network empresa inscrever`; then the maestro runs `ork network empresa aceitar`' },
  'rede-empresa.inscricao-inativa': { mensagem: 'the enrollment is not active', acao: 'check status and request a new enrollment if it was revoked or closed' },
  'rede-empresa.identidade-divergente': { mensagem: 'the authenticated account is not the account bound to acceptance', acao: 'sign in to the forge with the correct account and retry; do not replace the enrollment id' },
  'rede-empresa.rede-divergente': { mensagem: 'the personal network does not match the enrollment', acao: 'use the registered reference or ask an administrator for a new enrollment' },
  'rede-empresa.projeto-nao-autorizado': { mensagem: 'the project is not authorized by the enrollment', acao: 'publish only projects shown by status or ask an administrator to update the enrollment' },
  'rede-empresa.saida-negada': { mensagem: 'the current policy does not allow autonomous exit', acao: 'ask an administrator to revoke the enrollment' },
  'rede-empresa.projecao-invalida': { mensagem: 'the projection exceeds the closed contract', acao: 'reduce the input volume or update Orkastery; do not remove the privacy barrier' },
  'rede-empresa.dado-privado': { mensagem: 'the projection contains private data or the scan could not finish', acao: 'remove the data at its source or repair the scan and retry; the matched value is not shown' },
  'rede-empresa.segredo': { mensagem: 'the projection contains a secret pattern', acao: 'revoke the secret, remove it at its source, and retry without copying it into logs or arguments' },
  'rede-empresa.forja-indisponivel': { mensagem: 'the forge could not be read; publication is pending', acao: 'check forge login, access, and connectivity, then retry `ork network empresa publicar`' },
  'rede-empresa.concorrencia': { mensagem: 'the branch advanced on every attempt', acao: 'wait for the other write to finish and retry; do not use `force`' },
  'rede-empresa.repositorio-publico': { mensagem: 'the collective network repository is not private', acao: 'make the repository private in the forge before enrolling or publishing' },
  'forja.ausente': { mensagem: 'the forge CLI is unavailable', acao: 'install `gh` or `glab`, sign in to the correct host, and retry' },
  'forja.sem-login': { mensagem: 'the forge CLI has no valid login for the host', acao: 'run `gh auth login` or `glab auth login` for the correct host and retry' },
  'forja.sem-permissao': { mensagem: 'the account lacks permission for this operation', acao: 'confirm access to the owner, private network, and projects, then retry' },
  'forja.nao-achei': { mensagem: 'the forge could not find the owner or repository', acao: 'check the host and path and request access before retrying' },
  'forja.pedido-recusado': { mensagem: 'the forge rejected the request', acao: 'check owner, name, visibility, and permissions, then retry' },
  'forja.indisponivel': { mensagem: 'the forge did not respond', acao: 'check forge login, access, and connectivity, then retry' },
  'forja.limite': { mensagem: 'the forge rate-limited the request', acao: 'wait for the window reported by the forge and retry' },
  'forja.conflito': { mensagem: 'the forge reported a concurrent change', acao: 'read status again and retry without `force`' },
};

export const USO_REDE_EMPRESA_PT_BR = 'uso: ork network empresa criar|inscrever|aceitar|publicar|status|sair|revogar [opções]';
export const USO_REDE_EMPRESA_EN = 'usage: ork network empresa criar|inscrever|aceitar|publicar|status|sair|revogar [options]';

export function textoDaFalhaEmpresa(codigo: string, locale: Locale): TextoDaFalhaEmpresa {
  const catalogo = locale === 'en' ? EN : PT;
  return catalogo[codigo] ?? (locale === 'en'
    ? { mensagem: 'the collective network operation failed', acao: 'check `ork network empresa status`, correct the reported condition, and retry' }
    : { mensagem: 'a operação da rede coletiva falhou', acao: 'consulte `ork network empresa status`, corrija a condição informada e repita' });
}
