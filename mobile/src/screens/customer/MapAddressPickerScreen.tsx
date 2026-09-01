import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Text, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, FlatList, Keyboard, Platform,
    KeyboardAvoidingView, ScrollView, StatusBar,
} from 'react-native';
import MapView, { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Search, X, Navigation } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { customerApi, SavedAddress } from '../../api/customer.api';
import { queryKeys } from '../../hooks/useCustomerData';
import { Button } from '../../components/ui/Button';

// ── Google Places API key (same key used for Maps) ──
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface PlacePrediction {
    place_id: string;
    description: string;
    structured_formatting: {
        main_text: string;
        secondary_text: string;
    };
}

type ParamList = {
    MapAddressPicker: { editAddressIndex?: number; fromCheckout?: boolean; mode?: 'onboarding' | 'profile' };
};

const FALLBACK_COORDS = { latitude: 14.9637, longitude: 74.7094 }; // Yellapur

export function MapAddressPickerScreen() {
    const insets = useSafeAreaInsets();
    const queryClient = useQueryClient();
    const navigation = useNavigation<any>();
    const route = useRoute<RouteProp<ParamList, 'MapAddressPicker'>>();
    const fromCheckout = route.params?.fromCheckout;
    const mode = route.params?.mode;
    const isOnboarding = mode === 'onboarding' || mode === 'profile';

    const mapRef = useRef<MapView>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const geocodeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [region, setRegion] = useState<Region | null>(null);
    const [markerCoordinate, setMarkerCoordinate] = useState<{ latitude: number, longitude: number } | null>(null);
    const [addressText, setAddressText] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [label, setLabel] = useState('Home');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const centreRef = useRef<{ latitude: number; longitude: number } | null>(null);

    // Autocomplete state
    const [searchQuery, setSearchQuery] = useState('');
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    useEffect(() => {
        (async () => {
            const start = async () => {
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status !== 'granted') return null;
                    const pos = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    return {
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                    };
                } catch {
                    return null;
                }
            };

            const coords = (await start()) || FALLBACK_COORDS;
            const initRegion: Region = {
                latitude: coords.latitude,
                longitude: coords.longitude,
                latitudeDelta: 0.008,
                longitudeDelta: 0.008,
            };
            centreRef.current = coords;
            setRegion(initRegion);
            setMarkerCoordinate(coords);
            setLoading(false);
            await fetchAddress(coords.latitude, coords.longitude);
        })();

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current);
        };
    }, []);

    const fetchAddress = async (lat: number, lng: number) => {
        try {
            const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            if (geo) {
                const parts = [
                    geo.name,
                    geo.street,
                    geo.district,
                    geo.city,
                    geo.region,
                ].filter(Boolean);
                const fullAddress = parts.join(', ');
                if (fullAddress) setAddressText(fullAddress);
                if (geo.postalCode) setPostalCode(geo.postalCode.replace(/\s+/g, ''));
            }
        } catch (e) {
            console.warn('[MAP_PICKER] Reverse geocode failed:', e);
        }
    };

    const handleRegionSettled = (r: Region) => {
        setIsMoving(false);
        const next = { latitude: r.latitude, longitude: r.longitude };
        centreRef.current = next;
        setMarkerCoordinate(next);

        if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current);
        geocodeDebounce.current = setTimeout(() => {
            fetchAddress(r.latitude, r.longitude);
        }, 250);
    };

    const recentreOnUser = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission needed', 'Enable location permissions to find your position.');
                return;
            }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const target: Region = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                latitudeDelta: 0.008,
                longitudeDelta: 0.008,
            };
            centreRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setMarkerCoordinate(centreRef.current);
            mapRef.current?.animateToRegion(target, 500);
            await fetchAddress(pos.coords.latitude, pos.coords.longitude);
        } catch {
            Alert.alert('Could not locate', 'Make sure GPS is turned on and try again.');
        }
    };

    const fetchPredictions = useCallback(async (input: string) => {
        if (input.length < 3) {
            setPredictions([]);
            setShowSuggestions(false);
            return;
        }

        setIsFetchingSuggestions(true);
        try {
            const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${GOOGLE_API_KEY}&components=country:in&language=en`;
            const response = await fetch(url);
            const json = await response.json();

            if (json.status === 'OK' && json.predictions?.length > 0) {
                setPredictions(json.predictions.slice(0, 5));
                setShowSuggestions(true);
            } else {
                setPredictions([]);
                setShowSuggestions(false);
            }
        } catch (error) {
            console.error('[MAP_PICKER] Places autocomplete error:', error);
            setPredictions([]);
        } finally {
            setIsFetchingSuggestions(false);
        }
    }, []);

    const onSearchTextChange = (text: string) => {
        setSearchQuery(text);

        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (text.length < 3) {
            setPredictions([]);
            setShowSuggestions(false);
            return;
        }

        debounceRef.current = setTimeout(() => {
            fetchPredictions(text);
        }, 350);
    };

    const selectPrediction = async (prediction: PlacePrediction) => {
        Keyboard.dismiss();
        setSearchQuery(prediction.description);
        setShowSuggestions(false);
        setPredictions([]);

        try {
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,formatted_address,address_components&key=${GOOGLE_API_KEY}`;
            const response = await fetch(url);
            const json = await response.json();

            if (json.status === 'OK' && json.result?.geometry?.location) {
                const { lat, lng } = json.result.geometry.location;
                const newRegion: Region = {
                    latitude: lat,
                    longitude: lng,
                    latitudeDelta: 0.008,
                    longitudeDelta: 0.008,
                };
                centreRef.current = { latitude: lat, longitude: lng };
                setMarkerCoordinate(centreRef.current);
                mapRef.current?.animateToRegion(newRegion, 800);

                const components = json.result.address_components || [];
                const postalComponent = components.find((c: any) => c.types?.includes('postal_code'));
                setAddressText(json.result.formatted_address || prediction.description);
                if (postalComponent) {
                    setPostalCode(postalComponent.long_name.replace(/\s+/g, ''));
                } else {
                    await fetchAddress(lat, lng);
                }
            }
        } catch (error) {
            console.error('[MAP_PICKER] Place details error:', error);
            Alert.alert('Error', 'Could not resolve location details.');
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setPredictions([]);
        setShowSuggestions(false);
    };

    const handleSave = async () => {
        const coords = centreRef.current || markerCoordinate;
        if (!coords || !addressText.trim()) {
            Alert.alert('Incomplete Address', 'Please select a location on the map and check the address line.');
            return;
        }

        setSaving(true);
        try {
            const newAddress: SavedAddress = {
                label,
                address: addressText.trim(),
                lat: coords.latitude,
                long: coords.longitude,
                pinCode: postalCode.trim() || undefined,
            };

            if (isOnboarding) {
                await customerApi.updateProfile({
                    homeAddress: addressText.trim(),
                    pinCode: postalCode.trim() || undefined,
                    savedAddresses: [newAddress],
                });
                await useAuthStore.getState().refreshOnboardingStatus();
            } else {
                const profileRes = await customerApi.getProfile();
                const existing: SavedAddress[] = profileRes.data?.savedAddresses || [];
                const editIdx = route.params?.editAddressIndex;

                let updated: SavedAddress[];
                if (typeof editIdx === 'number' && editIdx >= 0 && editIdx < existing.length) {
                    updated = [...existing];
                    updated[editIdx] = newAddress;
                } else {
                    updated = [...existing, newAddress];
                }

                await customerApi.updateProfile({
                    savedAddresses: updated,
                    ...(existing.length === 0 ? { homeAddress: newAddress.address, pinCode: newAddress.pinCode } : {}),
                });
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.profile });

            if (fromCheckout) {
                navigation.navigate('ServiceRequest', { selectedAddress: newAddress });
            } else {
                navigation.goBack();
            }
        } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not save address. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

            {/* Map Area */}
            <View style={styles.mapWrap}>
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    initialRegion={region || undefined}
                    onRegionChange={() => { if (!isMoving) setIsMoving(true); }}
                    onRegionChangeComplete={handleRegionSettled}
                    showsUserLocation
                    showsMyLocationButton={false}
                />

                {/* Center Pin Marker */}
                <View style={styles.pinWrap} pointerEvents="none">
                    <MapPin
                        size={40}
                        color={colors.primary}
                        fill={colors.primary}
                        strokeWidth={1.5}
                        style={{ transform: [{ translateY: isMoving ? -8 : 0 }] }}
                    />
                    <View style={styles.pinDot} />
                </View>

                {/* Locate Me FAB */}
                <TouchableOpacity
                    style={styles.locateBtn}
                    onPress={recentreOnUser}
                    activeOpacity={0.8}
                >
                    <Navigation size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {/* Unified Floating Search Bar */}
            <View style={[styles.floatingHeader, { top: insets.top + spacing.sm }]}>
                <View style={styles.searchCard}>
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={styles.backBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel="Go back"
                    >
                        <ArrowLeft size={22} color={colors.textPrimary} />
                    </TouchableOpacity>

                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search area, landmark, or city..."
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={onSearchTextChange}
                        returnKeyType="search"
                        autoCorrect={false}
                    />

                    {isFetchingSuggestions && (
                        <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.xs }} />
                    )}

                    {searchQuery.length > 0 && !isFetchingSuggestions && (
                        <TouchableOpacity
                            onPress={clearSearch}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            style={styles.clearBtn}
                        >
                            <X size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Suggestions Dropdown */}
                {showSuggestions && predictions.length > 0 && (
                    <View style={styles.suggestionsContainer}>
                        <FlatList
                            data={predictions}
                            keyExtractor={(item) => item.place_id}
                            keyboardShouldPersistTaps="handled"
                            scrollEnabled={false}
                            renderItem={({ item, index }) => (
                                <TouchableOpacity
                                    style={[
                                        styles.suggestionItem,
                                        index === predictions.length - 1 && styles.suggestionItemLast,
                                    ]}
                                    onPress={() => selectPrediction(item)}
                                    activeOpacity={0.6}
                                >
                                    <MapPin size={16} color={colors.primary} style={{ marginTop: 2 }} />
                                    <View style={styles.suggestionTextWrap}>
                                        <Text style={styles.suggestionMainText} numberOfLines={1}>
                                            {item.structured_formatting.main_text}
                                        </Text>
                                        <Text style={styles.suggestionSecondaryText} numberOfLines={1}>
                                            {item.structured_formatting.secondary_text}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                )}
            </View>

            {/* Bottom Sheet */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.sheetWrap}
            >
                <ScrollView
                    style={styles.bottomSheet}
                    contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    <View style={styles.sheetHandle} />

                    <Text style={styles.labelTitle}>Save As</Text>
                    <View style={styles.labelRow}>
                        {['Home', 'Work', 'Other'].map((l) => (
                            <TouchableOpacity
                                key={l}
                                style={[styles.labelChip, label === l && styles.labelChipActive]}
                                onPress={() => setLabel(l)}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.labelChipText, label === l && styles.labelChipTextActive]}>{l}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <View style={styles.addressHeader}>
                        <Text style={styles.labelTitle}>Address</Text>
                        {isMoving && (
                            <View style={styles.locatingRow}>
                                <ActivityIndicator size="small" color={colors.primary} />
                                <Text style={styles.locatingText}>Locating…</Text>
                            </View>
                        )}
                    </View>
                    <View style={styles.addressInputContainer}>
                        <MapPin size={20} color={colors.primary} style={styles.addressIcon} />
                        <TextInput
                            style={styles.addressInput}
                            value={addressText}
                            onChangeText={setAddressText}
                            multiline
                            placeholder="Street, locality, building name..."
                            placeholderTextColor={colors.textSecondary}
                        />
                    </View>

                    <Button
                        title="Save Address"
                        onPress={handleSave}
                        loading={saving}
                        disabled={isMoving || !addressText.trim()}
                        fullWidth
                        style={{ marginTop: spacing.lg }}
                    />
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

    // ── Unified Floating Header ──
    floatingHeader: {
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 30,
    },
    searchCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        paddingHorizontal: spacing.md,
        height: 52,
        ...shadows.lg,
        borderWidth: Platform.OS === 'ios' ? 1 : 0,
        borderColor: colors.border,
    },
    backBtn: {
        padding: spacing.xs,
        marginRight: spacing.xs,
    },
    searchInput: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
        height: '100%',
        paddingVertical: 0,
    },
    clearBtn: {
        padding: spacing.xs,
    },
    suggestionsContainer: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        marginTop: spacing.xs,
        overflow: 'hidden',
        ...shadows.xl,
        borderWidth: 1,
        borderColor: colors.border,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        gap: spacing.sm,
    },
    suggestionItemLast: {
        borderBottomWidth: 0,
    },
    suggestionTextWrap: {
        flex: 1,
    },
    suggestionMainText: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    suggestionSecondaryText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },

    // ── Map & Pin ──
    mapWrap: { flex: 1 },
    map: { ...StyleSheet.absoluteFillObject },
    pinWrap: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40,
    },
    pinDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors.primary,
        borderWidth: 1.5, borderColor: '#fff',
        marginTop: -4,
    },
    locateBtn: {
        position: 'absolute',
        right: spacing.lg,
        bottom: spacing.lg,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.lg,
        zIndex: 20,
    },

    // ── Bottom Sheet ──
    sheetWrap: { maxHeight: '55%', zIndex: 25 },
    bottomSheet: {
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.md,
        borderTopLeftRadius: radii['2xl'],
        borderTopRightRadius: radii['2xl'],
        ...shadows.xl,
    },
    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
        alignSelf: 'center',
        marginBottom: spacing.sm,
    },
    addressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    locatingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    locatingText: { ...typography.caption, color: colors.primary },
    labelTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
    labelRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
    labelChip: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radii.full,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    labelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    labelChipText: { color: colors.textSecondary, fontWeight: '500', fontSize: 13 },
    labelChipTextActive: { color: '#fff' },
    addressInputContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        marginTop: spacing.xs,
    },
    addressIcon: { marginRight: spacing.sm, marginTop: 2 },
    addressInput: { flex: 1, color: colors.textPrimary, fontSize: 14, minHeight: 44, textAlignVertical: 'top' },
});
