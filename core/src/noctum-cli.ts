/**
 * RM-058, fatia N6 (D1, D12 e D13 da ork-rm058n6): o comando `ork noctum`, a porta do CLI para o arco.
 *
 *   ork noctum propor --arquivo <envelope.json> [--json]   o pedido de abertura vira proposta; nada é autorizado
 *   ork noctum responder <arco> --resposta-stdin ...       o envelope assinado do gateway (autorizar ou revogar)
 *   ork noctum status [<arco>] [--json]                    o retrato do arco, com as lacunas; sem arco, a lista
 *   ork noctum tique <arco> [--json]                       fechamento, passo e relatório: o que o cron do dono chama
 *   ork noctum relatorio <arco> [--json] [--reenviar C]    o relatório no terminal, ou o reenvio que o dono pede
 *
 * Nenhum subcomando autoriza pelo terminal: o dono autoriza por ingresso autenticado (o gateway assinado, que chega
 * aqui pelo `responder`, ou o diálogo nativo do host pelo MCP). Recusa tipada sai na saída de erro, com código 2.
 */
import * as fs from 'node:fs';
import { lerRespostaStdin } from './hitl-gates';
import { formatarDataHora } from './horario';
import { exigirManifesto } from './manifest';
import { lerArco, proporEnvelope } from './noctum-arco';
import { CANAIS_DO_RELATORIO, RecusaDoArco } from './noctum-envelope';
import { listarArcos, responderAoArco, retratoDoArco, textoDoRetrato, tiqueDoArco } from './noctum-modo';
import { CanalComTransporte, reenviarRelatorio, relatorioNoTerminal } from './noctum-relatorio';
import { RecusaDoRegistro } from './noctum-registro';

export interface ArgsDoNoctum { posicionais: string[]; opcoes: Record<string, string | boolean> }

export const USO_DO_NOCTUM = 'uso: ork noctum propor --arquivo <envelope.json> | responder <arco> --resposta-stdin --origem O --canal C ' +
  '--por P --mensagem M [--conta X] | status [<arco>] [--json] | tique <arco> [--json] | relatorio <arco> [--json] [--reenviar <canal>]';

/** O pedido de abertura cabe numa leitura do dono: o envelope inteiro tem teto, como o pedido de cada trabalho. */
const TETO_DO_ARQUIVO_DO_ENVELOPE = 64 * 1024;

const texto = (v: string | boolean | undefined): string | undefined => typeof v === 'string' ? v : undefined;

function recusado(e: unknown): number {
  if (e instanceof RecusaDoArco || e instanceof RecusaDoRegistro) { console.error(e.message); return 2; }
  throw e;
}

export function comandoNoctum(args: ArgsDoNoctum): number {
  const sub = args.posicionais[1];
  const json = args.opcoes.json === true;
  try {
    if (sub === 'propor') {
      const arquivo = texto(args.opcoes.arquivo);
      if (!arquivo || args.posicionais.length !== 2) { console.error(USO_DO_NOCTUM); return 2; }
      const st = fs.statSync(arquivo);
      if (!st.isFile() || st.size > TETO_DO_ARQUIVO_DO_ENVELOPE) {
        console.error(`noctum.envelope.invalido: o pedido de abertura é um arquivo JSON de até ${TETO_DO_ARQUIVO_DO_ENVELOPE} bytes`);
        return 2;
      }
      let pedido: unknown;
      try { pedido = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
      catch { console.error('noctum.envelope.invalido: o pedido de abertura não é JSON'); return 2; }
      const { raiz } = exigirManifesto();
      const r = proporEnvelope(raiz, pedido);
      const fuso = lerArco(raiz, r.arco)?.conteudo?.janela.fuso ?? (pedido as { janela?: { fuso?: string } })?.janela?.fuso;
      const instrucoes = [`No Telegram: /ork noctum ${r.arco} autorizar ${r.envelopeSha256}`,
        `No host (Claude Code ou Codex): a ferramenta ork_noctum_autorizar com o arco ${r.arco} e o hash, que abre o diálogo nativo`];
      if (json) console.log(JSON.stringify({ ...r, autorizado: false, comoAutorizar: instrucoes }, null, 2));
      else {
        console.log([...r.resumo, '',
          `Proposta ${r.versao} do arco ${r.arco}, hash ${r.envelopeSha256}, vale até ${formatarDataHora(r.prazo, { fuso, locale: 'pt-BR' })}.`,
          'Nada foi autorizado: o dono autoriza por ingresso autenticado, nunca por silêncio nem por este comando.', ...instrucoes].join('\n'));
      }
      return 0;
    }
    if (sub === 'responder') {
      const arco = args.posicionais[2];
      if (!arco || args.posicionais.length !== 3 || args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined) {
        console.error('noctum responder exige o arco, --resposta-stdin e o envelope do ingresso autenticado na entrada');
        return 2;
      }
      const envelope = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem), origem: texto(args.opcoes.origem),
        canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
      console.log(JSON.stringify(responderAoArco(exigirManifesto().raiz, arco, envelope)));
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
  } catch (e) { return recusado(e); }
  console.error(USO_DO_NOCTUM);
  return 2;
}
