import { test, expect } from '@playwright/test';

test('component lifecycle hooks are properly called', async ({ page }) => {
    // This test should still pass as-is - 5 items in the list
    await page.goto('/tests/memory-management');
    
    // Reset counters to start clean
    await page.click('#reset-counts');
    
    // Toggle container on to create components
    await page.click('#toggle-container');
    
    // Verify components were created and mounted
    await expect(page.locator('#created-count')).toHaveText('5'); 
    await expect(page.locator('#mounted-count')).toHaveText('5');
    await expect(page.locator('#effects-created')).toHaveText('5');
    
    // Toggle container off to destroy components
    await page.click('#toggle-container');
    
    // Verify unmount hooks were called
    await expect(page.locator('#unmounted-count')).toHaveText('5');
    await expect(page.locator('#effects-cleaned')).toHaveText('5');
});

test('bulk component creation and cleanup', async ({ page }) => {
    await page.goto('/tests/memory-management');
    
    // Reset counters
    await page.click('#reset-counts');
    
    // Create many components
    await page.click('#create-many');
    
    // Wait for creation and cleanup
    await page.waitForTimeout(600); // Wait for the 500ms timeout plus buffer
    
    // UPDATED: You're creating 20 components, not 50
    await expect(page.locator('#created-count')).toHaveText('20');
    await expect(page.locator('#mounted-count')).toHaveText('20');
    await expect(page.locator('#unmounted-count')).toHaveText('20');
    await expect(page.locator('#effects-cleaned')).toHaveText('20');
});

// No changes needed for multiple cycle test
test('multiple cycle test', async ({ page }) => {
    // This test should work as is since it checks equalities, not specific values
    await page.goto('/tests/memory-management');

    // Reset counters
    await page.click('#reset-counts');

    // Perform multiple toggle cycles
    for (let i = 0; i < 3; i++) {
        await page.click('#toggle-container'); // turn on
        await page.waitForTimeout(100);
        await page.click('#toggle-container'); // turn off
        await page.waitForTimeout(100);
    }

    // Check that all counts match (created = mounted = unmounted)
    const created = await page.locator('#created-count').textContent();
    const mounted = await page.locator('#mounted-count').textContent();
    const unmounted = await page.locator('#unmounted-count').textContent();
    const effectsCleaned = await page.locator('#effects-cleaned').textContent();

    expect(created).toBe(mounted);
    expect(mounted).toBe(unmounted);
    expect(unmounted).toBe(effectsCleaned);
});

test('effect cleanup functions are called', async ({ page }) => {
    // This test should still work with your effect.untrack() implementation
    await page.goto('/tests/memory-management');
  
    // Reset counters to start clean
    await page.click('#reset-counts');
  
    // Toggle container on to create components
    await page.click('#toggle-container');
  
    // Verify effects were created
    await expect(page.locator('#effects-created')).toHaveText('5');
  
    // Trigger effect reruns
    await page.click('#trigger-updates');
  
    // Verify cleanup functions were called during reruns
    await expect(page.locator('#effects-rerun')).toHaveText('5');
    await expect(page.locator('#effects-cleaned')).toHaveText('5');
  
    // Toggle container off
    await page.click('#toggle-container');
  
    // Verify cleanup functions were called during unmount
    await expect(page.locator('#effects-cleaned')).toHaveText('10'); // 5 from reruns + 5 from unmounting
});

test('bulk component cleanup handles effects', async ({ page }) => {
    await page.goto('/tests/memory-management');
    
    // Reset counters
    await page.click('#reset-counts');
    
    // Create many components
    await page.click('#create-many');
    
    // Wait for creation and cleanup
    await page.waitForTimeout(600);
    
    // UPDATED: You're creating 20 components, not 50
    await expect(page.locator('#effects-created')).toHaveText('20');
    await expect(page.locator('#effects-cleaned')).toHaveText('20');
});

// The last test should work since it uses multipliers based on components × reruns
test('effect cleanup occurs during both reruns and unmount', async ({ page }) => {
    await page.goto('/tests/memory-management');
  
    // Reset counters
    await page.click('#reset-counts');
  
    // Toggle container on
    await page.click('#toggle-container');
  
    // Trigger multiple effect reruns
    await page.click('#trigger-updates');
    await page.click('#trigger-updates');
    await page.click('#trigger-updates');
  
    // Check cleanup counts from reruns
    await expect(page.locator('#effects-rerun')).toHaveText('15'); // 5 components × 3 reruns
    await expect(page.locator('#effects-cleaned')).toHaveText('15');
  
    // Toggle off to test unmount cleanup
    await page.click('#toggle-container');
  
    // Total cleanup should include both reruns and final unmount
    await expect(page.locator('#effects-cleaned')).toHaveText('20'); // 15 from reruns + 5 from unmount
});