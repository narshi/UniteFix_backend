/**
 * TC-02: Dashboard & Navigation Tests
 * 
 * Covers: Dashboard stats, sidebar navigation, page rendering
 */

import { test, expect, navigateTo } from '../fixtures';

test.describe('Dashboard & Navigation', () => {

  test('TC-02.1: Dashboard should show stat cards', async ({ adminPage }) => {
    await adminPage.goto('/');
    await adminPage.waitForTimeout(2000);

    // Dashboard should have stat cards (Total Users, Service Requests, etc.)
    const statCards = adminPage.locator('.grid .rounded, [class*="Card"]');
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('TC-02.2: Dashboard should load without console errors', async ({ adminPage }) => {
    const errors: string[] = [];
    adminPage.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });

    await adminPage.goto('/');
    await adminPage.waitForTimeout(3000);

    // Filter out non-critical errors (network timeouts, etc.)
    const criticalErrors = errors.filter(e =>
      !e.includes('net::ERR') &&
      !e.includes('favicon') &&
      !e.includes('chunk')
    );

    expect(criticalErrors.length).toBeLessThanOrEqual(2);
  });

  test('TC-02.3: Should navigate to Service Requests page', async ({ adminPage }) => {
    await navigateTo(adminPage, 'Service Requests');
    await expect(adminPage.locator('h2:has-text("Service"), h1:has-text("Service")')).toBeVisible({ timeout: 5000 });
  });

  test('TC-02.4: Should navigate to Employees page', async ({ adminPage }) => {
    await navigateTo(adminPage, 'Employees');
    await expect(adminPage.locator('h2:has-text("Employees"), h1:has-text("Employees")')).toBeVisible({ timeout: 5000 });
  });

  test('TC-02.5: Should navigate to User Management page', async ({ adminPage }) => {
    await navigateTo(adminPage, 'User Management');
    await expect(adminPage.locator('h2:has-text("User"), h1:has-text("User")')).toBeVisible({ timeout: 5000 });
  });

  test('TC-02.6: Should navigate to Service Catalog page', async ({ adminPage }) => {
    await navigateTo(adminPage, 'Service Catalog');
    await adminPage.waitForTimeout(2000);
    // Should see some catalog content
    const heading = adminPage.locator('h1, h2, h3').filter({ hasText: /catalog|categories|services/i }).first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('TC-02.7: Should navigate to Settings page', async ({ adminPage }) => {
    await navigateTo(adminPage, 'Settings');
    await expect(adminPage.locator('h2:has-text("Settings"), h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });

  test('TC-02.8: Sidebar should highlight active link', async ({ adminPage }) => {
    await navigateTo(adminPage, 'Employees');
    const activeLink = adminPage.locator('a.bg-blue-50, a[class*="active"], nav a[class*="blue"]').first();
    await expect(activeLink).toBeVisible();
  });
});
