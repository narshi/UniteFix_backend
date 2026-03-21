/**
 * Start Service Screen — Geo-fenced service start for partner
 * Role: 🟧 Serviceman only
 * Checks 500m proximity before allowing service to start
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Alert,
    ActivityIndicator,
    TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, MapPin, Navigation, AlertCircle, CheckCircle, Loader,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'StartService'>;

const PROXIMITY_THRESHOLD_METERS = 500;

function getDistanceFromLatLonInMeters(
    lat1: number, lon1: number, lat2: number, lon2: number
): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

type LocationStatus = 'checking' | 'granted' | 'denied' | 'error';
type ProximityStatus = 'checking' | 'within_range' | 'too_far' | 'unknown';

export function StartServiceScreen({ navigation, route }: Props) {
    const serviceId = route.params?.serviceId;
    const customerLat = route.params?.customerLat;
    const customerLong = route.params?.customerLong;

    const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');
    const [proximityStatus, setProximityStatus] = useState<ProximityStatus>('checking');
    const [currentLocation, setCurrentLocation] = useState<{ lat: number; long: number } | null>(null);
    const [distance, setDistance] = useState<number | null>(null);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        checkLocationPermission();
    }, []);

    const checkLocationPermission = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setLocationStatus('denied');
                setProximityStatus('unknown');
                return;
            }
            setLocationStatus('granted');
            await checkProximity();
        } catch (err) {
            setLocationStatus('error');
            setProximityStatus('unknown');
        }
    };

    const checkProximity = async () => {
        setProximityStatus('checking');
        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });
            const { latitude, longitude } = location.coords;
            setCurrentLocation({ lat: latitude, long: longitude });

            if (customerLat && customerLong) {
                const dist = getDistanceFromLatLonInMeters(
                    latitude, longitude,
                    parseFloat(customerLat), parseFloat(customerLong),
                );
                setDistance(Math.round(dist));
                setProximityStatus(dist <= PROXIMITY_THRESHOLD_METERS ? 'within_range' : 'too_far');
            } else {
                // No customer location — allow start (backend will validate if needed)
                setProximityStatus('within_range');
                setDistance(null);
            }
        } catch (err) {
            setProximityStatus('unknown');
            Alert.alert('Location Error', 'Could not get your location. Please try again.');
        }
    };

    const handleStartService = async () => {
        setStarting(true);
        try {
            await apiClient.post(`/api/service/start`, {
                serviceId,
                latitude: currentLocation?.lat,
                longitude: currentLocation?.long,
            });
            Alert.alert('Service Started!', 'You can now proceed with the service.', [
                { text: 'OK', onPress: () => navigation.goBack() },
            ]);
        } catch (err) {
            Alert.alert('Error', getApiErrorMessage(err));
        } finally {
            setStarting(false);
        }
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Start Service</Text>
                <View style={{ width: 36 }} />
            </View>

            <View style={styles.content}>
                {/* Location Permission Status */}
                <StatusCard
                    icon={<MapPin size={20} color={locationStatus === 'granted' ? colors.success : colors.warning} />}
                    title="Location Permission"
                    status={
                        locationStatus === 'checking' ? 'Checking...' :
                            locationStatus === 'granted' ? 'Permission granted' :
                                locationStatus === 'denied' ? 'Permission denied — tap to enable' :
                                    'Error checking permission'
                    }
                    statusColor={locationStatus === 'granted' ? colors.success : colors.warning}
                    onPress={locationStatus === 'denied' ? checkLocationPermission : undefined}
                />

                {/* Proximity Status */}
                <StatusCard
                    icon={
                        proximityStatus === 'checking' ? <Loader size={20} color={colors.info} /> :
                            proximityStatus === 'within_range' ? <CheckCircle size={20} color={colors.success} /> :
                                proximityStatus === 'too_far' ? <AlertCircle size={20} color={colors.error} /> :
                                    <Navigation size={20} color={colors.textSecondary} />
                    }
                    title="Proximity Check"
                    status={
                        proximityStatus === 'checking' ? 'Checking your location...' :
                            proximityStatus === 'within_range'
                                ? distance != null
                                    ? `Within range (${distance}m away)`
                                    : 'Location verified'
                                :
                                proximityStatus === 'too_far'
                                    ? `Too far (${distance}m away). Must be within ${PROXIMITY_THRESHOLD_METERS}m.`
                                    :
                                    'Unable to verify proximity'
                    }
                    statusColor={
                        proximityStatus === 'within_range' ? colors.success :
                            proximityStatus === 'too_far' ? colors.error :
                                colors.textSecondary
                    }
                />

                {/* Distance indicator */}
                {distance !== null && proximityStatus !== 'checking' && (
                    <View style={styles.distanceCard}>
                        <View style={styles.distanceBar}>
                            <View
                                style={[
                                    styles.distanceFill,
                                    {
                                        width: `${Math.min(100, (distance / PROXIMITY_THRESHOLD_METERS) * 100)}%`,
                                        backgroundColor: proximityStatus === 'within_range' ? colors.success : colors.error,
                                    },
                                ]}
                            />
                        </View>
                        <View style={styles.distanceLabels}>
                            <Text style={styles.distanceLabelText}>0m</Text>
                            <Text style={styles.distanceLabelText}>{PROXIMITY_THRESHOLD_METERS}m</Text>
                        </View>
                    </View>
                )}

                {/* Retry proximity */}
                {(proximityStatus === 'too_far' || proximityStatus === 'unknown') && (
                    <TouchableOpacity style={styles.retryBtn} onPress={checkProximity}>
                        <Navigation size={16} color={colors.primary} />
                        <Text style={styles.retryText}>Recheck Location</Text>
                    </TouchableOpacity>
                )}

                {/* Info */}
                <View style={styles.infoCard}>
                    <Text style={styles.infoTitle}>Important</Text>
                    <Text style={styles.infoText}>
                        • You must be within {PROXIMITY_THRESHOLD_METERS}m of the customer location{'\n'}
                        • Ensure OTP has been verified before starting{'\n'}
                        • Service timer starts once you tap "Start Service"
                    </Text>
                </View>
            </View>

            {/* Start button */}
            <View style={styles.bottomBar}>
                <Button
                    title="Start Service"
                    onPress={handleStartService}
                    loading={starting}
                    disabled={proximityStatus !== 'within_range'}
                />
            </View>
        </View>
    );
}

function StatusCard({
    icon, title, status, statusColor, onPress,
}: {
    icon: React.ReactNode; title: string; status: string;
    statusColor: string; onPress?: () => void;
}) {
    const Comp = onPress ? TouchableOpacity : View;
    return (
        <Comp style={styles.statusCard} onPress={onPress} activeOpacity={0.7}>
            {icon}
            <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>{title}</Text>
                <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
            </View>
        </Comp>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    content: { flex: 1, padding: spacing.xl },
    statusCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm,
    },
    statusTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    statusText: { ...typography.caption, marginTop: 2 },
    distanceCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    distanceBar: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
    distanceFill: { height: '100%', borderRadius: 4 },
    distanceLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
    distanceLabelText: { ...typography.small, color: colors.textDisabled },
    retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
    retryText: { ...typography.bodyMedium, color: colors.primary },
    infoCard: { backgroundColor: colors.warningLight, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg },
    infoTitle: { ...typography.bodyMedium, color: colors.warning, marginBottom: spacing.sm },
    infoText: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
    bottomBar: { padding: spacing.xl, paddingBottom: spacing['2xl'], backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.divider },
});
