import {useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {saveDialogue,type Dialogue} from './dialogue';

type Target={step:'card'|'roleplay';sessionId?:string;roleplayId?:string;cardId?:string;contentVersion?:string};
export function useSavedAttempt(target:Target) {
  const [text,setText]=useState(''),[status,setStatus]=useState(''),[ready,setReady]=useState(false);
  const current=useRef<Dialogue|null>(null),edited=useRef(false);
  const key=JSON.stringify(target);
  useEffect(()=>{let active=true;current.current=null;edited.current=false;setReady(false);setText('');setStatus('');
    void api('dialogue',{}).then(d=>{if(!active)return;current.current=d;
      const matches=target.step==='card'?d.navigation.kind==='card'&&d.navigation.cardId===target.cardId:d.step==='roleplay'&&d.roleplayId===target.roleplayId;
      if(matches&&!edited.current)setText(d.draft.draft??'');setReady(true);
    },()=>{if(active)setStatus('Не удалось загрузить сохранённую попытку.');});
    return ()=>{active=false;};
  },[key]);
  useEffect(()=>{if(!ready||!edited.current||!current.current)return;let active=true;
    const timer=window.setTimeout(()=>{const d=current.current;if(!d)return;setStatus('Сохраняем попытку…');
      void saveDialogue(d,{step:target.step,draft:text.trim()?{draft:text}:{},sessionId:target.sessionId??null,roleplayId:target.roleplayId??null,navigation:target.step==='card'?{kind:'card',cardId:target.cardId!,contentVersion:target.contentVersion!}:{kind:'none'}}).then(next=>{current.current=next;if(active)setStatus('Попытка сохранена.');},e=>{if(active)setStatus('Попытка не сохранена: '+errorText(e));});
    },600);return ()=>{active=false;window.clearTimeout(timer);};
  },[text,key,ready]);
  return {text,change:(value:string)=>{edited.current=true;setText(value);setStatus('Изменения ещё не сохранены.');},status};
}
