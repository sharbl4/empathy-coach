import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {RuntimeEnvironmentV2} from '@between/contracts/product';
const env={...process.env,PG_PASSWORD:'template_only_password',APP_IMAGE:'between:template-only',NODE_ENV:'production',DATABASE_URL:'postgresql://empathy:template_only_password@db:5432/empathy',TELEGRAM_BOT_TOKEN:'123456:template_only_never_used_for_network',LOCAL_LLM_BASE_URL:'http://100.64.0.2:8080/v1',LOCAL_LLM_MODEL:'Gemma-3-4B-IT-Q4_K_M',LOCAL_LLM_API_KEY:'d'.repeat(64),SMTP_HOST:'smtp.invalid',SMTP_FROM:'noreply@example.invalid',EMAIL_CODE_SECRET:'a'.repeat(64),WEB_SESSION_SECRET:'b'.repeat(64),WEB_LINK_SECRET:'c'.repeat(64),WEB_ORIGIN:'https://example.invalid'};
const result=spawnSync('docker',['compose','--env-file','.env.example','-f','compose.production.yaml','config','--format','json'],{env,encoding:'utf8'});
try{
  assert.equal(result.status,0);const config=JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(config.services).toSorted(),['app','db','proxy']);
  for(const [name,service] of Object.entries(config.services)){if(name!=='proxy')assert.ok(!service.ports?.length);assert.ok(!service.build);assert.ok(service.mem_limit);assert.equal(service.logging.driver,'none');}
  const app=config.services.app;RuntimeEnvironmentV2.parse(app.environment);
  assert.equal(app.environment.TRUSTED_PROXY_IPS,'172.30.23.2');
  assert.ok(!Object.keys(app.environment).some(key=>/SUPABASE|GIGACHAT|VITE/.test(key)));
  assert.equal(config.services.proxy.ports.length,2);
  console.log('OK compose: app+db+proxy; only 80/443 published; current env valid. Not load-tested or deployed.');
}catch{console.error('BLOCKED compose validation; raw configuration suppressed');process.exitCode=1;}
