/**
 * The customer's running total for a recharge, and the selection behind it.
 *
 * `plan.payable` is the server's figure with nothing optional chosen — base,
 * mandatory add-ons and the convenience fee. Optional add-ons are added here
 * as they are ticked. The result is a PREVIEW: at pay time the server prices
 * the same ids again from the database and Razorpay opens on its figure.
 *
 * Exclusive groups are honoured on the client so the UI can render radio
 * rows, and enforced on the server so a crafted request cannot bill both.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FtthPlan, FtthPlanAddon } from '../api/ftth.api';

export const KIND_LABEL: Record<FtthPlanAddon['kind'], string> = {
    telephone: 'Telephone',
    ott: 'OTT subscriptions',
    iptv: 'IPTV',
    static_ip: 'Static IP',
    installation: 'Installation',
    other: 'Other extras',
};

export interface AddonGroup {
    kind: FtthPlanAddon['kind'];
    label: string;
    items: FtthPlanAddon[];
    /** Every item in the group shares one exclusive group → radio, not checkboxes. */
    pickOne: boolean;
    selectedCount: number;
    subtotal: number;
}

export function usePlanPricing(plan: FtthPlan | null) {
    const [selected, setSelected] = useState<number[]>([]);

    // A tick belongs to one plan's add-on row. A different plan means the old
    // ids are meaningless at best and a wrong charge at worst.
    useEffect(() => { setSelected([]); }, [plan?.id]);

    const mandatory = useMemo(() => (plan?.addons ?? []).filter(a => !a.isOptional), [plan]);
    const optional = useMemo(() => (plan?.addons ?? []).filter(a => a.isOptional), [plan]);

    const groups: AddonGroup[] = useMemo(() => {
        const byKind = new Map<FtthPlanAddon['kind'], FtthPlanAddon[]>();
        for (const a of optional) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
        return Array.from(byKind.entries()).map(([kind, items]) => {
            const groupsInKind = new Set(items.map(i => i.exclusiveGroup ?? null));
            const pickOne = items.length > 1 && groupsInKind.size === 1 && !groupsInKind.has(null);
            const chosen = items.filter(i => selected.includes(i.id));
            return {
                kind, label: KIND_LABEL[kind], items, pickOne,
                selectedCount: chosen.length,
                subtotal: chosen.reduce((s, i) => s + i.amount, 0),
            };
        });
    }, [optional, selected]);

    const toggle = useCallback((addon: FtthPlanAddon) => {
        setSelected(prev => {
            if (prev.includes(addon.id)) return prev.filter(id => id !== addon.id);
            // Choosing one of a pick-one group drops any sibling already chosen.
            const siblings = addon.exclusiveGroup
                ? optional.filter(o => o.exclusiveGroup === addon.exclusiveGroup && o.id !== addon.id).map(o => o.id)
                : [];
            return [...prev.filter(id => !siblings.includes(id)), addon.id];
        });
    }, [optional]);

    const chosenTotal = useMemo(
        () => optional.filter(a => selected.includes(a.id)).reduce((s, a) => s + a.amount, 0),
        [optional, selected],
    );
    // Rounded to paise: 471 + 118.5 must not render as 589.4999999999999.
    const total = plan ? Math.round((plan.payable + chosenTotal) * 100) / 100 : 0;
    const itemCount = plan ? 1 + mandatory.length + selected.length : 0;

    return { selected, toggle, mandatory, optional, groups, chosenTotal, total, itemCount };
}
