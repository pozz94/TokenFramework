import { test, expect } from '@playwright/test';

test('basic reactivity updates counter correctly', async ({ page }) => {
  // Navigate to the specific feature test page
  await page.goto('/tests/basic-reactivity');
  
  // Check initial counter value
  expect(await page.locator('#counter').textContent()).toBe('0');
  
  // Click increment button
  await page.click('#increment');
  
  // Verify counter was updated reactively
  expect(await page.locator('#counter').textContent()).toBe('1');
  
  // Click multiple times
  await page.click('#increment');
  await page.click('#increment');
  
  // Verify counter reflects multiple updates
  expect(await page.locator('#counter').textContent()).toBe('3');
});