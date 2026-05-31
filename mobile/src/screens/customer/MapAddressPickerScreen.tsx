import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ArrowLeft, MapPin } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { customerApi, SavedAddress } from '../../api/customer.api';
import { Button } from '../../components/ui/Button';

type ParamList = {
    MapAddressPicker: { editAddressIndex?: number };
};

export function MapAddressPickerScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<RouteProp<ParamList, 'MapAddressPicker'>>();
    
    const [region, setRegion] = useState<Region | null>(null);
    const [markerCoordinate, setMarkerCoordinate] = useState<{ latitude: number, longitude: number } | null>(null);
    const [addressText, setAddressText] = useState('');
    const [label, setLabel] = useState('Home');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
            </View>

            <MapView 
                style={styles.map} 
                region={region || undefined}
                onPress={handleMapPress}
                showsUserLocation
            >
                {markerCoordinate && (
                    <Marker coordinate={markerCoordinate} />
                )}
            </MapView>

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
        padding: 16,
        paddingTop: 50,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        elevation: 2,
        zIndex: 10,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginLeft: 16 },
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
    labelTitle: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 10, marginTop: 10 },
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
