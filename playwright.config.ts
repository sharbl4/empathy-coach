import {defineConfig} from '@playwright/test';
// Never load root .env or reuse a real user's running server.
export default defineConfig({testDir:'./e2e',testIgnore:'**/archive/**',workers:1,use:{baseURL:'http://127.0.0.1:3011',trace:'off',screenshot:'off',video:'off'},webServer:{command:'node --import tsx scripts/browser-test-server.mjs',url:'http://127.0.0.1:3011/api/health/live',reuseExistingServer:false,env:{NODE_ENV:'test'},timeout:30000},reporter:'./scripts/safe-playwright-reporter.mjs'});
