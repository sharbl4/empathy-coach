import {useId,useState,type ReactNode} from 'react';
import {highlight} from '../lib/highlight';

export interface Span {quote:string;label:string;tone?:'good'|'caution'|'risky'|'evidence';detail:ReactNode}

/**
 * Text with numbered marks. Not colour-only: each mark carries its number and text label;
 * details open by click, Enter/Space or tap, never by hover. Text is rendered as React text, never as HTML.
 */
export function Highlighted({text,spans,title}:{text:string;spans:Span[];title:string}) {
  const [open,setOpen]=useState<number|null>(null);
  const id=useId();
  const {pieces,missing}=highlight(text,spans.map(s=>s.quote));
  return (
    <figure className="highlighted">
      <figcaption className="small muted">{title}</figcaption>
      <p className="message">
        {pieces.map((piece,i)=>piece.mark?(
          <button key={i} type="button" className={`mark mark-${spans[piece.mark.index]!.tone??'evidence'}`} aria-expanded={open===piece.mark.index} aria-controls={`${id}-${piece.mark.index}`}
            onClick={()=>setOpen(open===piece.mark!.index?null:piece.mark!.index)}>
            <sup aria-hidden="true">{piece.mark.index+1}</sup>{piece.text}<span className="sr-only"> — {spans[piece.mark.index]!.label}, пояснение {piece.mark.index+1}</span>
          </button>
        ):<span key={i}>{piece.text}</span>)}
      </p>
      {open!==null&&spans[open]&&<div className="mark-detail" id={`${id}-${open}`} role="region" aria-label={`Пояснение ${open+1}`}><p className="small"><strong>{open+1}. {spans[open].label}</strong></p>{spans[open].detail}</div>}
      {missing.length>0&&<p className="small muted">Не найдено в тексте точно (не подсвечено): {missing.map(i=>`${i+1}`).join(', ')}.</p>}
    </figure>
  );
}
