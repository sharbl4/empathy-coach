import type {BotConfig} from './config.js';
import type {BotDomain} from './domain.js';

/**
 * Integration point with the domain facade from @between/api (Anton/Dima).
 * Not available yet: the bot refuses to start instead of falling back to fixtures.
 */
export async function loadDomain(config:BotConfig):Promise<{domain:BotDomain;close:()=>Promise<void>}> {
  void config;
  throw new Error('Domain facade @between/api is not integrated yet');
}
