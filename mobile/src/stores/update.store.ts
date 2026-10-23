/**
 * "Update required" — set when this build is older than the minimum UniteFix
 * staff set (Admin → Settings → App updates), either from the version check
 * on start / foreground or from the server refusing a request (HTTP 426).
 * While it is set, the app shows only the update screen.
 */

import { create } from 'zustand';

export type UpdateRequired = { message: string; updateUrl: string | null; minVersionCode: number | null };

type UpdateState = {
    required: UpdateRequired | null;
    setRequired: (r: UpdateRequired | null) => void;
};

export const useUpdateStore = create<UpdateState>(set => ({
    required: null,
    setRequired: required => set({ required }),
}));
