import type {Pool} from 'pg';
import {transaction} from '../repositories/storage.js';
/** Bounded removal of temporary data. Persistent educational history is never TTL-deleted. */
export async function cleanTemporary(pool:Pool,now:number){
  await transaction(pool,async client=>{
    await client.query(`UPDATE app.dialogues SET revision=revision+1,stage='menu',draft='{}',session_id=NULL,roleplay_id=NULL,pending_run_id=NULL,expires_at=$2
      WHERE user_id IN (SELECT user_id FROM app.dialogues WHERE expires_at<=$1 LIMIT 100 FOR UPDATE SKIP LOCKED)`,[new Date(now),new Date(now+3600000)]);
    await client.query(`UPDATE app.domain_intents SET result=NULL,state='failed',error_code='NOT_FOUND'
      WHERE ctid IN (SELECT ctid FROM app.domain_intents WHERE operation LIKE 'dialogue.%' AND result IS NOT NULL AND created_at<$1 LIMIT 500)`,[new Date(now-3600000)]);
    await client.query(`UPDATE app.email_challenges SET state='invalidated',code_hmac='',email=''
      WHERE id IN (SELECT id FROM app.email_challenges WHERE expires_at<=$1 AND (code_hmac<>'' OR email<>'') LIMIT 100 FOR UPDATE SKIP LOCKED)`,[new Date(now)]);
    await client.query('DELETE FROM app.email_rate_events WHERE ctid IN (SELECT ctid FROM app.email_rate_events WHERE created_at<$1 LIMIT 500)',[new Date(now-86400000)]);
    await client.query("DELETE FROM app.telegram_inbox WHERE ctid IN (SELECT ctid FROM app.telegram_inbox WHERE status='completed' AND completed_at<$1 LIMIT 500)",[new Date(now-7*86400000)]);
    // Keep terminal delivery tombstones while their run exists; otherwise restart
    // reconciliation could enqueue an already delivered result again.
  });
}
