/**
 * Broadband — pick an operator, or see your existing connection.
 *
 * Handles zero, one and many operators. Notably it does NOT auto-skip when
 * there is exactly one: that shortcut breaks the moment a second ISP signs up
 * in the same pincode, and it hides from the customer that a choice exists.
 */

import React, { useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { Router, Wifi, ChevronRight, Clock, AlertCircle } from 'lucide-react-native';
import { ftthApi, FtthConnection } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHOperatorSelect'>;

export function FTTHOperatorSelectScreen({ navigation }: Props) {
    const { bottomBar } = useScreenInsets();
    const queryClient = useQueryClient();

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

    const openConnection = (connection: FtthConnection) => {
        if (!connection.ispConnectionId) return;
        navigation.navigate('FTTHRecharge', { connection });
    };

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Broadband" onBack={() => navigation.goBack()} />

            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomBar + spacing.xl }]}
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
                                                    <Text style={styles.validityText}>Tap to see plans</Text>
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

                        {pendingLeads.length > 0 && (
                            <>
                                <Text style={styles.sectionTitle}>New connection requests</Text>
                                {pendingLeads.map(l => (
                                    <View key={l.id} style={styles.pendingCard}>
                                        <Clock size={16} color={colors.warningDark} />
                                        <Text style={styles.pendingText}>
                                            {l.operatorName} will call you about your new connection.
                                        </Text>
                                    </View>
                                ))}
                            </>
                        )}

                        <Text style={styles.sectionTitle}>
                            {connections.length > 0 ? 'Other providers near you' : 'Providers near you'}
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
                                                    {pending ? 'Request in progress' : 'Tap to get started'}
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
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.base },
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
});
