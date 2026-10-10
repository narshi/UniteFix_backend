/**
 * Plan an event — UniteFix events partners near the customer's pincode.
 *
 * The customer picks a planner, describes the event, and sends an enquiry.
 * The planner replies with a quotation, which opens as a web page the
 * customer can accept or decline. "My enquiries" shows where each stands.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, PartyPopper, ChevronRight } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { apiClient, WEB_BASE_URL, getApiErrorMessage } from '../../api/client';
import { useProfile } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Planner = { id: number; code: string; name: string; city: string | null; categories: string[]; startingFrom: number | null };
type MyEnquiry = { id: number; partner: string; partnerPhone: string | null; eventType: string; eventDate: string | null; guests: number | null; status: string; quotation: { number: string; version: number; status: string; total: number; link: string } | null };

const CAT: Record<string, string> = { venue: 'Venue', decor: 'Décor', catering: 'Catering', cake: 'Cakes & desserts', av: 'Sound & light', photography: 'Photography', staff: 'Staff', other: 'Other' };
const STATUS: Record<string, string> = { new: 'Sent', contacted: 'In discussion', quoted: 'Quotation ready', won: 'Booked', lost: 'Closed' };

type Props = NativeStackScreenProps<any, 'EventPlanner'>;

export function EventPlannerScreen({ navigation }: Props) {
    const { data: profile } = useProfile();
    const pin = (profile as any)?.pinCode as string | undefined;
    const qc = useQueryClient();
    const planners = useQuery<Planner[]>({
        queryKey: ['eventPlanners', pin],
        queryFn: async () => (await apiClient.get(`/api/events/partners?pincode=${pin}`)).data?.data ?? [],
        enabled: !!pin && /^\d{6}$/.test(pin),
    });
    const mine = useQuery<MyEnquiry[]>({ queryKey: ['myEventEnquiries'], queryFn: async () => (await apiClient.get('/api/events/my-enquiries')).data?.data ?? [] });
    const [picked, setPicked] = useState<Planner | null>(null);
    const [f, setF] = useState({ eventType: '', eventDate: '', guests: '', venue: '', budget: '', message: '' });
    const send = useMutation({
        mutationFn: async () => (await apiClient.post('/api/events/enquiries', {
            partnerId: picked!.id, eventType: f.eventType.trim(), eventDate: /^\d{4}-\d{2}-\d{2}$/.test(f.eventDate) ? f.eventDate : null,
            guests: f.guests ? Number(f.guests) : null, venue: f.venue || null, budgetRupees: f.budget ? Number(f.budget) : null, message: f.message || null,
        })).data,
        onSuccess: (r: any) => {
            Alert.alert('Enquiry sent', r?.message ?? `${picked!.name} will reply with a quotation.`);
            setPicked(null); setF({ eventType: '', eventDate: '', guests: '', venue: '', budget: '', message: '' });
            qc.invalidateQueries({ queryKey: ['myEventEnquiries'] });
        },
        onError: (e) => Alert.alert('Not sent', getApiErrorMessage(e)),
    });

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => (picked ? setPicked(null) : navigation.goBack())} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Back">
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{picked ? picked.name : 'Plan an event'}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {!picked ? (
                    <>
                        <Text style={styles.lead}>Weddings, birthdays, corporate events — planners who work with UniteFix near {pin ?? 'you'}.</Text>
                        {!pin && <Text style={styles.muted}>Add your address and pincode in your profile to see planners near you.</Text>}
                        {planners.isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}
                        {planners.data?.length === 0 && <Text style={styles.muted}>No event planners near you yet.</Text>}
                        {(planners.data ?? []).map(p => (
                            <TouchableOpacity key={p.id} style={styles.card} onPress={() => setPicked(p)} activeOpacity={0.85}>
                                <View style={styles.icon}><PartyPopper size={20} color={colors.primary} /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardTitle}>{p.name}</Text>
                                    <Text style={styles.cardSub}>{[p.city, p.categories.map(c => CAT[c] ?? c).join(' · ')].filter(Boolean).join(' — ')}</Text>
                                    {p.startingFrom != null && <Text style={styles.cardSub}>Packages from ₹{p.startingFrom.toLocaleString('en-IN')}</Text>}
                                </View>
                                <ChevronRight size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        ))}

                        {(mine.data ?? []).length > 0 && <Text style={styles.section}>My enquiries</Text>}
                        {(mine.data ?? []).map(e => (
                            <View key={e.id} style={styles.card}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardTitle}>{e.eventType} · {e.partner}</Text>
                                    <Text style={styles.cardSub}>{STATUS[e.status] ?? e.status}{e.eventDate ? ` · ${e.eventDate}` : ''}{e.guests ? ` · ${e.guests} guests` : ''}</Text>
                                    {e.quotation && (
                                        <TouchableOpacity onPress={() => Linking.openURL(`${WEB_BASE_URL}${e.quotation!.link}`)} accessibilityRole="link">
                                            <Text style={styles.link}>Quotation {e.quotation.number} · ₹{e.quotation.total.toLocaleString('en-IN')} · {e.quotation.status === 'sent' ? 'tap to accept or decline' : e.quotation.status}</Text>
                                        </TouchableOpacity>
                                    )}
                                    {e.partnerPhone && <TouchableOpacity onPress={() => Linking.openURL(`tel:${e.partnerPhone}`)}><Text style={styles.link}>Call {e.partner}</Text></TouchableOpacity>}
                                </View>
                            </View>
                        ))}
                    </>
                ) : (
                    <>
                        <Text style={styles.lead}>Tell {picked.name} about your event. They will reply with a quotation you can accept here.</Text>
                        {([
                            ['eventType', 'Occasion (e.g. Wedding reception) *', 'default'],
                            ['eventDate', 'Date (YYYY-MM-DD)', 'numbers-and-punctuation'],
                            ['guests', 'Number of guests', 'number-pad'],
                            ['venue', 'Venue or area', 'default'],
                            ['budget', 'Budget ₹ (optional)', 'number-pad'],
                        ] as const).map(([k, label, kb]) => (
                            <View key={k} style={styles.field}>
                                <Text style={styles.label}>{label}</Text>
                                <TextInput style={styles.input} value={(f as any)[k]} keyboardType={kb as any} onChangeText={v => setF({ ...f, [k]: v })} accessibilityLabel={label} />
                            </View>
                        ))}
                        <View style={styles.field}>
                            <Text style={styles.label}>Anything else?</Text>
                            <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top' }]} multiline value={f.message} onChangeText={v => setF({ ...f, message: v })} accessibilityLabel="Message" />
                        </View>
                        <Button title={send.isPending ? 'Sending…' : 'Send enquiry'} onPress={() => send.mutate()} disabled={send.isPending || f.eventType.trim().length < 2} />
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerTitle: { ...typography.h3, color: colors.textPrimary },
    body: { padding: spacing.base, paddingBottom: 48 },
    lead: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    muted: { ...typography.body, color: colors.textTertiary, marginTop: spacing.sm },
    section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
    card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, backgroundColor: colors.surfaceElevated },
    icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    cardSub: { ...typography.body, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    link: { ...typography.body, fontSize: 13, color: colors.primary, marginTop: 4 },
    field: { marginBottom: spacing.md },
    label: { ...typography.body, fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.textPrimary, backgroundColor: colors.background },
});
