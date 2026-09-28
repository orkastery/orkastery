#!/usr/bin/env node
// Foreground worker; service manager owns restart. No broad pulse reconciliation.
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--thread' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args[1])) {
  console.error('brain.worker.scope-required'); process.exit(2);
}
const cli = require('node:path').resolve(__dirname, '../core/dist/index.js');
let child, timer, stopped=false;
const stop=()=>{stopped=true;clearTimeout(timer);if(child)child.kill('SIGTERM');};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
function tick(){
  child=spawn(process.execPath,[cli,'brain','sync','--thread',args[1]],{stdio:'inherit',shell:false});
  child.once('error',()=>{console.error('brain.worker.unavailable');stop();process.exitCode=1;});
  child.once('exit',code=>{child=null;if(code){stop();process.exitCode=1;}else if(!stopped)timer=setTimeout(tick,5000);});
}
tick();
