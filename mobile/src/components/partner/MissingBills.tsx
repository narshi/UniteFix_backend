/**
 * Parts on a finished job that are still missing their paperwork.
 *
 * When a bill photo fails to upload at the doorstep, the app tells the
 * technician they can add it later. This is later. Without it that message was
 * a lie told at the worst possible moment — right after something had already
 * gone wrong — and the part would stay undocumented forever because nothing
 * would ever ask about it again.
 *
 * It says what the gap costs rather than nagging: an undocumented part is one
 * nobody backs, so if it fails the technician is the one who carries it.
 */

import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { FileWarning, Camera, Check } from 'lucide-react-native';
import { partnerApi, RecordedPart } from '../../api/partner.api';
import { customerApi } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

const DAY_OPTIONS = [
    { label: '30d', value: 30 }, { label: '90d', value: 90 },
    { label: '6mo', value: 180 }, { label: '1yr', value: 365 },
];

export default function MissingBills({ bookingId }: { bookingId: number }) {
    const [busy, setBusy] = useState<number | null>(null);
    const [vendor, setVendor] = useState<Record<number, string>>({});
    const [days, setDays] = useState<Record<number, number>>({});

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['job-parts', bookingId],
        queryFn: async () => (await partnerApi.getJobParts(bookingId)).data.data,
    });

    const attach = async (part: RecordedPart) => {
        const shop = (vendor[part.id] ?? part.vendorName ?? '').trim();
        const warrantyDays = days[part.id] ?? part.warrantyDays;

        if (!shop) { Alert.alert('Shop name', 'Add the shop you bought it from.'); return; }
        if (!warrantyDays) { Alert.alert('Warranty period', 'Choose how long the shop covers it for.'); return; }

        setBusy(part.id);
        try {
            let billPhotoUrl = part.billPhotoUrl ?? undefined;
            if (!billPhotoUrl) {
                const perm = await ImagePicker.requestCameraPermissionsAsync();
                const result = perm.status === 'granted'
                    ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
                    : await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
                if (result.canceled || !result.assets?.[0]?.uri) return;
                billPhotoUrl = await customerApi.uploadImage(result.assets[0].uri, 'part-bills');
            }

            const res = await partnerApi.completePartBill(part.id, {
                billPhotoUrl, vendorName: shop, warrantyDays,
                vendorBillDate: new Date().toISOString(),
            });
            await refetch();
            Alert.alert('Saved', res.data?.message ?? 'Bill saved.');
        } catch (err) {
            Alert.alert('Could not save', getApiErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    if (isLoading) return <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />;

    const pending = (data?.items ?? []).filter(p => !p.isDocumented && p.sourceType === 'technician_local');
    if (!pending.length) return null;

    return (
        <View style={styles.card}>
            <View style={styles.head}>
                <FileWarning size={17} color={colors.warningDark} />
                <Text style={styles.title}>
                    {pending.length === 1 ? 'One part is missing its bill' : `${pending.length} parts are missing their bills`}
                </Text>
            </View>
            <Text style={styles.why}>
                Nobody backs a part with no bill. If it fails, it comes out of your pocket rather than the shop's.
            </Text>

            {pending.map(part => (
                <View key={part.id} style={styles.item}>
                    <Text style={styles.itemName}>
                        {part.partName}{part.quantity > 1 ? ` ×${part.quantity}` : ''}
                        <Text style={styles.itemPrice}>  ₹{((part.unitPricePaise * part.quantity) / 100).toFixed(0)}</Text>
                    </Text>

                    <TextInput
                        style={styles.input}
                        placeholder="Shop name, e.g. Sirsi Electricals"
                        placeholderTextColor={colors.textDisabled}
                        value={vendor[part.id] ?? part.vendorName ?? ''}
                        onChangeText={v => setVendor(s => ({ ...s, [part.id]: v }))}
                    />

                    <View style={styles.chipRow}>
                        {DAY_OPTIONS.map(d => {
                            const on = (days[part.id] ?? part.warrantyDays) === d.value;
                            return (
                                <TouchableOpacity
                                    key={d.value}
                                    style={[styles.chip, on && styles.chipOn]}
                                    onPress={() => setDays(s => ({ ...s, [part.id]: d.value }))}
                                >
                                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <TouchableOpacity
                        style={styles.action}
                        onPress={() => attach(part)}
                        disabled={busy === part.id}
                    >
                        {busy === part.id
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : part.billPhotoUrl
                                ? <Check size={15} color={colors.primary} />
                                : <Camera size={15} color={colors.primary} />}
                        <Text style={styles.actionText}>
                            {part.billPhotoUrl ? 'Save warranty details' : 'Photograph the bill and save'}
                        </Text>
                    </TouchableOpacity>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.warningLight, borderRadius: radii.md, padding: spacing.md,
        marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.warning,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 4 },
    title: { ...typography.captionMedium, color: colors.warningDark, flex: 1 },
    why: { ...typography.caption, color: colors.warningDark, marginBottom: spacing.sm },
    item: {
        backgroundColor: colors.background, borderRadius: radii.sm,
        padding: spacing.sm, marginTop: spacing.xs,
    },
    itemName: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.xs },
    itemPrice: { ...typography.caption, color: colors.textSecondary },
    input: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
        paddingHorizontal: spacing.sm, paddingVertical: 8, marginBottom: spacing.xs,
        color: colors.textPrimary, ...typography.caption,
    },
    chipRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
    chip: {
        paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.sm,
        borderWidth: 1, borderColor: colors.border,
    },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.caption, color: colors.textSecondary },
    chipTextOn: { color: colors.primary },
    action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    actionText: { ...typography.captionMedium, color: colors.primary },
});
