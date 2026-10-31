// Import must be library-only; a hanging process is an integration failure.
const timeout=globalThis.setTimeout(()=>{console.error('BLOCKED domain import started background work');process.exit(1);},5000);
try{
  const domain=await import('@between/api');
  if(typeof domain.createDomain!=='function')throw new Error();
  console.log('OK createDomain export imported; no HTTP server requested');
}catch{console.error('BLOCKED @between/api.createDomain export; no legacy HTTP fallback');process.exitCode=1;}
finally{timeout.unref();}
