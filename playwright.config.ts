import {defineConfig} from '@playwright/test';
const requestedChannel=process.env.PLAYWRIGHT_CHANNEL;
if(requestedChannel&&!['chrome','msedge'].includes(requestedChannel))throw new Error('Unsupported local browser channel');
const channel=requestedChannel==='chrome'||requestedChannel==='msedge'?requestedChannel:undefined;
// Never load root .env or reuse a real user's running server.
export default defineConfig({testDir:'./e2e',testIgnore:'**/archive/**',workers:1,use:{baseURL:'http://127.0.0.1:3011',channel,trace:'off',screenshot:'off',video:'off'},webServer:{command:'node --import tsx scripts/browser-test-server.mjs',url:'http://127.0.0.1:3011/api/health/live',reuseExistingServer:false,env:{NODE_ENV:'test'},timeout:30000},reporter:'./scripts/safe-playwright-reporter.mjs'});
