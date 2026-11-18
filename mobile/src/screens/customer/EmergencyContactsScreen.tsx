/**
 * Emergency contacts: up to two people who get your live location when you
 * press SOS (the text goes from your own phone, so it always arrives).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldAlert, X, Plus } from 'lucide-react-native';
import { safetyApi, type EmergencyContact } from '../../api/safety.api';
import { getApiErrorMessage } from '../../api/client';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

export function EmergencyContactsScreen({ navigation }: any) {
    const { t } = useTranslation();
    const [list, setList] = useState<EmergencyContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    useEffect(() => { safetyApi.contacts().then(c => setList(c.length ? c : [{ name: '', phone: '' }])).catch(() => setList([{ name: '', phone: '' }])).finally(() => setLoading(false)); }, []);
    const valid = list.every(c => (!c.name.trim() && !c.phone.trim()) || (c.name.trim() && /^[6-9]\d{9}$/.test(c.phone.replace(/\D/g, '').slice(-10))));
    const save = async () => {
        setSaving(true);
        try {
            await safetyApi.saveContacts(list.filter(c => c.name.trim() && c.phone.trim()).map(c => ({ name: c.name.trim(), phone: c.phone.replace(/\D/g, '').slice(-10) })));
            Alert.alert(t('safety.saved', 'Saved'), t('safety.saved_body', 'They will get your live location if you press SOS.'));
            navigation.goBack();
        } catch (e) { Alert.alert(t('safety.not_saved', 'Not saved'), getApiErrorMessage(e)); }
        finally { setSaving(false); }
    };
    return (
        <SafeAreaView style={s.container} edges={['top']}>
            <View style={s.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel={t('common.back', 'Back')}><ArrowLeft size={22} color={brand.text} /></Pressable>
                <Text style={s.title}>{t('safety.contacts_title', 'Emergency contacts')}</Text>
            </View>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
                    <View style={s.intro}><ShieldAlert size={20} color="#D92D20" /><Text style={s.introText}>{t('safety.contacts_intro', 'If you press SOS on a trip or during a service visit, you can text these people your live location in one tap.')}</Text></View>
                    {loading ? <ActivityIndicator color={brand.navy} /> : list.map((c, i) => (
                        <View key={i} style={s.card}>
                            <View style={s.cardHead}><Text style={s.label}>{t('safety.contact_n', 'Contact {{n}}', { n: i + 1 })}</Text>
                                <Pressable onPress={() => setList(list.length > 1 ? list.filter((_, j) => j !== i) : [{ name: '', phone: '' }])} hitSlop={8} accessibilityLabel={t('travel.remove', 'Remove')}><X size={18} color={brand.textSecondary} /></Pressable></View>
                            <TextInput style={s.input} value={c.name} onChangeText={v => setList(list.map((x, j) => (j === i ? { ...x, name: v } : x)))} placeholder={t('safety.contact_name', 'Name (e.g. Amma)')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('safety.contact_name', 'Name')} />
                            <TextInput style={s.input} value={c.phone} onChangeText={v => setList(list.map((x, j) => (j === i ? { ...x, phone: v.replace(/[^\d+ ]/g, '') } : x)))} keyboardType="phone-pad" placeholder={t('safety.contact_phone', 'Mobile number')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('safety.contact_phone', 'Mobile number')} />
                        </View>
                    ))}
                    {!loading && list.length < 2 && <Pressable onPress={() => setList([...list, { name: '', phone: '' }])} style={s.add}><Plus size={16} color={brand.navy} /><Text style={s.addText}>{t('safety.add_second', 'Add a second person')}</Text></Pressable>}
                    <Pressable onPress={save} disabled={!valid || saving || loading} style={[s.primary, (!valid || saving) && { opacity: 0.4 }]} accessibilityRole="button">
                        {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t('common.save', 'Save')}</Text>}
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: brand.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
    title: { fontSize: 19, fontWeight: '800', color: brand.text },
    body: { padding: spacing.base, gap: spacing.md },
    intro: { flexDirection: 'row', gap: 10, backgroundColor: '#FEE4E2', borderRadius: radii.lg, padding: spacing.md },
    introText: { flex: 1, color: '#7A271A', fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base, gap: spacing.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    label: { fontSize: 13, fontWeight: '700', color: brand.text },
    input: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: brand.text },
    add: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
    addText: { color: brand.navy, fontWeight: '700' },
    primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: brand.navy, borderRadius: radii.full, paddingVertical: 14, marginTop: spacing.sm },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
