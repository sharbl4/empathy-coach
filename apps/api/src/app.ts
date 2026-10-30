import Fastify from 'fastify';
import statics from '@fastify/static';
import { Pool } from 'pg';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Health, ApiError } from '@between/contracts';
import { storageRoutes, type StorageOptions } from './routes/storage.js';
import { HttpError } from './errors.js';
import { Runs } from './services/runs.js';
import { type AiProvider } from './ai/provider.js';
import { configuredProvider } from './ai/gigachat.js';
export async function createApp(options:Partial<StorageOptions>&{provider?:AiProvider;aiTimeoutMs?:number} = {}) {
  if((options.auth||options.provider||options.runs||options.aiTimeoutMs)&&process.env.NODE_ENV!=='test')throw new Error('Dependency injection is test-only');
  if(process.env.AI_PROVIDER&&process.env.AI_PROVIDER!=='gigachat')throw new Error('This backend supports live gigachat only; no implicit mock');
  const app=Fastify({logger:false,bodyLimit:32768});
  const pool=options.pool===undefined?(process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:1500,query_timeout:5000,max:5}) : null):options.pool;
  app.addHook('onClose',async()=>{await pool?.end();});
  const runs=pool?new Runs(pool,options.provider??configuredProvider(),Number(process.env.AI_MAX_CONCURRENCY??2),Number(process.env.AI_MAX_PER_USER??1),options.aiTimeoutMs):undefined;
  if(runs){app.addHook('onReady',()=>runs.start());app.addHook('onClose',()=>runs.close());}
  app.get('/api/health/live',async()=>Health.parse({status:'ok'}));
  app.get('/api/health/ready',async(request,reply)=>{
    try{if(!pool)throw new Error(); await pool.query('SELECT 1'); return Health.parse({status:'ok'});}
    catch{return reply.code(503).send(ApiError.parse({error:{code:'DEPENDENCY_UNAVAILABLE',message:'База данных недоступна',requestId:request.id}}));}
  });
  const root=fileURLToPath(new URL('../../web/dist/',import.meta.url));
  if(existsSync(root))await app.register(statics,{root});
  app.setNotFoundHandler((request,reply)=>{
    if(request.url.split('?')[0]==='/api'||request.url.startsWith('/api/'))return reply.code(404).send({error:{code:'NOT_FOUND',message:'Маршрут не найден',requestId:request.id}});
    if(existsSync(root)&&request.method==='GET'&&!request.url.split('?')[0].includes('.'))return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({error:{code:'NOT_FOUND',message:'Маршрут не найден',requestId:request.id}});
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof HttpError)return reply.code(error.statusCode).send({error:{code:error.code,message:error.message,requestId:request.id}});
    const status=error instanceof Error&&'statusCode' in error?error.statusCode:500;
    const bad=status===400||status===413||(error instanceof Error&&error.name==='ZodError');
    const dbFailure=error instanceof Error&&('severity' in error || /^(ECONN|ETIMEDOUT|ENOTFOUND)/.test(String(('code' in error&&error.code)||'')) || /Connection terminated|Connection timeout|timeout exceeded when trying to connect|Query read timeout/i.test(error.message));
    reply.code(bad?400:dbFailure?503:500).send({error:{code:bad?'VALIDATION_ERROR':dbFailure?'DEPENDENCY_UNAVAILABLE':'INTERNAL_ERROR',message:bad?'Некорректный запрос':dbFailure?'База данных недоступна':'Внутренняя ошибка',requestId:request.id}});
  });
  await app.register(storageRoutes,{pool,auth:options.auth,runs});
  return app;
}
