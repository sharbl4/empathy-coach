// Run on the actual QQCloud Linux host (not inside a container), during live load.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {totalmem} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
const envFile=process.argv[2],count=Number(process.argv[3]??30);
if(process.platform!=='linux'||existsSync('/.dockerenv')||!envFile||!Number.isInteger(count)||count<2||count>300){console.error('BLOCKED: run on the actual Linux host: node scripts/measure-resources.mjs <private-compose-env-file> [samples2..300].');process.exit(1);}
function docker(args){const result=spawnSync('docker',args,{encoding:'utf8'});if(result.status!==0)throw new Error();return result.stdout.trim();}
function bytes(value){const match=/^([0-9.]+)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB)$/.exec(value.trim());if(!match)throw new Error();const scales={B:1,kB:1000,KB:1000,KiB:1024,MB:1e6,MiB:1048576,GB:1e9,GiB:1073741824};return Number(match[1])*scales[match[2]];}
try{
  const prefix=['compose','--env-file',envFile,'-f','compose.production.yaml'];
  const ids=['bot','db'].map(service=>docker([...prefix,'ps','--status','running','-q',service]));
  if(ids.some(id=>!id||id.includes('\n')))throw new Error();
  const samples=[];
  for(let index=0;index<count;index++){
    const rows=docker(['stats','--no-stream','--format','{{json .}}',...ids]).split('\n').map(line=>JSON.parse(line));
    if(rows.length!==2)throw new Error();
    const available=/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo','utf8'));
    if(!available)throw new Error();
    samples.push({containerBytes:rows.reduce((sum,row)=>sum+bytes(row.MemUsage.split('/')[0]),0),hostAvailableBytes:Number(available[1])*1024});
    if(index<count-1)await delay(1000);
  }
  const report={scope:'actual host/container memory samples; workload must be recorded separately',sampleCount:samples.length,hostBytes:totalmem(),peakBotDbBytes:Math.max(...samples.map(row=>row.containerBytes)),minimumHostAvailableBytes:Math.min(...samples.map(row=>row.hostAvailableBytes)),measurementProcessRss:process.memoryUsage().rss,workloadVerified:false};
  writeFileSync('resource-report.json',`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report));
}catch{console.error('BLOCKED host resource sampling; configuration/container output suppressed.');process.exitCode=1;}
