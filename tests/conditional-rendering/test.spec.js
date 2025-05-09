import { test, expect } from '@playwright/test';

test('each conditional component instance has independent state', async ({ page }) => {
  // Load the test page
  await page.goto('/tests/conditional-rendering');
  
  // Verify initial state - should have two instances with default "no conditions" content
  await expect(page.locator('.component-container')).toHaveCount(2);
  await expect(page.locator('#content-none-0')).toBeVisible();
  await expect(page.locator('#content-none-1')).toBeVisible();
  
  // Activate condition 1 in first instance only
  await page.locator('.component-container').nth(0).locator('input').nth(0).check();
  
  // Verify only first instance has changed
  await expect(page.locator('#content-1-0')).toBeVisible();
  await expect(page.locator('#content-none-1')).toBeVisible();
  
  // Activate conditions 2 and 3 in second instance
  await page.locator('.component-container').nth(1).locator('input').nth(1).check();
  await page.locator('.component-container').nth(1).locator('input').nth(2).check();
  
  // Verify correct conditional content in second instance
  await expect(page.locator('#content-2-3-1')).toBeVisible();
  
  // Check that first instance still shows only condition 1
  await expect(page.locator('#content-1-0')).toBeVisible();
  
  // Add a third instance 
  await page.click('#add-instance');
  
  // Verify new instance appears with default state
  await expect(page.locator('.component-container')).toHaveCount(3);
  await expect(page.locator('#content-none-2')).toBeVisible();
  
  // Set all conditions true in third instance
  await page.locator('.component-container').nth(2).locator('input').nth(0).check();
  await page.locator('.component-container').nth(2).locator('input').nth(1).check();
  await page.locator('.component-container').nth(2).locator('input').nth(2).check();
  
  // Verify all instances show correct content
  await expect(page.locator('#content-1-0')).toBeVisible();
  await expect(page.locator('#content-2-3-1')).toBeVisible();
  await expect(page.locator('#content-all-2')).toBeVisible();
  
  // Uncheck condition in the first instance
  await page.locator('.component-container').nth(0).locator('input').nth(0).uncheck();
  
  // Verify first instance updated without affecting others
  await expect(page.locator('#content-none-0')).toBeVisible();
  await expect(page.locator('#content-2-3-1')).toBeVisible();
  await expect(page.locator('#content-all-2')).toBeVisible();
});