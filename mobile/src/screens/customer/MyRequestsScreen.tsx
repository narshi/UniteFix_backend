/**
 * My Bookings — Senior-level redesign
 *
 * Architecture:
 * - Segmented tab control (Active / History) with animated sliding indicator
 * - Active tab: Date-grouped cards (Today, Tomorrow, This Week, Later)
 *   with service-type icons, left accent bar, tech info, address row
 * - History tab: Month-grouped compact cards with inline star ratings
 * - Per-tab pull-to-refresh; infinite scroll on History only
 * - Shimmer skeletons matching actual card shapes
 * - Empty states per tab with CTA button
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    Animated,
    Platform,
    ActivityIndicator,
    Dimensions,
    LayoutAnimation,
    UIManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
    ChevronRight,
    Calendar,
    ClipboardList,
    Clock,
    CheckCircle,
    User,
    Navigation,
    Wrench,
    XCircle,
    CreditCard,
    IndianRupee,
    AlertTriangle,
    Shield,
    MapPin,
    Star,
    Snowflake,
    Droplets,
    Zap,
    Hammer,
    Paintbrush,
    Sparkles,
    Bug,
    ArrowRight,
    History,
} from 'lucide-react-native';
import { useServiceRequests, useServiceHistory, usePublicConfig } from '../../hooks/useCustomerData';
import { ServiceRequest } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ==================== SERVICE TYPE ICON MAP ====================

type ServiceIconConfig = { icon: any; color: string };

const SERVICE_ICON_MAP: Record<string, ServiceIconConfig> = {
    ac_repair: { icon: Snowflake, color: '#3B82F6' },
    ac_service: { icon: Snowflake, color: '#3B82F6' },
    ac: { icon: Snowflake, color: '#3B82F6' },
    plumber: { icon: Droplets, color: '#06B6D4' },
    plumbing: { icon: Droplets, color: '#06B6D4' },
    electrician: { icon: Zap, color: '#F59E0B' },
    electrical: { icon: Zap, color: '#F59E0B' },
    carpenter: { icon: Hammer, color: '#8B5CF6' },
    carpentry: { icon: Hammer, color: '#8B5CF6' },
    appliance_repair: { icon: Wrench, color: '#EF4444' },
    appliance: { icon: Wrench, color: '#EF4444' },
    painting: { icon: Paintbrush, color: '#EC4899' },
    painter: { icon: Paintbrush, color: '#EC4899' },
    cleaning: { icon: Sparkles, color: '#10B981' },
    deep_cleaning: { icon: Sparkles, color: '#10B981' },
    pest_control: { icon: Bug, color: '#84CC16' },
};

const DEFAULT_SERVICE_ICON: ServiceIconConfig = { icon: Wrench, color: '#64748B' };

function getServiceIcon(serviceType: string): ServiceIconConfig {
    const key = serviceType.toLowerCase().replace(/\s+/g, '_');
    return SERVICE_ICON_MAP[key] || DEFAULT_SERVICE_ICON;
}

// ==================== STATUS CONFIG ====================

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; icon: any }> = {
    created: { bg: colors.warningLight, text: colors.warningDark, label: 'Created', icon: Clock },
    assigned: { bg: colors.infoLight, text: colors.info, label: 'Assigned', icon: User },
    accepted: { bg: colors.infoLight, text: colors.info, label: 'Accepted', icon: Shield },
    reached: { bg: colors.primarySurface, text: colors.primary, label: 'Arrived', icon: Navigation },
    in_progress: { bg: colors.primarySurface, text: colors.primary, label: 'In Progress', icon: Wrench },
    pending_payment: { bg: colors.warningLight, text: colors.warningDark, label: 'Pay Now', icon: IndianRupee },
    completed: { bg: colors.successLight, text: colors.successDark, label: 'Completed', icon: CheckCircle },
    cancelled: { bg: colors.errorLight, text: colors.errorDark, label: 'Cancelled', icon: XCircle },
    disputed: { bg: colors.errorLight, text: colors.errorDark, label: 'Disputed', icon: AlertTriangle },
};

// ==================== STATUS CHIP ====================

function StatusChip({ status }: { status: string }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.created;
    const Icon = config.icon;
    return (
        <View style={[chipStyles.chip, { backgroundColor: config.bg }]}>
            <Icon size={11} color={config.text} strokeWidth={2.5} />
            <Text style={[chipStyles.text, { color: config.text }]}>{config.label}</Text>
        </View>
    );
}

const chipStyles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radii.full,
    },
    text: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
});

// ==================== SEGMENTED CONTROL ====================

function SegmentedControl({
    tabs,
    activeIndex,
    onTabPress,
}: {
    tabs: { label: string; count?: number }[];
    activeIndex: number;
    onTabPress: (index: number) => void;
}) {
    const slideAnim = useRef(new Animated.Value(0)).current;
    const segmentWidth = (SCREEN_WIDTH - spacing.xl * 2 - 6) / tabs.length;

    useEffect(() => {
        Animated.spring(slideAnim, {
            toValue: activeIndex * segmentWidth,
            useNativeDriver: true,
            tension: 68,
            friction: 12,
        }).start();
    }, [activeIndex]);

    return (
        <View style={segStyles.container}>
            {/* Sliding indicator */}
            <Animated.View
                style={[
                    segStyles.indicator,
                    { width: segmentWidth, transform: [{ translateX: slideAnim }] },
                ]}
            />
            {tabs.map((tab, i) => (
                <TouchableOpacity
                    key={i}
                    style={[segStyles.tab, { width: segmentWidth }]}
                    onPress={() => onTabPress(i)}
                    activeOpacity={0.7}
                >
                    <Text
                        style={[
                            segStyles.tabText,
                            activeIndex === i && segStyles.tabTextActive,
                        ]}
                    >
                        {tab.label}
                    </Text>
                    {tab.count !== undefined && tab.count > 0 && (
                        <View
                            style={[
                                segStyles.badge,
                                activeIndex === i
                                    ? { backgroundColor: colors.primary }
                                    : { backgroundColor: colors.textDisabled },
                            ]}
                        >
                            <Text style={segStyles.badgeText}>{tab.count}</Text>
                        </View>
                    )}
                </TouchableOpacity>
            ))}
        </View>
    );
}

const segStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
        padding: 3,
        marginHorizontal: spacing.xl,
        marginTop: spacing.base,
        marginBottom: spacing.base,
        height: 42,
        position: 'relative',
    },
    indicator: {
        position: 'absolute',
        top: 3,
        left: 3,
        height: 36,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        ...shadows.sm,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        zIndex: 1,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    tabTextActive: {
        fontWeight: '600',
        color: colors.textPrimary,
    },
    badge: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 5,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#FFFFFF',
    },
});

// ==================== DATE GROUPING UTILS ====================

function getDateGroup(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));

    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
    if (d <= endOfWeek) return 'This Week';
    return 'Later';
}

function getMonthGroup(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }).toUpperCase();
}

function groupItems<T extends { createdAt: string }>(
    items: T[],
    groupFn: (dateStr: string) => string,
): { type: 'header'; title: string }[] | { type: 'item'; data: T }[] {
    const result: any[] = [];
    let lastGroup = '';
    items.forEach((item) => {
        const group = groupFn(item.createdAt);
        if (group !== lastGroup) {
            result.push({ type: 'header', title: group });
            lastGroup = group;
        }
        result.push({ type: 'item', data: item });
    });
    return result;
}

// ==================== ACTIVE BOOKING CARD ====================

function ActiveBookingCard({
    item,
    onPress,
    index,
}: {
    item: ServiceRequest;
    onPress: () => void;
    index: number;
}) {
    const { data: publicConfig } = usePublicConfig();
    const defaultBookingFee = publicConfig?.bookingFee ?? 99;
    const slideAnim = useRef(new Animated.Value(24)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 350,
                delay: Math.min(index, 6) * 60,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 350,
                delay: Math.min(index, 6) * 60,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    const serviceIcon = getServiceIcon(item.serviceType);
    const ServiceIcon = serviceIcon.icon;
    const needsPayment = item.status === 'pending_payment';

    const dateTime = new Date(item.createdAt);
    const timeStr = dateTime.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
    const dateStr = dateTime.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
    });

    // Truncate address for display
    const shortAddress = item.address
        ? item.address.length > 40
            ? item.address.substring(0, 40) + '…'
            : item.address
        : undefined;

    return (
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            <TouchableOpacity
                style={[
                    activeCardStyles.card,
                    needsPayment && activeCardStyles.paymentCard,
                ]}
                onPress={onPress}
                activeOpacity={0.7}
            >
                {/* Left accent bar */}
                <View
                    style={[
                        activeCardStyles.accentBar,
                        { backgroundColor: needsPayment ? colors.warning : serviceIcon.color },
                    ]}
                />

                {/* Card content */}
                <View style={activeCardStyles.content}>
                    {/* Row 1: Icon + Service name + Status chip */}
                    <View style={activeCardStyles.topRow}>
                        <View
                            style={[
                                activeCardStyles.iconContainer,
                                { backgroundColor: serviceIcon.color + '15' },
                            ]}
                        >
                            <ServiceIcon size={20} color={serviceIcon.color} strokeWidth={2} />
                        </View>
                        <View style={activeCardStyles.titleBlock}>
                            <Text style={activeCardStyles.serviceType} numberOfLines={1}>
                                {item.serviceType.replace(/_/g, ' ')}
                            </Text>
                            {item.servicemanName ? (
                                <Text style={activeCardStyles.techName} numberOfLines={1}>
                                    {item.servicemanName}
                                    {item.rating ? ` · ★${item.rating}` : ''}
                                </Text>
                            ) : (
                                <Text style={activeCardStyles.techNamePending}>
                                    Not assigned yet
                                </Text>
                            )}
                        </View>
                        <StatusChip status={item.status} />
                    </View>

                    {/* Row 2: Description */}
                    <Text style={activeCardStyles.description} numberOfLines={1}>
                        {item.description}
                    </Text>

                    {/* Row 3: Date + Address + Amount */}
                    <View style={activeCardStyles.metaRow}>
                        <View style={activeCardStyles.metaItem}>
                            <Calendar size={13} color={colors.textSecondary} strokeWidth={2} />
                            <Text style={activeCardStyles.metaText}>
                                {dateStr}, {timeStr}
                            </Text>
                        </View>
                        <View style={activeCardStyles.metaDivider} />
                        <Text style={activeCardStyles.amountText}>
                            {item.totalAmount
                                ? `₹${item.totalAmount}`
                                : `₹${item.bookingFee ?? defaultBookingFee} paid`}
                        </Text>
                        <ChevronRight size={14} color={colors.textDisabled} />
                    </View>

                    {/* Row 3b: Address */}
                    {shortAddress && (
                        <View style={activeCardStyles.addressRow}>
                            <MapPin size={12} color={colors.textDisabled} strokeWidth={2} />
                            <Text style={activeCardStyles.addressText} numberOfLines={1}>
                                {shortAddress}
                            </Text>
                        </View>
                    )}

                    {/* Payment CTA banner */}
                    {needsPayment && (
                        <View style={activeCardStyles.paymentBanner}>
                            <CreditCard size={15} color={colors.textInverse} strokeWidth={2} />
                            <Text style={activeCardStyles.paymentBannerText}>
                                Complete Payment{item.totalAmount ? ` — ₹${item.totalAmount}` : ''}
                            </Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
}

const activeCardStyles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        marginBottom: 12,
        flexDirection: 'row',
        overflow: 'hidden',
        ...shadows.sm,
    },
    paymentCard: {
        borderWidth: 1,
        borderColor: colors.warning,
    },
    accentBar: {
        width: 3.5,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    titleBlock: {
        flex: 1,
    },
    serviceType: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
        textTransform: 'capitalize',
    },
    techName: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
        marginTop: 1,
    },
    techNamePending: {
        fontSize: 12,
        fontWeight: '400',
        color: colors.textDisabled,
        fontStyle: 'italic',
        marginTop: 1,
    },
    description: {
        fontSize: 13,
        fontWeight: '400',
        color: colors.textSecondary,
        marginTop: 10,
        lineHeight: 18,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        gap: 8,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    metaText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    metaDivider: {
        width: 1,
        height: 12,
        backgroundColor: colors.border,
    },
    amountText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.primary,
        flex: 1,
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 6,
    },
    addressText: {
        fontSize: 12,
        fontWeight: '400',
        color: colors.textDisabled,
        flex: 1,
    },
    paymentBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: colors.primary,
        paddingVertical: 10,
        borderRadius: 10,
        marginTop: 14,
    },
    paymentBannerText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textInverse,
    },
});

// ==================== PAST BOOKING CARD (COMPACT) ====================

function PastBookingCard({
    item,
    onPress,
    index,
}: {
    item: ServiceRequest;
    onPress: () => void;
    index: number;
}) {
    const serviceIcon = getServiceIcon(item.serviceType);
    const ServiceIcon = serviceIcon.icon;
    const isCancelled = item.status === 'cancelled';
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            delay: Math.min(index, 8) * 40,
            useNativeDriver: true,
        }).start();
    }, []);

    const dateStr = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });

    // Inline star rating
    const renderStars = (rating: number) => {
        return (
            <View style={pastCardStyles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                        key={s}
                        size={10}
                        color={s <= rating ? '#F59E0B' : '#E2E8F0'}
                        fill={s <= rating ? '#F59E0B' : 'transparent'}
                        strokeWidth={2}
                    />
                ))}
            </View>
        );
    };

    return (
        <Animated.View style={{ opacity: fadeAnim }}>
            <TouchableOpacity
                style={pastCardStyles.card}
                onPress={onPress}
                activeOpacity={0.7}
            >
                {/* Icon */}
                <View
                    style={[
                        pastCardStyles.iconContainer,
                        { backgroundColor: isCancelled ? colors.errorLight : '#F8FAFC' },
                    ]}
                >
                    <ServiceIcon
                        size={18}
                        color={isCancelled ? colors.errorDark : serviceIcon.color + '99'}
                        strokeWidth={2}
                    />
                </View>

                {/* Content */}
                <View style={pastCardStyles.content}>
                    {/* Row 1: Service type + date */}
                    <View style={pastCardStyles.headerRow}>
                        <Text style={pastCardStyles.serviceType} numberOfLines={1}>
                            {item.serviceType.replace(/_/g, ' ')}
                        </Text>
                        <Text style={pastCardStyles.dateText}>{dateStr}</Text>
                    </View>

                    {/* Row 2: Technician */}
                    {item.servicemanName && (
                        <Text style={pastCardStyles.techName}>{item.servicemanName}</Text>
                    )}

                    {/* Row 3: Status + Amount + Rating */}
                    <View style={pastCardStyles.footerRow}>
                        <View style={pastCardStyles.statusInline}>
                            {isCancelled ? (
                                <XCircle size={12} color={colors.errorDark} strokeWidth={2.5} />
                            ) : (
                                <CheckCircle
                                    size={12}
                                    color={colors.successDark}
                                    strokeWidth={2.5}
                                />
                            )}
                            <Text
                                style={[
                                    pastCardStyles.statusText,
                                    { color: isCancelled ? colors.errorDark : colors.successDark },
                                ]}
                            >
                                {isCancelled ? 'Cancelled' : 'Completed'}
                            </Text>
                        </View>

                        {item.totalAmount ? (
                            <Text style={pastCardStyles.amountText}>₹{item.totalAmount}</Text>
                        ) : null}

                        {item.rating ? renderStars(item.rating) : null}

                        <ChevronRight size={14} color={colors.textDisabled} />
                    </View>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
}

const pastCardStyles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...shadows.xs,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    serviceType: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
        textTransform: 'capitalize',
        flex: 1,
        marginRight: 8,
    },
    dateText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#94A3B8',
    },
    techName: {
        fontSize: 12,
        fontWeight: '400',
        color: '#94A3B8',
        marginTop: 2,
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 6,
    },
    statusInline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    amountText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.primary,
        flex: 1,
    },
    starsRow: {
        flexDirection: 'row',
        gap: 1,
    },
});

// ==================== SHIMMER SKELETON ====================

function SkeletonCard({ variant = 'active' }: { variant?: 'active' | 'past' }) {
    const pulseAnim = useRef(new Animated.Value(0.3)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 0.7,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0.3,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ]),
        ).start();
    }, []);

    if (variant === 'past') {
        return (
            <Animated.View
                style={[pastCardStyles.card, { opacity: pulseAnim, marginBottom: 8 }]}
            >
                <View
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: colors.border,
                    }}
                />
                <View style={{ flex: 1, gap: 6 }}>
                    <View
                        style={{
                            height: 14,
                            width: '65%',
                            backgroundColor: colors.border,
                            borderRadius: 4,
                        }}
                    />
                    <View
                        style={{
                            height: 12,
                            width: '40%',
                            backgroundColor: colors.border,
                            borderRadius: 4,
                        }}
                    />
                </View>
            </Animated.View>
        );
    }

    return (
        <Animated.View
            style={[
                activeCardStyles.card,
                { opacity: pulseAnim, overflow: 'hidden', marginBottom: 12 },
            ]}
        >
            <View style={{ width: 3.5, backgroundColor: colors.border }} />
            <View style={{ flex: 1, padding: 16, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            backgroundColor: colors.border,
                        }}
                    />
                    <View style={{ flex: 1, gap: 6 }}>
                        <View
                            style={{
                                height: 14,
                                width: '55%',
                                backgroundColor: colors.border,
                                borderRadius: 4,
                            }}
                        />
                        <View
                            style={{
                                height: 12,
                                width: '35%',
                                backgroundColor: colors.border,
                                borderRadius: 4,
                            }}
                        />
                    </View>
                    <View
                        style={{
                            width: 64,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: colors.border,
                        }}
                    />
                </View>
                <View
                    style={{
                        height: 12,
                        width: '80%',
                        backgroundColor: colors.border,
                        borderRadius: 4,
                    }}
                />
                <View
                    style={{
                        height: 12,
                        width: '50%',
                        backgroundColor: colors.border,
                        borderRadius: 4,
                    }}
                />
            </View>
        </Animated.View>
    );
}

// ==================== EMPTY STATE ====================

function EmptyState({
    title,
    subtitle,
    ctaLabel,
    onCta,
    icon: Icon,
}: {
    title: string;
    subtitle: string;
    ctaLabel?: string;
    onCta?: () => void;
    icon: any;
}) {
    return (
        <View style={emptyStyles.container}>
            <View style={emptyStyles.iconWrap}>
                <Icon size={40} color={colors.textDisabled} strokeWidth={1.5} />
            </View>
            <Text style={emptyStyles.title}>{title}</Text>
            <Text style={emptyStyles.subtitle}>{subtitle}</Text>
            {ctaLabel && onCta && (
                <TouchableOpacity style={emptyStyles.ctaButton} onPress={onCta} activeOpacity={0.7}>
                    <Text style={emptyStyles.ctaText}>{ctaLabel}</Text>
                    <ArrowRight size={16} color={colors.textInverse} strokeWidth={2.5} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const emptyStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingTop: spacing['4xl'],
        paddingHorizontal: spacing['2xl'],
    },
    iconWrap: {
        width: 80,
        height: 80,
        borderRadius: radii['2xl'],
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        lineHeight: 26,
    },
    subtitle: {
        fontSize: 14,
        fontWeight: '400',
        color: colors.textSecondary,
        marginTop: spacing.sm,
        textAlign: 'center',
        lineHeight: 20,
    },
    ctaButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.primary,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: radii.md,
        marginTop: spacing.xl,
        ...shadows.glow,
    },
    ctaText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textInverse,
    },
});

// ==================== SECTION HEADER ====================

function SectionHeader({ title }: { title: string }) {
    return <Text style={sectionStyles.header}>{title}</Text>;
}

const sectionStyles = StyleSheet.create({
    header: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
        marginTop: 20,
        marginBottom: 10,
    },
});

// ==================== MAIN SCREEN ====================

export function MyRequestsScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const { data: requests, isLoading, refetch, isRefetching } = useServiceRequests();
    const {
        data: historyPages,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: historyLoading,
        refetch: refetchHistory,
        isRefetching: isHistoryRefetching,
    } = useServiceHistory();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const [activeTab, setActiveTab] = useState(0);

    const handlePress = useCallback(
        (item: ServiceRequest) => {
            navigation.navigate('RequestDetail', { request: item });
        },
        [navigation],
    );

    // Active bookings from the regular query
    const activeRequests = useMemo(
        () =>
            (requests || []).filter(
                (r: ServiceRequest) =>
                    !['completed', 'cancelled', 'disputed'].includes(r.status),
            ),
        [requests],
    );

    // Past bookings from infinite query (flattened pages)
    const pastRequests = useMemo(
        () => historyPages?.pages?.flatMap((page: any) => page.data || []) || [],
        [historyPages],
    );
    const totalPast =
        historyPages?.pages?.[0]?.pagination?.total || pastRequests.length;

    // Grouped data for each tab
    const activeGroupedData = useMemo(
        () => groupItems(activeRequests, (d) => getDateGroup(d)),
        [activeRequests],
    );

    const pastGroupedData = useMemo(
        () => groupItems(pastRequests, (d) => getMonthGroup(d)),
        [pastRequests],
    );

    const handleRefreshActive = useCallback(() => {
        refetch();
    }, [refetch]);

    const handleRefreshHistory = useCallback(() => {
        refetchHistory();
    }, [refetchHistory]);

    const handleEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const handleTabPress = useCallback((index: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setActiveTab(index);
    }, []);

    // ==================== RENDER ====================

    const renderActiveItem = useCallback(
        ({ item, index }: { item: any; index: number }) => {
            if (item.type === 'header') {
                return <SectionHeader title={item.title} />;
            }
            return (
                <ActiveBookingCard
                    item={item.data}
                    onPress={() => handlePress(item.data)}
                    index={index}
                />
            );
        },
        [handlePress],
    );

    const renderPastItem = useCallback(
        ({ item, index }: { item: any; index: number }) => {
            if (item.type === 'header') {
                return <SectionHeader title={item.title} />;
            }
            return (
                <PastBookingCard
                    item={item.data}
                    onPress={() => handlePress(item.data)}
                    index={index}
                />
            );
        },
        [handlePress],
    );

    const keyExtractor = useCallback(
        (item: any, index: number) =>
            item.type === 'header' ? `hdr-${index}` : `item-${item.data.id}`,
        [],
    );

    // Loading state
    if (isLoading && historyLoading) {
        return (
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: headerTop }]}>
                    <Text style={styles.headerTitle}>My Bookings</Text>
                </View>
                <View style={styles.segmentPlaceholder} />
                <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.sm }}>
                    {[1, 2, 3].map((i) => (
                        <SkeletonCard key={i} variant="active" />
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.headerTitle}>My Bookings</Text>
                <Text style={styles.headerSub}>
                    {activeRequests.length} active · {totalPast} past
                </Text>
            </View>

            {/* Segmented Control */}
            <SegmentedControl
                tabs={[
                    { label: 'Active', count: activeRequests.length },
                    { label: 'History', count: undefined },
                ]}
                activeIndex={activeTab}
                onTabPress={handleTabPress}
            />

            {/* Tab Content */}
            {activeTab === 0 ? (
                /* ==================== ACTIVE TAB ==================== */
                <FlatList
                    data={activeGroupedData}
                    renderItem={renderActiveItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={[styles.listContent, { paddingBottom: tabContent }]}
                    showsVerticalScrollIndicator={false}
                    initialNumToRender={8}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefetching}
                            onRefresh={handleRefreshActive}
                            colors={[colors.primary]}
                            tintColor={colors.primary}
                        />
                    }
                    ListEmptyComponent={
                        <EmptyState
                            icon={ClipboardList}
                            title="No active bookings"
                            subtitle="Book a service from the Home screen and track it here"
                            ctaLabel="Book a Service"
                            onCta={() =>
                                navigation.navigate('CustomerTabs', {
                                    screen: 'HomeTab',
                                })
                            }
                        />
                    }
                />
            ) : (
                /* ==================== HISTORY TAB ==================== */
                <FlatList
                    data={pastGroupedData}
                    renderItem={renderPastItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={[styles.listContent, { paddingBottom: tabContent }]}
                    showsVerticalScrollIndicator={false}
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.3}
                    initialNumToRender={12}
                    maxToRenderPerBatch={10}
                    windowSize={7}
                    refreshControl={
                        <RefreshControl
                            refreshing={isHistoryRefetching}
                            onRefresh={handleRefreshHistory}
                            colors={[colors.primary]}
                            tintColor={colors.primary}
                        />
                    }
                    ListFooterComponent={
                        isFetchingNextPage ? (
                            <View
                                style={{
                                    paddingVertical: spacing.lg,
                                    alignItems: 'center',
                                }}
                            >
                                <ActivityIndicator size="small" color={colors.primary} />
                                <Text
                                    style={{
                                        fontSize: 12,
                                        color: colors.textDisabled,
                                        marginTop: 6,
                                    }}
                                >
                                    Loading more…
                                </Text>
                            </View>
                        ) : null
                    }
                    ListEmptyComponent={
                        historyLoading ? (
                            <View style={{ paddingTop: spacing.sm }}>
                                {[1, 2, 3, 4].map((i) => (
                                    <SkeletonCard key={i} variant="past" />
                                ))}
                            </View>
                        ) : (
                            <EmptyState
                                icon={History}
                                title="No past bookings yet"
                                subtitle="Your completed and cancelled bookings will appear here"
                            />
                        )
                    }
                />
            )}
        </View>
    );
}

// ==================== SCREEN STYLES ====================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    header: {
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    headerTitle: {
        ...typography.h2,
        color: colors.textPrimary,
    },
    headerSub: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    segmentPlaceholder: {
        height: 42,
        marginHorizontal: spacing.xl,
        marginTop: spacing.base,
        marginBottom: spacing.base,
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
    },
    listContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xs,
    },
});
