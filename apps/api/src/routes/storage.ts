import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { DeleteData, ExpectedRevision, ExerciseAnswer, ReplyRequest, TurnRequest, Id, IdempotencyHeaders, RunAccepted, SessionInput, SessionQuery, UpdateMe, UpdateSession } from '@between/contracts';
import { Storage } from '../repositories/storage.js';
import { type AuthVerifier, supabaseVerifier } from '../auth/verifier.js';
import { HttpError, unavailable } from '../errors.js';
import type { Runs } from '../services/runs.js';

declare module 'fastify' { interface FastifyRequest { userId:string; } }
export interface StorageOptions { pool:Pool|null; auth?:AuthVerifier; runs?:Runs; }
export async function storageRoutes(app:FastifyInstance,options:StorageOptions) {
  if(options.auth && process.env.NODE_ENV!=='test') throw new Error('Auth injection is test-only');
  const auth=options.auth??supabaseVerifier();
  const store=options.pool?new Storage(options.pool):null;
  app.decorateRequest('userId','');
  app.addHook('preHandler',async request=>{
    const match=/^Bearer ([^\s]+)$/i.exec(request.headers.authorization??'');
    if(!match) throw new HttpError(401,'UNAUTHORIZED','Войдите в аккаунт');
    request.userId=await auth.verify(match[1]);
    if(!store) throw unavailable();
  });
  const db=()=>{if(!store)throw unavailable();return store;};
  const id=(params:unknown)=>Id.parse((params as {id:string}).id);
  app.get('/api/me',request=>db().profile(request.userId));
  app.patch('/api/me',request=>db().profile(request.userId,UpdateMe.parse(request.body)));
  app.delete('/api/me/data',async(request,reply)=>{DeleteData.parse(request.body);await db().clear(request.userId,ids=>options.runs?.cancelDeleted(ids));return reply.code(204).send();});
  app.post('/api/sessions',async(request,reply)=>reply.code(201).send(await db().create(request.userId,SessionInput.parse(request.body))));
  app.get('/api/sessions',request=>db().list(request.userId,SessionQuery.parse(request.query)));
  app.get('/api/sessions/:id',request=>db().detail(request.userId,id(request.params)));
  app.patch('/api/sessions/:id',request=>db().update(request.userId,id(request.params),UpdateSession.parse(request.body)));
  app.delete('/api/sessions/:id',async(request,reply)=>{await db().remove(request.userId,id(request.params));return reply.code(204).send();});
  app.post('/api/sessions/:id/analyze',async(request,reply)=>{
    const body=ExpectedRevision.parse(request.body),headers=IdempotencyHeaders.parse(request.headers),sessionId=id(request.params);
    if(!options.runs)throw unavailable();
    const result=await options.runs.analyze(request.userId,sessionId,body.expectedRevision,headers['idempotency-key']);
    return reply.code(202).send(RunAccepted.parse(result));
  });
  app.get('/api/runs/:id',request=>{
    const runId=id(request.params);if(!options.runs)throw unavailable();return options.runs.get(request.userId,runId);
  });
  const runs=()=>{if(!options.runs)throw unavailable();return options.runs;};
  const key=(headers:unknown)=>IdempotencyHeaders.parse(headers)['idempotency-key'];
  app.post('/api/sessions/:id/reply-feedback',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().replyFeedback(request.userId,id(request.params),ReplyRequest.parse(request.body),key(request.headers)))));
  app.post('/api/sessions/:id/reply-examples',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().replyExamples(request.userId,id(request.params),ExpectedRevision.parse(request.body),key(request.headers)))));
  app.post('/api/sessions/:id/exercise',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().exercise(request.userId,id(request.params),ExpectedRevision.parse(request.body),key(request.headers)))));
  app.post('/api/sessions/:id/exercise-feedback',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().exerciseFeedback(request.userId,id(request.params),ExerciseAnswer.parse(request.body),key(request.headers)))));
  app.post('/api/sessions/:id/roleplays',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().roleplayStart(request.userId,id(request.params),ExpectedRevision.parse(request.body),key(request.headers)))));
  app.post('/api/roleplays/:id/turns',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().roleplayTurn(request.userId,id(request.params),TurnRequest.parse(request.body),key(request.headers)))));
  app.post('/api/roleplays/:id/finish',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().roleplayFinish(request.userId,id(request.params),ExpectedRevision.parse(request.body),key(request.headers)))));
  app.post('/api/runs/:id/retry',async(request,reply)=>reply.code(202).send(RunAccepted.parse(await runs().retry(request.userId,id(request.params),ExpectedRevision.parse(request.body),key(request.headers)))));
  app.get('/api/progress',request=>db().progress(request.userId));
}
