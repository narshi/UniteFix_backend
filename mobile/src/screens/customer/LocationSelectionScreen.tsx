import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, Keyboard, FlatList, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Region, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Search, MapPin, Check, Navigation, X } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { customerApi } from '../../api/customer.api';
import { useProfile } from '../../hooks/useCustomerData';

// ── Google Places API key (same key used for Maps) ──
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// ── Types ──
interface PlacePrediction {
    place_id: string;
    description: string;
    structured_formatting: {
        main_text: string;
        secondary_text: string;
    };
}

export function LocationSelectionScreen() {
    const navigation = useNavigation();
    const { refetch } = useProfile();
    const mapRef = useRef<MapView>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [region, setRegion] = useState<Region>({
        latitude: 20.5937,
        longitude: 78.9629,
        latitudeDelta: 10,
        longitudeDelta: 10,
    });
    const [selectedLocation, setSelectedLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentAddress, setCurrentAddress] = useState('');
    const [currentPinCode, setCurrentPinCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isServiceable, setIsServiceable] = useState<boolean | null>(null);
    const [isValidating, setIsValidating] = useState(false);

    // Autocomplete state
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    useEffect(() => {
        getCurrentLocation();
    }, []);

    useEffect(() => {
        if (currentPinCode) {
            setIsValidating(true);
            customerApi.validatePincode(currentPinCode).then(res => {
                const isAvail = res.data?.available || res.data?.serviceable;
                setIsServiceable(isAvail ?? true);
            }).catch(err => {
                console.error('Pincode validation error in selection:', err);
                setIsServiceable(true);
            }).finally(() => {
                setIsValidating(false);
            });
        } else {
            setIsServiceable(null);
        }
    }, [currentPinCode]);

    // ── Cleanup debounce timer ──
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

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
        }, 350); // 350ms debounce
    };

    // ── Select a suggestion → resolve to coordinates ──
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
                const newRegion = {
                    latitude: lat,
                    longitude: lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                };
                setRegion(newRegion);
                setSelectedLocation({ latitude: lat, longitude: lng });
                mapRef.current?.animateToRegion(newRegion, 1000);

                // Extract address and pin code from address_components
                const components = json.result.address_components || [];
                const postalComponent = components.find((c: any) =>
                    c.types?.includes('postal_code')
                );
                setCurrentAddress(json.result.formatted_address || prediction.description);
                if (postalComponent) {
                    setCurrentPinCode(postalComponent.long_name.replace(/\s+/g, ''));
                } else {
                    // Fallback to reverse geocode for pin code
                    await fetchAddressFromCoords(lat, lng);
                }
            }
        } catch (error) {
            console.error('Place Details error:', error);
            Alert.alert('Error', 'Could not resolve location details.');
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setPredictions([]);
        setShowSuggestions(false);
    };

    // ── Location helpers ──
    const getCurrentLocation = async () => {
        setIsLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission denied', 'Allow location access to find your current address.');
                setIsLoading(false);
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = location.coords;

            const newRegion = {
                latitude,
                longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            };
            setRegion(newRegion);
            setSelectedLocation({ latitude, longitude });
            mapRef.current?.animateToRegion(newRegion, 1000);

            await fetchAddressFromCoords(latitude, longitude);
        } catch (error) {
            console.error('Error getting location:', error);
            Alert.alert('Error', 'Could not fetch your location.');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAddressFromCoords = async (latitude: number, longitude: number) => {
        try {
            const [geocode] = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (geocode) {
                const parts = [geocode.name, geocode.street, geocode.district, geocode.city, geocode.region].filter(Boolean);
                setCurrentAddress(parts.join(', '));
                if (geocode.postalCode) {
                    setCurrentPinCode(geocode.postalCode.replace(/\s+/g, ''));
                }
            }
        } catch (error) {
            console.error('Reverse geocoding error:', error);
        }
    };

    const onMapPress = async (e: any) => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        setSelectedLocation({ latitude, longitude });
        await fetchAddressFromCoords(latitude, longitude);
    };

    const handleSaveLocation = async () => {
        if (!currentAddress || !currentPinCode) {
            Alert.alert('Incomplete Address', 'Please select a precise location with a valid pin code.');
            return;
        }

        setIsLoading(true);
        try {
            await customerApi.updateProfile({
                homeAddress: currentAddress,
                pinCode: currentPinCode,
            });
            await refetch();
            navigation.goBack();
        } catch (error) {
            console.error('Save location error:', error);
            Alert.alert('Error', 'Failed to save your location. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // ── Render ──
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color={colors.textPrimary} size={24} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Select Location</Text>
                <View style={{ width: 24 }} />
            </View>

            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_DEFAULT}
                initialRegion={region}
                onPress={onMapPress}
            >
                {selectedLocation && (
                    <Marker coordinate={selectedLocation} />
                )}
            </MapView>

            {/* Search Bar + Autocomplete Dropdown */}
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

            {/* My Location FAB */}
            <TouchableOpacity style={styles.myLocationButton} onPress={getCurrentLocation}>
                <Navigation color={colors.primary} size={22} />
            </TouchableOpacity>

            {/* Bottom Sheet */}
            <View style={styles.bottomSheet}>
                <Text style={styles.sheetTitle}>Selected Location</Text>
                <View style={styles.addressRow}>
                    <MapPin color={colors.textSecondary} size={20} style={{ marginTop: 2 }} />
                    <View style={styles.addressTextContainer}>
                        <Text style={styles.addressText}>
                            {currentAddress || 'Tap on the map or search to select a location'}
                        </Text>
                        {currentPinCode ? (
                            <View>
                                <Text style={styles.pinCodeText}>Pin: {currentPinCode}</Text>
                                {isValidating ? (
                                    <Text style={styles.validatingText}>Checking service availability...</Text>
                                ) : isServiceable === true ? (
                                    <Text style={styles.serviceableText}>✓ Service available in this area</Text>
                                ) : isServiceable === false ? (
                                    <Text style={styles.unserviceableText}>✗ We do not operate in this area yet</Text>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                </View>

                <TouchableOpacity
                    style={[
                        styles.saveButton,
                        (!currentAddress || isLoading) && styles.saveButtonDisabled,
                    ]}
                    onPress={handleSaveLocation}
                    disabled={!currentAddress || isLoading}
                >
                    {isLoading ? (
                        <ActivityIndicator color={colors.textInverse} />
                    ) : (
                        <>
                            <Text style={styles.saveButtonText}>Confirm Location</Text>
                            <Check color={colors.textInverse} size={20} />
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        backgroundColor: colors.surface,
        ...shadows.sm,
        zIndex: 20,
    },
    backButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },

    // ── Search + Autocomplete ──
    searchContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 120 : 100,
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

    // ── Map ──
    map: {
        flex: 1,
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 210,
        right: spacing.xl,
        backgroundColor: colors.surface,
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.md,
    },

    // ── Bottom Sheet ──
    bottomSheet: {
        backgroundColor: colors.surface,
        padding: spacing.xl,
        borderTopLeftRadius: radii['2xl'],
        borderTopRightRadius: radii['2xl'],
        ...shadows.lg,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    sheetTitle: {
        ...typography.h4,
        color: colors.textPrimary,
        marginBottom: spacing.md,
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.xl,
    },
    addressTextContainer: {
        marginLeft: spacing.sm,
        flex: 1,
    },
    addressText: {
        ...typography.body,
        color: colors.textPrimary,
        lineHeight: 22,
    },
    pinCodeText: {
        ...typography.small,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    validatingText: {
        ...typography.small,
        color: colors.textSecondary,
        marginTop: spacing.xs,
        fontStyle: 'italic',
    },
    serviceableText: {
        ...typography.small,
        color: colors.success,
        marginTop: spacing.xs,
        fontWeight: '600',
    },
    unserviceableText: {
        ...typography.small,
        color: colors.error,
        marginTop: spacing.xs,
        fontWeight: '600',
    },
    saveButton: {
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: radii.lg,
        gap: spacing.sm,
    },
    saveButtonDisabled: {
        backgroundColor: colors.border,
    },
    saveButtonText: {
        ...typography.button,
        color: colors.textInverse,
    },
});
