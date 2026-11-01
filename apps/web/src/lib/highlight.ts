export interface Mark {start:number;end:number;index:number}
export type Piece={text:string;mark?:Mark};

/**
 * Deterministic highlighting of exact quotes: first occurrence of each quote, ordered by position;
 * overlapping later matches are dropped (the earlier, then longer, wins). Unknown quotes are returned separately.
 */
export function highlight(text:string,quotes:string[]):{pieces:Piece[];missing:number[]} {
  const found:Mark[]=[],missing:number[]=[];
  quotes.forEach((quote,index)=>{const start=quote?text.indexOf(quote):-1;if(start<0)missing.push(index);else found.push({start,end:start+quote.length,index});});
  found.sort((a,b)=>a.start-b.start||b.end-a.end||a.index-b.index);
  const kept:Mark[]=[];
  for(const mark of found){const last=kept.at(-1);if(last&&mark.start<last.end){missing.push(mark.index);continue;}kept.push(mark);}
  const pieces:Piece[]=[];let at=0;
  for(const mark of kept){if(mark.start>at)pieces.push({text:text.slice(at,mark.start)});pieces.push({text:text.slice(mark.start,mark.end),mark});at=mark.end;}
  if(at<text.length)pieces.push({text:text.slice(at)});
  return {pieces,missing:missing.sort((a,b)=>a-b)};
}
