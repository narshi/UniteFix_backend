/**
 * TC-01: Admin Authentication Tests
 * 
 * Covers: Login, session persistence, logout, invalid credentials
 */

import { test, expect, ADMIN_EMAIL, ADMIN_PASSWORD } from '../fixtures';

test.describe('Admin Authentication', () => {

  test('TC-01.1: Should show login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    // Should see login form
    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    await expect(emailInput).toBeVisible({ timeout: 10000 });
  });

  test('TC-01.2: Should login with valid credentials', async ({ page }) => {
    await page.goto('/');

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);

    const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
    await loginButton.click();

    // Should redirect to dashboard
    await page.waitForSelector('nav, aside', { timeout: 15000 });

    // Token should be stored
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeTruthy();
  });

  test('TC-01.3: Should reject invalid credentials', async ({ page }) => {
    await page.goto('/');

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill('wrong@email.com');
    await passwordInput.fill('wrongpassword');

    const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
    await loginButton.click();

    // Should stay on login page (no sidebar appears)
    await page.waitForTimeout(3000);
    const sidebar = page.locator('nav, aside');
    // Either sidebar doesn't exist or an error message appears
    const hasError = await page.locator('text=Invalid, text=Error, text=incorrect, [role="alert"]').first().isVisible().catch(() => false);
    const hasSidebar = await sidebar.isVisible().catch(() => false);
    
    // Either we got an error message OR we stayed on the login page
    expect(hasError || !hasSidebar).toBeTruthy();
  });

  test('TC-01.4: Should persist session on page reload', async ({ adminPage }) => {
    // Already logged in via fixture
    await adminPage.reload();

    // Should still see dashboard (not redirected to login)
    await adminPage.waitForSelector('nav, aside', { timeout: 10000 });
    const token = await adminPage.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeTruthy();
  });

  test('TC-01.5: Should logout and clear session', async ({ adminPage }) => {
    // Click logout button
    const logoutBtn = adminPage.locator('button:has-text("Logout")').first();
    await logoutBtn.click();

    // Token should be cleared
    await adminPage.waitForTimeout(2000);
    const token = await adminPage.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeNull();
  });
});
