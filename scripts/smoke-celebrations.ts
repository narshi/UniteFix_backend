/**
 * UniteFix Celebrations end to end — halls and photographers.
 *
 *   Halls: page and policies, spaces and rents (weekday / weekend / peak),
 *   staff review before going live, availability, pricing, instant booking
 *   with a held date and an advance link, no double booking, blocks, hold
 *   lapse, confirm-first requests, the client's page (cancel, review),
 *   deposit, commission on the statement and the fee invoice.
 *   Photographers: portfolio (albums, photos, films; clips refused without
 *   cloud storage), packages and extras, crews, requests with a drafted
 *   quotation, booking the crew on confirmation.
 *
 *   npm run smoke:celebrations
 */

import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, eventBookings, bookingCalendar, eventEnquiries, businessPartnerLedger, hubAlerts, partnerQuotations } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { CelebrationBookings } from '../server/services/celebration-bookings.service';
import { TaxDocumentService } from '../server/services/tax-documents.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];
const ist = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const nextDow = (from: string, w: number) => { let d = from; while (dow(d) !== w) d = add(d, 1); return d; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAAASUVORK5CYII=', 'base64');
const photo = (extra: Record<string, string> = {}) => { const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png'); Object.entries(extra).forEach(([k, v]) => fd.append(k, v)); return fd; };

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const st = (await api.login(sa.username, sa.password))!;
        const mk = async (name: string, verticals: string[], n: string, p1: string) => {
            const bp = await BusinessPartnerService.create({ legalName: `QA ${name} ${stamp}`, displayName: name, gstin: await gstinFor('29', `${n}1234K`), contactPhone: `${p1}${String(Date.now()).slice(-9)}`, contactEmail: `qa_cel_${n}_${stamp}@example.test`, verticalCodes: verticals, approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada' });
            bpIds.push(bp.id);
            await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(eq(businessPartners.id, bp.id));
            const l = await PartnerHubService.createOwnerLogin(bp.id, {});
            const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, l.username)); if (r) adminIds.push(r.id);
            return { bp, t: (await api.login(l.username, l.temporaryPassword))! };
        };
        const hall = await mk('Sagar Convention Hall', ['hall'], 'SAGRH', '7');
        await new Promise(r => setTimeout(r, 5));
        const ph = await mk('Lens & Light Studio', ['photography'], 'LENSL', '8');
        await new Promise(r => setTimeout(r, 5));
        const other = await mk('QA Consultant', ['consultation'], 'CONSL', '6');
        await new Promise(r => setTimeout(r, 5));
        const pl = await mk('Utsav Planners', ['events'], 'UTSVP', '9');
        const H = hall.t, P = ph.t;

        // ════════════════════════════════════════════════════════════════
        // HALLS
        // ════════════════════════════════════════════════════════════════
        const me = await api.get('/api/hub/me', H);
        check('a hall partner gets the Venue and Events modules', me.body?.data?.modules?.includes('venue') && me.body.data.modules.includes('events') && !me.body.data.modules.includes('portfolio'));
        check('a partner without a hall cannot open the venue pages', (await api.get('/api/hub/venue', other.t)).status === 403);

        const wed = nextDow(add(ist(), 40), 3);         // a Wednesday ~6 weeks out: weekday
        const sat = nextDow(wed, 6);                    // weekend
        const peak = add(wed, 7);                       // a Wednesday marked peak
        const prof = await api.put('/api/hub/venue/profile', {
            tagline: 'A 600-guest AC hall with a garden lawn', address: 'NH 66, Kodibag, Karwar 581303', amenities: ['Air conditioning', 'Car parking', 'Stage'], rooms: 6, parking: 80,
            rules: { vegOnly: true, alcohol: 'no', outsideCaterers: false, musicUntil: '22:30' }, weekendDays: [0, 6], peakDates: [{ date: peak, label: 'Muhurtham' }],
            advancePercent: 25, balanceDueDays: 7, depositRupees: 10000, cancellation: [{ daysBefore: 60, refundPercent: 90 }, { daysBefore: 30, refundPercent: 50 }, { daysBefore: 0, refundPercent: 0 }], instantBooking: true, holdHours: 24,
        }, H);
        check('hall page and policies save (peak dates, weekend days, advance, deposit, cancellation)', prof.status === 200 && prof.body.data.profile.peakDates.length === 1 && prof.body.data.profile.depositRupees === 10000, JSON.stringify(prof.body?.message));
        check('a link that is not Google Maps is refused', (await api.put('/api/hub/venue/profile', { mapUrl: 'https://example.com/map' }, H)).body?.code === 'BAD_MAP');
        check('refunds that grow as the date nears are refused', (await api.put('/api/hub/venue/profile', { cancellation: [{ daysBefore: 60, refundPercent: 10 }, { daysBefore: 10, refundPercent: 80 }] }, H)).body?.code === 'BAD_POLICY');
        check('a video tour that is not YouTube / Vimeo / Instagram is refused', (await api.put('/api/hub/venue/profile', { videoUrl: 'https://example.com/v.mp4' }, H)).body?.code === 'BAD_VIDEO');
        const tour = await api.put('/api/hub/venue/profile', { videoUrl: 'https://youtu.be/dQw4w9WgXcQ?t=3' }, H);
        check('a YouTube tour link is stored in its clean form', tour.body?.data?.profile?.videoUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

        const main = await api.post('/api/hub/venue/spaces', { name: 'Main hall', kind: 'banquet', seated: 400, floating: 600, ratesRupees: { weekday: { am: 40000, pm: 60000 }, weekend: { pm: 75000 }, peak: { pm: 90000 } }, gstRate: 18 }, H);
        const lawn = await api.post('/api/hub/venue/spaces', { name: 'Garden lawn', kind: 'lawn', floating: 300, ratesRupees: { weekday: { pm: 30000 } } }, H);
        check('spaces with capacity and rents', main.status === 201 && lawn.status === 201);
        const sub0 = await api.post('/api/hub/venue/listing/submit', {}, H);
        check('the page cannot be submitted before it is ready (cover, about, photos)', sub0.status === 409 && sub0.body?.code === 'NOT_READY');
        for (let i = 0; i < 3; i++) await api.upload(`/api/hub/venue/spaces/${main.body.data.id}/photos`, photo(), H);
        await api.upload(`/api/hub/venue/spaces/${lawn.body.data.id}/photos`, photo(), H);
        await api.upload('/api/hub/venue/cover', photo(), H);
        await api.put('/api/hub/venue/profile', { about: 'Forty years of weddings in Karwar. Two halls, a garden lawn and rooms for the families.' }, H);
        const vs = await api.get('/api/hub/venue', H);
        const ms = vs.body.data.spaces.find((s: any) => s.id === main.body.data.id);
        check('a full day not priced on its own is morning + evening; from-price is the cheapest weekday slot', ms.offered.join() === 'am,pm,full' && ms.from === 40000 && vs.body.data.readiness.ready, JSON.stringify({ o: ms.offered, f: ms.from, r: vs.body.data.readiness }));
        check('the hall sees its commission rate (5% by default)', vs.body.data.commissionPercent === 5);

        check('not public before UniteFix approves it', (await api.get(`/api/public/halls/${hall.bp.partnerCode}`)).status === 404);
        check('the partner can preview it', (await api.get('/api/hub/venue/preview', H)).body?.data?.spaces?.length === 2);
        const sub = await api.post('/api/hub/venue/listing/submit', {}, H);
        check('submitted for review', sub.status === 200 && sub.body.data.listing.status === 'submitted');
        const queue = await api.get('/api/admin/hub/celebrations/listings?status=submitted', st);
        check('staff see it in the review queue', queue.body?.data?.listings?.some((l: any) => l.businessPartnerId === hall.bp.id && l.kind === 'venue'));
        check('staff can preview the page before approving', (await api.get(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/preview`, st)).body?.data?.page?.name === 'Sagar Convention Hall');
        check('asking for changes needs a note', (await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/review`, { decision: 'changes' }, st)).body?.code === 'NO_NOTE');
        const ok = await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/review`, { decision: 'approve' }, st);
        check('staff approve: the page is live', ok.status === 200 && ok.body.data.status === 'live');
        const [la] = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, hall.bp.id), eq(hubAlerts.kind, 'listing_reviewed')));
        check('the hall is told its page is live', !!la);
        const pub = await api.get(`/api/public/halls/${hall.bp.partnerCode}`);
        check('the public page: spaces, rates by kind of day, policies, video tour', pub.status === 200 && pub.body.data.spaces.length === 2 && pub.body.data.policies.deposit === 10000 && pub.body.data.profile.video?.provider === 'youtube'
            && pub.body.data.spaces[0].rates.find((r: any) => r.type === 'peak').pm === 90000 && pub.body.data.spaces[0].rates.find((r: any) => r.type === 'weekend').am === 40000);

        const av = await api.get(`/api/public/halls/${hall.bp.partnerCode}/availability?spaceId=${main.body.data.id}&month=${peak.slice(0, 7)}`);
        const pk = av.body?.data?.days?.find((d: any) => d.day === peak);
        check('availability marks peak dates and free slots', pk?.type === 'peak' && pk.label === 'Muhurtham' && pk.am === 'free' && pk.pm === 'free');

        // add-on: catering per plate
        const food = await api.post('/api/hub/events/packages', { name: 'Veg buffet', category: 'catering', unit: 'plate', priceRupees: 450, sac: '996337', gstRate: 5 }, H);
        const sid = main.body.data.id;
        const e1 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: wed, slot: 'pm', guests: 300, addons: [{ packageId: food.body.data.id }] });
        // 60,000 @18% + 300 × 450 = 1,35,000 @5% → 1,95,000 + 10,800 + 6,750
        check('price: weekday evening rent + catering for 300, each at its GST; 25% advance', e1.status === 200 && e1.body.data.taxable === 195000 && e1.body.data.gst === 17550 && e1.body.data.total === 212550 && e1.body.data.advance === 53137.5 && e1.body.data.available === true, JSON.stringify(e1.body?.data ?? e1.body));
        const e2 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: sat, slot: 'pm' });
        const e3 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: peak, slot: 'pm' });
        const e4 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: sat, slot: 'full' });
        check('weekend and peak rents; a weekend morning falls back to the weekday rent', e2.body?.data?.taxable === 75000 && e3.body?.data?.taxable === 90000 && e4.body?.data?.taxable === 115000, JSON.stringify([e2.body?.data?.taxable, e3.body?.data?.taxable, e4.body?.data?.taxable]));
        check('more guests than the space holds is refused', (await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: wed, slot: 'pm', guests: 700 })).body?.code === 'TOO_MANY_GUESTS');
        check('a slot the space does not let is refused', (await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: lawn.body.data.id, date: wed, slot: 'am' })).body?.code === 'NO_SLOT');

        // ── instant booking ──
        const who = { name: 'QA Priya Shetty', phone: '9876500211', email: `qa_client_${stamp}@example.test` };
        const r1 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: wed, slot: 'pm', guests: 300, occasion: 'Wedding reception', addons: [{ packageId: food.body.data.id }], ...who });
        check('instant booking: the date is held and the client gets an advance link', r1.status === 201 && r1.body.data.instant && /^\/pay\//.test(r1.body.data.payUrl ?? '') && /^\/celebrations\/b\//.test(r1.body.data.link), JSON.stringify(r1.body));
        const tok1 = r1.body.data.link.split('/').pop();
        const [b1] = await db.select().from(eventBookings).where(and(eq(eventBookings.businessPartnerId, hall.bp.id), eq(eventBookings.eventDate, wed)));
        check('the booking is pending (advance awaited), a hall booking from the public page, at 5% commission, with the deposit due', b1?.status === 'pending' && b1.kind === 'hall' && b1.origin === 'public' && Number(b1.commissionPercent) === 5 && b1.depositStatus === 'due' && b1.totalPaise === 21255000);
        const cal1 = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.businessPartnerId, hall.bp.id), eq(bookingCalendar.day, wed), eq(bookingCalendar.status, 'hold')));
        check('the evening is held on the calendar, linked to the booking', cal1.length === 1 && cal1[0].part === 'pm' && cal1[0].bookingId === b1.id);
        const [q1] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.id, b1.quotationId));
        check('a quotation of exactly that, accepted by the client on the page', q1.status === 'accepted' && q1.totalPaise === 21255000);
        const dup = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: wed, slot: 'pm', occasion: 'Party', name: 'QA Other', phone: '9876500212' });
        const dupFull = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: wed, slot: 'full', occasion: 'Party', name: 'QA Other', phone: '9876500212' });
        check('no double booking: the same evening, or a full day over it, is refused', dup.status === 409 && dup.body.code === 'TAKEN' && dupFull.status === 409);
        // the database is the guard, not the check before it
        let raced = false;
        try { await db.insert(bookingCalendar).values({ businessPartnerId: hall.bp.id, resourceKind: 'space', resourceId: sid, day: wed, part: 'pm', status: 'hold' }); } catch (e: any) { raced = e?.code === '23505' || e?.cause?.code === '23505'; }
        check('the database itself refuses a second live row for the same slot', raced);
        const morning = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: wed, slot: 'am', occasion: 'Naming ceremony', name: 'QA Ravi', phone: '9876500213' });
        check('the morning of the same day is still free to book', morning.status === 201);
        const mtok = morning.body.data.link.split('/').pop();
        const mc = await api.post(`/api/public/celebrations/b/${mtok}/cancel`, { note: 'Changed plans' });
        const mcal = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.businessPartnerId, hall.bp.id), eq(bookingCalendar.day, wed), eq(bookingCalendar.part, 'am'), sql`${bookingCalendar.status} in ('hold','booked')`));
        check('a client who has not paid can cancel; the morning is free again', mc.status === 200 && mc.body.data.cancelled && mcal.length === 0);

        const view = await api.get(`/api/public/celebrations/b/${tok1}`);
        check('the client page: held, the advance to pay with its link, the deposit and the terms', view.body?.data?.booking?.status === 'pending' && view.body.data.booking.milestones[0].payUrl && view.body.data.booking.deposit.amount === 10000 && view.body.data.booking.cancellation.length === 3);
        const [alert1] = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, hall.bp.id), eq(hubAlerts.kind, 'booking_request')));
        check('the hall is alerted to the booking', !!alert1);

        // advance paid (recorded by the hall) → confirmed, booked
        const bd = await api.get(`/api/hub/events/bookings/${b1.id}`, H);
        const adv = bd.body.data.milestones[0];
        check('the advance is 25% and the balance is due a week before', adv.amount === 53137.5 || adv.amount === 53138, JSON.stringify(bd.body.data.milestones.map((m: any) => [m.amount, m.dueDate])));
        const pay = await api.post(`/api/hub/events/milestones/${adv.id}/pay`, { method: 'upi', reference: 'UPI123' }, H);
        const [b1b] = await db.select().from(eventBookings).where(eq(eventBookings.id, b1.id));
        const cal2 = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.bookingId, b1.id), eq(bookingCalendar.status, 'booked')));
        check('paying the advance confirms the booking and books the date (with a receipt voucher)', pay.status === 200 && b1b.status === 'confirmed' && cal2.length === 1 && !!pay.body?.data?.voucher, JSON.stringify(pay.body?.message));
        const hc = await api.get(`/api/hub/venue/calendar?month=${wed.slice(0, 7)}`, H);
        check('the hall calendar shows it as booked, with the event', hc.body?.data?.entries?.some((e: any) => e.day === wed && e.status === 'booked' && /Wedding reception/.test(e.who ?? '')));
        const dep = await api.post(`/api/hub/venue/bookings/${b1.id}/deposit`, { status: 'collected' }, H);
        check('the hall records the deposit', dep.status === 200 && dep.body.data.depositStatus === 'collected');
        check('keeping a deposit needs a reason', (await api.post(`/api/hub/venue/bookings/${b1.id}/deposit`, { status: 'withheld' }, H)).body?.code === 'NO_NOTE');

        // blocks
        const blk = await api.post('/api/hub/venue/calendar/block', { spaceId: sid, from: add(wed, 1), slot: 'full', note: 'Walk-in wedding' }, H);
        const onBlocked = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: add(wed, 1), slot: 'pm', occasion: 'Party', name: 'QA X', phone: '9876500214' });
        check('the hall blocks its own date; clients cannot book it', blk.status === 201 && onBlocked.status === 409);
        const blocked = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.businessPartnerId, hall.bp.id), eq(bookingCalendar.day, add(wed, 1)), eq(bookingCalendar.status, 'blocked')));
        const unb = await api.post('/api/hub/venue/calendar/unblock', { ids: [...blocked.map(b => b.id), cal2[0].id] }, H);
        check('unblocking frees it — and never releases a client booking', unb.body?.data?.released === 2 && (await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.id, cal2[0].id), eq(bookingCalendar.status, 'booked')))).length === 1);

        // hold lapse
        const r2 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: sat, slot: 'pm', occasion: 'Engagement', name: 'QA Late Payer', phone: '9876500215' });
        const [b2] = await db.select().from(eventBookings).where(and(eq(eventBookings.businessPartnerId, hall.bp.id), eq(eventBookings.eventDate, sat)));
        const past = new Date(Date.now() - 60_000);
        await db.update(eventBookings).set({ holdExpiresAt: past }).where(eq(eventBookings.id, b2.id));
        await db.update(bookingCalendar).set({ holdExpiresAt: past }).where(eq(bookingCalendar.bookingId, b2.id));
        const payLink = r2.body.data.payUrl.split('/').pop();
        await CelebrationBookings.tick();
        const [b2b] = await db.select().from(eventBookings).where(eq(eventBookings.id, b2.id));
        const [e2b] = await db.select().from(eventEnquiries).where(eq(eventEnquiries.id, b2.enquiryId!));
        const live2 = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.bookingId, b2.id), sql`${bookingCalendar.status} in ('hold','booked')`));
        check('an unpaid hold lapses: booking cancelled, date released, request closed', b2b.status === 'cancelled' && live2.length === 0 && e2b.status === 'lost');
        const late = await api.post(`/api/public/pay/${payLink}/order`, {});
        check('its payment link no longer takes money', late.status === 410 || late.status === 409, JSON.stringify(late.body));
        check('the date can be booked again', (await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: sat, slot: 'pm' })).body?.data?.available === true);

        // confirm-first
        await api.put('/api/hub/venue/profile', { instantBooking: false, holdHours: 12 }, H);
        const cf = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: lawn.body.data.id, date: add(wed, 2), slot: 'pm', guests: 120, occasion: 'Birthday', name: 'QA Asha', phone: '9876500216' });
        check('confirm-first: a request holds the date, no booking yet', cf.status === 201 && !cf.body.data.instant && !cf.body.data.payUrl);
        const reqs = await api.get('/api/hub/venue/requests', H);
        const cfr = reqs.body?.data?.find((x: any) => x.date === add(wed, 2));
        check('the hall sees the request with the time it is held until', !!cfr && cfr.held && !!cfr.heldUntil);
        const acc = await api.post(`/api/hub/venue/requests/${cfr.id}/answer`, { decision: 'accept' }, H);
        const cfv = await api.get(`/api/public/celebrations/b/${cf.body.data.link.split('/').pop()}`);
        check('accepting creates the booking and sends the client the advance to pay', acc.status === 200 && cfv.body?.data?.booking?.status === 'pending' && !!cfv.body.data.booking.milestones[0].payUrl);
        const cf2 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: lawn.body.data.id, date: add(wed, 3), slot: 'pm', occasion: 'Party', name: 'QA Dev', phone: '9876500217' });
        const cf2r = (await api.get('/api/hub/venue/requests', H)).body.data.find((x: any) => x.date === add(wed, 3));
        const dec = await api.post(`/api/hub/venue/requests/${cf2r.id}/answer`, { decision: 'decline', reason: 'Lawn under repair' }, H);
        const cf2v = await api.get(`/api/public/celebrations/b/${cf2.body.data.link.split('/').pop()}`);
        check('declining releases the date and tells the client why', dec.status === 200 && cf2v.body?.data?.status === 'lost' && cf2v.body.data.lostReason === 'Lawn under repair');
        await api.put('/api/hub/venue/profile', { instantBooking: true, holdHours: 24 }, H);

        // client cancels a paid booking → the hall cancels with the refund the terms give
        const cr = await api.post(`/api/public/celebrations/b/${tok1}/cancel`, { note: 'Wedding postponed' });
        check('a client with a paid booking asks to cancel; the terms give 50% at 30–59 days', cr.status === 200 && cr.body.data.requested && cr.body.data.refundPercent === 50, JSON.stringify(cr.body));
        const bd2 = await api.get(`/api/hub/events/bookings/${b1.id}`, H);
        check('the hall sees the request and the refund under its terms', !!bd2.body.data.cancelRequestedAt && bd2.body.data.terms.refundPercentNow === 50 && bd2.body.data.terms.refundNow === Math.round(adv.amount * 50) / 100);
        const canc = await api.post(`/api/hub/events/bookings/${b1.id}/cancel`, { reason: 'Client postponed', refundRupees: bd2.body.data.terms.refundNow }, H);
        const [com] = await db.select().from(businessPartnerLedger).where(and(eq(businessPartnerLedger.businessPartnerId, hall.bp.id), eq(businessPartnerLedger.entryType, 'booking_commission')));
        const kept = Math.round(adv.amount * 100) - Math.round(bd2.body.data.terms.refundNow * 100);
        check('cancelled with a refund voucher; commission only on what the hall keeps (5% + GST)', canc.status === 200 && !!canc.body.data.voucher && com?.amountPaise === Math.round(kept * 0.05) + Math.round(Math.round(kept * 0.05) * 0.18), JSON.stringify({ c: com?.amountPaise, kept }));
        check('the date is free again', (await api.post(`/api/public/halls/${hall.bp.partnerCode}/estimate`, { spaceId: sid, date: wed, slot: 'pm' })).body?.data?.available === true);

        // the event takes place → completed, commission, review
        const r3 = await api.post(`/api/public/halls/${hall.bp.partnerCode}/request`, { spaceId: sid, date: peak, slot: 'pm', guests: 350, occasion: 'Wedding', name: 'Meera Nayak', phone: '9876500218', email: `qa_meera_${stamp}@example.test` });
        const tok3 = r3.body.data.link.split('/').pop();
        const [b3] = await db.select().from(eventBookings).where(and(eq(eventBookings.businessPartnerId, hall.bp.id), eq(eventBookings.eventDate, peak)));
        const b3m = (await api.get(`/api/hub/events/bookings/${b3.id}`, H)).body.data.milestones;
        for (const m of b3m) await api.post(`/api/hub/events/milestones/${m.id}/pay`, { method: 'cash' }, H);
        check('too early to review before the event', (await api.post(`/api/public/celebrations/b/${tok3}/review`, { rating: 5 })).body?.code === 'NOT_YET');
        const ago = add(ist(), -4);
        await db.update(eventBookings).set({ eventDate: ago }).where(eq(eventBookings.id, b3.id));
        await db.update(eventEnquiries).set({ eventDate: ago }).where(eq(eventEnquiries.id, b3.enquiryId!));
        await CelebrationBookings.tick();
        const [b3b] = await db.select().from(eventBookings).where(eq(eventBookings.id, b3.id));
        check('two days after the event it is completed, commission charged on the booking (5% + GST), the client asked for a review', b3b.status === 'completed' && b3b.commissionPaise === Math.round(b3.totalPaise * 0.05) && !!b3b.commissionChargedAt && !!b3b.reviewPromptedAt);
        const rv0 = await api.post(`/api/public/celebrations/b/${tok3}/review`, { rating: 2 });
        check('a low rating needs a few words', rv0.body?.code === 'NEED_TEXT');
        const rv = await api.post(`/api/public/celebrations/b/${tok3}/review`, { rating: 5, body: 'Spotless hall, the staff handled everything. Our guests loved the lawn.' });
        check('the client reviews the hall', rv.status === 201);
        check('only once per booking', (await api.post(`/api/public/celebrations/b/${tok3}/review`, { rating: 4, body: 'again' })).status === 409);
        const hr = await api.get('/api/hub/reviews', H);
        const rep = await api.post(`/api/hub/reviews/${hr.body.data[0].id}/reply`, { reply: 'Thank you, Meera — it was a joy to host you.' }, H);
        const pub2 = await api.get(`/api/public/halls/${hall.bp.partnerCode}`);
        check('the review is public with the hall\'s reply, as "Meera N."', rep.status === 200 && pub2.body.data.reviews.count === 1 && pub2.body.data.reviews.items[0].name === 'Meera N.' && /joy/.test(pub2.body.data.reviews.items[0].reply));
        const hide = await api.post(`/api/admin/hub/celebrations/reviews/${hr.body.data[0].id}`, { status: 'hidden', reason: 'Test' }, st);
        check('staff can hide a review', hide.status === 200 && (await api.get(`/api/public/halls/${hall.bp.partnerCode}`)).body.data.reviews.count === 0);
        await api.post(`/api/admin/hub/celebrations/reviews/${hr.body.data[0].id}`, { status: 'published' }, st);

        const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const fee = await TaxDocumentService.issueFeeInvoice(hall.bp.id, monthStart, null);
        const feeLines = fee ? await db.execute(sql`select description, taxable_paise from tax_document_lines where document_id = ${fee.id}`) : null;
        const line = (feeLines as any)?.rows?.find((l: any) => /Booking commission/.test(l.description));
        check('the monthly UniteFix fee invoice carries the booking commission', !!line && Number(line.taxable_paise) === Math.round(kept * 0.05) + b3b.commissionPaise!, JSON.stringify((feeLines as any)?.rows));

        const cm = await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/commission`, { percent: 4 }, st);
        const ft = await api.post(`/api/admin/hub/celebrations/listings/${hall.bp.id}/venue/feature`, { featured: true }, st);
        check('staff set a hall\'s own commission and feature it', cm.status === 200 && cm.body.data.commissionPercent === 4 && ft.body.data.featured === true);
        const bk = await api.get('/api/admin/hub/celebrations/bookings?kind=hall', st);
        check('staff see Celebrations bookings with commission — and no client names or phones', bk.status === 200 && bk.body.data.length >= 4 && !JSON.stringify(bk.body.data).includes('9876500218') && !JSON.stringify(bk.body.data).includes('Meera'));

        // ════════════════════════════════════════════════════════════════
        // PHOTOGRAPHERS
        // ════════════════════════════════════════════════════════════════
        const pme = await api.get('/api/hub/me', P);
        check('a photographer gets the Portfolio and Events modules', pme.body?.data?.modules?.includes('portfolio') && pme.body.data.modules.includes('events'));
        check('a hall cannot open portfolio pages', (await api.get('/api/hub/portfolio', H)).status === 403);
        const pp = await api.put('/api/hub/portfolio/profile', { tagline: 'Candid weddings across coastal Karnataka', about: 'Twelve years of weddings, from Udupi temples to Gokarna beaches. We tell your story, not pose it.', styles: ['Candid', 'Cinematic films'], travelAreas: ['Karwar', 'Goa', 'Udupi'], languages: ['Kannada', 'Konkani', 'English'], since: 2014, instagram: '@lensandlight', crews: 1, deliveryDays: 30 }, P);
        check('portfolio profile saves', pp.status === 200 && pp.body.data.profile.instagram === 'lensandlight' && pp.body.data.profile.crews === 1);
        check('a made-up year is refused', (await api.put('/api/hub/portfolio/profile', { since: 1800 }, P)).body?.code === 'BAD_YEAR');
        await api.upload('/api/hub/portfolio/cover', photo(), P);
        const al = await api.post('/api/hub/portfolio/albums', { title: 'Priya & Arjun, Gokarna', story: 'A sunset ceremony on Om beach.', location: 'Gokarna', category: 'wedding' }, P);
        const al2 = await api.post('/api/hub/portfolio/albums', { title: 'Baby Aarav', category: 'baby' }, P);
        check('albums', al.status === 201 && al2.status === 201);
        for (let i = 0; i < 8; i++) await api.upload(`/api/hub/portfolio/albums/${al.body.data.id}/photos`, photo({ caption: `Moment ${i + 1}` }), P);
        for (let i = 0; i < 4; i++) await api.upload(`/api/hub/portfolio/albums/${al2.body.data.id}/photos`, photo(), P);
        const film = await api.post(`/api/hub/portfolio/albums/${al.body.data.id}/films`, { url: 'https://vimeo.com/123456789', caption: 'Wedding film' }, P);
        check('a Vimeo film is linked with a privacy-friendly embed', film.status === 201 && film.body.data.embed === 'https://player.vimeo.com/video/123456789?dnt=1');
        check('the same film twice is refused', (await api.post(`/api/hub/portfolio/albums/${al.body.data.id}/films`, { url: 'https://www.vimeo.com/123456789' }, P)).status === 409);
        check('a link that is not a video is refused', (await api.post(`/api/hub/portfolio/albums/${al.body.data.id}/films`, { url: 'https://example.com/x' }, P)).body?.code === 'BAD_VIDEO');
        const clipFd = new FormData(); clipFd.append('file', new Blob([Buffer.from('fake')], { type: 'video/mp4' }), 'c.mp4');
        const clip = await api.upload(`/api/hub/portfolio/albums/${al.body.data.id}/clips`, clipFd, P);
        check('without cloud storage a clip is refused with a way forward (link it instead)', clip.status === 503 && clip.body?.code === 'NO_VIDEO_STORAGE');
        const media = await api.get(`/api/hub/portfolio/albums/${al.body.data.id}/media`, P);
        const feat = await api.patch(`/api/hub/portfolio/media/${media.body.data.media[2].id}`, { featured: true }, P);
        check('photos in an album, one featured', media.body.data.media.length === 9 && feat.body?.data?.featured === true);
        const theirs = await api.patch(`/api/hub/portfolio/media/${media.body.data.media[0].id}`, { featured: true }, H);
        check('another partner cannot touch them', theirs.status === 403 || theirs.status === 404);

        const wpk = await api.post('/api/hub/events/packages', { name: 'Wedding — candid + film', category: 'photography', unit: 'day', priceRupees: 40000, description: '2 photographers, 1 videographer', sac: '998383', gstRate: 18 }, P);
        const drone = await api.post('/api/hub/events/packages', { name: 'Drone', category: 'photography', unit: 'event', priceRupees: 8000, isAddon: true, sac: '998383', gstRate: 18 }, P);
        check('packages and extras (extras marked as add-ons)', wpk.status === 201 && drone.body?.data?.isAddon === true);
        const psub = await api.post('/api/hub/portfolio/listing/submit', {}, P);
        check('submitted once 12 photos, an album of 6 and a package are in', psub.status === 200, JSON.stringify(psub.body));
        await api.post(`/api/admin/hub/celebrations/listings/${ph.bp.id}/portfolio/review`, { decision: 'approve' }, st);
        const pport = await api.get(`/api/public/photographers/${ph.bp.partnerCode}`);
        const d = pport.body?.data;
        check('the public portfolio: featured work filled from albums, albums, the film, packages and extras', pport.status === 200 && d.featured.length >= 9 && d.featured[0].featured === true && d.albums.length === 2 && d.films.length === 1 && d.packages.length === 1 && d.addons.length === 1 && d.stats.photos === 12, JSON.stringify({ f: d?.featured?.length, a: d?.albums?.length }));
        const alb = await api.get(`/api/public/photographers/${ph.bp.partnerCode}/albums/${al.body.data.id}`);
        check('an album page: the story and every photo and film', alb.body?.data?.album?.story?.includes('Om beach') && alb.body.data.media.length === 9 && alb.body.data.others.length === 1);
        await api.patch(`/api/hub/portfolio/albums/${al2.body.data.id}`, { isPublished: false }, P);
        check('an unpublished album is not public', (await api.get(`/api/public/photographers/${ph.bp.partnerCode}/albums/${al2.body.data.id}`)).status === 404);

        const shootDay = add(wed, 5);
        const pe = await api.post(`/api/public/photographers/${ph.bp.partnerCode}/estimate`, { packageId: wpk.body.data.id, days: 2, addons: [{ packageId: drone.body.data.id }], date: shootDay, slot: 'full' });
        check('price: a 2-day package + drone, with GST, and the dates are free', pe.body?.data?.taxable === 88000 && pe.body.data.total === 103840 && pe.body.data.available === true, JSON.stringify(pe.body));
        const preq = await api.post(`/api/public/photographers/${ph.bp.partnerCode}/request`, { packageId: wpk.body.data.id, days: 2, addons: [{ packageId: drone.body.data.id }], date: shootDay, slot: 'full', occasion: 'Wedding', location: 'Gokarna', name: 'QA Kiran', phone: '9876500219' });
        check('a shoot request holds the crew for both days', preq.status === 201 && (await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.businessPartnerId, ph.bp.id), eq(bookingCalendar.status, 'hold')))).length === 4, JSON.stringify(preq.body));
        const busy = await api.post(`/api/public/photographers/${ph.bp.partnerCode}/request`, { packageId: wpk.body.data.id, date: add(shootDay, 1), slot: 'pm', occasion: 'Reception', location: 'Karwar', name: 'QA Other', phone: '9876500220' });
        check('with one crew, an overlapping day is refused', busy.status === 409);
        await api.put('/api/hub/portfolio/profile', { crews: 2 }, P);
        const busy2 = await api.post(`/api/public/photographers/${ph.bp.partnerCode}/request`, { packageId: wpk.body.data.id, date: add(shootDay, 1), slot: 'pm', occasion: 'Reception', location: 'Karwar', name: 'QA Other', phone: '9876500220' });
        check('a studio with two crews can take it', busy2.status === 201);
        const [pen] = await db.select().from(eventEnquiries).where(and(eq(eventEnquiries.businessPartnerId, ph.bp.id), eq(eventEnquiries.eventDate, shootDay)));
        const [pq] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.sourceRefId, pen.id), eq(partnerQuotations.source, 'events')));
        check('a quotation of exactly that is drafted for the photographer to send', pen.kind === 'shoot' && pq?.status === 'draft' && pq.totalPaise === 10384000);
        const share = await api.post(`/api/hub/events/quotations/${pq.id}/share`, {}, P);
        const qtok = share.body?.data?.link?.split('/').pop();
        await api.post(`/api/public/events/q/${qtok}/respond`, { decision: 'accept' });
        const pb = await api.post('/api/hub/events/bookings', { quotationId: pq.id }, P);
        const [pbk] = await db.select().from(eventBookings).where(eq(eventBookings.id, pb.body?.data?.id ?? 0));
        const booked = await db.select().from(bookingCalendar).where(and(eq(bookingCalendar.bookingId, pbk?.id ?? 0), eq(bookingCalendar.status, 'booked')));
        check('confirming the booking books the crew for both days, at 8% commission', pb.status === 201 && pbk.kind === 'shoot' && pbk.origin === 'public' && Number(pbk.commissionPercent) === 8 && booked.length === 4, JSON.stringify({ s: pb.status, k: pbk?.kind, n: booked.length }));
        // The two days can straddle a month end (a shoot on the 30th): read both months.
        const months = Array.from(new Set([shootDay.slice(0, 7), add(shootDay, 1).slice(0, 7)]));
        const entries = (await Promise.all(months.map(m => api.get(`/api/hub/portfolio/calendar?month=${m}`, P)))).flatMap(r => r.body?.data?.entries ?? []);
        check('the photographer\'s calendar shows the booked days and the other hold', entries.filter((e: any) => e.status === 'booked').length === 4 && entries.some((e: any) => e.status === 'hold' && e.crew === 2), JSON.stringify(entries.map((e: any) => `${e.day}:${e.status}`)));
        const away = await api.post('/api/hub/portfolio/calendar/block', { from: add(shootDay, 10), slot: 'full', note: 'Away' }, P);
        const pav = await api.get(`/api/public/photographers/${ph.bp.partnerCode}/availability?month=${add(shootDay, 10).slice(0, 7)}`);
        check('blocking a day blocks every crew; the public sees it taken', away.status === 201 && pav.body?.data?.days?.find((x: any) => x.day === add(shootDay, 10))?.pm === false);

        // ════════════════════════════════════════════════════════════════
        // SEARCH, PLANNERS AND PLANS
        // ════════════════════════════════════════════════════════════════
        const L = pl.t;
        const notReady = await api.post('/api/hub/events/listing/submit', {}, L);
        check('a planner cannot list in Celebrations before the page is ready', notReady.body?.code === 'NOT_READY');
        await api.put('/api/hub/events/showcase', { tagline: 'Décor and the whole day, done right', about: 'Weddings, naming ceremonies and birthdays across Uttara Kannada since 2015.' }, L);
        await api.upload('/api/hub/events/showcase/cover', photo(), L);
        for (let i = 0; i < 4; i++) await api.upload('/api/hub/events/gallery/upload', photo(), L);
        const decor = await api.post('/api/hub/events/packages', { name: 'Floral mandap', category: 'decor', unit: 'event', priceRupees: 35000, sac: '998596', gstRate: 18 }, L);
        const lsub = await api.post('/api/hub/events/listing/submit', {}, L);
        await api.post(`/api/admin/hub/celebrations/listings/${pl.bp.id}/events/review`, { decision: 'approve' }, st);
        check('a planner submits their page and UniteFix approves it', lsub.status === 200 && (await api.get('/api/hub/events/listing', L)).body?.data?.listing?.status === 'live');

        const cities = await api.get('/api/public/celebrations/cities');
        check('the cities list counts live halls, photographers and planners', cities.body?.data?.some((c: any) => c.city === 'Uttara Kannada' && c.halls >= 1 && c.photographers >= 1 && c.planners >= 1));
        const pday = add(sat, 14);
        const sh = await api.get(`/api/public/celebrations/search?type=halls&city=uttara&date=${pday}&guests=300`);
        const hcard = sh.body?.data?.results?.find((c: any) => c.code === hall.bp.partnerCode);
        check('search finds the hall by town, free on the date, with its price, capacity and highlights', !!hcard && hcard.available === true && hcard.from === 30000 && hcard.capacity === 600 && hcard.featured === true && hcard.highlights.includes('Veg only'), JSON.stringify(hcard));
        check('a hall too small for the guests is left out', !(await api.get(`/api/public/celebrations/search?type=halls&city=uttara&guests=700`)).body?.data?.results?.some((c: any) => c.code === hall.bp.partnerCode));
        check('by pincode too (same district / area)', (await api.get('/api/public/celebrations/search?type=halls&pincode=581305')).body?.data?.results?.some((c: any) => c.code === hall.bp.partnerCode));
        check('amenity and veg filters', (await api.get('/api/public/celebrations/search?type=halls&city=uttara&amenities=Stage&veg=1')).body?.data?.results?.some((c: any) => c.code === hall.bp.partnerCode)
            && !(await api.get('/api/public/celebrations/search?type=halls&city=uttara&amenities=Swimming%20pool')).body?.data?.results?.some((c: any) => c.code === hall.bp.partnerCode));
        await api.post('/api/hub/venue/calendar/block', { spaceId: sid, from: pday, slot: 'full' }, H);
        await api.post('/api/hub/venue/calendar/block', { spaceId: lawn.body.data.id, from: pday, slot: 'full' }, H);
        const sh2 = await api.get(`/api/public/celebrations/search?type=halls&city=uttara&date=${pday}`);
        check('with every space taken that day the card says so', sh2.body?.data?.results?.find((c: any) => c.code === hall.bp.partnerCode)?.available === false);
        const sp = await api.get(`/api/public/celebrations/search?type=photographers&city=goa&style=Candid&date=${add(shootDay, 20)}`);
        check('photographers by the places they travel to and style, free on the date', sp.body?.data?.results?.find((c: any) => c.code === ph.bp.partnerCode)?.available === true && sp.body.data.results.find((c: any) => c.code === ph.bp.partnerCode).from === 40000);
        check('a style they do not shoot leaves them out', !(await api.get('/api/public/celebrations/search?type=photographers&style=Fashion')).body?.data?.results?.some((c: any) => c.code === ph.bp.partnerCode));
        const spl = await api.get('/api/public/celebrations/search?type=planners&city=uttara');
        check('planners appear once live', spl.body?.data?.results?.some((c: any) => c.code === pl.bp.partnerCode && c.from === 35000));
        check('a past date is refused', (await api.get('/api/public/celebrations/search?type=halls&date=2020-01-01')).status === 400);

        // a plan: hall + photographer + planner, one date
        const planDay = add(sat, 21);
        const holdsBefore = (await db.select().from(bookingCalendar).where(sql`${bookingCalendar.businessPartnerId} in (${hall.bp.id}, ${ph.bp.id}) and ${bookingCalendar.status} = 'hold'`)).length;
        await api.post('/api/hub/venue/calendar/block', { spaceId: sid, from: add(planDay, 7), slot: 'full' }, H);
        const bad = await api.post('/api/public/celebrations/plan', { date: add(planDay, 7), occasion: 'Wedding', guests: 250, name: 'Anita Rao', phone: '9876500231', items: [
            { type: 'hall', code: hall.bp.partnerCode, spaceId: sid, slot: 'pm' }, { type: 'photographer', code: ph.bp.partnerCode, packageId: wpk.body.data.id, slot: 'full' } ] });
        const holdsAfterBad = (await db.select().from(bookingCalendar).where(sql`${bookingCalendar.businessPartnerId} in (${hall.bp.id}, ${ph.bp.id}) and ${bookingCalendar.status} = 'hold'`)).length;
        check('a plan with a taken date is refused before anything is held, naming the partner', bad.status === 409 && bad.body.code === 'PLAN_PROBLEMS' && bad.body.problems?.[0]?.code === hall.bp.partnerCode && holdsAfterBad === holdsBefore, JSON.stringify(bad.body));
        const plan = await api.post('/api/public/celebrations/plan', { date: planDay, occasion: 'Wedding', guests: 250, name: 'Anita Rao', phone: '9876500231', email: `qa_anita_${stamp}@example.test`, notes: 'Evening reception, marigold and white.', items: [
            { type: 'hall', code: hall.bp.partnerCode, spaceId: sid, slot: 'pm' },
            { type: 'photographer', code: ph.bp.partnerCode, packageId: wpk.body.data.id, slot: 'pm', addons: [{ packageId: drone.body.data.id }] },
            { type: 'planner', code: pl.bp.partnerCode, addons: [{ packageId: decor.body.data.id }] },
        ] });
        check('a plan goes to the hall, the photographer and the planner at once', plan.status === 201 && plan.body.data.results.length === 3 && plan.body.data.results.every((r: any) => r.ok) && !!plan.body.data.results.find((r: any) => r.type === 'hall').payUrl, JSON.stringify(plan.body));
        const pv = await api.get(`/api/public/celebrations/plan/${plan.body.data.token}`);
        const stages = pv.body?.data?.items?.map((i: any) => `${i.kind}:${i.stage}`).sort().join();
        check('the plan page: the hall held for its advance, the photographer and planner asked', pv.status === 200 && stages === 'event:new,hall:pending,shoot:requested' || stages === 'event:requested,hall:pending,shoot:requested', stages);
        const [phEnq] = await db.select().from(eventEnquiries).where(and(eq(eventEnquiries.businessPartnerId, ph.bp.id), eq(eventEnquiries.eventDate, planDay)));
        check('the photographer is told where — the hall in the plan', phEnq?.venue === 'Sagar Convention Hall' && !!phEnq.basketId);
        const ov = await api.get('/api/admin/reports/overview?range=30d', st);
        const cs = ov.body?.data?.streams?.find((x: any) => x.key === 'celebrations');
        check('the admin dashboard shows Celebrations commission as its own revenue stream', !!cs && cs.unitefix > 0, JSON.stringify(cs));
    } finally {
        const bp = bpIds.join(',') || '0';
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM booking_calendar WHERE business_partner_id IN (${bp})`,
            `DELETE FROM partner_reviews WHERE business_partner_id IN (${bp})`,
            `DELETE FROM partner_listings WHERE business_partner_id IN (${bp})`,
            `DELETE FROM portfolio_media WHERE business_partner_id IN (${bp})`,
            `DELETE FROM portfolio_albums WHERE business_partner_id IN (${bp})`,
            `DELETE FROM venue_spaces WHERE business_partner_id IN (${bp})`,
            `DELETE FROM partner_pay_links WHERE business_partner_id IN (${bp})`,
            `DELETE FROM hub_alerts WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_milestones WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
            `DELETE FROM event_bookings WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_enquiries WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_packages WHERE business_partner_id IN (${bp})`,
            `DELETE FROM celebration_baskets WHERE phone LIKE '98765002%'`,
            `DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bp})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(async (e) => { console.error(e); await cleanupPartners(bpIds, adminIds); process.exit(1); });
