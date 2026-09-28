import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {parse} from 'smol-toml';
import {spawnSync} from 'node:child_process';
import {instalarMcp,configuracaoServidorMcp,TOOLS_DONO_CODEX,ENV_VARS_CODEX_MCP} from '../src/mcp-install';
import {projetoTemporario} from './apoio';

for(const host of ['codex','claude-code'] as const) {
  test(`MCP install ${host}: dry-run sem escrita, preservacao e idempotencia`,()=>{
    const p=projetoTemporario('mcp-install');
    try {
      const opcoes={projeto:p.dir,host};
      const r=instalarMcp({...opcoes,dryRun:true});
      assert.equal(r.ativacao,'pendente-no-cliente');assert.equal(r.estado,'novo');
      assert.ok(!fs.existsSync(r.arquivo));
      if(host==='codex') assert.ok(!fs.existsSync(path.dirname(r.arquivo)));
      fs.mkdirSync(path.dirname(r.arquivo),{recursive:true});
      const original=host==='codex'?'# comentario preservado\nmodel = "fixture"\n[mcp_servers.outro]\ncommand = "outro"\n':JSON.stringify({outroCampo:true,mcpServers:{outro:{command:'outro',env:{TOKEN:'nao-exibir'}}}});
      fs.writeFileSync(r.arquivo,original,{mode:0o640});
      assert.equal(instalarMcp(opcoes).estado,'atualizado');
      const bytes=fs.readFileSync(r.arquivo),texto=bytes.toString();
      assert.equal(fs.statSync(r.arquivo).mode&0o777,0o640);
      if(host==='codex') {assert.ok(texto.startsWith(original));assert.ok(parse(texto).mcp_servers);}
      else {const data=JSON.parse(texto);assert.equal(data.outroCampo,true);assert.equal(data.mcpServers.outro.env.TOKEN,'nao-exibir');}
      assert.equal(instalarMcp(opcoes).estado,'igual');assert.deepEqual(fs.readFileSync(r.arquivo),bytes);
      assert.equal(instalarMcp({...opcoes,dryRun:true}).estado,'igual');
    } finally {p.limpar();}
  });
  test(`MCP install ${host}: conflito, invalidos e symlinks nao sobrescrevem`,()=>{
    const p=projetoTemporario('mcp-install-negative');
    try {
      const opcoes={projeto:p.dir,host},r=instalarMcp({...opcoes,dryRun:true});
      fs.mkdirSync(path.dirname(r.arquivo),{recursive:true});
      for(const original of [host==='codex'?'[mcp_servers.orkastery]\ncommand="diferente"':'{"mcpServers":{"orkastery":{"command":"diferente"}}}', '{ invalido', 'x'.repeat(262145)]) {
        fs.writeFileSync(r.arquivo,original);
        assert.throws(()=>instalarMcp(opcoes),/mcp.install./);assert.equal(fs.readFileSync(r.arquivo,'utf8'),original);
      }
      fs.rmSync(r.arquivo);
      const alvo=path.join(p.dir,'alvo');fs.writeFileSync(alvo,'sentinela');fs.symlinkSync(alvo,r.arquivo);
      assert.throws(()=>instalarMcp(opcoes),/unsafe/);assert.equal(fs.readFileSync(alvo,'utf8'),'sentinela');
      fs.rmSync(r.arquivo);
      fs.symlinkSync(path.join(p.dir,'nao-existe'),r.arquivo);
      assert.throws(()=>instalarMcp(opcoes),/unsafe/);
      if(host==='codex') {
        fs.rmSync(path.dirname(r.arquivo),{recursive:true});
        const outro=path.join(p.dir,'outro');fs.mkdirSync(outro);fs.symlinkSync(outro,path.dirname(r.arquivo));
        assert.throws(()=>instalarMcp(opcoes),/directory.unsafe/);assert.deepEqual(fs.readdirSync(outro),[]);
      }
    } finally {p.limpar();}
  });
}
test('MCP install recusa TOML inline fechado e projeto ancestral sem alterar bytes',()=>{
  const p=projetoTemporario('mcp-install-scope');
  try {
    const r=instalarMcp({projeto:p.dir,host:'codex',dryRun:true});
    fs.mkdirSync(path.dirname(r.arquivo));const original='mcp_servers = { outro = { command = "x" } }\n';
    fs.writeFileSync(r.arquivo,original);
    assert.throws(()=>instalarMcp({projeto:p.dir,host:'codex'}),/conflict/);
    assert.equal(fs.readFileSync(r.arquivo,'utf8'),original);
    const filho=path.join(p.dir,'filho');fs.mkdirSync(filho);
    assert.throws(()=>instalarMcp({projeto:filho,host:'codex'}),/project.invalid/);
    assert.throws(()=>instalarMcp({projeto:'.',host:'codex'}),/project.invalid/);
  } finally {p.limpar();}
});


for(const host of ['codex','claude-code'] as const) {
  test(`MCP install ${host}: transporte explícito persistido, default SSH e conflito preservado`,()=>{
    const p=projetoTemporario('mcp-install-transport');
    try {
      const padrao=configuracaoServidorMcp(p.dir,host);
      assert.deepEqual(padrao.args.slice(-2),['--ship-transport','github-ssh']);
      const r=instalarMcp({projeto:p.dir,host,transporteShip:'bare-local'}),bytes=fs.readFileSync(r.arquivo);
      const data=host==='codex'?parse(bytes.toString()):JSON.parse(bytes.toString());
      const entrada=(data as any)[host==='codex'?'mcp_servers':'mcpServers'].orkastery;
      assert.deepEqual(entrada,configuracaoServidorMcp(p.dir,host,undefined,'bare-local'));
      assert.equal(instalarMcp({projeto:p.dir,host,transporteShip:'bare-local'}).estado,'igual');
      assert.throws(()=>instalarMcp({projeto:p.dir,host,transporteShip:'github-ssh'}),/conflict/);
      assert.throws(()=>instalarMcp({projeto:p.dir,host,transporteShip:'https' as 'bare-local'}),/transport.invalid/);
      assert.deepEqual(fs.readFileSync(r.arquivo),bytes);
      assert.deepEqual(Object.keys(entrada).sort(),host==='codex'?['args','command','env_vars']:['args','command']);
      if(host==='codex')assert.deepEqual(entrada.env_vars,[...ENV_VARS_CODEX_MCP]);
    } finally {p.limpar();}
  });
}

test('MCP install legado sem opção permanece SSH, sem reescrever configuração',()=>{
  const p=projetoTemporario('mcp-install-legacy-transport');
  try {
    const atual=configuracaoServidorMcp(p.dir,'claude-code'),legacy={...atual,args:atual.args.slice(0,-2)};
    const file=path.join(p.dir,'.mcp.json'),bytes=JSON.stringify({mcpServers:{orkastery:legacy}});fs.writeFileSync(file,bytes);
    assert.equal(instalarMcp({projeto:p.dir,host:'claude-code'}).estado,'igual');assert.equal(fs.readFileSync(file,'utf8'),bytes);
    assert.throws(()=>instalarMcp({projeto:p.dir,host:'claude-code',transporteShip:'bare-local'}),/conflict/);
  } finally {p.limpar();}
});

test('MCP install Codex migra whitelist de CODEX_HOME sem persistir valor ou credencial',()=>{
  const p=projetoTemporario('mcp-codex-env');
  try {
    const def=configuracaoServidorMcp(p.dir,'codex'),file=path.join(p.dir,'.codex/config.toml');
    fs.mkdirSync(path.dirname(file));
    const antigo='[mcp_servers.orkastery] # tabela preservada\ncommand = '+JSON.stringify(def.command)+'\nargs = '+JSON.stringify(def.args)+'\n  env_vars  = ["SAFE_EXISTENTE"] # comentario preservado\n\n[mcp_servers.outro]\ncommand = "outro"\n';
    fs.writeFileSync(file,antigo,{mode:0o640});
    assert.equal(instalarMcp({projeto:p.dir,host:'codex'}).estado,'atualizado');
    const texto=fs.readFileSync(file,'utf8'),data=parse(texto) as any;
    assert.equal(fs.statSync(file).mode&0o777,0o640);
    assert.deepEqual(data.mcp_servers.orkastery.env_vars,['SAFE_EXISTENTE','CODEX_HOME']);
    assert.equal(data.mcp_servers.orkastery.CODEX_HOME,undefined);
    assert.equal(data.mcp_servers.outro.command,'outro');
    assert.match(texto,/  env_vars  = \["SAFE_EXISTENTE","CODEX_HOME"\] # comentario preservado/);
    assert.equal(/(?:API_KEY|TOKEN|AUTH)\s*=/.test(texto),false);
    const bytes=fs.readFileSync(file);assert.equal(instalarMcp({projeto:p.dir,host:'codex'}).estado,'igual');assert.deepEqual(fs.readFileSync(file),bytes);
  } finally {p.limpar();}
});

test('MCP install Codex acrescenta env_vars ausente antes de subtabela e mantém bytes na repetição',()=>{
  const p=projetoTemporario('mcp-codex-env-append');
  try {
    const def=configuracaoServidorMcp(p.dir,'codex'),file=path.join(p.dir,'.codex/config.toml');
    fs.mkdirSync(path.dirname(file));
    const argsLegados=def.args.slice(0,-2);
    const antigo='# escolhas do usuario\n[mcp_servers.orkastery]\ncommand = '+JSON.stringify(def.command)+'\nargs = '+JSON.stringify(argsLegados)+'\n\n[mcp_servers.orkastery.tools.custom]\napproval_mode = "prompt"\n\n[mcp_servers.outro]\ncommand = "outro"\n';
    fs.writeFileSync(file,antigo);
    assert.equal(instalarMcp({projeto:p.dir,host:'codex'}).estado,'atualizado');
    const bytes=fs.readFileSync(file),texto=bytes.toString(),data=parse(texto) as any;
    assert.deepEqual(data.mcp_servers.orkastery.env_vars,['CODEX_HOME']);
    assert.equal(data.mcp_servers.orkastery.tools.custom.approval_mode,'prompt');
    assert.equal(data.mcp_servers.outro.command,'outro');
    assert.ok(texto.indexOf('env_vars = ["CODEX_HOME"]')<texto.indexOf('[mcp_servers.orkastery.tools.custom]'));
    assert.equal(instalarMcp({projeto:p.dir,host:'codex'}).estado,'igual');
    assert.deepEqual(fs.readFileSync(file),bytes);
  } finally {p.limpar();}
});

test('MCP install Codex recusa env_vars inválido ou TOML fechado e preserva bytes',()=>{
  const p=projetoTemporario('mcp-codex-env-negative');
  try {
    const def=configuracaoServidorMcp(p.dir,'codex'),file=path.join(p.dir,'.codex/config.toml');fs.mkdirSync(path.dirname(file));
    for(const original of [
      '[mcp_servers.orkastery]\ncommand = '+JSON.stringify(def.command)+'\nargs = '+JSON.stringify(def.args)+'\nenv_vars = "CODEX_HOME"\n',
      'mcp_servers = { orkastery = { command = '+JSON.stringify(def.command)+', args = '+JSON.stringify(def.args)+' } }\n',
      "nota = '''\n[mcp_servers.orkastery]\nenv_vars = [\"SAFE\"]\n'''\n[mcp_servers.orkastery]\ncommand = "+JSON.stringify(def.command)+'\nargs = '+JSON.stringify(def.args)+'\n',
    ]) {
      fs.writeFileSync(file,original);assert.throws(()=>instalarMcp({projeto:p.dir,host:'codex'}),/mcp.install.conflict/);assert.equal(fs.readFileSync(file,'utf8'),original);
    }
  } finally {p.limpar();}
});

test('MCP CLI install aceita somente enum de transporte e serve recusa extras sem iniciar servidor',()=>{
  const p=projetoTemporario('mcp-cli-transport');
  try {
    const cli=path.resolve(__dirname,'../src/index.js'),base=['mcp','install','--project',p.dir,'--host','claude-code'];
    const r=spawnSync(process.execPath,[cli,...base,'--ship-transport','bare-local'],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const file=path.join(p.dir,'.mcp.json'),bytes=fs.readFileSync(file);
    assert.deepEqual(JSON.parse(bytes.toString()).mcpServers.orkastery.args.slice(-2),['--ship-transport','bare-local']);
    for(const extra of [['--ship-transport','https'],['--ship-transport'],['--ship-transport','bare-local','--ship-transport=github-ssh'],['--ship-transport','bare-local','--env','FREE=1']]) {
      const bad=spawnSync(process.execPath,[cli,'mcp','serve','--project',p.dir,'--host','claude-code',...extra],{encoding:'utf8',timeout:5000});
      assert.equal(bad.status,1);assert.match(bad.stderr,/uso: ork mcp/);
    }
    assert.deepEqual(fs.readFileSync(file),bytes);
  } finally {p.limpar();}
});


for(const host of ['codex','claude-code'] as const) {
  test(`MCP install C33 ${host}: worktree exige opt-in e não muda interactive existente`,()=>{
    const p=projetoTemporario('mcp-child-permissions');
    try {
      const def=configuracaoServidorMcp(p.dir,host);
      assert.equal(def.args.includes('--child-permissions'),false);
      assert.deepEqual(configuracaoServidorMcp(p.dir,host,undefined,'github-ssh','interactive'),def);
      const opt={projeto:p.dir,host,permissoesFilho:'worktree' as const};
      const dry=instalarMcp({...opt,dryRun:true});assert.equal(fs.existsSync(dry.arquivo),false);
      const r=instalarMcp(opt),bytes=fs.readFileSync(r.arquivo);
      const data=host==='codex'?parse(bytes.toString()):JSON.parse(bytes.toString());
      const entry=(data as any)[host==='codex'?'mcp_servers':'mcpServers'].orkastery;
      assert.deepEqual(entry,configuracaoServidorMcp(p.dir,host,undefined,'github-ssh','worktree'));
      assert.equal(instalarMcp(opt).estado,'igual');
      assert.throws(()=>instalarMcp({projeto:p.dir,host}),/conflict/);
      assert.throws(()=>instalarMcp({...opt,permissoesFilho:'auto' as 'worktree'}),/child-permissions.invalid/);
      assert.deepEqual(fs.readFileSync(r.arquivo),bytes);
    } finally {p.limpar();}
  });
}

test('MCP CLI C33: perfil de filho é enum fechado de startup, sem duplicatas/env livre',()=>{
  const p=projetoTemporario('mcp-cli-child-permissions');
  try {
    const cli=path.resolve(__dirname,'../src/index.js'),base=['--project',p.dir,'--host','claude-code'];
    const ok=spawnSync(process.execPath,[cli,'mcp','install',...base,'--child-permissions','worktree'],{encoding:'utf8'});
    assert.equal(ok.status,0,ok.stderr);
    const file=path.join(p.dir,'.mcp.json'),bytes=fs.readFileSync(file);
    assert.deepEqual(JSON.parse(bytes.toString()).mcpServers.orkastery.args.slice(-2),['--child-permissions','worktree']);
    for(const extra of [['--child-permissions','auto'],['--child-permissions'],['--child-permissions','interactive','--child-permissions=worktree'],['--child-permissions','worktree','--env','GRANT=1']]) {
      const bad=spawnSync(process.execPath,[cli,'mcp','serve',...base,...extra],{encoding:'utf8',timeout:5000});
      assert.equal(bad.status,1);assert.match(bad.stderr,/uso: ork mcp/);
    }
    assert.deepEqual(fs.readFileSync(file),bytes);
  } finally {p.limpar();}
});

test('C40 owner Codex opt-in instala tres consentimentos locais sem alterar argv e preserva reinstalacao',()=>{
  const p=projetoTemporario('mcp-owner-c40');
  try{
    const base={projeto:p.dir,host:'codex' as const},opt={...base,permissoesDono:'orchestrate' as const};
    const dry=instalarMcp({...opt,dryRun:true});assert.ok(!fs.existsSync(dry.arquivo));
    instalarMcp(base);const before=fs.readFileSync(dry.arquivo,'utf8');
    assert.equal(instalarMcp({...opt,dryRun:true}).estado,'atualizado');assert.equal(fs.readFileSync(dry.arquivo,'utf8'),before);
    assert.equal(instalarMcp(opt).estado,'atualizado');
    const bytes=fs.readFileSync(dry.arquivo),entry=(parse(bytes.toString()) as any).mcp_servers.orkastery;
    assert.ok(bytes.toString().startsWith(before));
    assert.deepEqual({command:entry.command,args:entry.args,env_vars:entry.env_vars},configuracaoServidorMcp(p.dir,'codex'));
    assert.deepEqual(Object.keys(entry.tools),[...TOOLS_DONO_CODEX]);
    for(const tool of Object.values(entry.tools))assert.deepEqual(tool,{approval_mode:'approve'});
    assert.equal(entry.default_tools_approval_mode,undefined);
    assert.equal(instalarMcp(opt).estado,'igual');assert.equal(instalarMcp(base).estado,'igual');
    assert.deepEqual(fs.readFileSync(dry.arquivo),bytes);
  }finally{p.limpar();}
});
for(const policy of ['prompt','writes','auto','disabled','deny-tool','allow-filter','server-default','tool-table']) {
  test(`C40 owner preserva politica conflitante ${policy}`,()=>{
    const p=projetoTemporario('mcp-owner-conflict');
    try{
      const opt={projeto:p.dir,host:'codex' as const};const r=instalarMcp(opt);
      const extra:Record<string,string>={prompt:'[mcp_servers.orkastery.tools.ork_thread_new]\napproval_mode="prompt"',writes:'[mcp_servers.orkastery.tools.ork_thread_new]\napproval_mode="writes"',auto:'[mcp_servers.orkastery.tools.ork_thread_new]\napproval_mode="auto"',disabled:'enabled=false','deny-tool':'disabled_tools=["ork_request_decision"]','allow-filter':'enabled_tools=["ork_thread_status"]','server-default':'default_tools_approval_mode="prompt"','tool-table':'[mcp_servers.orkastery.tools.ork_thread_new]\noutput_token_limit=12'};
      fs.appendFileSync(r.arquivo,extra[policy]+'\n');const bytes=fs.readFileSync(r.arquivo);
      assert.throws(()=>instalarMcp({...opt,permissoesDono:'orchestrate'}),/permissions.conflict/);
      assert.deepEqual(fs.readFileSync(r.arquivo),bytes);
    }finally{p.limpar();}
  });
}
test('C40 owner flag exclusivo install Codex, enum fechado e sem duplicatas',()=>{
  const p=projetoTemporario('mcp-owner-cli');
  try{
    assert.throws(()=>instalarMcp({projeto:p.dir,host:'claude-code',permissoesDono:'orchestrate'}),/owner-permissions.invalid/);
    assert.throws(()=>instalarMcp({projeto:p.dir,host:'codex',permissoesDono:'all' as 'orchestrate'}),/owner-permissions.invalid/);
    assert.ok(!fs.existsSync(path.join(p.dir,'.codex')));assert.ok(!fs.existsSync(path.join(p.dir,'.mcp.json')));
    const cli=path.resolve(__dirname,'../src/index.js');
    const ok=spawnSync(process.execPath,[cli,'mcp','install','--project',p.dir,'--host','codex','--owner-permissions','orchestrate'],{encoding:'utf8',timeout:5000});
    assert.equal(ok.status,0,ok.stderr);const file=path.join(p.dir,'.codex/config.toml'),bytes=fs.readFileSync(file);
    for(const [acao,host,extra] of [
      ['serve','codex',['--owner-permissions','orchestrate']],['install','claude-code',['--owner-permissions','orchestrate']],
      ['install','codex',['--owner-permissions']],['install','codex',['--owner-permissions','all']],
      ['install','codex',['--owner-permissions','interactive','--owner-permissions=orchestrate']],
    ] as const){
      const bad=spawnSync(process.execPath,[cli,'mcp',acao,'--project',p.dir,'--host',host,...extra],{encoding:'utf8',timeout:5000});
      assert.equal(bad.status,1);assert.match(bad.stderr,/uso: ork mcp/);
    }
    assert.deepEqual(fs.readFileSync(file),bytes);
  }finally{p.limpar();}
});
