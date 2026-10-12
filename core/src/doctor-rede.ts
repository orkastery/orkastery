/**
 * RM-053 (fatia 2): o check "rede" do `ork doctor`.
 *
 * A rede pessoal publica sozinha (batida do pulse e eventos de thread) e so deixava rastro em
 * `~/.orkastery/rede/rede.log`: a srvjcp86 ficou de 02/10 em diante como membro herdado da fabrica,
 * com toda publicacao caindo em `rede.sem-repositorio`, e o doctor dizia PRONTO sem uma palavra.
 *
 * O check diz a adesao, a casa, a ultima batida publicada e a ultima falha do log. Ele so le
 * arquivos locais (`rede.json`, `maquina.json`, `rede/publicada.json`, `rede/rede.log`): nao chama
 * a forja, nao cria estado e roda de qualquer diretorio. Nunca reprova: a rede e opcional e o
 * doctor e gate de despacho; o pior nivel e `warn`, com a correcao.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatarDataHora } from './horario';
import { lerMarcaDaRede } from './rede';
import { adesaoDaRede, pastaDaRede } from './rede-adesao';
import { duracao, SEM_BATIDA_MS } from './rede-status';
import { emUmaLinha } from './saida-segura';
import { Check } from './types';
import { msg } from './locale';

/** O fim do `rede.log` que o doctor le: o log so cresce, e o que importa e o mais recente. */
export const CAUDA_DO_LOG_BYTES = 64 * 1024;

export interface RegistroDaRede { ts: string; acao: string; origem: string | null; erro: string | null }

/** As linhas legiveis do fim do `rede.log`, da mais antiga para a mais nova. Sem log, lista vazia. */
export function caudaDoLogDaRede(arquivo: string = path.join(pastaDaRede(), 'rede.log')): RegistroDaRede[] {
  let texto: string;
  try {
    const fd = fs.openSync(arquivo, 'r');
    try {
      const tamanho = fs.fstatSync(fd).size;
      const inicio = Math.max(0, tamanho - CAUDA_DO_LOG_BYTES);
      const buf = Buffer.alloc(tamanho - inicio);
      fs.readSync(fd, buf, 0, buf.length, inicio);
      texto = buf.toString('utf8');
      // A primeira linha de uma cauda cortada vem pela metade.
      if (inicio > 0) texto = texto.slice(texto.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  const registros: RegistroDaRede[] = [];
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    try {
      const r = JSON.parse(linha) as Record<string, unknown>;
      if (typeof r.ts !== 'string' || !Number.isFinite(Date.parse(r.ts)) || typeof r.acao !== 'string') continue;
      registros.push({ ts: r.ts, acao: r.acao, origem: typeof r.origem === 'string' ? r.origem : null,
        erro: typeof r.erro === 'string' ? r.erro : null });
    } catch { /* linha ilegivel: o log e informativo */ }
  }
  return registros;
}

const curto = (s: string, teto = 200): string => {
  const limpo = emUmaLinha(s).trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/** A correcao pela familia do erro da ultima falha (o prefixo tipado, como `rede.sem-repositorio`). */
export function correcaoDaFalha(erro: string): string {
  const codigo = /^([a-z]+\.[a-z-]+):/.exec(erro)?.[1] ?? '';
  const m = msg().doctor;
  if (codigo === 'rede.sem-repositorio' || codigo === 'rede.repositorio-alheio') return m.redeSemCasaCorrecao;
  if (codigo === 'rede.sem-forja') return m.redeSemForjaCorrecao;
  if (codigo === 'rede.repositorio-publico') return m.redePublicaCorrecao;
  if (codigo === 'rede.nome-em-uso') return m.redeNomeCorrecao;
  return m.redeOutraCorrecao;
}

/** O check "rede". `agoraMs` e o log ficam injetaveis para o teste. */
export function checarRede(opcoes: { agoraMs?: number; log?: string } = {}): Check {
  const nome = 'rede';
  const agora = opcoes.agoraMs ?? Date.now();
  const adesao = adesaoDaRede();
  if (!adesao.membro) {
    return { nome, nivel: 'ok', detalhe: adesao.config && !adesao.config.membro
      ? msg().doctor.redeSaiu
      : msg().doctor.foraDaRede };
  }
  const marca = lerMarcaDaRede();
  const config = adesao.config;
  const casa = config?.host && config.dono && config.repositorio ? `${config.host}/${config.dono}/${config.repositorio}`
    : typeof marca?.casa === 'string' ? marca.casa : null;
  const registros = caudaDoLogDaRede(opcoes.log);
  const falha = [...registros].reverse().find((r) => r.acao === 'falhou') ?? null;
  const emBatida = marca && typeof marca.em === 'string' && Number.isFinite(Date.parse(marca.em)) ? marca.em : null;
  const idade = emBatida ? agora - Date.parse(emBatida) : NaN;

  const m = msg().doctor;
  const partes = [
    adesao.adesao === 'fabrica' ? m.redeMembroHerdado : m.redeMembro,
    casa ? m.redeCasa(curto(casa, 120)) : m.redeSemCasa,
    emBatida ? m.redeBatida(formatarDataHora(emBatida), duracao(idade)) : m.redeSemBatida,
    falha ? m.redeFalha(formatarDataHora(falha.ts), falha.origem ? curto(falha.origem, 20) : null, curto(falha.erro ?? m.redeSemDetalhe))
      : m.redeSemFalha,
  ];
  // A falha mais nova que a ultima batida e o estado de agora; a de antes ja passou.
  const falhaAtual = !!falha && (!emBatida || Date.parse(falha.ts) > Date.parse(emBatida));
  const parada = !emBatida || !(idade <= SEM_BATIDA_MS);
  if (!falhaAtual && !parada) return { nome, nivel: 'ok', detalhe: partes.join('; ') };
  const correcao = falhaAtual ? correcaoDaFalha(falha!.erro ?? '') : m.redeParadaCorrecao;
  return { nome, nivel: 'warn', detalhe: partes.join('; '), correcao };
}
