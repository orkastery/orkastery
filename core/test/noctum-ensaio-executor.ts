/**
 * RM-058 (N3): o executor do ensaio, rodado como processo filho por `noctum-ensaio.test.ts`. Cada processo é uma máquina:
 * a raiz de estado de um clone do remoto de fixture. O despacho, as sessões e as contas são SIMULADOS.
 *
 * Uso: node noctum-ensaio-executor.js '<json>' com { modo, dir, maquina, arco, sinal?, ... }. Escreve um JSON na saída.
 */
import * as fs from 'node:fs';
import { exigirManifesto } from '../src/manifest';
import { assumirAutoridade, lerCoordenacao } from '../src/noctum-coordenacao';
import { RecusaDoArco } from '../src/noctum-envelope';
import { integrarComVez } from '../src/noctum-integracao';
import { passoDaMaquina } from '../src/noctum-maquinas';
import { lerThread, listarIds } from '../src/thread';
import { entregarThread, integradorPorAvanco, n2Simulada } from './noctum-maquinas-apoio';

interface Pedido {
  modo: 'assumir' | 'passos' | 'integrar' | 'despachar-e-cair' | 'integrar-e-cair';
  dir: string;
  maquina: string;
  arco: string;
  sinal?: string;
  /** No modo que cai: o arquivo onde o processo diz o que fez antes de cair. */
  marca?: string;
  passos?: number;
  integracao?: { ordem: string; destino: { repositorio: string; base: string }; candidato: { branch: string; fonte: string; base: string; provas: string } };
}

const pedido = JSON.parse(process.argv[2]) as Pedido;
const carregado = exigirManifesto(pedido.dir);
const op = { maquina: pedido.maquina };
const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const saida = (v: unknown) => { process.stdout.write(JSON.stringify(v)); };
const recusa = (e: unknown) => {
  if (e instanceof RecusaDoArco) return { recusa: e.motivo, detalhe: e.message };
  throw e;
};

// Os processos começam juntos: cada um espera o arquivo de sinal que o teste cria.
if (pedido.sinal) while (!fs.existsSync(pedido.sinal)) dormir(5);

if (pedido.modo === 'assumir') {
  try { saida({ geracao: assumirAutoridade(carregado, pedido.arco, op).geracao }); } catch (e) { saida(recusa(e)); }
} else if (pedido.modo === 'passos') {
  // Cada sessão despachada vive um passo e então entrega o bloco inteiro, como a sessão do bloco da N2 faria.
  const registro: string[] = [];
  const n2 = n2Simulada(registro);
  const resultados: string[] = [];
  let emCurso: Array<{ thread: string; sessao: string }> = [];
  for (let i = 0; i < (pedido.passos ?? 20); i++) {
    for (const s of emCurso) entregarThread(pedido.dir, s.thread, s.sessao);
    emCurso = [];
    const antes = registro.length;
    const r = passoDaMaquina(carregado, pedido.arco, { ...op, n2 });
    resultados.push(r.acao === 'passo' ? `${r.passo.acao}${r.passo.acao === 'despachou' ? `:${r.passo.trabalho}` : ''}` : `${r.acao}:${'motivo' in r ? r.motivo : ''}`);
    for (const linha of registro.slice(antes)) {
      const [thread, , , sessao] = linha.split(':');
      emCurso.push({ thread, sessao });
    }
    let estado;
    try { estado = lerCoordenacao(carregado, pedido.arco, op); } catch { dormir(50); continue; }
    if ([...estado.trabalhos.values()].every(t => t.estado === 'entregue') && !emCurso.length) break;
    dormir(20);
  }
  for (const s of emCurso) entregarThread(pedido.dir, s.thread, s.sessao);
  // Uma última reconciliação: as conclusões das entregas do último passo vão ao ramo.
  passoDaMaquina(carregado, pedido.arco, { ...op, n2 });
  const threads = listarIds(pedido.dir).map(id => lerThread(pedido.dir, id).roadmap ?? '');
  saida({ resultados, despachos: registro.length, threads });
} else if (pedido.modo === 'integrar') {
  try { saida({ feito: integrarComVez(carregado, pedido.arco, pedido.integracao!, integradorPorAvanco(pedido.dir), op) }); } catch (e) { saida(recusa(e)); }
} else if (pedido.modo === 'despachar-e-cair') {
  // Aceita, reserva, toma a vaga e despacha num passo; depois cai sem avisar ninguém, com a sessão de pé.
  const r = passoDaMaquina(carregado, pedido.arco, { ...op, n2: n2Simulada() });
  fs.writeFileSync(pedido.marca!, JSON.stringify(r.acao === 'passo' ? [r.passo.acao, r.passo.acao === 'despachou' ? r.passo.trabalho : null] : [r.acao, null]));
  process.kill(process.pid, 'SIGKILL');
} else if (pedido.modo === 'integrar-e-cair') {
  // O merge chega à base e o processo cai antes de registrar a entrega.
  try {
    integrarComVez(carregado, pedido.arco, pedido.integracao!, (c) => {
      const feito = integradorPorAvanco(pedido.dir)(c);
      process.kill(process.pid, 'SIGKILL');
      return feito;
    }, op);
  } catch (e) { saida(recusa(e)); }
}
