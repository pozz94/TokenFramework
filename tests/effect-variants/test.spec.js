import { test, expect } from '@playwright/test';

test('effect variants have correct update behaviors', async ({ page }) => {
  await page.goto('/tests/effect-variants');
  
  // Reset to make sure we start clean
  await page.click('#reset-test');
  
  // Run the rapid updates test
  await page.click('#start-updates');
  
  // Wait for the signal value to reach 500
  await page.waitForFunction(() => 
    document.getElementById('signal-value').textContent === '500'
  );
  
  // IMPORTANT: Get counts immediately after updates finish
  const regularCountImmediate = await page.locator('#regular-effect-count').textContent();
  const throttledCountImmediate = await page.locator('#throttled-effect-count').textContent();
  const debouncedCountImmediate = await page.locator('#debounced-effect-count').textContent();
  const uiCountImmediate = await page.locator('#ui-effect-count').textContent();
  
  console.log('=== COUNTS IMMEDIATELY AFTER UPDATES ===');
  console.log(`Regular updates: ${regularCountImmediate}`);
  console.log(`Throttled updates: ${throttledCountImmediate}`);
  console.log(`Debounced updates: ${debouncedCountImmediate}`);
  console.log(`UI updates: ${uiCountImmediate}`);
  
  // Debounced effect might not have run yet since it waits for changes to stop
  // Let's wait 500ms to ensure debounced effect has time to run
  await page.waitForTimeout(500);
  
  // Get counts after waiting
  const regularCountAfterWait = await page.locator('#regular-effect-count').textContent();
  const throttledCountAfterWait = await page.locator('#throttled-effect-count').textContent();
  const debouncedCountAfterWait = await page.locator('#debounced-effect-count').textContent();
  const uiCountAfterWait = await page.locator('#ui-effect-count').textContent();
  
  console.log('=== COUNTS AFTER WAITING ===');
  console.log(`Regular updates: ${regularCountAfterWait}`);
  console.log(`Throttled updates: ${throttledCountAfterWait}`);
  console.log(`Debounced updates: ${debouncedCountAfterWait}`);
  console.log(`UI updates: ${uiCountAfterWait}`);
  
  // VERIFY EFFECT BEHAVIORS
  
  // 1. Regular effect should run many times
  expect(parseInt(regularCountAfterWait)).toBeGreaterThan(100);
  
  // 2. Throttled effect should run less than regular
  expect(parseInt(throttledCountAfterWait)).toBeLessThan(parseInt(regularCountAfterWait) * 0.5);
  expect(parseInt(throttledCountAfterWait)).toBeGreaterThan(3); // Reasonable minimum
  
  // 3. Debounced effect should:
  // - Have minimal runs immediately after updates (0 or 1)
  expect(parseInt(debouncedCountImmediate)).toBeLessThanOrEqual(1);
  // - Have executed after waiting
  expect(parseInt(debouncedCountAfterWait)).toBeGreaterThan(parseInt(debouncedCountImmediate));
  
  // 4. UI effect should run less than regular but more than debounced
  expect(parseInt(uiCountAfterWait)).toBeLessThan(parseInt(regularCountAfterWait));
  expect(parseInt(uiCountAfterWait)).toBeGreaterThan(5); // Reasonable minimum
});