import type {CreateHttpAdapter} from '@between/contracts/product';
import {buildHttpAdapter} from './adapter.js';
export const createHttpAdapter:CreateHttpAdapter=options=>buildHttpAdapter(options);
export type {CreateHttpAdapter,HttpAdapter} from '@between/contracts/product';
