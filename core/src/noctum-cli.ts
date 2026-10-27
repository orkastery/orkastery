/**
 * RM-058, fatia N6 (D1, D12 e D13 da ork-rm058n6): o comando `ork noctum`, a porta do CLI para o arco.
 *
 *   ork noctum propor --arquivo <envelope.json> [--json]   o pedido de abertura vira proposta e pergunta ao dono; nada é autorizado
 *   ork noctum maquina [--json]                            a entrada desta máquina em `maquinas` do envelope `v3`: o nome, a
 *                                                          chave pública e a impressão (RM-058, bloco B, D5)
 *   ork noctum revogar <arco> [--json]                     a pergunta de revogação ao dono (RM-057); nada é revogado
 *   ork noctum responder <arco> --resposta-stdin ...       o envelope assinado do gateway (autorizar ou revogar)
 *   ork noctum terminal --hook-stdin                       o ingresso do terminal, que o hook UserPromptSubmit chama (RM-057);
 *                                                          desligado (D22): só devolve o aviso de por onde responder
 *   ork noctum status [<arco>] [--json]                    o retrato do arco, com as lacunas; sem arco, a lista
 *   ork noctum tique <arco> [--json]                       fechamento, passo e relatório: o que o cron do dono chama
 *   ork noctum relatorio <arco> [--json] [--reenviar C]    o relatório no terminal, ou o reenvio que o dono pede
 *   ork noctum conduzir <arco> [--json]                    o condutor do arco (RM-058, integração, D9): o cron do piloto o
 *                                                          relança, e a trava do kernel prova o vivo
 *   ork noctum aceite <arco> [--json] [--injecoes A]       o aceite do piloto (D12): as medidas M1 a M10, os critérios e o
 *        [--limiares A] [--publicar A]                     veredito, o arquivo completo no estado e o publicável
 *
 * Nenhum subcomando autoriza pelo terminal: o dono autoriza por ingresso autenticado (o gateway assinado, que chega
 * aqui pelo `responder`, ou o diálogo nativo do host pelo MCP). Recusa tipada sai na saída de erro, com código 2.
 */
import * as fs from 'node:fs';
import { kernelDisponivel } from './fila-pesada';
import { lerRespostaStdin } from './hitl-gates';
import { canVerifyPublicReceipt } from './hitl-public-receipt';
import { impedimentoResolvido } from './impedimento';
import { aceiteDoPiloto, gravarAceite, Injecao, lerInjecoes, lerLimiares, Limiares, publicavel, RecusaDoAceite, ResultadoDoAceite,
  sensiveisDoArco } from './noctum-aceite';
import { formatarDataHora } from './horario';
import { exigirManifesto, ManifestoCarregado } from './manifest';
import { lerArco, pedirRevogacao, perguntasDoArco, proporEnvelope, SituacaoDoArco } from './noctum-arco';
import { textoDaPerguntaDoArco } from './noctum-pergunta';
import { comoResponderAoArco, entregarPerguntaDoArco, EntregaDaPerguntaDoArco } from './noctum-pergunta-canal';
import { codigosEmUso } from './pulse-resposta';
import { CANAIS_DO_RELATORIO, ConteudoDoEnvelope, envelopeComTrabalhos, envelopeMultimaquina, impressaoDaChave, MaquinaDoArco, RecusaDoArco,
  validarPedidoDeAbertura } from './noctum-envelope';
import { listarArcos, responderAoArco, retratoDoArco, textoDoRetrato, tiqueDoArco } from './noctum-modo';
import { CanalComTransporte, reenviarRelatorio, relatorioNoTerminal } from './noctum-relatorio';
import { RecusaDoRegistro } from './noctum-registro';
import { lerSupervisao, RecusaDaSupervisao } from './noctum-supervisao';
import { identidadeDaMaquina, NOME_DE_MAQUINA } from './noctum-transporte';
import { conduzirArco, OpcoesDoVigia, ResultadoDoCondutor } from './noctum-vigia';
import { nomeDaMaquina } from './maquina';
import { lerPerfisComContas, PerfilDeRuntime, StoreDePerfis } from './runtime-profiles';
import { CONTRATO_DO_TERMINAL, responderPeloTerminal } from './noctum-terminal';
import { caminhoDoPulseHost, hostDoTransporte, HostDoCanal, HOSTS_DO_CANAL, TransportePulse, transporteValido } from './transporte-do-canal';

export interface ArgsDoNoctum { posicionais: string[]; opcoes: Record<string, string | boolean> }

export const USO_DO_NOCTUM = 'uso: ork noctum propor --arquivo <envelope.json> | maquina [--json] | revogar <arco> [--json] | ' +
  'responder <arco> --resposta-stdin ' +
  '--origem O --canal C --por P --mensagem M [--conta X] | terminal --hook-stdin | status [<arco>] [--json] | tique <arco> [--json] | ' +
  'relatorio <arco> [--json] [--reenviar <canal>] | conduzir <arco> [--json] | aceite <arco> [--json] [--injecoes <arquivo>] ' +
  '[--limiares <arquivo>] [--publicar <arquivo>]';

/** A linha da entrega da pergunta ao canal do dono, sem caminho de máquina. */
function linhaDaEntrega(e: EntregaDaPerguntaDoArco): string {
  if (e.entregue) return `A pergunta também saiu no canal do dono, como a pergunta ${e.numero} (${e.detalhe}).`;
  if (e.jaServida) return `A pergunta já tinha saído no canal do dono como a pergunta ${e.numero}.`;
  return `A pergunta não saiu no canal do dono: ${e.detalhe}.`;
}

/** RM-057 (resposta curta): a entrada do hook `UserPromptSubmit` tem teto, como o envelope do ingresso. */
const TETO_DA_ENTRADA_DO_HOOK = 64 * 1024;

/** A entrada do hook pela entrada padrão, ou `null` quando ela passa do teto ou não é JSON. */
function lerEntradaDoHookStdin(): unknown {
  const partes: Buffer[] = []; let total = 0;
  for (;;) {
    const buf = Buffer.alloc(4096), n = fs.readSync(0, buf, 0, buf.length, null);
    if (!n) break;
    total += n; if (total > TETO_DA_ENTRADA_DO_HOOK) return null;
    partes.push(buf.subarray(0, n));
  }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return null; }
}

/** O pedido de abertura cabe numa leitura do dono: o envelope inteiro tem teto, como o pedido de cada trabalho. */
const TETO_DO_ARQUIVO_DO_ENVELOPE = 64 * 1024;

const texto = (v: string | boolean | undefined): string | undefined => typeof v === 'string' ? v : undefined;

export type MotivoDoAvisoDaProposta = 'noctum.proposta.conta-sem-login' | 'noctum.proposta.workspace-untrusted'
  | 'noctum.proposta.vaga-de-execucao-unica' | 'noctum.proposta.contas-sem-leitura' | 'noctum.proposta.maquina-ausente'
  | 'noctum.proposta.maquina-outra-chave' | 'noctum.proposta.sem-verificador-do-canal';
export interface AvisoDaProposta { motivo: MotivoDoAvisoDaProposta; detalhe: string; correcao: string }

/**
 * RM-058, bloco B (D22): no `v3`, esta máquina só entra no arco se está em `maquinas` com o nome e a chave desta raiz,
 * a mesma conferência do `euNaVersaoVigente`. O aviso só antecipa a recusa: a proposta segue.
 */
function avisosDaMaquina(maquinas: readonly MaquinaDoArco[], eu: { nome: string; chave: string }): AvisoDaProposta[] {
  const listada = maquinas.find(m => m.nome === eu.nome);
  const correcao = 'rode ork noctum maquina --json nesta máquina e ponha a saída em maquinas do envelope';
  if (!listada) {
    return [{ motivo: 'noctum.proposta.maquina-ausente', correcao,
      detalhe: `esta máquina (${eu.nome}) não está em maquinas do envelope v3: fica fora do arco, sem ordem, despacho nem entrega` }];
  }
  if (listada.chave === eu.chave) return [];
  return [{ motivo: 'noctum.proposta.maquina-outra-chave', correcao,
    detalhe: `o envelope dá à máquina ${eu.nome} a chave de impressão ${impressaoDaChave(listada.chave)}, e a desta raiz é ` +
      `${impressaoDaChave(eu.chave)}: a máquina fica fora do arco` }];
}

/**
 * Pré-voo informativo da proposta: antecipa as causas que fariam o arco esperar, mas não autoriza nem bloqueia nada.
 * As dependências opcionais deixam os testes usar perfis, trust e a identidade da máquina simulados sem ler contas reais.
 */
export function avisosDaProposta(carregado: ManifestoCarregado, conteudo: ConteudoDoEnvelope, opcoes: {
  store?: StoreDePerfis;
  confianca?: (raiz: string, perfil: PerfilDeRuntime) => boolean | null;
  /** O nome e a chave pública desta máquina; sem ela, os desta raiz (`identidadeDaMaquina`), lidos só no `v3`. */
  identidade?: () => { nome: string; chave: string };
  /** Testes podem fixar o host e o ambiente sem ler nem copiar credenciais reais. `undefined` usa o transporte local. */
  hostDoDono?: HostDoCanal | null;
  env?: NodeJS.ProcessEnv;
} = {}): AvisoDaProposta[] {
  if (!envelopeComTrabalhos(conteudo)) return [];
  const avisos: AvisoDaProposta[] = envelopeMultimaquina(conteudo)
    ? avisosDaMaquina(conteudo.maquinas, (opcoes.identidade ?? (() => identidadeDaMaquina(carregado.raiz)))()) : [];
  let store: StoreDePerfis | null = null;
  try { store = opcoes.store ?? lerPerfisComContas(carregado.raiz); }
  catch {
    avisos.push({ motivo: 'noctum.proposta.contas-sem-leitura', detalhe: 'as contas do envelope não puderam ser conferidas',
      correcao: 'rode ork accounts check e proponha de novo depois de corrigir a leitura' });
  }
  const confiar = opcoes.confianca ?? ((raiz: string, p: PerfilDeRuntime) => impedimentoResolvido('runtime.workspace-untrusted',
    { cwd: raiz, runtime: p.runtime, configDir: p.runtime === 'claude-bg' ? p.configDir : p.codexHome }));
  if (store) {
    for (const { conta } of conteudo.capacidade.porConta) {
      const p = store.perfis.find(x => x.id === conta);
      if (!p || p.estado === 'sem-auth') {
        avisos.push({ motivo: 'noctum.proposta.conta-sem-login',
          detalhe: `a conta ${conta} do envelope está sem login de assinatura conferido`,
          correcao: `refaça o login da conta ${conta} pelo próprio CLI e rode ork accounts check ${conta}` });
      }
      if (p?.runtime === 'claude-bg' && confiar(carregado.raiz, p) !== true) {
        avisos.push({ motivo: 'noctum.proposta.workspace-untrusted',
          detalhe: `a conta ${conta} não tem o trust da pasta do projeto aceito no runtime; o despacho cairia em runtime.workspace-untrusted`,
          correcao: `abra o runtime da conta ${conta} na pasta do projeto e aceite a confiança` });
      }
    }
  }
  if (conteudo.capacidade.maquina - conteudo.capacidade.revisao === 1) {
    avisos.push({ motivo: 'noctum.proposta.vaga-de-execucao-unica',
      detalhe: `a capacidade da máquina (${conteudo.capacidade.maquina}) menos a revisão (${conteudo.capacidade.revisao}) deixa uma vaga de execução`,
      correcao: 'confirme que uma única sessão de execução por vez é suficiente ou emende a capacidade' });
  }
  const hostLocal = (): HostDoCanal | null => {
    try {
      const lido = JSON.parse(fs.readFileSync(caminhoDoPulseHost(carregado.raiz), 'utf8')) as TransportePulse;
      if (!transporteValido(lido)) return null;
      const host = hostDoTransporte(lido);
      return (HOSTS_DO_CANAL as readonly string[]).includes(host) ? host as HostDoCanal : null;
    } catch { return null; }
  };
  const host = opcoes.hostDoDono === undefined ? hostLocal() : opcoes.hostDoDono;
  if (host && !canVerifyPublicReceipt(host, false, opcoes.env ?? process.env)) {
    avisos.push({ motivo: 'noctum.proposta.sem-verificador-do-canal',
      detalhe: `este processo não consegue reconferir a prova do dono recebida pelo ${host}`,
      correcao: 'o cron do condutor e do tique precisa de ORK_RECEIPT_VERIFIERS com o verificador público gerado por publicHitlVerifiers; ' +
        'a chave de ingresso nunca deve ir ao ambiente dos agentes' });
  }
  return avisos;
}

/**
 * RM-058, integração (T5, D9): o código de saída do `ork noctum conduzir`. 0: o arco terminou ou parou (também quando já
 * estava assim); 2: recusa (sem kernel, sem arco, nunca autorizado, o log da supervisão que não se lê); 3: outro condutor
 * vivo segura a trava; 4: a geração foi tomada por outra instância.
 */
export type CodigoDoCondutor = 0 | 2 | 3 | 4;

export type SaidaDoCondutor = (ResultadoDoCondutor
  | { acao: 'terminal'; situacao: SituacaoDoArco; detalhe: string }
  | { acao: 'parado'; motivo: string; detalhe: string }
  | { acao: 'nunca-autorizado' | 'supervisao-ilegivel'; motivo: string; detalhe: string }) & { codigo: CodigoDoCondutor };

const TERMINAIS: readonly SituacaoDoArco[] = ['expirado', 'revogado', 'encerrado'];

/**
 * O que o `ork noctum conduzir` roda: confere o arco antes da trava (o arco terminal, ou parado pela supervisão, sai 0 sem
 * tomar a trava nem gravar geração) e então conduz pelo `conduzirArco`, com as dependências reais. Os testes passam as
 * simuladas (o `dormir`, o `relogio`, o `maxPassos` e as do passo); o comando de terminal não tem opção de teste.
 */
export function conduzirPeloCli(carregado: ManifestoCarregado, arco: string,
  opcoes: OpcoesDoVigia & { maxPassos?: number; dormir?: (ms: number) => void; relogio?: () => string } = {}): SaidaDoCondutor {
  const { raiz } = carregado;
  if (!kernelDisponivel()) return { acao: 'sem-kernel', detalhe: 'o condutor exige /usr/bin/flock', codigo: 2 };
  const estado = lerArco(raiz, arco);
  if (!estado) return { acao: 'sem-arco', detalhe: `o arco ${arco} não tem proposta`, codigo: 2 };
  if (!estado.autorizadoPor) {
    return { acao: 'nunca-autorizado', motivo: 'noctum.modo.sem-envelope', detalhe: `o arco ${arco} nunca foi autorizado pelo dono: o #Noctum não vale`,
      codigo: 2 };
  }
  if (TERMINAIS.includes(estado.situacao)) {
    return { acao: 'terminal', situacao: estado.situacao, detalhe: `o arco ${arco} está ${estado.situacao}: não há o que conduzir`, codigo: 0 };
  }
  let parada: { motivo: string; detalhe: string } | null;
  try { parada = lerSupervisao(raiz, arco).parada; }
  catch (e) {
    if (e instanceof RecusaDaSupervisao) return { acao: 'supervisao-ilegivel', motivo: e.motivo, detalhe: e.message, codigo: 2 };
    throw e;
  }
  if (parada) return { acao: 'parado', motivo: parada.motivo, detalhe: `a supervisão parou o arco ${arco}: ${parada.detalhe}`, codigo: 0 };
  const r = conduzirArco(carregado, arco, opcoes);
  const codigo: CodigoDoCondutor = r.acao === 'outro-condutor' ? 3 : r.acao === 'saiu' ? (r.ultimo?.acao === 'geracao-vencida' ? 4 : 0) : 2;
  return { ...r, codigo };
}

/** A linha do condutor no terminal: o desfecho, com o motivo. */
function textoDoCondutor(arco: string, r: SaidaDoCondutor): string {
  if (r.acao !== 'saiu') return `Condutor do arco ${arco}: ${r.acao}${'motivo' in r ? ` (${r.motivo})` : ''}: ${r.detalhe}`;
  const u = r.ultimo;
  const ultimo = !u ? 'nenhum passo' : `${u.acao}${'motivo' in u && u.motivo ? ` (${u.motivo})` : ''}${'detalhe' in u && u.detalhe ? `: ${u.detalhe}` : ''}`;
  return `Condutor do arco ${arco}: saiu na geração ${r.geracao}, depois de ${r.passos} passo(s); o último: ${ultimo}`;
}

/** O aceite no terminal: o veredito, as marcas de simulação, as medidas, os critérios e onde ficou o arquivo completo. */
function textoDoAceite(r: ResultadoDoAceite, gravado: { arquivo: string; sha256: string }): string {
  const valor = (v: number | null, unidade: string) => v === null ? 'lacuna' : `${v} ${unidade}`;
  return [`Aceite do piloto do arco ${r.arco}: ${r.veredito} (sha256 ${gravado.sha256.slice(0, 12)})`,
    ...(r.simulacao.simulado ? ['Simulado, nunca vale como piloto:', ...r.simulacao.marcas.map(x => `  • ${x}`)] : []),
    'Medidas:', ...r.medidas.map(x => `  ${x.id} ${x.nome}: ${valor(x.valor, x.unidade)}${x.lacunas.length ? ` (lacunas: ${x.lacunas.join('; ')})` : ''}`),
    'Critérios:', ...r.criterios.map(c => `  ${c.id} [${c.veredito}] ${c.texto}` +
      `${c.limiar ? ` (limiar ${Object.entries(c.limiar).map(([k, v]) => `${k}=${v}`).join(', ')}, ${c.origemDoLimiar})` : ''}: ${c.detalhe}`),
    `Arquivo completo: ${gravado.arquivo}`].join('\n');
}

function recusado(e: unknown): number {
  // A recusa da supervisão (o log adulterado ou ocupado no meio do laço do condutor) também é recusa: sai 2, como o contrato diz.
  if (e instanceof RecusaDoArco || e instanceof RecusaDoRegistro || e instanceof RecusaDoAceite || e instanceof RecusaDaSupervisao) {
    console.error(e.message);
    return 2;
  }
  throw e;
}

export function comandoNoctum(args: ArgsDoNoctum): number {
  const sub = args.posicionais[1];
  const json = args.opcoes.json === true;
  try {
    if (sub === 'propor') {
      const arquivo = texto(args.opcoes.arquivo);
      if (!arquivo || args.posicionais.length !== 2) { console.error(USO_DO_NOCTUM); return 2; }
      let st: fs.Stats;
      try { st = fs.statSync(arquivo); }
      catch { console.error(`noctum.envelope.invalido: o pedido de abertura ${arquivo} não se lê`); return 2; }
      if (!st.isFile() || st.size > TETO_DO_ARQUIVO_DO_ENVELOPE) {
        console.error(`noctum.envelope.invalido: o pedido de abertura é um arquivo JSON de até ${TETO_DO_ARQUIVO_DO_ENVELOPE} bytes`);
        return 2;
      }
      let pedido: unknown;
      try { pedido = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
      catch { console.error('noctum.envelope.invalido: o pedido de abertura não é JSON'); return 2; }
      const carregado = exigirManifesto();
      const { raiz } = carregado;
      const quando = new Date().toISOString();
      const r = proporEnvelope(raiz, pedido, quando, codigosEmUso(raiz));
      // Os avisos olham o envelope que o dono vai autorizar, já validado pelo proporEnvelope: o vigente (lerArco) só
      // existe depois da autorização, e na primeira proposta os avisos sumiam (RM-058, bloco B).
      const proposto = validarPedidoDeAbertura(pedido);
      const fuso = proposto.janela.fuso;
      const avisos = avisosDaProposta(carregado, proposto);
      // RM-057 (resposta curta, D4 e D9): a proposta é a pergunta ao dono, que sai também pelo canal dele quando ele tem um.
      const q = r.codigo ? perguntasDoArco(raiz, r.arco, quando).find(x => x.codigo === r.codigo && x.situacao === 'pendente') : undefined;
      const entrega = q ? entregarPerguntaDoArco(raiz, q, { quando }) : null;
      const textoDaPergunta = q ? textoDaPerguntaDoArco(q, 'terminal', { quando, ...(entrega?.numero ? { numero: entrega.numero } : {}) }) : null;
      const instrucoes = q ? comoResponderAoArco(q) : [`O envelope ${r.envelopeSha256.slice(0, 12)} já vale no arco ${r.arco}: não há o que autorizar`];
      if (json) {
        console.log(JSON.stringify({ ...r, autorizado: false, avisos, comoAutorizar: instrucoes,
          pergunta: q ? { codigo: q.codigo, prazo: q.prazo, texto: textoDaPergunta, entrega } : null }, null, 2));
      } else {
        console.log([...r.resumo, '',
          ...(avisos.length ? ['Avisos (não bloqueiam a proposta):', ...avisos.map(a => `• ${a.motivo}: ${a.detalhe}. Correção: ${a.correcao}.`), ''] : []),
          `Proposta ${r.versao} do arco ${r.arco}, vale até ${formatarDataHora(r.prazo, { fuso, locale: 'pt-BR' })}.`,
          'Nada foi autorizado: o dono autoriza respondendo à pergunta, nunca por silêncio nem por este comando.',
          ...(textoDaPergunta ? ['', textoDaPergunta, '', linhaDaEntrega(entrega!)] : instrucoes)].join('\n'));
      }
      return 0;
    }
    if (sub === 'maquina') {
      // RM-058, bloco B (B4, D5): o que o dono copia de cada máquina para `maquinas` do envelope `v3`. O nome vem antes da
      // chave: o recusado não cria a chave local. A chave privada nunca sai desta raiz.
      if (args.posicionais.length !== 2) { console.error(USO_DO_NOCTUM); return 2; }
      const { raiz } = exigirManifesto();
      const nome = nomeDaMaquina();
      if (!NOME_DE_MAQUINA.test(nome)) {
        console.error(`noctum.maquina.nome-invalido: o nome desta máquina ("${nome}") não serve no envelope v3: letras, dígitos, ` +
          'ponto, _ ou -, até 64, começando por letra ou dígito. Correção: grave um nome válido em ~/.orkastery/maquina.json ' +
          '(o campo nome) ou defina ORK_MAQUINA em todo processo do ork desta máquina, o cron e os gateways inclusive');
        return 2;
      }
      const { chave } = identidadeDaMaquina(raiz, nome);
      const impressao = impressaoDaChave(chave);
      if (json) console.log(JSON.stringify({ nome, chave, impressao }, null, 2));
      else {
        console.log(['Esta máquina no envelope v3:', `  nome       ${nome}`, `  chave      ${chave}`, `  impressão  ${impressao}`, '',
          'A entrada para maquinas do envelope:', JSON.stringify({ nome, chave }), '',
          'A chave privada não sai desta raiz; o dono confere a impressão no resumo da proposta.'].join('\n'));
      }
      return 0;
    }
    if (sub === 'revogar') {
      // RM-057 (resposta curta, D10): abre a pergunta de revogação e a entrega; quem revoga é a resposta do dono.
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3) { console.error(USO_DO_NOCTUM); return 2; }
      const { raiz } = exigirManifesto();
      const quando = new Date().toISOString();
      const r = pedirRevogacao(raiz, arco, quando, codigosEmUso(raiz));
      const q = perguntasDoArco(raiz, arco, quando).find(x => x.codigo === r.codigo)!;
      const entrega = entregarPerguntaDoArco(raiz, q, { quando });
      const textoDaPergunta = textoDaPerguntaDoArco(q, 'terminal', { quando, ...(entrega.numero ? { numero: entrega.numero } : {}) });
      if (json) {
        console.log(JSON.stringify({ arco, revogado: false, comoRevogar: comoResponderAoArco(q),
          pergunta: { codigo: q.codigo, prazo: q.prazo, nova: r.nova, texto: textoDaPergunta, entrega } }, null, 2));
      } else {
        console.log([textoDaPergunta, '', linhaDaEntrega(entrega), 'Nada foi revogado: o dono revoga respondendo à pergunta.'].join('\n'));
      }
      return 0;
    }
    if (sub === 'responder') {
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3 || args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined) {
        console.error('noctum responder exige o arco, --resposta-stdin e o envelope do ingresso autenticado na entrada');
        return 2;
      }
      // A entrada malformada ou o argv que diverge do envelope é recusa tipada, como a do núcleo, e nunca autoriza nada.
      let envelope: ReturnType<typeof lerRespostaStdin>;
      try {
        envelope = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem), origem: texto(args.opcoes.origem),
          canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
      } catch (e) { console.error(`noctum.origem.sem-prova: ${(e as Error).message.slice(0, 300)}`); return 2; }
      console.log(JSON.stringify(responderAoArco(exigirManifesto().raiz, arco, envelope)));
      return 0;
    }
    if (sub === 'terminal') {
      // RM-057 (resposta curta, D5): o ingresso do terminal, que o hook UserPromptSubmit do plugin chama. Sai 0 sempre: a
      // decisão vai em JSON, e o hook só a transporta. GO-FIX 2 (D22): o ingresso está desligado, e este comando nunca o
      // liga; a resposta curta a uma pergunta que espera o dono volta recusada, com o aviso de por onde responder.
      if (args.opcoes['hook-stdin'] !== true || args.posicionais.length !== 2) { console.error(USO_DO_NOCTUM); return 2; }
      const entrada = lerEntradaDoHookStdin();
      let raiz: string | null = null;
      try { raiz = exigirManifesto().raiz; } catch { raiz = null; }
      try { console.log(JSON.stringify(responderPeloTerminal(raiz, entrada, { env: process.env }))); }
      catch (e) {
        console.error(`noctum terminal: ${(e as Error).message.slice(0, 200)}`);
        console.log(JSON.stringify({ contrato: CONTRATO_DO_TERMINAL, acao: 'ignorar', motivo: 'erro-interno' }));
      }
      return 0;
    }
    if (sub === 'status') {
      const carregado = exigirManifesto();
      const arco = args.posicionais[2];
      if (!arco) {
        const arcos = listarArcos(carregado.raiz).map(a => {
          try { return { arco: a, situacao: lerArco(carregado.raiz, a)?.situacao ?? 'sem-proposta' }; }
          catch (e) { return { arco: a, situacao: 'ilegivel', detalhe: (e as Error).message.slice(0, 200) }; }
        });
        if (json) console.log(JSON.stringify({ arcos }, null, 2));
        else console.log(arcos.length ? arcos.map(x => `${x.arco}: ${x.situacao}`).join('\n') : 'Nenhum arco #Noctum neste projeto.');
        return 0;
      }
      const r = retratoDoArco(carregado, arco);
      if (!r) { console.error(`noctum.efeito.sem-autorizacao: o arco ${arco} não tem proposta`); return 2; }
      console.log(json ? JSON.stringify(r, null, 2) : textoDoRetrato(r));
      return 0;
    }
    if (sub === 'tique') {
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3) { console.error(USO_DO_NOCTUM); return 2; }
      const r = tiqueDoArco(exigirManifesto(), arco);
      if (json) console.log(JSON.stringify(r, null, 2));
      else {
        console.log([`Tique do arco ${arco}:`,
          `  fechamento: ${r.fechamento.fechado ? `${r.fechamento.motivo}${r.fechamento.agora ? ' (agora)' : ''}` : r.fechamento.detalhe}`,
          `  passo: ${r.passo ? `${r.passo.acao}${'motivo' in r.passo && r.passo.motivo ? ` (${r.passo.motivo})` : ''}` : 'nenhum'}`,
          `  relatório: ${r.relatorio.acao}: ${r.relatorio.detalhe}`,
          ...r.falhas.map(f => `  falha no ${f.etapa}: ${f.detalhe}`)].join('\n'));
      }
      // A falha de uma etapa não segura o relatório, mas o cron do dono a vê pela saída.
      return r.falhas.length ? 1 : 0;
    }
    if (sub === 'relatorio') {
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3) { console.error(USO_DO_NOCTUM); return 2; }
      const carregado = exigirManifesto();
      const reenviar = texto(args.opcoes.reenviar);
      if (args.opcoes.reenviar !== undefined) {
        if (!reenviar || reenviar === 'terminal' || !(CANAIS_DO_RELATORIO as readonly string[]).includes(reenviar)) {
          console.error('noctum relatorio --reenviar exige o canal telegram ou openclaw');
          return 2;
        }
        const r = reenviarRelatorio(carregado, arco, reenviar as CanalComTransporte);
        console.log(json ? JSON.stringify(r, null, 2) : `Reenvio pelo canal ${reenviar}: ${r.acao}, ${r.enviadas} página(s) confirmada(s). ${r.detalhe}`);
        return r.acao === 'entregue' ? 0 : 1;
      }
      // O recibo do canal terminal só vem do terminal interativo, nunca de saída redirecionada nem do --json.
      const r = relatorioNoTerminal(carregado, arco, { interativo: !json && process.stdout.isTTY === true });
      if (!r) { console.error(`noctum.efeito.sem-autorizacao: o arco ${arco} não tem envelope autorizado`); return 2; }
      console.log(json ? JSON.stringify(r, null, 2) : r.paginas.join('\n\n'));
      return 0;
    }
    if (sub === 'conduzir') {
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3) { console.error(USO_DO_NOCTUM); return 2; }
      const r = conduzirPeloCli(exigirManifesto(), arco);
      if (json) console.log(JSON.stringify(r, null, 2));
      else if (r.codigo === 2) console.error(textoDoCondutor(arco, r));
      else console.log(textoDoCondutor(arco, r));
      return r.codigo;
    }
    if (sub === 'aceite') {
      const arco = args.posicionais[2];
      const arquivo = (nome: string): string | null | false => args.opcoes[nome] === undefined ? null : texto(args.opcoes[nome]) ?? false;
      const [injecoes, limiares, publicar] = [arquivo('injecoes'), arquivo('limiares'), arquivo('publicar')];
      if (!arco || args.posicionais.length !== 3 || injecoes === false || limiares === false || publicar === false) { console.error(USO_DO_NOCTUM); return 2; }
      let agenda: Injecao[] | null = null, doDono: Partial<Limiares> | null = null;
      try {
        if (injecoes) agenda = lerInjecoes(fs.readFileSync(injecoes, 'utf8'));
        if (limiares) doDono = lerLimiares(JSON.parse(fs.readFileSync(limiares, 'utf8')));
      } catch (e) {
        if (e instanceof RecusaDoAceite) throw e;
        console.error(`noctum.aceite.arquivo: ${(e as Error).message.slice(0, 200)}`);
        return 2;
      }
      const carregado = exigirManifesto();
      // RM-058, integração (T8, D12): o arquivo completo fica no estado; o publicável vai aonde o dono pedir.
      const r = aceiteDoPiloto(carregado, arco, { injecoes: agenda, limiares: doDono });
      const gravado = gravarAceite(carregado.raiz, r);
      if (publicar) fs.writeFileSync(publicar, `${JSON.stringify(publicavel(r, gravado.sha256, sensiveisDoArco(carregado, arco)), null, 2)}\n`);
      if (json) console.log(JSON.stringify({ ...r, sha256: gravado.sha256, arquivo: gravado.arquivo }, null, 2));
      else console.log(textoDoAceite(r, gravado));
      return r.veredito === 'aprovado' ? 0 : 1;
    }
  } catch (e) { return recusado(e); }
  console.error(USO_DO_NOCTUM);
  return 2;
}
