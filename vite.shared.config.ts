import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({envDir:fileURLToPath(new URL('.',import.meta.url)),envPrefix:'VITE_PUBLIC_',server:{host:'127.0.0.1',proxy:{'/api':'http://127.0.0.1:3000'}},build:{sourcemap:false}});
