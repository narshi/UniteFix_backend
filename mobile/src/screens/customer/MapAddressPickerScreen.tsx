import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Text, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, FlatList, Keyboard, Platform,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ArrowLeft, MapPin, Search, X, Navigation } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { customerApi, SavedAddress } from '../../api/customer.api';
import { Button } from '../../components/ui/Button';

// ── Google Places API key (same key used for Maps) ──
const GOOGLE_API_KEY = 'AIzaSyBxKpV_-RjLz8B8NrKYSU6xs2O2gOMI4VU';

interface PlacePrediction {
    place_id: string;
    description: string;
    structured_formatting: {
        main_text: string;
        secondary_text: string;
    };
}

type ParamList = {
    MapAddressPicker: { editAddressIndex?: number };
};

export function MapAddressPickerScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<RouteProp<ParamList, 'MapAddressPicker'>>();

    const mapRef = useRef<MapView>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [region, setRegion] = useState<Region | null>(null);
    const [markerCoordinate, setMarkerCoordinate] = useState<{ latitude: number, longitude: number } | null>(null);
    const [addressText, setAddressText] = useState('');
    const [label, setLabel] = useState('Home');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Autocomplete state
    const [searchQuery, setSearchQuery] = useState('');
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission to access location was denied');
                setLoading(false);
                return;
            }

            let location = await Location.getCurrentPositionAsync({});
            const initialCoords = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            };
            setRegion({
                ...initialCoords,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            });
            setMarkerCoordinate(initialCoords);
            reverseGeocode(initialCoords.latitude, initialCoords.longitude);
            setLoading(false);
        })();
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
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
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,formatted_address&key=${GOOGLE_API_KEY}`;
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
                mapRef.current?.animateToRegion(newRegion, 1000);
                setAddressText(json.result.formatted_address || prediction.description);
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

    const handleMapPress = (e: any) => {
        const coords = e.nativeEvent.coordinate;
        setMarkerCoordinate(coords);
        reverseGeocode(coords.latitude, coords.longitude);
    };

    const handleSave = async () => {
        if (!markerCoordinate || !addressText.trim()) {
            Alert.alert('Please select a valid location');
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
            };

            const updatedAddresses = [...existingAddresses, newAddress];

            await customerApi.updateProfile({ savedAddresses: updatedAddresses });
            Alert.alert('Success', 'Address saved successfully!', [
                { text: 'OK', onPress: () => navigation.goBack() }
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

            <MapView
                ref={mapRef}
                style={styles.map}
                region={region || undefined}
                onPress={handleMapPress}
                showsUserLocation
            >
                {markerCoordinate && (
                    <Marker coordinate={markerCoordinate} />
                )}
            </MapView>

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

                <Text style={styles.labelTitle}>Address</Text>
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

    map: { flex: 1 },
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
