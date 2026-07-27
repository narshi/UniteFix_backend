/**
 * Onboarding — Step 2: Location
 *
 * Mandatory for every new account. Nothing in the product works without it:
 * serviceability is decided by pincode, and the partner geofence compares the
 * technician's GPS against the booking address.
 *
 * The address is saved to the user profile AND appended to savedAddresses so it
 * is immediately selectable in the booking flow, which otherwise starts empty.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { MapPin, Navigation, AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { OnboardingStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { customerApi, SavedAddress } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';
import { OnboardingProgress } from './OnboardingProgress';

type Nav = NativeStackNavigationProp<OnboardingStackParamList>;

export function OnboardingLocationScreen() {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const navigation = useNavigation<Nav>();
    const { user, refreshOnboardingStatus } = useAuthStore();

    const isTechnician = user?.role === 'serviceman';

    const [address, setAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [coords, setCoords] = useState<{ lat: number; long: number } | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serviceable, setServiceable] = useState<boolean | null>(null);

    const handleDetectLocation = async () => {
        setDetecting(true);
        setError(null);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setError('Location permission denied. You can type your address instead.');
                return;
            }

            const position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
            setCoords({ lat: position.coords.latitude, long: position.coords.longitude });

            const [place] = await Location.reverseGeocodeAsync(position.coords);
            if (place) {
                const line = [place.name, place.street, place.district, place.city, place.region]
                    .filter(Boolean)
                    .join(', ');
                if (line) setAddress(line);
                if (place.postalCode) setPinCode(place.postalCode);
            }
        } catch {
            setError('Could not detect your location. Please enter it manually.');
        } finally {
            setDetecting(false);
        }
    };

    /** Serviceability is advisory here — we still store the address. */
    const checkServiceability = async (pin: string) => {
        if (!/^\d{6}$/.test(pin)) {
            setServiceable(null);
            return;
        }
        try {
            const res = await customerApi.validatePincode(pin);
            setServiceable(res.data?.available ?? res.data?.serviceable ?? null);
        } catch {
            setServiceable(null);
        }
    };

    const handleContinue = async () => {
        if (!address.trim()) {
            setError('Please enter your address');
            return;
        }
        if (!/^\d{6}$/.test(pinCode.trim())) {
            setError('Pin code must be exactly 6 digits');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            // Seed savedAddresses so the booking flow has something to select.
            const savedAddress: SavedAddress = {
                label: 'Home',
                address: address.trim(),
                lat: coords?.lat ?? 0,
                long: coords?.long ?? 0,
                pinCode: pinCode.trim(),
            };

            await customerApi.updateProfile({
                homeAddress: address.trim(),
                pinCode: pinCode.trim(),
                savedAddresses: [savedAddress],
            });

            await refreshOnboardingStatus();

            if (isTechnician) {
                navigation.navigate('ExpertiseSelection');
            }
            // Customers are done — RootNavigator swaps to the customer app as
            // soon as refreshOnboardingStatus() reports completion.
        } catch (err) {
            setError(getApiErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

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
                <OnboardingProgress current="location" isTechnician={isTechnician} />

                <View style={styles.iconWrap}>
                    <MapPin size={28} color={colors.primary} strokeWidth={2.2} />
                </View>

                <Text style={styles.title}>Where are you located?</Text>
                <Text style={styles.subtitle}>
                    {isTechnician
                        ? 'We use this to match you with nearby jobs.'
                        : 'We use this to find technicians near you.'}
                </Text>

                <Pressable
                    style={styles.detectBtn}
                    onPress={handleDetectLocation}
                    disabled={detecting}
                >
                    {detecting ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                        <Navigation size={18} color={colors.primary} strokeWidth={2.2} />
                    )}
                    <Text style={styles.detectText}>
                        {detecting ? 'Detecting…' : 'Use my current location'}
                    </Text>
                </Pressable>

                <View style={styles.form}>
                    <Input
                        label="Address *"
                        value={address}
                        onChangeText={(t: string) => { setAddress(t); setError(null); }}
                        placeholder="House / street / landmark"
                        multiline
                        icon={<MapPin size={18} color={colors.textSecondary} />}
                    />

                    <Input
                        label="Pin Code *"
                        value={pinCode}
                        onChangeText={(t: string) => {
                            const digits = t.replace(/[^0-9]/g, '').slice(0, 6);
                            setPinCode(digits);
                            setError(null);
                            checkServiceability(digits);
                        }}
                        placeholder="581301"
                        keyboardType="number-pad"
                        maxLength={6}
                    />

                    {serviceable === true && (
                        <View style={styles.okBox}>
                            <CheckCircle2 size={16} color={colors.success} />
                            <Text style={styles.okText}>We service this area.</Text>
                        </View>
                    )}
                    {serviceable === false && (
                        <View style={styles.warnBox}>
                            <AlertCircle size={16} color={colors.warningDark} />
                            <Text style={styles.warnText}>
                                We are not live in this pincode yet. You can still finish setup —
                                we will notify you when we launch here.
                            </Text>
                        </View>
                    )}
                </View>

                {error && (
                    <View style={styles.errorBox}>
                        <AlertCircle size={16} color={colors.error} />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                <Button
                    title={isTechnician ? 'Continue' : 'Finish Setup'}
                    onPress={handleContinue}
                    loading={saving}
                    disabled={!address.trim() || pinCode.length !== 6 || saving}
                    style={{ marginTop: spacing.xl }}
                />
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
    detectBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: radii.lg,
        borderWidth: 1.5,
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
        marginBottom: spacing.xl,
    },
    detectText: { ...typography.bodySemibold, color: colors.primary },
    form: { gap: spacing.lg },
    okBox: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.successLight, borderRadius: radii.md, padding: spacing.md,
    },
    okText: { ...typography.caption, color: colors.successDark, flex: 1 },
    warnBox: {
        flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
        backgroundColor: colors.warningLight, borderRadius: radii.md, padding: spacing.md,
    },
    warnText: { ...typography.caption, color: colors.warningDark, flex: 1, lineHeight: 18 },
    errorBox: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.errorLight, borderRadius: radii.md,
        padding: spacing.md, marginTop: spacing.lg,
    },
    errorText: { ...typography.caption, color: colors.error, flex: 1 },
});
