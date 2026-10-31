/** Internal auth storage only. Public HTTP/facade DTOs await Anton's A1 contract. */
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {UserContext} from '@between/contracts/domain';
import {transaction} from '../repositories/storage.js';
import {Contexts,accountColumns,digest,fail,type AccountRow} from './core.js';
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const valid=(value:string)=>/^[A-Za-z0-9_-]{43}$/.test(value);
export class WebSessions {
  private origin:string;
  constructor(private pool:Pool,private contexts:Contexts,private secret:string,origin:string,private now=Date.now){
    const url=new URL(origin);if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Invalid web origin');
    if(url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('HTTPS required');this.origin=url.origin;
  }
  private csrf(id:string,cookie:string){return digest(this.secret,'web-csrf',id,cookie);}
  private verifyCsrf(id:string,cookie:string,origin:string,csrf:string){
    if(origin!==this.origin||!/^[a-f0-9]{64}$/.test(csrf))fail('UNAUTHORIZED');
    if(!timingSafeEqual(Buffer.from(this.csrf(id,cookie),'hex'),Buffer.from(csrf,'hex')))fail('UNAUTHORIZED');
  }
  async createLink(ctx:UserContext){
    const raw=token(),id=randomUUID(),expiresAt=new Date(this.now()+300000);
    await transaction(this.pool,async client=>{
      const row=await this.contexts.check(ctx,client,true,true);
      const rate=(await client.query('SELECT count(*)::int AS count FROM app.web_login_links WHERE user_id=$1 AND created_at>$2',[row.id,new Date(this.now()-600000)])).rows[0];
      if(rate.count>=5)fail('RATE_LIMITED');
      await client.query('INSERT INTO app.web_login_links(id,user_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[id,row.id,hash(raw),new Date(this.now()),expiresAt]);
    });
    return {url:`${this.origin}/auth/telegram#token=${raw}`,expiresAt:expiresAt.toISOString()};
  }
  async inspectLink(raw:string){
    if(!valid(raw))return {available:false};
    const row=(await this.pool.query('SELECT 1 FROM app.web_login_links WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>$2',[hash(raw),new Date(this.now())])).rows[0];return {available:!!row};
  }
  async redeem(raw:string,origin:string,previousCookie?:string){
    if(origin!==this.origin||!valid(raw))fail('UNAUTHORIZED');
    const sessionToken=token(),id=randomUUID(),expiresAt=new Date(this.now()+7*86400000);
    const ctx=await transaction(this.pool,async client=>{
      const candidate=(await client.query('SELECT user_id FROM app.web_login_links WHERE token_hash=$1',[hash(raw)])).rows[0];if(!candidate)fail('UNAUTHORIZED');
      await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[candidate.user_id]);
      const row=(await client.query<AccountRow>(`SELECT ${accountColumns} FROM app.accounts a JOIN app.profiles p ON p.id=a.id WHERE a.id=$1 FOR UPDATE OF a`,[candidate.user_id])).rows[0];
      if(!row||row.consent_version!=='telegram-1'||!row.email_verified_at)fail('UNAUTHORIZED');
      const link=(await client.query('SELECT * FROM app.web_login_links WHERE token_hash=$1 AND user_id=$2 FOR UPDATE',[hash(raw),row.id])).rows[0];
      if(!link||link.consumed_at||link.expires_at.getTime()<=this.now())fail('UNAUTHORIZED');
      await client.query('UPDATE app.web_login_links SET consumed_at=$2 WHERE id=$1',[link.id,new Date(this.now())]);
      if(previousCookie&&valid(previousCookie))await client.query('UPDATE app.web_sessions SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL',[hash(previousCookie),new Date(this.now())]);
      await client.query('INSERT INTO app.web_sessions(id,user_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[id,row.id,hash(sessionToken),new Date(this.now()),expiresAt]);return this.contexts.issueWeb(row,id);
    });
    return {context:ctx,sessionToken,csrfToken:this.csrf(id,sessionToken),expiresAt:expiresAt.toISOString(),cookie:this.cookie(sessionToken)};
  }
  private async session(client:Pool|PoolClient,cookie:string){
    if(!valid(cookie))fail('UNAUTHORIZED');
    const row=(await client.query(`SELECT s.id AS session_id,s.expires_at,${accountColumns} FROM app.web_sessions s JOIN app.accounts a ON a.id=s.user_id JOIN app.profiles p ON p.id=a.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2`,[hash(cookie),new Date(this.now())])).rows[0];if(!row)fail('UNAUTHORIZED');return row as AccountRow&{session_id:string;expires_at:Date};
  }
  async authenticate(cookie:string,mutation?:{origin:string;csrfToken:string}){
    const row=await this.session(this.pool,cookie);if(mutation)this.verifyCsrf(row.session_id,cookie,mutation.origin,mutation.csrfToken);
    return {context:this.contexts.issueWeb(row,row.session_id),csrfToken:this.csrf(row.session_id,cookie),expiresAt:row.expires_at.toISOString()};
  }
  async logout(cookie:string,origin:string,csrf:string){
    const row=await this.session(this.pool,cookie);this.verifyCsrf(row.session_id,cookie,origin,csrf);
    await transaction(this.pool,async client=>{await this.contexts.check(this.contexts.issueWeb(row,row.session_id),client,false,true);await client.query('UPDATE app.web_sessions SET revoked_at=$2 WHERE id=$1',[row.session_id,new Date(this.now())]);});return this.cookie('',true);
  }
  async revokeAll(ctx:UserContext){
    await transaction(this.pool,async client=>{const row=await this.contexts.check(ctx,client,false,true);await client.query('UPDATE app.web_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL',[row.id,new Date(this.now())]);await client.query('UPDATE app.web_login_links SET consumed_at=$2 WHERE user_id=$1 AND consumed_at IS NULL',[row.id,new Date(this.now())]);});
  }
  cookie(value:string,clear=false){
    if(value&&!valid(value))fail('VALIDATION_ERROR');
    const secure=this.origin.startsWith('https:');return `${secure?'__Host-between_session':'between_dev_session'}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:7*86400}${secure?'; Secure':''}`;
  }
}
