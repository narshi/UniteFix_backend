/**
 * About UniteFix — who we are, what the app does, how to reach us, and the
 * exact app version (what support asks for first when something goes wrong).
 * Shared by the customer, expert and business partner apps.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Wrench, Router, ShoppingBag, Sparkles, Phone, Mail, Globe, Shield, ChevronRight, BadgeCheck, Clock, Home } from 'lucide-react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ui';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, radii, shadows } from '../theme/spacing';
import { useScreenInsets } from '../theme/layout';
import { useAuthStore } from '../stores/auth.store';

type Props = NativeStackScreenProps<any, 'About'>;

const SUPPORT_PHONE = '+91 94488 50679';
const SUPPORT_EMAIL = 'support@unitefix.com';
const WEBSITE = 'https://unitefix.com';

/** "1.0.29 (30)" from the installed build; the app config when running in development. */
export function appVersion() {
    const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
    const build = Application.nativeBuildVersion ?? (Platform.OS === 'android' ? String((Constants.expoConfig as any)?.android?.versionCode ?? '') : (Constants.expoConfig as any)?.ios?.buildNumber ?? '');
    return { version, build: build || null, label: build ? `${version} (${build})` : version };
}

export function AboutScreen({ navigation }: Props) {
    const { scrollBottom } = useScreenInsets();
    const role = useAuthStore((s) => s.user?.role);
    const isExpert = role === 'serviceman';
    const v = appVersion();
    const open = (url: string) => Linking.openURL(url).catch(() => undefined);

    const offers = isExpert
        ? [
            { icon: Wrench, title: 'Jobs near you', text: 'Bookings in your trades and area, straight to your phone.' },
            { icon: BadgeCheck, title: 'Fixed, fair prices', text: 'The price is set before you arrive — no haggling at the door.' },
            { icon: Clock, title: 'Paid on time', text: 'Earnings to your UPI, with every rupee shown in your wallet.' },
        ]
        : [
            { icon: Wrench, title: 'Repairs & services', text: 'Verified experts for AC, electrical, plumbing, appliances, computers, CCTV and more.' },
            { icon: Router, title: 'Broadband', text: 'Recharge your fibre connection or ask for a new one.' },
            { icon: ShoppingBag, title: 'Shop', text: 'Electronics and spares, delivered.' },
            { icon: Sparkles, title: 'Celebrations', text: 'Halls, photographers and event planners for your big day.' },
        ];

    return (
        <View style={styles.screen}>
            <ScreenHeader title="About UniteFix" onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]} showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                    <Image source={require('../../assets/icon_trimmed.png')} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
                    <Text style={styles.brand}>UniteFix</Text>
                    <Text style={styles.tagline}>Delivering excellence at your doorstep</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Who we are</Text>
                    <Text style={styles.body}>
                        UniteFix is built on true service: relationships with our customers that are honest and good for both sides. We keep you informed at every step, so working with us feels like working with family.
                    </Text>
                    <Text style={[styles.body, styles.gap]}>
                        For over ten years we have brought expert home and office services to your doorstep. The UniteFix app brings that same care online — trained, verified professionals, clear prices and safe payments, in one place.
                    </Text>
                    <View style={styles.stats}>
                        <Stat icon={<Clock size={18} color={colors.primary} />} value="10+ years" label="of service" />
                        <Stat icon={<BadgeCheck size={18} color={colors.primary} />} value="Verified" label="experts" />
                        <Stat icon={<Home size={18} color={colors.primary} />} value="Doorstep" label="service" />
                    </View>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>{isExpert ? 'Working with UniteFix' : 'What you can do here'}</Text>
                    {offers.map(({ icon: Icon, title, text }) => (
                        <View key={title} style={styles.offer}>
                            <View style={styles.offerIcon}><Icon size={18} color={colors.primary} /></View>
                            <View style={styles.grow}>
                                <Text style={styles.offerTitle}>{title}</Text>
                                <Text style={styles.offerText}>{text}</Text>
                            </View>
                        </View>
                    ))}
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Get in touch</Text>
                    <LinkRow icon={<Phone size={18} color={colors.primary} />} label={SUPPORT_PHONE} onPress={() => open(`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`)} />
                    <LinkRow icon={<Mail size={18} color={colors.primary} />} label={SUPPORT_EMAIL} onPress={() => open(`mailto:${SUPPORT_EMAIL}`)} />
                    <LinkRow icon={<Globe size={18} color={colors.primary} />} label="unitefix.com" onPress={() => open(WEBSITE)} />
                    <LinkRow icon={<Shield size={18} color={colors.primary} />} label="Terms, privacy & refunds" onPress={() => navigation.navigate('Legal')} last />
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>App version</Text>
                    <InfoRow label="Version" value={v.version} />
                    {v.build && <InfoRow label="Build" value={v.build} />}
                    <InfoRow label="Platform" value={`${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`} />
                    <InfoRow label="App ID" value={Application.applicationId ?? 'com.unitefix.app'} last />
                    <Text style={styles.hint}>Quote “{v.label}” when you contact support. Press and hold a value to copy it.</Text>
                </View>

                <Text style={styles.footer}>© {new Date().getFullYear()} Unitefix Services Private Limited</Text>
            </ScrollView>
        </View>
    );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
    return (
        <View style={styles.stat}>
            {icon}
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
            <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
        </View>
    );
}

function LinkRow({ icon, label, onPress, last }: { icon: React.ReactNode; label: string; onPress: () => void; last?: boolean }) {
    return (
        <TouchableOpacity style={[styles.row, !last && styles.rowBorder]} onPress={onPress} accessibilityRole="link" accessibilityLabel={label}>
            {icon}
            <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
            <ChevronRight size={18} color={colors.textSecondary} />
        </TouchableOpacity>
    );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <View style={[styles.row, !last && styles.rowBorder]}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue} selectable numberOfLines={1}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.lg, gap: spacing.md },
    hero: { alignItems: 'center', paddingVertical: spacing.lg },
    logo: { width: 72, height: 72, borderRadius: 18 },
    brand: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.sm },
    tagline: { ...typography.body, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
    card: { backgroundColor: colors.background, borderRadius: radii.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm },
    cardTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.sm },
    body: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
    gap: { marginTop: spacing.sm },
    stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingVertical: spacing.md, borderRadius: radii.lg, backgroundColor: colors.primarySurface },
    statValue: { ...typography.bodySemibold, color: colors.textPrimary },
    statLabel: { ...typography.caption, color: colors.textSecondary },
    offer: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
    offerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
    grow: { flex: 1, minWidth: 0 },
    offerTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    offerText: { ...typography.caption, color: colors.textSecondary, marginTop: 1, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
    rowLabel: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1, minWidth: 0 },
    infoLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
    infoValue: { ...typography.bodyMedium, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
    hint: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 18 },
    footer: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
});
