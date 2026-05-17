import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, SafeAreaView, Keyboard } from 'react-native';
import MapView, { Marker, Region, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Search, MapPin, Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { customerApi } from '../../api/customer.api';
import { useProfile } from '../../hooks/useCustomerData';

export function LocationSelectionScreen() {
    const navigation = useNavigation();
    const { refetch } = useProfile();
    const mapRef = useRef<MapView>(null);
    
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
    const [isSearching, setIsSearching] = useState(false);
    const [isServiceable, setIsServiceable] = useState<boolean | null>(null);
    const [isValidating, setIsValidating] = useState(false);

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

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        Keyboard.dismiss();
        setIsSearching(true);
        try {
            const geocodeResult = await Location.geocodeAsync(searchQuery);
            if (geocodeResult.length > 0) {
                const { latitude, longitude } = geocodeResult[0];
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
            } else {
                Alert.alert('Not found', 'Could not find the requested location.');
            }
        } catch (error) {
            console.error('Geocoding error:', error);
            Alert.alert('Error', 'Failed to search location.');
        } finally {
            setIsSearching(false);
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

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft color={colors.textPrimary} size={24} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Select Location</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Search color={colors.textSecondary} size={20} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search area or landmark..."
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={handleSearch}
                        returnKeyType="search"
                    />
                    {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
                </View>
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

            <TouchableOpacity style={styles.myLocationButton} onPress={getCurrentLocation}>
                <MapPin color={colors.primary} size={24} />
            </TouchableOpacity>

            <View style={styles.bottomSheet}>
                <Text style={styles.sheetTitle}>Selected Location</Text>
                <View style={styles.addressRow}>
                    <MapPin color={colors.textSecondary} size={20} style={{ marginTop: 2 }} />
                    <View style={styles.addressTextContainer}>
                        <Text style={styles.addressText}>
                            {currentAddress || 'Tap on the map to select a location'}
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
                        (!currentAddress || isLoading) && styles.saveButtonDisabled
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
        zIndex: 10,
    },
    backButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    searchContainer: {
        position: 'absolute',
        top: 90,
        left: spacing.xl,
        right: spacing.xl,
        zIndex: 10,
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
    map: {
        flex: 1,
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 200,
        right: spacing.xl,
        backgroundColor: colors.surface,
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.md,
    },
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
