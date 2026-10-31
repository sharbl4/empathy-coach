import type {z} from 'zod';
import type {LearningMode} from '@between/contracts/product';
export const sourceKind=(mode:z.infer<typeof LearningMode>)=>mode==='understand'||mode==='thread'?'analysis' as const:mode;
