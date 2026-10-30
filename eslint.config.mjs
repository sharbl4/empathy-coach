import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ignores:['**/dist/**','**/node_modules/**','.tools/**','playwright-report/**','test-results/**']},js.configs.recommended,...ts.configs.recommended,{files:['**/*.mjs'],languageOptions:{globals:{process:'readonly',console:'readonly',URL:'readonly'}}});
