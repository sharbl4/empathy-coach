import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Id,PageQuery,PublicWebSession,WebMutationProof,RedeemWebLink,IssuedWebLink,webCookiePolicy,type ProductOptions,type BrowserContext,type BrowserAccess,type ConsumedWebLink,type UserContext} from '@between/contracts/product';
import type {PoolClient} from 'pg';
import {Store,account,columns,equal,fail,hmac,transaction,paginate,cursorCodec,type AccountRow} from './core.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const valid=(value:string)=>/^[A-Za-z0-9_-]{43}$/.test(value);
type Binding={id:string;raw:string;session?:string;proofUntil:number};
export class WebAuth {
  private browsers=new WeakMap<object,Binding>();
  readonly cookies=webCookiePolicy(process.env.NODE_ENV==='production'?'production':process.env.NODE_ENV==='test'?'test':'development');
  constructor(private store:Store,private config:ProductOptions['web']){}
  private derive(...parts:unknown[]){return Buffer.from(hmac(this.config.sessionSecret,...parts),'hex').toString('base64url');}
  private binding(browser:BrowserContext){const b=this.browsers.get(browser);if(!b)fail('UNAUTHORIZED');return b;}
  private csrf(b:Binding){return this.derive('csrf',b.id,b.raw);}
  private async live(cookie:string,c=this.store.pool){
    if(!valid(cookie))fail('UNAUTHORIZED');
    const s=(await c.query('SELECT id,user_id,expires_at FROM app.web_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2 AND last_seen_at>$3',[hash(cookie),new Date(this.store.now()),new Date(this.store.now()-7200000)])).rows[0];if(!s)fail('UNAUTHORIZED');
    const r=(await c.query<AccountRow>(`SELECT ${columns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1`,[s.user_id])).rows[0];if(!r)fail('UNAUTHORIZED');
    await c.query('UPDATE app.web_sessions SET last_seen_at=$2 WHERE id=$1',[s.id,new Date(this.store.now())]);return {s,r};
  }
  async resolve(cookie:string):Promise<UserContext>{const {s,r}=await this.live(cookie);return this.store.contexts.issue(r,'web',s.id);}
  async open(bindingCookie?:string,sessionCookie?:string):Promise<BrowserAccess>{
    let row=bindingCookie&&valid(bindingCookie)?(await this.store.pool.query('SELECT id FROM app.browser_bindings WHERE token_hash=$1 AND expires_at>$2',[hash(bindingCookie),new Date(this.store.now())])).rows[0]:undefined;
    let raw=bindingCookie,setBindingCookie:string|undefined;
    if(!row){row={id:randomUUID()};raw=randomBytes(32).toString('base64url');await this.store.pool.query('INSERT INTO app.browser_bindings(id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4)',[row.id,hash(raw),new Date(this.store.now()),new Date(this.store.now()+86400000)]);setBindingCookie=raw;}
    const b:Binding={id:row.id,raw:raw!,proofUntil:0},context=Object.freeze({}) as BrowserContext;this.browsers.set(context,b);
    let publicSession:BrowserAccess['publicSession']={authenticated:false,csrfToken:this.csrf(b)};
    if(sessionCookie){try{const {s,r}=await this.live(sessionCookie);b.session=sessionCookie;publicSession={authenticated:true,account:account(r),csrfToken:this.csrf(b),expiresAt:s.expires_at.toISOString()};}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='UNAUTHORIZED'))throw error;}}
    return {context,publicSession:PublicWebSession.parse(publicSession),...(setBindingCookie?{setBindingCookie}:{})};
  }
  async authorize(browser:BrowserContext,input:ReturnType<typeof WebMutationProof.parse>){
    const proof=WebMutationProof.parse(input),b=this.binding(browser);if(proof.origin!==this.config.origin)fail('ORIGIN_FORBIDDEN');if(!equal(this.csrf(b),proof.csrfToken))fail('CSRF_FAILED');
    if(!(await this.store.pool.query('SELECT 1 FROM app.browser_bindings WHERE id=$1 AND token_hash=$2 AND expires_at>$3',[b.id,hash(b.raw),new Date(this.store.now())])).rowCount)fail('UNAUTHORIZED');b.proofUntil=this.store.now()+5000;
  }
  async issue(ctx:UserContext,key:string){Id.parse(key);return this.store.read(ctx,true,async(c,row)=>{
    if(!this.store.accepting())fail('DEPENDENCY_UNAVAILABLE');
    let link=(await c.query('SELECT * FROM app.web_login_links WHERE user_id=$1 AND issue_key=$2',[row.id,key])).rows[0];
    if(!link){if((await c.query('SELECT count(*)::int n FROM app.web_login_links WHERE user_id=$1 AND created_at>$2',[row.id,new Date(this.store.now()-600000)])).rows[0].n>=5)fail('RATE_LIMITED',300);
      const id=randomUUID(),raw=Buffer.from(hmac(this.config.linkSecret,'link',row.id,id,key),'hex').toString('base64url');
      link=(await c.query('INSERT INTO app.web_login_links(id,user_id,token_hash,created_at,expires_at,issue_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,row.id,hash(raw),new Date(this.store.now()),new Date(this.store.now()+300000),key])).rows[0];
    }if(link.consumed_at)fail('LINK_ALREADY_USED');if(link.expires_at.getTime()<=this.store.now())fail('LINK_EXPIRED');
    return IssuedWebLink.parse({id:link.id,webUrl:`${this.config.origin}/auth/connect#token=${Buffer.from(hmac(this.config.linkSecret,'link',row.id,link.id,key),'hex').toString('base64url')}`,expiresAt:link.expires_at.toISOString()});
  });}
  async redeem(browser:BrowserContext,raw:ReturnType<typeof RedeemWebLink.parse>,key:string):Promise<ConsumedWebLink>{
    const input=RedeemWebLink.parse(raw);Id.parse(key);const b=this.binding(browser);if(b.proofUntil<this.store.now()||b.proofUntil===0)fail('CSRF_FAILED');b.proofUntil=0;if(!this.store.accepting())fail('DEPENDENCY_UNAVAILABLE');
    let existingAccount:string|undefined;if(b.session)existingAccount=(await this.live(b.session)).r.id;
    return transaction(this.store.pool,async c=>{
      const target=(await c.query('SELECT user_id FROM app.web_login_links WHERE token_hash=$1',[hash(input.token)])).rows[0];if(!target)fail('NOT_FOUND');if(existingAccount&&existingAccount!==target.user_id)fail('ACCOUNT_CONFLICT');
      await c.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[target.user_id]);
      const row=(await c.query<AccountRow>(`SELECT ${columns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1 FOR UPDATE OF a`,[target.user_id])).rows[0];if(!row)fail('UNAUTHORIZED');if(row.consent_version!=='web-telegram-2')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');
      const binding=(await c.query('SELECT 1 FROM app.browser_bindings WHERE id=$1 AND token_hash=$2 AND expires_at>$3',[b.id,hash(b.raw),new Date(this.store.now())])).rows[0];if(!binding)fail('UNAUTHORIZED');
      const prior=(await c.query('SELECT * FROM app.web_exchanges WHERE binding_id=$1 AND intent_key=$2',[b.id,key])).rows[0],payload=hmac(this.config.linkSecret,input);
      let sessionId:string,expiresAt:Date;
      if(prior){if(prior.payload_hmac!==payload)fail('IDEMPOTENCY_CONFLICT');
        const old=(await c.query('SELECT * FROM app.web_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>$3 AND last_seen_at>$4',[prior.session_id,row.id,new Date(this.store.now()),new Date(this.store.now()-7200000)])).rows[0];if(!old)fail('LINK_ALREADY_USED');sessionId=old.id;expiresAt=old.expires_at;
      }else{
        const link=(await c.query('SELECT * FROM app.web_login_links WHERE token_hash=$1 AND user_id=$2 FOR UPDATE',[hash(input.token),row.id])).rows[0];if(link.consumed_at)fail('LINK_ALREADY_USED');if(link.expires_at.getTime()<=this.store.now())fail('LINK_EXPIRED');
        sessionId=randomUUID();expiresAt=new Date(this.store.now()+86400000);const token=this.derive('session',b.id,key,sessionId);
        if(b.session)await c.query('UPDATE app.web_sessions SET revoked_at=$2 WHERE token_hash=$1 AND user_id=$3',[hash(b.session),new Date(this.store.now()),row.id]);
        await c.query('UPDATE app.web_login_links SET consumed_at=$2 WHERE id=$1',[link.id,new Date(this.store.now())]);
        await c.query('INSERT INTO app.web_sessions(id,user_id,token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)',[sessionId,row.id,hash(token),new Date(this.store.now()),expiresAt]);
        await c.query('INSERT INTO app.web_exchanges(binding_id,intent_key,payload_hmac,user_id,session_id,link_id) VALUES($1,$2,$3,$4,$5,$6)',[b.id,key,payload,row.id,sessionId,link.id]);
      }
      const token=this.derive('session',b.id,key,sessionId);b.session=token;return {context:this.store.contexts.issue(row,'web',sessionId),setSessionCookie:token,publicSession:PublicWebSession.parse({authenticated:true,account:account(row),csrfToken:this.csrf(b),expiresAt:expiresAt.toISOString()})};
    });
  }
  list(ctx:UserContext,raw:ReturnType<typeof PageQuery.parse>){const input=PageQuery.parse(raw);return this.store.read(ctx,false,async(c,row)=>{const codec=cursorCodec(this.config.sessionSecret,[row.id,'webSessions']),cursor=codec.decode(input.cursor);if(cursor!==null&&typeof cursor!=='string')fail('VALIDATION_ERROR');
    const rows=(await c.query('SELECT * FROM app.web_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>$2 AND last_seen_at>$3 AND ($4::uuid IS NULL OR id<$4) ORDER BY id DESC LIMIT $5',[row.id,new Date(this.store.now()),new Date(this.store.now()-7200000),cursor,input.limit+1])).rows;
    return paginate(rows.map(r=>({id:r.id,createdAt:r.created_at.toISOString(),expiresAt:r.expires_at.toISOString(),isCurrent:this.store.contexts.session(ctx)===r.id})),input.limit,r=>codec.encode(r.id));});}
  async revoke(ctx:UserContext,id:string|'all'|'current',key:string){Id.parse(key);if(id!=='all'&&id!=='current')Id.parse(id);
    if(!this.store.accepting())fail('DEPENDENCY_UNAVAILABLE');
    return this.store.read(ctx,false,async(c,row)=>{const operation='v2.web.revoke',payload=hmac(this.config.sessionSecret,id),prior=(await c.query("SELECT payload_hmac FROM app.domain_intents WHERE user_id=$1 AND operation=$2 AND resource='' AND intent_key=$3",[row.id,operation,key])).rows[0];if(prior){if(prior.payload_hmac!==payload)fail('IDEMPOTENCY_CONFLICT');return;}
      const current=this.store.contexts.session(ctx);if(id==='current'&&!current)fail('UNAUTHORIZED');const target=id==='current'?current:id;
      if(id!=='all'&&!(await c.query('SELECT 1 FROM app.web_sessions WHERE id=$1 AND user_id=$2',[target,row.id])).rowCount)fail('NOT_FOUND');
      await c.query('UPDATE app.web_sessions SET revoked_at=COALESCE(revoked_at,$3) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)',[row.id,id==='all'?null:target,new Date(this.store.now())]);if(id==='all')await c.query('UPDATE app.web_login_links SET consumed_at=COALESCE(consumed_at,$2) WHERE user_id=$1',[row.id,new Date(this.store.now())]);
      await c.query("INSERT INTO app.domain_intents(user_id,operation,resource,intent_key,payload_hmac,result) VALUES($1,$2,'',$3,$4,'null'::jsonb)",[row.id,operation,key,payload]);
    });
  }
  async revokeIn(c:PoolClient,id:string){await c.query('UPDATE app.web_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1',[id,new Date(this.store.now())]);await c.query('UPDATE app.web_login_links SET consumed_at=COALESCE(consumed_at,$2) WHERE user_id=$1',[id,new Date(this.store.now())]);}
}
