/**
 * Account — who this partner is to UniteFix, and the money between them.
 *
 * Two balances, never netted: what the partner owes for parts bought on
 * credit, and what UniteFix owes the partner (broadband recharges collected
 * on their behalf, credit notes). Netting them would hide a pending
 * settlement behind an unpaid invoice, which is the kind of thing that
 * ends a business relationship. The statement below shows both ledgers
 * in one list, each line signed from the partner's point of view.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Bell, FileText, LogOut, ChevronRight, Building2, Wifi, Wrench } from 'lucide-react-native';
import { b2bApi, type LedgerLine } from '../../api/b2b.api';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

const ENTRY_LABEL: Record<string, string> = {
    order_invoice: 'Parts order', payment_received: 'Payment received', credit_note: 'Credit note', refund: 'Refund', adjustment: 'Adjustment',
    settlement_paid: 'Settlement paid to you', settlement_received: 'Settlement received from you',
    recharge_collected: 'Recharge collected for you', platform_fee: 'UniteFix convenience fee', lead_fee: 'Lead fee',
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
    active: { label: 'Active', color: colors.successDark },
    pending: { label: 'Awaiting approval', color: colors.warningDark },
    suspended: { label: 'Suspended', color: colors.errorDark },
    rejected: { label: 'Not approved', color: colors.errorDark },
};

function LedgerRow({ line }: { line: LedgerLine }) {
    // Signed from UniteFix's book: positive = partner owes. Shown from the
    // partner's side, so a positive amount reads as "you owe", red.
    const owes = line.amount > 0;
    return (
        <View style={styles.ledgerRow}>
            {line.source === 'ftth' ? <Wifi size={16} color={colors.textSecondary} /> : <Wrench size={16} color={colors.textSecondary} />}
            <View style={{ flex: 1 }}>
                <Text style={styles.ledgerTitle}>{ENTRY_LABEL[line.entryType] ?? line.entryType}</Text>
                <Text style={styles.ledgerMeta} numberOfLines={2}>
                    {new Date(line.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{line.description ? ` · ${line.description}` : ''}
                </Text>
            </View>
            <Text style={[styles.ledgerAmt, { color: owes ? colors.errorDark : colors.successDark }]}>{owes ? '−' : '+'} ₹{Math.abs(line.amount)}</Text>
        </View>
    );
}

export function AccountScreen() {
    const navigation = useNavigation<any>();
    const { headerTop, tabContent } = useScreenInsets();
    const logout = useAuthStore(s => s.logout);

    const me = useQuery({ queryKey: ['b2b-me'], queryFn: async () => (await b2bApi.me()).data.data });
    const ledger = useQuery({ queryKey: ['b2b-ledger'], queryFn: async () => (await b2bApi.ledger({ limit: 50 })).data.data });

    const refetch = () => { me.refetch(); ledger.refetch(); };
    const refreshing = me.isRefetching || ledger.isRefetching;

    const confirmLogout = () => {
        Alert.alert('Log out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: () => logout() },
        ]);
    };

    const bp = me.data;
    const st = ledger.data;
    const status = bp ? (STATUS_LABEL[bp.status] ?? { label: bp.status, color: colors.textSecondary }) : null;

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.title}>Account</Text>
            </View>
            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: tabContent }]}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} colors={[colors.primary]} tintColor={colors.primary} />}
            >
                {me.isLoading ? (
                    <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
                ) : bp && (
                    <>
                        <View style={styles.card}>
                            <View style={styles.idRow}>
                                <View style={styles.avatar}><Building2 size={22} color={colors.primary} /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.name}>{bp.displayName}</Text>
                                    <Text style={styles.meta}>{bp.partnerCode}{bp.legalName !== bp.displayName ? ` · ${bp.legalName}` : ''}</Text>
                                    {!!status && <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>}
                                </View>
                            </View>
                            {bp.status === 'pending' && (
                                <Text style={styles.notice}>UniteFix is reviewing your account. You can browse the catalogue; ordering opens on approval.</Text>
                            )}
                            {bp.status === 'suspended' && (
                                <Text style={[styles.notice, { color: colors.errorDark }]}>Ordering is paused on this account. Please contact UniteFix.</Text>
                            )}
                            <View style={styles.facts}>
                                {!!bp.gstin && <Fact label="GSTIN" value={bp.gstin} />}
                                {!!bp.contactName && <Fact label="Contact" value={`${bp.contactName}${bp.contactPhone ? ` · ${bp.contactPhone}` : ''}`} />}
                                {!!bp.address && <Fact label="Address" value={`${bp.address}${bp.pincode ? `, ${bp.pincode}` : ''}`} />}
                                {bp.verticals.length > 0 && <Fact label="Business" value={bp.verticals.map(v => v.toUpperCase()).join(' · ')} />}
                                {(bp.payout.bankLast4 || bp.payout.upiId) && (
                                    <Fact label="Settlements to" value={bp.payout.upiId ?? `A/c ending ${bp.payout.bankLast4}`} />
                                )}
                            </View>
                        </View>

                        {/* Money — two balances, side by side */}
                        <View style={styles.balances}>
                            <View style={[styles.balance, { borderColor: (st?.youOwe ?? 0) > 0 ? colors.errorLight : colors.border }]}>
                                <Text style={styles.balLabel}>You owe UniteFix</Text>
                                <Text style={[styles.balValue, (st?.youOwe ?? 0) > 0 && { color: colors.errorDark }]}>₹{st?.youOwe ?? 0}</Text>
                                <Text style={styles.balSub}>
                                    {bp.credit.limit > 0 ? `₹${bp.credit.available} of ₹${bp.credit.limit} credit free${bp.credit.paymentTermsDays ? ` · ${bp.credit.paymentTermsDays}-day terms` : ''}` : 'Prepaid account'}
                                </Text>
                            </View>
                            <View style={[styles.balance, { borderColor: (st?.owedToYou ?? 0) > 0 ? colors.successLight : colors.border }]}>
                                <Text style={styles.balLabel}>UniteFix owes you</Text>
                                <Text style={[styles.balValue, (st?.owedToYou ?? 0) > 0 && { color: colors.successDark }]}>₹{st?.owedToYou ?? 0}</Text>
                                <Text style={styles.balSub}>Recharges collected and credit notes, settled to your account</Text>
                            </View>
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Statement</Text>
                            {ledger.isLoading ? (
                                <ActivityIndicator color={colors.primary} />
                            ) : (st?.lines.length ?? 0) === 0 ? (
                                <Text style={styles.empty}>No entries yet. Orders on credit, payments and settlements appear here.</Text>
                            ) : st!.lines.map(l => <LedgerRow key={`${l.source}-${l.id}`} line={l} />)}
                        </View>
                    </>
                )}

                <View style={styles.menu}>
                    <MenuRow icon={<Bell size={18} color={colors.textSecondary} />} label="Notifications" onPress={() => navigation.navigate('Notifications')} />
                    <MenuRow icon={<FileText size={18} color={colors.textSecondary} />} label="Legal & policies" onPress={() => navigation.navigate('Legal')} />
                    <MenuRow icon={<LogOut size={18} color={colors.errorDark} />} label="Log out" onPress={confirmLogout} danger />
                </View>
            </ScrollView>
        </View>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.fact}>
            <Text style={styles.factLabel}>{label}</Text>
            <Text style={styles.factValue}>{value}</Text>
        </View>
    );
}

function MenuRow({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
    return (
        <TouchableOpacity style={styles.menuRow} onPress={onPress}>
            {icon}
            <Text style={[styles.menuLabel, danger && { color: colors.errorDark }]}>{label}</Text>
            {!danger && <ChevronRight size={18} color={colors.textDisabled} />}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
    title: { ...typography.h2, color: colors.textPrimary },
    content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    idRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight + '66', alignItems: 'center', justifyContent: 'center' },
    name: { ...typography.h3, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    status: { ...typography.captionMedium, marginTop: 2 },
    notice: { ...typography.caption, color: colors.warningDark, marginTop: spacing.sm },
    facts: { marginTop: spacing.md, gap: spacing.xs },
    fact: { flexDirection: 'row', gap: spacing.sm },
    factLabel: { ...typography.caption, color: colors.textSecondary, width: 92 },
    factValue: { ...typography.caption, color: colors.textPrimary, flex: 1 },
    balances: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    balance: { flex: 1, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1 },
    balLabel: { ...typography.caption, color: colors.textSecondary },
    balValue: { ...typography.h3, color: colors.textPrimary, marginTop: 2 },
    balSub: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
    empty: { ...typography.caption, color: colors.textSecondary },
    ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
    ledgerTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    ledgerMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    ledgerAmt: { ...typography.bodySemibold },
    menu: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
    menuLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
});
