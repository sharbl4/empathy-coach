// One process: real transport/domain/HTTP factories. Imports alone do not boot services.
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeFile,rename,unlink} from 'node:fs/promises';
import {RuntimeEnvironment,RuntimeHealth} from '@between/contracts/runtime';
import {TelegramUserId} from '@between/contracts/product';
const {setInterval,clearInterval,setTimeout,clearTimeout}=globalThis;
const isMain=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
export async function startApplication(environment=process.env,testFactories){
  if(testFactories&&(process.env.NODE_ENV!=='test'||environment.NODE_ENV!=='test'))throw new Error('Test adapters forbidden outside test');
  if(environment.NODE_ENV==='production'&&Object.entries(environment).some(([key,value])=>(/BYPASS|FIXTURE|TEST_ADAPTER|MOCK/.test(key)||key==='VITE_API_MODE')&&value&&!['0','false','http'].includes(value)))throw new Error('Production adapter flags forbidden');
  if(environment.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('TLS bypass forbidden');
  const config=RuntimeEnvironment.parse(environment);
  const factories=testFactories??{
    createDomain:(await import('@between/api')).createDomain,
    createHttpAdapter:(await import('@between/api/http')).createHttpAdapter,
    createTelegramTransport:(await import('@between/bot')).createTelegramTransport,
  };
  const healthFile=testFactories?.healthFile??join(tmpdir(),'between-application-health.json');
  let domain,http,telegram,lease,interval,closePromise,phase='construct',heartbeatPromise,closingDeadline;
  async function bounded(operation){
    let timer;
    try{await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shutdown deadline')),Math.max(1,closingDeadline-Date.now()));})]);}
    finally{clearTimeout(timer);}
  }
  async function close(){
    if(closePromise)return closePromise;
    closingDeadline=Date.now()+(testFactories?.closeTimeoutMs??110000);
    closePromise=(async()=>{
      clearInterval(interval);
      let failed=false;
      async function finish(action){try{await bounded(Promise.resolve().then(action));}catch{failed=true;}}
      await finish(()=>domain?.stopAccepting());
      await Promise.all([finish(()=>telegram?.stop()),finish(()=>http?.close())]);
      await finish(()=>heartbeatPromise);
      await finish(()=>domain?.close());
      await finish(()=>lease?.release());
      await unlink(healthFile).catch(()=>{});
      if(failed)throw new Error('Application close incomplete');
    })();
    return closePromise;
  }
  try{
    telegram=factories.createTelegramTransport({token:config.TELEGRAM_BOT_TOKEN});
    phase='identify';const identity=await telegram.identify();
    TelegramUserId.parse(identity.botId);
    if(!/^[A-Za-z0-9_]{5,32}$/.test(identity.username))throw new Error();
    phase='domain';domain=await factories.createDomain({databaseUrl:config.DATABASE_URL,ai:{provider:'local',baseUrl:config.LOCAL_LLM_BASE_URL,model:config.LOCAL_LLM_MODEL,apiKey:config.LOCAL_LLM_API_KEY,timeoutMs:config.AI_TIMEOUT_MS,maxConcurrency:1,maxQueueLength:config.AI_MAX_QUEUE_LENGTH},smtp:{host:config.SMTP_HOST,port:config.SMTP_PORT,user:config.SMTP_USER,password:config.SMTP_PASSWORD,from:config.SMTP_FROM},emailCodeSecret:config.EMAIL_CODE_SECRET,web:{origin:config.WEB_ORIGIN,sessionSecret:config.WEB_SESSION_SECRET,linkSecret:config.WEB_LINK_SECRET,telegramBotUsername:identity.username}});
    phase='lease';lease=await domain.acquirePollerLease(identity.botId);
    phase='workers';await domain.start();
    phase='http';http=await factories.createHttpAdapter({domain,origin:config.WEB_ORIGIN,port:config.PORT,host:config.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1',webRoot:resolve('apps/web/dist'),trustedProxyIPs:config.TRUSTED_PROXY_IPS.split(',').map(ip=>ip.trim()).filter(Boolean),environment:config.NODE_ENV});
    await http.listen();phase='polling';await telegram.start(domain,lease);
    if(lease.signal.aborted||domain.shutdownSignal.aborted)throw new Error('Startup lease ended');
    async function heartbeat(){
      const status=await domain.health();
      const data=RuntimeHealth.parse({pid:process.pid,heartbeatAt:new Date().toISOString(),database:status.database,http:http.health().listening,polling:status.pollerLease&&telegram.health().polling&&!lease.signal.aborted,workers:status.workers,scheduler:status.scheduler});
      await writeFile(`${healthFile}.tmp`,JSON.stringify(data),{mode:0o600});await rename(`${healthFile}.tmp`,healthFile);
    }
    await heartbeat();phase='running';
    interval=setInterval(()=>{if(heartbeatPromise||closePromise)return;heartbeatPromise=heartbeat().catch(()=>{}).finally(()=>{heartbeatPromise=undefined;});},15000);interval.unref();
    const fatal=()=>{if(!closePromise){console.error('APP_STOPPED: transport or domain lease ended; private errors suppressed');void close().catch(()=>{}).finally(()=>{if(isMain)process.exit(1);else process.exitCode=1;});}};
    lease.signal.addEventListener('abort',fatal,{once:true});domain.shutdownSignal.addEventListener('abort',fatal,{once:true});
    if(lease.signal.aborted||domain.shutdownSignal.aborted)fatal();
    void telegram.finished.then(fatal,fatal);
    return {close,healthFile};
  }catch{
    await close().catch(()=>{});
    throw new Error(`APP_START_FAILED:${phase}`);
  }
}
if(isMain){
  try{
    const application=await startApplication();
    const stop=()=>{void application.close().then(()=>process.exit(0),()=>{console.error('APP_SHUTDOWN_FAILED');process.exit(1);});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch{console.error('APP_START_FAILED: verify current config and B1/B2/C1 modules; no legacy Auth/model fallback');process.exit(1);}
}
