import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import ts from 'typescript';
/** Follow actual import/re-export edges, including dynamic imports, before bundling. */
export function assertPublicContractGraph(root='packages/contracts/src'){
  const seen=new Set();
  function visit(file){
    file=resolve(file);if(seen.has(file))return;seen.add(file);
    if(basename(file)==='runtime.ts')throw new Error('Public contract imports server runtime');
    const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function edge(specifier){
      if(specifier.includes('/runtime')||specifier.startsWith('node:'))throw new Error('Public contract imports server module');
      if(specifier.startsWith('.')){const target=resolve(dirname(file),specifier.replace(/\.js$/,'.ts'));if(!existsSync(target))throw new Error('Contract import target missing');visit(target);}
    }
    function scan(node){
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))edge(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))edge(node.arguments[0].text);
      ts.forEachChild(node,scan);
    }
    scan(tree);
  }
  visit(resolve(root,'product.ts'));visit(resolve(root,'http.ts'));return [...seen];
}
