/**
 * Travel planner API (server/routes/travel.routes.ts). The catalogue (regions,
 * places, pickup points) is staff-managed; the plan is optimised on the server.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export type TripType = 'round_trip' | 'one_way';
export type Pace = 'relaxed' | 'balanced' | 'packed';
export type StayChoice = 'none' | 'budget' | 'standard' | 'premium' | 'homestay';
export type TripStatus = 'new' | 'assigned' | 'contacted' | 'quoted' | 'confirmed' | 'cancelled';

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
    quote: { amount: number; note: string | null; at: string | null } | null; members: Array<{ name: string; phone: string | null }>;
    createdAt: string; canCancel: boolean;
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
    send: async (body: TripRequest): Promise<{ id: number; code: string; message: string }> => (await apiClient.post('/api/travel/trips', body)).data.data,
    mine: async (): Promise<MyTrip[]> => (await apiClient.get('/api/travel/trips/mine')).data.data ?? [],
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
