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

import React, { useState, useMemo } from 'react';
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

type Props = NativeStackScreenProps<any, 'SubmitBill'>;

const UNITEFIX_FEE_PERCENT = 15;
const GST_PERCENT = 18;
const BOOKING_FEE = 99;

export function SubmitBillScreen({ navigation, route }: Props) {
    const bookingId = route.params?.bookingId || route.params?.serviceId;

    const [partsInput, setPartsInput] = useState('');
    const [laborInput, setLaborInput] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const parts = parseFloat(partsInput) || 0;
    const labor = parseFloat(laborInput) || 0;

    // Real-time billing calculation (mirrors server logic)
    const billing = useMemo(() => {
        const subtotal = parts + labor;
        const uniteFixFee = parseFloat((subtotal * UNITEFIX_FEE_PERCENT / 100).toFixed(2));
        const taxableAmount = subtotal + uniteFixFee;
        const gstTotal = parseFloat((taxableAmount * GST_PERCENT / 100).toFixed(2));
        const cgst = parseFloat((gstTotal / 2).toFixed(2));
        const sgst = parseFloat((gstTotal - cgst).toFixed(2));
        const grossTotal = parseFloat((taxableAmount + gstTotal).toFixed(2));
        const finalTotal = parseFloat(Math.max(0, grossTotal - BOOKING_FEE).toFixed(2));

        return { subtotal, uniteFixFee, taxableAmount, cgst, sgst, gstTotal, grossTotal, finalTotal };
    }, [parts, labor]);

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
                            const { data } = await apiClient.post(`/api/v1/bookings/${bookingId}/submit-bill`, {
                                sparePartsCost: parts,
                                serviceLaborCost: labor,
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
            <View style={styles.header}>
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

                    {/* Spare Parts */}
                    <View style={styles.inputGroup}>
                        <View style={styles.inputLabel}>
                            <Package size={18} color={colors.primary} />
                            <Text style={styles.labelText}>Spare Parts Cost</Text>
                        </View>
                        <View style={styles.inputWrapper}>
                            <Text style={styles.currencySymbol}>₹</Text>
                            <TextInput
                                style={styles.input}
                                value={partsInput}
                                onChangeText={setPartsInput}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                                placeholderTextColor={colors.textDisabled}
                            />
                        </View>
                        <Text style={styles.inputHint}>Cost of any replacement parts used</Text>
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
                        <BreakdownRow label={`UniteFix Fee (${UNITEFIX_FEE_PERCENT}%)`} value={billing.uniteFixFee} color={colors.textSecondary} />
                        <BreakdownRow label="Taxable Amount" value={billing.taxableAmount} />
                        <BreakdownRow label={`CGST (${GST_PERCENT / 2}%)`} value={billing.cgst} color={colors.textSecondary} />
                        <BreakdownRow label={`SGST (${GST_PERCENT / 2}%)`} value={billing.sgst} color={colors.textSecondary} />
                        <View style={styles.divider} />
                        <BreakdownRow label="Gross Total" value={billing.grossTotal} bold />
                        <BreakdownRow label="Booking Fee Paid" value={-BOOKING_FEE} color={colors.success} />
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
            <View style={styles.bottomBar}>
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
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
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
        padding: spacing.xl, paddingBottom: spacing['2xl'],
        backgroundColor: colors.background,
        borderTopWidth: 1, borderTopColor: colors.divider,
    },
});
