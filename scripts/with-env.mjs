// Node TLS configuration must be inherited before the application process starts.
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
try{if(existsSync('.env'))loadEnvFile('.env');}
catch{console.error('BLOCKED: unable to load root .env; values suppressed');process.exit(1);}
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'){console.error('BLOCKED: TLS verification must remain enabled');process.exit(1);}
if(process.env.NODE_EXTRA_CA_CERTS&&!existsSync(process.env.NODE_EXTRA_CA_CERTS)){console.error('BLOCKED: configured CA file is missing');process.exit(1);}
const [entry,...args]=process.argv.slice(2);
if(!entry||(entry==='--npm-run'&&!process.env.npm_execpath)){console.error('BLOCKED: missing application entrypoint');process.exit(1);}
const childArgs=entry==='--npm-run'?[process.env.npm_execpath,'run',...args]:[entry,...args];
const child=spawn(process.execPath,childArgs,{stdio:'inherit',env:process.env});
child.on('error',()=>{console.error('Application process could not start; details suppressed');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGINT'?130:1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);});
