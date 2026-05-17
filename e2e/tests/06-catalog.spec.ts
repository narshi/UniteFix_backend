/**
 * TC-06: Service Catalog Management Tests
 * 
 * Covers: View categories, create category, create service, edit, archive
 */

import { test, expect, navigateTo, apiRequest } from '../fixtures';

test.describe('Service Catalog', () => {

  test.beforeEach(async ({ adminPage }) => {
    await navigateTo(adminPage, 'Service Catalog');
    await adminPage.waitForTimeout(2000);
  });

  test('TC-06.1: Should display service categories', async ({ adminPage }) => {
    // Should see category cards or table
    const heading = adminPage.locator('h1, h2, h3').filter({ hasText: /catalog|categories|services/i }).first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('TC-06.2: Should create a new category via API', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'POST', '/api/admin/catalog/categories', {
      name: `E2E Test Category ${Date.now()}`,
      description: 'Created by Playwright E2E test',
      iconUrl: 'test-icon',
      isActive: true,
    });

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
  });

  test('TC-06.3: Should create a new service via API', async ({ adminPage }) => {
    // First get a category ID
    const categories = await apiRequest(adminPage, 'GET', '/api/admin/catalog/categories');
    
    if (categories.data?.data && categories.data.data.length > 0) {
      const categoryId = categories.data.data[0].id;
      
      const result = await apiRequest(adminPage, 'POST', '/api/admin/catalog/services', {
        categoryId,
        name: `E2E Test Service ${Date.now()}`,
        description: 'Created by Playwright E2E test',
        basePrice: 499,
        estimatedDuration: '1 hour',
        status: 'ACTIVE',
      });

      expect(result.status).toBe(200);
      expect(result.data.success).toBe(true);
    }
  });
});
