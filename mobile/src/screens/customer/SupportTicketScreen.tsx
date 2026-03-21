/**
 * Support Ticket Screen — Create / view support tickets
 * Role: 🟦 Customer only
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    FlatList,
    Alert,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, MessageCircle, Send, ChevronRight, CircleDot,
    Clock, CheckCircle, PlusCircle,
} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'SupportTicket'>;

interface Ticket {
    id: number;
    subject: string;
    description: string;
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    createdAt: string;
    updatedAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    open: { bg: colors.primarySurface, text: colors.primary, label: 'Open' },
    in_progress: { bg: colors.warningLight, text: colors.warning, label: 'In Progress' },
    resolved: { bg: colors.successLight, text: colors.success, label: 'Resolved' },
    closed: { bg: colors.surface, text: colors.textDisabled, label: 'Closed' },
};

export function SupportTicketScreen({ navigation }: Props) {
    const qc = useQueryClient();

    const [mode, setMode] = useState<'list' | 'create'>('list');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');

    // Fetch tickets
    const { data: ticketsData, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['support-tickets'],
        queryFn: async () => {
            const res = await apiClient.get('/api/client/support-tickets');
            return (res.data as any)?.tickets || (res.data as any)?.data || [];
        },
    });
    const tickets: Ticket[] = Array.isArray(ticketsData) ? ticketsData : [];

    // Create ticket
    const { mutate: createTicket, isPending } = useMutation({
        mutationFn: (data: { subject: string; description: string }) =>
            apiClient.post('/api/client/support-tickets', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
            setMode('list');
            setSubject('');
            setDescription('');
            Alert.alert('Ticket Created', 'Your support ticket has been submitted. We\'ll get back to you soon.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });

    const handleSubmit = () => {
        if (!subject.trim()) { Alert.alert('Required', 'Please enter a subject.'); return; }
        if (!description.trim()) { Alert.alert('Required', 'Please describe your issue.'); return; }
        createTicket({ subject: subject.trim(), description: description.trim() });
    };

    const formatDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return d; }
    };

    const renderTicket = ({ item }: { item: Ticket }) => {
        const status = STATUS_COLORS[item.status] || STATUS_COLORS.open;
        return (
            <TouchableOpacity style={styles.ticketCard} activeOpacity={0.7}>
                <View style={styles.ticketHeader}>
                    <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
                    </View>
                </View>
                <Text style={styles.ticketDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.ticketFooter}>
                    <Clock size={12} color={colors.textDisabled} />
                    <Text style={styles.ticketDate}>{formatDate(item.createdAt)}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => mode === 'create' ? setMode('list') : navigation.goBack()}
                    style={styles.backBtn}
                >
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {mode === 'create' ? 'New Ticket' : 'Support'}
                </Text>
                {mode === 'list' ? (
                    <TouchableOpacity onPress={() => setMode('create')} style={styles.addBtn}>
                        <PlusCircle size={22} color={colors.primary} />
                    </TouchableOpacity>
                ) : <View style={{ width: 36 }} />}
            </View>

            {mode === 'create' ? (
                /* Create Form */
                <ScrollView contentContainerStyle={styles.formContent}>
                    <View style={styles.formCard}>
                        <Text style={styles.formLabel}>Subject</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Brief summary of your issue"
                            value={subject}
                            onChangeText={setSubject}
                            placeholderTextColor={colors.textDisabled}
                        />

                        <Text style={styles.formLabel}>Description</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            placeholder="Describe your issue in detail..."
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={6}
                            textAlignVertical="top"
                            placeholderTextColor={colors.textDisabled}
                        />
                    </View>

                    <Button
                        title="Submit Ticket"
                        onPress={handleSubmit}
                        loading={isPending}
                    />
                </ScrollView>
            ) : (
                /* Ticket List */
                isLoading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : tickets.length === 0 ? (
                    <View style={styles.center}>
                        <MessageCircle size={48} color={colors.textDisabled} />
                        <Text style={styles.emptyTitle}>No Support Tickets</Text>
                        <Text style={styles.emptyText}>
                            Need help? Create a ticket and we'll get back to you.
                        </Text>
                        <Button
                            title="Create Ticket"
                            onPress={() => setMode('create')}
                            style={{ marginTop: spacing.xl, width: '100%' }}
                        />
                    </View>
                ) : (
                    <FlatList
                        data={tickets}
                        renderItem={renderTicket}
                        keyExtractor={(item) => item.id.toString()}
                        contentContainerStyle={styles.listContent}
                        refreshControl={
                            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
                        }
                    />
                )
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    addBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: spacing.xl },
    ticketCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    ticketSubject: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
    statusBadge: { paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.full },
    statusText: { ...typography.small, fontWeight: '700' },
    ticketDesc: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
    ticketFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    ticketDate: { ...typography.small, color: colors.textDisabled },
    formContent: { padding: spacing.xl },
    formCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm },
    formLabel: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.md },
    input: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
        padding: spacing.md, ...typography.body, color: colors.textPrimary,
    },
    textArea: { minHeight: 120 },
    emptyTitle: { ...typography.h4, color: colors.textPrimary, marginTop: spacing.lg },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
