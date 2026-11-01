import type {z} from 'zod';
import type {ContextType,StageEvent} from '@between/contracts/product';
import {api,newKey} from './api';

/** Allowlisted stage event without any text. Best effort: a failed analytics write never blocks the user. */
export function recordStage(name:z.infer<typeof StageEvent>['name'],extra:{contextType?:z.infer<typeof ContextType>;resourceId?:string}={}) {
  void api('recordStage',{name,...extra},{key:newKey()}).catch(()=>{});
}
