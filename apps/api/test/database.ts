import { Pool } from 'pg';
// Serialize DB suites against the same disposable database even across test workers.
// Separate connection keeps this lock independent of app lifecycle/pool shutdown.
export async function databaseSuiteLock(url:string) {
  const guard=new Pool({connectionString:url,max:1});
  await guard.query('SELECT pg_advisory_lock(748311905)');
  return async()=>{try{await guard.query('SELECT pg_advisory_unlock(748311905)');}finally{await guard.end();}};
}
