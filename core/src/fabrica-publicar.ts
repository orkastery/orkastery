/**
 * I-51 (RM-047): a publicacao do estado da fabrica em segundo plano.
 *
 * Modulo a parte, com o minimo de dependencias, porque quem chama (despacho de fase, entrega,
 * thread nova) nao pode esperar rede nem arrastar o retrato inteiro para dentro de si.
 *
 * RM-053 (D9): o mesmo evento tambem dispara o retrato desta maquina na rede da pessoa, pela
 * `rede-adesao` (tao leve quanto este modulo): so membro, no maximo uma vez a cada 14 minutos.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fabricaCompartilhada } from './maquina';
import { carregarManifesto, ManifestoCarregado } from './manifest';
import { publicarRedeEmSegundoPlano } from './rede-adesao';

/**
 * Publica sem segurar quem chamou (thread nova, despacho de fase, entrega). So com a fabrica
 * compartilhada nesta maquina (`ork fabrica entrar`) ou no projeto; `ORK_FABRICA_PUBLICAR=0`
 * desliga (testes e `ork eval`).
 */
export function publicarEmSegundoPlano(raiz: string): boolean {
  // A rede decide por si (adesao, teto e ambiente); o retorno continua sendo o da fabrica.
  publicarRedeEmSegundoPlano({ diretorio: raiz });
  if (process.env.ORK_FABRICA_PUBLICAR === '0') return false;
  let carregado: ManifestoCarregado | null;
  try { carregado = carregarManifesto(raiz); } catch { return false; }
  if (!carregado || carregado.erros.length > 0 || !fabricaCompartilhada(carregado.manifesto)) return false;
  const cli = path.join(__dirname, 'index.js');
  if (!fs.existsSync(cli)) return false;
  try {
    const filho = spawn(process.execPath, [cli, 'fabrica', 'publicar', '--silencioso'],
      { cwd: carregado.raiz, detached: true, stdio: 'ignore', env: process.env });
    filho.unref();
    return true;
  } catch { return false; }
}

