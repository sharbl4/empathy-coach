import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createHttpAdapter} from '../src/http/index.js';
import {ProductError,PublicWebSession,type ProductFacade} from '@between/contracts/product';
import {productHarness,syntheticInput,uid} from './product-harness.js';
test('A1 real HTTP cookie exchange, CSRF, races/replay, owner isolation, collision rejection and logout',async()=>{
  const h=await productHarness(),webRoot=await mkdtemp(join(tmpdir(),'between-web-test-'));await writeFile(join(webRoot,'index.html'),'<html><body>Explicit test shell</body></html>');let http:Awaited<ReturnType<typeof createHttpAdapter>>|undefined;
  const jars=new Map<string,Map<string,string>>();
  const request=async(who:string,path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{const jar=jars.get(who)??new Map<string,string>();jars.set(who,jar);const r=await fetch('http://127.0.0.1:3011'+path,{method,headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});for(const c of r.headers.getSetCookie()){const first=c.split(';')[0],i=first.indexOf('=');jar.set(first.slice(0,i),first.slice(i+1));}return r;};
  const session=async(who:string)=>PublicWebSession.parse(await(await request(who,'/api/auth/session')).json());
  const proof=async(who:string,intent=uid())=>({'origin':h.options.web.origin,'idempotency-key':intent,'x-csrf-token':(await session(who)).csrfToken});
  try{await h.start();const a=await h.verified(),b=await h.verified();const saved=await h.domain.createSession(a.ctx,syntheticInput,uid());http=await createHttpAdapter({domain:h.domain,origin:h.options.web.origin,port:3011,host:'127.0.0.1',webRoot,trustedProxyIPs:[],environment:'test'});await http.listen();assert.equal((await request('anon','/health/ready')).status,200);assert.equal((await request('anon','/api/account')).status,401);
    const link=await h.domain.issueWebLink(a.ctx,uid()),token=new URL(link.webUrl).hash.slice(7);assert.equal((await request('one','/auth/connect')).status,200);assert.equal((await request('one','/auth/connect','HEAD')).status,200);assert.equal((await session('one')).authenticated,false);
    let denied=await request('one','/api/auth/web-links/redeem','POST',{token,confirmed:true});assert.equal(denied.status,403);ProductError.parse(await denied.json());
    const headers=await proof('one'),body={token,confirmed:true};const [x,y]=await Promise.all([request('one','/api/auth/web-links/redeem','POST',body,headers),request('one','/api/auth/web-links/redeem','POST',body,headers)]);assert.equal(x.status,200);assert.equal(y.status,200);const publicResult=await x.json();assert.equal(PublicWebSession.parse(publicResult).authenticated,true);assert.ok(!JSON.stringify(publicResult).includes('setSessionCookie'));const sessionCookies=[...jars.get('one')!].filter(([k])=>k==='between_session_dev');assert.equal(sessionCookies.length,1);assert.ok(x.headers.getSetCookie().some(c=>c.includes('HttpOnly')&&c.includes('SameSite=Lax')&&!c.includes('Domain=')));
    denied=await request('two','/api/auth/web-links/redeem','POST',body,await proof('two'));assert.equal(denied.status,409);assert.equal(ProductError.parse(await denied.json()).error.code,'LINK_ALREADY_USED');
    const history=await request('one','/api/sessions');assert.equal(history.status,200);assert.equal((await history.json()).items[0].id,saved.id);
    const badOrigin=await request('one','/api/sessions','POST',syntheticInput,{...await proof('one'),origin:'https://foreign.invalid'});assert.equal(badOrigin.status,403);assert.equal(ProductError.parse(await badOrigin.json()).error.code,'ORIGIN_FORBIDDEN');
    const collision=await request('one',`/api/sessions/${saved.id}`,'PATCH',{id:saved.id,expectedRevision:1,input:syntheticInput},await proof('one'));assert.equal(collision.status,400);
    const foreign=await h.domain.issueWebLink(b.ctx,uid());const foreignToken=new URL(foreign.webUrl).hash.slice(7);denied=await request('one','/api/auth/web-links/redeem','POST',{token:foreignToken,confirmed:true},await proof('one'));assert.equal(ProductError.parse(await denied.json()).error.code,'ACCOUNT_CONFLICT');
    const loginB=await request('two','/api/auth/web-links/redeem','POST',{token:foreignToken,confirmed:true},await proof('two'));assert.equal(loginB.status,200);assert.equal((await request('two',`/api/sessions/${saved.id}`)).status,404);
    const held=await h.domain.resolveWebSession(jars.get('one')!.get('between_session_dev')!);const logout=await request('one','/api/auth/logout','POST',{},await proof('one'));assert.equal(logout.status,200);await assert.rejects(h.domain.account(held,{}),e=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='UNAUTHORIZED');assert.equal((await session('one')).authenticated,false);
    // Browser test adapter is a separate opt-in helper, absent from production HTTP.
    assert.equal((await request('anon','/__test/issue-web-link','POST',{account:'A'})).status,404);
  }finally{await http?.close();await h.close();assert.equal(resolve(dirname(webRoot)),resolve(tmpdir()));assert.ok(basename(webRoot).startsWith('between-web-test-'));await rm(webRoot,{recursive:true,force:true});}
});
test('A1 revoked/expired sessions never revive through exchange replay; CSRF also protects anonymous exchange',async()=>{
  const h=await productHarness();try{const {ctx}=await h.verified(),link=await h.domain.issueWebLink(ctx,uid()),token=new URL(link.webUrl).hash.slice(7),b=await h.domain.openBrowser(),intent=uid();await assert.rejects(h.domain.redeemWebLink(b.context,{token,confirmed:true},intent),e=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='CSRF_FAILED');
    await h.domain.authorizeWebMutation(b.context,{origin:h.options.web.origin,csrfToken:b.publicSession.csrfToken});const consumed=await h.domain.redeemWebLink(b.context,{token,confirmed:true},intent);h.advance(7200001);await assert.rejects(h.domain.resolveWebSession(consumed.setSessionCookie));const retry=await h.domain.openBrowser(b.setBindingCookie);await h.domain.authorizeWebMutation(retry.context,{origin:h.options.web.origin,csrfToken:retry.publicSession.csrfToken});await assert.rejects(h.domain.redeemWebLink(retry.context,{token,confirmed:true},intent));
  }finally{await h.close();}
});
test('production refuses test-only browser/model injection',async()=>{
  const prior=process.env.NODE_ENV;process.env.NODE_ENV='production';try{const {startBrowserTestServer}=await import('./browser-adapter.js');await assert.rejects(startBrowserTestServer({origin:'http://127.0.0.1:3011',port:3011,webRoot:'.',databaseUrl:'postgresql://test@127.0.0.1/synthetic_test'}));}finally{process.env.NODE_ENV=prior;}
});
// Type-only dependency ensures no handwritten HTTP facade DTO drifts into this test.
export type HttpTestDomain=ProductFacade;
