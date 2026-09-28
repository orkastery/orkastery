/** Explicit lifecycle; installation never starts the worker. */
export async function brainWorker(sync:()=>unknown,signal:AbortSignal,intervalMs=5000):Promise<void>{
  if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>60000)throw Error('brain.worker.interval-invalid');
  while(!signal.aborted){
    sync();
    if(signal.aborted)break;
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,intervalMs);signal.addEventListener('abort',done,{once:true});
    });
  }
}
