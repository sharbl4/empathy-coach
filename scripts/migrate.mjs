import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const entry='apps/api/dist/db/migrate.js';
if(!existsSync(entry)){console.error('BLOCKED: Дима должен реализовать apps/api/src/db/migrate.ts: версии, advisory lock, транзакции. Затем npm run build.');process.exit(1);}
const result=spawnSync(process.execPath,['--env-file-if-exists=.env',entry],{stdio:'inherit'});
process.exit(result.status??1);
