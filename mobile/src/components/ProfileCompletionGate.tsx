/**
 * Blocks the home screen until the account has an address and pin code.
 *
 * WHY THIS EXISTS
 * Onboarding makes location mandatory, but accounts created before that gate —
 * and anyone who got through by denying the location permission — are sitting
 * with a blank home_address / pin_code. Nothing works for them and nothing says
 * why: serviceability is decided by pin code, and the partner geofence compares
 * the technician's GPS against the booking address.
 *
 * Deliberately NOT dismissable by tapping outside or the Android back button.
 * A soft banner is ignorable, and the account genuinely cannot be served in this
 * state, so the prompt has to be the thing standing in front of the screen. The
 * one way out is the button that goes and fixes it.
 *
 * For a service expert the field is their BASE LOCATION — where they work from,
 * which decides which jobs reach them — not a delivery address, so it is named
 * that way throughout.
 */

import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { MapPinOff } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, radii, shadows } from '../theme/spacing';

interface Props {
    /** Whether the profile is missing an address or pin code. */
    visible: boolean;
    /** Service experts get base-location wording; customers get address wording. */
    isExpert?: boolean;
    /** What is actually missing, so the copy can name it. */
    missingAddress?: boolean;
    missingPinCode?: boolean;
}

export function ProfileCompletionGate({
    visible,
    isExpert = false,
    missingAddress = true,
    missingPinCode = true,
}: Props) {
    const navigation = useNavigation<any>();

    const addressWord = isExpert ? 'address (base location)' : 'address';

    const what = missingAddress && missingPinCode
        ? `your ${addressWord} and pin code`
        : missingAddress
            ? `your ${addressWord}`
            : 'your pin code';

    const goToProfile = () => {
        // Both stacks register the profile tab under the same name, so one call
        // works for either role.
        navigation.navigate('ProfileTab');
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            // No-op: the prompt must not be dismissable with the hardware back
            // button, or the state it describes simply persists unexplained.
            onRequestClose={() => { }}
        >
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.iconWrap}>
                        <MapPinOff size={28} color={colors.warning} strokeWidth={2.2} />
                    </View>

                    <Text style={styles.title}>Update your profile to get services</Text>

                    <Text style={styles.body}>
                        We still need {what}.{' '}
                        {isExpert
                            ? 'Your base location decides which jobs reach you — without it you will not be assigned any work.'
                            : 'We use it to check that we serve your area and to send a technician to the right place.'}
                    </Text>

                    <Pressable style={styles.button} onPress={goToProfile}>
                        <Text style={styles.buttonText}>Update Profile</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

/** Is anything required for service missing? Blank-safe for null and whitespace. */
export function isProfileIncomplete(profile: { homeAddress?: string | null; pinCode?: string | null } | null | undefined) {
    const missingAddress = !profile?.homeAddress || !String(profile.homeAddress).trim();
    const missingPinCode = !profile?.pinCode || !String(profile.pinCode).trim();
    return { missingAddress, missingPinCode, incomplete: missingAddress || missingPinCode };
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
    },
    card: {
        width: '100%',
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.xl,
        alignItems: 'center',
        ...shadows.md,
    },
    iconWrap: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: colors.warningLight,
        justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        ...typography.h4,
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: spacing.sm,
    },
    body: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 21,
        marginBottom: spacing.xl,
    },
    button: {
        width: '100%',
        backgroundColor: colors.primary,
        borderRadius: radii.lg,
        paddingVertical: spacing.md,
        alignItems: 'center',
    },
    buttonText: {
        ...typography.bodyMedium,
        color: colors.textInverse,
    },
});
