import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Text, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, FlatList, Keyboard, Platform,
} from 'react-native';
import MapView, { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
    // `fromCheckout` is forwarded by SavedAddressesScreen when the picker was
    // opened mid-booking, so the newly created address can be handed straight
    // back to ServiceRequest instead of being stranded one screen away.
    // `mode: 'onboarding'` is the permission-free route through the mandatory
    // location step. It writes homeAddress and pinCode on the PROFILE, not just
    // savedAddresses — onboarding completeness is derived from those two fields,
    // so saving only a saved-address would leave the account stuck on this step.
    MapAddressPicker: { editAddressIndex?: number; fromCheckout?: boolean; mode?: 'onboarding' | 'profile' };
};

/**
 * Where the map opens when the device will not say where it is: the middle of
 * the area we actually serve, rather than the null island the map defaults to.
 */
const FALLBACK_COORDS = { latitude: 14.9637, longitude: 74.7094 }; // Yellapur

export function MapAddressPickerScreen() {
    const queryClient = useQueryClient();
    const navigation = useNavigation<any>();
    const route = useRoute<RouteProp<ParamList, 'MapAddressPicker'>>();
    const fromCheckout = route.params?.fromCheckout;
    // Both modes set the PROFILE address, not merely a saved address:
    // onboarding cannot complete without homeAddress + pinCode, and the profile
    // screen offers this as the search/pick alternative to typing it by hand.
    const mode = route.params?.mode;
    const isOnboarding = mode === 'onboarding' || mode === 'profile';

    const mapRef = useRef<MapView>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Separate from the search debounce above; they fire independently. */
    const geocodeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [region, setRegion] = useState<Region | null>(null);
    const [markerCoordinate, setMarkerCoordinate] = useState<{ latitude: number, longitude: number } | null>(null);
    const [addressText, setAddressText] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [label, setLabel] = useState('Home');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // True while the map is moving under the pin, so the sheet can say
    // "Locating…" instead of showing the previous address as if it were current.
    const [isMoving, setIsMoving] = useState(false);
    // The centre the map settled on. Kept in a ref as well as state because
    // onRegionChangeComplete fires outside React's batching on Android.
    const centreRef = useRef<{ latitude: number; longitude: number } | null>(null);

    // Autocomplete state
    const [searchQuery, setSearchQuery] = useState('');
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    useEffect(() => {
        (async () => {
            /**
             * Start somewhere usable even without permission.
             *
             * This screen is the permission-free half of the mandatory location
             * step, so denying the prompt has to leave a working map. Previously
             * it showed an alert and left region null, which opened the map
             * zoomed out on the whole world with nothing to drag from - exactly
             * the user we most need to help.
             */
            const start = async () => {
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status !== 'granted') return null;
                    const pos = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                } catch {
                    return null;
                }
            };

            const coords = await start();
            const initialCoords = coords ?? FALLBACK_COORDS;

            setRegion({
                ...initialCoords,
                // Wider when we are guessing, so the user can see enough to
                // recognise where to drag to.
                latitudeDelta: coords ? 0.01 : 0.08,
                longitudeDelta: coords ? 0.01 : 0.08,
            });
            setMarkerCoordinate(initialCoords);
            centreRef.current = initialCoords;
            reverseGeocode(initialCoords.latitude, initialCoords.longitude);
            setLoading(false);
        })();
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current);
        };
    }, []);

    const reverseGeocode = async (lat: number, lng: number) => {
        try {
            const geocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            if (geocode.length > 0) {
                const place = geocode[0];
                const parts = [];
                if (place.name) parts.push(place.name);
                if (place.street) parts.push(place.street);
                if (place.city) parts.push(place.city);
                if (place.region) parts.push(place.region);
                if (place.postalCode) parts.push(place.postalCode);
                setAddressText(parts.join(', '));
                // Keep the postal code as a discrete field too — it was previously
                // only concatenated into the address string and then lost, so every
                // saved address had no pinCode and bookings fell back to '000000'.
                if (place.postalCode) setPostalCode(place.postalCode);
            }
        } catch (err) {
            console.log("Geocode error", err);
        }
    };

    // ── Google Places Autocomplete ──
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
            console.error('Places Autocomplete error:', error);
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
            // address_component is requested so the postal code can be stored as a
            // discrete field; picking from search previously left pinCode unset.
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,formatted_address,address_component&key=${GOOGLE_API_KEY}`;
            const response = await fetch(url);
            const json = await response.json();

            if (json.status === 'OK' && json.result?.geometry?.location) {
                const { lat, lng } = json.result.geometry.location;
                const newRegion: Region = {
                    latitude: lat,
                    longitude: lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                };
                setRegion(newRegion);
                setMarkerCoordinate({ latitude: lat, longitude: lng });
                centreRef.current = { latitude: lat, longitude: lng };
                // The map animates and settles under the same fixed pin, so the
                // search result and a manual drag end up in the same state.
                mapRef.current?.animateToRegion(newRegion, 600);
                // The formatted address from Places is better than our reverse
                // geocode, so suppress the settle-triggered lookup that follows.
                if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current);
                setAddressText(json.result.formatted_address || prediction.description);

                const postal = (json.result.address_components || []).find(
                    (c: any) => Array.isArray(c.types) && c.types.includes('postal_code'),
                );
                setPostalCode(postal?.long_name || '');
            }
        } catch (error) {
            console.error('Place Details error:', error);
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setPredictions([]);
        setShowSuggestions(false);
    };

    /**
     * The map stopped moving — whatever is under the centre pin is the choice.
     *
     * Debounced because a drag settles in bursts and every call is a geocode;
     * without it a single flick could fire several lookups and the last one to
     * return, not the last one requested, would win.
     */
    const handleRegionSettled = (next: Region) => {
        const centre = { latitude: next.latitude, longitude: next.longitude };
        centreRef.current = centre;
        setMarkerCoordinate(centre);
        setIsMoving(false);

        if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current);
        geocodeDebounce.current = setTimeout(() => {
            reverseGeocode(centre.latitude, centre.longitude);
        }, 350);
    };

    /** Back to the user's own position after dragging away. */
    const recentreOnUser = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Location permission denied', 'Drag the map to your location instead.');
                return;
            }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            mapRef.current?.animateToRegion({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 600);
            // onRegionChangeComplete picks the address up from here.
        } catch {
            Alert.alert('Could not find you', 'Drag the map to your location instead.');
        }
    };

    const handleSave = async () => {
        if (!markerCoordinate || !addressText.trim()) {
            Alert.alert('Please select a valid location');
            return;
        }

        // Onboarding cannot complete without a pin code — getPendingOnboardingSteps
        // requires both fields, so saving an address alone would loop the user
        // straight back to this step with no explanation.
        if (isOnboarding && !/^\d{6}$/.test(postalCode)) {
            Alert.alert(
                'Pin code not found',
                'We could not read a 6-digit pin code for that point. Move the pin closer to a road or building and try again.',
            );
            return;
        }

        setSaving(true);
        try {
            const profileRes = await customerApi.getProfile();
            const existingAddresses = profileRes.data.data.savedAddresses || [];

            const newAddress: SavedAddress = {
                label,
                address: addressText,
                lat: markerCoordinate.latitude,
                long: markerCoordinate.longitude,
                // Persist the pincode so bookings made from this address send the
                // real value instead of the '000000' placeholder.
                ...(postalCode ? { pinCode: postalCode } : {}),
            };

            const updatedAddresses = [...existingAddresses, newAddress];

            await customerApi.updateProfile({
                savedAddresses: updatedAddresses,
                // During onboarding this IS the profile address, not merely one
                // of several saved ones.
                ...(isOnboarding ? { homeAddress: addressText, pinCode: postalCode } : {}),
            });
            // This write bypasses the useUpdateProfile mutation, so nothing would
            // otherwise invalidate the cached profile that other screens read.
            queryClient.invalidateQueries({ queryKey: queryKeys.profile });

            if (isOnboarding) {
                // Let the onboarding stack re-evaluate what is still outstanding
                // rather than guessing the next screen from here.
                await useAuthStore.getState().refreshOnboardingStatus();
                setSaving(false);
                navigation.goBack();
                return;
            }

            Alert.alert('Success', 'Address saved successfully!', [
                {
                    text: 'OK',
                    onPress: () => {
                        // goBack() only returns to SavedAddresses, leaving the booking
                        // screen without the address the user just created — they had
                        // to find and tap it again. Hand it back directly instead.
                        // 'ServiceRequest' is the name registered in CustomerStack.
                        if (fromCheckout) {
                            navigation.navigate({
                                name: 'ServiceRequest',
                                params: { selectedAddress: newAddress },
                                merge: true,
                            });
                        } else {
                            navigation.goBack();
                        }
                    },
                },
            ]);
        } catch (error) {
            Alert.alert('Error', 'Failed to save address');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={24} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Select Location</Text>
                <View style={{ width: 24 }} />
            </View>

            {/*
              * The pin is FIXED at the centre of the screen and the map moves
              * underneath it — the pattern every delivery app uses. Tapping an
              * exact rooftop is fiddly on a phone; dragging the map is a coarse
              * gesture that lands accurately.
              *
              * initialRegion, NOT region. A controlled `region` prop re-centres
              * the map on every state update, which fights the user's own drag
              * and makes it stutter or snap back. Programmatic moves go through
              * animateToRegion instead.
              */}
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

                {/* pointerEvents none, or the pin would swallow the drag. */}
                <View style={styles.pinWrap} pointerEvents="none">
                    <MapPin
                        size={40}
                        color={colors.primary}
                        fill={colors.primary}
                        strokeWidth={1.5}
                        // Lifts while moving, so it reads as hovering over the map.
                        style={{ transform: [{ translateY: isMoving ? -8 : 0 }] }}
                    />
                    {/* Marks the exact point the pin refers to. */}
                    <View style={styles.pinDot} />
                </View>

                <TouchableOpacity style={styles.locateBtn} onPress={recentreOnUser}>
                    <Navigation size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {/* Search Bar + Autocomplete */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Search color={colors.textSecondary} size={20} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search area, landmark, or city..."
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={onSearchTextChange}
                        returnKeyType="search"
                        autoCorrect={false}
                    />
                    {isFetchingSuggestions && <ActivityIndicator size="small" color={colors.primary} />}
                    {searchQuery.length > 0 && !isFetchingSuggestions && (
                        <TouchableOpacity onPress={clearSearch} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <X size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    )}
                </View>

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

            <View style={styles.bottomSheet}>
                <Text style={styles.labelTitle}>Save As</Text>
                <View style={styles.labelRow}>
                    {['Home', 'Work', 'Other'].map((l) => (
                        <TouchableOpacity
                            key={l}
                            style={[styles.labelChip, label === l && styles.labelChipActive]}
                            onPress={() => setLabel(l)}
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
                    />
                </View>

                <Button
                    title="Save Address"
                    onPress={handleSave}
                    loading={saving}
                    disabled={isMoving || !addressText.trim()}
                    fullWidth
                    style={{ marginTop: 20 }}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        paddingTop: Platform.OS === 'ios' ? 56 : 50,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        ...shadows.sm,
        zIndex: 20,
    },
    backBtn: { padding: 4 },
    headerTitle: { ...typography.h4, color: colors.textPrimary },

    // ── Search + Autocomplete ──
    searchContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 130 : 110,
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 15,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        paddingHorizontal: spacing.md,
        height: 50,
        ...shadows.md,
    },
    searchInput: {
        flex: 1,
        marginLeft: spacing.sm,
        ...typography.body,
        color: colors.textPrimary,
    },
    suggestionsContainer: {
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        marginTop: spacing.xs,
        overflow: 'hidden',
        ...shadows.lg,
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

    mapWrap: { flex: 1 },
    addressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    locatingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    locatingText: { ...typography.caption, color: colors.primary },
    map: { ...StyleSheet.absoluteFillObject },
    pinWrap: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        // The pin's point sits at its bottom edge, so shift the icon up by half
        // its height to put that point exactly on the map centre.
        marginBottom: 40,
    },
    pinDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors.primary,
        borderWidth: 1.5, borderColor: '#fff',
        marginTop: -4,
    },
    locateBtn: {
        position: 'absolute', right: 16, bottom: 16,
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#fff',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 }, elevation: 4,
    },
    bottomSheet: {
        backgroundColor: colors.surface,
        padding: 20,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 10,
    },
    labelTitle: { ...typography.label, color: colors.textSecondary, marginBottom: 10, marginTop: 10 },
    labelRow: { flexDirection: 'row', gap: 10 },
    labelChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
    },
    labelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    labelChipText: { color: colors.textSecondary, fontWeight: '500' },
    labelChipTextActive: { color: '#fff' },
    addressInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    addressIcon: { marginRight: 10 },
    addressInput: { flex: 1, color: colors.textPrimary, fontSize: 14, minHeight: 40 },
});
