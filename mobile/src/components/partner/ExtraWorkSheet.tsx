/**
 * Extra work beyond the booked service — the X+Y: the visit was X, the fix
 * turned out to need Y more. The expert says what it is and what the customer
 * pays for it (GST included); the customer approves it in their app before it
 * reaches the bill, exactly like a spare part.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { partnerApi } from '../../api/partner.api';
import { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;

export default function ExtraWorkSheet({ visible, bookingId, gstPercent, feePercent, onClose, onSent }: {
    visible: boolean; bookingId: number; gstPercent: number; feePercent: number; onClose: () => void; onSent: () => void;
}) {
    const { headerTop } = useScreenInsets();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setDescription(''); setAmount(''); setReason(''); } }, [visible]);

    const y = Number(amount) || 0;
    // The same carving the bill does: GST and UniteFix's fee come out of the amount.
    const gst = Math.round(y * gstPercent / (100 + gstPercent) * 100) / 100;
    const fee = Math.round(y * feePercent / 100 * 100) / 100;
    const earn = Math.max(0, Math.round((y - gst - fee) * 100) / 100);
    const ready = description.trim().length >= 3 && y > 0 && reason.trim().length >= 3;

    const send = async () => {
        setBusy(true);
        try {
            const r = await partnerApi.sendPartRequest(bookingId, { items: [], work: [{ description: description.trim(), amountRupees: y }], reason: reason.trim() });
            onSent(); onClose();
            Alert.alert('Sent to the customer', r.data?.message ?? 'They approve it in their app before it goes on the bill.');
        } catch (e) {
            Alert.alert('Not sent', getApiErrorMessage(e));
        } finally { setBusy(false); }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={[styles.header, { paddingTop: headerTop }]}>
                    <Text style={styles.title}>Extra work</Text>
                    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                        <X size={22} color={colors.textPrimary} />
                    </TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                    <Text style={styles.hint}>For work beyond what was booked. The customer sees it and approves it in their app before it is added to the bill.</Text>

                    <Text style={styles.label}>What is the extra work?</Text>
                    <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="e.g. Rewound the pump motor" placeholderTextColor={colors.textDisabled} maxLength={120} accessibilityLabel="What the extra work is" />

                    <Text style={styles.label}>Customer pays for it (₹, GST included)</Text>
                    <TextInput style={styles.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="numeric" placeholder="e.g. 500" placeholderTextColor={colors.textDisabled} accessibilityLabel="Amount for the extra work" />

                    <Text style={styles.label}>Why it is needed</Text>
                    <TextInput style={[styles.input, styles.multi]} value={reason} onChangeText={setReason} placeholder="e.g. The winding was burnt; the pump would not start" placeholderTextColor={colors.textDisabled} multiline maxLength={300} accessibilityLabel="Why the extra work is needed" />

                    {y > 0 && (
                        <View style={styles.summary}>
                            <View style={styles.row}><Text style={styles.k}>Customer pays</Text><Text style={styles.v}>{rs(y)}</Text></View>
                            <View style={styles.row}><Text style={styles.k}>GST inside it</Text><Text style={styles.v}>{rs(gst)}</Text></View>
                            <View style={styles.row}><Text style={styles.k}>UniteFix fee ({feePercent}%)</Text><Text style={styles.v}>{rs(fee)}</Text></View>
                            <View style={styles.row}><Text style={styles.kStrong}>You earn</Text><Text style={styles.vStrong}>{rs(earn)}</Text></View>
                        </View>
                    )}

                    <Button title="Send to customer for approval" onPress={send} loading={busy} disabled={!ready || busy} />
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h3, color: colors.textPrimary },
    body: { padding: spacing.lg, gap: spacing.sm },
    hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
    label: { ...typography.captionMedium, color: colors.textPrimary, marginTop: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface, minHeight: 48 },
    multi: { minHeight: 80, textAlignVertical: 'top' },
    summary: { marginVertical: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySurface, gap: spacing.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    k: { ...typography.caption, color: colors.textSecondary },
    v: { ...typography.caption, color: colors.textPrimary },
    kStrong: { ...typography.bodyMedium, color: colors.textPrimary },
    vStrong: { ...typography.bodySemibold, color: colors.textPrimary },
});
