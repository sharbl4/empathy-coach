import {createRequire} from 'node:module';
import {RuntimeEnvironment} from '@between/contracts/domain';
const {fetch,AbortSignal}=globalThis;
const parsed=RuntimeEnvironment.safeParse(process.env);
if(!parsed.success){console.error('BLOCKED current Telegram/local/SMTP configuration; values suppressed. No API calls made.');process.exit(1);}
const config=parsed.data,requireApi=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {Pool}=requireApi('pg');
const db=new Pool({connectionString:config.DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:3000});
try{
  await db.query('SELECT 1');console.log('OK PostgreSQL SELECT1; migrations/ownership NOT verified');
  async function telegram(method){const response=await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const result=await response.json();if(!result.ok)throw new Error();return result.result;}
  const me=await telegram('getMe');if(!me.is_bot)throw new Error();
  const webhook=await telegram('getWebhookInfo');if(webhook.url)throw new Error();
  console.log('OK Telegram getMe; webhook absent; no polling started');
  const response=await fetch(new URL('/health',config.LOCAL_LLM_BASE_URL),{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error();
  console.log('OK private model health; inference/SMTP/Telegram E2E NOT verified; generations=0');
}catch{console.error('BLOCKED real Telegram/local services; values and raw errors suppressed. No generation/fallback.');process.exitCode=1;}
finally{await db.end();}
