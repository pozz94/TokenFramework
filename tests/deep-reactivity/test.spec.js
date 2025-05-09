import { test, expect } from '@playwright/test';

test('deep object reactivity', async ({ page }) => {
  await page.goto('/tests/deep-reactivity');
  
  // Get initial state
  const initialObject = await page.locator('#object-display').textContent();
  expect(JSON.parse(initialObject)).toHaveProperty('address.city', 'New York');
  
  // Test updating nested property
  await page.click('#update-nested');
  const updatedNestedObject = await page.locator('#object-display').textContent();
  expect(JSON.parse(updatedNestedObject)).toHaveProperty('address.city', 'Boston');
  
  // Test replacing entire object
  await page.click('#replace-object');
  const replacedObject = await page.locator('#object-display').textContent();
  const parsedObject = JSON.parse(replacedObject);
  expect(parsedObject.name).toBe('Alice');
  expect(parsedObject.address.city).toBe('Seattle');
  
  // Test adding new property
  await page.click('#add-property');
  const objectWithNewProp = await page.locator('#object-display').textContent();
  expect(JSON.parse(objectWithNewProp)).toHaveProperty('job', 'Developer');
});

test('array reactivity operations', async ({ page }) => {
  await page.goto('/tests/deep-reactivity');
  
  // Get initial array state with pushed item
  const initialArray = await page.locator('#array-display').textContent();
  expect(JSON.parse(initialArray)).toEqual([1, 2, 3, 4]);
  
  // Test incrementing all array items
  await page.click('#push-item');
  const arrayAfterIncrement = await page.locator('#array-display').textContent();
  expect(JSON.parse(arrayAfterIncrement)).toEqual([2, 3, 4, 5]);
  
  // Test popping last item
  await page.click('#pop-item');
  const arrayAfterPop = await page.locator('#array-display').textContent();
  expect(JSON.parse(arrayAfterPop)).toEqual([2, 3, 4]);

  // Test replacing entire array
  await page.click('#replace-array');
  const replacedArray = await page.locator('#array-display').textContent();
  expect(JSON.parse(replacedArray)).toEqual([10, 20, 30]);
  
  // Test multiplying first item (will fail if not implemented)
  await page.click('#update-item');
  const arrayAfterMultiply = await page.locator('#array-display').textContent();
  const firstItem = JSON.parse(arrayAfterMultiply)[0];
  expect(firstItem).toBe(100); // Should be 10 * 10 = 100
});