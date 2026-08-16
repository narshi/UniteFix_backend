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
    Modal,
    Pressable,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, MessageCircle, Send, ChevronRight, CircleDot,
    Clock, CheckCircle, PlusCircle, X,
} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'SupportTicket'>;

interface TicketMessage {
    id: number;
    message: string;
    senderType: 'customer' | 'admin' | 'system';
    isInternal?: boolean;
    createdAt: string;
}

interface Ticket {
    id: number;
    ticketId?: string;
    subject: string;
    description: string;
    status: 'open' | 'in_progress' | 'escalated' | 'resolved' | 'closed';
    serviceRequestId?: number;
    createdAt: string;
    updatedAt: string;
    messages?: TicketMessage[];
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    open: { bg: colors.primarySurface, text: colors.primary, label: 'Open' },
    in_progress: { bg: colors.warningLight, text: colors.warning, label: 'In Progress' },
    escalated: { bg: colors.errorLight, text: colors.error, label: 'Escalated' },
    resolved: { bg: colors.successLight, text: colors.success, label: 'Resolved' },
    closed: { bg: colors.surface, text: colors.textDisabled, label: 'Closed' },
};

export function SupportTicketScreen({ navigation, route }: Props) {
    const { headerTop } = useScreenInsets();
    const qc = useQueryClient();

    const prefilledServiceRequestId = route.params?.serviceRequestId;
    const [mode, setMode] = useState<'list' | 'create'>(prefilledServiceRequestId ? 'create' : 'list');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');

    // Fetch tickets
    const { data: ticketsData, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['support-tickets'],
        queryFn: async () => {
            // Server route is /api/client/tickets (client-features.routes.ts).
            // The old '/api/client/support-tickets' path never existed and 404'd.
            const res = await apiClient.get('/api/client/tickets');
            return (res.data as any)?.tickets || (res.data as any)?.data || [];
        },
    });
    const tickets: Ticket[] = Array.isArray(ticketsData) ? ticketsData : [];

    // Create ticket
    const { mutate: createTicket, isPending } = useMutation({
        mutationFn: (data: { subject: string; description: string; serviceRequestId?: number }) =>
            apiClient.post('/api/client/tickets', data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
            setMode('list');
            setSubject('');
            setDescription('');
            Alert.alert('Ticket Created', 'Your support ticket has been submitted. We\'ll get back to you soon.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });

    // Escalate ticket
    const { mutate: escalateTicket, isPending: isEscalating } = useMutation({
        mutationFn: (ticketId: number) =>
            apiClient.post(`/api/client/tickets/${ticketId}/escalate`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
            if (openTicketId) qc.invalidateQueries({ queryKey: ['support-ticket', openTicketId] });
            Alert.alert('Escalated', 'Your issue has been marked as escalated. Our team will prioritize it immediately.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });

    // ── Detail popup ──────────────────────────────────────────────────────
    // Tapping a row previously did nothing: the card was a TouchableOpacity
    // with no onPress, so the status and the conversation the admin can see
    // were invisible in the app.
    const [openTicketId, setOpenTicketId] = useState<number | null>(null);
    const [reply, setReply] = useState('');

    const { data: detail, isLoading: isDetailLoading } = useQuery({
        queryKey: ['support-ticket', openTicketId],
        enabled: openTicketId != null,
        queryFn: async () => {
            const res = await apiClient.get(`/api/client/tickets/${openTicketId}`);
            const body = (res.data as any)?.data ?? res.data;
            return (body?.ticket ?? body) as Ticket;
        },
    });

    const { mutate: sendReply, isPending: isReplying } = useMutation({
        mutationFn: (message: string) =>
            apiClient.post(`/api/client/tickets/${openTicketId}/reply`, { message }),
        onSuccess: () => {
            setReply('');
            qc.invalidateQueries({ queryKey: ['support-ticket', openTicketId] });
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });

    // Falls back to the list row while the detail request is in flight, so the
    // sheet opens with the subject and status already filled in.
    const openTicket: Ticket | undefined =
        detail ?? tickets.find((t) => t.id === openTicketId);
    const isClosed = openTicket?.status === 'closed' || openTicket?.status === 'resolved';

    const handleSubmit = () => {
        if (!subject.trim()) { Alert.alert('Required', 'Please enter a subject.'); return; }
        if (!description.trim()) { Alert.alert('Required', 'Please describe your issue.'); return; }
        createTicket({ subject: subject.trim(), description: description.trim(), serviceRequestId: prefilledServiceRequestId });
    };

    const formatDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return d; }
    };

    const renderTicket = ({ item }: { item: Ticket }) => {
        const status = STATUS_COLORS[item.status] || STATUS_COLORS.open;
        const isEligibleForEscalation = item.status === 'open' && (Date.now() - new Date(item.createdAt).getTime()) > 48 * 60 * 60 * 1000;
        
        return (
            <TouchableOpacity
                style={styles.ticketCard}
                activeOpacity={0.7}
                onPress={() => { setReply(''); setOpenTicketId(item.id); }}
            >
                <View style={styles.ticketHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
                        {item.serviceRequestId && (
                            <Text style={styles.ticketLinked}>Booking #{item.serviceRequestId}</Text>
                        )}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
                    </View>
                </View>
                <Text style={styles.ticketDesc} numberOfLines={2}>{item.description}</Text>
                
                <View style={[styles.ticketFooter, isEligibleForEscalation ? { justifyContent: 'space-between' } : {}]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Clock size={12} color={colors.textDisabled} />
                        <Text style={styles.ticketDate}>{formatDate(item.createdAt)}</Text>
                    </View>
                    
                    {isEligibleForEscalation && (
                        <TouchableOpacity 
                            style={styles.escalateBtn}
                            onPress={() => escalateTicket(item.id)}
                            disabled={isEscalating}
                        >
                            <Text style={styles.escalateText}>Follow up</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
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

            {/* Working Hours Notice */}
            <View style={styles.noticeBanner}>
                <Clock size={14} color={colors.textSecondary} />
                <Text style={styles.noticeText}>Working hours: Mon - Sat, 10 AM to 6 PM</Text>
            </View>

            {mode === 'create' ? (
                /* Create Form */
                <ScrollView contentContainerStyle={styles.formContent}>
                    {prefilledServiceRequestId && (
                        <View style={styles.linkedBookingBadge}>
                            <CircleDot size={14} color={colors.primary} />
                            <Text style={styles.linkedBookingText}>Linked to Booking #{prefilledServiceRequestId}</Text>
                        </View>
                    )}
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

            {/* Ticket detail popup */}
            <Modal
                visible={openTicketId != null}
                transparent
                animationType="slide"
                onRequestClose={() => setOpenTicketId(null)}
            >
                <View style={styles.modalRoot}>
                    <Pressable style={styles.backdrop} onPress={() => setOpenTicketId(null)} />

                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={styles.sheet}
                    >
                        <View style={styles.sheetHandle} />

                        <View style={styles.sheetHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetTitle} numberOfLines={2}>
                                    {openTicket?.subject ?? 'Ticket'}
                                </Text>
                                <Text style={styles.sheetMeta}>
                                    {openTicket?.ticketId ? `${openTicket.ticketId} · ` : ''}
                                    {openTicket?.createdAt ? formatDate(openTicket.createdAt) : ''}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setOpenTicketId(null)} style={styles.closeBtn}>
                                <X size={20} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.sheetStatusRow}>
                            {(() => {
                                const s = STATUS_COLORS[openTicket?.status ?? 'open'] || STATUS_COLORS.open;
                                return (
                                    <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                                        <Text style={[styles.statusText, { color: s.text }]}>{s.label}</Text>
                                    </View>
                                );
                            })()}
                            {openTicket?.serviceRequestId ? (
                                <Text style={styles.ticketLinked}>Booking #{openTicket.serviceRequestId}</Text>
                            ) : null}
                        </View>

                        <ScrollView style={styles.sheetBody} contentContainerStyle={{ paddingBottom: spacing.lg }}>
                            <Text style={styles.sheetSectionLabel}>Your issue</Text>
                            <View style={styles.sheetBlock}>
                                <Text style={styles.sheetBlockText}>{openTicket?.description}</Text>
                            </View>

                            <Text style={styles.sheetSectionLabel}>Conversation</Text>
                            {isDetailLoading && !detail ? (
                                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                            ) : (openTicket?.messages?.length ?? 0) === 0 ? (
                                <Text style={styles.sheetEmpty}>
                                    No replies yet. Our team responds within working hours.
                                </Text>
                            ) : (
                                openTicket!.messages!.map((m) => (
                                    <View
                                        key={m.id}
                                        style={[
                                            styles.bubble,
                                            m.senderType === 'customer' ? styles.bubbleMine : styles.bubbleTheirs,
                                        ]}
                                    >
                                        <Text style={styles.bubbleFrom}>
                                            {m.senderType === 'customer' ? 'You' : 'UniteFix Support'}
                                        </Text>
                                        <Text style={styles.bubbleText}>{m.message}</Text>
                                        <Text style={styles.bubbleTime}>{formatDate(m.createdAt)}</Text>
                                    </View>
                                ))
                            )}
                        </ScrollView>

                        {isClosed ? (
                            <View style={styles.closedNotice}>
                                <CheckCircle size={14} color={colors.success} />
                                <Text style={styles.closedNoticeText}>
                                    This ticket is {openTicket?.status === 'closed' ? 'closed' : 'resolved'}.
                                    Create a new ticket if you still need help.
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.replyRow}>
                                <TextInput
                                    style={styles.replyInput}
                                    placeholder="Write a reply…"
                                    placeholderTextColor={colors.textDisabled}
                                    value={reply}
                                    onChangeText={setReply}
                                    multiline
                                />
                                <TouchableOpacity
                                    style={[styles.sendBtn, (!reply.trim() || isReplying) && { opacity: 0.5 }]}
                                    disabled={!reply.trim() || isReplying}
                                    onPress={() => sendReply(reply.trim())}
                                >
                                    {isReplying
                                        ? <ActivityIndicator size="small" color={colors.background} />
                                        : <Send size={18} color={colors.background} />}
                                </TouchableOpacity>
                            </View>
                        )}
                    </KeyboardAvoidingView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
    },
    noticeBanner: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        paddingVertical: spacing.sm, backgroundColor: colors.surface,
        borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    noticeText: { ...typography.caption, color: colors.textSecondary },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    addBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: spacing.xl },
    ticketCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    ticketSubject: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
    ticketLinked: { ...typography.small, color: colors.primary, marginTop: 2 },
    statusBadge: { paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.full },
    statusText: { ...typography.small, fontWeight: '700' },
    ticketDesc: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
    ticketFooter: { flexDirection: 'row', alignItems: 'center' },
    ticketDate: { ...typography.small, color: colors.textDisabled },
    escalateBtn: { backgroundColor: colors.errorLight, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.sm },
    escalateText: { ...typography.captionMedium, color: colors.errorDark },
    formContent: { padding: spacing.xl },
    linkedBookingBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primarySurface, padding: spacing.sm, borderRadius: radii.md, marginBottom: spacing.md, alignSelf: 'flex-start' },
    linkedBookingText: { ...typography.captionMedium, color: colors.primary },
    formCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.xl, ...shadows.sm },
    formLabel: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.md },
    input: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
        padding: spacing.md, ...typography.body, color: colors.textPrimary,
    },
    textArea: { minHeight: 120 },
    emptyTitle: { ...typography.h4, color: colors.textPrimary, marginTop: spacing.lg },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },

    // ── Detail popup ──────────────────────────────────────────────────────
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
        backgroundColor: colors.background,
        borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.xl, paddingBottom: spacing.xl,
        maxHeight: '88%',
    },
    sheetHandle: {
        width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider,
        alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.md,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    sheetTitle: { ...typography.h4, color: colors.textPrimary },
    sheetMeta: { ...typography.small, color: colors.textDisabled, marginTop: 2 },
    closeBtn: {
        width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center',
    },
    sheetStatusRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginTop: spacing.md, marginBottom: spacing.sm,
    },
    sheetBody: { marginTop: spacing.sm },
    sheetSectionLabel: {
        ...typography.captionMedium, color: colors.textSecondary,
        marginTop: spacing.md, marginBottom: spacing.sm, textTransform: 'uppercase',
    },
    sheetBlock: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
    sheetBlockText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
    sheetEmpty: { ...typography.caption, color: colors.textDisabled, paddingVertical: spacing.md },
    bubble: { borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, maxWidth: '90%' },
    bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primarySurface },
    bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
    bubbleFrom: { ...typography.small, fontWeight: '700', color: colors.textSecondary, marginBottom: 2 },
    bubbleText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
    bubbleTime: { ...typography.small, color: colors.textDisabled, marginTop: 4 },
    replyRow: {
        flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
        paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider,
    },
    replyInput: {
        flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        ...typography.body, color: colors.textPrimary, maxHeight: 100,
    },
    sendBtn: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
        justifyContent: 'center', alignItems: 'center',
    },
    closedNotice: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider,
    },
    closedNoticeText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
});
