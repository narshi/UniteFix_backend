/**
 * Travel planner API (server/routes/travel.routes.ts). The catalogue (regions,
 * places, pickup points) is staff-managed; the plan is optimised on the server.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export type TripType = 'round_trip' | 'one_way';
export type Pace = 'relaxed' | 'balanced' | 'packed';
export type StayChoice = 'none' | 'budget' | 'standard' | 'premium' | 'homestay';
export type TripStatus = 'new' | 'assigned' | 'contacted' | 'quoted' | 'confirmed' | 'started' | 'completed' | 'cancelled';

export interface TravelPlace {
    id: number; regionId: number | null; name: string; kind: string; description: string | null;
    lat: number; lng: number; visitMinutes: number; featured: boolean; photoUrl: string | null;
    bestMonths: number[]; inSeason: boolean;
}
export interface TravelRegion {
    id: number; name: string; tagline: string | null; photoKey: string | null; photoUrl: string | null;
    bestMonths: number[]; inSeason: boolean; places: TravelPlace[];
}
export interface TravelPickup { id: number; name: string; lat: number; lng: number }
export interface TravelCatalog { month: number; regions: TravelRegion[]; otherPlaces: TravelPlace[]; pickups: TravelPickup[] }

export interface PlanStop { type: 'start' | 'place' | 'end'; id: number | null; name: string; driveKm: number; driveMinutes: number; visitMinutes: number }
export interface PlanDay { day: number; stops: PlanStop[]; km: number; minutes: number; stayNear: string | null }
export interface PlanSuggestion { id: number; name: string; regionName: string | null; detourKm: number; inSeason: boolean; featured: boolean }
export interface TripPlan {
    tripType: TripType; pace: Pace; order: number[]; days: PlanDay[]; totalKm: number;
    totalDriveMinutes: number; totalVisitMinutes: number; nights: number; suggestions: PlanSuggestion[]; startUnknown: boolean;
}

export interface MyTrip {
    id: number; code: string; status: TripStatus; statusLabel: string; tripType: TripType; from: string | null; to: string | null;
    startDate: string | null; days: number | null; adults: number; children: number; stay: StayChoice; needsCab: boolean; needsGuide: boolean;
    places: string[]; totalKm: number | null; manager: { name: string; phone: string | null } | null;
    quote: {
        amount: number; note: string | null; at: string | null; validUntil: string | null; expired: boolean;
        advancePercent: number; advanceAmount: number; balance: number;
    } | null;
    advance: { status: 'none' | 'due' | 'paid'; paidAt: string | null };
    canPay: boolean; members: Array<{ name: string; phone: string | null }>;
    createdAt: string; canCancel: boolean; cancelKeepsAdvance: boolean;
    team: Array<{ id: number; day: number | null; role: 'driver' | 'stay' | 'guide' | 'activity'; name: string; phone: string | null; photoUrl: string | null; vehicle: string | null; plate: string | null; place: string | null; time: string | null; verified: boolean; ours: boolean }>;
    startCode: string | null; startCodeFrom: string | null; startedAt: string | null; endedAt: string | null;
    cancelBy: string | null; cancelCutoffDays: number; cancelBlocked: string | null; canEnd: boolean; safetyActive: boolean;
    progress: { done: number; total: number; next: string | null; nextDay: number | null; checked: number[] };
    tracking: { lastPingAt: string | null; source: string | null };
    familyUrl: string | null; canRate: boolean; ratedAt: string | null;
}

export interface PlanRequest {
    tripType: TripType; pace: Pace; pickupId?: number | null; pickupText?: string | null; dropId?: number | null; dropText?: string | null;
    placeIds: number[]; regionIds: number[];
}
export interface TripRequest extends PlanRequest {
    adults: number; children: number; members: Array<{ name: string; phone: string | null }>; startDate: string; stay: StayChoice;
    rooms: number | null; needsCab: boolean; needsGuide: boolean; budgetPerPerson: number | null; notes: string | null;
    contactName: string; contactPhone: string;
}

export const travelApi = {
    catalog: async (): Promise<TravelCatalog> => (await apiClient.get('/api/travel/catalog')).data.data,
    plan: async (body: PlanRequest): Promise<TripPlan> => (await apiClient.post('/api/travel/plan', body)).data.data,
    send: async (body: TripRequest): Promise<{ id: number; code: string; message: string; manager: { name: string; phone: string } | null }> => (await apiClient.post('/api/travel/trips', body)).data.data,
    mine: async (): Promise<MyTrip[]> => (await apiClient.get('/api/travel/trips/mine')).data.data ?? [],
    /** A payment link for the advance on the quotation. */
    payAdvance: async (id: number): Promise<{ url: string; amount: number }> => (await apiClient.post(`/api/travel/trips/${id}/advance`, {})).data.data,
    /** Trip mode: where the traveller is, while the trip is on. */
    ping: async (id: number, loc: { lat: number; lng: number; accuracy?: number | null; speed?: number | null }) =>
        (await apiClient.post(`/api/travel/trips/${id}/ping`, loc)).data.data as { tracking: boolean; checked: string[]; progress: MyTrip['progress'] },
    familyLink: async (id: number): Promise<{ url: string }> => (await apiClient.post(`/api/travel/trips/${id}/family-link`, {})).data.data,
    rate: async (id: number, ratings: Array<{ teamMemberId: number; stars: number; tags: string[]; comment: string | null }>) =>
        (await apiClient.post(`/api/travel/trips/${id}/ratings`, { ratings })).data as { message: string },
    end: async (id: number) => (await apiClient.post(`/api/travel/trips/${id}/end`, {})).data,
    cancel: async (id: number) => (await apiClient.post(`/api/travel/trips/${id}/cancel`, {})).data,
};

export const useTravelCatalog = () => useQuery({ queryKey: ['travelCatalog'], queryFn: travelApi.catalog, staleTime: 5 * 60_000 });
export const useMyTrips = () => useQuery({ queryKey: ['myTrips'], queryFn: travelApi.mine });

/** Bundled region photos by the region's photo_key (mobile/assets/travel/CREDITS.md). */
export const REGION_PHOTOS: Record<string, number> = {
    coast: require('../../assets/travel/coast.jpg'),
    sirsi: require('../../assets/travel/sirsi.jpg'),
    yellapur: require('../../assets/travel/yellapur.jpg'),
    dandeli: require('../../assets/travel/dandeli.jpg'),
    mundgod: require('../../assets/travel/mundgod.jpg'),
    karwar: require('../../assets/travel/karwar.jpg'),
};
export const TRAVEL_HEADER = require('../../assets/travel/header.jpg');
export const regionPhoto = (r: Pick<TravelRegion, 'photoKey' | 'photoUrl'>): number | { uri: string } =>
    r.photoUrl ? { uri: r.photoUrl } : (r.photoKey && REGION_PHOTOS[r.photoKey]) || TRAVEL_HEADER;

export const hoursText = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
export const vehicleFor = (people: number) =>
    people <= 4 ? 'Sedan · 4 seats' : people <= 7 ? 'SUV / Innova · 7 seats' : people <= 12 ? 'Tempo Traveller · 12 seats' : people <= 17 ? 'Tempo Traveller · 17 seats' : 'Mini bus';

/** Quick tags for a rating (the server keeps only these; shared/travel.ts RATING_TAGS). */
export const RATING_TAGS: Record<string, string[]> = {
    driver: ['Safe driving', 'On time', 'Clean car', 'Polite', 'Knew the roads'],
    stay: ['Clean room', 'Good food', 'Friendly host', 'As promised', 'Good location'],
    guide: ['Knowledgeable', 'Friendly', 'On time', 'Good stories'],
    activity: ['Well organised', 'Safe', 'Fun', 'Good value'],
};
