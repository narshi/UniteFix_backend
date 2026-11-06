/**
 * The Partner Hub from the app: the business owner signed in with the
 * partner login. The same endpoints the web Hub uses — jobs UniteFix sends,
 * the team and its commission, earnings — plus the switch to technician mode
 * for jobs the owner takes himself.
 */

import { apiClient } from './client';
import type { AuthResponse } from './auth.api';

export type HubJobView = 'queue' | 'active' | 'done';
/** A free-quote request from a customer near the partner (server: enquiry.service.ts). */
export interface HubEnquiry {
    id: number; ref: string; serviceName: string; details: string; preferredDate: string | null; budget: string | null; pincode: string | null;
    status: 'open' | 'new' | 'taken_by_other' | 'taken' | 'forwarded' | 'contacted' | 'closed'; createdAt: string;
    /** Only once the enquiry is this partner's. */
    customer: { name: string | null; phone: string | null; address: string | null } | null;
}

export interface HubJob {
    id: number; serviceId: string; status: string; serviceName: string | null; categoryName: string | null; quantity: number;
    description: string | null; urgency: string | null; preferredDate: string | null; preferredTimeSlot: string | null;
    customerName: string | null; customerPhone: string | null; address: string | null; pincode: string | null;
    createdAt: string; completedAt: string | null;
    technician: { id: number; name: string | null } | null;
    slaAssignBy: string | null; overdue: boolean;
    price: number | null; yourValue: number | null; yourCommission: number | null; paymentMethod: string | null;
    pausedUntil: string | null; pauseNote: string | null; followUpCount: number; lastAttemptReason: string | null;
}

export type Commission = { type: 'percent' | 'fixed'; value: number };

export interface HubTechnician {
    id: number; fullName: string | null; phone: string | null; services: string[]; isActive: boolean; isOnline: boolean;
    verification: string; adminRemarks: string | null; documents: { aadhaar: boolean; pan: boolean; photo: boolean };
    completed: number; rating: number; activeJobs: number; isOwner: boolean; commission: Commission | null;
}

export interface HubMe {
    businessPartnerId: number; partnerCode: string; displayName: string; status: string; role: string; modules: string[];
}

export interface HubEarnings {
    held: number; released: number;
    jobs: Array<{ id: number; serviceId: string; technician: string | null; completedAt: string | null; status: string; releaseAt: string; amount: number }>;
}

type Ok<T> = { success: boolean; message?: string; data: T };

export const partnerHubApi = {
    me: () => apiClient.get<Ok<HubMe>>('/api/hub/me'),
    jobs: (view: HubJobView) => apiClient.get<Ok<HubJob[]>>('/api/hub/field/jobs', { params: { view } }),
    enquiries: () => apiClient.get<Ok<HubEnquiry[]>>('/api/hub/enquiries'),
    takeEnquiry: (id: number) => apiClient.post<Ok<HubEnquiry>>(`/api/hub/enquiries/${id}/take`),
    updateEnquiry: (id: number, status: 'contacted' | 'closed') => apiClient.patch<Ok<unknown>>(`/api/hub/enquiries/${id}`, { status }),
    assign: (jobId: number, employeeId: number) => apiClient.post<Ok<unknown>>(`/api/hub/field/jobs/${jobId}/assign`, { employeeId }),
    technicians: () => apiClient.get<Ok<HubTechnician[]>>('/api/hub/field/technicians'),
    addTechnician: (data: { fullName: string; phone: string; isOwner?: boolean }) =>
        apiClient.post<Ok<{ id: number }>>('/api/hub/field/technicians', data),
    updateTechnician: (id: number, patch: { isActive?: boolean; commission?: Commission | null }) =>
        apiClient.patch<Ok<{ id: number; isActive: boolean }>>(`/api/hub/field/technicians/${id}`, patch),
    settings: () => apiClient.get<Ok<{ commission: Commission }>>('/api/hub/field/settings'),
    /** The partner's customer link and code, and the bookings it brought in. */
    share: () => apiClient.get<Ok<{ code: string; link: string; bookings: number; completed: number }>>('/api/hub/field/share'),
    saveCommission: (c: Commission) => apiClient.put<Ok<{ commission: Commission }>>('/api/hub/field/settings', { commissionType: c.type, commissionValue: c.value }),
    earnings: () => apiClient.get<Ok<HubEarnings>>('/api/hub/field/earnings'),
    /** A technician session on this same login, for jobs the owner works himself. */
    technicianSession: () => apiClient.post<AuthResponse>('/api/hub/field/technician-session'),
};

export const commissionText = (c: Commission) => (c.type === 'fixed' ? `₹${c.value} a job` : `${c.value}%`);
