import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const env={...process.env,PG_PASSWORD:'template_only_password',BOT_IMAGE:'between-telegram:template-only',DATABASE_URL:'postgresql://empathy:template_only_password@db:5432/empathy',TELEGRAM_BOT_TOKEN:'123456:template_only_never_used_for_network',LOCAL_LLM_BASE_URL:'http://100.64.0.2:8080/v1',LOCAL_LLM_MODEL:'Qwen3-8B-Q4_K_M',LOCAL_LLM_API_KEY:'template_only_key',SMTP_HOST:'smtp.invalid',SMTP_FROM:'noreply@example.invalid',EMAIL_CODE_SECRET:'f'.repeat(64)};
const result=spawnSync('docker',['compose','--env-file','.env.example','-f','compose.production.yaml','config','--format','json'],{env,encoding:'utf8'});
try{
  assert.equal(result.status,0);const config=JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(config.services).toSorted(),['bot','db']);
  for(const service of Object.values(config.services)){assert.ok(!service.ports?.length);assert.ok(!service.build);assert.ok(service.mem_limit);assert.equal(service.logging.driver,'none');}
  assert.equal(config.services.bot.environment.AI_PROVIDER,'local');
  assert.ok(!Object.keys(config.services.bot.environment).some(key=>/SUPABASE|GIGACHAT|VITE/.test(key)));
  console.log('OK production compose: bot+db only, no published ports/build/legacy env; memory caps parsed (not load-tested).');
}catch{console.error('BLOCKED production compose validation; raw configuration suppressed');process.exitCode=1;}
