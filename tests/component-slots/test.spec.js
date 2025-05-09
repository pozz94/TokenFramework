import { test, expect } from '@playwright/test';

test('basic slot functionality', async ({ page }) => {
  await page.goto('/tests/component-slots');
  
  // 1. Test initial slot content
  
  // Header slot should have initial content
  await expect(page.locator('#header-slot')).toContainText('Card Header');
  
  // Default slot should have default content
  await expect(page.locator('#default-slot-content')).toContainText('default slot content');
  
  // Footer slot should have initial content
  await expect(page.locator('#footer-slot')).toContainText('Card Footer');
  
  // 2. Test slot content updates
  
  // Toggle default content
  await page.click('#toggle-default-content');
  await expect(page.locator('#default-slot-content')).toContainText('Content has been toggled');
  await expect(page.locator('#default-slot-content')).not.toContainText('default slot content');
  
  // Toggle back
  await page.click('#toggle-default-content');
  await expect(page.locator('#default-slot-content')).toContainText('default slot content');
  
  // Update header
  await page.click('#update-header');
  await expect(page.locator('#header-slot')).toContainText('Updated Header');
  
  // Update footer
  await page.click('#update-footer');
  await expect(page.locator('#footer-slot')).toContainText('Updated Footer');
});

test('dynamic slots with conditional rendering', async ({ page }) => {
  await page.goto('/tests/component-slots');
  
  // 1. Test initial state
  
  // Should have 2 items initially
  await expect(page.locator('.list-item')).toHaveCount(2);
  
  // 2. Test adding items
  
  // Add an item
  await page.click('#add-item');
  await expect(page.locator('.list-item')).toHaveCount(3);
  
  // Verify prefix slot is rendered
  await expect(page.locator('.list-item').first()).toContainText('→');
  
  // 3. Test removing items
  
  // Remove the first item - FIXED: properly chain the locator methods
  await page.locator('.remove-item').first().click();
  await expect(page.locator('.list-item')).toHaveCount(2);
  
  // 4. Test empty state with conditional slot content
  
  // Clear all items
  await page.click('#clear-items');
  await expect(page.locator('.list-item')).toHaveCount(0);
  
  // Empty message should now be visible
  await expect(page.locator('#empty-message')).toBeVisible();
  await expect(page.locator('#empty-message')).toHaveText('No items available');
  
  // Add an item - empty message should disappear
  await page.click('#add-item');
  await expect(page.locator('#empty-message')).not.toBeVisible();
  await expect(page.locator('.list-item')).toHaveCount(1);
});