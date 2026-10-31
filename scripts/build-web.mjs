// A release build must not inherit development/test NODE_ENV from dotenv or CI.
import {spawn} from 'node:child_process';
if(!process.env.npm_execpath){console.error('Run web release builds through root npm run build');process.exit(1);}
const child=spawn(process.execPath,[process.env.npm_execpath,'run','build','-w','@between/web'],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
child.on('error',()=>{console.error('Web build could not start');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
