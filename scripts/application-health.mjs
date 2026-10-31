import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RuntimeHealth} from '@between/contracts/runtime';
try{
  const state=RuntimeHealth.parse(JSON.parse(readFileSync(process.argv[2]??join(tmpdir(),'between-application-health.json'),'utf8')));
  const age=Date.now()-Date.parse(state.heartbeatAt);
  if(age<0||age>120000||!state.database||!state.http||!state.polling||!state.workers||!state.scheduler)throw new Error();
  process.kill(state.pid,0);
}catch{console.error('APP_UNHEALTHY; no private data shown');process.exitCode=1;}
