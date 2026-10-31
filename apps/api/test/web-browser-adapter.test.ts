import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {Pool} from 'pg';
import {IssuedWebLink,PublicWebSession,SessionPageV2} from '@between/contracts/product';
import {startBrowserTestServer} from './browser-adapter.js';
import {dedicatedDatabase,uid} from './product-harness.js';
import {databaseSuiteLock} from './database.js';
test('2.2 browser adapter starts real backend; test bot issues a link and ordinary cookie exchange exposes shared history',async()=>{
  const url=dedicatedDatabase(),unlock=await databaseSuiteLock(url),webRoot=await mkdtemp(join(tmpdir(),'between-browser-adapter-'));await writeFile(join(webRoot,'index.html'),'<html>Explicit adapter test shell</html>');let server:Awaited<ReturnType<typeof startBrowserTestServer>>|undefined;
  try{server=await startBrowserTestServer({origin:'http://127.0.0.1:3011',port:3011,webRoot,databaseUrl:url});const base='http://127.0.0.1:3011',jar=new Map<string,string>();
    const request=async(path:string,body?:unknown,headers:Record<string,string>={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),...(body?{'content-type':'application/json'}:{}),...headers},...body?{body:JSON.stringify(body)}:{}});for(const value of r.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');jar.set(part.slice(0,i),part.slice(i+1));}return r;};
    assert.equal((await request('/api/health/live')).status,200);const link=IssuedWebLink.parse(await(await request('/__test/issue-web-link',{account:'A'})).json());const anon=PublicWebSession.parse(await(await request('/api/auth/session')).json());assert.equal(anon.authenticated,false);
    const login=await request('/api/auth/web-links/redeem',{token:new URL(link.webUrl).hash.slice(7),confirmed:true},{origin:base,'x-csrf-token':anon.csrfToken,'idempotency-key':uid()});assert.equal(login.status,200);assert.equal(PublicWebSession.parse(await login.json()).authenticated,true);
    const history=SessionPageV2.parse(await(await request('/api/sessions')).json());assert.ok(history.items.some(s=>s.input.title==='Тестовая история участника A'));
  }finally{await server?.close();await server?.close();const pool=new Pool({connectionString:url});try{await pool.query("DELETE FROM app.profiles WHERE id IN (SELECT id FROM app.accounts WHERE telegram_user_id IN (99000101,99000102))");}finally{await pool.end();await unlock();}
    assert.equal(resolve(dirname(webRoot)),resolve(tmpdir()));assert.ok(basename(webRoot).startsWith('between-browser-adapter-'));await rm(webRoot,{recursive:true,force:true});
  }
});
