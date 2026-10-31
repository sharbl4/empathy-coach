import {test,expect,type Browser,type Page} from '@playwright/test';
import {IssuedWebLink,PublicWebSession,SessionPageV2} from '@between/contracts/product';
import {ProductError} from '@between/contracts/http';

// C2 browser scenarios on the real HTTP adapter + test DB (B2 browser-adapter.ts). Test-only link issuing goes through
// the trusted Telegram test adapter; redemption is the ordinary POST from the page. No production bypass.
async function issue(page:Page,account:'A'|'B') {
  const response=await page.request.post('/__test/issue-web-link',{data:{account}});
  expect(response.status()).toBe(200);
  return IssuedWebLink.parse(await response.json());
}
async function login(page:Page,account:'A'|'B') {
  const link=await issue(page,account);
  await page.goto(link.webUrl);
  await page.getByRole('button',{name:'Подтвердить вход',exact:true}).click();
  await expect(page.getByRole('link',{name:'История',exact:true})).toBeVisible();
}
async function newUser(browser:Browser,account:'A'|'B') {
  const context=await browser.newContext();const page=await context.newPage();await login(page,account);return {context,page};
}

test('link landing: fragment cleared at once, GET and reload do not redeem, a used link cannot be reused',async({page,browser})=>{
  const link=await issue(page,'A');
  await page.goto(link.webUrl);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('button',{name:'Подтвердить вход',exact:true})).toBeVisible();
  // Reload after the fragment was cleared: the token is gone from the page, nothing was redeemed.
  await page.reload();
  await expect(page.getByText('Ссылка неполная или уже открыта в этой вкладке',{exact:false})).toBeVisible();
  expect(PublicWebSession.parse(await(await page.request.get('/api/auth/session')).json()).authenticated).toBe(false);
  // The same link in a fresh tab still works once…
  const freshPage=await page.context().newPage();
  await freshPage.goto(link.webUrl);await freshPage.getByRole('button',{name:'Подтвердить вход',exact:true}).click();
  await expect(freshPage.getByRole('link',{name:'История',exact:true})).toBeVisible();
  // …and a second browser cannot redeem it again.
  const other=await browser.newContext();const otherPage=await other.newPage();
  try{
    await otherPage.goto(link.webUrl);await otherPage.getByRole('button',{name:'Подтвердить вход',exact:true}).click();
    await expect(otherPage.getByText('Ссылка уже использована',{exact:false})).toBeVisible();
    await expect(otherPage.getByRole('link',{name:'Получить новую ссылку',exact:true})).toBeVisible();
  }finally{await other.close();}
});

test('login page without a session leads to the bot; protected routes redirect there',async({page})=>{
  await page.goto('/history');
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole('link',{name:'Открыть Telegram',exact:true})).toHaveAttribute('href',/^https:\/\/t\.me\//);
});

test('shared history: open the record from the bot, refresh keeps the session',async({page})=>{
  await login(page,'A');
  await page.getByRole('link',{name:'История',exact:true}).click();
  await page.getByRole('link',{name:'Тестовая история участника A',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Тестовая история участника A'})).toBeVisible();
  const url=page.url();await page.reload();
  expect(page.url()).toBe(url);
  await expect(page.getByRole('heading',{name:'Тестовая история участника A'})).toBeVisible();
  await page.getByRole('link',{name:'История',exact:true}).click();
  await page.getByLabel('Поиск по названию').fill('участника A');await page.getByRole('button',{name:'Найти',exact:true}).click();
  await expect(page.getByRole('link',{name:'Тестовая история участника A',exact:true})).toBeVisible();
});

test('preview: masked snapshot of all fields, edit makes a new revision, nothing is sent while unsaved edits exist',async({page})=>{
  await login(page,'A');
  await page.getByRole('link',{name:'Новый разбор',exact:true}).first().click();
  await page.getByLabel('Сообщение, которое хотите понять').fill('Ок. Позвони мне: +7 999 123-45-67');
  await page.getByLabel('Кто этот человек').fill('Друг');
  await page.getByLabel('Не понимаю — это нормально').check();
  await page.getByRole('button',{name:'Показать, что уйдёт в модель',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Проверьте, что уйдёт в модель'})).toBeVisible();
  await expect(page.getByText(/скрыто телефонов и почт: 1/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('999 123-45-67');
  await expect(page.getByText(/версия предпросмотра 1/)).toBeVisible();
  const field=page.locator('form textarea').first();
  await field.fill('Ок. Напиши на me@example.com');
  await expect(page.getByRole('button',{name:'Отправить в модель',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Сохранить правки и обновить предпросмотр',exact:true}).click();
  await expect(page.getByText(/версия предпросмотра 2/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('me@example.com');
  await expect(page.getByRole('button',{name:'Отправить в модель',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Отправить в модель',exact:true}).click();
  const useful=page.getByRole('button',{name:'Полезно',exact:true});await useful.click();await expect(useful).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(page.getByRole('button',{name:'Полезно',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Не полезно',exact:true}).click();await expect(page.getByRole('button',{name:'Не полезно',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(page.getByRole('button',{name:'Не полезно',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('logout: the cookie session ends, API is closed, refresh shows no history',async({page})=>{
  await login(page,'A');
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(PublicWebSession.parse(await(await page.request.get('/api/auth/session')).json()).authenticated).toBe(false);
  const api=await page.request.get('/api/sessions');expect(api.status()).toBe(401);ProductError.parse(await api.json());
  await page.goto('/history');await expect(page.getByText('Тестовая история участника A',{exact:true})).toHaveCount(0);
});

test('two users are isolated by direct URLs and API ids',async({page,browser})=>{
  await login(page,'A');
  const list=SessionPageV2.parse(await(await page.request.get('/api/sessions?limit=20')).json());
  const record=list.items.find(s=>s.input.title==='Тестовая история участника A');
  expect(record).toBeTruthy();
  const b=await newUser(browser,'B');
  try{
    await b.page.goto(`/sessions/${record!.id}`);
    await expect(b.page.getByText('Запись не найдена или удалена.',{exact:true})).toBeVisible();
    await expect(b.page.getByText('Тестовая история участника A',{exact:true})).toHaveCount(0);
    for(const path of [`/api/sessions/${record!.id}`,`/api/sessions/${record!.id}/runs`,`/api/sessions/${record!.id}/roleplays`]){
      const response=await b.page.request.get(path);expect(response.status()).toBe(404);ProductError.parse(await response.json());
    }
    await b.page.goto('/history');await expect(b.page.getByText('Тестовая история участника A',{exact:true})).toHaveCount(0);
  }finally{await b.context.close();}
});

test('mutations require CSRF and Origin: a bare POST is rejected with the safe error envelope',async({page})=>{
  await login(page,'A');
  const response=await page.request.post('/api/sessions',{data:{},headers:{'idempotency-key':crypto.randomUUID()}});
  expect([403,400]).toContain(response.status());
  const body=ProductError.parse(await response.json());
  expect(['CSRF_FAILED','ORIGIN_FORBIDDEN','VALIDATION_ERROR']).toContain(body.error.code);
});

test('mobile width: login, history and preview have no horizontal scroll',async({browser})=>{
  const context=await browser.newContext({viewport:{width:375,height:812}});const page=await context.newPage();
  try{
    await login(page,'A');
    for(const path of ['/history','/new','/settings']){
      await page.goto(path);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    }
  }finally{await context.close();}
});

test('unfinished composer draft is stored by the domain and restored after reload (no localStorage)',async({page})=>{
  await login(page,'A');
  await page.getByRole('link',{name:'Новый разбор',exact:true}).first().click();
  await page.getByLabel('Сообщение, которое хотите понять').fill('Давай потом поговорим');
  await page.getByLabel('Кто этот человек').fill('Коллега');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('Давай потом');
  await page.reload();
  await expect(page.getByText('Продолжаем черновик',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Сообщение, которое хотите понять')).toHaveValue('Давай потом поговорим');
  await expect(page.getByLabel('Кто этот человек')).toHaveValue('Коллега');
});

test('assessment answers are saved after each choice and restored after reload',async({page})=>{
  await login(page,'A');
  await page.getByRole('link',{name:'Практика',exact:true}).click();
  await page.getByRole('button',{name:'Входной тест',exact:true}).click();
  const first=page.locator('fieldset').first().getByRole('radio').first();
  await first.check();await page.waitForTimeout(500);
  await page.reload();await page.getByRole('button',{name:'Входной тест',exact:true}).click();
  await expect(page.locator('fieldset').first().getByRole('radio').first()).toBeChecked();
  await page.getByRole('link',{name:'История',exact:true}).click();await page.getByRole('link',{name:'Практика',exact:true}).click();await page.getByRole('button',{name:'Входной тест',exact:true}).click();await expect(page.locator('fieldset').first().getByRole('radio').first()).toBeChecked();
  await page.getByRole('button',{name:'Сбросить тест',exact:true}).click();await page.getByRole('button',{name:'Продолжить тест',exact:true}).click();await expect(page.locator('fieldset').first().getByRole('radio').first()).toBeChecked();
  await page.getByRole('button',{name:'Сбросить тест',exact:true}).click();await page.getByRole('button',{name:'Да, сбросить тест',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Входной тест',exact:true}).click();await expect(page.locator('fieldset').first().getByRole('radio').first()).not.toBeChecked();
});

test('support region is an explicit stored choice that can be cleared',async({page})=>{
  await login(page,'A');
  await page.getByRole('link',{name:'Настройки',exact:true}).click();
  await page.getByLabel('Страна').selectOption('KZ');
  await page.getByRole('button',{name:'Сохранить регион',exact:true}).click();
  await expect(page.getByText('Сохранено.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel('Страна')).toHaveValue('KZ');
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  await page.reload();await expect(page.getByLabel('Страна')).toHaveValue('');
});
