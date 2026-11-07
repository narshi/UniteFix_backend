/**
 * Photos for services and categories, everywhere the app shows the catalogue.
 *
 * A service's photo, in order:
 *   1. the admin's Banner Image, when it is a picture of this service
 *      (a link put on 3+ different services is a placeholder, see SHARED_PHOTO_LIMIT);
 *   2. a bundled photo picked from the service's name (servicePhotoRules.ts);
 *   3. its category's bundled photo;
 *   4. the admin's shared placeholder, if any;
 *   5. a photo of a home.
 * Bundled photos ship inside the app (assets/services, assets/home; credits in
 * assets/home/CREDITS.md), so a card always has a picture, even offline.
 */

import { useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';
import type { ServiceCategory, ServiceItem } from '../api/customer.api';
import { useAllServices } from '../hooks/useCustomerData';
import { HERO_OF, PhotoKey, SHARED_PHOTO_LIMIT, photoKeyForCategory, photoKeyForService } from './servicePhotoRules';

const THUMB: Record<PhotoKey, number> = {
    plumbing: require('../../assets/services/plumbing.jpg'),
    electrical: require('../../assets/services/electrical.jpg'),
    ac: require('../../assets/services/ac.jpg'),
    painting: require('../../assets/services/painting.jpg'),
    travel: require('../../assets/services/travel.jpg'),
    inspection: require('../../assets/services/inspection.jpg'),
    house: require('../../assets/services/house.jpg'),
    toilet_flush: require('../../assets/services/toilet_flush.jpg'),
    toilet_concealed: require('../../assets/services/toilet_concealed.jpg'),
    commode: require('../../assets/services/commode.jpg'),
    geyser: require('../../assets/services/geyser.jpg'),
    bathtub: require('../../assets/services/bathtub.jpg'),
    tank: require('../../assets/services/tank.jpg'),
    kitchen_sink: require('../../assets/services/kitchen_sink.jpg'),
    basin: require('../../assets/services/basin.jpg'),
    pipes: require('../../assets/services/pipes.jpg'),
    mixer: require('../../assets/services/mixer.jpg'),
    fan: require('../../assets/services/fan.jpg'),
    lights: require('../../assets/services/lights.jpg'),
    switchboard: require('../../assets/services/switchboard.jpg'),
    socket: require('../../assets/services/socket.jpg'),
    mcb: require('../../assets/services/mcb.jpg'),
    meter: require('../../assets/services/meter.jpg'),
    wiring: require('../../assets/services/wiring.jpg'),
    laptop: require('../../assets/services/laptop.jpg'),
    desktop: require('../../assets/services/desktop.jpg'),
    desktop_repair: require('../../assets/services/desktop_repair.jpg'),
    software: require('../../assets/services/software.jpg'),
    ssd: require('../../assets/services/ssd.jpg'),
    router: require('../../assets/services/router.jpg'),
    fiber: require('../../assets/services/fiber.jpg'),
    printer: require('../../assets/services/printer.jpg'),
    ink: require('../../assets/services/ink.jpg'),
    cctv: require('../../assets/services/cctv.jpg'),
    fingerprint: require('../../assets/services/fingerprint.jpg'),
    battery: require('../../assets/services/battery.jpg'),
    purifier: require('../../assets/services/purifier.jpg'),
    washing: require('../../assets/services/washing.jpg'),
    solar: require('../../assets/services/solar.jpg'),
    tax: require('../../assets/services/tax.jpg'),
};

/** Full-width category headers (navy fade baked in). */
const HERO: Record<string, number> = {
    plumbing: require('../../assets/home/hero-plumbing.jpg'),
    electrical: require('../../assets/home/hero-electrical.jpg'),
    ac: require('../../assets/home/hero-ac.jpg'),
    painting: require('../../assets/home/hero-painting.jpg'),
    inspection: require('../../assets/home/hero-inspection.jpg'),
    computer: require('../../assets/home/hero-computer.jpg'),
    printer: require('../../assets/home/hero-printer.jpg'),
    cctv: require('../../assets/home/hero-cctv.jpg'),
    biometric: require('../../assets/home/hero-biometric.jpg'),
    battery: require('../../assets/home/hero-battery.jpg'),
    purifier: require('../../assets/home/hero-purifier.jpg'),
    broadband: require('../../assets/home/hero-broadband.jpg'),
    tax: require('../../assets/home/hero-tax.jpg'),
    travel: require('../../assets/home/hero-travel.jpg'),
    solar: require('../../assets/home/hero-solar.jpg'),
    washing: require('../../assets/home/hero-washing.jpg'),
    default: require('../../assets/home/hero-default.jpg'),
};

export type Photo = ImageSourcePropType;
const isLink = (s?: string | null): s is string => !!s && /^https?:\/\//i.test(s.trim());
const tally = (links: (string | null | undefined)[]) => {
    const m = new Map<string, number>();
    for (const l of links) if (isLink(l)) m.set(l.trim(), (m.get(l.trim()) ?? 0) + 1);
    return m;
};

export type PhotoResolver = {
    /** A service's card photo. bundledOnly: skip the admin's link (used when it fails to load). */
    service: (s: ServiceItem, category?: ServiceCategory | null, bundledOnly?: boolean) => Photo;
    /** A category's small photo (sidebar, tiles). */
    category: (c: ServiceCategory) => Photo;
    /** A category's header photo, and whether it already has the navy fade baked in. */
    hero: (c: ServiceCategory) => { source: Photo; faded: boolean };
};

export function makePhotoResolver(categories?: ServiceCategory[] | null): PhotoResolver {
    const all = categories ?? [];
    const bannerUses = tally(all.flatMap(c => (c.items ?? []).map(s => s.bannerImage)));
    const iconUses = tally(all.map(c => c.icon));
    const own = (link: string | null | undefined, uses: Map<string, number>, limit: number) =>
        isLink(link) && (uses.get(link.trim()) ?? 0) < limit ? { uri: link.trim() } : null;
    const categoryKey = (c?: ServiceCategory | null) => photoKeyForCategory(c?.name);

    const category = (c: ServiceCategory): Photo => {
        const k = categoryKey(c);
        if (k) return THUMB[k];
        // The category's own picture only when no other category uses the same one.
        return own(c.icon, iconUses, 2) ?? THUMB.house;
    };

    return {
        category,
        service: (s, c, bundledOnly) => {
            const mine = bundledOnly ? null : own(s.bannerImage, bannerUses, SHARED_PHOTO_LIMIT);
            if (mine) return mine;
            const k = photoKeyForService(s.name);
            if (k) return THUMB[k];
            const ck = categoryKey(c ?? all.find(x => x.id === s.categoryId));
            if (ck) return THUMB[ck];
            if (!bundledOnly && isLink(s.bannerImage)) return { uri: s.bannerImage.trim() };
            return THUMB.house;
        },
        hero: c => {
            const k = categoryKey(c);
            const h = k ? HERO_OF[k] : undefined;
            if (h && HERO[h]) return { source: HERO[h], faded: true };
            const mine = own(c.icon, iconUses, 2);
            if (mine) return { source: mine, faded: false };
            return { source: HERO.default, faded: true };
        },
    };
}

/** The resolver for the catalogue the app has loaded (shared cache, no extra request). */
export function usePhotoResolver(): PhotoResolver {
    const { data } = useAllServices();
    return useMemo(() => makePhotoResolver(data), [data]);
}

/** One of the bundled photos by its key (admin → Home screen, "from the app's photos"), or null. */
export function photoByKey(key?: string | null): Photo | null {
    return key && key in THUMB ? THUMB[key as PhotoKey] : null;
}

/** A photo for free text such as a booking's service type ("Plumbing", "AC Service"), or null. */
export function photoForName(name?: string | null): Photo | null {
    const k = photoKeyForService(name) ?? photoKeyForCategory(name);
    return k ? THUMB[k] : null;
}
