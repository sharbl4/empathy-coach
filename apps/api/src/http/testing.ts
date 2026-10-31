import type {CreateHttpAdapter} from '@between/contracts/product';
import {buildHttpAdapter} from './adapter.js';
/** Internal explicit test entry; absent from the package's public exports. */
export function createTestHttpAdapter(options:Parameters<CreateHttpAdapter>[0],issue:(account:'A'|'B')=>Promise<unknown>){if(process.env.NODE_ENV!=='test'||options.port!==3011||!['127.0.0.1','localhost'].includes(options.host))throw new Error('Test HTTP hook rejected');return buildHttpAdapter(options,issue);}
