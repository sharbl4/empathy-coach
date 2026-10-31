import {readFileSync} from 'node:fs';
import {BotHealth,BOT_HEALTH_FILE} from '@between/contracts/domain';
try{
  const file=process.argv[2]??BOT_HEALTH_FILE;
  const health=BotHealth.parse(JSON.parse(readFileSync(file,'utf8')));
  const age=Date.now()-Date.parse(health.heartbeatAt);
  if(age<0||age>120000||!health.database||!health.pollerLease||!health.polling)throw new Error();
  process.kill(health.pid,0);
}catch{console.error('Bot unhealthy; private state suppressed');process.exitCode=1;}
