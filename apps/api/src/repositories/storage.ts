import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Id, Session, SessionDetail, SessionPage, Me, Progress, type RequestFor, type SessionInput } from '@between/contracts';
import { HttpError, notFound } from '../errors.js';
import {DomainSessionDetail} from '@between/contracts/domain';

type Connection = Pool | PoolClient;
export async function transaction<T>(pool:Pool, work:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try { await client.query('BEGIN'); const result=await work(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const columns=`id,title,situation,guess,revision,created_at AS "createdAt",updated_at AS "updatedAt"`;
// pg serializes JS Date to millisecond precision; cursors separately preserve PostgreSQL microseconds.
function session(row:Record<string,unknown>) {
  return Session.parse({...row,createdAt:(row.createdAt as Date).toISOString(),updatedAt:(row.updatedAt as Date).toISOString()});
}
export class Storage {
  constructor(readonly pool:Pool) {}
  private within<T>(client:PoolClient|undefined,work:(client:PoolClient)=>Promise<T>){return client?work(client):transaction(this.pool,work);}
  async profile(userId:string, patch?:RequestFor<'updateMe'>) {
    const result=await this.pool.query(`INSERT INTO app.profiles(id,display_name,onboarding_completed_at)
      VALUES($1,COALESCE($2,'Пользователь'),CASE WHEN $3 THEN now() END)
      ON CONFLICT(id) DO UPDATE SET display_name=COALESCE($2,app.profiles.display_name),
      onboarding_completed_at=CASE WHEN $3 THEN COALESCE(app.profiles.onboarding_completed_at,now()) ELSE app.profiles.onboarding_completed_at END
      RETURNING id,display_name,onboarding_completed_at`,[userId,patch?.displayName,patch?.onboardingCompleted??false]);
    const row=result.rows[0];
    return Me.parse({id:row.id,displayName:row.display_name,onboardingCompletedAt:row.onboarding_completed_at?.toISOString()??null,
      aiMode:'gigachat',capabilities:{analysis:true,reply:true,exercise:true,roleplay:true}});
  }
  async create(userId:string,input:SessionInput,existing?:PoolClient) {
    return this.within(existing,async client=>{
      await client.query('INSERT INTO app.profiles(id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
      // Profile row is also the per-owner lock for bulk deletion and AI completion.
      await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
      const result=await client.query(`INSERT INTO app.sessions(id,user_id,title,situation,guess) VALUES($1,$2,$3,$4,$5) RETURNING ${columns}`,
        [randomUUID(),userId,input.title,input.situation,input.guess]);
      return session(result.rows[0]);
    });
  }
  async list(userId:string,query:{cursor?:string;limit:number;q?:string},existing?:PoolClient) {
    let timestamp:string|null=null,id:string|null=null;
    if(query.cursor) {
      try {
        const decoded:unknown=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
        if(!Array.isArray(decoded)||decoded.length!==2||typeof decoded[0]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(decoded[0])||!Number.isFinite(Date.parse(decoded[0]))) throw new Error();
        timestamp=decoded[0]; id=Id.parse(decoded[1]);
      } catch { throw new HttpError(400,'VALIDATION_ERROR','Некорректный cursor'); }
    }
    const result=await (existing??this.pool).query(`SELECT ${columns},to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM app.sessions WHERE user_id=$1 AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::uuid))
      AND ($4::text IS NULL OR strpos(lower(title),lower($4))>0)
      ORDER BY updated_at DESC,id DESC LIMIT $5`,[userId,timestamp,id,query.q??null,query.limit+1]);
    const rows=result.rows.slice(0,query.limit),last=rows.at(-1);
    return SessionPage.parse({items:rows.map(({cursor_time: _cursor,...row})=>{void _cursor;return session(row);}),
      nextCursor:result.rows.length>query.limit?Buffer.from(JSON.stringify([last.cursor_time,last.id])).toString('base64url'):null});
  }
  async owned(client:Connection,userId:string,id:string,lock=false) {
    const result=await client.query(`SELECT ${columns} FROM app.sessions WHERE id=$1 AND user_id=$2${lock?' FOR UPDATE':''}`,[id,userId]);
    if(!result.rows[0]) throw notFound();
    return session(result.rows[0]);
  }
  async detail(userId:string,id:string,existing?:PoolClient) {return SessionDetail.parse(await this.domainDetail(userId,id,existing));}
  async domainDetail(userId:string,id:string,existing?:PoolClient) {
    return this.within(existing,async client=>{
      if(!existing)await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const value=await this.owned(client,userId,id);
      const runs=await client.query(`SELECT id,session_id AS "sessionId",revision,kind,status,output,error_code AS "errorCode",created_at AS "createdAt",updated_at AS "updatedAt"
        FROM app.ai_runs WHERE session_id=$1 AND user_id=$2 AND revision=$3 ORDER BY created_at DESC,id DESC LIMIT 1000`,[id,userId,value.revision]);
      const roles=await client.query(`SELECT r.id,r.session_id AS "sessionId",r.revision,r.status,r.turn_count AS "turnCount",r.feedback,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'sequence',m.sequence,'role',m.role,'content',m.content) ORDER BY m.sequence)
          FROM app.roleplay_messages m WHERE m.roleplay_id=r.id),'[]'::jsonb) AS messages
        FROM app.roleplays r WHERE session_id=$1 AND user_id=$2 AND revision=$3 ORDER BY created_at DESC,id DESC LIMIT 100`,[id,userId,value.revision]);
      return DomainSessionDetail.parse({...value,runs:runs.rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()})),roleplays:roles.rows});
    });
  }
  async assertIdle(client:PoolClient,id:string) {
    if((await client.query("SELECT 1 FROM app.ai_runs WHERE session_id=$1 AND status='pending'",[id])).rowCount) throw new HttpError(409,'OPERATION_IN_PROGRESS','Дождитесь завершения операции');
  }
  async update(userId:string,id:string,input:RequestFor<'updateSession'>,existing?:PoolClient) {
    return this.within(existing,async client=>{
      const current=await this.owned(client,userId,id,true);
      if(current.revision!==input.expectedRevision) throw new HttpError(409,'REVISION_CONFLICT','Ситуация изменена в другой вкладке');
      await this.assertIdle(client,id);
      const result=await client.query(`UPDATE app.sessions SET title=$3,situation=$4,guess=$5,
        revision=revision+CASE WHEN (title,situation,guess) IS DISTINCT FROM ($3,$4::jsonb,$5::jsonb) THEN 1 ELSE 0 END,
        updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 RETURNING ${columns}`,[id,userId,input.title,input.situation,input.guess]);
      return session(result.rows[0]);
    });
  }
  async remove(userId:string,id:string,existing?:PoolClient) {
    await this.within(existing,async client=>{
      await this.owned(client,userId,id,true); await this.assertIdle(client,id);
      await client.query('DELETE FROM app.sessions WHERE id=$1 AND user_id=$2',[id,userId]);
    });
  }
  async clear(userId:string,onDeleted?:(runIds:string[])=>void,existing?:PoolClient) {
    const ids=await this.within(existing,async client=>{
      await client.query('SELECT id FROM app.profiles WHERE id=$1 FOR UPDATE',[userId]);
      const runs=await client.query<{id:string}>('SELECT id FROM app.ai_runs WHERE user_id=$1',[userId]);
      await client.query('DELETE FROM app.sessions WHERE user_id=$1',[userId]);
      return runs.rows.map(row=>row.id);
    });
    onDeleted?.(ids);
  }
  async progress(userId:string,existing?:PoolClient) {
    return this.within(existing,async client=>{
      if(!existing)await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const counts=(await client.query(`SELECT count(DISTINCT session_id) FILTER(WHERE kind='analysis')::int AS "analyzedSessions",
        count(*) FILTER(WHERE kind='exercise')::int AS "completedExercises",count(*) FILTER(WHERE kind='roleplay')::int AS "completedRoleplays"
        FROM app.practice_events WHERE user_id=$1`,[userId])).rows[0];
      const skills=await client.query('SELECT skill,count(*)::int AS count FROM app.practice_events WHERE user_id=$1 GROUP BY skill ORDER BY count DESC,skill LIMIT 100',[userId]);
      const latest=(await client.query(`SELECT CASE WHEN kind='analysis' THEN output->>'skillTip' ELSE output->>'nextPractice' END AS tip
        FROM app.ai_runs WHERE user_id=$1 AND status='succeeded' AND (kind='analysis' OR (kind IN ('roleplay_turn','roleplay_feedback') AND output->>'kind'='feedback')) ORDER BY updated_at DESC,id DESC LIMIT 1`,[userId])).rows[0];
      return Progress.parse({...counts,skills:skills.rows,latestTip:latest?.tip??null});
    });
  }
}
