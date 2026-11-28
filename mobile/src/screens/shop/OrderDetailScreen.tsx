/**
 * One order: where it is (timeline), how it ships (courier and tracking
 * number), what was bought, the GST documents (invoice, receipt, credit note),
 * and what the customer can do — cancel before it ships, return inside the
 * window, review once delivered. The seller's grievance contact is always here.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FileText, Truck, ExternalLink, HelpCircle } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button, ScreenHeader, EmptyState } from '../../components/ui';
import { useRefreshShop, useStoreOrder } from '../../hooks/useShopData';
import { shopApi } from '../../api/shop.api';
import { getApiErrorMessage } from '../../api/client';
import { ProductImage, ReasonSheet, Stars, rupees } from './parts';
import { STATUS_TONE } from './OrdersScreen';

type Props = NativeStackScreenProps<any, 'OrderDetail'>;
type Sheet = { kind: 'cancel' } | { kind: 'return' } | { kind: 'review'; itemId: number; name: string } | null;

const DOC_NAME: Record<string, string> = { tax_invoice: 'Tax invoice', credit_note: 'Credit note', receipt_voucher: 'Payment receipt', refund_voucher: 'Refund voucher' };
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export function OrderDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.id);
    const { scrollBottom } = useScreenInsets();
    const { data: o, isLoading, isError, refetch, isRefetching } = useStoreOrder(id);
    const refreshShop = useRefreshShop();
    const [sheet, setSheet] = useState<Sheet>(null);
    const [opening, setOpening] = useState<number | null>(null);

    const openDoc = async (docId: number) => {
        setOpening(docId);
        try { await Linking.openURL(await shopApi.documentLink(id, docId)); }
        catch (e) { Alert.alert('Could not open it', getApiErrorMessage(e)); }
        finally { setOpening(null); }
    };

    const submit = async (text: string, rating: number) => {
        try {
            if (sheet?.kind === 'cancel') { const r = await shopApi.cancel(id, text); Alert.alert('Order cancelled', r.message ?? 'Your refund is on its way.'); }
            if (sheet?.kind === 'return') { const r = await shopApi.requestReturn(id, text); Alert.alert('Return requested', r.message ?? 'The seller will respond.'); }
            if (sheet?.kind === 'review') { await shopApi.review(sheet.itemId, rating, text); Alert.alert('Thank you', 'Your review helps other customers.'); }
            setSheet(null);
            refreshShop();
        } catch (e) {
            Alert.alert('Could not do that', getApiErrorMessage(e));
        }
    };

    if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
    if (isError || !o) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Order" onBack={() => navigation.goBack()} />
                <EmptyState title="Could not load this order" description="Check your connection and try again." actionLabel="Try again" onAction={() => refetch()} />
            </View>
        );
    }
    const tone = STATUS_TONE[o.status] ?? STATUS_TONE.placed;

    return (
        <View style={styles.screen}>
            <ScreenHeader title={`Order ${o.code}`} onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={{ padding: spacing.base, gap: spacing.md, paddingBottom: scrollBottom }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>
                <View style={styles.card}>
                    <View style={styles.rowBetween}>
                        <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.fg }]}>{o.statusLabel}</Text></View>
                        <Text style={styles.total}>{rupees(o.total)}</Text>
                    </View>
                    <Text style={styles.meta}>Placed {fmt(o.createdAt)} · Sold by {o.seller}</Text>
                    {!!o.refund && <Text style={styles.refund}>Refund of {rupees(o.refund.amount)}: {o.refund.status === 'initiated' ? 'sent to your bank or card (5–7 working days)' : o.refund.status === 'pending' ? 'being processed' : 'our team will contact you'}</Text>}
                    {!!o.cancel?.reason && <Text style={styles.meta}>Cancelled: {o.cancel.reason}</Text>}
                    {o.return.status && <Text style={styles.meta}>Return {o.return.status}{o.return.reason ? `: "${o.return.reason}"` : ''}</Text>}
                    {o.installationStatus === 'pending' && <Text style={styles.meta}>Installation: the seller will contact you after delivery.</Text>}
                </View>

                {!!o.shipment && (
                    <View style={styles.card}>
                        <View style={styles.rowStart}><Truck size={18} color={colors.primary} /><Text style={styles.cardTitle}>{o.shipment.courier}</Text></View>
                        {!!o.shipment.statusLabel && <Text style={styles.stepLabel}>{o.shipment.statusLabel}</Text>}
                        <Text style={styles.meta}>Tracking number</Text>
                        <Text style={styles.tracking} selectable>{o.shipment.trackingId}</Text>
                        {(o.shipment.events ?? []).slice(0, 8).map((e, i) => (
                            <View key={i} style={styles.step}>
                                <View style={[styles.stepDot, i === 0 && { backgroundColor: colors.primary }]} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.stepLabel}>{e.description}</Text>
                                    <Text style={styles.meta}>{fmt(e.at)}{e.office ? ` · ${e.office}` : ''}</Text>
                                </View>
                            </View>
                        ))}
                        {!!o.shipment.trackingUrl && (
                            <TouchableOpacity style={styles.rowStart} onPress={() => Linking.openURL(o.shipment!.trackingUrl!)} accessibilityRole="link">
                                <ExternalLink size={16} color={colors.primary} /><Text style={styles.link}>Track on the courier's website</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {!!o.timeline?.length && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Updates</Text>
                        {o.timeline.map((t, i) => (
                            <View key={i} style={styles.step}>
                                <View style={[styles.stepDot, i === o.timeline!.length - 1 && { backgroundColor: colors.primary }]} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.stepLabel}>{t.label}</Text>
                                    <Text style={styles.meta}>{fmt(t.at)}{t.note ? ` · ${t.note}` : ''}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Items</Text>
                    {o.items.map(it => (
                        <View key={it.id} style={styles.item}>
                            <ProductImage uri={it.image} size={56} />
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
                                <Text style={styles.meta}>{it.quantity} × {rupees(it.price)}</Text>
                                {it.review != null && <Stars value={it.review} size={12} />}
                                {it.canReview && (
                                    <TouchableOpacity onPress={() => setSheet({ kind: 'review', itemId: it.id, name: it.name })} accessibilityRole="button"><Text style={styles.link}>Rate this product</Text></TouchableOpacity>
                                )}
                            </View>
                            <Text style={styles.itemTotal}>{rupees(it.total)}</Text>
                        </View>
                    ))}
                    <Text style={styles.meta}>Includes GST of {rupees(o.tax)}</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Delivery address</Text>
                    <Text style={styles.body}>{o.shipTo.name} · {o.shipTo.phone}</Text>
                    <Text style={styles.meta}>{o.shipTo.address}</Text>
                </View>

                {o.documents.length > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Documents</Text>
                        {o.documents.map(d => (
                            <TouchableOpacity key={d.id} style={styles.doc} onPress={() => openDoc(d.id)} disabled={opening != null} accessibilityRole="button" accessibilityLabel={`Open ${DOC_NAME[d.kind] ?? d.kind} ${d.number}`}>
                                <FileText size={18} color={colors.primary} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.body}>{DOC_NAME[d.kind] ?? d.kind}</Text>
                                    <Text style={styles.meta}>{d.number}</Text>
                                </View>
                                {opening === d.id ? <ActivityIndicator size="small" color={colors.primary} /> : <ExternalLink size={16} color={colors.textTertiary} />}
                            </TouchableOpacity>
                        ))}
                        {!o.hasInvoice && o.status !== 'cancelled' && <Text style={styles.meta}>The tax invoice is issued when the order ships.</Text>}
                    </View>
                )}

                {o.grievance && (
                    <View style={[styles.card, styles.rowStart]}>
                        <HelpCircle size={18} color={colors.textSecondary} />
                        <Text style={[styles.meta, { flex: 1 }]}>Problem with this order? {[o.grievance.name, o.grievance.phone, o.grievance.email].filter(Boolean).join(' · ')}</Text>
                    </View>
                )}

                {o.canCancel && <Button title="Cancel order" variant="outline" onPress={() => setSheet({ kind: 'cancel' })} />}
                {o.canReturn && <Button title={`Return (until ${new Date(o.return.until!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`} variant="outline" onPress={() => setSheet({ kind: 'return' })} />}
            </ScrollView>

            <ReasonSheet
                visible={!!sheet}
                title={sheet?.kind === 'cancel' ? 'Cancel this order?' : sheet?.kind === 'return' ? 'Return this order' : `Rate ${sheet && 'name' in sheet ? sheet.name : ''}`}
                hint={sheet?.kind === 'cancel' ? 'Why are you cancelling?' : sheet?.kind === 'return' ? 'What is wrong with it? (at least a few words)' : 'What did you like or not like? (optional)'}
                confirmLabel={sheet?.kind === 'cancel' ? 'Cancel order' : sheet?.kind === 'return' ? 'Request return' : 'Submit'}
                withRating={sheet?.kind === 'review'}
                minLength={sheet?.kind === 'return' ? 5 : 2}
                onClose={() => setSheet(null)}
                onSubmit={submit}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.base, gap: spacing.sm, borderWidth: 1, borderColor: colors.divider },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowStart: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    pill: { borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: 4 },
    pillText: { ...typography.captionMedium },
    total: { ...typography.h3, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary },
    body: { ...typography.body, color: colors.textPrimary },
    refund: { ...typography.captionMedium, color: colors.successDark },
    tracking: { ...typography.h4, color: colors.textPrimary, letterSpacing: 1 },
    link: { ...typography.captionMedium, color: colors.primary },
    step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 5 },
    stepLabel: { ...typography.bodyMedium, color: colors.textPrimary },
    item: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
    itemName: { ...typography.bodyMedium, color: colors.textPrimary },
    itemTotal: { ...typography.bodySemibold, color: colors.textPrimary },
    doc: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});
