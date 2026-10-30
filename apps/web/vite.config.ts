import { defineConfig } from 'vite';
export default defineConfig({envDir:'../..',server:{proxy:{'/api':'http://127.0.0.1:3000'}}});
