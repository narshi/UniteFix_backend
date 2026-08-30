/**
 * Broadband — pick an operator, or see your existing connection.
 *
 * Features:
 * - Instant Customer ID / Phone lookup with auto-claiming
 * - "Customer ID Not Found" pop-up modal redirecting to "Book New Connection"
 * - Active connections list with live validity indicators
 * - Multi-operator catalog list
 */

import React, { useCallback, useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
    RefreshControl, TextInput, Modal, Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import {
    Router, Wifi, ChevronRight, Clock, AlertCircle, Search, Sparkles, X, PlusCircle,
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
            <ScreenHeader title="Broadband Recharge" onBack={() => navigation.goBack()} />

            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomBar + spacing.xl }]}
                keyboardShouldPersistTaps="handled"
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
                    <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
                ) : (
                    <>
                        {/* Instant Recharge by Customer ID Card */}
                        {operators.length > 0 && (
                            <View style={styles.quickRechargeCard}>
                                <View style={styles.quickHeader}>
                                    <View style={styles.sparkleCircle}>
                                        <Sparkles size={16} color={colors.primary} />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
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
                                        {operators.map(op => (
                                            <TouchableOpacity
                                                key={op.id}
                                                style={[
                                                    styles.operatorChip,
                                                    selectedOperatorId === op.id && styles.operatorChipActive,
                                                ]}
                                                onPress={() => setSelectedOperatorId(op.id)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.operatorChipText,
                                                        selectedOperatorId === op.id && styles.operatorChipTextActive,
                                                    ]}
                                                >
                                                    {op.companyName}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                )}

                                {/* ID / Phone Input */}
                                <View style={styles.inputContainer}>
                                    <Search size={18} color={colors.textSecondary} style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.textInput}
                                        placeholder="e.g. amit95_ylp or 10-digit mobile"
                                        placeholderTextColor={colors.textSecondary}
                                        value={searchQuery}
                                        onChangeText={setSearchQuery}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        returnKeyType="search"
                                        onSubmitEditing={handleLookup}
                                    />
                                    {searchQuery.length > 0 && (
                                        <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
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
                            <>
                                <Text style={styles.sectionTitle}>Your connections</Text>
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
                                                    <Wifi size={18} color={colors.primary} />
                                                </View>
                                                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                                                    <Text style={styles.cardTitle}>{c.operatorName}</Text>
                                                    <Text style={styles.cardSubtitle}>
                                                        {c.ispConnectionId ?? 'Waiting for your operator'}
                                                    </Text>
                                                </View>
                                            </View>
                                            {c.ispConnectionId ? <ChevronRight size={20} color={colors.textSecondary} /> : null}
                                        </View>

                                        {c.ispConnectionId ? (
                                            <View style={styles.validityRow}>
                                                {c.validTill ? (
                                                    <Text
                                                        style={[
                                                            styles.validityText,
                                                            c.isExpired && { color: colors.error },
                                                            !c.isExpired && (c.daysRemaining ?? 99) <= 5 && { color: colors.warningDark },
                                                        ]}
                                                    >
                                                        {c.isExpired
                                                            ? 'Expired — recharge to get back online'
                                                            : `${c.daysRemaining} day${c.daysRemaining === 1 ? '' : 's'} left${c.planName ? ` · ${c.planName}` : ''}`}
                                                    </Text>
                                                ) : (
                                                    <Text style={styles.validityText}>Tap to see plans & recharge</Text>
                                                )}
                                            </View>
                                        ) : (
                                            <View style={styles.pendingPill}>
                                                <Clock size={13} color={colors.warningDark} />
                                                <Text style={styles.pendingPillText}>
                                                    Your operator is setting up your account
                                                </Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </>
                        )}

                        {/* Pending ID Requests */}
                        {pendingIdRequests.length > 0 && (
                            <>
                                <Text style={styles.sectionTitle}>Waiting for approval</Text>
                                {pendingIdRequests.map(r => (
                                    <View key={r.id} style={styles.pendingCard}>
                                        <Clock size={16} color={colors.warningDark} />
                                        <Text style={styles.pendingText}>
                                            {r.operatorName} is verifying your details. We'll notify you when it's linked.
                                        </Text>
                                    </View>
                                ))}
                            </>
                        )}

                        {/* Pending Leads */}
                        {pendingLeads.length > 0 && (
                            <>
                                <Text style={styles.sectionTitle}>New connection requests</Text>
                                {pendingLeads.map(l => (
                                    <View key={l.id} style={styles.pendingCard}>
                                        <Clock size={16} color={colors.warningDark} />
                                        <Text style={styles.pendingText}>
                                            {l.operatorName} will call you about your new optical fiber connection.
                                        </Text>
                                    </View>
                                ))}
                            </>
                        )}

                        {/* Available Providers */}
                        <Text style={styles.sectionTitle}>
                            {connections.length > 0 ? 'Other providers near you' : 'Providers in your area'}
                        </Text>

                        {noPincode ? (
                            <View style={styles.emptyCard}>
                                <AlertCircle size={22} color={colors.textSecondary} />
                                <Text style={styles.emptyTitle}>Add your pincode</Text>
                                <Text style={styles.emptyBody}>
                                    We use it to show the broadband providers who actually wire your area.
                                </Text>
                            </View>
                        ) : operators.length === 0 ? (
                            <View style={styles.emptyCard}>
                                <Router size={22} color={colors.textSecondary} />
                                <Text style={styles.emptyTitle}>Not available here yet</Text>
                                <Text style={styles.emptyBody}>
                                    No broadband partners cover your pincode right now. We're adding more.
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
                                        >
                                            <View
                                                style={[
                                                    styles.iconCircle,
                                                    o.brandColor ? { backgroundColor: `${o.brandColor}22` } : null,
                                                ]}
                                            >
                                                <Router size={18} color={o.brandColor || colors.primary} />
                                            </View>
                                            <View style={{ flex: 1, marginLeft: spacing.md }}>
                                                <Text style={styles.cardTitle}>{o.companyName}</Text>
                                                <Text style={styles.cardSubtitle}>
                                                    {pending ? 'Request in progress' : 'Tap to book new connection or link ID'}
                                                </Text>
                                            </View>
                                            {!pending && <ChevronRight size={20} color={colors.textSecondary} />}
                                        </TouchableOpacity>
                                    );
                                })
                        )}

                        <TouchableOpacity
                            style={styles.historyLink}
                            onPress={() => navigation.navigate('FTTHHistory')}
                        >
                            <Text style={styles.historyLinkText}>View recharge history</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>

            {/* NOT FOUND MODAL */}
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
                            We couldn't find an active account for <Text style={styles.boldText}>"{notFoundQuery}"</Text> under <Text style={styles.boldText}>{notFoundOperator?.companyName ?? 'this operator'}</Text>.
                        </Text>

                        <Text style={styles.modalSubBody}>
                            If you do not have an existing broadband connection, you can book a new optical fiber line with free installation.
                        </Text>

                        <View style={styles.modalButtonsColumn}>
                            <Button
                                title="Book a New Connection"
                                onPress={handleBookNewConnection}
                                icon={<PlusCircle size={16} color="#FFFFFF" />}
                                variant="primary"
                            />
                            <TouchableOpacity
                                style={styles.modalSecondaryBtn}
                                onPress={() => setShowNotFoundModal(false)}
                            >
                                <Text style={styles.modalSecondaryBtnText}>Try Another ID</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.base },

    // Quick Recharge Card
    quickRechargeCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.xl,
        padding: spacing.base,
        marginBottom: spacing.base,
        borderWidth: 1,
        borderColor: colors.primarySurface,
        ...shadows.sm,
    },
    quickHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    sparkleCircle: {
        width: 32,
        height: 32,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    quickTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    quickSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    operatorChipsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
    operatorChip: {
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    operatorChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    operatorChipText: { ...typography.caption, color: colors.textSecondary },
    operatorChipTextActive: { color: colors.primary, fontWeight: '700' },

    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        height: 48,
    },
    inputIcon: { marginRight: spacing.sm },
    textInput: {
        flex: 1,
        ...typography.bodyMedium,
        color: colors.textPrimary,
        height: '100%',
    },
    clearBtn: { padding: spacing.xs },

    sectionTitle: {
        ...typography.label,
        color: colors.textSecondary,
        marginTop: spacing.lg,
        marginBottom: spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    connectionCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.base,
        marginBottom: spacing.md,
        ...shadows.xs,
    },
    operatorCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.base,
        marginBottom: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        ...shadows.xs,
    },
    operatorCardMuted: { opacity: 0.6 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowCenter: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    iconCircle: {
        width: 40, height: 40, borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center', justifyContent: 'center',
    },
    cardTitle: { ...typography.h4, color: colors.textPrimary },
    cardSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    validityRow: {
        marginTop: spacing.md, paddingTop: spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
    },
    validityText: { ...typography.caption, color: colors.textSecondary },
    pendingPill: {
        marginTop: spacing.md, flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.warningLight, borderRadius: radii.md,
        paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm,
    },
    pendingPillText: { ...typography.caption, color: colors.warningDark, flex: 1 },
    pendingCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.warningLight, borderRadius: radii.lg,
        padding: spacing.base, marginBottom: spacing.md,
    },
    pendingText: { ...typography.caption, color: colors.warningDark, flex: 1 },
    emptyCard: {
        backgroundColor: colors.surfaceElevated, borderRadius: radii.lg,
        padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.xs,
    },
    emptyTitle: { ...typography.h4, color: colors.textPrimary },
    emptyBody: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    historyLink: { marginTop: spacing.xl, alignItems: 'center', paddingVertical: spacing.md },
    historyLinkText: { ...typography.bodyMedium, color: colors.primary, fontWeight: '600' },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    modalCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.xl,
        padding: spacing.xl,
        width: '100%',
        maxWidth: 380,
        alignItems: 'center',
        ...shadows.lg,
    },
    modalIconCircle: {
        width: 56,
        height: 56,
        borderRadius: radii.full,
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
