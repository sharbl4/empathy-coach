import { api, outputs, Run, Session, SessionInput, SessionPage, Progress, ApiError, Roleplay, type SessionInput as Input } from './index.js';
export const id='11111111-1111-4111-8111-111111111111';
export const timestamp='2026-10-30T06:00:00.000Z';
export const situations: Input[] = [
  {title:'Встреча',situation:{message:'Давай поговорим завтра.',relationship:'Коллега',context:'Обсуждали встречу',goal:'clarify'},guess:{emotions:[],evidenceQuotes:['завтра'],unsure:true}},
  {title:'Поддержка',situation:{message:'Сегодня очень устал.',relationship:'Друг',context:'После работы',goal:'support'},guess:{emotions:['усталость'],evidenceQuotes:['устал'],unsure:false}},
  {title:'Граница',situation:{message:'Можешь сделать это сегодня?',relationship:'Знакомый',context:'Мой выходной',goal:'boundary'},guess:{emotions:[],evidenceQuotes:[],unsure:true}}
];
const options= ['support','clarify','reconcile','boundary'].map(goal=>({goal,text:'Давай обсудим завтра. Во сколько удобно?',explanation:'Учитывает цель и оставляет пространство для ответа.'}));
export const outputFixtures = {
  analysis:{literalMeaning:'Предлагается поговорить завтра.',interpretations:[{emotion:'Нейтральность',possibleNeed:'Удобное время',explanation:'Возможно, сейчас неудобно.',evidenceQuotes:['завтра']},{emotion:'Усталость',possibleNeed:'Отдых',explanation:'Это лишь одна из гипотез.',evidenceQuotes:[]}],uncertainty:'Без контекста нельзя знать причину.',clarifyingQuestion:'Во сколько завтра удобно?',guessFeedback:'Неопределённость уместна.',skillTip:'Уточняйте время.'},
  reply_feedback:{strengths:['Есть уточнение.'],phraseFeedback:[{quote:'Во сколько?',possibleImpact:'Может звучать кратко.',suggestion:'Добавьте удобство собеседника.'}],revisedReply:'Во сколько завтра тебе удобно?',options},
  reply_examples:options,
  exercise:{instruction:'За 30–60 секунд задайте один уточняющий вопрос.',skill:'Уточнение',exampleHint:'Спросите о времени.'},
  exercise_feedback:{strengths:['Вопрос конкретный.'],improvement:'Оставьте возможность предложить другое время.',suggestedAttempt:'Во сколько тебе удобно?'},
  roleplay_start:{kind:'message',content:'Давай завтра вечером?'},roleplay_turn:{kind:'message',content:'В семь мне удобно.'},roleplay_feedback:{kind:'feedback',strengths:['Вы уточнили время.'],improvements:['Можно сверить договорённость.'],nextPractice:'Кратко подведите итог.'}
};
const base={id,sessionId:id,revision:1,createdAt:timestamp,updatedAt:timestamp};
export const runs=Object.entries(outputFixtures).map(([kind,output])=>({...base,kind,status:'succeeded',output,errorCode:null}));
export const pending={...base,kind:'analysis',status:'pending',output:null,errorCode:null};
export const failed={...base,kind:'analysis',status:'failed',output:null,errorCode:'RUN_INTERRUPTED'};
export const session={...situations[0],id,revision:1,createdAt:timestamp,updatedAt:timestamp};
export const roleplay={id,sessionId:id,revision:1,status:'active',turnCount:0,messages:[{id,sequence:0,role:'assistant',content:'Давай завтра вечером?'}],feedback:null};
export const emptyProgress={analyzedSessions:0,completedExercises:0,completedRoleplays:0,skills:[],latestTip:null};
export const progress={analyzedSessions:1,completedExercises:1,completedRoleplays:1,skills:[{skill:'Уточнение',count:3}],latestTip:'Уточняйте время.'};
export const error={error:{code:'REVISION_CONFLICT',message:'Обновите данные сессии',requestId:'request-1'}};
export const requestFixtures:Record<string,unknown>={updateMe:{displayName:'Антон',onboardingCompleted:true},deleteData:{confirmation:'DELETE_MY_LEARNING_DATA'},createSession:situations[0],updateSession:{...situations[0],expectedRevision:1},analyze:{expectedRevision:1},replyFeedback:{expectedRevision:1,draft:'Во сколько?'},replyExamples:{expectedRevision:1},exercise:{expectedRevision:1},exerciseFeedback:{expectedRevision:1,exerciseRunId:id,answer:'Во сколько тебе удобно?'},roleplayStart:{expectedRevision:1},roleplayTurn:{expectedRevision:1,content:'В семь?'},roleplayFinish:{expectedRevision:1},retry:{expectedRevision:1}};
export const responseFixtures:Record<string,unknown>={live:{status:'ok'},ready:{status:'ok'},me:{id,displayName:'Антон',onboardingCompletedAt:null,aiMode:'gigachat',capabilities:{analysis:true,reply:true,exercise:true,roleplay:true}},deleteData:null,createSession:session,sessions:{items:[session],nextCursor:null},session:{...session,runs:[...runs,pending,failed],roleplays:[roleplay]},updateSession:session,deleteSession:null,run:runs[0],progress};
responseFixtures.updateMe=responseFixtures.me;
for(const key of Object.keys(requestFixtures))if(!(key in responseFixtures))responseFixtures[key]={runId:id,...(key==='roleplayStart'?{resourceId:id}:{})};
export function validateFixtures(){
  situations.forEach(v=>SessionInput.parse(v));
  for(const [kind,schema] of Object.entries(outputs))schema.parse(outputFixtures[kind as keyof typeof outputFixtures]);
  [...runs,pending,failed].forEach(v=>Run.parse(v));
  Session.parse(session);Roleplay.parse(roleplay);ApiError.parse(error);Progress.parse(progress);Progress.parse(emptyProgress);
  SessionPage.parse({items:[],nextCursor:null});
  for(const [key,route] of Object.entries(api)){
    route.response.parse(responseFixtures[key]);
    if('body' in route)route.body.parse(requestFixtures[key]);
  }
}
