/**
 * Service History Detail — Read-only detail screen for past services (Partner view)
 *
 * Shows: service info, customer name (no phone), timeline, billing breakdown,
 * rating received, and a time-gated WhatsApp support button (48h window).
 */

import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Animated,
    Linking,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft,
    User,
    MapPin,
    Calendar,
    CheckCircle,
    XCircle,
    Star,
    Wrench,
    MessageCircle,
    Navigation,
    Shield,
    AlertTriangle,
} from 'lucide-react-native';
import { Assignment } from '../../api/partner.api';
import MissingBills from '../../components/partner/MissingBills';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { usePublicConfig } from '../../hooks/useCustomerData';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'ServiceHistoryDetail'>;

// Timeline steps for completed service
const TIMELINE_STEPS = [
    { key: 'assigned', label: 'Job Assigned', icon: User },
    { key: 'accepted', label: 'You Accepted', icon: Shield },
    { key: 'reached', label: 'Reached Location', icon: Navigation },
    { key: 'in_progress', label: 'Work Started', icon: Wrench },
    { key: 'completed', label: 'Service Completed', icon: CheckCircle },
];

function formatDateTime(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function ServiceHistoryDetailScreen({ navigation, route }: Props) {
    const { headerTop } = useScreenInsets();
    const assignment: Assignment = route.params?.assignment;

    // Animations
    const headerAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    }, []);

    if (!assignment) {
        navigation.goBack();
        return null;
    }

    const isDone = assignment.status === 'completed';
    const isCancelled = assignment.status === 'cancelled';

    const { data: publicConfig } = usePublicConfig();

    // Support window: configurable hours from completedAt
    const SUPPORT_WINDOW_HOURS = publicConfig?.supportWindowHours ?? 48;
    const completedAt = (assignment as any).completedAt;
    const withinSupportWindow = completedAt
        ? (Date.now() - new Date(completedAt).getTime()) < SUPPORT_WINDOW_HOURS * 60 * 60 * 1000
        : false;

    const whatsappNumber = publicConfig?.whatsappNumber || '919448850679';
    const openWhatsApp = () => {
        const msg = encodeURIComponent(
            `Hi, I need help with service ${assignment.serviceId || '#' + assignment.id}. Type: ${assignment.serviceType.replace(/_/g, ' ')}`
        );
        Linking.openURL(`https://wa.me/${whatsappNumber}?text=${msg}`);
    };

    const handleSupportPress = () => {
        if (withinSupportWindow) {
            openWhatsApp();
        } else {
            Alert.alert(
                'Support Window Expired',
                `The ${SUPPORT_WINDOW_HOURS}-hour support window for this service has ended. For general inquiries, please contact support through the Profile screen.`
            );
        }
    };

    // Timeline: check which steps have timestamps
    const getStepTimestamp = (key: string): string | null => {
        const a = assignment as any;
        switch (key) {
            case 'assigned': return a.assignedAt;
            case 'accepted': return a.assignedAt; // No separate acceptedAt, uses assignedAt
            case 'reached': return a.reachedAt;
            case 'in_progress': return a.startedAt;
            case 'completed': return a.completedAt;
            default: return null;
        }
    };

    // Billing calculations
    const serviceCharge = assignment.serviceCharge ?? 0;
    const materialCharge = assignment.materialCharge ?? 0;
    const totalCharge = assignment.totalCharge ?? 0;
    const bookingFee = (assignment as any).bookingFee ?? 99;
    const commissionAmount = (assignment as any).commissionAmount ?? 0;
    const partnerEarning = totalCharge - commissionAmount;

    return (
        <View style={styles.container}>
            {/* Header */}
            <Animated.View style={[styles.header, { paddingTop: headerTop }, { opacity: headerAnim }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Service Details</Text>
                    <Text style={styles.headerSub}>{assignment.serviceId || `#${assignment.id}`}</Text>
                </View>
                <View style={{ width: 40 }} />
            </Animated.View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Paperwork the technician still owes on this job. */}
                {isDone && <MissingBills bookingId={assignment.id} />}

                {/* Status Badge */}
                <View style={[styles.statusBadge, {
                    backgroundColor: isDone ? colors.successLight : isCancelled ? colors.errorLight : colors.warningLight,
                }]}>
                    {isDone ? <CheckCircle size={16} color={colors.successDark} /> : isCancelled ? <XCircle size={16} color={colors.errorDark} /> : <AlertTriangle size={16} color={colors.warningDark} />}
                    <Text style={[styles.statusText, {
                        color: isDone ? colors.successDark : isCancelled ? colors.errorDark : colors.warningDark,
                    }]}>
                        {isDone ? 'Completed' : isCancelled ? 'Cancelled' : assignment.status.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                </View>

                {/* Service Info Card */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.serviceIconWrap}>
                            <Wrench size={20} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.serviceType}>{assignment.serviceType.replace(/_/g, ' ')}</Text>
                            {assignment.serviceId && (
                                <Text style={styles.serviceId}>{assignment.serviceId}</Text>
                            )}
                            <Text style={styles.description} numberOfLines={2}>{assignment.description}</Text>
                        </View>
                    </View>

                    <View style={styles.metaGrid}>
                        <View style={styles.metaItem}>
                            <Calendar size={14} color={colors.textSecondary} />
                            <Text style={styles.metaText}>{formatDateTime(assignment.createdAt)}</Text>
                        </View>
                        {assignment.address && (
                            <View style={styles.metaItem}>
                                <MapPin size={14} color={colors.textSecondary} />
                                <Text style={styles.metaText} numberOfLines={1}>{assignment.address}</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Customer Info — Name only, no phone (privacy) */}
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Customer</Text>
                    <View style={styles.personRow}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarInitial}>
                                {assignment.customerName?.charAt(0).toUpperCase() || '?'}
                            </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.personName}>{assignment.customerName || 'Customer'}</Text>
                            <Text style={styles.personSub}>Contact hidden for completed services</Text>
                        </View>
                    </View>
                </View>

                {/* Timeline */}
                {isDone && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Service Timeline</Text>
                        {TIMELINE_STEPS.map((step, index) => {
                            const timestamp = getStepTimestamp(step.key);
                            const isLast = index === TIMELINE_STEPS.length - 1;
                            const Icon = step.icon;
                            const hasTimestamp = !!timestamp;

                            return (
                                <View key={step.key} style={styles.timelineItem}>
                                    <View style={styles.timelineDotCol}>
                                        <View style={[styles.timelineDot, hasTimestamp && styles.dotDone]}>
                                            {hasTimestamp ? (
                                                <CheckCircle size={12} color="#fff" />
                                            ) : (
                                                <Icon size={12} color={colors.textDisabled} />
                                            )}
                                        </View>
                                        {!isLast && (
                                            <View style={[styles.timelineLine, hasTimestamp && styles.lineDone]} />
                                        )}
                                    </View>
                                    <View style={styles.timelineContent}>
                                        <Text style={[styles.timelineLabel, hasTimestamp && styles.labelDone]}>
                                            {step.label}
                                        </Text>
                                        {hasTimestamp && (
                                            <Text style={styles.timelineSublabel}>
                                                {formatDateTime(timestamp)}
                                            </Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                {/* Billing Breakdown */}
                {totalCharge > 0 && (
                    <View style={[styles.card, shadows.md]}>
                        <Text style={styles.sectionTitle}>Billing Summary</Text>

                        {serviceCharge > 0 && (
                            <View style={styles.billingRow}>
                                <Text style={styles.billingLabel}>Service Labour</Text>
                                <Text style={styles.billingValue}>₹{serviceCharge}</Text>
                            </View>
                        )}
                        {materialCharge > 0 && (
                            <View style={styles.billingRow}>
                                <Text style={styles.billingLabel}>Spare Parts</Text>
                                <Text style={styles.billingValue}>₹{materialCharge}</Text>
                            </View>
                        )}
                        <View style={styles.billingRow}>
                            <Text style={styles.billingLabel}>Booking Fee (Credited)</Text>
                            <Text style={[styles.billingValue, { color: colors.success }]}>-₹{bookingFee}</Text>
                        </View>
                        {commissionAmount > 0 && (
                            <View style={styles.billingRow}>
                                <Text style={styles.billingLabel}>Platform Fee</Text>
                                <Text style={[styles.billingValue, { color: colors.error }]}>-₹{commissionAmount}</Text>
                            </View>
                        )}
                        <View style={[styles.billingRow, styles.billingTotal]}>
                            <Text style={styles.totalLabel}>Customer Paid</Text>
                            <Text style={styles.totalValue}>₹{totalCharge}</Text>
                        </View>
                        {commissionAmount > 0 && (
                            <View style={[styles.billingRow, { marginTop: spacing.xs }]}>
                                <Text style={[styles.totalLabel, { color: colors.primary }]}>Your Earning</Text>
                                <Text style={[styles.totalValue, { color: colors.primary }]}>₹{partnerEarning}</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Rating Received */}
                {assignment.rating != null && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Customer Rating</Text>
                        <View style={styles.ratingRow}>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                    key={s}
                                    size={24}
                                    color={s <= assignment.rating! ? '#F59E0B' : colors.border}
                                    fill={s <= assignment.rating! ? '#F59E0B' : 'none'}
                                />
                            ))}
                        </View>
                        {assignment.feedback && (
                            <Text style={styles.feedbackText}>"{assignment.feedback}"</Text>
                        )}
                    </View>
                )}

                {/* Help / Support Button */}
                <Button
                    title={withinSupportWindow ? 'Contact Support' : 'Help'}
                    variant={withinSupportWindow ? 'secondary' : 'ghost'}
                    onPress={handleSupportPress}
                    icon={<MessageCircle size={18} color={withinSupportWindow ? colors.whatsapp : colors.textDisabled} />}
                    style={{ marginBottom: spacing.md, opacity: withinSupportWindow ? 1 : 0.6 }}
                />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingBottom: spacing.base, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1, borderBottomColor: colors.divider,
        ...shadows.xs,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: radii.lg,
        backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { ...typography.h3, color: colors.textPrimary },
    headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    scrollContent: { padding: spacing.lg, paddingBottom: 120 },

    // Status badge
    statusBadge: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
        borderRadius: radii.full, gap: spacing.xs, marginBottom: spacing.lg,
    },
    statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

    // Cards
    card: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.md,
        borderWidth: 1, borderColor: colors.border, ...shadows.sm,
    },
    cardHeader: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    serviceIconWrap: {
        width: 44, height: 44, borderRadius: radii.lg,
        backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center',
    },
    serviceType: { ...typography.bodySemibold, color: colors.textPrimary, textTransform: 'capitalize' },
    serviceId: { ...typography.small, color: colors.primary, marginTop: 2, letterSpacing: 0.5 },
    description: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    metaGrid: { gap: spacing.sm },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    metaText: { ...typography.small, color: colors.textSecondary, flex: 1 },
    sectionTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.md },

    // Person
    personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center',
    },
    avatarInitial: { ...typography.h3, color: colors.primary },
    personName: { ...typography.bodyMedium, color: colors.textPrimary },
    personSub: { ...typography.small, color: colors.textDisabled, marginTop: 2 },

    // Timeline
    timelineItem: { flexDirection: 'row', marginBottom: 0 },
    timelineDotCol: { alignItems: 'center', width: 32, marginRight: spacing.md },
    timelineDot: {
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border,
        justifyContent: 'center', alignItems: 'center',
    },
    dotDone: { backgroundColor: colors.success, borderColor: colors.success },
    timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, minHeight: 20 },
    lineDone: { backgroundColor: colors.success },
    timelineContent: { flex: 1, paddingBottom: spacing.lg },
    timelineLabel: { ...typography.bodyMedium, color: colors.textDisabled },
    labelDone: { color: colors.textPrimary },
    timelineSublabel: { ...typography.small, color: colors.textSecondary, marginTop: 2 },

    // Billing
    billingRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: spacing.sm,
    },
    billingLabel: { ...typography.body, color: colors.textSecondary },
    billingValue: { ...typography.bodyMedium, color: colors.textPrimary },
    billingTotal: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.bodySemibold, color: colors.textPrimary },
    totalValue: { ...typography.h3, color: colors.textPrimary },

    // Rating
    ratingRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
    feedbackText: { ...typography.body, color: colors.textSecondary, fontStyle: 'italic', marginTop: spacing.xs },
});
