// Integration entry only. Dima owns the facade implementation (issue #15).
// Importing @between/api must never start a server or import legacy Auth/inference.
import type {CreateDomain} from '@between/contracts/domain';
import {createDomain as implementation} from './domain/facade.js';
export const createDomain:CreateDomain=implementation;
export type {CreateDomain,DomainFacade,DomainOptions,UserContext} from '@between/contracts/domain';
