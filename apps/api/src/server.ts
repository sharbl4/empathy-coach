import { createApp } from './app.js';
let app:Awaited<ReturnType<typeof createApp>>|undefined;
try {
  app=await createApp();
  const port=Number(process.env.PORT??3000);
  await app.listen({port,host:'0.0.0.0'});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{
    void app?.close().catch(()=>{console.error('Backend shutdown failed');process.exitCode=1;});
  });
} catch {
  console.error('Backend startup failed; verify configuration, database migrations and single-process lease');
  await app?.close().catch(()=>{});
  process.exitCode=1;
}
