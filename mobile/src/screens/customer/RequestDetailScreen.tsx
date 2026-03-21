/**
 * Service Request Detail — Full view with status timeline
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft,
    Phone,
    User,
    MapPin,
    Calendar,
    CheckCircle,
    Clock,
    XCircle,
    Truck,
    Star,
} from 'lucide-react-native';
import { useCancelServiceRequest, useRateService } from '../../hooks/useCustomerData';
import { ServiceRequest } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'RequestDetail'>;

const TIMELINE_STEPS = [
    { key: 'pending', label: 'Request Created', icon: Clock },
    { key: 'assigned', label: 'Technician Assigned', icon: User },
    { key: 'in_progress', label: 'Service In Progress', icon: Truck },
    { key: 'completed', label: 'Service Completed', icon: CheckCircle },
];

function getStepStatus(currentStatus: string, stepKey: string) {
    const order = ['pending', 'assigned', 'in_progress', 'completed'];
    const currentIndex = order.indexOf(currentStatus);
    const stepIndex = order.indexOf(stepKey);
    if (currentStatus === 'cancelled') return stepKey === 'pending' ? 'done' : 'cancelled';
    if (stepIndex < currentIndex) return 'done';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
}

export function RequestDetailScreen({ navigation, route }: Props) {
    const request: ServiceRequest = route.params?.request;
    const [showRating, setShowRating] = useState(false);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState('');

    const { mutate: cancelRequest, isPending: cancelling } = useCancelServiceRequest();
    const { mutate: rateService, isPending: submittingRating } = useRateService();

    if (!request) {
        navigation.goBack();
        return null;
    }

    const canCancel = request.status === 'pending';
    const canRate = request.status === 'completed' && !request.rating;

    const handleCancel = () => {
        Alert.alert('Cancel Request', 'Are you sure you want to cancel this request?', [
            { text: 'No' },
            {
                text: 'Yes, Cancel',
                style: 'destructive',
                onPress: () => {
                    cancelRequest(request.id, {
                        onSuccess: () => navigation.goBack(),
                    });
                },
            },
        ]);
    };

    const handleRate = () => {
        if (rating === 0) {
            Alert.alert('Select Rating', 'Please select a star rating.');
            return;
        }
        rateService(
            { id: request.id, data: { rating, feedback } },
            { onSuccess: () => { setShowRating(false); Alert.alert('Thank you!', 'Your feedback has been submitted.'); } }
        );
    };

    const createdDate = new Date(request.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Request #{request.id}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Service type card */}
                <View style={styles.serviceCard}>
                    <Text style={styles.serviceType}>{request.serviceType.replace(/_/g, ' ')}</Text>
                    <Text style={styles.serviceDesc}>{request.description}</Text>
                    <View style={styles.metaRow}>
                        <Calendar size={14} color={colors.textSecondary} />
                        <Text style={styles.metaText}>{createdDate}</Text>
                    </View>
                    {request.address && (
                        <View style={styles.metaRow}>
                            <MapPin size={14} color={colors.textSecondary} />
                            <Text style={styles.metaText}>{request.address}</Text>
                        </View>
                    )}
                </View>

                {/* Timeline */}
                <Text style={styles.sectionTitle}>Status Timeline</Text>
                <View style={styles.timeline}>
                    {TIMELINE_STEPS.map((step, index) => {
                        const status = getStepStatus(request.status, step.key);
                        const Icon = step.icon;
                        const isLast = index === TIMELINE_STEPS.length - 1;

                        return (
                            <View key={step.key} style={styles.timelineItem}>
                                <View style={styles.timelineDotCol}>
                                    <View
                                        style={[
                                            styles.timelineDot,
                                            status === 'done' && styles.dotDone,
                                            status === 'current' && styles.dotCurrent,
                                            status === 'cancelled' && styles.dotCancelled,
                                        ]}
                                    >
                                        {status === 'done' ? (
                                            <CheckCircle size={14} color="#fff" />
                                        ) : status === 'cancelled' ? (
                                            <XCircle size={14} color="#fff" />
                                        ) : (
                                            <Icon size={14} color={status === 'current' ? '#fff' : colors.textDisabled} />
                                        )}
                                    </View>
                                    {!isLast && (
                                        <View
                                            style={[
                                                styles.timelineLine,
                                                (status === 'done') && styles.lineDone,
                                            ]}
                                        />
                                    )}
                                </View>
                                <View style={styles.timelineContent}>
                                    <Text
                                        style={[
                                            styles.timelineLabel,
                                            status === 'current' && styles.labelCurrent,
                                            status === 'cancelled' && styles.labelCancelled,
                                        ]}
                                    >
                                        {step.label}
                                    </Text>
                                </View>
                            </View>
                        );
                    })}
                    {request.status === 'cancelled' && (
                        <View style={styles.cancelledNote}>
                            <XCircle size={16} color={colors.error} />
                            <Text style={styles.cancelledText}>This request was cancelled</Text>
                        </View>
                    )}
                </View>

                {/* Technician Info */}
                {request.servicemanName && (
                    <View style={styles.techCard}>
                        <Text style={styles.sectionTitle}>Assigned Technician</Text>
                        <View style={styles.techRow}>
                            <View style={styles.techAvatar}>
                                <User size={20} color={colors.primary} />
                            </View>
                            <View style={styles.techInfo}>
                                <Text style={styles.techName}>{request.servicemanName}</Text>
                                {request.servicemanPhone && (
                                    <View style={styles.techPhoneRow}>
                                        <Phone size={12} color={colors.textSecondary} />
                                        <Text style={styles.techPhone}>{request.servicemanPhone}</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    </View>
                )}

                {/* Charges */}
                {request.totalCharge && request.totalCharge > 0 && (
                    <View style={styles.chargesCard}>
                        <Text style={styles.sectionTitle}>Charges</Text>
                        {request.serviceCharge != null && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Service charge</Text>
                                <Text style={styles.chargeValue}>₹{request.serviceCharge}</Text>
                            </View>
                        )}
                        {request.materialCharge != null && request.materialCharge > 0 && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Material charge</Text>
                                <Text style={styles.chargeValue}>₹{request.materialCharge}</Text>
                            </View>
                        )}
                        <View style={[styles.chargeRow, styles.chargeTotal]}>
                            <Text style={styles.totalLabel}>Total</Text>
                            <Text style={styles.totalValue}>₹{request.totalCharge}</Text>
                        </View>
                    </View>
                )}

                {/* Rating */}
                {canRate && !showRating && (
                    <Button title="⭐ Rate This Service" onPress={() => setShowRating(true)} style={styles.actionBtn} />
                )}

                {showRating && (
                    <View style={styles.ratingCard}>
                        <Text style={styles.sectionTitle}>Rate Service</Text>
                        <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <TouchableOpacity key={s} onPress={() => setRating(s)}>
                                    <Star
                                        size={32}
                                        color={s <= rating ? '#FFD700' : colors.border}
                                        fill={s <= rating ? '#FFD700' : 'none'}
                                    />
                                </TouchableOpacity>
                            ))}
                        </View>
                        <Button title="Submit Rating" onPress={handleRate} loading={submittingRating} style={styles.actionBtn} />
                    </View>
                )}

                {request.rating && (
                    <View style={styles.ratingDisplay}>
                        <Text style={styles.sectionTitle}>Your Rating</Text>
                        <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                    key={s}
                                    size={20}
                                    color={s <= request.rating! ? '#FFD700' : colors.border}
                                    fill={s <= request.rating! ? '#FFD700' : 'none'}
                                />
                            ))}
                        </View>
                    </View>
                )}

                {/* Cancel button */}
                {canCancel && (
                    <Button
                        title="Cancel Request"
                        onPress={handleCancel}
                        loading={cancelling}
                        variant="outline"
                        style={styles.cancelBtn}
                    />
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 50,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    serviceCard: {
        backgroundColor: colors.background,
        borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm,
    },
    serviceType: {
        ...typography.h3, color: colors.textPrimary, textTransform: 'capitalize', marginBottom: spacing.sm,
    },
    serviceDesc: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    metaText: { ...typography.caption, color: colors.textSecondary },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    timeline: { marginBottom: spacing.xl },
    timelineItem: { flexDirection: 'row', minHeight: 50 },
    timelineDotCol: { alignItems: 'center', width: 32 },
    timelineDot: {
        width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.border,
    },
    dotDone: { backgroundColor: colors.success, borderColor: colors.success },
    dotCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotCancelled: { backgroundColor: colors.error, borderColor: colors.error },
    timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
    lineDone: { backgroundColor: colors.success },
    timelineContent: { flex: 1, paddingLeft: spacing.md, paddingBottom: spacing.lg },
    timelineLabel: { ...typography.body, color: colors.textSecondary },
    labelCurrent: { color: colors.primary, fontWeight: '600' },
    labelCancelled: { color: colors.error },
    cancelledNote: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.errorLight, padding: spacing.md, borderRadius: radii.md, marginTop: spacing.sm,
    },
    cancelledText: { ...typography.caption, color: colors.error },
    techCard: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm,
    },
    techRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    techAvatar: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface,
        justifyContent: 'center', alignItems: 'center',
    },
    techInfo: { flex: 1 },
    techName: { ...typography.bodyMedium, color: colors.textPrimary },
    techPhoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
    techPhone: { ...typography.caption, color: colors.textSecondary },
    chargesCard: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm,
    },
    chargeRow: {
        flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm,
    },
    chargeLabel: { ...typography.body, color: colors.textSecondary },
    chargeValue: { ...typography.bodyMedium, color: colors.textPrimary },
    chargeTotal: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { ...typography.h4, color: colors.primary },
    starRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    ratingCard: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm,
    },
    ratingDisplay: {
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm,
    },
    actionBtn: { marginBottom: spacing.md },
    cancelBtn: { marginTop: spacing.sm },
});
