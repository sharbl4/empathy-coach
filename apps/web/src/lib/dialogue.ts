import type {z} from 'zod';
import {ComposerDraft,type DialogueNavigation,type DialogueV2} from '@between/contracts/product';
import {api,newKey} from './api';

export type Dialogue=z.infer<typeof DialogueV2>;
export type Draft=z.infer<typeof ComposerDraft>;
type Nav=z.infer<typeof DialogueNavigation>;

/**
 * The single shared dialogue (same as the bot). Writes carry expectedRevision; REVISION_CONFLICT is surfaced to the
 * caller, never resolved by silently overwriting. Personal text is stored only server-side, never in localStorage.
 */
export function saveDialogue(current:Dialogue,patch:{step:Dialogue['step'];draft?:Draft;navigation?:Nav;sessionId?:string|null;previewId?:string|null;roleplayId?:string|null}) {
  return api('updateDialogue',{expectedRevision:current.revision,step:patch.step,draft:patch.draft??{},navigation:patch.navigation??{kind:'none'},
    sessionId:patch.sessionId??null,previewId:patch.previewId??null,roleplayId:patch.roleplayId??null},{key:newKey()});
}
/** Keeps only fields that pass the shared schema (empty inputs are simply not saved yet). */
export function cleanDraft(raw:Record<string,unknown>):Draft|null {
  const draft=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!==undefined&&v!==''&&!(Array.isArray(v)&&v.length===0)));
  const parsed=ComposerDraft.safeParse(draft);
  return parsed.success?parsed.data:null;
}
