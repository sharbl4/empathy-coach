import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { supabaseVerifier } from '../src/auth/verifier.js';
import { HttpError } from '../src/errors.js';

test('Supabase SDK verifies token over HTTP; rejects invalid token and outage',async()=>{
  const id=randomUUID();let status=200;
  const server=createServer((request,response)=>{
    assert.equal(request.url,'/auth/v1/user');assert.equal(request.headers.authorization,'Bearer supplied-token');
    response.writeHead(status,{'content-type':'application/json'});
    response.end(JSON.stringify(status===200?{id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}:{msg:'Unavailable',code:'test'}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL=`http://127.0.0.1:${address.port}`;process.env.SUPABASE_PUBLISHABLE_KEY='public-test-key';
  try {
    const auth=supabaseVerifier();assert.equal(await auth.verify('supplied-token'),id);
    status=401;await assert.rejects(auth.verify('supplied-token'),error=>error instanceof HttpError&&error.statusCode===401);
    status=503;await assert.rejects(auth.verify('supplied-token'),error=>error instanceof HttpError&&error.statusCode===503);
    delete process.env.SUPABASE_URL;
    await assert.rejects(supabaseVerifier().verify('supplied-token'),error=>error instanceof HttpError&&error.statusCode===503);
  } finally {
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=oldKey;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
