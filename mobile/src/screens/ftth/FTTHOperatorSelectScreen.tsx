/**
 * Broadband — pick an operator, quick recharge by ID, or manage active lines.
 *
 * Features:
 * - Instant Customer ID / Phone lookup with auto-claiming
 * - Visual status badges (Active / Expired) on connected broadband lines
 * - 1-tap direct "Recharge Now" button on connected lines
 * - Responsive operator selection chips & clean form styling
 * - Centered "Customer ID Not Found" modal redirecting to Book Connection
 */

import React, { useCallback, useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
    RefreshControl, TextInput, Modal, Alert, StatusBar, Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import {
    Router, Wifi, ChevronRight, Clock, AlertCircle, Search, Sparkles, X, PlusCircle, ArrowRight, Zap,
} from 'lucide-react-native';
import { ftthApi, FtthConnection, FtthOperator } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader, Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHOperatorSelect'>;

export function FTTHOperatorSelectScreen({ navigation }: Props) {
    const { bottomBar } = useScreenInsets();
    const queryClient = useQueryClient();

    const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Modal state for Not Found
    const [showNotFoundModal, setShowNotFoundModal] = useState(false);
    const [notFoundQuery, setNotFoundQuery] = useState('');
    const [notFoundOperator, setNotFoundOperator] = useState<FtthOperator | null>(null);

    const operatorsQuery = useQuery({
        queryKey: ['ftth', 'operators'],
        queryFn: () => ftthApi.getOperators(),
    });

    const connectionsQuery = useQuery({
        queryKey: ['ftth', 'connections'],
        queryFn: () => ftthApi.getConnections(),
    });

    useFocusEffect(
        useCallback(() => {
            queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
        }, [queryClient]),
    );

    const operators = operatorsQuery.data?.data ?? [];
    const noPincode = operatorsQuery.data?.meta?.reason === 'NO_PINCODE';
    const connections = connectionsQuery.data?.connections ?? [];
    const pendingIdRequests = connectionsQuery.data?.pendingIdRequests ?? [];
    const pendingLeads = connectionsQuery.data?.pendingLeads ?? [];

    const loading = operatorsQuery.isLoading || connectionsQuery.isLoading;
    const refreshing = operatorsQuery.isFetching || connectionsQuery.isFetching;

    const connectedOperatorIds = new Set(connections.map(c => c.operatorId));
    const pendingOperatorIds = new Set([
        ...pendingIdRequests.map(r => r.operatorId),
        ...pendingLeads.map(l => l.operatorId),
    ]);

    // Auto-select first operator for quick recharge if available
    useEffect(() => {
        if (operators.length > 0 && selectedOperatorId === null) {
            setSelectedOperatorId(operators[0].id);
        }
    }, [operators, selectedOperatorId]);

    const openConnection = (connection: FtthConnection) => {
        if (!connection.ispConnectionId) return;
        navigation.navigate('FTTHRecharge', { connection });
    };

    const handleLookup = async () => {
        if (!selectedOperatorId || !searchQuery.trim()) {
            Alert.alert('Missing Details', 'Please enter your Customer ID or registered Phone Number.');
            return;
        }
        setIsSearching(true);
        try {
            const res = await ftthApi.lookupCustomer(selectedOperatorId, searchQuery.trim());
            if (res.exists && res.data) {
                const conn = res.data;
                setSearchQuery('');
                queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
                navigation.navigate('FTTHRecharge', { connection: conn });
            } else {
                const op = operators.find(o => o.id === selectedOperatorId) || null;
                setNotFoundOperator(op);
                setNotFoundQuery(searchQuery.trim());
                setShowNotFoundModal(true);
            }
        } catch (err: any) {
            Alert.alert(
                'Lookup Failed',
                err?.response?.data?.message || 'Unable to verify Customer ID. Please check your network connection.',
            );
        } finally {
            setIsSearching(false);
        }
    };

    const handleBookNewConnection = () => {
        setShowNotFoundModal(false);
        if (notFoundOperator) {
            navigation.navigate('FTTHOnboarding', { operator: notFoundOperator });
        }
    };

    return (
        <View style={styles.screen}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
            <ScreenHeader title="Broadband Recharge" onBack={() => navigation.goBack()} />

            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomBar + spacing['2xl'] }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing && !loading}
                        onRefresh={() => {
                            operatorsQuery.refetch();
                            connectionsQuery.refetch();
                        }}
                    />
                }
            >
                {loading ? (
                    <View style={styles.loadingWrap}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>Loading broadband connections…</Text>
                    </View>
                ) : (
                    <>
                        {/* Instant Recharge by Customer ID Card */}
                        {operators.length > 0 && (
                            <View style={styles.quickRechargeCard}>
                                <View style={styles.quickHeader}>
                                    <View style={styles.sparkleCircle}>
                                        <Sparkles size={18} color={colors.primary} />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                                        <Text style={styles.quickTitle}>Quick Recharge by Customer ID</Text>
                                        <Text style={styles.quickSubtitle}>
                                            Enter your ISP username or phone to recharge immediately
                                        </Text>
                                    </View>
                                </View>

                                {/* Operator Selector Chips if > 1 */}
                                {operators.length > 1 && (
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.operatorChipsRow}
                                    >
                                        {operators.map(op => {
                                            const isActive = selectedOperatorId === op.id;
                                            return (
                                                <TouchableOpacity
                                                    key={op.id}
                                                    style={[styles.operatorChip, isActive && styles.operatorChipActive]}
                                                    onPress={() => setSelectedOperatorId(op.id)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.operatorChipText,
                                                            isActive && styles.operatorChipTextActive,
                                                        ]}
                                                    >
                                                        {op.companyName}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                )}

                                {/* ID / Phone Input */}
                                <View style={styles.inputContainer}>
                                    <Search size={18} color={colors.textSecondary} style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.textInput}
                                        placeholder="e.g. POORVI-9912 or 10-digit mobile"
                                        placeholderTextColor={colors.textSecondary}
                                        value={searchQuery}
                                        onChangeText={setSearchQuery}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        returnKeyType="search"
                                        onSubmitEditing={handleLookup}
                                    />
                                    {searchQuery.length > 0 && (
                                        <TouchableOpacity
                                            onPress={() => setSearchQuery('')}
                                            style={styles.clearBtn}
                                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                        >
                                            <X size={16} color={colors.textSecondary} />
                                        </TouchableOpacity>
                                    )}
                                </View>

                                <Button
                                    title={isSearching ? 'Verifying Account…' : 'Proceed to Recharge'}
                                    onPress={handleLookup}
                                    disabled={isSearching || !searchQuery.trim()}
                                    style={{ marginTop: spacing.md }}
                                />
                            </View>
                        )}

                        {/* Connected Accounts */}
                        {connections.length > 0 && (
                            <View style={styles.sectionContainer}>
                                <Text style={styles.sectionTitle}>Your Active Connections</Text>
                                {connections.map(c => (
                                    <TouchableOpacity
                                        key={c.id}
                                        style={styles.connectionCard}
                                        activeOpacity={c.ispConnectionId ? 0.7 : 1}
                                        onPress={() => openConnection(c)}
                                    >
                                        <View style={styles.rowBetween}>
                                            <View style={styles.rowCenter}>
                                                <View style={styles.iconCircle}>
                                                    <Wifi size={20} color={colors.primary} />
                                                </View>
                                                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                                                    <View style={styles.titleWithSpeed}>
                                                        <Text style={styles.cardTitle}>{c.operatorName}</Text>
                                                        {c.speedMbps && (
                                                            <View style={styles.speedPill}>
                                                                <Zap size={10} color={colors.primary} />
                                                                <Text style={styles.speedPillText}>{c.speedMbps}M</Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                    <Text style={styles.cardSubtitle}>
                                                        {c.ispConnectionId ?? 'Setting up connection…'}
                                                    </Text>
                                                </View>
                                            </View>

                                            {c.validTill && (
                                                <View style={[styles.statusBadge, c.isExpired ? styles.statusBadgeExpired : styles.statusBadgeActive]}>
                                                    <Text style={[styles.statusBadgeText, c.isExpired ? styles.statusBadgeTextExpired : styles.statusBadgeTextActive]}>
                                                        {c.isExpired ? 'Expired' : `${c.daysRemaining}d left`}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                        {c.ispConnectionId ? (
                                            <View style={styles.connectionFooterRow}>
                                                <Text style={styles.planInfoText}>
                                                    {c.planName ? `Plan: ${c.planName}` : 'High Speed Fiber'}
                                                </Text>
                                                <View style={styles.rechargeActionRow}>
                                                    <Text style={styles.rechargeActionText}>Recharge</Text>
                                                    <ChevronRight size={16} color={colors.primary} />
                                                </View>
                                            </View>
                                        ) : (
                                            <View style={styles.pendingPill}>
                                                <Clock size={13} color={colors.warningDark} />
                                                <Text style={styles.pendingPillText}>
                                                    Your operator is activating your line
                                                </Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        {/* Pending Approvals */}
                        {pendingIdRequests.length > 0 && (
                            <View style={styles.sectionContainer}>
                                <Text style={styles.sectionTitle}>Waiting for verification</Text>
                                {pendingIdRequests.map(r => (
                                    <View key={r.id} style={styles.pendingCard}>
                                        <Clock size={18} color={colors.warningDark} />
                                        <View style={{ flex: 1, marginLeft: spacing.sm }}>
                                            <Text style={styles.pendingTitle}>{r.operatorName}</Text>
                                            <Text style={styles.pendingText}>
                                                Verifying your details. We'll notify you when linked.
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* Available Providers */}
                        <View style={styles.sectionContainer}>
                            <Text style={styles.sectionTitle}>
                                {connections.length > 0 ? 'Other providers near you' : 'Broadband providers in your area'}
                            </Text>

                            {noPincode ? (
                                <View style={styles.emptyCard}>
                                    <AlertCircle size={24} color={colors.textSecondary} />
                                    <Text style={styles.emptyTitle}>Add your pincode</Text>
                                    <Text style={styles.emptyBody}>
                                        We use it to show the broadband providers who actually wire your neighborhood.
                                    </Text>
                                </View>
                            ) : operators.length === 0 ? (
                                <View style={styles.emptyCard}>
                                    <Router size={24} color={colors.textSecondary} />
                                    <Text style={styles.emptyTitle}>Not available here yet</Text>
                                    <Text style={styles.emptyBody}>
                                        No broadband partners cover your pincode right now. We are expanding rapidly!
                                    </Text>
                                </View>
                            ) : (
                                operators
                                    .filter(o => !connectedOperatorIds.has(o.id))
                                    .map(o => {
                                        const pending = pendingOperatorIds.has(o.id);
                                        return (
                                            <TouchableOpacity
                                                key={o.id}
                                                style={[styles.operatorCard, pending && styles.operatorCardMuted]}
                                                disabled={pending}
                                                onPress={() => navigation.navigate('FTTHOnboarding', { operator: o })}
                                                activeOpacity={0.7}
                                            >
                                                <View
                                                    style={[
                                                        styles.iconCircle,
                                                        o.brandColor ? { backgroundColor: `${o.brandColor}18` } : null,
                                                    ]}
                                                >
                                                    <Router size={20} color={o.brandColor || colors.primary} />
                                                </View>
                                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                                    <Text style={styles.cardTitle}>{o.companyName}</Text>
                                                    <Text style={styles.cardSubtitle}>
                                                        {pending ? 'Connection request submitted' : 'Get fiber installation or link ID'}
                                                    </Text>
                                                </View>
                                                <View style={styles.bookPill}>
                                                    <Text style={styles.bookPillText}>{pending ? 'Pending' : 'Book'}</Text>
                                                    <ChevronRight size={14} color={colors.primary} />
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })
                            )}
                        </View>

                        {/* History Link */}
                        <TouchableOpacity
                            style={styles.historyLink}
                            onPress={() => navigation.navigate('FTTHHistory')}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.historyLinkText}>View Past Recharge Receipts →</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>

            {/* Customer ID Not Found Modal */}
            <Modal
                visible={showNotFoundModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowNotFoundModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalIconCircle}>
                            <AlertCircle size={28} color="#D97706" />
                        </View>
                        <Text style={styles.modalTitle}>Customer ID Not Found</Text>
                        <Text style={styles.modalBody}>
                            We could not find an active account for <Text style={styles.boldText}>"{notFoundQuery}"</Text> under {notFoundOperator?.companyName || 'this operator'}.
                        </Text>
                        <Text style={styles.modalSubBody}>
                            Looking to get a new optical fiber broadband installed at your home or office?
                        </Text>

                        <View style={styles.modalButtonsColumn}>
                            <Button
                                title="Book New Connection"
                                onPress={handleBookNewConnection}
                                fullWidth
                            />
                            <TouchableOpacity
                                style={styles.modalSecondaryBtn}
                                onPress={() => setShowNotFoundModal(false)}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.modalSecondaryBtnText}>Try Another Customer ID</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    loadingWrap: { marginTop: spacing['3xl'], alignItems: 'center', gap: spacing.sm },
    loadingText: { ...typography.caption, color: colors.textSecondary },

    // ── Quick Recharge Card ──
    quickRechargeCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.lg,
        ...shadows.sm,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.lg,
    },
    quickHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    sparkleCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    quickTitle: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 15,
    },
    quickSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 11,
        marginTop: 2,
    },
    operatorChipsRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        paddingBottom: spacing.sm,
    },
    operatorChip: {
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    operatorChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    operatorChipText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 12,
    },
    operatorChipTextActive: {
        color: colors.primary,
        fontWeight: '700',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        height: 50,
    },
    inputIcon: { marginRight: spacing.sm },
    textInput: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
        height: '100%',
    },
    clearBtn: { padding: spacing.xs },

    // ── Sections & Cards ──
    sectionContainer: {
        marginBottom: spacing.lg,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.textSecondary,
        marginBottom: spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    connectionCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.xs,
        borderWidth: 1,
        borderColor: colors.border,
    },
    rowBetween: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rowCenter: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconCircle: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleWithSpeed: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    cardTitle: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 15,
    },
    speedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primarySurface,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radii.full,
        gap: 2,
    },
    speedPillText: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.primary,
    },
    cardSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    statusBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radii.full,
    },
    statusBadgeActive: {
        backgroundColor: '#DCFCE7',
    },
    statusBadgeExpired: {
        backgroundColor: '#FEE2E2',
    },
    statusBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    statusBadgeTextActive: {
        color: '#15803D',
    },
    statusBadgeTextExpired: {
        color: colors.error,
    },
    connectionFooterRow: {
        marginTop: spacing.md,
        paddingTop: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    planInfoText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 12,
    },
    rechargeActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    rechargeActionText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '700',
        fontSize: 13,
    },
    pendingPill: {
        marginTop: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.warningLight,
        borderRadius: radii.md,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
        gap: spacing.xs,
    },
    pendingPillText: {
        ...typography.caption,
        color: colors.warningDark,
        fontSize: 11,
    },

    // ── Operator Card ──
    operatorCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.md,
        marginBottom: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        ...shadows.xs,
        borderWidth: 1,
        borderColor: colors.border,
    },
    operatorCardMuted: { opacity: 0.6 },
    bookPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        gap: 2,
    },
    bookPillText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '700',
        fontSize: 12,
    },

    // ── Pending Cards ──
    pendingCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFBEB',
        borderRadius: radii.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    pendingTitle: {
        ...typography.bodySemibold,
        color: '#92400E',
        fontSize: 13,
    },
    pendingText: {
        ...typography.caption,
        color: '#B45309',
        fontSize: 11,
        marginTop: 1,
    },

    // ── Empty State ──
    emptyCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.xl,
        alignItems: 'center',
        gap: spacing.xs,
        ...shadows.xs,
        borderWidth: 1,
        borderColor: colors.border,
    },
    emptyTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    emptyBody: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },

    historyLink: {
        alignItems: 'center',
        paddingVertical: spacing.md,
        marginTop: spacing.sm,
    },
    historyLinkText: {
        ...typography.bodyMedium,
        color: colors.primary,
        fontWeight: '700',
    },

    // ── Modal ──
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    modalCard: {
        backgroundColor: colors.surface,
        borderRadius: radii['2xl'],
        padding: spacing.xl,
        width: '100%',
        maxWidth: 380,
        alignItems: 'center',
        ...shadows.xl,
    },
    modalIconCircle: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#FEF3C7',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.md,
    },
    modalTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
    modalBody: { ...typography.bodyMedium, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
    modalSubBody: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
    boldText: { color: colors.textPrimary, fontWeight: '700' },
    modalButtonsColumn: { width: '100%', marginTop: spacing.xl, gap: spacing.sm },
    modalSecondaryBtn: {
        paddingVertical: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalSecondaryBtnText: { ...typography.bodyMedium, color: colors.textSecondary, fontWeight: '600' },
});
