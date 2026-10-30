import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if(existsSync('.env'))loadEnvFile('.env');
export default defineConfig({testDir:'./e2e',use:{baseURL:'http://127.0.0.1:3000'},webServer:{command:'npm start',url:'http://127.0.0.1:3000/api/health/live',reuseExistingServer:false},reporter:'list'});
