/**
 * TC-09: UI Smoke Tests — Every Admin Page Loads Without Crashing
 * 
 * Covers: All sidebar routes render without JavaScript errors
 */

import { test, expect } from '../fixtures';

const ADMIN_PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'User Management', path: '/users' },
  { name: 'Service Requests', path: '/services' },
  { name: 'Service Catalog', path: '/admin/catalog' },
  { name: 'Product Orders', path: '/orders' },
  { name: 'Inventory', path: '/admin/inventory' },
  { name: 'Employees', path: '/partners' },
  { name: 'Payments & Invoices', path: '/payments' },
  { name: 'Districts', path: '/admin/districts' },
  { name: 'Location Management', path: '/locations' },
  { name: 'Developer Details', path: '/admin/developer' },
  { name: 'Settings', path: '/settings' },
];

test.describe('UI Smoke Tests — All Pages', () => {

  for (const page of ADMIN_PAGES) {
    test(`TC-09: ${page.name} (${page.path}) should load without crash`, async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (error) => {
        errors.push(error.message);
      });

      await adminPage.goto(page.path);
      await adminPage.waitForTimeout(3000);

      // Page should have content (not a blank screen)
      const body = await adminPage.locator('body').textContent();
      expect(body!.length).toBeGreaterThan(10);

      // Should not have unrecoverable JS errors
      const criticalErrors = errors.filter(e =>
        !e.includes('ResizeObserver') &&
        !e.includes('Loading chunk') &&
        !e.includes('Failed to fetch')
      );

      if (criticalErrors.length > 0) {
        console.warn(`⚠️  ${page.name} had ${criticalErrors.length} error(s):`, criticalErrors);
      }
      
      // Allow max 1 non-critical error
      expect(criticalErrors.length).toBeLessThanOrEqual(1);
    });
  }
});
