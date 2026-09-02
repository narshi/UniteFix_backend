/**
 * PHASE 5: Submit Bill Screen — Employee enters costs after service
 *
 * Two numeric inputs:
 * 1. Spare Parts Cost (₹)
 * 2. Service Labor Cost (₹)
 *
 * Shows real-time billing breakdown:
 *   Subtotal → +15% UniteFix Fee → +18% GST → -₹99 booking → Final Total
 *
 * On submit: POST /api/v1/bookings/:id/submit-bill
 * Transitions: IN_PROGRESS → PENDING_PAYMENT
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    ScrollView,
    TouchableOpacity,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Package, Wrench, Receipt, IndianRupee } from 'lucide-react-native';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';
import PartsEntry, { PartDraft, newPartDraft, toPartItems, partsTotalRupees, uploadPendingBills } from '../../components/partner/PartsEntry';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'SubmitBill'>;

// Defaults — overridden by API config on mount
const DEFAULT_FEE_PERCENT = 15;
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_BOOKING_FEE = 99;

export function SubmitBillScreen({ navigation, route }: Props) {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const bookingId = route.params?.bookingId || route.params?.serviceId;

    const [partDrafts, setPartDrafts] = useState<PartDraft[]>([]);
    const [uploadingBills, setUploadingBills] = useState(false);
    const [laborInput, setLaborInput] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Dynamic config from server (frozen snapshot rates)
    const [feePercent, setFeePercent] = useState(DEFAULT_FEE_PERCENT);
    const [gstPercent, setGstPercent] = useState(DEFAULT_GST_PERCENT);
    const [bookingFee, setBookingFee] = useState(DEFAULT_BOOKING_FEE);

    // Fetch billing config from server on mount
    useEffect(() => {
        (async () => {
            try {
                const { data } = await apiClient.get('/api/config/public');
                const config = data?.data || data; // Handle both { data: {...} } and direct shapes
                if (config?.platformFeePercent !== undefined && config?.platformFeePercent !== null) setFeePercent(config.platformFeePercent);
                if (config?.gstRate !== undefined && config?.gstRate !== null) setGstPercent(config.gstRate);
                if (config?.bookingFee !== undefined && config?.bookingFee !== null) setBookingFee(config.bookingFee);
            } catch (err) {
                // Use defaults if config fetch fails
                console.warn('Failed to fetch billing config, using defaults');
            }
        })();
    }, []);

    // Derived from the line items, so the bill and the parts record can never
    // disagree about what the customer was charged.
    const parts = partsTotalRupees(partDrafts);
    const labor = parseFloat(laborInput) || 0;

    // Real-time billing calculation — uses Math.round() to match server BillingEngine exactly
    const billing = useMemo(() => {
        const subtotal = Math.round(parts + labor);
        const uniteFixFee = Math.round(subtotal * feePercent / 100);
        const taxableAmount = subtotal + uniteFixFee;
        const totalGst = Math.round(taxableAmount * gstPercent / 100);
        const cgst = Math.round(totalGst / 2);
        const sgst = totalGst - cgst; // Remainder avoids rounding loss
        const grossTotal = taxableAmount + totalGst;
        const finalTotal = Math.max(0, grossTotal - bookingFee);

        return { subtotal, uniteFixFee, taxableAmount, cgst, sgst, gstTotal: totalGst, grossTotal, finalTotal };
    }, [parts, labor, feePercent, gstPercent, bookingFee]);

    const canSubmit = parts + labor > 0;

    const handleSubmit = async () => {
        if (!canSubmit) return;

        Alert.alert(
            'Confirm Bill Submission',
            `Customer will be charged ₹${billing.finalTotal.toFixed(2)}.\n\nThis cannot be changed after submission.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Submit Bill',
                    style: 'default',
                    onPress: async () => {
                        setSubmitting(true);
                        try {
                            // Bill photos first, but a failed upload never blocks
                            // the bill — the part is recorded without its bill,
                            // which is exactly what "undocumented" means.
                            const named = partDrafts.filter(d => d.partName.trim());
                            let items = named.length ? toPartItems(named) : undefined;
                            if (named.length) {
                                setUploadingBills(true);
                                try {
                                    const { parts: withUrls, failed } = await uploadPendingBills(named);
                                    items = toPartItems(withUrls);
                                    if (failed > 0) {
                                        Alert.alert(
                                            'Bill photo did not upload',
                                            `${failed === 1 ? 'One bill' : failed + ' bills'} could not be sent, probably signal. `
                                            + 'The parts are still recorded and you can add the photo later.',
                                        );
                                    }
                                } finally {
                                    setUploadingBills(false);
                                }
                            }

                            const { data } = await apiClient.post(`/api/v1/bookings/${bookingId}/submit-bill`, {
                                sparePartsCost: parts,
                                serviceLaborCost: labor,
                                partItems: items,
                            });

                            if (data?.success) {
                                Alert.alert(
                                    '✅ Bill Submitted',
                                    'Customer will receive a payment request. The booking is now awaiting payment.',
                                    [{ text: 'OK', onPress: () => navigation.goBack() }],
                                );
                            }
                        } catch (err) {
                            Alert.alert('Error', getApiErrorMessage(err));
                        } finally {
                            setSubmitting(false);
                        }
                    },
                },
            ],
        );
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Submit Bill</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {/* Input Section */}
                <View style={styles.inputSection}>
                    <Text style={styles.sectionTitle}>Service Costs</Text>

                    {/* Spare Parts — itemised, so a warranty claim can be answered later */}
                    <View style={styles.inputGroup}>
                        <View style={styles.inputLabel}>
                            <Package size={18} color={colors.primary} />
                            <Text style={styles.labelText}>Spare Parts</Text>
                        </View>
                        {partDrafts.length === 0 ? (
                            <TouchableOpacity
                                style={styles.addPartsBtn}
                                onPress={() => setPartDrafts([newPartDraft()])}
                            >
                                <Text style={styles.addPartsBtnText}>+ Add a spare part</Text>
                            </TouchableOpacity>
                        ) : (
                            <PartsEntry parts={partDrafts} onChange={setPartDrafts} />
                        )}
                        <Text style={styles.inputHint}>Leave empty if no parts were used</Text>
                    </View>

                    {/* Labor */}
                    <View style={styles.inputGroup}>
                        <View style={styles.inputLabel}>
                            <Wrench size={18} color={colors.primary} />
                            <Text style={styles.labelText}>Service Labor Cost</Text>
                        </View>
                        <View style={styles.inputWrapper}>
                            <Text style={styles.currencySymbol}>₹</Text>
                            <TextInput
                                style={styles.input}
                                value={laborInput}
                                onChangeText={setLaborInput}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                                placeholderTextColor={colors.textDisabled}
                            />
                        </View>
                        <Text style={styles.inputHint}>Your service/labor charge</Text>
                    </View>
                </View>

                {/* Billing Breakdown */}
                {canSubmit && (
                    <View style={styles.breakdownSection}>
                        <View style={styles.breakdownHeader}>
                            <Receipt size={18} color={colors.primary} />
                            <Text style={styles.sectionTitle}>Billing Breakdown</Text>
                        </View>

                        <BreakdownRow label="Spare Parts" value={parts} />
                        <BreakdownRow label="Service Labor" value={labor} />
                        <View style={styles.divider} />
                        <BreakdownRow label="Subtotal" value={billing.subtotal} bold />
                        <BreakdownRow label={`UniteFix Fee (${feePercent}%)`} value={billing.uniteFixFee} color={colors.textSecondary} />
                        <BreakdownRow label="Taxable Amount" value={billing.taxableAmount} />
                        <BreakdownRow label={`CGST (${gstPercent / 2}%)`} value={billing.cgst} color={colors.textSecondary} />
                        <BreakdownRow label={`SGST (${gstPercent / 2}%)`} value={billing.sgst} color={colors.textSecondary} />
                        <View style={styles.divider} />
                        <BreakdownRow label="Gross Total" value={billing.grossTotal} bold />
                        <BreakdownRow label="Booking Fee Paid" value={-bookingFee} color={colors.success} />
                        <View style={styles.divider} />
                        <View style={styles.finalRow}>
                            <Text style={styles.finalLabel}>Customer Pays</Text>
                            <Text style={styles.finalValue}>₹{billing.finalTotal.toFixed(2)}</Text>
                        </View>

                        {/* Employee earnings callout */}
                        <View style={styles.earningsCard}>
                            <IndianRupee size={16} color={colors.success} />
                            <Text style={styles.earningsText}>
                                Your earnings: ₹{billing.subtotal.toFixed(2)}
                            </Text>
                        </View>
                    </View>
                )}
            </ScrollView>

            {/* Submit Button */}
            <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
                <Button
                    title={submitting ? 'Submitting...' : `Submit Bill — ₹${billing.finalTotal.toFixed(2)}`}
                    onPress={handleSubmit}
                    loading={submitting}
                    disabled={!canSubmit || submitting}
                />
            </View>
        </KeyboardAvoidingView>
    );
}

function BreakdownRow({
    label, value, bold, color,
}: {
    label: string; value: number; bold?: boolean; color?: string;
}) {
    return (
        <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, bold && styles.breakdownBold, color ? { color } : null]}>
                {label}
            </Text>
            <Text style={[styles.breakdownValue, bold && styles.breakdownBold, color ? { color } : null]}>
                {value < 0 ? `-₹${Math.abs(value).toFixed(2)}` : `₹${value.toFixed(2)}`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    addPartsBtn: {
        borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
        borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginBottom: 8,
    },
    addPartsBtnText: { color: colors.primary, fontWeight: '600' },
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.xl, paddingBottom: 100 },

    // Input section
    inputSection: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.lg, ...shadows.sm,
    },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    inputGroup: { marginBottom: spacing.lg },
    inputLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    labelText: { ...typography.bodyMedium, color: colors.textPrimary },
    inputWrapper: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md,
        backgroundColor: colors.surface, paddingHorizontal: spacing.md,
    },
    currencySymbol: { fontSize: 20, fontWeight: '600', color: colors.textSecondary, marginRight: spacing.xs },
    input: {
        flex: 1, height: 48, fontSize: 20, fontWeight: '600',
        color: colors.textPrimary,
    },
    inputHint: { ...typography.small, color: colors.textDisabled, marginTop: spacing.xs },

    // Breakdown section
    breakdownSection: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, ...shadows.sm,
    },
    breakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    breakdownRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: spacing.xs + 2,
    },
    breakdownLabel: { ...typography.caption, color: colors.textPrimary },
    breakdownValue: { ...typography.caption, color: colors.textPrimary },
    breakdownBold: { fontWeight: '700', fontSize: 14 },
    divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
    finalRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: spacing.md,
    },
    finalLabel: { ...typography.h4, color: colors.textPrimary },
    finalValue: { fontSize: 24, fontWeight: '800', color: colors.primary },
    earningsCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.successLight, borderRadius: radii.md,
        padding: spacing.md, marginTop: spacing.md,
    },
    earningsText: { ...typography.bodyMedium, color: colors.success, fontWeight: '600' },

    // Bottom bar
    bottomBar: {
        padding: spacing.xl, backgroundColor: colors.background,
        borderTopWidth: 1, borderTopColor: colors.divider,
    },
});
