import { create } from 'zustand';

interface BookingDraftState {
    // Service context
    serviceType: string;
    serviceName: string;
    serviceId?: number;
    basePrice: number;
    /** The category's booking fee, carried with the service. Undefined = use the app-wide fee. */
    bookingFee?: number;
    /** How this service books (utils/serviceBands.ts). */
    band?: string;
    setServiceContext: (type: string, name: string, id?: number, price?: number, bookingFee?: number, band?: string) => void;

    // Booking details
    description: string;
    urgency: 'normal' | 'urgent';
    photos: string[];
    setDescription: (description: string) => void;
    setUrgency: (urgency: 'normal' | 'urgent') => void;
    setPhotos: (photos: string[] | ((prev: string[]) => string[])) => void;
    clearDraft: () => void;
}

export const useBookingDraftStore = create<BookingDraftState>((set) => ({
    serviceType: '',
    serviceName: '',
    serviceId: undefined,
    basePrice: 0,
    setServiceContext: (type, name, id, price, bookingFee, band) => set({
        serviceType: type,
        serviceName: name,
        serviceId: id,
        basePrice: price || 0,
        bookingFee,
        band,
    }),

    description: '',
    urgency: 'normal',
    photos: [],
    setDescription: (description) => set({ description }),
    setUrgency: (urgency) => set({ urgency }),
    setPhotos: (photos) => set((state) => ({
        photos: typeof photos === 'function' ? photos(state.photos) : photos
    })),
    clearDraft: () => set({ 
        description: '', 
        urgency: 'normal', 
        photos: [],
        serviceType: '',
        serviceName: '',
        serviceId: undefined,
        basePrice: 0,
        bookingFee: undefined,
        band: undefined,
    }),
}));
