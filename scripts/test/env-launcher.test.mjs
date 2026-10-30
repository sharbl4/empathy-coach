import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {rootCertificates} from 'node:tls';
import {spawnSync} from 'node:child_process';
const launcher=resolve('scripts/with-env.mjs');
function cleanup(directory){
  for(const name of ['.env','public-ca.pem','probe.mjs']){const path=join(directory,name);if(existsSync(path))unlinkSync(path);}
  rmdirSync(directory);
}
test('CA from dotenv is active at child TLS startup without disclosing env values',()=>{
  const directory=mkdtempSync(join(tmpdir(),'empathy-env-'));
  try{
    const certificate=join(directory,'public-ca.pem');writeFileSync(certificate,rootCertificates[0]);
    writeFileSync(join(directory,'.env'),`NODE_EXTRA_CA_CERTS="${certificate.replaceAll('\\','/')}"\nPRIVATE_TEST_VALUE=DO_NOT_DISCLOSE\n`);
    const probe=join(directory,'probe.mjs');
    writeFileSync(probe,"import {getCACertificates} from 'node:tls'; if(getCACertificates('extra').length!==1)process.exit(1); console.log('TLS_CA_LOADED');");
    const result=spawnSync(process.execPath,[launcher,probe],{cwd:directory,encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},timeout:10000});
    assert.equal(result.status,0);assert.ok(result.stdout.includes('TLS_CA_LOADED'));assert.ok(!`${result.stdout}${result.stderr}`.includes('DO_NOT_DISCLOSE'));
  }finally{cleanup(directory);}
});
test('launcher refuses TLS bypass before application code runs',()=>{
  const directory=mkdtempSync(join(tmpdir(),'empathy-env-'));
  try{
    writeFileSync(join(directory,'.env'),'NODE_TLS_REJECT_UNAUTHORIZED=0\n');
    const result=spawnSync(process.execPath,[launcher,'missing-app.mjs'],{cwd:directory,encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},timeout:10000});
    assert.equal(result.status,1);assert.ok(result.stderr.includes('TLS verification must remain enabled'));assert.ok(!result.stderr.includes('MODULE_NOT_FOUND'));
  }finally{cleanup(directory);}
});
