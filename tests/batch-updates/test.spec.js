import { test, expect } from '@playwright/test';

test('batch updates performance', async ({ page }) => {
  await page.goto('/tests/batch-updates');
  
  // Check initial state
  await expect(page.locator('#signal-value')).toHaveText('0');
  await expect(page.locator('#render-count')).toHaveText('0');
  
  // Run the batch test
  await page.click('#run-batch-test');
  
  // Wait for all updates to complete
  await page.waitForTimeout(500);
  
  // Verify counter reached 100
  await expect(page.locator('#final-value')).toHaveText('100');
  await expect(page.locator('#updates-performed')).toHaveText('100');
  
  // Get the render count
  const renderCount = await page.locator('#render-count').textContent();
  const renderCountNum = parseInt(renderCount);
  
  // Verify batching occurred - render count should be much less than 100
  // Exact amount depends on framework implementation, but should be significantly less
  expect(renderCountNum).toBeLessThan(20);
  console.log(`Batch test: ${renderCountNum} renders for 100 updates`);
  
  // For comparison, run the unbatched test
  await page.click('#run-unbatched-test');
  
  // Wait for the sequential updates to complete
  await page.waitForTimeout(1000);
  
  // The comparison results should show an improvement
  const comparisonText = await page.locator('.card:nth-child(3)').textContent();
  expect(comparisonText).toContain('Render reduction with batching');
  
  // Log the efficiency improvement
  console.log(`Performance comparison: ${comparisonText}`);
});