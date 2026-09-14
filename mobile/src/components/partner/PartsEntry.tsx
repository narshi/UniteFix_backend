/**
 * Recording a spare part properly, at the doorstep.
 *
 * The technician is standing in someone's kitchen with a bag of parts and a
 * customer waiting to pay. Anything this form demands, it demands then. So:
 *
 *   - Name and price are the only required fields. That alone is already better
 *     than the free-text word the system used to store.
 *   - Everything that earns the part a warranty sits behind one tap, with the
 *     coverage line updating as it is filled in — the technician can SEE what
 *     the extra thirty seconds buys rather than being told to trust us.
 *   - Nothing blocks. A missing bill photo is recorded as a missing bill photo;
 *     it never stops the job being billed. A technician in Joida with no signal
 *     must still be able to get paid.
 *
 * The coverage line is the whole point of the design. "Not covered — nobody
 * backs this if it fails" is a consequence a technician understands immediately,
 * and it is true, which is why it works better than a rule would.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Camera, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Package, Lock } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { customerApi } from '../../api/customer.api';
import { partnerApi, CataloguePart } from '../../api/partner.api';
import PartsPickerSheet from './PartsPickerSheet';

export type PartSource = 'platform' | 'approved_vendor' | 'technician_local' | 'customer_supplied';

export interface PartDraft {
    key: string;
    /**
     * Set when the part came from the UniteFix catalogue. Name, price and
     * warranty are then the catalogue's and cannot be edited here — the app
     * says WHICH part, the server says how much.
     */
    sparePartId: number | null;
    partName: string;
    brand: string;
    sourceType: PartSource;
    vendorName: string;
    unitPriceRupees: string;
    quantity: string;
    warrantyDays: string;
    serialNumber: string;
    /** Local device URI until it is uploaded at submit time. */
    billPhotoUri: string | null;
    billPhotoUrl: string | null;
    expanded: boolean;
}

export const newPartDraft = (): PartDraft => ({
    key: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    sparePartId: null,
    partName: '', brand: '', sourceType: 'technician_local', vendorName: '',
    unitPriceRupees: '', quantity: '1', warrantyDays: '', serialNumber: '',
    billPhotoUri: null, billPhotoUrl: null, expanded: false,
});

const SOURCES: Array<{ value: PartSource; label: string; hint: string }> = [
    { value: 'technician_local', label: 'Local shop', hint: 'You bought it from a hardware or electrical shop' },
    { value: 'approved_vendor', label: 'Approved vendor', hint: 'A vendor UniteFix has an arrangement with' },
    // 'platform' is deliberately absent: a UniteFix-stock line comes only from
    // the picker, with a catalogue reference behind it. Typed by hand it would
    // be a word, and the server records a word as a local purchase.
    { value: 'customer_supplied', label: "Customer's own", hint: 'The customer already had the part' },
];

/** Mirrors the server's per-category defaults so the two do not disagree. */
const SUGGESTED_DAYS = [
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
    { label: '6 months', value: '180' },
    { label: '1 year', value: '365' },
];

export const partsTotalRupees = (parts: PartDraft[]) =>
    parts.reduce((sum, p) =>
        sum + (Math.max(0, parseFloat(p.unitPriceRupees) || 0) * Math.max(1, parseInt(p.quantity) || 1)), 0);

/** A part is covered only if somebody can actually be held to it. */
export function coverageOf(p: PartDraft): { covered: boolean; text: string } {
    const days = parseInt(p.warrantyDays) || 0;

    if (p.sourceType === 'customer_supplied') {
        return { covered: true, text: "Customer's own part — your fitting is covered for 30 days" };
    }
    if (p.sourceType === 'platform') {
        return {
            covered: days > 0,
            text: days > 0 ? `UniteFix stock — covered by UniteFix for ${days} days` : 'UniteFix stock — no part warranty; your fitting is covered for 30 days',
        };
    }
    if (days <= 0) return { covered: false, text: 'Not covered — add the warranty period' };
    if (!p.vendorName.trim()) return { covered: false, text: 'Not covered — add the shop name' };
    if (!p.billPhotoUri && !p.billPhotoUrl) return { covered: false, text: 'Not covered — add a photo of the bill' };
    return { covered: true, text: `Covered by ${p.vendorName.trim()} for ${days} days` };
}

/** Payload for the server. Rupees in, paise resolved server-side. */
export const toPartItems = (parts: PartDraft[]) =>
    parts
        .filter(p => p.partName.trim() && (parseFloat(p.unitPriceRupees) || 0) >= 0)
        .map(p => ({
            sparePartId: p.sparePartId ?? undefined,
            partName: p.partName.trim(),
            brand: p.brand.trim() || undefined,
            sourceType: p.sourceType,
            vendorName: p.vendorName.trim() || undefined,
            unitPriceRupees: Math.max(0, parseFloat(p.unitPriceRupees) || 0),
            quantity: Math.max(1, parseInt(p.quantity) || 1),
            warrantyDays: Math.max(0, parseInt(p.warrantyDays) || 0),
            serialNumber: p.serialNumber.trim() || undefined,
            billPhotoUrl: p.billPhotoUrl || undefined,
            vendorBillDate: p.billPhotoUrl ? new Date().toISOString() : undefined,
        }));

/**
 * Upload any bill photos still sitting on the device, and return the parts with
 * their URLs filled in.
 *
 * FAILS SOFT, deliberately. If the upload does not go through — no signal in
 * Joida, a flaky tower on the Sirsi road — the part is still recorded, just
 * without its bill, which is exactly what `is_documented = false` means. The
 * alternative is a technician standing in front of a customer unable to raise
 * the bill because a photo would not send, and that trade is not close.
 */
export async function uploadPendingBills(parts: PartDraft[]): Promise<{ parts: PartDraft[]; failed: number }> {
    let failed = 0;
    const out = await Promise.all(parts.map(async (p) => {
        if (!p.billPhotoUri || p.billPhotoUrl) return p;
        try {
            const url = await customerApi.uploadImage(p.billPhotoUri, 'part-bills');
            return { ...p, billPhotoUrl: url };
        } catch {
            failed += 1;
            return p;
        }
    }));
    return { parts: out, failed };
}

interface Props {
    parts: PartDraft[];
    onChange: (parts: PartDraft[]) => void;
    /** The job, so the picker shows its category's parts first. */
    serviceRequestId?: number;
}

/** A locked line from the catalogue: what the picker returned, ready to bill. */
export const draftFromCatalogue = (c: CataloguePart): PartDraft => ({
    ...newPartDraft(),
    sparePartId: c.id,
    partName: c.name,
    brand: c.brand ?? '',
    sourceType: 'platform',
    unitPriceRupees: String(c.unitPrice),
    warrantyDays: String(c.warrantyDays),
});

export default function PartsEntry({ parts, onChange, serviceRequestId }: Props) {
    const [picking, setPicking] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const navigation = useNavigation<any>();

    // Whether this technician may fit from stock. Read once; the picker button
    // and the nudge below depend on it, and a 403 from search would be a worse
    // way to find out.
    const { data: access } = useQuery({
        queryKey: ['parts-access'],
        queryFn: async () => (await partnerApi.getPartsAccess()).data.data,
        staleTime: 60_000,
    });
    const canUseStock = access?.partsAccess === 'active';

    const update = (key: string, patch: Partial<PartDraft>) =>
        onChange(parts.map(p => (p.key === key ? { ...p, ...patch } : p)));

    const remove = (key: string) => onChange(parts.filter(p => p.key !== key));

    const pickBill = async (key: string) => {
        setPicking(key);
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            let result;
            if (status === 'granted') {
                result = await ImagePicker.launchCameraAsync({ quality: 0.5, allowsEditing: false });
            } else {
                // No camera permission is not a dead end — the bill may already be
                // in their gallery, and refusing here would just lose the record.
                const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (lib.status !== 'granted') {
                    Alert.alert('Photo access needed', 'Allow camera or photo access to attach the bill.');
                    return;
                }
                result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
            }
            if (!result.canceled && result.assets?.[0]?.uri) {
                update(key, { billPhotoUri: result.assets[0].uri });
            }
        } catch {
            Alert.alert('Could not open the camera', 'You can add the bill photo later from the job.');
        } finally {
            setPicking(null);
        }
    };

    return (
        <View style={styles.wrap}>
            {parts.map((p, idx) => {
                const cov = coverageOf(p);
                return (
                    <View key={p.key} style={styles.card}>
                        <View style={styles.cardHead}>
                            <Text style={styles.cardTitle}>Part {idx + 1}</Text>
                            {parts.length > 1 && (
                                <TouchableOpacity onPress={() => remove(p.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                    <X size={16} color={colors.textSecondary} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Required: what it is and what it cost. A catalogue line is
                            locked — the name and price are the catalogue's. */}
                        {p.sparePartId !== null ? (
                            <View style={styles.lockedRow}>
                                <Package size={16} color={colors.primary} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.lockedName}>{p.partName}{p.brand ? <Text style={styles.lockedBrand}>  {p.brand}</Text> : null}</Text>
                                    <Text style={styles.lockedMeta}>From UniteFix stock · ₹{p.unitPriceRupees} each</Text>
                                </View>
                                <Lock size={13} color={colors.textDisabled} />
                            </View>
                        ) : (
                            <TextInput
                                style={styles.input}
                                placeholder="What is it? e.g. Fan capacitor"
                                value={p.partName}
                                onChangeText={v => update(p.key, { partName: v })}
                                placeholderTextColor={colors.textDisabled}
                            />
                        )}

                        <View style={styles.row}>
                            {p.sparePartId === null && (
                                <View style={styles.flex2}>
                                    <Text style={styles.miniLabel}>Price each (₹)</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="450"
                                        value={p.unitPriceRupees}
                                        onChangeText={v => update(p.key, { unitPriceRupees: v.replace(/[^0-9.]/g, '') })}
                                        keyboardType="numeric"
                                        placeholderTextColor={colors.textDisabled}
                                    />
                                </View>
                            )}
                            <View style={styles.flex1}>
                                <Text style={styles.miniLabel}>Qty</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="1"
                                    value={p.quantity}
                                    onChangeText={v => update(p.key, { quantity: v.replace(/[^0-9]/g, '') })}
                                    keyboardType="number-pad"
                                    placeholderTextColor={colors.textDisabled}
                                />
                            </View>
                        </View>

                        {/* The consequence, stated plainly and updating live. */}
                        <View style={[styles.coverage, cov.covered ? styles.coverageOk : styles.coverageBad]}>
                            {cov.covered
                                ? <ShieldCheck size={15} color={colors.successDark} />
                                : <ShieldAlert size={15} color={colors.warningDark} />}
                            <Text style={[styles.coverageText, { color: cov.covered ? colors.successDark : colors.warningDark }]}>
                                {cov.text}
                            </Text>
                        </View>

                        {p.sparePartId === null && (
                        <TouchableOpacity
                            style={styles.expandBtn}
                            onPress={() => update(p.key, { expanded: !p.expanded })}
                        >
                            <Text style={styles.expandText}>
                                {p.expanded ? 'Hide warranty details' : 'Add warranty details'}
                            </Text>
                            {p.expanded
                                ? <ChevronUp size={15} color={colors.primary} />
                                : <ChevronDown size={15} color={colors.primary} />}
                        </TouchableOpacity>
                        )}

                        {p.expanded && p.sparePartId === null && (
                            <View style={styles.details}>
                                <Text style={styles.miniLabel}>Where did it come from?</Text>
                                <View style={styles.sourceRow}>
                                    {SOURCES.map(s => {
                                        const on = p.sourceType === s.value;
                                        return (
                                            <TouchableOpacity
                                                key={s.value}
                                                style={[styles.chip, on && styles.chipOn]}
                                                onPress={() => update(p.key, { sourceType: s.value })}
                                            >
                                                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                                <Text style={styles.hint}>
                                    {SOURCES.find(s => s.value === p.sourceType)?.hint}
                                </Text>

                                {/* A customer's own part needs none of this — they bought it. */}
                                {p.sourceType !== 'customer_supplied' && (
                                    <>
                                        {p.sourceType !== 'platform' && (
                                            <>
                                                <Text style={styles.miniLabel}>Shop name</Text>
                                                <TextInput
                                                    style={styles.input}
                                                    placeholder="e.g. Sirsi Electricals"
                                                    value={p.vendorName}
                                                    onChangeText={v => update(p.key, { vendorName: v })}
                                                    placeholderTextColor={colors.textDisabled}
                                                />
                                            </>
                                        )}

                                        <Text style={styles.miniLabel}>Warranty given</Text>
                                        <View style={styles.sourceRow}>
                                            {SUGGESTED_DAYS.map(d => {
                                                const on = p.warrantyDays === d.value;
                                                return (
                                                    <TouchableOpacity
                                                        key={d.value}
                                                        style={[styles.chip, on && styles.chipOn]}
                                                        onPress={() => update(p.key, { warrantyDays: on ? '' : d.value })}
                                                    >
                                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>

                                        <Text style={styles.miniLabel}>Brand (optional)</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="e.g. Havells"
                                            value={p.brand}
                                            onChangeText={v => update(p.key, { brand: v })}
                                            placeholderTextColor={colors.textDisabled}
                                        />

                                        {p.sourceType !== 'platform' && (
                                            <>
                                                <Text style={styles.miniLabel}>Photo of the shop bill</Text>
                                                {p.billPhotoUri ? (
                                                    <View style={styles.billRow}>
                                                        <Image source={{ uri: p.billPhotoUri }} style={styles.billThumb} />
                                                        <TouchableOpacity onPress={() => update(p.key, { billPhotoUri: null, billPhotoUrl: null })}>
                                                            <Text style={styles.removeLink}>Remove</Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                ) : (
                                                    <TouchableOpacity
                                                        style={styles.photoBtn}
                                                        onPress={() => pickBill(p.key)}
                                                        disabled={picking === p.key}
                                                    >
                                                        {picking === p.key
                                                            ? <ActivityIndicator size="small" color={colors.primary} />
                                                            : <Camera size={16} color={colors.primary} />}
                                                        <Text style={styles.photoBtnText}>Take a photo of the bill</Text>
                                                    </TouchableOpacity>
                                                )}
                                                <Text style={styles.hint}>
                                                    This is what lets us claim from the shop if the part fails.
                                                </Text>
                                            </>
                                        )}
                                    </>
                                )}
                            </View>
                        )}
                    </View>
                );
            })}

            <View style={styles.addRow}>
                {canUseStock && (
                    <TouchableOpacity style={[styles.addBtn, styles.stockBtn]} onPress={() => setPickerOpen(true)}>
                        <Package size={16} color={colors.background} />
                        <Text style={[styles.addBtnText, { color: colors.background }]}>From UniteFix stock</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.addBtn} onPress={() => onChange([...parts, newPartDraft()])}>
                    <Plus size={16} color={colors.primary} />
                    <Text style={styles.addBtnText}>{canUseStock ? 'Bought locally' : 'Add another part'}</Text>
                </TouchableOpacity>
            </View>

            {/* Said once, plainly: what enabling stock access would save them. */}
            {access && !canUseStock && (
                <TouchableOpacity onPress={() => navigation.navigate('EnableParts')} style={styles.nudge}>
                    <Text style={styles.nudgeText}>
                        {access.partsAccess === 'requested'
                            ? 'Your spare-parts access is awaiting approval.'
                            : access.partsAccess === 'suspended'
                                ? 'Spare-parts access is suspended — top up your deposit to restore it.'
                                : 'Fit parts from UniteFix stock and skip the bill photos — enable spare parts.'}
                    </Text>
                </TouchableOpacity>
            )}

            <PartsPickerSheet
                visible={pickerOpen}
                onClose={() => setPickerOpen(false)}
                serviceRequestId={serviceRequestId}
                onPick={c => {
                    // Same part twice bumps the quantity rather than adding a twin line.
                    const existing = parts.find(x => x.sparePartId === c.id);
                    if (existing) {
                        update(existing.key, { quantity: String((parseInt(existing.quantity) || 1) + 1) });
                    } else {
                        // Replace an empty first line rather than leaving it dangling.
                        const rest = parts.filter(x => x.partName.trim() || x.sparePartId !== null);
                        onChange([...rest, draftFromCatalogue(c)]);
                    }
                }}
                onProposed={d => {
                    const rest = parts.filter(x => x.partName.trim() || x.sparePartId !== null);
                    onChange([...rest, {
                        ...newPartDraft(), partName: d.name, brand: d.brand, unitPriceRupees: d.indicativePrice,
                        vendorName: d.vendorName, sourceType: 'technician_local', expanded: true,
                    }]);
                }}
            />

            {parts.length > 0 && (
                <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Parts total</Text>
                    <Text style={styles.totalValue}>₹{partsTotalRupees(parts).toFixed(2)}</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: spacing.md },
    lockedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2, borderRadius: radii.sm, backgroundColor: colors.primarySurface, marginBottom: spacing.sm },
    lockedName: { ...typography.bodyMedium, color: colors.textPrimary },
    lockedBrand: { ...typography.caption, color: colors.textSecondary },
    lockedMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    addRow: { flexDirection: 'row', gap: spacing.sm },
    stockBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
    nudge: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.warningLight },
    nudgeText: { ...typography.caption, color: colors.warningDark, textAlign: 'center' },
    card: {
        backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md,
        marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
    },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    cardTitle: { ...typography.captionMedium, color: colors.textSecondary },
    input: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        backgroundColor: colors.background, color: colors.textPrimary,
        marginBottom: spacing.sm, ...typography.bodyMedium,
    },
    row: { flexDirection: 'row', gap: spacing.sm },
    flex1: { flex: 1 },
    flex2: { flex: 2 },
    miniLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
    coverage: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
        borderRadius: radii.sm, marginTop: 2,
    },
    coverageOk: { backgroundColor: colors.successLight },
    coverageBad: { backgroundColor: colors.warningLight },
    coverageText: { ...typography.caption, flex: 1 },
    expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.sm },
    expandText: { ...typography.captionMedium, color: colors.primary },
    details: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
    sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
    chip: {
        paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm,
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.caption, color: colors.textSecondary },
    chipTextOn: { color: colors.primary },
    hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    photoBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
        borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
        borderRadius: radii.sm, paddingVertical: spacing.md, marginBottom: 4,
    },
    photoBtnText: { ...typography.captionMedium, color: colors.primary },
    billRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    billThumb: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: colors.border },
    removeLink: { ...typography.captionMedium, color: colors.error },
    addBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
        paddingVertical: spacing.sm,
    },
    addBtnText: { ...typography.captionMedium, color: colors.primary },
    totalRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
    },
    totalLabel: { ...typography.captionMedium, color: colors.textSecondary },
    totalValue: { ...typography.bodySemibold, color: colors.textPrimary },
});
