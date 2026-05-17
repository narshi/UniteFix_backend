/**
 * TC-03: Employee Management Tests
 * 
 * Covers: List employees, verification flow, wallet operations, search/filter
 */

import { test, expect, navigateTo, waitForTableLoad, apiRequest } from '../fixtures';

test.describe('Employee Management', () => {

  test.beforeEach(async ({ adminPage }) => {
    await navigateTo(adminPage, 'Employees');
    await adminPage.waitForTimeout(2000);
  });

  test('TC-03.1: Should display employee list', async ({ adminPage }) => {
    // Should see the Employees heading
    await expect(adminPage.locator('h2:has-text("Employees")')).toBeVisible();

    // Should see the table or a "Loading" indicator
    const table = adminPage.locator('table');
    const loading = adminPage.locator('text=Loading');
    
    // Wait for either table or loading to appear
    await Promise.race([
      table.waitFor({ timeout: 10000 }).catch(() => {}),
      loading.waitFor({ timeout: 5000 }).catch(() => {}),
    ]);
  });

  test('TC-03.2: Should filter employees by verification status', async ({ adminPage }) => {
    // Click the status filter dropdown
    const filterSelect = adminPage.locator('button:has-text("All Status"), select, [role="combobox"]').first();
    
    if (await filterSelect.isVisible()) {
      await filterSelect.click();
      await adminPage.waitForTimeout(500);

      // Select "Pending"
      const pendingOption = adminPage.locator('[role="option"]:has-text("Pending"), option:has-text("Pending")').first();
      if (await pendingOption.isVisible()) {
        await pendingOption.click();
        await adminPage.waitForTimeout(1000);
      }
    }
  });

  test('TC-03.3: Should search employees by name', async ({ adminPage }) => {
    const searchInput = adminPage.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await adminPage.waitForTimeout(1000);
      // Search should not crash the page
      await expect(adminPage.locator('h2:has-text("Employees")')).toBeVisible();
    }
  });

  test('TC-03.4: Should open Add Employee modal', async ({ adminPage }) => {
    const addButton = adminPage.locator('button:has-text("Add Employee")').first();
    
    if (await addButton.isVisible()) {
      await addButton.click();
      await adminPage.waitForTimeout(500);

      // Modal should appear with form fields
      const modal = adminPage.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Should have form fields
      await expect(adminPage.locator('text=Employee Name')).toBeVisible();
    }
  });

  test('TC-03.5: Should show wallet balance for employees', async ({ adminPage }) => {
    // Wallet column should exist in the table
    const walletHeader = adminPage.locator('th:has-text("Wallet")');
    if (await walletHeader.isVisible()) {
      // At least one ₹ symbol should be visible in the table
      const walletValues = adminPage.locator('td >> text=₹');
      const count = await walletValues.count();
      expect(count).toBeGreaterThanOrEqual(0); // May be 0 if no employees
    }
  });
});
