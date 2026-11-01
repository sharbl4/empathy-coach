import {test,expect} from '@playwright/test';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(root,entry.name)):[join(root,entry.name)]);}
test('production registration renders and never selects dev fixture Auth',async({page})=>{
  await page.goto('/auth/signup');
  await expect(page.getByRole('heading',{name:'Регистрация',exact:true})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Пароль',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Повторите пароль',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Зарегистрироваться',exact:true})).toBeVisible();
  await expect(page.getByText('DEV · фикстуры',{exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Регистрация',exact:true})).toBeVisible();
});
test('release artifacts exclude fixture adapters even when a fixture flag is supplied',()=>{
  const artifacts=files('apps/web/dist').filter(path=>path.endsWith('.js')).map(path=>readFileSync(path,'utf8'));
  for(const marker of ['dev-fixture-token','createFixtureAuth','createFixtureTransport','[dev:fail]'])expect(artifacts.some(text=>text.includes(marker))).toBe(false);
});
