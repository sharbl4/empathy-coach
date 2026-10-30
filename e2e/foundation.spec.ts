import { test, expect } from '@playwright/test';
test('web reaches the real HTTP backend and SPA routes survive refresh',async({page,request})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'Между строк',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Сервер доступен');
  await page.goto('/history');await page.reload();await expect(page.getByRole('heading',{name:'Между строк',exact:true})).toBeVisible();
  const missing=await request.get('/api/missing');expect(missing.status()).toBe(404);expect(missing.headers()['content-type']).toContain('application/json');
  const ready=await request.get('/api/health/ready');expect(ready.status()).toBe(process.env.DATABASE_URL?200:503);
});
