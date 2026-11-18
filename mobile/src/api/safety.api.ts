/**
 * Safety (server/routes/safety.routes.ts): emergency contacts, SOS with live
 * location, help on a trip, and reports about someone's behaviour.
 */

import { apiClient } from './client';

export type SafetyWhere = { context: 'trip'; tripId: number } | { context: 'service'; serviceRequestId: number };
export interface EmergencyContact { name: string; phone: string }
export interface SosResult {
    id: number; code: string; liveUrl: string; liveMinutes: number;
    manager: { name: string; phone: string } | null; contacts: EmergencyContact[]; smsText: string;
}

/** What someone can be reported for; the severity decides how fast staff call back. */
export const REPORT_REASONS: Array<{ key: string; label: string; critical?: boolean }> = [
    { key: 'harassment', label: 'Sexual harassment', critical: true },
    { key: 'physical_harm', label: 'Physical harm or assault', critical: true },
    { key: 'threats', label: 'Threats or intimidation', critical: true },
    { key: 'drunk', label: 'Drunk or high on the job', critical: true },
    { key: 'unsafe_driving', label: 'Unsafe or rash driving' },
    { key: 'abusive', label: 'Abusive language' },
    { key: 'extra_money', label: 'Asked for extra money' },
    { key: 'route', label: 'Changed the route without asking' },
    { key: 'theft_damage', label: 'Theft or damage' },
    { key: 'rude', label: 'Rude behaviour' },
    { key: 'late', label: 'Very late' },
    { key: 'not_as_promised', label: 'Car, room or service not as promised' },
    { key: 'other', label: 'Something else' },
];
export const HELP_REASONS: Array<{ key: string; label: string }> = [
    { key: 'breakdown', label: 'Car broke down' },
    { key: 'driver_late', label: 'Driver is late or not here' },
    { key: 'stay', label: 'Problem with the stay' },
    { key: 'medical', label: 'Medical help needed' },
    { key: 'lost_item', label: 'Lost something' },
    { key: 'other', label: 'Something else' },
];

export const safetyApi = {
    contacts: async (): Promise<EmergencyContact[]> => (await apiClient.get('/api/safety/contacts')).data.data ?? [],
    saveContacts: async (contacts: EmergencyContact[]) => (await apiClient.put('/api/safety/contacts', { contacts })).data,
    sos: async (where: SafetyWhere, loc: { lat: number; lng: number; accuracy?: number | null } | null): Promise<SosResult> =>
        (await apiClient.post('/api/safety/sos', { ...where, ...(loc ?? {}) })).data.data,
    ping: async (id: number, loc: { lat: number; lng: number; accuracy?: number | null }) => (await apiClient.post(`/api/safety/sos/${id}/ping`, loc)).data.data as { live: boolean },
    stop: async (id: number) => (await apiClient.post(`/api/safety/sos/${id}/stop`, {})).data,
    report: async (where: SafetyWhere, body: { category: string; teamMemberId?: number | null; about?: string | null; description?: string | null }) =>
        (await apiClient.post('/api/safety/report', { ...where, ...body })).data as { message: string; data: { code: string; severity: string } },
    help: async (where: SafetyWhere, body: { category: string; description?: string | null; lat?: number | null; lng?: number | null }) =>
        (await apiClient.post('/api/safety/help', { ...where, ...body })).data as { message: string; data: { code: string; manager: { name: string; phone: string } | null } },
};
