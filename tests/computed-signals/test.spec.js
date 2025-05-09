import { test, expect } from '@playwright/test';

test('basic computed functionality', async ({ page }) => {
  await page.goto('/tests/computed-signals');
  
  // Test initial values
  expect(await page.locator('#num1').textContent()).toBe('0');
  expect(await page.locator('#num2').textContent()).toBe('0');
  expect(await page.locator('#sum').textContent()).toBe('0');
  expect(await page.locator('#product').textContent()).toBe('0');
  
  // Increment num1 and check that sum and product update
  await page.click('#inc-num1');
  expect(await page.locator('#num1').textContent()).toBe('1');
  expect(await page.locator('#sum').textContent()).toBe('1');
  expect(await page.locator('#product').textContent()).toBe('0');
  
  // Increment num2 and check that sum and product update
  await page.click('#inc-num2');
  expect(await page.locator('#num2').textContent()).toBe('1');
  expect(await page.locator('#sum').textContent()).toBe('2');
  expect(await page.locator('#product').textContent()).toBe('1');
  
  // Increment both again
  await page.click('#inc-num1');
  await page.click('#inc-num2');
  expect(await page.locator('#sum').textContent()).toBe('4');
  expect(await page.locator('#product').textContent()).toBe('4');
});

test('computed with source signal', async ({ page }) => {
  await page.goto('/tests/computed-signals');
  
  // Check initial state
  expect(await page.locator('#source-value').textContent()).toBe('Hello');
  expect(await page.locator('#derived-value').textContent()).toBe('HELLO');
  
  // Toggle source and check that derived value updates immediately
  await page.click('#toggle-source');
  expect(await page.locator('#source-value').textContent()).toBe('World');
  expect(await page.locator('#derived-value').textContent()).toBe('WORLD');
  
  // Toggle again
  await page.click('#toggle-source');
  expect(await page.locator('#source-value').textContent()).toBe('Testing');
  expect(await page.locator('#derived-value').textContent()).toBe('TESTING');
});

test('computed.fromResource', async ({ page }) => {
  await page.goto('/tests/computed-signals');
  
  // Click fetch button
  await page.click('#fetch-data');
  
  // Check loading state appears
  await expect(page.locator('#fetch-status')).toHaveClass('loading', { timeout: 1000 });
  
  // Wait for success state
  await expect(page.locator('#fetch-status')).toHaveClass('success', { timeout: 5000 });
  
  // Check that result contains expected data
  const resultText = await page.locator('#fetch-result').textContent();
  const result = JSON.parse(resultText);
  expect(result).toHaveProperty('id');
  expect(result).toHaveProperty('title');
  
  // Test with invalid URL
  await page.fill('#api-url', 'https://invalid-url-that-doesnt-exist/');
  await page.click('#fetch-data');
  
  // Should eventually show error
  await expect(page.locator('#fetch-status')).toHaveClass('error', { timeout: 5000 });
});

test('computed.fromEvent', async ({ page }) => {
  await page.goto('/tests/computed-signals');
  
  // Initial state
  expect(await page.locator('#event-output').textContent()).toBe('No events yet');
  
  // Move mouse over event area
  await page.hover('#event-area');
  
  // Should capture and display mouse coordinates
  const eventText = await page.locator('#event-output').textContent();
  expect(eventText).toMatch(/X: \d+, Y: \d+/);
});