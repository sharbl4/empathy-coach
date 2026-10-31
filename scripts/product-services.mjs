import {createRequire} from 'node:module';
import {RuntimeEnvironmentV2} from '@between/contracts/product';
const {fetch,AbortSignal}=globalThis;
const parsed=RuntimeEnvironmentV2.safeParse(process.env);
if(!parsed.success){console.error('CONFIG_INVALID: current app/SMTP/model/web secrets required; values suppressed. No API calls made.');process.exit(1);}
const config=parsed.data,{Pool}=createRequire(new URL('../apps/api/package.json',import.meta.url))('pg');
const db=new Pool({connectionString:config.DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:3000});
try{await db.query('SELECT 1');const response=await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getMe`,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!(await response.json()).ok)throw new Error();console.log('OK DB SELECT1 + Telegram getMe; no polling/model generation. SMTP, HTTPS, web linking and ownership still require live checks.');}
catch{console.error('SERVICES_UNAVAILABLE: raw errors/URLs suppressed');process.exitCode=1;}finally{await db.end();}
