/**
 * A partner's customer link: https://app.unitefix.com/p/<code> (or
 * unitefix://p/<code> from the web page's "Book in the app" button).
 *
 * Not routed by the linking config: a customer usually opens it before they
 * have an account (a fresh install from the link). The code is remembered on
 * the phone instead, and the booking screen puts that partner first and
 * selected; Home shows who they are booking with.
 */

import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

const storage: StateStorage = {
    getItem: async (name) => (await SecureStore.getItemAsync(name)) || null,
    setItem: async (name, value) => { await SecureStore.setItemAsync(name, value); },
    removeItem: async (name) => { await SecureStore.deleteItemAsync(name); },
};

interface PartnerRefState {
    /** The partner code the customer came through, until they dismiss it. */
    code: string | null;
    setCode: (code: string | null) => void;
}

export const usePartnerRef = create<PartnerRefState>()(
    persist(
        (set) => ({ code: null, setCode: (code) => set({ code: code ? code.trim().toUpperCase() : null }) }),
        { name: 'uf-partner-ref', storage: createJSONStorage(() => storage) },
    ),
);

export function parsePartnerLink(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = /(?:^unitefix:\/\/|^https?:\/\/[^/]+\/|^exp\+?[^:]*:\/\/[^/]*\/--\/)\/?p\/([A-Za-z0-9-]{3,24})\/?(?:[?#]|$)/.exec(url);
    return m ? m[1].toUpperCase() : null;
}

/** Remember a partner link if the URL is one. Returns true when it was (so the router ignores it). */
export function capturePartnerLink(url: string | null | undefined): boolean {
    const code = parsePartnerLink(url);
    if (!code) return false;
    usePartnerRef.getState().setCode(code);
    return true;
}
