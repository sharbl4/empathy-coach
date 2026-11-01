import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {Pool} from 'pg';
import {Contexts} from '../src/domain/core.js';
import {WebSessions} from '../src/domain/web-sessions.js';
import {migrate} from '../src/db/migrate.js';
import {databaseSuiteLock} from './database.js';

test('internal web auth: non-consuming preview, atomic one-time exchange, CSRF, rotation, expiry and revocation',async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||process.env.NODE_ENV!=='test'||!/test/i.test(new URL(url).pathname)||url===process.env.DATABASE_URL)throw new Error('Dedicated test DB required');
  const unlock=await databaseSuiteLock(url),db=new Pool({connectionString:url});await migrate(db);
  const id=randomUUID();let now=Date.now();const contexts=new Contexts(db,()=>now),web=new WebSessions(db,contexts,'bc'.repeat(32),'https://app.example.invalid',()=>now);
  try{
    await db.query('INSERT INTO app.profiles(id) VALUES($1)',[id]);await db.query("INSERT INTO app.accounts(id,telegram_user_id,email,email_verified_at,consent_version) VALUES($1,$2,'person@example.invalid',now(),'telegram-1')",[id,String(randomInt(10000000,90000000))]);
    const row=(await db.query('SELECT id,telegram_user_id FROM app.accounts WHERE id=$1',[id])).rows[0],ctx=contexts.issue(row);
    const link=await web.createLink(ctx),raw=new URLSearchParams(new URL(link.url).hash.slice(1)).get('token')!;
    assert.ok(new URL(link.url).origin==='https://app.example.invalid');assert.ok(new URL(link.url).search==='');
    assert.ok((await web.inspectLink(raw)).available);assert.ok((await web.inspectLink(raw)).available);
    await assert.rejects(web.redeem(raw,'https://attacker.example.invalid'),{code:'UNAUTHORIZED'});assert.ok((await web.inspectLink(raw)).available);
    const exchanges=await Promise.allSettled([web.redeem(raw,'https://app.example.invalid'),web.redeem(raw,'https://app.example.invalid')]);
    const success=exchanges.find(x=>x.status==='fulfilled');assert.ok(success&&success.status==='fulfilled');assert.equal(exchanges.filter(x=>x.status==='fulfilled').length,1);
    const session=success.value;assert.equal(session.context.accountId,id);assert.ok(session.cookie.includes('HttpOnly')&&session.cookie.includes('Secure')&&session.cookie.includes('SameSite=Strict')&&session.cookie.includes('Path=/'));
    const stored=JSON.stringify((await db.query('SELECT * FROM app.web_sessions WHERE user_id=$1',[id])).rows);assert.ok(!stored.includes(session.sessionToken));assert.ok(!stored.includes(session.csrfToken));
    const auth=await web.authenticate(session.sessionToken);assert.ok(auth.csrfToken===session.csrfToken);assert.equal((await contexts.check(auth.context)).id,id);
    await assert.rejects(web.authenticate(session.sessionToken,{origin:'https://app.example.invalid',csrfToken:'wrong'}),{code:'UNAUTHORIZED'});
    await assert.rejects(web.authenticate(session.sessionToken,{origin:'https://attacker.example.invalid',csrfToken:session.csrfToken}),{code:'UNAUTHORIZED'});
    await web.authenticate(session.sessionToken,{origin:'https://app.example.invalid',csrfToken:session.csrfToken});
    const second=await web.createLink(ctx),secondRaw=new URLSearchParams(new URL(second.url).hash.slice(1)).get('token')!;
    const rotated=await web.redeem(secondRaw,'https://app.example.invalid',session.sessionToken);await assert.rejects(web.authenticate(session.sessionToken),{code:'UNAUTHORIZED'});await assert.rejects(contexts.check(auth.context),{code:'UNAUTHORIZED'});
    const cleared=await web.logout(rotated.sessionToken,'https://app.example.invalid',rotated.csrfToken);assert.ok(cleared.includes('Max-Age=0'));await assert.rejects(web.authenticate(rotated.sessionToken),{code:'UNAUTHORIZED'});
    const expiring=await web.createLink(ctx),expiringRaw=new URLSearchParams(new URL(expiring.url).hash.slice(1)).get('token')!;now+=300001;await assert.rejects(web.redeem(expiringRaw,'https://app.example.invalid'),{code:'UNAUTHORIZED'});
    const last=await web.createLink(ctx),lastRaw=new URLSearchParams(new URL(last.url).hash.slice(1)).get('token')!,lastSession=await web.redeem(lastRaw,'https://app.example.invalid');
    await web.revokeAll(ctx);await assert.rejects(contexts.check(lastSession.context),{code:'UNAUTHORIZED'});await assert.rejects(web.authenticate(lastSession.sessionToken),{code:'UNAUTHORIZED'});
    assert.throws(()=>web.cookie('injected\r\nHeader: value'),{code:'VALIDATION_ERROR'});
    const later=await web.createLink(ctx);now+=300001;assert.equal((await web.inspectLink(new URLSearchParams(new URL(later.url).hash.slice(1)).get('token')!)).available,false);
  }finally{await db.query('DELETE FROM app.profiles WHERE id=$1',[id]);await db.end();await unlock();}
});
