/**
 * Assignment Detail — Accept/Deny + Customer info + Service flow actions
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    TextInput,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, User, Phone, MapPin, Calendar,
    CheckCircle, XCircle, Play, DollarSign, KeyRound,
} from 'lucide-react-native';
import {
    useAcceptAssignment,
    useDenyAssignment,
    useVerifyHandshake,
    useStartService,
    useCompleteService,
    useEnterServiceCharge,
} from '../../hooks/usePartnerData';
import { Assignment } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'AssignmentDetail'>;

export function AssignmentDetailScreen({ navigation, route }: Props) {
    const assignment: Assignment = route.params?.assignment;
    const [otp, setOtp] = useState('');
    const [serviceCharge, setServiceCharge] = useState('');
    const [materialCharge, setMaterialCharge] = useState('');
    const [showChargeForm, setShowChargeForm] = useState(false);

    const { mutate: accept, isPending: accepting } = useAcceptAssignment();
    const { mutate: deny, isPending: denying } = useDenyAssignment();
    const { mutate: verifyOtp, isPending: verifying } = useVerifyHandshake();
    const { mutate: startSvc, isPending: starting } = useStartService();
    const { mutate: complete, isPending: completing } = useCompleteService();
    const { mutate: enterCharge, isPending: enteringCharge } = useEnterServiceCharge();

    if (!assignment) { navigation.goBack(); return null; }

    const handleAccept = () => {
        Alert.alert('Accept Assignment', 'Take this job?', [
            { text: 'Cancel' },
            { text: 'Accept', onPress: () => accept(assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleDeny = () => {
        Alert.alert('Deny Assignment', 'Are you sure you want to decline?', [
            { text: 'Cancel' },
            { text: 'Deny', style: 'destructive', onPress: () => deny({ id: assignment.id }, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleVerifyOtp = () => {
        if (otp.length < 4) { Alert.alert('Invalid OTP', 'Enter the OTP from the customer.'); return; }
        verifyOtp({ serviceId: assignment.serviceId || assignment.id, otp });
    };

    const handleStart = () => {
        startSvc({ serviceId: assignment.serviceId || assignment.id });
    };

    const handleEnterCharge = () => {
        const charge = parseFloat(serviceCharge);
        if (isNaN(charge) || charge <= 0) { Alert.alert('Invalid', 'Enter a valid service charge.'); return; }
        enterCharge({
            serviceId: assignment.serviceId || assignment.id,
            data: {
                serviceCharge: charge,
                materialCharge: materialCharge ? parseFloat(materialCharge) : undefined,
            },
        });
    };

    const handleComplete = () => {
        Alert.alert('Complete Service', 'Mark this service as done?', [
            { text: 'Cancel' },
            { text: 'Complete', onPress: () => complete(assignment.serviceId || assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const createdDate = new Date(assignment.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Assignment</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Service info card */}
                <View style={styles.card}>
                    <Text style={styles.serviceType}>{assignment.serviceType.replace(/_/g, ' ')}</Text>
                    <Text style={styles.desc}>{assignment.description}</Text>
                    <View style={styles.metaRow}>
                        <Calendar size={14} color={colors.textSecondary} />
                        <Text style={styles.metaText}>{createdDate}</Text>
                    </View>
                    <View style={styles.metaRow}>
                        <MapPin size={14} color={colors.textSecondary} />
                        <Text style={styles.metaText}>{assignment.address}</Text>
                    </View>
                </View>

                {/* Customer info */}
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Customer</Text>
                    <View style={styles.customerRow}>
                        <View style={styles.customerAvatar}>
                            <User size={20} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.customerName}>{assignment.customerName}</Text>
                            <View style={styles.phoneRow}>
                                <Phone size={12} color={colors.textSecondary} />
                                <Text style={styles.phoneText}>{assignment.customerPhone}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Actions based on status */}
                {assignment.status === 'assigned' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Actions</Text>
                        <View style={styles.actionRow}>
                            <Button title="✓ Accept" onPress={handleAccept} loading={accepting} style={styles.acceptBtn} />
                            <TouchableOpacity style={styles.denyBtn} onPress={handleDeny} disabled={denying}>
                                <XCircle size={18} color={colors.error} />
                                <Text style={styles.denyText}>Deny</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {assignment.status === 'accepted' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Verify Customer OTP</Text>
                        <Text style={styles.hintText}>Ask the customer for their OTP before starting the service.</Text>
                        <View style={styles.otpRow}>
                            <TextInput
                                style={styles.otpInput}
                                placeholder="Enter OTP"
                                value={otp}
                                onChangeText={setOtp}
                                keyboardType="number-pad"
                                maxLength={6}
                                placeholderTextColor={colors.textDisabled}
                            />
                            <Button title="Verify" onPress={handleVerifyOtp} loading={verifying} style={styles.otpBtn} />
                        </View>
                        <Button title="▶ Start Service" onPress={handleStart} loading={starting} style={styles.startBtn} />
                    </View>
                )}

                {assignment.status === 'in_progress' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Complete Service</Text>

                        {!showChargeForm ? (
                            <Button title="💰 Enter Charges" onPress={() => setShowChargeForm(true)} style={styles.chargeBtn} />
                        ) : (
                            <View>
                                <Text style={styles.label}>Service Charge (₹) *</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. 500"
                                    value={serviceCharge}
                                    onChangeText={setServiceCharge}
                                    keyboardType="numeric"
                                    placeholderTextColor={colors.textDisabled}
                                />
                                <Text style={styles.label}>Material Charge (₹)</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. 200 (optional)"
                                    value={materialCharge}
                                    onChangeText={setMaterialCharge}
                                    keyboardType="numeric"
                                    placeholderTextColor={colors.textDisabled}
                                />
                                <Button title="Submit Charges" onPress={handleEnterCharge} loading={enteringCharge} />
                            </View>
                        )}

                        <Button title="✅ Mark Complete" onPress={handleComplete} loading={completing} style={styles.completeBtn} />
                    </View>
                )}

                {/* Charges summary (if available) */}
                {assignment.totalCharge != null && assignment.totalCharge > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Charges</Text>
                        {assignment.serviceCharge != null && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Service</Text>
                                <Text style={styles.chargeValue}>₹{assignment.serviceCharge}</Text>
                            </View>
                        )}
                        {assignment.materialCharge != null && assignment.materialCharge > 0 && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Material</Text>
                                <Text style={styles.chargeValue}>₹{assignment.materialCharge}</Text>
                            </View>
                        )}
                        <View style={[styles.chargeRow, styles.totalRow]}>
                            <Text style={styles.totalLabel}>Total</Text>
                            <Text style={styles.totalValue}>₹{assignment.totalCharge}</Text>
                        </View>
                    </View>
                )}
            </ScrollView>
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
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.sm },
    serviceType: { ...typography.h3, color: colors.textPrimary, textTransform: 'capitalize', marginBottom: spacing.sm },
    desc: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    metaText: { ...typography.caption, color: colors.textSecondary },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    customerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center' },
    customerName: { ...typography.bodyMedium, color: colors.textPrimary },
    phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
    phoneText: { ...typography.caption, color: colors.textSecondary },
    actionsCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.md },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    acceptBtn: { flex: 1 },
    denyBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.error },
    denyText: { ...typography.bodyMedium, color: colors.error },
    hintText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
    otpRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    otpInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, fontSize: 18, letterSpacing: 4, textAlign: 'center', color: colors.textPrimary },
    otpBtn: { width: 100 },
    startBtn: { marginTop: spacing.sm },
    chargeBtn: { marginBottom: spacing.md },
    label: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm },
    completeBtn: { marginTop: spacing.lg },
    chargeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    chargeLabel: { ...typography.body, color: colors.textSecondary },
    chargeValue: { ...typography.bodyMedium, color: colors.textPrimary },
    totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { ...typography.h4, color: colors.primary },
});
