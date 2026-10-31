/** SERVER ONLY. Never import from a browser bundle; no re-export from product/http/domain. */
import{z}from'zod';
const text=(max=3000)=>z.string().trim().min(1).max(max);
const instant=z.iso.datetime();
export const BOT_HEALTH_FILE='/tmp/between-bot-health.json';
export const BotHealth=z.strictObject({pid:z.number().int().positive(),heartbeatAt:z.iso.datetime(),database:z.boolean(),pollerLease:z.boolean(),polling:z.boolean()});
export function isPrivateModelUrl(value:string,production=false):boolean {
  try{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/\/v1\/?$/.test(url.pathname))return false;
    const parts=url.hostname.split('.').map(Number),ipv4=parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
    const tailnet=ipv4&&parts[0]===100&&parts[1]>=64&&parts[1]<=127;
    const local=!production&&(url.hostname==='localhost'||url.hostname==='[::1]'||(ipv4&&(parts[0]===127||parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168))));
    // Use numeric Tailscale IPs to avoid DNS rebinding/public endpoint ambiguity.
    return tailnet||local;
  }catch{return false;}
}
export const LegacyRuntimeEnvironment=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),DATABASE_URL:z.string().url(),
  TELEGRAM_BOT_TOKEN:z.string().regex(/^[0-9]+:[A-Za-z0-9_-]{20,}$/),AI_PROVIDER:z.literal('local'),
  LOCAL_LLM_BASE_URL:z.string().url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&/\/v1\/?$/.test(url.pathname);}),
  LOCAL_LLM_MODEL:text(200),LOCAL_LLM_API_KEY:z.string().optional(),AI_TIMEOUT_MS:z.coerce.number().int().min(1000).max(300000).default(90000),AI_MAX_CONCURRENCY:z.coerce.number().int().min(1).max(2).default(1),
  SMTP_HOST:text(253),SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(587),SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),SMTP_FROM:z.email(),EMAIL_CODE_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),
}).superRefine((value,ctx)=>{
  if(!isPrivateModelUrl(value.LOCAL_LLM_BASE_URL,value.NODE_ENV==='production'))ctx.addIssue({code:'custom',path:['LOCAL_LLM_BASE_URL'],message:'Private model endpoint required'});
  if(value.NODE_ENV==='production'&&(value.LOCAL_LLM_API_KEY?.length??0)<32)ctx.addIssue({code:'custom',path:['LOCAL_LLM_API_KEY'],message:'Strong model authentication key required'});
});
export const RuntimeHealth=z.strictObject({pid:z.number().int().positive(),heartbeatAt:instant,database:z.boolean(),http:z.boolean(),polling:z.boolean(),workers:z.boolean(),scheduler:z.boolean()});
export const RuntimeEnvironment=z.object({NODE_ENV:z.enum(['development','test','production']).default('development'),DATABASE_URL:z.url(),TELEGRAM_BOT_TOKEN:text(200),AI_PROVIDER:z.literal('local'),LOCAL_LLM_BASE_URL:z.url(),LOCAL_LLM_MODEL:text(200),LOCAL_LLM_API_KEY:z.string().optional(),AI_TIMEOUT_MS:z.coerce.number().int().min(1000).max(300000).default(90000),AI_MAX_CONCURRENCY:z.coerce.number().int().min(1).max(1).default(1),AI_MAX_QUEUE_LENGTH:z.coerce.number().int().min(1).max(20).default(8),SMTP_HOST:text(253),SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(587),SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),SMTP_FROM:z.email(),EMAIL_CODE_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),WEB_ORIGIN:z.url(),WEB_SESSION_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),WEB_LINK_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),PORT:z.coerce.number().int().min(1).max(65535).default(3000),TRUSTED_PROXY_IPS:z.string().default('')}).superRefine((value,ctx)=>{
  const origin=new URL(value.WEB_ORIGIN),production=value.NODE_ENV==='production';
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||(production?origin.protocol!=='https:':!['http:','https:'].includes(origin.protocol)))ctx.addIssue({code:'custom',path:['WEB_ORIGIN'],message:'Explicit origin required'});
  if(!isPrivateModelUrl(value.LOCAL_LLM_BASE_URL,production))ctx.addIssue({code:'custom',path:['LOCAL_LLM_BASE_URL'],message:'Private model endpoint required'});
  if(production&&(value.LOCAL_LLM_API_KEY?.length??0)<32)ctx.addIssue({code:'custom',path:['LOCAL_LLM_API_KEY'],message:'Strong endpoint key required'});
  if(new Set([value.EMAIL_CODE_SECRET,value.WEB_SESSION_SECRET,value.WEB_LINK_SECRET]).size!==3)ctx.addIssue({code:'custom',message:'Independent secrets required'});
  if(value.TRUSTED_PROXY_IPS.split(',').filter(Boolean).some(part=>!/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(part.trim())||part.trim().split('.').some(octet=>Number(octet)>255)))ctx.addIssue({code:'custom',path:['TRUSTED_PROXY_IPS'],message:'Exact proxy IPs only; no wildcard, boolean or broad CIDR'});
});

/** Server-only transition alias; new code uses RuntimeEnvironment. */
export const RuntimeEnvironmentV2=RuntimeEnvironment;
