import type {PoolClient} from 'pg';
import {DialogueV2,AssessmentForm,DIALOGUE_TTL_SECONDS,DIALOGUE_MAX_LIFETIME_SECONDS,type OperationInput,type UserContext} from '@between/contracts/product';
import {Store,fail,type AccountRow} from './core.js';
import {cards} from './catalogue.js';
import type {Snapshot} from './model.js';
import {maskAll} from './redaction.js';
type Dialogue=ReturnType<typeof DialogueV2.parse>;
export class Dialogues {
  constructor(readonly store:Store,readonly references:(c:PoolClient,user:string,input:OperationInput<'updateDialogue'>)=>Promise<void>){}
  blank(revision:number,step:'menu'|'onboarding'='menu'):Dialogue{const now=this.store.now();return DialogueV2.parse({revision,step,draft:{},navigation:{kind:'none'},sessionId:null,previewId:null,roleplayId:null,pendingRunId:null,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+DIALOGUE_TTL_SECONDS*1000).toISOString()});}
  async save(c:PoolClient,user:string,value:Dialogue){await c.query('INSERT INTO app.product_dialogues(user_id,value,expires_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET value=$2,expires_at=$3',[user,DialogueV2.parse(value),value.expiresAt]);return value;}
  async forget(c:PoolClient,user:string){await c.query("UPDATE app.domain_intents SET result=NULL,error_code='REVISION_CONFLICT',state='failed' WHERE user_id=$1 AND operation IN ('v2.updateDialogue','v2.resetDialogue') AND result IS NOT NULL",[user]);}
  async read(c:PoolClient,row:AccountRow){const db=(await c.query('SELECT value,expires_at FROM app.product_dialogues WHERE user_id=$1',[row.id])).rows[0];if(db){const parsed=DialogueV2.safeParse(db.value);if(parsed.success&&db.expires_at.getTime()>this.store.now()&&Date.parse(parsed.data.expiresAt)>this.store.now())return parsed.data;await this.forget(c,row.id);}
    return this.save(c,row.id,this.blank(db?Number(db.value.revision)+1:1,row.consent_version==='web-telegram-2'?'menu':'onboarding'));
  }
  ensure(ctx:UserContext){return this.store.read(ctx,false,(c,row)=>this.read(c,row));}
  next(prior:Dialogue,changes:Partial<Dialogue>){return DialogueV2.parse({...prior,...changes,revision:prior.revision+1,expiresAt:new Date(Math.min(this.store.now()+DIALOGUE_TTL_SECONDS*1000,Date.parse(prior.createdAt)+DIALOGUE_MAX_LIFETIME_SECONDS*1000)).toISOString()});}
  async shown(c:PoolClient,row:string,p:Snapshot){const db=(await c.query('SELECT value,expires_at FROM app.product_dialogues WHERE user_id=$1',[row])).rows[0];if(!db||db.expires_at.getTime()<=this.store.now())fail('PREVIEW_STALE');const state=DialogueV2.parse(db.value),nav=state.navigation;if((nav.kind!=='preview'&&nav.kind!=='preview_field')||nav.previewId!==p.id||nav.previewRevision!==p.revision||nav.snapshotHash!==p.snapshotHash)fail('PREVIEW_STALE');return nav;}
  async patch(ctx:UserContext,input:OperationInput<'updateDialogue'>,key:string){await this.ensure(ctx);return this.store.write(ctx,'updateDialogue',input,key,async(c,row,r)=>{
    const prior=await this.read(c,row);if(prior.revision!==r.expectedRevision)fail('REVISION_CONFLICT');if(!['onboarding','email','email_code','menu'].includes(r.step)){if(row.consent_version!=='web-telegram-2')fail('CONSENT_REQUIRED');if(!row.email_verified_at)fail('EMAIL_NOT_VERIFIED');}
    await this.references(c,row.id,r);const nav=r.navigation;
    if(nav.kind==='preview'||nav.kind==='preview_field'){
      const db=(await c.query('SELECT value,session_id FROM app.product_previews WHERE id=$1 AND user_id=$2',[nav.previewId,row.id])).rows[0];if(!db)fail('NOT_FOUND');if(db.session_id!==r.sessionId)fail('VALIDATION_ERROR');if(db.value.revision!==nav.previewRevision||db.value.snapshotHash!==nav.snapshotHash)fail('PREVIEW_STALE');if(nav.kind==='preview_field'&&!db.value.fields.some((f:{id:string;editable:boolean})=>f.id===nav.fieldId&&f.editable))fail('VALIDATION_ERROR');
    }else if(nav.kind==='card'){const card=cards.find(c=>c.id===nav.cardId);if(!card)fail('NOT_FOUND');if(card.contentVersion!==nav.contentVersion)fail('REVISION_CONFLICT');}
    else if(nav.kind==='assessment'){
      const db=(await c.query('SELECT value,result FROM app.product_assessments WHERE id=$1 AND user_id=$2 FOR UPDATE',[nav.assessmentId,row.id])).rows[0];if(!db)fail('NOT_FOUND');const form=AssessmentForm.parse(db.value);if(form.contentVersion!==nav.contentVersion||form.kind!==nav.assessmentKind||db.result)fail('REVISION_CONFLICT');
      if(nav.answers.length>form.tasks.length||nav.answers.some((answer,index)=>answer.questionId!==form.tasks[index].id||!form.tasks[index].choices.some(c=>c.id===answer.choiceId)))fail('VALIDATION_ERROR');
    }
    return {value:await this.save(c,row.id,this.next(prior,{step:r.step,draft:maskAll(r.draft),navigation:nav,sessionId:r.sessionId,previewId:r.previewId,roleplayId:r.roleplayId,pendingRunId:null}))};
  });}
  async reset(ctx:UserContext,input:OperationInput<'resetDialogue'>,key:string){await this.ensure(ctx);return this.store.write(ctx,'resetDialogue',input,key,async(c,row,r)=>{const current=await this.read(c,row);if(current.revision!==r.expectedRevision)fail('REVISION_CONFLICT');await this.forget(c,row.id);return {value:await this.save(c,row.id,this.blank(current.revision+1))};});}
}
