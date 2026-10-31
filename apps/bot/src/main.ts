import {createBot,DeliveryWorker} from './bot.js';
import {ConfigError,loadConfig} from './config.js';
import {loadDomain} from './facade.js';

try {
  const config=loadConfig();
  const {domain,close}=await loadDomain(config);
  const {bot,flows}=createBot(config.token,domain);
  await bot.api.setMyCommands([
    {command:'menu',description:'Главное меню'},{command:'history',description:'Сохранённые разборы'},
    {command:'account',description:'Почта и удаление данных'},{command:'cancel',description:'Отменить текущий шаг'},{command:'help',description:'Справка'}
  ]);
  const worker=new DeliveryWorker(bot.api,domain,flows,config.deliveryIntervalMs);
  worker.start();
  const stop=async()=>{await bot.stop();await worker.stop();await close();};
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().catch(()=>{process.exitCode=1;});});
  // Single long-polling process; a second poller with the same token gets 409 from Telegram.
  await bot.start({allowed_updates:['message','callback_query'],drop_pending_updates:false});
} catch(error) {
  console.error(error instanceof ConfigError?`Bot configuration error: ${error.message}`:'Bot startup failed; verify configuration, database migrations and domain facade');
  process.exitCode=1;
}
