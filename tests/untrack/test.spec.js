import { test, expect } from '@playwright/test';

test('untrack prevents dependency tracking in effects', async ({ page }) => {
  await page.goto('/tests/untrack');
  
  // Test 1: Basic untrack
  // Initial state - effect should have run once
  expect(await page.locator('#effect-count').textContent()).toBe('1');
  expect(await page.locator('#tracked-value').textContent()).toBe('0');
  expect(await page.locator('#untracked-value').textContent()).toBe('0');
  
  // Increment tracked signal - effect SHOULD run
  await page.click('#increment-tracked');
  expect(await page.locator('#effect-count').textContent()).toBe('2');
  expect(await page.locator('#tracked-value').textContent()).toBe('1');
  
  // Increment untracked signal - effect should NOT run
  await page.click('#increment-untracked');
  expect(await page.locator('#effect-count').textContent()).toBe('2'); // Still 2!
  expect(await page.locator('#untracked-value').textContent()).toBe('1'); // Manually updated
  
  // Increment untracked again - still no effect run
  await page.click('#increment-untracked');
  expect(await page.locator('#effect-count').textContent()).toBe('2'); // Still 2!
  expect(await page.locator('#untracked-value').textContent()).toBe('2');
  
  // Increment tracked again - effect runs
  await page.click('#increment-tracked');
  expect(await page.locator('#effect-count').textContent()).toBe('3');
  expect(await page.locator('#tracked-value').textContent()).toBe('2');
});

test('untrack works in computed signals', async ({ page }) => {
  await page.goto('/tests/untrack');
  
  // Test 2: Untrack in computed
  // Initial state - computed should have run once
  expect(await page.locator('#computed-count').textContent()).toBe('1');
  expect(await page.locator('#source-value').textContent()).toBe('0');
  expect(await page.locator('#computed-value').textContent()).toBe('0');
  
  // Increment source - computed SHOULD recompute
  await page.click('#increment-source');
  expect(await page.locator('#computed-count').textContent()).toBe('2');
  expect(await page.locator('#source-value').textContent()).toBe('1');
  expect(await page.locator('#computed-value').textContent()).toBe('1');
  
  // Increment untracked dependency - computed should NOT recompute
  await page.click('#increment-untracked-dep');
  expect(await page.locator('#computed-count').textContent()).toBe('2'); // Still 2!
  expect(await page.locator('#computed-value').textContent()).toBe('2'); // Manually updated
  
  // Increment source again - computed runs
  await page.click('#increment-source');
  expect(await page.locator('#computed-count').textContent()).toBe('3');
  expect(await page.locator('#computed-value').textContent()).toBe('4'); // 2 + 2
});

test('nested untrack selectively tracks dependencies', async ({ page }) => {
  await page.goto('/tests/untrack');
  
  // Test 3: Nested untrack
  // Initial state
  expect(await page.locator('#nested-effect-count').textContent()).toBe('1');
  expect(await page.locator('#signal-a').textContent()).toBe('0');
  expect(await page.locator('#signal-b').textContent()).toBe('0');
  expect(await page.locator('#signal-c').textContent()).toBe('0');
  
  // Increment A - effect SHOULD run (tracked)
  await page.click('#increment-a');
  expect(await page.locator('#nested-effect-count').textContent()).toBe('2');
  expect(await page.locator('#signal-a').textContent()).toBe('1');
  
  // Increment B - effect should NOT run (untracked)
  await page.click('#increment-b');
  expect(await page.locator('#nested-effect-count').textContent()).toBe('2'); // Still 2!
  expect(await page.locator('#signal-b').textContent()).toBe('1'); // Manually updated
  
  // Increment B again - still no effect run
  await page.click('#increment-b');
  await page.click('#increment-b');
  expect(await page.locator('#nested-effect-count').textContent()).toBe('2'); // Still 2!
  expect(await page.locator('#signal-b').textContent()).toBe('3');
  
  // Increment C - effect SHOULD run (tracked)
  await page.click('#increment-c');
  expect(await page.locator('#nested-effect-count').textContent()).toBe('3');
  expect(await page.locator('#signal-c').textContent()).toBe('1');
  
  // Increment A again - effect runs
  await page.click('#increment-a');
  expect(await page.locator('#nested-effect-count').textContent()).toBe('4');
  expect(await page.locator('#signal-a').textContent()).toBe('2');
});
