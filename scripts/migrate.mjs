import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const entry='apps/api/dist/db/migrate.js';
if(!existsSync(entry)){console.error('BLOCKED: compile the preserved apps/api/src/db/migrate.ts with the reviewed Telegram library build first. No SQL/legacy server is substituted.');process.exit(1);}
const result=spawnSync(process.execPath,['--env-file-if-exists=.env',entry],{stdio:'inherit'});
process.exit(result.status??1);
