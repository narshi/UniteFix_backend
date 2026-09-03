/**
 * What this job is covered for, and one door to claim on it.
 *
 * The customer's actual problem was never "who ultimately absorbs Rs.850". It
 * was a paper card from a shop in Sirsi that they have probably lost, that they
 * cannot tell is still valid, and that means a trip and an argument with someone
 * with no particular reason to help them.
 *
 * So this card does two things and nothing else: it says plainly what is covered
 * and until when, and it gives one button that reaches us. Who pays is settled
 * internally afterwards and is none of the customer's business — on any genuine
 * failure they are charged nothing either way, so making them work out which of
 * our suppliers is liable would be asking them to do our filing.
 */

import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff, X } from 'lucide-react-native';
import { customerApi } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../ui';

interface Props {
    bookingId: number;
}

export default function WarrantyCard({ bookingId }: Props) {
    const [claimFor, setClaimFor] = useState<{ partItemId: number | null; label: string } | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['warranty', bookingId],
        queryFn: async () => (await customerApi.getWarranty(bookingId)).data.data,
    });

    const submitClaim = async () => {
        if (description.trim().length < 5) {
            Alert.alert('Tell us what happened', 'A line or two is enough — it tells the technician what to look at.');
            return;
        }
        setSubmitting(true);
        try {
            const res = await customerApi.raiseWarrantyClaim(bookingId, {
                description: description.trim(),
                partItemId: claimFor?.partItemId ?? null,
            });
            setClaimFor(null);
            setDescription('');
            refetch();
            Alert.alert(
                'We have got it',
                res.data?.message
                ?? 'We will inspect it and handle the claim from here. You do not need to contact the shop.',
            );
        } catch (err) {
            Alert.alert('Could not send', getApiErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.card}>
                <ActivityIndicator size="small" color={colors.primary} />
            </View>
        );
    }
    if (!data) return null;

    return (
        <View style={styles.card}>
            <Text style={styles.title}>Warranty</Text>

            {/* Ours, always, and stated first. */}
            <View style={styles.row}>
                <ShieldCheck size={17} color={data.workmanship.active ? colors.successDark : colors.textSecondary} />
                <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>Our work</Text>
                    <Text style={styles.rowText}>{data.workmanship.statement}</Text>
                </View>
            </View>

            {data.parts.map(p => (
                <View key={p.id} style={styles.row}>
                    {p.active
                        ? <ShieldCheck size={17} color={colors.successDark} />
                        : <ShieldOff size={17} color={colors.textSecondary} />}
                    <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>
                            {p.partName}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
                            {p.brand ? <Text style={styles.brand}>  {p.brand}</Text> : null}
                        </Text>
                        <Text style={styles.rowText}>{p.statement}</Text>
                    </View>
                </View>
            ))}

            {/* One door. Deliberately offered even when nothing is in date — a
                customer whose part failed on day 92 deserves an answer, not a
                disabled button and no way to ask. */}
            <TouchableOpacity
                style={styles.claimBtn}
                onPress={() => setClaimFor({ partItemId: null, label: 'this job' })}
            >
                <Text style={styles.claimBtnText}>Something's gone wrong — report it</Text>
            </TouchableOpacity>

            {data.parts.length > 0 && (
                <Text style={styles.footnote}>
                    Report it to us and we deal with the supplier. You never have to contact the shop.
                </Text>
            )}

            <Modal visible={!!claimFor} transparent animationType="slide" onRequestClose={() => setClaimFor(null)}>
                <View style={styles.modalWrap}>
                    <View style={styles.modal}>
                        <View style={styles.modalHead}>
                            <Text style={styles.modalTitle}>What's gone wrong?</Text>
                            <TouchableOpacity onPress={() => setClaimFor(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <X size={20} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {data.parts.length > 0 && (
                            <>
                                <Text style={styles.modalLabel}>Which part?</Text>
                                <View style={styles.chipRow}>
                                    <TouchableOpacity
                                        style={[styles.chip, claimFor?.partItemId === null && styles.chipOn]}
                                        onPress={() => setClaimFor({ partItemId: null, label: 'the work' })}
                                    >
                                        <Text style={[styles.chipText, claimFor?.partItemId === null && styles.chipTextOn]}>
                                            The work itself
                                        </Text>
                                    </TouchableOpacity>
                                    {data.parts.map(p => (
                                        <TouchableOpacity
                                            key={p.id}
                                            style={[styles.chip, claimFor?.partItemId === p.id && styles.chipOn]}
                                            onPress={() => setClaimFor({ partItemId: p.id, label: p.partName })}
                                        >
                                            <Text style={[styles.chipText, claimFor?.partItemId === p.id && styles.chipTextOn]}>
                                                {p.partName}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </>
                        )}

                        <Text style={styles.modalLabel}>What happened?</Text>
                        <TextInput
                            style={styles.textarea}
                            placeholder="e.g. The fan stopped working again after three weeks"
                            placeholderTextColor={colors.textDisabled}
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />

                        <Button title="Send to UniteFix" onPress={submitClaim} loading={submitting} />
                        <Text style={styles.modalNote}>
                            We will inspect it and sort it out with whoever supplied the part.
                        </Text>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md,
        marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
    },
    title: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    rowBody: { flex: 1 },
    rowTitle: { ...typography.captionMedium, color: colors.textPrimary },
    brand: { ...typography.caption, color: colors.textSecondary },
    rowText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    claimBtn: {
        borderWidth: 1, borderColor: colors.primary, borderRadius: radii.sm,
        paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs,
    },
    claimBtnText: { ...typography.captionMedium, color: colors.primary },
    footnote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },

    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
    modal: {
        backgroundColor: colors.background, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
        padding: spacing.lg, paddingBottom: spacing.xl,
    },
    modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
    modalTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    modalLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
    chip: {
        paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm,
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.caption, color: colors.textSecondary },
    chipTextOn: { color: colors.primary },
    textarea: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
        padding: spacing.md, minHeight: 96, marginBottom: spacing.md,
        color: colors.textPrimary, backgroundColor: colors.surface, ...typography.body,
    },
    modalNote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
