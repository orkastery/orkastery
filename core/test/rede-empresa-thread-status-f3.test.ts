import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { main, respostaDoStatusDaThread } from '../src/index';
import { gravarAdesaoRedeEmpresa } from '../src/rede-empresa-config';
import { criarServidorMcp } from '../src/mcp-server';
import { dirDoCache } from '../src/rede';
import { resumoDaThread } from '../src/thread';
import { novaThread } from '../src/thread';
import type { Thread } from '../src/types';
import type { ResultadoPreflightEmpresa } from '../src/rede-empresa-preflight';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const thread: Thread = { id: 'ork-exemplo', slug: 'ork-exemplo-full', nome: 'exemplo', assunto: 'exemplo', modo: 'auto',
  fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GO', status: 'aberta', criadaEm: '2026-11-12T00:00:00.000Z',
  atualizadaEm: '2026-11-12T00:00:00.000Z', projeto: { name: 'projeto', abbrev: 'prj' },
  base: { branch: 'prj/ork-exemplo-full', commit: 'a'.repeat(40) }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [],
  baseline: null, variante: null, score: null };
const preflight: ResultadoPreflightEmpresa = { estado: 'inconclusivo', consultivo: true, conflitos: [], ordemSugerida: [],
  lacunas: ['historia.rasa'], performance: { estado: 'unavailable' }, cobertura: 'incompleta',
  fotografia: { ponta: 'c1', publicacoes: 1, trabalhos: 1, caminhos: 1, commitsLidos: 0, fonte: 'rede-coletiva' } };

test('thread status acrescenta o preflight no JSON e no texto antes do ork_ship', () => {
  const json = respostaDoStatusDaThread(thread, [], preflight) as { preflightEmpresa?: ResultadoPreflightEmpresa };
  assert.equal(json.preflightEmpresa, preflight);
  assert.match(resumoDaThread(thread, null, [], 'Preflight coletivo inconclusivo (historia.rasa).'), /Preflight coletivo inconclusivo/);
});

test('sem inscrição coletiva a saída anterior não ganha campo nem linha', () => {
  const json = respostaDoStatusDaThread(thread, [], null) as Record<string, unknown>;
  assert.equal('preflightEmpresa' in json, false);
  assert.doesNotMatch(resumoDaThread(thread, null, []), /Preflight coletivo/);
});

test('o comando CLI e a ferramenta MCP registrados expõem o preflight real', async () => {
  const p = projetoTemporario('rede-empresa-status-publico', true), home = dirTemporario('rede-empresa-status-home');
  const cwd = process.cwd(), usuario = process.env.ORK_USUARIO_DIR, log = console.log;
  const saida: string[] = [];
  let client: Client | null = null, server: ReturnType<typeof criarServidorMcp> | null = null;
  try {
    process.env.ORK_USUARIO_DIR = home;
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/time/projeto.git'], { cwd: p.dir });
    const ref = (caminho: string) => ({ forja: 'github' as const, host: 'github.com', caminho });
    gravarAdesaoRedeEmpresa({ inscricaoId: 'inscricao-a', empresa: ref('time/rede'), rede: ref('time/rede'),
      maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'builder', politicaVersao: 'v2',
      projetos: [ref('time/projeto')], estado: 'ativa', ultimaPublicacao: null, pendencia: null }, process.env);
    const origem = path.join(home, 'origem');
    execFileSync('git', ['init', '-q', '-b', 'main', origem]);
    execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: origem });
    execFileSync('git', ['config', 'user.email', 'teste@invalid'], { cwd: origem });
    commitar(origem, 'README.md', 'fixture', 'fixture');
    const cache = dirDoCache({ forja: 'github', host: 'github.com', dono: 'time', repositorio: 'rede' });
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    execFileSync('git', ['clone', '-q', '--no-checkout', origem, cache]);
    const criada = novaThread(p.carregado, { nome: 'status público', modo: 'auto' }).thread;

    process.chdir(p.dir); console.log = (valor: unknown) => { saida.push(String(valor)); };
    assert.equal(main(['thread', 'status', criada.id, '--json']), 0);
    const cli = JSON.parse(saida.join('\n')) as { preflightEmpresa?: ResultadoPreflightEmpresa };
    assert.equal(cli.preflightEmpresa?.consultivo, true);

    server = criarServidorMcp({ projeto: p.dir, host: 'codex', threadId: criada.id });
    client = new Client({ name: 'fixture-rede-empresa', version: '1' });
    const [cliente, servidor] = InMemoryTransport.createLinkedPair();
    await server.connect(servidor); await client.connect(cliente);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'ork_thread_status'));
    const resposta = await client.callTool({ name: 'ork_thread_status', arguments: { threadId: criada.id } });
    assert.notEqual(resposta.isError, true);
    const conteudo = resposta.content as Array<{ type: string; text?: string }>;
    const texto = conteudo.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('');
    const mcp = JSON.parse(texto) as { preflightEmpresa?: ResultadoPreflightEmpresa };
    assert.deepEqual(mcp.preflightEmpresa, cli.preflightEmpresa);
  } finally {
    console.log = log; process.chdir(cwd);
    if (client) await client.close(); if (server) await server.close();
    if (usuario === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = usuario;
    p.limpar(); fs.rmSync(home, { recursive: true, force: true });
  }
});
