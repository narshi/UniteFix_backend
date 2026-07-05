import { create } from 'zustand';

interface BookingDraftState {
    description: string;
    urgency: 'normal' | 'urgent';
    photos: string[];
    setDescription: (description: string) => void;
    setUrgency: (urgency: 'normal' | 'urgent') => void;
    setPhotos: (photos: string[] | ((prev: string[]) => string[])) => void;
    clearDraft: () => void;
}

export const useBookingDraftStore = create<BookingDraftState>((set) => ({
    description: '',
    urgency: 'normal',
    photos: [],
    setDescription: (description) => set({ description }),
    setUrgency: (urgency) => set({ urgency }),
    setPhotos: (photos) => set((state) => ({
        photos: typeof photos === 'function' ? photos(state.photos) : photos
    })),
    clearDraft: () => set({ description: '', urgency: 'normal', photos: [] }),
}));
