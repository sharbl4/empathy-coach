import {existsSync} from 'node:fs';
let safeDatabase=false;
try{
  const test=new URL(process.env.TEST_DATABASE_URL),runtime=new URL(process.env.DATABASE_URL);
  const host=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'loopback':url.hostname;
  const target=url=>host(url)+':'+(url.port||5432)+decodeURIComponent(url.pathname);
  safeDatabase=['postgres:','postgresql:'].includes(test.protocol)&&decodeURIComponent(test.pathname).includes('test')&&target(test)!==target(runtime);
}catch{/* No raw URL or parse error is shown. */}
if(process.env.NODE_ENV!=='test'||!safeDatabase){console.error('BLOCKED browser gate: separate runtime and test DB URLs and NODE_ENV=test required; no env files loaded.');process.exit(1);}
const path='../apps/api/test/browser-adapter.ts';
if(!existsSync(new URL(path,import.meta.url))){console.error('BLOCKED B2: apps/api/test/browser-adapter.ts must provide explicit test adapters and loopback-only server. No production fallback.');process.exit(1);}
try{
  const {startBrowserTestServer}=await import(path);
  const server=await startBrowserTestServer({origin:'http://127.0.0.1:3011',port:3011,webRoot:'apps/web/dist',databaseUrl:process.env.TEST_DATABASE_URL});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void server.close().then(()=>process.exit(0),()=>process.exit(1));});
}catch{console.error('BROWSER_TEST_SERVER_FAILED: private errors suppressed');process.exit(1);}
