import {test,expect,type Page} from '@playwright/test';
import {IssuedWebLink,PublicWebSession} from '@between/contracts/product';
import {ProductError} from '@between/contracts/http';
async function login(page:Page,account:'A'|'B'){
  // Explicit test Telegram adapter calls issueWebLink with a domain-issued principal.
  const response=await page.request.post('/__test/issue-web-link',{data:{account}});
  expect(response.status()).toBe(200);
  const link=IssuedWebLink.parse(await response.json());
  expect(new URL(link.webUrl).origin).toBe('http://127.0.0.1:3011');
  expect(new URL(link.webUrl).hash.startsWith('#token=')).toBe(true);
  await page.goto(link.webUrl);
  await expect(page.getByRole('button',{name:'Подтвердить вход',exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const before=PublicWebSession.parse(await(await page.request.get('/api/auth/session')).json());
  expect(before.authenticated).toBe(false); // GET navigation is never a redeem.
  await page.getByRole('button',{name:'Подтвердить вход',exact:true}).click();
  await expect(page.getByRole('link',{name:'История',exact:true})).toBeVisible();
}
test('bot-issued link, explicit POST login, common history, refresh, logout and owner isolation',async({page,browser})=>{
  await login(page,'A');await page.goto('/history');
  await expect(page.getByText('Тестовая история участника A',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Тестовая история участника A',{exact:true})).toBeVisible();
  const other=await browser.newContext();const otherPage=await other.newPage();
  try{await login(otherPage,'B');await otherPage.goto('/history');await expect(otherPage.getByText('Тестовая история участника A',{exact:true})).toHaveCount(0);}
  finally{await other.close();}
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  const session=await page.request.get('/api/auth/session');expect((await session.json()).authenticated).toBe(false);
  await page.reload();await expect(page.getByText('Тестовая история участника A',{exact:true})).toHaveCount(0);
});
test('protected API uses the current safe error envelope',async({request})=>{
  const response=await request.get('/api/account');expect(response.status()).toBe(401);ProductError.parse(await response.json());
});
