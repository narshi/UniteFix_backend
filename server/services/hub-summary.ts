/**
 * The Hub home page's figures and set-up checklist.
 *
 * One contributor per module; each looks only at its own tables and returns
 * nothing for a business without the module. A contributor that fails is
 * skipped, never fatal — the home page must open even if one module's query
 * breaks.
 */

import { db } from '../db';
import { and, eq, sql } from 'drizzle-orm';
import { ftthPlans } from '@shared/schema';
import type { HubContext } from './partner-hub.service';
import logger from '../lib/logger';

/** ₹ amount from paise for summary tiles: "₹5,546" or "₹5,546.50". */
export const rupeeLabel = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface SummaryPart {
    stats?: Array<{ label: string; value: string | number; hint?: string }>;
    checklist?: Array<{ label: string; done: boolean; href: string }>;
    [key: string]: unknown;
}
type Contributor = (ctx: HubContext) => Promise<SummaryPart | null>;

const CONTRIBUTORS: Array<[string, Contributor]> = [
    ['broadband', async (ctx) => {
        if (!ctx.modules.includes('broadband') || !ctx.ftthOperatorId) return null;
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(ftthPlans)
            .where(and(eq(ftthPlans.operatorId, ctx.ftthOperatorId), sql`${ftthPlans.deletedAt} IS NULL`));
        return { broadband: { plans: n } };
    }],
];

/** Later phases register their module's contributor here. */
export function registerSummaryContributor(name: string, fn: Contributor) {
    CONTRIBUTORS.push([name, fn]);
}

export async function hubSummary(ctx: HubContext) {
    const out: SummaryPart & { stats: NonNullable<SummaryPart['stats']>; checklist: NonNullable<SummaryPart['checklist']> } = { stats: [], checklist: [] };
    for (const [name, fn] of CONTRIBUTORS) {
        try {
            const part = await fn(ctx);
            if (!part) continue;
            const { stats, checklist, ...rest } = part;
            if (stats) out.stats.push(...stats);
            if (checklist) out.checklist.push(...checklist);
            Object.assign(out, rest);
        } catch (err: any) {
            logger.warn(`[HUB] summary contributor "${name}" failed: ${err?.message}`);
        }
    }
    return out;
}
