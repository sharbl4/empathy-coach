export interface BotConfig {token:string;production:boolean;deliveryIntervalMs:number}

export class ConfigError extends Error {}

export function loadConfig(env:NodeJS.ProcessEnv=process.env):BotConfig {
  const token=env.TELEGRAM_BOT_TOKEN?.trim();
  if(!token)throw new ConfigError('TELEGRAM_BOT_TOKEN is empty');
  if(!/^\d+:[\w-]{30,}$/.test(token))throw new ConfigError('TELEGRAM_BOT_TOKEN has invalid format');
  const interval=Number(env.BOT_DELIVERY_INTERVAL_MS??1500);
  if(!Number.isInteger(interval)||interval<200||interval>60000)throw new ConfigError('BOT_DELIVERY_INTERVAL_MS must be 200..60000');
  return {token,production:env.NODE_ENV==='production',deliveryIntervalMs:interval};
}
