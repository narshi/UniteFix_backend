/**
 * Pick a part from UniteFix stock.
 *
 * Search opens with the keyboard up and the job's category first — the
 * technician is standing in front of an AC, so AC parts come before fan parts.
 * Each result says where it is: in their kit, in the warehouse, or nowhere.
 *
 * The price is shown and NOT editable. The catalogue says how much; the app
 * only says which. When nothing matches, the technician proposes it and, for
 * this job, records it as a local purchase so nothing waits on admin.
 */

import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Package, Warehouse, PackageX, Lightbulb } from 'lucide-react-native';
import { partnerApi, CataloguePart } from '../../api/partner.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../ui';

interface Props {
    visible: boolean;
    onClose: () => void;
    onPick: (part: CataloguePart) => void;
    /** Adds a local-purchase line for the proposed part on this job. */
    onProposed: (draft: { name: string; brand: string; indicativePrice: string; vendorName: string }) => void;
    serviceRequestId?: number;
}

export default function PartsPickerSheet({ visible, onClose, onPick, onProposed, serviceRequestId }: Props) {
    const [q, setQ] = useState('');
    const [debounced, setDebounced] = useState('');
    const [proposing, setProposing] = useState(false);
    const [prop, setProp] = useState({ name: '', brand: '', indicativePrice: '', vendorName: '' });
    const [sending, setSending] = useState(false);

    useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
    useEffect(() => { if (visible) { setQ(''); setDebounced(''); setProposing(false); } }, [visible]);

    const { data, isFetching } = useQuery({
        queryKey: ['parts-search', debounced, serviceRequestId],
        queryFn: async () => (await partnerApi.searchParts(debounced, { serviceRequestId })).data.data,
        enabled: visible,
    });
    const results = data ?? [];
    const inCategory = results.filter(r => r.inJobCategory);
    const others = results.filter(r => !r.inJobCategory);
    // Job-category matches first, each row tagged with the section it opens.
    const sectioned = [
        ...inCategory.map(r => ({ ...r, _section: 'For this job' })),
        ...others.map(r => ({ ...r, _section: inCategory.length ? 'Other parts' : 'All parts' })),
    ];

    const submitProposal = async () => {
        if (prop.name.trim().length < 2) { Alert.alert('Name the part', 'What is it? e.g. "Fan regulator 5-step".'); return; }
        setSending(true);
        try {
            const res = await partnerApi.proposePart({
                serviceRequestId: serviceRequestId ?? null, name: prop.name.trim(), brand: prop.brand.trim() || null,
                indicativePriceRupees: prop.indicativePrice.trim() ? Number(prop.indicativePrice) : null, vendorName: prop.vendorName.trim() || null,
            });
            onProposed(prop);
            Alert.alert('Sent for review', res.data?.message ?? 'Added to this job as a local purchase for now.');
            onClose();
        } catch (err) {
            Alert.alert('Could not send', getApiErrorMessage(err));
        } finally {
            setSending(false);
        }
    };

    const Row = ({ item }: { item: CataloguePart }) => {
        const avail = item.availability === 'in_your_kit'
            ? { icon: <Package size={14} color={colors.successDark} />, text: `In your kit: ${item.kitQty}`, color: colors.successDark }
            : item.availability === 'warehouse'
                ? { icon: <Warehouse size={14} color={colors.textSecondary} />, text: `Warehouse: ${item.warehouseQty}`, color: colors.textSecondary }
                : { icon: <PackageX size={14} color={colors.warningDark} />, text: 'Out of stock', color: colors.warningDark };
        return (
            <TouchableOpacity style={styles.row} onPress={() => { onPick(item); onClose(); }} activeOpacity={0.7}>
                <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{item.name}{item.brand ? <Text style={styles.rowBrand}>  {item.brand}</Text> : null}</Text>
                    {!!item.specification && <Text style={styles.rowSpec}>{item.specification}</Text>}
                    <View style={styles.rowMeta}>
                        {avail.icon}
                        <Text style={[styles.rowAvail, { color: avail.color }]}>{avail.text}</Text>
                        {item.warrantyDays > 0 && <Text style={styles.rowWarranty}> · {item.warrantyDays}-day warranty</Text>}
                    </View>
                </View>
                <Text style={styles.rowPrice}>₹{item.unitPrice}</Text>
            </TouchableOpacity>
        );
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView style={styles.screen} behavior="padding">
                <View style={styles.head}>
                    <Text style={styles.title}>{proposing ? 'Propose a part' : 'UniteFix stock'}</Text>
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><X size={22} color={colors.textPrimary} /></TouchableOpacity>
                </View>

                {!proposing ? (
                    <>
                        <View style={styles.searchWrap}>
                            <Search size={18} color={colors.textSecondary} />
                            <TextInput
                                style={styles.search}
                                placeholder="Search by name, code or brand"
                                placeholderTextColor={colors.textDisabled}
                                value={q}
                                onChangeText={setQ}
                                autoFocus
                                returnKeyType="search"
                            />
                            {isFetching && <ActivityIndicator size="small" color={colors.primary} />}
                        </View>

                        <FlatList
                            data={sectioned}
                            keyExtractor={item => String(item.id)}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item, index }) => (
                                <>
                                    {(index === 0 || sectioned[index - 1]._section !== item._section) && (
                                        <Text style={styles.section}>{item._section}</Text>
                                    )}
                                    <Row item={item} />
                                </>
                            )}
                            ListEmptyComponent={
                                !isFetching ? (
                                    <View style={styles.empty}>
                                        <Text style={styles.emptyTitle}>{debounced ? `Nothing called "${debounced}"` : 'No parts in the catalogue yet'}</Text>
                                        <Text style={styles.emptyText}>If you fitted something UniteFix should stock, propose it. It goes on this job as a local purchase for now.</Text>
                                        <TouchableOpacity style={styles.proposeBtn} onPress={() => { setProp({ name: debounced, brand: '', indicativePrice: '', vendorName: '' }); setProposing(true); }}>
                                            <Lightbulb size={16} color={colors.primary} />
                                            <Text style={styles.proposeText}>Propose this part</Text>
                                        </TouchableOpacity>
                                    </View>
                                ) : null
                            }
                            ListFooterComponent={
                                results.length > 0 ? (
                                    <TouchableOpacity style={[styles.proposeBtn, { margin: spacing.md }]} onPress={() => { setProp({ name: debounced, brand: '', indicativePrice: '', vendorName: '' }); setProposing(true); }}>
                                        <Lightbulb size={16} color={colors.primary} />
                                        <Text style={styles.proposeText}>Not here? Propose it</Text>
                                    </TouchableOpacity>
                                ) : null
                            }
                            contentContainerStyle={{ paddingBottom: spacing.xl }}
                        />
                    </>
                ) : (
                    <View style={styles.form}>
                        <Text style={styles.formHint}>UniteFix reviews it. Once approved it is in the catalogue for everyone, and your line on this job is updated to point at it.</Text>
                        <Text style={styles.label}>What is it?</Text>
                        <TextInput style={styles.input} value={prop.name} onChangeText={v => setProp({ ...prop, name: v })} placeholder="e.g. Fan regulator 5-step" placeholderTextColor={colors.textDisabled} />
                        <Text style={styles.label}>Brand (optional)</Text>
                        <TextInput style={styles.input} value={prop.brand} onChangeText={v => setProp({ ...prop, brand: v })} placeholder="e.g. Anchor" placeholderTextColor={colors.textDisabled} />
                        <Text style={styles.label}>What you paid for it (₹)</Text>
                        <TextInput style={styles.input} value={prop.indicativePrice} onChangeText={v => setProp({ ...prop, indicativePrice: v.replace(/[^0-9.]/g, '') })} keyboardType="numeric" placeholder="220" placeholderTextColor={colors.textDisabled} />
                        <Text style={styles.label}>Where you bought it</Text>
                        <TextInput style={styles.input} value={prop.vendorName} onChangeText={v => setProp({ ...prop, vendorName: v })} placeholder="e.g. Sirsi Electricals" placeholderTextColor={colors.textDisabled} />
                        <Button title="Send for review" onPress={submitProposal} loading={sending} />
                        <TouchableOpacity onPress={() => setProposing(false)} style={{ alignSelf: 'center', marginTop: spacing.sm }}>
                            <Text style={styles.backLink}>Back to search</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.md, paddingBottom: spacing.sm },
    title: { ...typography.h4, color: colors.textPrimary },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface },
    search: { flex: 1, paddingVertical: spacing.sm + 2, ...typography.body, color: colors.textPrimary },
    section: { ...typography.captionMedium, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.border },
    rowBody: { flex: 1 },
    rowName: { ...typography.bodyMedium, color: colors.textPrimary },
    rowBrand: { ...typography.caption, color: colors.textSecondary },
    rowSpec: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    rowAvail: { ...typography.caption },
    rowWarranty: { ...typography.caption, color: colors.textSecondary },
    rowPrice: { ...typography.bodySemibold, color: colors.textPrimary },
    empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
    emptyTitle: { ...typography.bodySemibold, color: colors.textPrimary, textAlign: 'center' },
    emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    proposeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
    proposeText: { ...typography.captionMedium, color: colors.primary },
    form: { padding: spacing.lg, gap: spacing.xs },
    formHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    label: { ...typography.captionMedium, color: colors.textSecondary, marginTop: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface, marginBottom: spacing.xs },
    backLink: { ...typography.captionMedium, color: colors.primary },
});
