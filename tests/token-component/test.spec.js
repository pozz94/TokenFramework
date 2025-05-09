import { test, expect } from '@playwright/test';

test('counter component functionality', async ({ page }) => {
  await page.goto('/tests/token-component');
  
  // Check initial count
  await expect(page.locator('#count-display')).toHaveText('Count: 0');
  
  // Increment and check updated count
  await page.click('#increment-btn');
  await expect(page.locator('#count-display')).toHaveText('Count: 1');
  
  // Increment again
  await page.click('#increment-btn');
  await expect(page.locator('#count-display')).toHaveText('Count: 2');
  
  // Decrement
  await page.click('#decrement-btn');
  await expect(page.locator('#count-display')).toHaveText('Count: 1');
});

test('props component reactivity', async ({ page }) => {
  await page.goto('/tests/token-component');
  
  // Check initial props values
  await expect(page.locator('#title-display')).toHaveText('INITIAL TITLE');
  await expect(page.locator('#color-indicator')).toHaveText('Current color: blue');
  
  // Update title
  await page.click('#change-title');
  await expect(page.locator('#title-display')).toHaveText('UPDATED TITLE');
  
  // Update color
  const initialColor = await page.locator('#color-indicator').textContent();
  await page.click('#change-color');
  
  // Wait for color to change
  await expect(page.locator('#color-indicator')).not.toHaveText(initialColor, {timeout: 2000});
});

test('parent component with nested children', async ({ page }) => {
  await page.goto('/tests/token-component');
  
  // Check initial state
  await expect(page.locator('#selected-child')).toHaveText('Selected: ');
  
  // Count initial children
  await expect(page.locator('.child')).toHaveCount(3);
  
  // Test child click interaction
  await page.locator('.child').first().click();
  await expect(page.locator('#selected-child')).toHaveText('Selected: Alice');
  
  // Add a new child
  await page.click('#add-child-btn');
  
  // Verify new child was added
  await expect(page.locator('.child')).toHaveCount(4);
  
  // Click the new child
  await page.locator('.child').nth(3).click();
  await expect(page.locator('#selected-child')).toContainText('New Child');
});