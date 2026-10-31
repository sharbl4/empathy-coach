import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError} from '@between/contracts/product';
import {productHarness,syntheticInput,uid} from './product-harness.js';

const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;

// Useful legacy #11 acceptance cases, ported to the actual product facade, not old Bearer DTOs.
test('session creation: concurrent replay and lost response after restart preserve one owned record',async()=>{
  const h=await productHarness();try{
    await h.start();const a=await h.verified(),b=await h.verified(),key=uid();
    const [first,duplicate]=await Promise.all([h.domain.createSession(a.ctx,syntheticInput,key),h.domain.createSession(a.ctx,syntheticInput,key)]);assert.equal(first.id,duplicate.id);
    const other=await h.domain.createSession(b.ctx,syntheticInput,key);assert.notEqual(other.id,first.id);
    // The response was lost to the transport; a fresh process repeats the same intention.
    await h.restart();const ctx=await h.domain.resolveUser(a.identity);
    const reordered={guess:syntheticInput.guess,message:syntheticInput.message,goal:syntheticInput.goal,contextType:syntheticInput.contextType,context:syntheticInput.context,relationship:syntheticInput.relationship,title:syntheticInput.title,mode:syntheticInput.mode};
    assert.equal((await h.domain.createSession(ctx,reordered,key)).id,first.id);
    assert.equal((await h.domain.sessions(ctx,{limit:50})).items.length,1);
    await assert.rejects(h.domain.session(ctx,{id:other.id}),code('NOT_FOUND'));
    // Same UUID in a different operation is independent; deleting cannot resurrect the old intent.
    await h.domain.deleteSession(ctx,{id:first.id,expectedRevision:first.revision},key);
    await assert.rejects(h.domain.createSession(ctx,syntheticInput,key),code('NOT_FOUND'));
    assert.equal((await h.domain.sessions(ctx,{limit:50})).items.length,0);assert.equal(h.calls(),0);
  }finally{await h.close();}
});

test('session creation: concurrent different payloads under one key commit one winner and one conflict',async()=>{
  const h=await productHarness();try{
    const {ctx}=await h.verified(),key=uid();
    const results=await Promise.allSettled([h.domain.createSession(ctx,{...syntheticInput,message:'First synthetic intention'},key),h.domain.createSession(ctx,{...syntheticInput,message:'Second synthetic intention'},key)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const failure=results.find(r=>r.status==='rejected');assert.ok(failure?.status==='rejected'&&code('IDEMPOTENCY_CONFLICT')(failure.reason));
    assert.equal((await h.domain.sessions(ctx,{limit:50})).items.length,1);assert.equal(h.calls(),0);
  }finally{await h.close();}
});
