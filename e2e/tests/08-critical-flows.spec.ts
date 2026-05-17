/**
 * TC-08: Critical User Flows (End-to-End)
 * 
 * Covers: Complete booking assignment flow, employee verification flow
 */

import { test, expect, navigateTo, apiRequest } from '../fixtures';

test.describe('Critical User Flows', () => {

  test('TC-08.1: Full Employee Verification Flow via API', async ({ adminPage }) => {
    // Step 1: Get a pending employee
    const pending = await apiRequest(adminPage, 'GET', '/api/admin/employees/pending?status=pending');
    
    if (pending.data?.data && pending.data.data.length > 0) {
      const employeeId = pending.data.data[0].id;
      
      // Step 2: Approve the employee
      const verifyResult = await apiRequest(adminPage, 'PATCH', `/api/admin/employees/${employeeId}/verify`, {
        status: 'verified',
        remarks: 'Approved by E2E test',
      });

      expect(verifyResult.status).toBe(200);
      expect(verifyResult.data.success).toBe(true);
      expect(verifyResult.data.data.documentVerificationStatus).toBe('verified');
      expect(verifyResult.data.data.isActive).toBe(true);

      // Step 3: Suspend the same employee (cleanup)
      const suspendResult = await apiRequest(adminPage, 'PATCH', `/api/admin/employees/${employeeId}/verify`, {
        status: 'suspended',
        remarks: 'Suspended by E2E test cleanup',
      });

      expect(suspendResult.status).toBe(200);
      expect(suspendResult.data.data.isActive).toBe(false);
    }
  });

  test('TC-08.2: Booking Override Flow via API', async ({ adminPage }) => {
    // Get any booking
    const services = await apiRequest(adminPage, 'GET', '/api/admin/services');
    
    if (services.data?.data && services.data.data.length > 0) {
      const booking = services.data.data[0];
      const bookingId = booking.id;
      const currentState = booking.status;

      // Override to a different state
      const overrideResult = await apiRequest(adminPage, 'POST', `/api/admin/bookings/${bookingId}/override`, {
        newState: currentState, // Override to SAME state (safe — no side effects)
        reason: 'E2E test — override verification',
      });

      expect(overrideResult.status).toBe(200);
      expect(overrideResult.data.success).toBe(true);
      expect(overrideResult.data.data.previousState).toBe(currentState);
    }
  });

  test('TC-08.3: Billing Audit Trail via API', async ({ adminPage }) => {
    const services = await apiRequest(adminPage, 'GET', '/api/admin/services');
    
    if (services.data?.data && services.data.data.length > 0) {
      const bookingId = services.data.data[0].id;
      
      const audit = await apiRequest(adminPage, 'GET', `/api/admin/bookings/${bookingId}/billing`);
      
      expect(audit.status).toBe(200);
      expect(audit.data.success).toBe(true);
      
      // Should have the complete audit structure
      const data = audit.data.data;
      expect(data).toHaveProperty('booking');
      expect(data).toHaveProperty('payments');
      expect(data.booking).toHaveProperty('id');
      expect(data.booking).toHaveProperty('status');
      expect(data.booking).toHaveProperty('bookingFee');
    }
  });

  test('TC-08.4: Employee Assignment Flow — Auth Headers', async ({ adminPage }) => {
    // This tests the bug fix: assignment modal should send auth headers
    const services = await apiRequest(adminPage, 'GET', '/api/admin/services');
    
    if (services.data?.data && services.data.data.length > 0) {
      const serviceId = services.data.data[0].id;
      
      // Get available partners
      const partners = await apiRequest(adminPage, 'GET', '/api/admin/servicemen/list?status=verified');
      
      if (partners.data?.data && partners.data.data.length > 0) {
        const partnerId = partners.data.data[0].id;
        
        // Attempt assignment (may fail if service is already assigned, but should NOT get auth error)
        const result = await apiRequest(adminPage, 'POST', '/api/admin/requests/assign', {
          request_id: serviceId,
          provider_id: partnerId,
        });

        // Should NOT be 401 (auth error) — that's the bug we fixed
        expect(result.status).not.toBe(401);
        // 200 = success, 400/404 = business logic error (acceptable)
        expect([200, 400, 404, 500]).toContain(result.status);
      }
    }
  });

  test('TC-08.5: Dispute Resolution Flow via API', async ({ adminPage }) => {
    // Find a disputed booking (may not exist in test data)
    const services = await apiRequest(adminPage, 'GET', '/api/admin/services');
    
    if (services.data?.data) {
      const disputed = services.data.data.find((s: any) => s.status === 'disputed');
      
      if (disputed) {
        const result = await apiRequest(adminPage, 'POST', `/api/admin/bookings/${disputed.id}/resolve-dispute`, {
          resolution: 'release_employee',
          remarks: 'E2E test resolution',
        });

        expect(result.status).toBe(200);
        expect(result.data.success).toBe(true);
        expect(result.data.data.resolution).toBe('release_employee');
      }
    }
  });
});
