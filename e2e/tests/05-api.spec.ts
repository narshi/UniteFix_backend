/**
 * TC-05: API Health & Backend Endpoint Tests
 * 
 * Covers: Health check, admin APIs authentication, CRUD operations via API
 */

import { test, expect, apiRequest } from '../fixtures';

test.describe('API Health & Endpoints', () => {

  test('TC-05.1: Health endpoint should return healthy', async ({ page }) => {
    const response = await page.goto('/api/health');
    const body = await response?.json();
    
    expect(response?.status()).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.uptime).toBeGreaterThan(0);
  });

  test('TC-05.2: Admin endpoints should reject unauthenticated requests', async ({ page }) => {
    const response = await page.goto('/api/admin/servicemen/list');
    expect(response?.status()).toBe(401);
  });

  test('TC-05.3: Admin servicemen list should return data when authenticated', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/servicemen/list');
    
    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
  });

  test('TC-05.4: Employees should have correct field mapping', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/servicemen/list');
    
    if (result.data.data && result.data.data.length > 0) {
      const employee = result.data.data[0];
      
      // Should have aliased field names for admin dashboard
      expect(employee).toHaveProperty('partnerName');
      expect(employee).toHaveProperty('verificationStatus');
      expect(employee).toHaveProperty('email');
      expect(employee).toHaveProperty('phone');
      
      // partnerName should not be null/undefined
      expect(employee.partnerName).toBeTruthy();
      
      // verificationStatus should be valid
      expect(['pending', 'verified', 'rejected', 'suspended']).toContain(employee.verificationStatus);
    }
  });

  test('TC-05.5: Admin stats endpoint should return data', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/stats');
    expect(result.status).toBe(200);
  });

  test('TC-05.6: Service catalog should be accessible', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/catalog/categories');
    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
  });

  test('TC-05.7: Pending employees filter should work', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/servicemen/list?status=pending');
    
    expect(result.status).toBe(200);
    if (result.data.data && result.data.data.length > 0) {
      // All returned employees should be pending
      result.data.data.forEach((emp: any) => {
        expect(emp.verificationStatus).toBe('pending');
      });
    }
  });

  test('TC-05.8: Phase 6 verification endpoints should work', async ({ adminPage }) => {
    const result = await apiRequest(adminPage, 'GET', '/api/admin/employees/pending?status=pending');
    
    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data).toHaveProperty('pagination');
  });

  test('TC-05.9: Phase 6 billing audit should work for valid booking', async ({ adminPage }) => {
    // First get a booking ID
    const services = await apiRequest(adminPage, 'GET', '/api/admin/services');
    
    if (services.data?.data && services.data.data.length > 0) {
      const bookingId = services.data.data[0].id;
      const result = await apiRequest(adminPage, 'GET', `/api/admin/bookings/${bookingId}/billing`);
      
      expect(result.status).toBe(200);
      expect(result.data.success).toBe(true);
      expect(result.data.data).toHaveProperty('booking');
    }
  });
});
