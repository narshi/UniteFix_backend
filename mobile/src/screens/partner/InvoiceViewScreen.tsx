/**
 * Partner Invoice Screen — View/download invoice for completed services
 * Role: 🟧 Serviceman only
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, FileText, Download, Calendar, User, Wrench, IndianRupee,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'InvoiceView'>;

interface Invoice {
    id: number;
    invoiceNumber: string;
    serviceRequestId: number;
    serviceAmount?: number;
    gstAmount?: number;
    otherCharges?: number;
    totalAmount: number;
    // The booking fee is an advance inside the total, never an extra line.
    advancePaid?: number;
    balancePaid?: number;
    status: string;
    createdAt: string;
    customerName?: string;
    serviceType?: string;
}

export function InvoiceViewScreen({ navigation, route }: Props) {
    const { headerTop } = useScreenInsets();
    const serviceId = route.params?.serviceId;
    const [downloading, setDownloading] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['invoice', serviceId],
        queryFn: async () => {
            const res = await apiClient.get(`/api/customer/services/${serviceId}/invoice`);
            return (res.data as any)?.invoice || res.data;
        },
        enabled: !!serviceId,
    });

    const invoice: Invoice | null = data || null;

    const formatDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'long', year: 'numeric',
            });
        } catch { return d; }
    };

    /**
     * The PDF is fetched through a short-lived signed URL: a browser cannot
     * send the app's Bearer token, and the old direct URL pointed at
     * /api/invoices/:id/download — an endpoint that never existed (404).
     */
    const handleDownload = async () => {
        if (!serviceId) return;
        setDownloading(true);
        try {
            const res = await apiClient.post(`/api/partner/services/${serviceId}/invoice/download-link`);
            const url = (res.data as any)?.data?.url;
            if (!url) throw new Error('Could not create a download link');
            await Linking.openURL(url);
        } catch (err) {
            Alert.alert('Download Failed', getApiErrorMessage(err));
        } finally {
            setDownloading(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!invoice) {
        return (
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: headerTop }]}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <ArrowLeft size={22} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Invoice</Text>
                    <View style={{ width: 36 }} />
                </View>
                <View style={styles.center}>
                    <FileText size={48} color={colors.textDisabled} />
                    <Text style={styles.emptyTitle}>No Invoice Found</Text>
                    <Text style={styles.emptyText}>Invoice will be available after service completion.</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Invoice</Text>
                <TouchableOpacity onPress={handleDownload} style={styles.downloadBtn}>
                    <Download size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Invoice header card */}
                <View style={styles.invoiceCard}>
                    <View style={styles.invoiceHeader}>
                        <View style={styles.invoiceBadge}>
                            <FileText size={20} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.invoiceNumber}>
                                #{invoice.invoiceNumber || `INV-${invoice.id}`}
                            </Text>
                            <Text style={styles.invoiceDate}>
                                {formatDate(invoice.createdAt)}
                            </Text>
                        </View>
                        <View style={[styles.statusBadge, {
                            backgroundColor: invoice.status === 'paid' ? colors.successLight : colors.warningLight,
                        }]}>
                            <Text style={[styles.statusText, {
                                color: invoice.status === 'paid' ? colors.success : colors.warning,
                            }]}>
                                {invoice.status?.toUpperCase() || 'PENDING'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Details */}
                <View style={styles.detailCard}>
                    <Text style={styles.sectionTitle}>Service Details</Text>

                    <DetailRow
                        icon={<User size={16} color={colors.textSecondary} />}
                        label="Customer"
                        value={invoice.customerName || 'N/A'}
                    />
                    <DetailRow
                        icon={<Wrench size={16} color={colors.textSecondary} />}
                        label="Service Type"
                        value={invoice.serviceType || 'General Service'}
                    />
                    <DetailRow
                        icon={<Calendar size={16} color={colors.textSecondary} />}
                        label="Date"
                        value={formatDate(invoice.createdAt)}
                    />
                </View>

                {/* Amount breakdown */}
                <View style={styles.detailCard}>
                    <Text style={styles.sectionTitle}>Amount Breakdown</Text>

                    {invoice.serviceAmount != null && invoice.serviceAmount > 0 && (
                        <AmountRow label="Taxable Amount" amount={invoice.serviceAmount} />
                    )}
                    {invoice.gstAmount != null && invoice.gstAmount > 0 && (
                        <AmountRow label="GST (CGST + SGST)" amount={invoice.gstAmount} />
                    )}
                    {invoice.otherCharges != null && invoice.otherCharges > 0 && (
                        <AmountRow label="Approved Spare Parts" amount={invoice.otherCharges} />
                    )}
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Total Amount</Text>
                        <Text style={styles.totalAmount}>₹{invoice.totalAmount.toFixed(2)}</Text>
                    </View>

                    {/* Advance + balance always reconcile to the total above. */}
                    {invoice.advancePaid != null && invoice.advancePaid > 0 && (
                        <View style={{ marginTop: spacing.md }}>
                            <AmountRow label="Advance Paid (Booking Fee)" amount={invoice.advancePaid} />
                            <AmountRow label="Balance Paid" amount={invoice.balancePaid ?? (invoice.totalAmount - invoice.advancePaid)} />
                        </View>
                    )}
                </View>

                {/* Download button */}
                <Button
                    title="Download Invoice PDF"
                    onPress={handleDownload}
                    loading={downloading}
                    style={{ marginTop: spacing.md }}
                />
            </ScrollView>
        </View>
    );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <View style={styles.detailRow}>
            {icon}
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
        </View>
    );
}

function AmountRow({ label, amount }: { label: string; amount: number }) {
    return (
        <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{label}</Text>
            <Text style={styles.amountValue}>₹{Number(amount).toFixed(2)}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    downloadBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    scrollContent: { padding: spacing.xl, paddingBottom: 40 },
    invoiceCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    invoiceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    invoiceBadge: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface,
        justifyContent: 'center', alignItems: 'center',
    },
    invoiceNumber: { ...typography.h4, color: colors.textPrimary },
    invoiceDate: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    statusBadge: { paddingVertical: 4, paddingHorizontal: spacing.md, borderRadius: radii.full },
    statusText: { ...typography.small, fontWeight: '700' },
    detailCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.lg },
    detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
    detailLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
    detailValue: { ...typography.bodyMedium, color: colors.textPrimary },
    amountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    amountLabel: { ...typography.body, color: colors.textSecondary },
    amountValue: { ...typography.bodyMedium, color: colors.textPrimary },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: 2, borderTopColor: colors.primary },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalAmount: { fontSize: 20, fontWeight: '800', color: colors.primary },
    emptyTitle: { ...typography.h4, color: colors.textPrimary, marginTop: spacing.lg },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
