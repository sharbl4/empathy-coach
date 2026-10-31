import {createDomain} from '@between/api';
import {BOT_HEALTH_FILE,RuntimeEnvironment,type DomainFacade} from '@between/contracts/domain';
import {Flows} from './flows.js';
import {DeliveryWorker,Heartbeat,Poller,logError} from './runtime.js';
import {TelegramApi} from './telegram.js';

const parsed=RuntimeEnvironment.safeParse(process.env);
if(!parsed.success){
  // Field names only; values (tokens, URLs, secrets) are never printed.
  console.error(`Bot configuration error: ${[...new Set(parsed.error.issues.map(issue=>issue.path.join('.')))].join(', ')}`);
  process.exit(1);
}
const env=parsed.data;
const stop=new AbortController();
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>stop.abort());

const tg=new TelegramApi(env.TELEGRAM_BOT_TOKEN);
let domain:DomainFacade|undefined,worker:DeliveryWorker|undefined,heartbeat:Heartbeat|undefined;
try{
  const me=await tg.getMe();
  domain=await createDomain({
    databaseUrl:env.DATABASE_URL,botId:String(me.id),emailCodeSecret:env.EMAIL_CODE_SECRET,
    ai:{provider:'local',baseUrl:env.LOCAL_LLM_BASE_URL,model:env.LOCAL_LLM_MODEL,timeoutMs:env.AI_TIMEOUT_MS,maxConcurrency:env.AI_MAX_CONCURRENCY,...(env.LOCAL_LLM_API_KEY?{apiKey:env.LOCAL_LLM_API_KEY}:{})},
    smtp:{host:env.SMTP_HOST,port:env.SMTP_PORT,from:env.SMTP_FROM,...(env.SMTP_USER?{user:env.SMTP_USER}:{}),...(env.SMTP_PASSWORD?{password:env.SMTP_PASSWORD}:{})}
  });
  // Poller lease must be held before the first getUpdates; a second process with the same bot stops here.
  if(!(await domain.health()).pollerLease)throw new Error('Poller lease not held');
  const flows=new Flows(domain),poller=new Poller(tg,domain,flows);
  await tg.setMyCommands([
    {command:'menu',description:'Главное меню'},{command:'history',description:'Сохранённые разборы'},
    {command:'account',description:'Почта, согласие и удаление данных'},{command:'cancel',description:'Отменить текущий шаг'},{command:'help',description:'Справка'}
  ]).catch(error=>logError('commands',error));
  worker=new DeliveryWorker(tg,domain,flows);heartbeat=new Heartbeat(BOT_HEALTH_FILE,domain,poller);
  worker.start();heartbeat.start();
  await poller.run(AbortSignal.any([stop.signal,domain.shutdownSignal]));
}catch(error){
  logError('startup',error);
  process.exitCode=1;
}finally{
  // Close everything that was opened, including after a partial startup.
  heartbeat?.stop();
  await worker?.stop().catch(error=>logError('shutdown-delivery',error));
  await domain?.close().catch(error=>logError('shutdown-domain',error));
}
