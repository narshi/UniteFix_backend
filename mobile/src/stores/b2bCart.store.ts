/**
 * B2B cart — what a business partner is about to order from UniteFix stock.
 *
 * In memory only. A trade order is placed in one sitting, at a desk, with
 * the quote in view; there is nothing to resume, and a stale cart carrying
 * yesterday's prices would be worse than an empty one. The server re-prices
 * on quote and again on place, so the cart never holds money — only the
 * part and the count. Names and prices are cached for display and refreshed
 * whenever the catalogue re-renders the line.
 */

import { create } from 'zustand';

export interface CartEntry {
    sparePartId: number;
    quantity: number;
    /** Display cache — the quote is the truth. */
    name: string;
    partCode: string;
    tradePrice: number;
    unit: string | null;
}

interface B2bCartState {
    entries: CartEntry[];
    add: (entry: Omit<CartEntry, 'quantity'>, quantity?: number) => void;
    setQuantity: (sparePartId: number, quantity: number) => void;
    remove: (sparePartId: number) => void;
    clear: () => void;
    quantityOf: (sparePartId: number) => number;
    count: () => number;
}

const MAX_LINE_QTY = 10_000;

export const useB2bCartStore = create<B2bCartState>((set, get) => ({
    entries: [],

    add: (entry, quantity = 1) => set((s) => {
        const existing = s.entries.find(e => e.sparePartId === entry.sparePartId);
        if (existing) {
            return {
                entries: s.entries.map(e => e.sparePartId === entry.sparePartId
                    ? { ...e, ...entry, quantity: Math.min(MAX_LINE_QTY, e.quantity + quantity) }
                    : e),
            };
        }
        return { entries: [...s.entries, { ...entry, quantity: Math.max(1, Math.min(MAX_LINE_QTY, quantity)) }] };
    }),

    setQuantity: (sparePartId, quantity) => set((s) => {
        if (quantity <= 0) return { entries: s.entries.filter(e => e.sparePartId !== sparePartId) };
        return { entries: s.entries.map(e => e.sparePartId === sparePartId ? { ...e, quantity: Math.min(MAX_LINE_QTY, quantity) } : e) };
    }),

    remove: (sparePartId) => set((s) => ({ entries: s.entries.filter(e => e.sparePartId !== sparePartId) })),

    clear: () => set({ entries: [] }),

    quantityOf: (sparePartId) => get().entries.find(e => e.sparePartId === sparePartId)?.quantity ?? 0,

    count: () => get().entries.reduce((n, e) => n + e.quantity, 0),
}));
