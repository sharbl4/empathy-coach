import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ApiError, Health } from '@between/contracts';
test('live works; unknown API never falls through to HTML',async()=>{
 const app=await createApp();try{const live=await app.inject('/api/health/live');assert.equal(live.statusCode,200);Health.parse(live.json());for(const path of ['/api/unknown','/api']){const response=await app.inject(path);assert.equal(response.statusCode,404);ApiError.parse(response.json());}}finally{await app.close();}
});
test('readiness reports absent DB honestly',async()=>{
 const old=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 const app=await createApp();try{const result=await app.inject('/api/health/ready');assert.equal(result.statusCode,503);ApiError.parse(result.json());}finally{await app.close();if(old)process.env.DATABASE_URL=old;}
});
