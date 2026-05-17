/**
 * E2E Test Fixtures & Helpers
 * 
 * Provides authenticated admin page and utility functions
 * that all test files share.
 */

import { test as base, expect, type Page } from '@playwright/test';

// Admin credentials — must match your seeded admin user
const ADMIN_EMAIL = 'admin@unitefix.com';
const ADMIN_PASSWORD = 'admin123';
const BASE_URL = 'http://localhost:3000';

/**
 * Login to admin dashboard and store the JWT token
 */
async function adminLogin(page: Page): Promise<string> {
  // Navigate to the admin login
  await page.goto('/');

  // Wait for the login form to appear
  await page.waitForSelector('input[type="email"], input[placeholder*="email" i], input[name="email"]', {
    timeout: 10000,
  });

  // Fill login form
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  await emailInput.fill(ADMIN_EMAIL);
  await passwordInput.fill(ADMIN_PASSWORD);

  // Click login button
  const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
  await loginButton.click();

  // Wait for dashboard to load (sidebar should appear)
  await page.waitForSelector('nav, aside', { timeout: 15000 });

  // Extract the admin token from localStorage
  const token = await page.evaluate(() => localStorage.getItem('adminToken'));

  if (!token) {
    throw new Error('Admin login failed — no token found in localStorage');
  }

  return token;
}

// Custom test fixture with admin auth
type AdminFixtures = {
  adminPage: Page;
  adminToken: string;
};

export const test = base.extend<AdminFixtures>({
  adminPage: async ({ page }, use) => {
    const token = await adminLogin(page);
    // Store for reuse
    (page as any)._adminToken = token;
    await use(page);
  },
  adminToken: async ({ adminPage }, use) => {
    const token = (adminPage as any)._adminToken as string;
    await use(token);
  },
});

export { expect, ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL };

/**
 * Helper: Navigate to a sidebar section by name
 */
export async function navigateTo(page: Page, sectionName: string) {
  const link = page.locator(`a:has-text("${sectionName}"), nav a:has-text("${sectionName}")`).first();
  await link.click();
  await page.waitForTimeout(1000); // Allow page to render
}

/**
 * Helper: Wait for table to load (no loading spinners)
 */
export async function waitForTableLoad(page: Page) {
  // Wait for loading state to disappear
  await page.waitForFunction(() => {
    const loadingEl = document.querySelector('.animate-pulse, [class*="Loading"]');
    return !loadingEl;
  }, { timeout: 10000 });
}

/**
 * Helper: Get toast notification text
 */
export async function getToastText(page: Page): Promise<string> {
  const toast = page.locator('[role="alert"], [data-radix-toast], .Toaster div').first();
  await toast.waitFor({ timeout: 5000 });
  return await toast.textContent() || '';
}

/**
 * Helper: Make authenticated API request from test
 */
export async function apiRequest(page: Page, method: string, url: string, body?: any) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const token = localStorage.getItem('adminToken');
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json() };
    },
    { method, url, body }
  );
}
