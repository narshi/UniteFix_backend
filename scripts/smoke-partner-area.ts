/**
 * Partners on the app's booking screen, by area automatically: a partner that
 * can take field jobs (Field service, a verified technician) is offered for
 * addresses in its area — its approved territories, its coverage list, or the
 * same postal district as its own address (first three digits) — for the
 * services it listed, or else every service of its verticals.
 *
 *   npx tsx scripts/smoke-partner-area.ts
 */

import { sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, serviceCategories, services, partnerServices } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { ProviderChoiceService } from '../server/services/provider-choice.service';
import { PartnerFieldService } from '../server/services/partner-field.service';

const stamp = Date.now().toString(36);
const bpIds: number[] = [], adminIds: number[] = [], userIds: number[] = [], empIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;

async function main() {
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const mkCat = async (name: string) => { const [c] = await db.insert(serviceCategories).values({ name: `QA ${name} ${stamp}`, isActive: true } as any).returning(); catIds.push(c.id); return c; };
    const mkSvc = async (categoryId: number, name: string) => { const [s] = await db.insert(services).values({ categoryId, name: `QA ${name} ${stamp}`, basePrice: 499, isActive: true, status: 'ACTIVE' } as any).returning(); svcIds.push(s.id); return s; };
    const computer = await mkCat('Computer'), visiting = await mkCat('Visiting & Inspection'), plumbingCat = await mkCat('Plumbing');
    const laptop = await mkSvc(computer.id, 'Laptop keyboard replacement');
    const osInstall = await mkSvc(computer.id, 'OS Installation');
    const computerVisit = await mkSvc(visiting.id, 'Computer Service');
    const plumbingVisit = await mkSvc(visiting.id, 'Plumbing Work');
    const tap = await mkSvc(plumbingCat.id, 'Tap repair');

    const mkPartner = async (name: string, opts: { pincode?: string | null; verticals: string[]; tech?: boolean; lists?: number[] }) => {
        const bp = await BusinessPartnerService.create({ legalName: `QA ${name} ${stamp}`, displayName: name, contactPhone: phone(), contactEmail: `qa_area_${stamp}_${++n}@example.test`, pincode: opts.pincode ?? null, verticalCodes: opts.verticals, approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        if (opts.tech !== false) {
            const [u] = await db.insert(users).values({ phone: phone(), username: `QA ${name} Tech`, role: 'serviceman', isActive: true } as any).returning(); userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: `QA ${name} Tech`, documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: bp.id } as any).returning(); empIds.push(e.id);
        }
        for (const id of opts.lists ?? []) await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: id, name: 'listed', isActive: true } as any);
        return bp;
    };
    const sirsi = await mkPartner('Sirsi Computers', { pincode: '581401', verticals: ['computer'] });
    const noPin = await mkPartner('Nowhere Computers', { pincode: null, verticals: ['computer'] });
    const noTech = await mkPartner('Empty Computers', { pincode: '581401', verticals: ['computer'], tech: false });
    const listed = await mkPartner('Laptop Only', { pincode: '581401', verticals: ['computer'], lists: [laptop.id] });
    const plumber = await mkPartner('Sirsi Plumbers', { pincode: '581401', verticals: ['plumbing'] });
    const shop = await mkPartner('Gadget Shop', { pincode: '581401', verticals: ['electronics'] });   // no field service

    const names = async (catalogServiceId: number, pincode: string) => (await ProviderChoiceService.partnerOptions({ catalogServiceId, pincode })).filter(p => bpIds.includes(p.id)).map(p => p.name).sort();

    // ── area ──
    check('a partner is offered in its own postal district: Sirsi (581401) for a Karwar address (581301)', (await names(laptop.id, '581301')).includes('Sirsi Computers'));
    check('…not in another district (560001)', !(await names(laptop.id, '560001')).includes('Sirsi Computers'));
    check('a partner with no pincode on file (and no territories) is offered nowhere', !(await names(laptop.id, '581401')).includes('Nowhere Computers'));
    check('a partner without a verified technician is not offered (nobody to send)', !(await names(laptop.id, '581401')).includes('Empty Computers'));
    check('a partner without Field service (a shop) is not offered', !(await names(laptop.id, '581401')).includes('Gadget Shop'));

    // ── services ──
    check('with no list, a partner takes every service of its verticals: Computer category', (await names(osInstall.id, '581401')).includes('Sirsi Computers'));
    check('…and "Computer Service" under Visiting & Inspection', (await names(computerVisit.id, '581401')).includes('Sirsi Computers'));
    check('…but not plumbing work', !(await names(plumbingVisit.id, '581401')).includes('Sirsi Computers'));
    check('a plumbing partner gets plumbing work and the Plumbing category', (await names(plumbingVisit.id, '581401')).includes('Sirsi Plumbers') && (await names(tap.id, '581401')).includes('Sirsi Plumbers'));
    check('a partner that listed services takes only those', (await names(laptop.id, '581401')).includes('Laptop Only') && !(await names(osInstall.id, '581401')).includes('Laptop Only'));

    // ── what the customer sees ──
    const opts = (await ProviderChoiceService.partnerOptions({ catalogServiceId: laptop.id, pincode: '581301' })).find(p => p.id === sirsi.id);
    check('the customer sees the business name and how many technicians it has, not a technician', opts?.name === 'Sirsi Computers' && opts.technicians === 1);
    let chose = true;
    try { await ProviderChoiceService.validate({ type: 'partner', id: sirsi.id } as any, { catalogServiceId: laptop.id, pincode: '581301', location: null }); } catch { chose = false; }
    check('…and can book it (the choice is accepted)', chose);
    let refused = false;
    try { await ProviderChoiceService.validate({ type: 'partner', id: sirsi.id } as any, { catalogServiceId: tap.id, pincode: '581301', location: null }); } catch { refused = true; }
    check('…but not for work it does not take', refused);

    // ── staff see the same thing ──
    const c = (await PartnerFieldService.dispatchCandidates()).find(x => x.id === sirsi.id)!;
    check('staff\'s "Send to partner" uses the same rules', PartnerFieldService.covers(c, '581301') && PartnerFieldService.takesService(c, await PartnerFieldService.serviceInfo(laptop.id)) && !PartnerFieldService.covers(c, '560001'));
    void noPin; void noTech; void listed; void plumber; void shop;
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await cleanupPartners(bpIds, [...adminIds], [
        `DELETE FROM employees WHERE id IN (${empIds.join(',') || '0'})`,
        `DELETE FROM users WHERE id IN (${userIds.join(',') || '0'})`,
    ]);
    await db.execute(sql.raw(`DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`));
    process.exit(summary());
});
