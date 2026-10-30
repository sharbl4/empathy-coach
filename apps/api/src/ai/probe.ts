import { configuredProvider } from './gigachat.js';
import { ModelError } from './provider.js';
const required=['GIGACHAT_CREDENTIALS','GIGACHAT_SCOPE','GIGACHAT_MODEL','GIGACHAT_BASE_URL'];
const missing=required.filter(key=>!process.env[key]);
if(missing.length){console.error(`BLOCKED: missing env names: ${missing.join(', ')}`);process.exitCode=1;}
else {
  try {
    const provider=configuredProvider();
    await provider.checkAccess();console.info('OAuth, selected model and positive quota: passed');
    if(process.argv.includes('--analyze')){
      await provider.analyze({title:'Проверка API',situation:{message:'Давай обсудим завтра.',relationship:'Коллега',context:'Выбираем время разговора',goal:'clarify'},guess:{emotions:[],evidenceQuotes:[],unsure:true}},AbortSignal.timeout(30000));
      console.info('One live analysis validated against shared schema and evidence: passed');
    }
  }catch(error){console.error(`BLOCKED: ${error instanceof ModelError?error.code:'API_ACCESS_CHECK_FAILED'}`);process.exitCode=1;}
}
