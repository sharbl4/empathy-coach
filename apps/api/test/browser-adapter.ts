import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createDomainForTest} from '../src/domain/facade.js';
import {createTestHttpAdapter} from '../src/http/testing.js';
import {templateHash} from '../src/domain/product/model.js';
import {migrate} from '../src/db/migrate.js';
import {analysisFixture} from '@between/contracts/product-fixtures';
import {validateEvidenceV2,type UserContext,type ProductOptions} from '@between/contracts/product';
export async function startBrowserTestServer(options:{origin:string;port:number;webRoot:string;databaseUrl:string}):Promise<{close():Promise<void>}>{
  const target=new URL(options.databaseUrl),origin=new URL(options.origin),runtime=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):undefined;
  const same=(a:URL,b:URL)=>a.pathname===b.pathname&&(a.port||'5432')===(b.port||'5432')&&((['127.0.0.1','localhost'].includes(a.hostname)&&['127.0.0.1','localhost'].includes(b.hostname))||a.hostname===b.hostname);
  if(process.env.NODE_ENV!=='test'||options.port!==3011||!['127.0.0.1','localhost'].includes(origin.hostname)||origin.port!=='3011'||origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||!decodeURIComponent(target.pathname).toLowerCase().includes('test')||(runtime&&same(target,runtime)))throw new Error('Dedicated loopback browser test environment required');
  const pool=new Pool({connectionString:options.databaseUrl});try{await migrate(pool);}finally{await pool.end();}
  const codes=new Map<string,string>(),config:ProductOptions={databaseUrl:options.databaseUrl,emailCodeSecret:'1'.repeat(64),web:{origin:options.origin,sessionSecret:'2'.repeat(64),linkSecret:'3'.repeat(64),telegramBotUsername:'synthetic_test_bot'},smtp:{host:'smtp.invalid',port:587,from:'synthetic@example.invalid'},ai:{provider:'local',baseUrl:'http://127.0.0.1:18080/v1',model:'explicit-browser-test-model',timeoutMs:1000,maxConcurrency:1,maxQueueLength:8}};
  const domain=await createDomainForTest(config,{mail:{sendCode:async(email,code)=>{codes.set(email,code);}},model:{describe:async kind=>({hash:templateHash(kind),contextWindow:4096,systemTokens:200,templateTokens:100,known:true}),generate:async snapshot=>{if(snapshot.kind!=='analysis')throw new Error('Browser test model supports analysis only');const field=snapshot.fields.find(f=>f.label==='session.message');if(!field)throw new Error('Missing test source');return validateEvidenceV2('analysis',{...analysisFixture,interpretations:analysisFixture.interpretations.map((item,i)=>({...item,evidence:i?[]:[{fieldId:field.id,quote:field.value}]}))},snapshot.fields);}}});
  let http:Awaited<ReturnType<typeof createTestHttpAdapter>>|undefined;
  try{await domain.acquirePollerLease('99000001');await domain.start();const contexts={} as Record<'A'|'B',UserContext>;
    for(const [i,name] of (['A','B'] as const).entries()){
      const id=String(99000101+i),ctx=await domain.resolveUser({telegramUserId:id,privateChatId:id,updateId:String(900001+i)});contexts[name]=ctx;
      await domain.acceptConsent(ctx,{accepted:true,policyVersion:'web-telegram-2'},randomUUID());const status=await domain.emailVerification(ctx,{});
      if(status.state!=='verified'){const email=`browser-${name.toLowerCase()}@example.invalid`,challenge=await domain.requestEmailCode(ctx,{email},randomUUID());if(challenge.state!=='challenge')throw new Error('Expected test challenge');const code=codes.get(email);if(!code)throw new Error('Expected test SMTP capture');await domain.verifyEmailCode(ctx,{challengeId:challenge.challenge.challengeId,code},randomUUID());}
      if(name==='A'&&!(await domain.sessions(ctx,{limit:50})).items.some(s=>s.input.title==='Тестовая история участника A'))await domain.createSession(ctx,{mode:'understand',title:'Тестовая история участника A',relationship:'Коллега',context:'Синтетический browser test',contextType:'colleague',goal:'clarify',message:'Завтра?',guess:{emotions:[],quotes:[],unsure:true}},randomUUID());
    }
    http=await createTestHttpAdapter({domain,origin:options.origin,port:3011,host:origin.hostname,webRoot:options.webRoot,trustedProxyIPs:[],environment:'test'},name=>domain.issueWebLink(contexts[name],randomUUID()));await http.listen();
    let closed=false;return {close:async()=>{if(closed)return;closed=true;await http?.close();await domain.close();}};
  }catch(error){await http?.close();await domain.close();throw error;}
}
