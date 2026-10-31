import {randomUUID,createHash} from 'node:crypto';
import {Preview,MODEL_PROMPT_VERSION,RunV2,type OperationInput,type UserContext} from '@between/contracts/product';
import type {PoolClient} from 'pg';
import {maskText} from './redaction.js';
import {Sessions} from './sessions.js';
import {Store,canonical,fail} from './core.js';
import {budget,type Model,type Snapshot} from './model.js';
export class Previews {
  constructor(readonly store:Store,readonly sessions:Sessions,readonly model:string,readonly provider:Model,readonly card:(id:string,version:string)=>Promise<{text:string}>){}
  hash(p:Snapshot){return createHash('sha256').update(JSON.stringify(canonical({id:p.id,kind:p.kind,sessionId:p.sessionId,sessionRevision:p.sessionRevision,dependencies:p.dependencies,fields:p.fields,turns:p.turns,modelRevision:p.modelRevision,promptVersion:p.promptVersion,templateHash:p.templateHash,budget:p.budget}))).digest('hex');}
  async owned(c:PoolClient,user:string,id:string){const row=(await c.query('SELECT * FROM app.product_previews WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];if(!row)fail('NOT_FOUND');return {row,value:Preview.parse(row.value)};}
  async dependencies(c:PoolClient,user:string,p:Snapshot,runId?:string){
    const info=await this.provider.describe(p.kind);if(!info.known)fail('DEPENDENCY_UNAVAILABLE');if(p.modelRevision!==this.model||p.promptVersion!==MODEL_PROMPT_VERSION||p.templateHash!==info.hash||p.snapshotHash!==this.hash(p))fail('PREVIEW_STALE');
    for(const d of p.dependencies){
      if(d.kind==='session'){const row=(await c.query('SELECT revision FROM app.product_sessions WHERE id=$1 AND user_id=$2',[d.id,user])).rows[0];if(!row||row.revision!==d.revision)fail('PREVIEW_STALE');}
      else if(d.kind==='roleplay'){const row=(await c.query('SELECT value,last_run_id FROM app.product_roles WHERE id=$1 AND user_id=$2',[d.id,user])).rows[0];if(!row||(row.value.revision!==d.revision&&!(runId&&row.last_run_id===runId&&row.value.revision===d.revision+1)))fail('PREVIEW_STALE');}
      else if(d.kind==='run'){const row=(await c.query('SELECT value FROM app.product_runs WHERE id=$1 AND user_id=$2',[d.id,user])).rows[0];if(!row||row.value.revision!==d.revision||row.value.status!=='succeeded')fail('PREVIEW_STALE');}
      else if('contentVersion' in d)await this.card(d.id,d.contentVersion);
    }
  }
  create(ctx:UserContext,input:OperationInput<'createPreview'>,key:string){return this.store.write(ctx,'createPreview',input,key,async(c,row,source)=>{
    const fields:Snapshot['fields']=[],turns:Snapshot['turns']=[],dependencies:Snapshot['dependencies']=[];let redactionCount=0;
    const add=(label:string,value:string,editable=true)=>{const masked=maskText(value);if(masked!==value)redactionCount++;if(masked.length>12000||fields.length>=100)fail('INPUT_TOO_LARGE');const field={id:randomUUID(),label,value:masked,editable};fields.push(field);return field.id;};
    const flatten=(value:unknown,path='')=>{if(Array.isArray(value))value.forEach((item,i)=>flatten(item,`${path}.${i}`));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(k!=='id')flatten(v,path?`${path}.${k}`:k);}else add(path,String(value),!/(^|\.)(mode|contextType|goal|speaker|unsure)$/.test(path));};
    let sessionId:string|null=null,sessionRevision:number|null=null;
    const metadata:Record<string,unknown>={kind:source.kind};
    if('cardId' in source){const card=await this.card(source.cardId,source.contentVersion);metadata.cardId=source.cardId;metadata.contentVersion=source.contentVersion;dependencies.push({kind:'card',id:source.cardId,contentVersion:source.contentVersion});add('card',card.text,false);add('answer',source.answer);}
    else{
      let role:Awaited<ReturnType<Sessions['role']>>|undefined;
      if('roleplayId' in source){role=await this.sessions.role(c,row.id,source.roleplayId,source.expectedRevision);if(role.value.status!=='active')fail('OPERATION_IN_PROGRESS');if(source.kind==='roleplay_feedback'&&role.value.turnCount<1)fail('VALIDATION_ERROR');if(source.kind==='roleplay_turn'&&role.value.turnCount>=3)fail('OPERATION_IN_PROGRESS');metadata.roleplayId=source.roleplayId;dependencies.push({kind:'roleplay',id:role.value.id,revision:role.value.revision});sessionId=role.row.session_id;}
      else sessionId=source.sessionId;
      const session=await this.sessions.owned(c,row.id,sessionId!,role?undefined:source.expectedRevision);sessionRevision=session.revision;dependencies.push({kind:'session',id:session.id,revision:session.revision});flatten(session.input,'session');
      if(session.input.mode==='thread')for(const [i,turn] of session.input.turns.entries()){const field=fields.find(f=>f.label===`session.turns.${i}.text`)!;turns.push({fieldId:field.id,speaker:turn.speaker,order:turns.length});}
      if(['reply_feedback','reply_examples','exercise','exercise_feedback','roleplay_start'].includes(source.kind)){
        const result=(await c.query("SELECT id,value FROM app.product_runs WHERE user_id=$1 AND session_id=$2 AND value->>'kind'='analysis' AND (value->>'revision')::int=$3 AND value->>'status'='succeeded' ORDER BY created_at DESC LIMIT 1",[row.id,session.id,session.revision])).rows[0];if(!result)fail('OPERATION_IN_PROGRESS');dependencies.push({kind:'run',id:result.id,revision:session.revision});
        // Learning uses the stored summary/question/tip, shown in full before confirmation.
        // It does not forward the entire prior response or silently truncate any field.
        for(const name of ['literalMeaning','clarifyingQuestion','skillTip'])add('analysis.'+name,String(result.value.output[name]),false);
      }
      if(source.kind==='reply_feedback')add('draft',source.draft);
      if(source.kind==='exercise_feedback'){
        const exercise=(await c.query('SELECT value FROM app.product_runs WHERE id=$1 AND user_id=$2 AND session_id=$3',[source.exerciseRunId,row.id,session.id])).rows[0];if(!exercise)fail('NOT_FOUND');const run=RunV2.parse(exercise.value);if(run.kind!=='exercise'||run.status!=='succeeded')fail('VALIDATION_ERROR');if(run.revision!==session.revision)fail('REVISION_CONFLICT');dependencies.push({kind:'run',id:run.id,revision:run.revision});metadata.exerciseRunId=run.id;add('exercise',JSON.stringify(run.output),false);add('answer',source.answer);
      }
      if(source.kind==='roleplay_start'){metadata.difficulty=source.difficulty;add('difficulty',source.difficulty,false);}
      if(role){add('difficulty',role.value.difficulty,false);for(const m of role.value.messages){const fieldId=add(`role.${m.sequence}.${m.role}`,m.content,false);if(turns.length>=20)fail('INPUT_TOO_LARGE');turns.push({fieldId,speaker:m.role==='user'?'self':'other',order:turns.length});}if(source.kind==='roleplay_turn'){metadata.turnCount=role.value.turnCount+1;add('nextTurn',String(role.value.turnCount+1),false);const fieldId=add('content',source.content);if(turns.length>=20)fail('INPUT_TOO_LARGE');turns.push({fieldId,speaker:'self',order:turns.length});}}
    }
    const info=await this.provider.describe(source.kind);
    let value=Preview.parse({id:randomUUID(),revision:1,kind:source.kind,sessionId,sessionRevision,dependencies,fields,turns,redactionCount,budget:budget(source.kind,fields,turns,info),modelRevision:this.model,promptVersion:MODEL_PROMPT_VERSION,templateHash:info.hash,snapshotHash:'0'.repeat(64),confirmedAt:null,safety:fields.some(f=>/суицид|самоубий|убью себя|self.harm/i.test(f.value))?'support':'none'});value={...value,snapshotHash:this.hash(value)};
    await c.query('INSERT INTO app.product_previews(id,user_id,session_id,value,source,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[value.id,row.id,sessionId,value,metadata,new Date(this.store.now()),new Date(this.store.now()+3600000)]);return {value};
  },true);}
  async edit(ctx:UserContext,input:OperationInput<'editPreview'>,key:string){await this.sessions.dialogues.ensure(ctx);return this.store.write(ctx,'editPreview',input,key,async(c,row,request)=>{
    const {value:p}=await this.owned(c,row.id,request.id);if(p.revision!==request.expectedRevision)fail('REVISION_CONFLICT');const shown=await this.sessions.dialogues.shown(c,row.id,p);if(shown.kind==='preview_field'&&request.edits.some(e=>e.fieldId!==shown.fieldId))fail('VALIDATION_ERROR');await this.dependencies(c,row.id,p);if(new Set(request.edits.map(e=>e.fieldId)).size!==request.edits.length)fail('VALIDATION_ERROR');
    const fields=p.fields.map(f=>({...f}));let redactions=p.redactionCount;for(const edit of request.edits){const f=fields.find(x=>x.id===edit.fieldId);if(!f||!f.editable)fail('VALIDATION_ERROR');const value=maskText(edit.value);if(value!==edit.value)redactions++;f.value=value;}
    const info=await this.provider.describe(p.kind);
    let value=Preview.parse({...p,revision:p.revision+1,fields,redactionCount:redactions,budget:budget(p.kind,fields,p.turns,info),confirmedAt:null,safety:fields.some(f=>/суицид|самоубий|убью себя|self.harm/i.test(f.value))?'support':'none'});value={...value,snapshotHash:this.hash(value)};
    await c.query('UPDATE app.product_previews SET value=$3,expires_at=$4 WHERE id=$1 AND user_id=$2',[p.id,row.id,value,new Date(this.store.now()+3600000)]);return {value};
  },true);}
  async confirm(ctx:UserContext,input:OperationInput<'confirmPreview'>,key:string){await this.sessions.dialogues.ensure(ctx);return this.store.write(ctx,'confirmPreview',input,key,async(c,row,r)=>{
    const {row:db,value:p}=await this.owned(c,row.id,r.id);if(p.revision!==r.expectedRevision)fail('REVISION_CONFLICT');if(p.snapshotHash!==r.snapshotHash||db.expires_at.getTime()<=this.store.now())fail('PREVIEW_STALE');await this.sessions.dialogues.shown(c,row.id,p);await this.dependencies(c,row.id,p);if(p.budget.fit!=='fits')fail('INPUT_TOO_LARGE');
    const confirmedAt=p.confirmedAt??new Date(this.store.now()).toISOString(),expiresAt=new Date(this.store.now()+600000).toISOString();await c.query('UPDATE app.product_previews SET value=$3,expires_at=$4 WHERE id=$1 AND user_id=$2',[p.id,row.id,{...p,confirmedAt},expiresAt]);return {value:{id:p.id,revision:p.revision,snapshotHash:p.snapshotHash,confirmedAt,expiresAt}};
  },true);}
  async confirmed(c:PoolClient,user:string,input:OperationInput<'startRun'>,retryId?:string){const {row,value:p}=await this.owned(c,user,input.previewId);if(p.revision!==input.previewRevision||p.snapshotHash!==input.snapshotHash||p.sessionRevision!==input.expectedSessionRevision)fail('PREVIEW_STALE');await this.sessions.dialogues.shown(c,user,p);await this.dependencies(c,user,p,retryId);if(!p.confirmedAt)fail('PREVIEW_NOT_CONFIRMED');if(row.expires_at.getTime()<=this.store.now())fail('PREVIEW_STALE');if(p.budget.fit!=='fits')fail('INPUT_TOO_LARGE');return {p,source:row.source as Record<string,unknown>};}
}
