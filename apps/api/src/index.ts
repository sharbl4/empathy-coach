// Integration entry only. Dima owns the facade implementation (issue #15).
// Importing @between/api must never start a server or import legacy Auth/inference.
import type {CreateProductDomain} from '@between/contracts/product';
import {createDomain as implementation} from './domain/facade.js';
export const createDomain:CreateProductDomain=implementation;
export type {CreateProductDomain,ProductFacade,ProductOptions,UserContext} from '@between/contracts/product';
