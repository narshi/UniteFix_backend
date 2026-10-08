/**
 * Video links partners paste — a YouTube film, a Vimeo film, an Instagram
 * reel — reduced to a canonical URL, a privacy-friendly embed URL and, where
 * the provider gives one without an API call, a thumbnail.
 *
 * Long films are linked, not uploaded: hosting a 20-minute wedding film is
 * the provider's job, and it costs us nothing.
 */

import { instagramPost } from '../services/events-showcase.service';

export interface VideoLink { provider: 'youtube' | 'vimeo' | 'instagram'; url: string; embed: string; thumb: string | null }

export function videoLink(raw: string | null | undefined): VideoLink | null {
    const u = String(raw ?? '').trim();
    if (!u || u.length > 500) return null;
    const yt = u.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (yt) return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${yt[1]}`, embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`, thumb: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` };
    const vm = u.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?/);
    if (vm) return { provider: 'vimeo', url: `https://vimeo.com/${vm[1]}${vm[2] ? `/${vm[2]}` : ''}`, embed: `https://player.vimeo.com/video/${vm[1]}${vm[2] ? `?h=${vm[2]}&` : '?'}dnt=1`, thumb: null };
    const ig = instagramPost(u);
    if (ig) return { provider: 'instagram', url: ig.url, embed: ig.embed, thumb: null };
    return null;
}

/** An image the public pages may show: our uploads (https or, without Cloudinary, a data URI). */
export const isImageUrl = (u: unknown): u is string =>
    typeof u === 'string' && (/^https:\/\/\S+$/i.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u)) && u.length < 2_500_000;

export const cleanPhotoList = (list: unknown, max = 12) => (Array.isArray(list) ? list.filter(isImageUrl).slice(0, max) as string[] : []);
