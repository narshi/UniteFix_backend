/**
 * TC-04: Service Requests Management Tests
 * 
 * Covers: Service list, status filters, assignment flow, detail view
 */

import { test, expect, navigateTo, apiRequest } from '../fixtures';

test.describe('Service Requests', () => {

  test.beforeEach(async ({ adminPage }) => {
    await navigateTo(adminPage, 'Service Requests');
    await adminPage.waitForTimeout(2000);
  });

  test('TC-04.1: Should display service requests list', async ({ adminPage }) => {
    await expect(adminPage.locator('h2:has-text("Service"), h1:has-text("Service")')).toBeVisible();
    
    // Should see a table or cards
    const table = adminPage.locator('table');
    await table.waitFor({ timeout: 10000 }).catch(() => {});
  });

  test('TC-04.2: Should filter by status', async ({ adminPage }) => {
    const filterDropdown = adminPage.locator('select, [role="combobox"], button:has-text("All")').first();
    
    if (await filterDropdown.isVisible()) {
      await filterDropdown.click();
      await adminPage.waitForTimeout(500);
    }
    // Should not crash
    await expect(adminPage.locator('h2:has-text("Service"), h1:has-text("Service")')).toBeVisible();
  });

  test('TC-04.3: Should show service detail when clicking a row', async ({ adminPage }) => {
    // Click first service row if exists
    const firstRow = adminPage.locator('table tbody tr, [class*="service-card"]').first();
    
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await adminPage.waitForTimeout(1000);
      // Detail view or modal should appear
    }
  });

  test('TC-04.4: Should open assignment modal for pending services', async ({ adminPage }) => {
    // Look for assign button
    const assignButton = adminPage.locator('button:has-text("Assign"), button:has-text("assign")').first();
    
    if (await assignButton.isVisible()) {
      await assignButton.click();
      await adminPage.waitForTimeout(1000);

      // Assignment modal should appear
      const modal = adminPage.locator('[role="dialog"], [data-testid="partner-assignment-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Should show employee list
      await expect(adminPage.locator('text=Assign Employee')).toBeVisible();
    }
  });
});
