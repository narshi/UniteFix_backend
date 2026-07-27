/**
 * Onboarding — Step 1: Profile details
 *
 * Mandatory for every new account. Truecaller supplies a name (and sometimes an
 * email) which is prefilled here for confirmation; OTP signups arrive with the
 * name they typed. Either way the value is written to the server before moving
 * on, so quitting the app does not lose it.
 */

import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { User, Mail, AlertCircle } from 'lucide-react-native';
import { OnboardingStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { customerApi } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';
import { OnboardingProgress } from './OnboardingProgress';

type Nav = NativeStackNavigationProp<OnboardingStackParamList>;

export function OnboardingProfileScreen() {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const navigation = useNavigation<Nav>();
    const { user, refreshOnboardingStatus } = useAuthStore();

    const isTechnician = user?.role === 'serviceman';

    const [fullName, setFullName] = useState(user?.username ?? '');
    const [email, setEmail] = useState(user?.email ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Prefill once the hydrated user lands.
    useEffect(() => {
        if (user?.username && !fullName) setFullName(user.username);
        if (user?.email && !email) setEmail(user.email);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.username, user?.email]);

    const handleContinue = async () => {
        if (!fullName.trim()) {
            setError('Please enter your full name');
            return;
        }
        if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError('Please enter a valid email address');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await customerApi.updateProfile({
                username: fullName.trim(),
                ...(email.trim() ? { email: email.trim() } : {}),
            });
            await refreshOnboardingStatus();
            navigation.navigate('OnboardingLocation');
        } catch (err) {
            setError(getApiErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    if (!user) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: headerTop, paddingBottom: bottomPad + spacing['3xl'] },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <OnboardingProgress current="profile" isTechnician={isTechnician} />

                <View style={styles.iconWrap}>
                    <User size={28} color={colors.primary} strokeWidth={2.2} />
                </View>

                <Text style={styles.title}>Tell us about you</Text>
                <Text style={styles.subtitle}>
                    We use your name so technicians know who they are meeting.
                </Text>

                <View style={styles.form}>
                    <Input
                        label="Full Name *"
                        value={fullName}
                        onChangeText={(t: string) => { setFullName(t); setError(null); }}
                        placeholder="e.g. Ravi Kumar"
                        icon={<User size={18} color={colors.textSecondary} />}
                    />

                    <Input
                        label="Email Address"
                        value={email}
                        onChangeText={(t: string) => { setEmail(t); setError(null); }}
                        placeholder="you@example.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        icon={<Mail size={18} color={colors.textSecondary} />}
                    />
                    <Text style={styles.hint}>
                        Used for invoices and booking receipts.
                    </Text>
                </View>

                {error && (
                    <View style={styles.errorBox}>
                        <AlertCircle size={16} color={colors.error} />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                <Button
                    title="Continue"
                    onPress={handleContinue}
                    loading={saving}
                    disabled={!fullName.trim() || saving}
                    style={{ marginTop: spacing.xl }}
                />
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.xl, flexGrow: 1 },
    iconWrap: {
        width: 56,
        height: 56,
        borderRadius: radii.xl,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.xl,
        marginBottom: spacing.lg,
    },
    title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing['2xl'] },
    form: { gap: spacing.lg },
    hint: { ...typography.small, color: colors.textDisabled, marginTop: -spacing.md },
    errorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.errorLight,
        borderRadius: radii.md,
        padding: spacing.md,
        marginTop: spacing.lg,
    },
    errorText: { ...typography.caption, color: colors.error, flex: 1 },
});
