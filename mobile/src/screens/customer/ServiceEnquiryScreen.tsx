/**
 * Free quotes (referral band): the customer says what they need; partners
 * near them who offer it call back. Nothing is booked or paid here.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, MapPin, MessageSquareQuote, ShieldCheck } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { customerApi, type SavedAddress } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { BAND_META } from '../../utils/serviceBands';

type Props = NativeStackScreenProps<any, 'ServiceEnquiry'>;
const accent = BAND_META.referral.color;

function nextDates(): Array<{ date: string | null; label: string }> {
    const out: Array<{ date: string | null; label: string }> = [{ date: null, label: 'Not sure yet' }];
    for (const i of [0, 1, 2, 3, 7, 14, 30]) {
        const d = new Date(Date.now() + 330 * 60_000 + i * 86_400_000);
        out.push({ date: d.toISOString().slice(0, 10), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
    }
    return out;
}

export function ServiceEnquiryScreen({ navigation, route }: Props) {
    const serviceId: number = route.params?.serviceId;
    const serviceName: string = route.params?.serviceName ?? 'Service';
    const qc = useQueryClient();
    const dates = useMemo(nextDates, []);
    const [details, setDetails] = useState('');
    const [date, setDate] = useState<string | null>(null);
    const [budget, setBudget] = useState('');
    const [address, setAddress] = useState<SavedAddress | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (route.params?.selectedAddress) { setAddress(route.params.selectedAddress); setErrors(e => ({ ...e, address: '' })); }
    }, [route.params?.selectedAddress]);

    const submit = async () => {
        const e: Record<string, string> = {};
        if (details.trim().length < 10) e.details = 'Tell us a little more (a sentence or two).';
        if (!address) e.address = 'Choose where you are, so partners near you get it.';
        setErrors(e);
        if (Object.keys(e).length) return;
        setSending(true);
        try {
            const r = await customerApi.createEnquiry({
                catalogServiceId: serviceId, details: details.trim(), ...(date ? { preferredDate: date } : {}),
                ...(budget.trim() ? { budget: budget.trim() } : {}), address: address!.address, ...(address!.pinCode ? { pincode: address!.pinCode } : {}),
            });
            qc.invalidateQueries({ queryKey: ['myEnquiries'] });
            Alert.alert('Enquiry sent', r.data?.message ?? 'You will get a call.', [{
                text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs', state: { routes: [{ name: 'BookingsTab' }] } }] }),
            }]);
        } catch (err) {
            Alert.alert('Could not send', getApiErrorMessage(err));
        } finally { setSending(false); }
    };

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
                        <ArrowLeft size={22} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} numberOfLines={1}>{serviceName}</Text>
                    <View style={styles.back} />
                </View>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.hero}>
                        <View style={styles.heroIcon}><MessageSquareQuote size={22} color={accent} /></View>
                        <View style={styles.flex}>
                            <Text style={styles.heroKicker}>{BAND_META.referral.label}</Text>
                            <Text style={styles.heroText}>Tell us what you need. UniteFix partners near you who offer {serviceName.toLowerCase()} call you back with a quote. It is free, and you decide.</Text>
                        </View>
                    </View>

                    <Text style={styles.label}>What do you need? *</Text>
                    <TextInput
                        style={[styles.textArea, !!errors.details && styles.inputError]} value={details} onChangeText={setDetails}
                        placeholder="e.g. A family trip to Goa for 4 people in December, 3 nights" placeholderTextColor={colors.textDisabled}
                        multiline numberOfLines={4} textAlignVertical="top" maxLength={1000} accessibilityLabel="What you need"
                    />
                    {!!errors.details && <Text style={styles.error}>{errors.details}</Text>}

                    <Text style={styles.label}>Where are you? *</Text>
                    <TouchableOpacity style={[styles.address, !!errors.address && styles.inputError]} onPress={() => navigation.navigate('SavedAddresses', { fromCheckout: true, returnTo: 'ServiceEnquiry' })} accessibilityRole="button">
                        <MapPin size={20} color={accent} />
                        <View style={styles.flex}>
                            {address ? (
                                <>
                                    <Text style={styles.addressLabel}>{address.label}</Text>
                                    <Text style={styles.addressText} numberOfLines={2}>{address.address}</Text>
                                </>
                            ) : <Text style={styles.addressText}>Select address</Text>}
                        </View>
                    </TouchableOpacity>
                    {!!errors.address && <Text style={styles.error}>{errors.address}</Text>}

                    <Text style={styles.label}>When? <Text style={styles.optional}>(optional)</Text></Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                        {dates.map(d => (
                            <TouchableOpacity key={d.label} onPress={() => setDate(d.date)} style={[styles.chip, date === d.date && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: date === d.date }}>
                                <Text style={[styles.chipText, date === d.date && styles.chipTextOn]}>{d.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

                    <Text style={styles.label}>Budget <Text style={styles.optional}>(optional)</Text></Text>
                    <TextInput style={styles.input} value={budget} onChangeText={setBudget} placeholder="e.g. ₹40,000" placeholderTextColor={colors.textDisabled} maxLength={60} accessibilityLabel="Budget" />

                    <View style={styles.note}>
                        <ShieldCheck size={14} color={colors.accentDark} />
                        <Text style={styles.noteText}>Only the partner who takes your enquiry sees your number.</Text>
                    </View>
                    <Button title={BAND_META.referral.cta} onPress={submit} loading={sending} style={styles.submit} />
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
    back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary, flex: 1, textAlign: 'center' },
    content: { padding: spacing.base, paddingBottom: spacing['3xl'] },
    hero: { flexDirection: 'row', gap: spacing.md, padding: spacing.base, borderRadius: radii.xl, backgroundColor: colors.accentLight, marginBottom: spacing.lg },
    heroIcon: { width: 44, height: 44, borderRadius: radii.lg, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    heroKicker: { ...typography.small, color: colors.accentDark, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
    heroText: { ...typography.caption, color: colors.textPrimary, marginTop: 2 },
    label: { ...typography.bodySemibold, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
    optional: { ...typography.caption, color: colors.textTertiary, fontWeight: '400' },
    textArea: { minHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, ...typography.body, color: colors.textPrimary },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.body, color: colors.textPrimary },
    inputError: { borderColor: colors.error },
    error: { ...typography.caption, color: colors.error, marginTop: spacing.xs },
    address: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md },
    addressLabel: { ...typography.bodyMedium, color: colors.textPrimary },
    addressText: { ...typography.caption, color: colors.textSecondary },
    chips: { gap: spacing.sm, paddingVertical: spacing.xs },
    chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.background },
    chipOn: { borderColor: accent, backgroundColor: colors.accentLight },
    chipText: { ...typography.captionMedium, color: colors.textPrimary },
    chipTextOn: { color: colors.accentDark },
    note: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
    noteText: { ...typography.small, color: colors.textSecondary, flex: 1 },
    submit: { marginTop: spacing.lg, backgroundColor: accent },
});
