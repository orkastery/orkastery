/**
 * Testes da extensao do B5: a varredura DETERMINISTICA da superficie de ataque de rede
 * (pack `security-privacy`, regras SP8..SP12).
 *
 * O que estes testes protegem, em ordem de importancia:
 *
 *   1. que a varredura ACHA a superficie exposta nos frameworks que ela promete ler;
 *   2. que ela NAO acha onde a guarda existe (falso positivo e o defeito mais caro aqui,
 *      porque ele treina o time a ignorar o auditor);
 *   3. que o achado incerto sai como incerto (confianca baixa, severidade menor, titulo
 *      dizendo que requer confirmacao humana), e nunca como certeza;
 *   4. que TODO comando de reexecucao de TODO achado sai 0 num repositorio de verdade: o
 *      auditor de superficie tambem nao tem direito a self-report.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACKS } from '../src/auditoria';
import { entradaDoBruto, lerRodada, rodarAuditoria, varrerSuperficieDaRodada } from '../src/auditrun';
import { faltasDaProposta, lerBoard } from '../src/divida';
import {
  achadosDaRota,
  achadosDeCors,
  contextoDoArquivo,
  caminhoDoNext,
  ehLinhaDeDados,
  entradaBrutaDaSuperficie,
  REGRAS_DE_SUPERFICIE,
  rotasDoArquivo,
  semComentarios,
  semOCaminho,
  varrerSuperficie,
} from '../src/superficie';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

/** Grava um arquivo no projeto de teste e devolve o caminho relativo. */
function arquivo(p: ProjetoDeTeste, relativo: string, conteudo: string): string {
  const destino = path.join(p.dir, relativo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, 'utf8');
  return relativo;
}

/** Os achados de um arquivo isolado, sem passar pelo disco do projeto. */
function achadosDe(nome: string, conteudo: string) {
  const ctx = contextoDoArquivo(nome, conteudo);
  const rotas = rotasDoArquivo(nome, conteudo);
  return [
    ...rotas.flatMap((r) => achadosDaRota(r, ctx, conteudo)),
    ...achadosDeCors(nome, conteudo, ctx, rotas),
  ];
}

const EXPRESS_EXPOSTO = `const express = require('express');
const app = express();

app.get('/relatorios/:id', (req, res) => res.json(carregar(req.params.id)));

app.listen(3000);
`;

const EXPRESS_PROTEGIDO = `const express = require('express');
const app = express();

app.get('/relatorios/:id', requireAuth, (req, res) => res.json(carregar(req.params.id)));

app.listen(3000);
`;

test('as regras SP8..SP12 entram no catalogo do pack security-privacy', () => {
  const ids = PACKS['security-privacy'].regras.map((r) => r.id);
  for (const nova of REGRAS_DE_SUPERFICIE) {
    assert.ok(ids.includes(nova), `o pack nao declara a regra ${nova}`);
  }
  // As sete originais continuam la: a extensao AMPLIA o pack, nao o substitui.
  for (const antiga of ['SP1', 'SP2', 'SP3', 'SP4', 'SP5', 'SP6', 'SP7']) {
    assert.ok(ids.includes(antiga), `a extensao derrubou a regra ${antiga}`);
  }
  for (const r of PACKS['security-privacy'].regras) {
    assert.notEqual(r.regra.trim(), '');
    assert.notEqual(r.evidencia.trim(), '', `${r.id} precisa declarar a evidencia que o comprova`);
  }
});

test('a extracao de rota conhece os frameworks que promete, e nao inventa rota onde nao ha', () => {
  const express = rotasDoArquivo('api.js', EXPRESS_EXPOSTO);
  assert.equal(express.length, 1);
  assert.equal(express[0].metodo, 'GET');
  assert.equal(express[0].caminho, '/relatorios/:id');
  assert.equal(express[0].framework, 'express');

  const fastify = rotasDoArquivo(
    'srv.ts',
    `import fastify from 'fastify';\nconst app = fastify();\napp.post('/pedidos', { schema: corpoDoPedido }, criar);\n`
  );
  assert.equal(fastify.length, 1);
  assert.equal(fastify[0].framework, 'fastify');

  const nest = rotasDoArquivo(
    'gato.controller.ts',
    `import { Controller, Get } from '@nestjs/common';\n@Controller('gatos')\nexport class GatoController {\n  @Get('lista')\n  lista() {}\n}\n`
  );
  assert.equal(nest.length, 1);
  assert.equal(nest[0].caminho, '/gatos/lista');

  const py = rotasDoArquivo(
    'api.py',
    `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/clientes")\nasync def listar():\n    return []\n`
  );
  assert.equal(py.length, 1);
  assert.equal(py[0].metodo, 'GET');

  const flask = rotasDoArquivo(
    'web.py',
    `from flask import Flask\napp = Flask(__name__)\n\n@app.route("/cupom", methods=["POST", "DELETE"])\ndef cupom():\n    return ""\n`
  );
  assert.deepEqual(flask.map((r) => r.metodo).sort(), ['DELETE', 'POST']);

  const django = rotasDoArquivo(
    'urls.py',
    `from django.urls import path\nurlpatterns = [\n    path('admin/', admin.site.urls),\n]\n`
  );
  assert.equal(django.length, 1);
  assert.equal(django[0].caminho, '/admin/');

  const go = rotasDoArquivo(
    'rotas.go',
    `package api\n\nimport "github.com/gin-gonic/gin"\n\nfunc R(r *gin.Engine) {\n\tr.GET("/saldo", handler)\n}\n`
  );
  assert.equal(go.length, 1);
  assert.equal(go[0].framework, 'gin');

  // Cliente HTTP nao e servidor: `axios.get(url)` nunca vira rota.
  assert.deepEqual(
    rotasDoArquivo('cliente.ts', `import axios from 'axios';\naxios.get('https://api.exemplo/v1/x');\n`),
    []
  );
  // Sem framework declarado e com receptor que nao e roteador, a chamada nao passa.
  assert.deepEqual(rotasDoArquivo('outro.ts', `cache.get('/chave/x', valor);\n`), []);

  assert.equal(caminhoDoNext('app/api/pedidos/[id]/route.ts'), '/api/pedidos/:id');
  assert.equal(caminhoDoNext('src/pages/api/health.ts'), '/api/health');
  assert.equal(caminhoDoNext('src/componentes/lista.tsx'), null);
});

test('SP8 acusa rota sem guarda e se cala quando a guarda existe', () => {
  const expostos = achadosDe('api.js', EXPRESS_EXPOSTO);
  const sp8 = expostos.filter((a) => a.regra === 'SP8');
  assert.equal(sp8.length, 1);
  assert.equal(sp8[0].linha, 4);
  assert.equal(sp8[0].confianca, 'alta');
  assert.equal(sp8[0].severidade, 'maior');
  assert.ok(sp8[0].titulo.includes('/relatorios/:id'));

  assert.deepEqual(
    achadosDe('api.js', EXPRESS_PROTEGIDO).filter((a) => a.regra === 'SP8'),
    [],
    'rota com requireAuth na definicao nao vira achado'
  );

  // Guarda global no roteador tambem protege as rotas do arquivo.
  const global = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.use(verificarSessao);\napp.get('/relatorios', (req, res) => res.json([]));\n`
  );
  assert.deepEqual(global.filter((a) => a.regra === 'SP8'), []);

  // Rota publica por natureza nao e acusada de nao exigir login.
  const login = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.post('/login', (req, res) => res.json(entrar(req.body)));\n`
  );
  assert.deepEqual(login.filter((a) => a.regra === 'SP8'), []);
  assert.equal(login.filter((a) => a.regra === 'SP10').length, 1, 'mas ela precisa de limite de taxa');
});

test('SP9 acusa endpoint de administracao e de saude detalhada, e nao duplica em SP8', () => {
  const admin = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/admin/filas', (req, res) => res.json(filas()));\n`
  );
  const sp9 = admin.filter((a) => a.regra === 'SP9');
  assert.equal(sp9.length, 1);
  assert.equal(sp9[0].severidade, 'critico');
  assert.deepEqual(admin.filter((a) => a.regra === 'SP8'), [], 'a mesma linha nao sai como SP8 e SP9');

  const restrito = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/admin/filas', ipAllowlist, (req, res) => res.json(filas()));\n`
  );
  assert.deepEqual(restrito.filter((a) => a.regra === 'SP9'), [], 'restricao de rede tambem protege');

  const saude = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/health', (req, res) => res.json({ version: v, hostname: h, database: db }));\n`
  );
  assert.equal(saude.filter((a) => a.regra === 'SP9').length, 1, 'health detalhado vaza metadado de infra');

  const saudeSimples = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/health', (req, res) => res.send('ok'));\n`
  );
  assert.deepEqual(saudeSimples.filter((a) => a.regra === 'SP9'), [], 'health simples nao e achado');
});

test('SP10 acusa caminho de forca bruta sem limite, e aceita o limitador declarado', () => {
  const semLimite = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.post('/senha/reset', (req, res) => res.json(resetar(req.body)));\n`
  );
  const sp10 = semLimite.filter((a) => a.regra === 'SP10');
  assert.equal(sp10.length, 1);
  assert.equal(sp10[0].severidade, 'maior');

  const comLimite = achadosDe(
    'api.js',
    `const express = require('express');\nconst rateLimit = require('express-rate-limit');\nconst app = express();\napp.post('/senha/reset', rateLimit({ max: 5 }), (req, res) => res.json(resetar(req.body)));\n`
  );
  assert.deepEqual(comLimite.filter((a) => a.regra === 'SP10'), []);

  const leitura = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/produtos', autenticar, (req, res) => res.json(listar()));\n`
  );
  assert.deepEqual(
    leitura.filter((a) => a.regra === 'SP10'),
    [],
    'leitura autenticada fora dos caminhos de forca bruta nao vira ruido'
  );
});

test('SP11 so acusa CORS global quando ha credencial ou dado sensivel, e ignora tabela de constantes', () => {
  const comCredencial = achadosDe(
    'api.js',
    `const express = require('express');\nconst cors = require('cors');\nconst app = express();\napp.use(cors({ origin: '*', credentials: true }));\napp.get('/usuarios', autenticar, (req, res) => res.json([]));\n`
  );
  const sp11 = comCredencial.filter((a) => a.regra === 'SP11');
  assert.equal(sp11.length, 1);
  assert.equal(sp11[0].severidade, 'critico');

  const publico = achadosDe(
    'api.js',
    `const express = require('express');\nconst cors = require('cors');\nconst app = express();\napp.use(cors({ origin: '*' }));\napp.get('/precos', (req, res) => res.json([]));\n`
  );
  assert.deepEqual(publico.filter((a) => a.regra === 'SP11'), [], 'origem aberta sem credencial nem dado sensivel passa');

  const py = achadosDe(
    'main.py',
    `from fastapi import FastAPI\napp = FastAPI()\napp.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)\n\n@app.get("/conta")\nasync def conta():\n    return {}\n`
  );
  assert.equal(py.filter((a) => a.regra === 'SP11').length, 1, 'o CORS do FastAPI tambem e lido');

  assert.equal(ehLinhaDeDados("  'access-control-allow-origin',"), true);
  assert.equal(ehLinhaDeDados("app.use(cors({ origin: '*' }));"), false);
});

test('SP12 acusa borda sem esquema e aceita o esquema declarado', () => {
  const semEsquema = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.put('/perfil', autenticar, (req, res) => salvar(req.body));\n`
  );
  assert.equal(semEsquema.filter((a) => a.regra === 'SP12').length, 1);

  const comEsquema = achadosDe(
    'api.ts',
    `import fastify from 'fastify';\nconst app = fastify();\napp.put('/perfil', { schema: perfilSchema, preHandler: [autenticar] }, salvar);\n`
  );
  assert.deepEqual(comEsquema.filter((a) => a.regra === 'SP12'), []);

  const pydantic = achadosDe(
    'api.py',
    `from fastapi import FastAPI, Depends\napp = FastAPI()\n\n@app.post("/pedidos")\nasync def criar(pedido: PedidoIn, usuario = Depends(sessao_atual)):\n    return salvar(pedido)\n`
  );
  assert.deepEqual(
    pydantic.filter((a) => a.regra === 'SP12' || a.regra === 'SP8'),
    [],
    'modelo do pydantic e Depends de sessao cobrem SP12 e SP8'
  );
});

test('o que a leitura nao sustenta sai como incerteza, nunca como certeza', () => {
  const comDesconhecido = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.get('/faturas/:id', tracarPedido, (req, res) => res.json(fatura(req.params.id)));\n`
  );
  const sp8 = comDesconhecido.filter((a) => a.regra === 'SP8');
  assert.equal(sp8.length, 1);
  assert.equal(sp8[0].confianca, 'baixa', 'middleware desconhecido pode ser a guarda que o ork nao conhece');
  assert.equal(sp8[0].severidade, 'menor', 'achado incerto nao carrega severidade alta');
  assert.ok(sp8[0].titulo.includes('requer confirmacao humana'));
  assert.ok(sp8[0].descricao.includes('Confianca baixa'));

  // Middleware conhecido e que NAO e guarda (cors, helmet, logger) nao derruba a confianca.
  const neutro = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\napp.use(helmet());\napp.get('/faturas/:id', (req, res) => res.json(fatura(req.params.id)));\n`
  );
  assert.equal(neutro.filter((a) => a.regra === 'SP8')[0].confianca, 'alta');

  // Framework nao reconhecido: a leitura vale, mas nao vale como certeza.
  const semFramework = achadosDe(
    'api.js',
    `const app = criarApp();\napp.get('/faturas/:id', (req, res) => res.json(fatura(req.params.id)));\n`
  );
  assert.equal(semFramework.filter((a) => a.regra === 'SP8')[0].confianca, 'media');
});

test('comentario nao protege rota nenhuma, e o caminho da rota nao protege a si mesmo', () => {
  // "guarda" casa com o marcador `guard` e "oAuth" casa com `auth`: um TODO nao pode
  // apagar o achado que ele proprio denuncia.
  const comComentario = achadosDe(
    'api.js',
    `const express = require('express');\nconst app = express();\n// TODO: falta a guarda de oAuth nesta rota\napp.get('/faturas/:id', (req, res) => res.json(fatura(req.params.id)));\n`
  );
  assert.equal(comComentario.filter((a) => a.regra === 'SP8').length, 1);
  assert.equal(semComentarios('codigo(); // com auth'), 'codigo(); ');

  // O nome do endpoint nao pode servir de guarda: /internal/metrics casaria sozinho com
  // os marcadores de restricao de rede e de sessao.
  const py = achadosDe(
    'api.py',
    `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/internal/metrics")\nasync def metricas():\n    return coletar()\n`
  );
  assert.equal(py.filter((a) => a.regra === 'SP9').length, 1);
  assert.equal(semOCaminho('rota /auth/token aqui', '/auth/token'), 'rota   aqui');
});

test('o teto por regra corta o excesso e diz em voz alta quanto ficou de fora', (t) => {
  const p = projetoTemporario('b5-superficie-teto');
  t.after(p.limpar);
  const rotas = Array.from({ length: 6 }, (_, i) => `app.get('/faturas/${i}', (req, res) => res.json(f(${i})));`);
  arquivo(p, 'api.js', `const express = require('express');\nconst app = express();\n${rotas.join('\n')}\n`);

  const cheio = varrerSuperficie(p.dir);
  assert.equal(cheio.achados.filter((a) => a.regra === 'SP8').length, 6);
  assert.deepEqual(cheio.truncados, []);

  const cortado = varrerSuperficie(p.dir, { limitePorRegra: 2 });
  assert.equal(cortado.achados.filter((a) => a.regra === 'SP8').length, 2);
  assert.deepEqual(cortado.truncados, [{ regra: 'SP8', ocultos: 4 }]);
  assert.ok(cortado.detalhe.includes('teto de 2 por regra'));

  const so = varrerSuperficie(p.dir, { regra: 'SP10' });
  assert.deepEqual(so.achados, [], 'o filtro por regra nao vaza achado de outra regra');
});

test('escopo vazio e declarado como escopo vazio, e nao como superficie limpa', (t) => {
  const p = projetoTemporario('b5-superficie-vazia');
  t.after(p.limpar);
  const r = varrerSuperficie(p.dir, { dir: 'nao-existe' });
  assert.deepEqual(r.achados, []);
  assert.ok(r.detalhe.includes('NAO e o mesmo que superficie limpa'));
});

test('todo comando de reexecucao de todo achado sai 0 no repositorio real', (t) => {
  const p = projetoTemporario('b5-superficie-claims');
  t.after(p.limpar);
  arquivo(
    p,
    'servidor/api.js',
    `const express = require('express');\nconst cors = require('cors');\nconst app = express();\n\napp.use(cors({ origin: '*', credentials: true }));\n\napp.get('/admin/usuarios', (req, res) => res.json(listar()));\n\napp.post('/usuarios/:id/senha', (req, res) => trocar(req.params.id, req.body));\n\napp.listen(3000);\n`
  );
  arquivo(
    p,
    'servidor/api.py',
    `from fastapi import FastAPI, Request\napp = FastAPI()\n\n@app.get("/internal/metrics")\nasync def metricas():\n    return coletar()\n\n@app.post("/pedidos")\nasync def criar(request: Request):\n    return salvar(await request.json())\n`
  );

  const r = varrerSuperficie(p.dir);
  assert.ok(r.achados.length >= 6, `a varredura precisa achar a superficie plantada (achou ${r.achados.length})`);
  assert.deepEqual(
    [...new Set(r.achados.map((a) => a.regra))].sort(),
    ['SP10', 'SP11', 'SP12', 'SP8', 'SP9'],
    'as cinco regras novas aparecem no alvo plantado'
  );

  for (const a of r.achados) {
    assert.ok(a.verificar.length >= 2, `${a.regra} precisa declarar como se reexecuta`);
    for (const comando of a.verificar) {
      const codigo = (() => {
        try {
          execFileSync('bash', ['-c', comando], { cwd: p.dir, stdio: 'pipe' });
          return 0;
        } catch (e) {
          return (e as { status?: number }).status ?? -1;
        }
      })();
      assert.equal(codigo, 0, `o comando do achado ${a.regra} ${a.arquivo}:${a.linha} nao sustenta a alegacao:\n${comando}`);
    }
  }

  // A guarda entra no codigo: a claim do achado passa a REPROVAR, que e o resultado certo
  // quando a divida e paga.
  const antes = r.achados.find((a) => a.regra === 'SP8');
  assert.ok(antes);
  const caminho = path.join(p.dir, antes.arquivo);
  fs.writeFileSync(
    caminho,
    fs.readFileSync(caminho, 'utf8').replace("app.post('/usuarios/:id/senha', (req", "app.post('/usuarios/:id/senha', requireAuth, (req"),
    'utf8'
  );
  let aindaVale = true;
  try {
    execFileSync('bash', ['-c', antes.verificar[1]], { cwd: p.dir, stdio: 'pipe' });
  } catch {
    aindaVale = false;
  }
  assert.equal(aindaVale, false, 'com a guarda no lugar, a alegacao do auditor deixa de se sustentar');
});

test('o achado da varredura entra no board pelo contrato do B5, sem campo faltando', (t) => {
  const p = projetoTemporario('b5-superficie-contrato');
  t.after(p.limpar);
  arquivo(
    p,
    'api.js',
    `const express = require('express');\nconst app = express();\napp.post('/clientes', (req, res) => salvar(req.body));\n`
  );
  // `--tudo` de proposito: com o escopo incremental padrao (`since_padrao: 7d`) a rodada
  // le so o que o git log devolve, e o arquivo recem-escrito nem esta commitado ainda.
  const rodada = rodarAuditoria(p.carregado, 'security-privacy', {
    dryRun: true,
    agora: 'teste',
    forcar: true,
    tudo: true,
  });
  assert.equal(rodada.status, 'ensaio');
  assert.ok(rodada.superficie, 'a rodada de security-privacy carrega o resumo da varredura');
  assert.ok(rodada.superficie.encontrados > 0);
  assert.equal(rodada.superficie.registrados, 0, 'o ensaio nao grava achado no board');
  assert.equal(lerBoard(p.dir).length, 0);

  const varredura = varrerSuperficie(p.dir);
  for (const a of varredura.achados) {
    const entrada = entradaDoBruto(rodada, entradaBrutaDaSuperficie(a));
    assert.deepEqual(
      faltasDaProposta(entrada),
      [],
      `o achado ${a.regra} chega ao board sem proposta completa`
    );
  }

  // O FORMATO.md que a rodada deixa avisa o auditor com LLM do que ja foi varrido.
  const formato = fs.readFileSync(
    path.join(p.dir, '.orkastery', 'audits', rodada.id, 'FORMATO.md'),
    'utf8'
  );
  assert.ok(formato.includes('Superficie de ataque de rede (SP8..SP12)'));
  assert.ok(formato.includes('NAO repita os achados acima'));
  assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'audits', rodada.id, 'superficie.json')));

  // O registro no board acontece quando pedido, e e idempotente.
  const primeira = varrerSuperficieDaRodada(p.carregado, rodada.id, { registrar: true });
  assert.ok(primeira.registrados.length > 0);
  assert.equal(primeira.recusados.length, 0);
  const segunda = varrerSuperficieDaRodada(p.carregado, rodada.id, { registrar: true });
  assert.deepEqual(segunda.registrados, [], 'a segunda varredura nao duplica achado na mesma rodada');
  assert.equal(segunda.duplicados.length, primeira.registrados.length);
  assert.equal(lerBoard(p.dir).length, primeira.registrados.length);
  assert.equal(lerRodada(p.dir, rodada.id).superficie?.registrados, 0, 'a segunda passada nao inventa registro novo');

  const noBoard = lerBoard(p.dir);
  assert.ok(noBoard.every((a) => a.pack === 'security-privacy'));
  assert.ok(noBoard.every((a) => a.claim.verificar.length >= 2));
  assert.ok(noBoard.every((a) => a.proposta.impacto !== '' && a.proposta.fix !== ''));
});
