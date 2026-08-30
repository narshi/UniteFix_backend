/**
 * Broadband onboarding — two doors.
 *
 *   New user       → a lead the operator calls back about
 *   Existing user  → an ID request the operator approves, after which the
 *                    connection appears and can be recharged
 *
 * Both end in a waiting state rather than instant access, because both need a
 * human at the ISP. Saying so plainly beats a spinner that never resolves.
 */

import React, { useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Link2, ArrowRight } from 'lucide-react-native';
import { ftthApi } from '../../api/ftth.api';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader, Button, Input } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHOnboarding'>;
type Mode = 'choose' | 'new' | 'existing';

export function FTTHOnboardingScreen({ navigation, route }: Props) {
    const operator = route.params?.operator as { id: number; companyName: string };
    const { bottomBar } = useScreenInsets();
    const queryClient = useQueryClient();
    const user = useAuthStore(s => s.user) as any;

    const [mode, setMode] = useState<Mode>('choose');
    const [form, setForm] = useState({
        name: user?.username ?? '',
        phone: (user?.phone ?? '').replace(/^\+91/, ''),
        address: user?.homeAddress ?? '',
        pincode: user?.pinCode ?? '',
        ispId: '',
        notes: '',
    });

    const done = (title: string, message: string) => {
        queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
        Alert.alert(title, message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    };

    const leadMutation = useMutation({
        mutationFn: () => ftthApi.submitLead({
            operatorId: operator.id,
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            pincode: form.pincode.trim(),
            notes: form.notes.trim() || undefined,
        }),
        onSuccess: (r) => done('Request sent', r.message ?? `${operator.companyName} will contact you shortly.`),
        onError: (e: any) => Alert.alert(
            'Could not send',
            e?.response?.data?.message ?? 'Please try again in a moment.',
        ),
    });

    const idMutation = useMutation({
        mutationFn: () => ftthApi.submitIdRequest({
            operatorId: operator.id,
            claimedName: form.name.trim(),
            claimedPhone: form.phone.trim(),
            claimedAddress: form.address.trim() || undefined,
            claimedIspId: form.ispId.trim() || undefined,
        }),
        onSuccess: (r) => done('Sent for verification', r.message ?? `${operator.companyName} will link your account.`),
        onError: (e: any) => Alert.alert(
            'Could not send',
            e?.response?.data?.message ?? 'Please try again in a moment.',
        ),
    });

    const leadValid = form.name.trim().length >= 2
        && /^[6-9]\d{9}$/.test(form.phone.trim())
        && form.address.trim().length >= 5
        && /^\d{6}$/.test(form.pincode.trim());

    const idValid = form.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(form.phone.trim());

    return (
        <View style={styles.screen}>
            <ScreenHeader
                title={operator?.companyName ?? 'Broadband'}
                onBack={() => (mode === 'choose' ? navigation.goBack() : setMode('choose'))}
            />

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomBar + spacing['2xl'] }]}>
                    {mode === 'choose' && (
                        <>
                            <Text style={styles.lead}>
                                Are you already a {operator?.companyName} customer?
                            </Text>

                            <TouchableOpacity style={styles.optionCard} onPress={() => setMode('existing')}>
                                <View style={styles.optionIcon}>
                                    <Link2 size={20} color={colors.primary} />
                                </View>
                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                    <Text style={styles.optionTitle}>Yes, link my account</Text>
                                    <Text style={styles.optionBody}>
                                        We'll ask {operator?.companyName} to connect your existing connection so you can
                                        recharge here.
                                    </Text>
                                </View>
                                <ArrowRight size={18} color={colors.textSecondary} />
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.optionCard} onPress={() => setMode('new')}>
                                <View style={[styles.optionIcon, { backgroundColor: colors.accentLight }]}>
                                    <UserPlus size={20} color={colors.accentDark} />
                                </View>
                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                    <Text style={styles.optionTitle}>No, I want a new connection</Text>
                                    <Text style={styles.optionBody}>
                                        We'll pass your details on and {operator?.companyName} will call you to arrange
                                        installation.
                                    </Text>
                                </View>
                                <ArrowRight size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </>
                    )}

                    {mode === 'existing' && (
                        <>
                            <Text style={styles.lead}>Your details as {operator?.companyName} has them</Text>
                            <Text style={styles.hint}>
                                They'll match these against their records and link your account. This usually takes a
                                day or two.
                            </Text>

                            <Input label="Full name" value={form.name}
                                onChangeText={(v: string) => setForm({ ...form, name: v })} placeholder="As registered with them" />
                            <Input label="Phone number" value={form.phone} keyboardType="phone-pad" maxLength={10}
                                onChangeText={(v: string) => setForm({ ...form, phone: v.replace(/\D/g, '') })} placeholder="10-digit number" />
                            <Input label="Installation address (optional)" value={form.address}
                                onChangeText={(v: string) => setForm({ ...form, address: v })} placeholder="Helps them find you faster" />
                            <Input label="Your customer ID (optional)" value={form.ispId}
                                onChangeText={(v: string) => setForm({ ...form, ispId: v })}
                                placeholder="If you know it — e.g. POORVI-9912" />

                            <Button
                                title={idMutation.isPending ? 'Sending…' : 'Request account link'}
                                onPress={() => idMutation.mutate()}
                                disabled={!idValid || idMutation.isPending}
                                style={{ marginTop: spacing.lg }}
                            />
                        </>
                    )}

                    {mode === 'new' && (
                        <>
                            <Text style={styles.lead}>Where should they install it?</Text>
                            <Text style={styles.hint}>
                                {operator?.companyName} will call you to confirm availability and pricing.
                            </Text>

                            <Input label="Full name" value={form.name}
                                onChangeText={(v: string) => setForm({ ...form, name: v })} placeholder="Your name" />
                            <Input label="Phone number" value={form.phone} keyboardType="phone-pad" maxLength={10}
                                onChangeText={(v: string) => setForm({ ...form, phone: v.replace(/\D/g, '') })} placeholder="10-digit number" />
                            <Input label="Installation address" value={form.address} multiline
                                onChangeText={(v: string) => setForm({ ...form, address: v })} placeholder="House / street / landmark" />
                            <Input label="Pincode" value={form.pincode} keyboardType="number-pad" maxLength={6}
                                onChangeText={(v: string) => setForm({ ...form, pincode: v.replace(/\D/g, '') })} placeholder="581359" />
                            <Input label="Anything else? (optional)" value={form.notes}
                                onChangeText={(v: string) => setForm({ ...form, notes: v })} placeholder="Preferred time to call" />

                            <Button
                                title={leadMutation.isPending ? 'Sending…' : 'Request a connection'}
                                onPress={() => leadMutation.mutate()}
                                disabled={!leadValid || leadMutation.isPending}
                                style={{ marginTop: spacing.lg }}
                            />
                        </>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.base },
    lead: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
    hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.lg },
    optionCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.surfaceElevated, borderRadius: radii.lg,
        padding: spacing.base, marginBottom: spacing.md, ...shadows.xs,
    },
    optionIcon: {
        width: 44, height: 44, borderRadius: radii.full,
        backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center',
    },
    optionTitle: { ...typography.h4, color: colors.textPrimary },
    optionBody: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
