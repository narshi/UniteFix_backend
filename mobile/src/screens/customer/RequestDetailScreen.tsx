/**
 * Service Request Detail — Premium UI with full state machine timeline
 * 
 * Features:
 * - Correct 7-step state machine timeline (CREATED → COMPLETED)
 * - Cancel flow (CREATED state only with ₹99 refund)
 * - Payment CTA for PENDING_PAYMENT state
 * - WhatsApp support for ASSIGNED+ states
 * - Premium glassmorphism cards
 * - Star rating with animation
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Animated,
    Linking,
    Platform,
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
    CreditCard,
    MessageCircle,
    Navigation,
    Shield,
    Wrench,
    IndianRupee,
    AlertTriangle,
    KeyRound,
    Copy,
} from 'lucide-react-native';
import { useCancelServiceRequest, useRateService, usePublicConfig } from '../../hooks/useCustomerData';
import { ServiceRequest } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'RequestDetail'>;

// Full state machine timeline matching AI_CONTEXT.md §3.B
const getTimelineSteps = (bookingFee: number) => [
    { key: 'created', label: 'Booking Created', sublabel: `Paid ₹${bookingFee} booking fee`, icon: CreditCard },
    { key: 'assigned', label: 'Technician Assigned', sublabel: 'On the way to your location', icon: User },
    { key: 'accepted', label: 'Technician Accepted', sublabel: 'OTP generated for verification', icon: Shield },
    { key: 'reached', label: 'Technician Arrived', sublabel: 'Location verified via GPS', icon: Navigation },
    { key: 'in_progress', label: 'Service In Progress', sublabel: 'OTP verified, work started', icon: Wrench },
    { key: 'pending_payment', label: 'Payment Due', sublabel: 'Final bill ready for payment', icon: IndianRupee },
    { key: 'completed', label: 'Completed', sublabel: 'Service successfully finished', icon: CheckCircle },
];

const STATUS_ORDER = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment', 'completed'];

function getStepStatus(currentStatus: string, stepKey: string) {
    if (currentStatus === 'cancelled') return stepKey === 'created' ? 'done' : 'cancelled';
    if (currentStatus === 'disputed') {
        const ci = STATUS_ORDER.indexOf('in_progress');
        const si = STATUS_ORDER.indexOf(stepKey);
        return si <= ci ? 'done' : 'disputed';
    }
    const currentIndex = STATUS_ORDER.indexOf(currentStatus);
    const stepIndex = STATUS_ORDER.indexOf(stepKey);
    if (stepIndex < currentIndex) return 'done';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
}

// Custom confirmation modal
function ConfirmModal({
    visible,
    title,
    message,
    confirmText,
    cancelText = 'Cancel',
    confirmVariant = 'danger' as 'danger' | 'primary',
    onConfirm,
    onCancel,
    loading = false,
}: {
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText?: string;
    confirmVariant?: 'danger' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
    loading?: boolean;
}) {
    const slideAnim = useRef(new Animated.Value(300)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
                Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
                Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
            ]).start();
        }
    }, [visible]);

    if (!visible) return null;

    return (
        <Animated.View style={[modalStyles.overlay, { opacity: fadeAnim }]}>
            <Animated.View style={[modalStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>
                <View style={modalStyles.handle} />
                <AlertTriangle size={40} color={confirmVariant === 'danger' ? colors.error : colors.primary} />
                <Text style={modalStyles.title}>{title}</Text>
                <Text style={modalStyles.message}>{message}</Text>
                <View style={modalStyles.actions}>
                    <Button
                        title={confirmText}
                        variant={confirmVariant}
                        onPress={onConfirm}
                        loading={loading}
                        style={{ width: '100%', marginBottom: spacing.md }}
                    />
                    <Button 
                        title={cancelText} 
                        variant="secondary" 
                        onPress={onCancel} 
                        style={{ width: '100%' }} 
                    />
                </View>
            </Animated.View>
        </Animated.View>
    );
}

export function RequestDetailScreen({ navigation, route }: Props) {
    const request: ServiceRequest = route.params?.request;
    const [showRating, setShowRating] = useState(false);
    const [rating, setRating] = useState(0);
    const [feedback, setFeedback] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);

    const { mutate: cancelRequest, isPending: cancelling } = useCancelServiceRequest();
    const { mutate: rateService, isPending: submittingRating } = useRateService();
    const { data: publicConfig } = usePublicConfig();
    
    const bookingFee = request?.bookingFee ?? publicConfig?.bookingFee ?? 99;
    const whatsappNumber = publicConfig?.whatsappNumber || '919448850679';
    const timelineSteps = getTimelineSteps(bookingFee);

    // Animations
    const headerAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    }, []);

    if (!request) {
        navigation.goBack();
        return null;
    }

    // Cancel from early states (before work starts)
    const canCancel = ['created', 'placed', 'confirmed', 'assigned'].includes(request.status);
    const canRate = request.status === 'completed' && !request.rating;
    const needsPayment = request.status === 'pending_payment';
    const isTerminal = ['completed', 'cancelled', 'disputed'].includes(request.status);
    const showServiceCode = ['accepted', 'reached'].includes(request.status) && !!request.handshakeOtp;

    // Support window: active services always show support; terminal services only within 48h
    const supportWindowHours = publicConfig?.supportWindowHours ?? 48;
    const withinSupportWindow = request.completedAt
        ? (Date.now() - new Date(request.completedAt).getTime()) < supportWindowHours * 60 * 60 * 1000
        : false;
    const showSupport = isTerminal
        ? withinSupportWindow
        : ['assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'].includes(request.status);
    const showExpiredSupport = isTerminal && !withinSupportWindow;

    // Privacy: hide serviceman phone for terminal states (server already strips it, this is defense-in-depth)
    const canShowServicemanPhone = !isTerminal && !!request.servicemanPhone;

    const copyOtp = () => {
        if (request.handshakeOtp) {
            Alert.alert('Service Code', `Your code is: ${request.handshakeOtp}`);
        }
    };

    const handleCancel = () => {
        cancelRequest(request.id, {
            onSuccess: () => {
                setShowCancelModal(false);
                navigation.goBack();
            },
        });
    };

    const handleRate = () => {
        if (rating === 0) return;
        rateService(
            { id: request.id, data: { rating, feedback } },
            { onSuccess: () => setShowRating(false) }
        );
    };

    const openWhatsApp = () => {
        if (isTerminal && request.completedAt) {
            const hoursSinceCompletion = (Date.now() - new Date(request.completedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceCompletion > 48) {
                Alert.alert('Support Timeline Over', 'Your support timeline is over (48 hours). Please contact our generic helpdesk for further assistance.');
                return;
            }
        }
        const msg = encodeURIComponent(`Hi, I need help with booking #${request.id}. Service: ${request.serviceType}`);
        Linking.openURL(`https://wa.me/${whatsappNumber}?text=${msg}`);
    };

    const openPayment = () => {
        // Navigate to payment screen
        navigation.navigate('FinalPayment', { request });
    };

    const createdDate = new Date(request.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <View style={styles.container}>
            {/* Premium Header */}
            <Animated.View style={[styles.header, { opacity: headerAnim }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Booking Details</Text>
                    <Text style={styles.headerSub}>#{request.id}</Text>
                </View>
                <View style={{ width: 40 }} />
            </Animated.View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Service Info Card */}
                <View style={styles.serviceCard}>
                    <View style={styles.serviceCardHeader}>
                        <View style={styles.serviceIconWrap}>
                            <Wrench size={20} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.serviceType}>{request.serviceType.replace(/_/g, ' ')}</Text>
                            {(request.brand || request.model) && (
                                <Text style={styles.brandText}>
                                    {request.brand} {request.model ? `- ${request.model}` : ''}
                                </Text>
                            )}
                            <Text style={styles.serviceDesc} numberOfLines={2}>{request.description}</Text>
                        </View>
                    </View>

                    <View style={styles.metaGrid}>
                        <View style={styles.metaItem}>
                            <Calendar size={14} color={colors.textSecondary} />
                            <Text style={styles.metaText}>{createdDate}</Text>
                        </View>
                        {request.address && (
                            <View style={styles.metaItem}>
                                <MapPin size={14} color={colors.textSecondary} />
                                <Text style={styles.metaText} numberOfLines={1}>{request.address}</Text>
                            </View>
                        )}
                    </View>

                    {/* Booking Fee Badge */}
                    <View style={styles.bookingFeeBadge}>
                        <CreditCard size={14} color={colors.accent} />
                        <Text style={styles.bookingFeeText}>₹{bookingFee} Booking Fee Paid</Text>
                        <CheckCircle size={14} color={colors.accent} />
                    </View>
                </View>

                {/* Service Code Card — shown when status is accepted or reached */}
                {showServiceCode && (
                    <View style={styles.serviceCodeCard}>
                        <View style={styles.serviceCodeHeader}>
                            <View style={styles.serviceCodeIconWrap}>
                                <KeyRound size={22} color={colors.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.serviceCodeLabel}>Your Service Code</Text>
                                <Text style={styles.serviceCodeHint}>
                                    Share this code with the technician to start service
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity style={styles.serviceCodeDisplay} onPress={copyOtp} activeOpacity={0.7}>
                            <Text style={styles.serviceCodeDigits}>
                                {request.handshakeOtp!.split('').join(' ')}
                            </Text>
                            <View style={styles.serviceCodeCopyBtn}>
                                <Copy size={16} color={colors.primary} />
                                <Text style={styles.serviceCodeCopyText}>Copy</Text>
                            </View>
                        </TouchableOpacity>
                        <View style={styles.serviceCodeFooter}>
                            <Shield size={14} color={colors.success} />
                            <Text style={styles.serviceCodeFooterText}>
                                Do not share this code with anyone other than your assigned technician
                            </Text>
                        </View>
                    </View>
                )}

                {/* Payment CTA for PENDING_PAYMENT */}
                {needsPayment && (
                    <View style={styles.paymentCard}>
                        <View style={styles.paymentHeader}>
                            <IndianRupee size={24} color={colors.textInverse} />
                            <View style={{ marginLeft: spacing.md }}>
                                <Text style={styles.paymentTitle}>Payment Required</Text>
                                <Text style={styles.paymentAmount}>
                                    ₹{request.pricingSnapshot?.finalTotal || request.totalCharge || 0}
                                </Text>
                            </View>
                        </View>
                        <Button
                            title="Pay Now"
                            variant="success"
                            onPress={openPayment}
                            icon={<CreditCard size={18} color="#fff" />}
                            style={{ marginTop: spacing.base }}
                        />
                    </View>
                )}

                {/* Timeline */}
                <Text style={styles.sectionTitle}>Status Timeline</Text>
                <View style={styles.timeline}>
                    {timelineSteps.map((step, index) => {
                        const status = getStepStatus(request.status, step.key);
                        const Icon = step.icon;
                        const isLast = index === timelineSteps.length - 1;

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
                                                status === 'done' && styles.lineDone,
                                            ]}
                                        />
                                    )}
                                </View>
                                <View style={styles.timelineContent}>
                                    <Text
                                        style={[
                                            styles.timelineLabel,
                                            status === 'current' && styles.labelCurrent,
                                            status === 'done' && styles.labelDone,
                                        ]}
                                    >
                                        {step.label}
                                    </Text>
                                    {(status === 'current' || status === 'done') && (
                                        <Text style={styles.timelineSublabel}>{step.sublabel}</Text>
                                    )}
                                </View>
                            </View>
                        );
                    })}

                    {request.status === 'cancelled' && (
                        <View style={styles.cancelledNote}>
                            <XCircle size={16} color={colors.error} />
                            <Text style={styles.cancelledText}>
                                This booking was cancelled. Your ₹{bookingFee} booking fee has been refunded.
                            </Text>
                        </View>
                    )}
                </View>

                {/* Technician Info */}
                {request.servicemanName && (
                    <View style={styles.techCard}>
                        <Text style={styles.sectionTitle}>
                            {isTerminal ? 'Service Partner' : 'Assigned Technician'}
                        </Text>
                        <View style={styles.techRow}>
                            <View style={styles.techAvatar}>
                                <Text style={styles.techInitial}>
                                    {request.servicemanName.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                            <View style={styles.techInfo}>
                                <Text style={styles.techName}>{request.servicemanName}</Text>
                                {canShowServicemanPhone && (
                                    <TouchableOpacity
                                        style={styles.techPhoneRow}
                                        onPress={() => Linking.openURL(`tel:${request.servicemanPhone}`)}
                                    >
                                        <Phone size={12} color={colors.primary} />
                                        <Text style={styles.techPhone}>{request.servicemanPhone}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {canShowServicemanPhone && (
                                <TouchableOpacity
                                    style={styles.callBtn}
                                    onPress={() => Linking.openURL(`tel:${request.servicemanPhone}`)}
                                >
                                    <Phone size={18} color={colors.primary} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}

                {/* Charges Breakdown */}
                {request.totalCharge && request.totalCharge > 0 && (
                    <View style={styles.chargesCard}>
                        <Text style={styles.sectionTitle}>Bill Summary</Text>
                        {request.serviceCharge != null && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Service Labour</Text>
                                <Text style={styles.chargeValue}>₹{request.serviceCharge}</Text>
                            </View>
                        )}
                        {request.materialCharge != null && request.materialCharge > 0 && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Spare Parts</Text>
                                <Text style={styles.chargeValue}>₹{request.materialCharge}</Text>
                            </View>
                        )}
                        <View style={styles.chargeRow}>
                            <Text style={styles.chargeLabel}>Booking Fee (Credited)</Text>
                            <Text style={[styles.chargeValue, { color: colors.success }]}>-₹{bookingFee}</Text>
                        </View>
                        <View style={[styles.chargeRow, styles.chargeTotal]}>
                            <Text style={styles.totalLabel}>Total</Text>
                            <Text style={styles.totalValue}>₹{request.totalCharge}</Text>
                        </View>
                    </View>
                )}

                {/* OTP Display */}
                {request.otp && ['accepted', 'reached'].includes(request.status) && (
                    <View style={styles.otpCard}>
                        <Shield size={20} color={colors.primary} />
                        <View style={{ marginLeft: spacing.md }}>
                            <Text style={styles.otpLabel}>Handshake OTP</Text>
                            <Text style={styles.otpValue}>{request.otp}</Text>
                        </View>
                        <Text style={styles.otpHint}>Share with technician</Text>
                    </View>
                )}

                {/* Rating */}
                {canRate && !showRating && (
                    <Button
                        title="Rate This Service"
                        variant="outline"
                        onPress={() => setShowRating(true)}
                        icon={<Star size={18} color={colors.primary} />}
                        style={{ marginBottom: spacing.lg }}
                    />
                )}

                {showRating && (
                    <View style={styles.ratingCard}>
                        <Text style={styles.sectionTitle}>How was the service?</Text>
                        <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <TouchableOpacity key={s} onPress={() => setRating(s)} style={styles.starBtn}>
                                    <Star
                                        size={36}
                                        color={s <= rating ? '#F59E0B' : colors.border}
                                        fill={s <= rating ? '#F59E0B' : 'none'}
                                    />
                                </TouchableOpacity>
                            ))}
                        </View>
                        <Button title="Submit Rating" onPress={handleRate} loading={submittingRating} />
                    </View>
                )}

                {request.rating && (
                    <View style={styles.ratingDisplay}>
                        <Text style={styles.sectionTitle}>Your Rating</Text>
                        <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                    key={s}
                                    size={22}
                                    color={s <= request.rating! ? '#F59E0B' : colors.border}
                                    fill={s <= request.rating! ? '#F59E0B' : 'none'}
                                />
                            ))}
                        </View>
                    </View>
                )}

                {/* WhatsApp Support — Active services or within 48h of completion */}
                {showSupport && (
                    <Button
                        title="Contact Support"
                        variant="secondary"
                        onPress={openWhatsApp}
                        icon={<MessageCircle size={18} color={colors.whatsapp} />}
                        style={{ marginBottom: spacing.md }}
                    />
                )}

                {/* Support Expired — Show disabled help button for completed services past 48h */}
                {showExpiredSupport && (
                    <Button
                        title="Help"
                        variant="ghost"
                        onPress={() => Alert.alert(
                            'Support Window Expired',
                            `The ${supportWindowHours}-hour support window for this service has ended. For general inquiries, please contact us through the Profile screen.`
                        )}
                        icon={<MessageCircle size={18} color={colors.textDisabled} />}
                        style={{ marginBottom: spacing.md, opacity: 0.6 }}
                    />
                )}

                {/* Cancel — CREATED state only */}
                {canCancel && (
                    <Button
                        title="Cancel Booking"
                        variant="ghost"
                        onPress={() => setShowCancelModal(true)}
                        style={{ marginTop: spacing.sm }}
                    />
                )}
            </ScrollView>

            {/* Custom Cancel Confirmation Modal */}
            <ConfirmModal
                visible={showCancelModal}
                title="Cancel Booking?"
                message={`Your ₹${bookingFee} booking fee will be fully refunded to your original payment method within 3-5 business days.`}
                confirmText="Yes, Cancel"
                cancelText="Keep Booking"
                confirmVariant="danger"
                onConfirm={handleCancel}
                onCancel={() => setShowCancelModal(false)}
                loading={cancelling}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
        paddingBottom: spacing.base,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        ...shadows.xs,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: radii.lg,
        backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    headerSub: { ...typography.caption, color: colors.textSecondary },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['5xl'] },

    // Service card
    serviceCard: {
        backgroundColor: colors.background,
        borderRadius: radii.xl, padding: spacing.lg, marginBottom: spacing.lg,
        borderWidth: 1, borderColor: colors.border, ...shadows.sm,
    },
    serviceCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.base },
    serviceIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
    serviceType: { ...typography.h5, color: colors.textPrimary, textTransform: 'capitalize', marginBottom: 2 },
    brandText: { ...typography.body2, color: colors.primary, fontWeight: '500', marginBottom: 2 },
    serviceDesc: { ...typography.body2, color: colors.textSecondary, marginTop: 2 },
    metaGrid: { gap: spacing.sm },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    metaText: { ...typography.caption, color: colors.textSecondary, flex: 1 },

    // Booking fee badge
    bookingFeeBadge: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.accentLight, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
        borderRadius: radii.full, marginTop: spacing.md, alignSelf: 'flex-start',
    },
    bookingFeeText: { ...typography.captionMedium, color: colors.accentDark },

    // Payment card
    paymentCard: {
        backgroundColor: colors.primary,
        borderRadius: radii.xl, padding: spacing.lg, marginBottom: spacing.lg,
        ...shadows.glow,
    },
    paymentHeader: { flexDirection: 'row', alignItems: 'center' },
    paymentTitle: { ...typography.captionMedium, color: 'rgba(255,255,255,0.8)' },
    paymentAmount: { ...typography.monoLarge, color: colors.textInverse },

    // Section title
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },

    // Timeline
    timeline: { marginBottom: spacing.xl },
    timelineItem: { flexDirection: 'row', minHeight: 56 },
    timelineDotCol: { alignItems: 'center', width: 32 },
    timelineDot: {
        width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.border,
    },
    dotDone: { backgroundColor: colors.success, borderColor: colors.success },
    dotCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotCancelled: { backgroundColor: colors.error, borderColor: colors.error },
    timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
    lineDone: { backgroundColor: colors.success },
    timelineContent: { flex: 1, paddingLeft: spacing.md, paddingBottom: spacing.lg },
    timelineLabel: { ...typography.bodyMedium, color: colors.textDisabled },
    labelCurrent: { color: colors.primary, fontWeight: '700' },
    labelDone: { color: colors.textPrimary },
    timelineSublabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    cancelledNote: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.errorLight, padding: spacing.md, borderRadius: radii.lg, marginTop: spacing.sm,
    },
    cancelledText: { ...typography.caption, color: colors.errorDark, flex: 1 },

    // Technician
    techCard: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.lg,
        borderWidth: 1, borderColor: colors.border, ...shadows.sm,
    },
    techRow: { flexDirection: 'row', alignItems: 'center' },
    techAvatar: {
        width: 48, height: 48, borderRadius: radii['2xl'],
        backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    },
    techInitial: { ...typography.h3, color: colors.textInverse },
    techInfo: { flex: 1, marginLeft: spacing.md },
    techName: { ...typography.bodySemibold, color: colors.textPrimary },
    techPhoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
    techPhone: { ...typography.caption, color: colors.primary },
    callBtn: {
        width: 44, height: 44, borderRadius: radii.lg,
        backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center',
    },

    // Charges
    chargesCard: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.lg,
        borderWidth: 1, borderColor: colors.border, ...shadows.sm,
    },
    chargeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    chargeLabel: { ...typography.body, color: colors.textSecondary },
    chargeValue: { ...typography.mono, color: colors.textPrimary },
    chargeTotal: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { ...typography.monoLarge, fontSize: 22, color: colors.primary },

    // Service Code Card (customer OTP display)
    serviceCodeCard: {
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.lg,
        marginBottom: spacing.lg,
        borderWidth: 2,
        borderColor: colors.primaryLight,
        ...shadows.md,
    },
    serviceCodeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        marginBottom: spacing.lg,
    },
    serviceCodeIconWrap: {
        width: 48, height: 48, borderRadius: radii.lg,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center', alignItems: 'center',
    },
    serviceCodeLabel: {
        ...typography.h4, color: colors.textPrimary, marginBottom: 2,
    },
    serviceCodeHint: {
        ...typography.caption, color: colors.textSecondary, lineHeight: 18,
    },
    serviceCodeDisplay: {
        backgroundColor: colors.primarySurface,
        borderRadius: radii.lg,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.primaryLight,
        borderStyle: 'dashed',
    },
    serviceCodeDigits: {
        fontSize: 36,
        fontWeight: '800',
        color: colors.primary,
        letterSpacing: 12,
        fontVariant: ['tabular-nums'],
    },
    serviceCodeCopyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.md,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: radii.full,
        backgroundColor: colors.background,
    },
    serviceCodeCopyText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    serviceCodeFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingTop: spacing.sm,
    },
    serviceCodeFooterText: {
        ...typography.small, color: colors.textSecondary, flex: 1, lineHeight: 16,
    },

    // Rating
    starRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
    starBtn: { padding: spacing.xs },
    ratingCard: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center',
        borderWidth: 1, borderColor: colors.border,
    },
    ratingDisplay: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.lg,
        borderWidth: 1, borderColor: colors.border,
    },
    otpCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.xl,
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.primaryLight,
        ...shadows.sm,
    },
    otpLabel: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    otpValue: {
        ...typography.h1,
        color: colors.primary,
        fontWeight: 'bold',
        letterSpacing: 4,
        marginBottom: spacing.sm,
    },
    otpHint: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
    },
});

// Modal styles
const modalStyles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
        zIndex: 100,
    },
    sheet: {
        backgroundColor: colors.background,
        borderTopLeftRadius: radii['3xl'],
        borderTopRightRadius: radii['3xl'],
        padding: spacing['2xl'],
        paddingBottom: spacing['4xl'],
        alignItems: 'center',
    },
    handle: {
        width: 40, height: 4, borderRadius: 2,
        backgroundColor: colors.border, marginBottom: spacing.xl,
    },
    title: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' },
    message: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
    actions: { width: '100%', flexDirection: 'column' },
});
