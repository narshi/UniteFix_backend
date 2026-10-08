/**
 * Add a spare part — the technician's side of "the customer approves it".
 *
 * Three short steps instead of one long form:
 *
 *   1. Which part?      search UniteFix stock, or name a part bought locally
 *   2. Details          quantity, then ONLY what the chosen source needs:
 *                         UniteFix stock → nothing to type; price and warranty
 *                                          come from the catalogue
 *                         Buy locally    → what you paid; shop, shop warranty
 *                                          and the bill photo only when a
 *                                          warranty is being claimed
 *   3. Review           the server's price, GST and warranty, why it is needed,
 *                       and what the customer will pay → Send for approval
 *
 * Nothing here approves anything. Sending creates a request the customer
 * decides in their own app; the job screen then shows its status.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator,
    KeyboardAvoidingView, Platform, ScrollView, Image, Alert,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import {
    X, ArrowLeft, Search, Minus, Plus, Package, Store, Camera, Check, ShieldCheck, ShieldAlert, AlertTriangle, ChevronRight, PackageX,
} from 'lucide-react-native';
import { partnerApi, CataloguePart, PartRequest, PartRequestItemInput, PartRequestPreview } from '../../api/partner.api';
import { customerApi } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button } from '../ui';

type Source = 'platform' | 'technician_local' | 'customer_supplied';
type Step = 'find' | 'details' | 'review';

export interface PartDraftInput {
    part: CataloguePart | null;      // set when picked from UniteFix stock
    name: string;
    source: Source;
    quantity: number;
    price: string;                   // what the technician paid, each (local only)
    shop: string;
    warrantyDays: number;            // from the shop (local only)
    billUri: string | null;
    billUrl: string | null;
}

const blank = (): PartDraftInput => ({ part: null, name: '', source: 'technician_local', quantity: 1, price: '', shop: '', warrantyDays: 0, billUri: null, billUrl: null });

const SHOP_WARRANTY = [
    { days: 0, label: 'None' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 180, label: '6 months' },
    { days: 365, label: '1 year' },
];

/** Tapped by the technician, read by the customer — so they are whole sentences. */
const REASONS = [
    { key: 'burnt', label: 'Burnt out', text: 'The old part is burnt out.' },
    { key: 'dead', label: 'Not working', text: 'The old part has stopped working.' },
    { key: 'worn', label: 'Worn out', text: 'The old part is worn out.' },
    { key: 'broken', label: 'Broken', text: 'The old part is broken.' },
];

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const period = (d: number) => (d >= 365 && d % 365 === 0 ? `${d / 365}-year` : d >= 180 && d % 30 === 0 ? `${d / 30}-month` : `${d}-day`);

/** The warranty line for the details step, worked out on the device before the server confirms it. */
function localWarranty(d: PartDraftInput): { covered: boolean; text: string; tone: 'ok' | 'warn' | 'plain' } {
    if (d.source === 'customer_supplied') return { covered: false, text: "Customer's own part · your fitting is guaranteed 30 days", tone: 'plain' };
    if (d.source === 'platform') {
        const days = d.part?.warrantyDays ?? 0;
        return days > 0
            ? { covered: true, text: `${period(days)} part warranty from UniteFix`, tone: 'ok' }
            : { covered: false, text: 'No part warranty · your fitting is guaranteed 30 days', tone: 'plain' };
    }
    if (d.warrantyDays <= 0) return { covered: false, text: 'No part warranty · your fitting is guaranteed 30 days', tone: 'plain' };
    if (!d.shop.trim() || !(d.billUri || d.billUrl)) return { covered: false, text: 'Add the shop name and a bill photo for the warranty to count', tone: 'warn' };
    return { covered: true, text: `${period(d.warrantyDays)} part warranty from ${d.shop.trim()}`, tone: 'ok' };
}

interface Props {
    visible: boolean;
    bookingId: number;
    onClose: () => void;
    onSent: (r: PartRequest) => void;
    /** "Send again" after a rejection or expiry starts from what was sent. */
    initial?: PartDraftInput | null;
}

export default function AddPartSheet({ visible, bookingId, onClose, onSent, initial }: Props) {
    const { headerTop, bottomBar } = useScreenInsets();
    const [step, setStep] = useState<Step>('find');
    const [q, setQ] = useState('');
    const [debounced, setDebounced] = useState('');
    const [d, setD] = useState<PartDraftInput>(blank());
    const [reasonKey, setReasonKey] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [preview, setPreview] = useState<PartRequestPreview | null>(null);
    const [previewError, setPreviewError] = useState<{ message: string; code?: string } | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [billFailed, setBillFailed] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);

    const { data: access, isLoading: accessLoading } = useQuery({
        queryKey: ['parts-access'],
        queryFn: async () => (await partnerApi.getPartsAccess()).data.data,
        staleTime: 60_000,
        enabled: visible,
    });
    const canUseStock = access?.partsAccess === 'active';

    // Fresh start each time it opens; straight to details when there is no stock to search.
    useEffect(() => {
        if (!visible) return;
        setQ(''); setDebounced(''); setReasonKey(null); setNote(''); setPreview(null); setPreviewError(null); setSendError(null); setBillFailed(false);
        if (initial) { setD(initial); setStep('details'); } else { setD(blank()); setStep('find'); }
    }, [visible]);
    useEffect(() => {
        if (visible && !initial && step === 'find' && access && !canUseStock) setStep('details');
    }, [visible, access, canUseStock, step, initial]);

    useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
    const search = useQuery({
        queryKey: ['parts-search', debounced, bookingId],
        queryFn: async () => (await partnerApi.searchParts(debounced, { serviceRequestId: bookingId })).data.data,
        enabled: visible && step === 'find' && canUseStock,
    });

    const set = (patch: Partial<PartDraftInput>) => setD(prev => ({ ...prev, ...patch }));

    const pickPart = (p: CataloguePart) => {
        setD({ ...blank(), part: p, name: p.name, source: p.availability === 'out_of_stock' ? 'technician_local' : 'platform' });
        setStep('details');
    };
    const buyLocally = () => { setD({ ...blank(), name: q.trim() }); setStep('details'); };

    const price = parseFloat(d.price) || 0;
    const detailsReady = d.name.trim().length >= 2 && d.quantity >= 1 && (d.source !== 'technician_local' || price > 0);
    const reasonText = [REASONS.find(r => r.key === reasonKey)?.text, note.trim()].filter(Boolean).join(' ');

    const toItem = (draft: PartDraftInput): PartRequestItemInput => draft.source === 'platform'
        ? { sparePartId: draft.part!.id, partName: draft.name, sourceType: 'platform', quantity: draft.quantity }
        : draft.source === 'customer_supplied'
            ? { partName: draft.name.trim(), sourceType: 'customer_supplied', quantity: draft.quantity }
            : {
                partName: draft.name.trim(), sourceType: 'technician_local', quantity: draft.quantity, unitPriceRupees: price,
                vendorName: draft.shop.trim() || null, warrantyDays: draft.warrantyDays, billPhotoUrl: draft.billUrl,
            };

    /** Upload the bill if there is one (fails soft: the part then simply has no warranty), then ask the server to price it. */
    const goReview = async () => {
        setStep('review'); setPreview(null); setPreviewError(null); setSendError(null); setLoadingPreview(true); setBillFailed(false);
        let draft = d;
        try {
            if (d.source === 'technician_local' && d.warrantyDays > 0 && d.billUri && !d.billUrl) {
                try {
                    const url = await customerApi.uploadImage(d.billUri, 'part-bills');
                    draft = { ...d, billUrl: url }; setD(draft);
                } catch { setBillFailed(true); }
            }
            const res = await partnerApi.previewPartRequest(bookingId, [toItem(draft)]);
            setPreview(res.data.data);
        } catch (e: any) {
            setPreviewError({ message: getApiErrorMessage(e), code: e?.response?.data?.code });
        } finally {
            setLoadingPreview(false);
        }
    };

    const send = async () => {
        if (reasonText.length < 3) return;
        setSending(true); setSendError(null);
        try {
            const res = await partnerApi.sendPartRequest(bookingId, { items: [toItem(d)], reason: reasonText, confirmDuplicate: !!preview?.duplicates.length });
            onSent(res.data.data);
            onClose();
        } catch (e: any) {
            if (e?.response?.data?.code === 'DUPLICATE_PART' && preview) setPreview({ ...preview, duplicates: [e.response.data.message] });
            else setSendError(getApiErrorMessage(e));
        } finally {
            setSending(false);
        }
    };

    const pickBill = async () => {
        setPicking(true);
        try {
            const cam = await ImagePicker.requestCameraPermissionsAsync();
            let result;
            if (cam.status === 'granted') result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
            else {
                const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (lib.status !== 'granted') { Alert.alert('Photo access needed', 'Allow camera or photo access to add the bill.'); return; }
                result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
            }
            if (!result.canceled && result.assets?.[0]?.uri) set({ billUri: result.assets[0].uri, billUrl: null });
        } catch {
            Alert.alert('Could not open the camera', 'Try again, or send the request without the bill.');
        } finally {
            setPicking(false);
        }
    };

    const back = () => {
        if (step === 'review') setStep('details');
        else if (step === 'details' && canUseStock && !initial) setStep('find');
        else onClose();
    };

    const title = step === 'find' ? 'Add spare part' : step === 'details' ? 'Part details' : 'Review request';
    const results = search.data ?? [];

    // ── step 1: which part ─────────────────────────────────────────────
    const renderFind = () => (
        <View style={styles.flex}>
            <View style={styles.searchWrap}>
                <Search size={18} color={colors.textSecondary} />
                <TextInput
                    style={styles.search} placeholder="Search UniteFix stock" placeholderTextColor={colors.textTertiary}
                    value={q} onChangeText={setQ} autoFocus returnKeyType="search" accessibilityLabel="Search spare parts"
                />
                {search.isFetching && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
            <FlatList
                data={results}
                keyExtractor={i => String(i.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: spacing.xl }}
                renderItem={({ item }) => {
                    const out = item.availability === 'out_of_stock';
                    return (
                        <TouchableOpacity style={styles.result} onPress={() => pickPart(item)} activeOpacity={0.7} accessibilityRole="button">
                            <View style={styles.flex}>
                                <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                                <Text style={[styles.resultMeta, out && { color: colors.warningDark }]}>
                                    {item.availability === 'in_your_kit' ? `${item.kitQty} in your kit` : item.availability === 'warehouse' ? 'In the warehouse' : 'Out of stock'}
                                    {item.brand ? ` · ${item.brand}` : ''}
                                </Text>
                            </View>
                            <Text style={styles.resultPrice}>{rs(item.unitPrice)}</Text>
                        </TouchableOpacity>
                    );
                }}
                ListEmptyComponent={search.isFetching ? null : (
                    <Text style={styles.emptyText}>{debounced ? `No "${debounced}" in UniteFix stock.` : 'Parts for this kind of job show first.'}</Text>
                )}
                ListFooterComponent={
                    <TouchableOpacity style={styles.localRow} onPress={buyLocally} accessibilityRole="button">
                        <Store size={18} color={colors.primary} />
                        <Text style={styles.localRowText}>{debounced ? `Buy "${debounced}" locally` : 'Not in stock? Buy it locally'}</Text>
                        <ChevronRight size={18} color={colors.primary} />
                    </TouchableOpacity>
                }
            />
        </View>
    );

    // ── step 2: details ────────────────────────────────────────────────
    const w = localWarranty(d);
    const renderDetails = () => (
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {d.part ? (
                <View>
                    <Text style={styles.partName}>{d.part.name}</Text>
                    <Text style={styles.partSub}>{[d.part.brand, d.part.partCode].filter(Boolean).join(' · ')}</Text>
                </View>
            ) : (
                <View>
                    <Text style={styles.label}>Part</Text>
                    <TextInput
                        style={styles.input} placeholder="e.g. Fan switch" placeholderTextColor={colors.textTertiary}
                        value={d.name} onChangeText={v => set({ name: v })} autoFocus={!d.name} accessibilityLabel="Part name"
                    />
                </View>
            )}

            <View style={styles.qtyRow}>
                <Text style={styles.label}>Quantity</Text>
                <View style={styles.stepper}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => set({ quantity: Math.max(1, d.quantity - 1) })} disabled={d.quantity <= 1} accessibilityLabel="One less">
                        <Minus size={18} color={d.quantity <= 1 ? colors.textDisabled : colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.qty}>{d.quantity}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => set({ quantity: Math.min(50, d.quantity + 1) })} accessibilityLabel="One more">
                        <Plus size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* The one real decision — asked only when the part could come from stock. */}
            {d.part && d.source !== 'customer_supplied' && (
                <View>
                    <Text style={styles.question}>Where will it come from?</Text>
                    <View style={styles.choices}>
                        {([
                            { key: 'platform' as Source, icon: Package, title: 'UniteFix stock', sub: d.part.availability === 'in_your_kit' ? `${d.part.kitQty} in your kit` : d.part.availability === 'warehouse' ? 'In the warehouse' : 'Out of stock', disabled: d.part.availability === 'out_of_stock' },
                            { key: 'technician_local' as Source, icon: Store, title: 'Buy locally', sub: 'From a shop nearby', disabled: false },
                        ]).map(c => {
                            const on = d.source === c.key;
                            const Icon = c.disabled ? PackageX : c.icon;
                            return (
                                <TouchableOpacity
                                    key={c.key} style={[styles.choice, on && styles.choiceOn, c.disabled && styles.choiceOff]}
                                    onPress={() => !c.disabled && set({ source: c.key })} disabled={c.disabled}
                                    accessibilityRole="radio" accessibilityState={{ selected: on, disabled: c.disabled }}
                                >
                                    <Icon size={20} color={c.disabled ? colors.textDisabled : on ? colors.primary : colors.textSecondary} />
                                    <Text style={[styles.choiceTitle, on && { color: colors.primary }, c.disabled && { color: colors.textDisabled }]}>{c.title}</Text>
                                    <Text style={[styles.choiceSub, c.disabled && { color: colors.warningDark }]}>{c.sub}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            )}

            {d.source === 'platform' && d.part && (
                <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Price</Text>
                    <Text style={styles.factValue}>{rs(d.part.unitPrice)} each</Text>
                </View>
            )}

            {d.source === 'technician_local' && (
                <View style={styles.localBlock}>
                    <View>
                        <Text style={styles.label}>What you paid, each</Text>
                        <View style={styles.moneyInput}>
                            <Text style={styles.rupee}>₹</Text>
                            <TextInput
                                style={styles.moneyField} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary}
                                value={d.price} onChangeText={v => set({ price: v.replace(/[^0-9.]/g, '') })} accessibilityLabel="Price paid for each part"
                            />
                        </View>
                    </View>
                    <View>
                        <Text style={styles.label}>{d.warrantyDays > 0 ? 'Shop' : 'Shop (optional)'}</Text>
                        <TextInput
                            style={styles.input} placeholder="e.g. Sri Ganesh Electricals" placeholderTextColor={colors.textTertiary}
                            value={d.shop} onChangeText={v => set({ shop: v })} accessibilityLabel="Shop name"
                        />
                    </View>
                    <View>
                        <Text style={styles.label}>Shop warranty</Text>
                        <View style={styles.chips}>
                            {SHOP_WARRANTY.map(o => {
                                const on = d.warrantyDays === o.days;
                                return (
                                    <TouchableOpacity key={o.days} style={[styles.chip, on && styles.chipOn]} onPress={() => set({ warrantyDays: o.days })} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                    {/* The bill only matters when there is a warranty to stand behind. */}
                    {d.warrantyDays > 0 && (
                        <>
                            <View>
                                <Text style={styles.label}>Bill photo</Text>
                                {d.billUri || d.billUrl ? (
                                    <View style={styles.billDone}>
                                        {d.billUri ? <Image source={{ uri: d.billUri }} style={styles.billThumb} /> : null}
                                        <Check size={18} color={colors.successDark} />
                                        <Text style={styles.billDoneText}>Bill added</Text>
                                        <TouchableOpacity onPress={pickBill} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={styles.link}>Change</Text></TouchableOpacity>
                                    </View>
                                ) : (
                                    <TouchableOpacity style={styles.billAdd} onPress={pickBill} disabled={picking} accessibilityRole="button">
                                        {picking ? <ActivityIndicator size="small" color={colors.primary} /> : <Camera size={18} color={colors.primary} />}
                                        <Text style={styles.billAddText}>Add bill photo</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </>
                    )}
                </View>
            )}

            <View style={[styles.warranty, w.tone === 'ok' ? styles.warrantyOk : w.tone === 'warn' ? styles.warrantyWarn : styles.warrantyPlain]}>
                {w.tone === 'ok' ? <ShieldCheck size={16} color={colors.successDark} /> : <ShieldAlert size={16} color={w.tone === 'warn' ? colors.warningDark : colors.textSecondary} />}
                <Text style={[styles.warrantyText, { color: w.tone === 'ok' ? colors.successDark : w.tone === 'warn' ? colors.warningDark : colors.textSecondary }]}>{w.text}</Text>
            </View>

            <TouchableOpacity
                onPress={() => set(d.source === 'customer_supplied' ? { source: d.part && d.part.availability !== 'out_of_stock' ? 'platform' : 'technician_local' } : { source: 'customer_supplied' })}
                style={styles.textBtn} accessibilityRole="button"
            >
                <Text style={styles.link}>{d.source === 'customer_supplied' ? 'The customer does not have the part' : 'The customer already has this part'}</Text>
            </TouchableOpacity>
        </ScrollView>
    );

    // ── step 3: review ─────────────────────────────────────────────────
    const line = preview?.items[0];
    const renderReview = () => (
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {loadingPreview && (
                <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Checking price and warranty…</Text></View>
            )}
            {previewError && (
                <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{previewError.message}</Text>
                    <View style={styles.row}>
                        {previewError.code === 'STOCK_UNAVAILABLE'
                            ? <Button title="Buy locally instead" size="sm" fullWidth={false} onPress={() => { set({ source: 'technician_local' }); setStep('details'); }} />
                            : <Button title="Try again" size="sm" variant="outline" fullWidth={false} onPress={goReview} />}
                    </View>
                </View>
            )}
            {preview && line && (
                <>
                    <View>
                        <Text style={styles.partName}>{line.partName}</Text>
                        <Text style={styles.partSub}>{line.quantity} × {rs(line.unitPrice)} · {line.source}</Text>
                    </View>

                    <View style={[styles.warranty, line.warranty.covered ? styles.warrantyOk : styles.warrantyPlain]}>
                        {line.warranty.covered ? <ShieldCheck size={16} color={colors.successDark} /> : <ShieldAlert size={16} color={colors.textSecondary} />}
                        <Text style={[styles.warrantyText, { color: line.warranty.covered ? colors.successDark : colors.textSecondary }]}>{line.warranty.label}</Text>
                    </View>
                    {billFailed && <Text style={styles.warnText}>The bill photo did not upload, so the shop warranty is not counted. Try again from part details, or send as it is.</Text>}

                    {preview.earlierWarranty && (
                        <View style={styles.alertBox}>
                            <AlertTriangle size={16} color={colors.warningDark} />
                            <Text style={styles.alertText}>
                                A {preview.earlierWarranty.partName} fitted on {preview.earlierWarranty.jobRef} is under warranty until {preview.earlierWarranty.warrantyUntil ? new Date(preview.earlierWarranty.warrantyUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'later'}. If you are replacing that part, it should be a warranty repair, not charged.
                            </Text>
                        </View>
                    )}
                    {[...preview.duplicates, ...preview.warnings].map((m, i) => (
                        <View key={i} style={styles.alertBox}>
                            <AlertTriangle size={16} color={colors.warningDark} />
                            <Text style={styles.alertText}>{m}</Text>
                        </View>
                    ))}

                    <View>
                        <Text style={styles.question}>Why is it needed?</Text>
                        <View style={styles.chips}>
                            {REASONS.map(r => {
                                const on = reasonKey === r.key;
                                return (
                                    <TouchableOpacity key={r.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setReasonKey(on ? null : r.key)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        <TextInput
                            style={[styles.input, { marginTop: spacing.sm }]} placeholder="Add a note for the customer (optional)" placeholderTextColor={colors.textTertiary}
                            value={note} onChangeText={setNote} maxLength={200} accessibilityLabel="Note for the customer"
                        />
                    </View>

                    <View style={styles.totals}>
                        <View style={styles.totalLine}><Text style={styles.totalLabel}>Part</Text><Text style={styles.totalValue}>{rs(preview.parts)}</Text></View>
                        <View style={styles.totalLine}><Text style={styles.totalLabel}>GST {preview.gstPercent}%</Text><Text style={styles.totalValue}>{rs(preview.gst)}</Text></View>
                        <View style={[styles.totalLine, styles.payLine]}><Text style={styles.payLabel}>Customer pays</Text><Text style={styles.payValue}>{rs(preview.total)}</Text></View>
                    </View>
                    {sendError && <Text style={styles.errorText}>{sendError}</Text>}
                </>
            )}
        </ScrollView>
    );

    const footer = step === 'details' ? (
        <Button title="Review" onPress={goReview} disabled={!detailsReady} />
    ) : step === 'review' && preview ? (
        <>
            <Button
                title={preview.duplicates.length ? 'Send anyway' : 'Send for customer approval'}
                onPress={send} loading={sending} disabled={reasonText.length < 3}
            />
            <Text style={styles.footHint}>{reasonText.length < 3 ? 'Choose why the part is needed.' : 'The customer approves it in their app before it goes on the bill.'}</Text>
        </>
    ) : null;

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={back} statusBarTranslucent>
            <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={[styles.head, { paddingTop: headerTop }]}>
                    <TouchableOpacity onPress={back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={step === 'find' || (step === 'details' && (!canUseStock || initial)) ? 'Close' : 'Back'}>
                        {step === 'find' || (step === 'details' && (!canUseStock || initial)) ? <X size={22} color={colors.textPrimary} /> : <ArrowLeft size={22} color={colors.textPrimary} />}
                    </TouchableOpacity>
                    <Text style={styles.title}>{title}</Text>
                    <View style={{ width: 22 }} />
                </View>
                {accessLoading && step === 'find' ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
                    : step === 'find' ? renderFind() : step === 'details' ? renderDetails() : renderReview()}
                {footer && <View style={[styles.footer, { paddingBottom: bottomBar }]}>{footer}</View>}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h4, color: colors.textPrimary },
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'], gap: spacing.lg },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'], gap: spacing.sm },
    muted: { ...typography.caption, color: colors.textSecondary },
    row: { flexDirection: 'row', gap: spacing.sm },

    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, height: 48, borderRadius: radii.md, backgroundColor: colors.surface },
    search: { flex: 1, ...typography.body, color: colors.textPrimary },
    result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    resultName: { ...typography.bodyMedium, color: colors.textPrimary },
    resultMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    resultPrice: { ...typography.bodySemibold, color: colors.textPrimary },
    emptyText: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
    localRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.base, minHeight: 56 },
    localRowText: { ...typography.bodyMedium, color: colors.primary, flex: 1 },

    partName: { ...typography.h3, color: colors.textPrimary },
    partSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
    question: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    input: { height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.textPrimary, backgroundColor: colors.background },

    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.full },
    stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    qty: { ...typography.bodySemibold, color: colors.textPrimary, minWidth: 28, textAlign: 'center' },

    choices: { flexDirection: 'row', gap: spacing.sm },
    choice: { flex: 1, minHeight: 92, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, gap: 4 },
    choiceOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    choiceOff: { backgroundColor: colors.surface },
    choiceTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginTop: spacing.xs },
    choiceSub: { ...typography.caption, color: colors.textSecondary },

    factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
    factLabel: { ...typography.body, color: colors.textSecondary },
    factValue: { ...typography.bodySemibold, color: colors.textPrimary },

    localBlock: { gap: spacing.lg },
    moneyInput: { flexDirection: 'row', alignItems: 'center', height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md },
    rupee: { ...typography.bodySemibold, color: colors.textSecondary, marginRight: spacing.xs },
    moneyField: { flex: 1, ...typography.bodySemibold, color: colors.textPrimary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.captionMedium, color: colors.textSecondary },
    chipTextOn: { color: colors.primary },
    billAdd: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 52, borderRadius: radii.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
    billAddText: { ...typography.bodyMedium, color: colors.primary },
    billDone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52 },
    billThumb: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.surface },
    billDoneText: { ...typography.bodyMedium, color: colors.successDark, flex: 1 },

    warranty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: radii.md },
    warrantyOk: { backgroundColor: colors.successLight },
    warrantyWarn: { backgroundColor: colors.warningLight },
    warrantyPlain: { backgroundColor: colors.surface },
    warrantyText: { ...typography.caption, flex: 1 },
    textBtn: { minHeight: 44, justifyContent: 'center' },
    link: { ...typography.captionMedium, color: colors.primary },

    alertBox: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.warningLight },
    alertText: { ...typography.caption, color: colors.warningDark, flex: 1 },
    warnText: { ...typography.caption, color: colors.warningDark },
    errorBox: { gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.errorLight },
    errorText: { ...typography.caption, color: colors.errorDark },

    totals: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
    totalLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    totalLabel: { ...typography.body, color: colors.textSecondary },
    totalValue: { ...typography.body, color: colors.textPrimary },
    payLine: { marginTop: spacing.xs },
    payLabel: { ...typography.h4, color: colors.textPrimary },
    payValue: { ...typography.h3, color: colors.textPrimary },

    footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
    footHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
