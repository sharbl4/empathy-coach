import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionInput} from '@between/contracts';
import {evalCases,assessEval} from '../src/ai/evals.js';

test('ten evaluation cases have property expectations and exact-evidence checks',()=>{
  assert.equal(evalCases.length,10);assert.equal(new Set(evalCases.map(x=>x.id)).size,10);
  for(const scenario of evalCases){
    SessionInput.parse(scenario.input);assert.ok(scenario.criteria.length>=3);
    const quote=scenario.input.situation.message.slice(0,3);
    const analysis={literalMeaning:'Сообщение содержит высказывание собеседника.',interpretations:[
      {emotion:'Нейтральность',possibleNeed:'Прояснение',explanation:'Это возможная гипотеза.',evidenceQuotes:[quote]},
      {emotion:'Неопределённость',possibleNeed:'Контекст',explanation:'Без контекста вывод ограничен.',evidenceQuotes:[]}
    ],uncertainty:'Контекста недостаточно.',clarifyingQuestion:'Что ты имеешь в виду?',guessFeedback:'Неуверенность допустима.',skillTip:'Уточняй смысл.'};
    const reply=scenario.draft===undefined?undefined:{strengths:['Есть попытка ответить.'],phraseFeedback:[{quote:scenario.draft.slice(0,3),possibleImpact:'Может повлиять на тон.',suggestion:'Уточни формулировку.'}],revisedReply:'Давай уточним ситуацию.',options:['support','clarify','reconcile','boundary'].map(goal=>({goal,text:'Давай уточним ситуацию.',explanation:'Учебный пример.'}))};
    const result=assessEval(scenario,analysis,reply);assert.equal(result.manualCriteria,scenario.criteria);
    assert.throws(()=>assessEval(scenario,{...analysis,interpretations:analysis.interpretations.map(x=>({...x,evidenceQuotes:['НЕСУЩЕСТВУЮЩАЯ_ЦИТАТА']}))},reply));
  }
});
