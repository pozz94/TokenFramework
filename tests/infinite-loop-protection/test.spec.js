import { test, expect } from '@playwright/test';

// Set a strict timeout for all infinite loop tests
const infiniteLoopTest = test.extend({
    // Override the default timeout to be shorter
    timeout: 1000 // 1 second total
});

infiniteLoopTest('infinite loop protection - direct cycle', async ({ page, context }) => {
    await page.goto('/tests/infinite-loop-protection');

    // Create a promise that resolves after a safety timeout
    const safetyTimeout = new Promise((resolve) => {
        setTimeout(() => resolve('TIMEOUT'), 3000);
    });

    // Create a promise for the actual test
    const testPromise = async () => {
        await page.click('#run-direct-cycle');
        await expect(page.locator('#direct-cycle-result')).toHaveClass('success');
        await expect(page.locator('#direct-cycle-result')).toContainText(/protection|detected|caught/i);
        return 'SUCCESS';
    };

    // Race the test against the timeout
    const result = await Promise.race([testPromise(), safetyTimeout]);

    // If we hit the safety timeout, terminate the page forcibly
    if (result === 'TIMEOUT') {
        console.log('⚠️ SAFETY TIMEOUT - Infinite loop detected, terminating browser');

        try {
            // Force close the page to kill any runaway scripts
            await page.close({ force: true });

            // Also close the browser context to ensure everything is cleaned up
            await context.close();
        } catch (e) {
            console.log('Error while trying to force close: ', e);
        }

        // Now fail the test
        expect('test timed out - infinite loop not caught').toBe('test completed');
    }
});

// Apply the same pattern to the other tests
infiniteLoopTest('infinite loop protection - maximum update depth', async ({ page, context }) => {
    await page.goto('/tests/infinite-loop-protection');

    const safetyTimeout = new Promise((resolve) => {
        setTimeout(() => resolve('TIMEOUT'), 3000);
    });

    const testPromise = async () => {
        await page.click('#run-max-depth');
        await expect(page.locator('#max-depth-result')).toHaveClass('success');
        await expect(page.locator('#max-depth-result')).toContainText(/protection|detected|caught|passed/i);
        return 'SUCCESS';
    };

    const result = await Promise.race([testPromise(), safetyTimeout]);
    if (result === 'TIMEOUT') {
        await page.close({ force: true });
        await context.close();
        expect('test timed out - infinite loop not caught').toBe('test completed');
    }
});

infiniteLoopTest.skip('infinite loop protection - indirect cycle', async ({ page, context }) => {
    await page.goto('/tests/infinite-loop-protection');

    const safetyTimeout = new Promise((resolve) => {
        setTimeout(() => resolve('TIMEOUT'), 3000);
    });

    const testPromise = async () => {
        await page.click('#run-indirect-cycle');
        await expect(page.locator('#indirect-cycle-result')).toHaveClass('success');
        await expect(page.locator('#indirect-cycle-result')).toContainText(/protection|detected|caught/i);
        return 'SUCCESS';
    };

    const result = await Promise.race([testPromise(), safetyTimeout]);
    if (result === 'TIMEOUT') {
        await page.close({ force: true });
        await context.close();
        expect('test timed out - infinite loop not caught').toBe('test completed');
    }
});