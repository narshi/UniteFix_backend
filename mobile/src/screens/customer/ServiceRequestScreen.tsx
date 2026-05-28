/**
 * Service Request Form — Create a new service request
 * User selects service type, provides description, address, and optional photos
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    Alert,
    TextInput,
    Image,
    ActivityIndicator,
    SafeAreaView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Camera, MapPin, Clock, AlertTriangle, X, ImagePlus } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCreateServiceRequest, usePublicConfig } from '../../hooks/useCustomerData';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { customerApi } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { PincodeChecker } from '../../components/PincodeChecker';

type Props = NativeStackScreenProps<any, 'ServiceRequest'>;

const MAX_PHOTOS = 5;

export function ServiceRequestScreen({ navigation, route }: Props) {
    const serviceType = route.params?.serviceType || '';
    const serviceName = route.params?.serviceName || 'Service';

    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
    const [photos, setPhotos] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null);

    const { mutate: createRequest, isPending } = useCreateServiceRequest();
    const { data: publicConfig } = usePublicConfig();

    const bookingFee = publicConfig?.bookingFee ?? 99;

    // Get device GPS location on mount for geofence support
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({});
                    setDeviceLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
                }
            } catch (e) {
                // Location is optional — geofence will skip if not available
            }
        })();
    }, []);

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!description.trim()) newErrors.description = 'Please describe the issue';
        if (!address.trim()) newErrors.address = 'Address is required';
        if (!pinCode.trim()) newErrors.pinCode = 'Pin code is required';
        else if (pinCode.length !== 6) newErrors.pinCode = 'Enter a valid 6-digit pin code';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handlePickPhotos = () => {
        if (photos.length >= MAX_PHOTOS) {
            Alert.alert('Limit Reached', `You can add up to ${MAX_PHOTOS} photos.`);
            return;
        }

        Alert.alert('Add Photo', 'Choose an option', [
            {
                text: 'Take Photo',
                onPress: async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') {
                        Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
                        return;
                    }
                    const result = await ImagePicker.launchCameraAsync({
                        mediaTypes: ['images'],
                        quality: 0.7,
                        allowsEditing: true,
                    });
                    if (!result.canceled && result.assets[0]) {
                        setPhotos((prev) => [...prev, result.assets[0].uri]);
                    }
                },
            },
            {
                text: 'Choose from Gallery',
                onPress: async () => {
                    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (status !== 'granted') {
                        Alert.alert('Permission Denied', 'Gallery permission is required to select photos.');
                        return;
                    }
                    const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        quality: 0.7,
                        allowsMultipleSelection: true,
                        selectionLimit: MAX_PHOTOS - photos.length,
                    });
                    if (!result.canceled && result.assets.length > 0) {
                        const newUris = result.assets.map((a) => a.uri);
                        setPhotos((prev) => [...prev, ...newUris].slice(0, MAX_PHOTOS));
                    }
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    const removePhoto = (index: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = () => {
        if (!validate()) return;

        // Confirm booking fee before proceeding
        Alert.alert(
            'Confirm Booking',
            `A booking fee of ₹${bookingFee} will be charged to confirm your ${serviceName} request. This amount will be adjusted in your final bill.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: `Pay ₹${bookingFee} & Book`,
                    onPress: async () => {
                        try {
                            // Upload photos to Cloudinary first (if any)
                            let photoUrls: string[] = [];
                            if (photos.length > 0) {
                                setUploading(true);
                                try {
                                    photoUrls = await customerApi.uploadImages(photos, 'service_photos');
                                } catch (uploadErr) {
                                    Alert.alert('Upload Failed', 'Could not upload photos. Your request will be created without images.');
                                    photoUrls = [];
                                } finally {
                                    setUploading(false);
                                }
                            }

                            createRequest(
                                {
                                    serviceType,
                                    description,
                                    address,
                                    pinCode,
                                    urgency,
                                    photos: photoUrls.length > 0 ? photoUrls : undefined,
                                    // Send GPS coordinates for geofence enforcement
                                    ...(deviceLocation ? {
                                        customerLocation: `POINT(${deviceLocation.lng} ${deviceLocation.lat})`,
                                    } : {}),
                                },
                                {
                                    onSuccess: async (response: any) => {
                                        const paymentData = response?.data?.payment;

                                        if (paymentData?.razorpayOrderId && paymentData?.razorpayKeyId) {
                                            // Open Razorpay native checkout
                                            try {
                                                const paymentResponse = await openRazorpayCheckout({
                                                    razorpayOrderId: paymentData.razorpayOrderId,
                                                    razorpayKeyId: paymentData.razorpayKeyId,
                                                    amount: paymentData.amount,
                                                    description: `₹${paymentData.amount} Booking Fee — ${serviceName}`,
                                                });

                                                // Verify payment on backend
                                                await customerApi.verifyPayment(paymentResponse);

                                                Alert.alert(
                                                    'Booking Confirmed! ✅',
                                                    `Your ₹${bookingFee} booking fee has been paid. We will assign a technician soon.`,
                                                    [{ text: 'OK', onPress: () => navigation.goBack() }]
                                                );
                                            } catch (err: any) {
                                                handleRazorpayError(err);
                                                // Booking is created but unpaid — user can retry
                                                Alert.alert(
                                                    'Booking Created',
                                                    'Your request is saved. Complete payment from My Requests to confirm.',
                                                    [{ text: 'OK', onPress: () => navigation.goBack() }]
                                                );
                                            }
                                        } else {
                                            // No payment required (Razorpay not configured / dev mode)
                                            Alert.alert(
                                                'Request Submitted! ✅',
                                                'Your service request has been created. We will assign a technician soon.',
                                                [{ text: 'OK', onPress: () => navigation.goBack() }]
                                            );
                                        }
                                    },
                                }
                            );
                        } catch (error) {
                            setUploading(false);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Book {serviceName}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Service type badge */}
                <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>📋 {serviceName}</Text>
                </View>

                {/* Description */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Describe the issue *</Text>
                    <TextInput
                        style={[styles.textArea, errors.description && styles.inputError]}
                        placeholder="Tell us what's wrong — the more detail, the better."
                        value={description}
                        onChangeText={setDescription}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        placeholderTextColor={colors.textDisabled}
                    />
                    {errors.description && <Text style={styles.errorText}>{errors.description}</Text>}
                </View>

                {/* Address */}
                <Input
                    label="Address *"
                    placeholder="Full address for the visit"
                    value={address}
                    onChangeText={setAddress}
                    icon={<MapPin size={18} color={colors.textSecondary} />}
                    error={errors.address}
                />

                {/* Pin Code with Checker */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Service Pincode *</Text>
                    <PincodeChecker
                        initialPincode={pinCode}
                        onVerified={setPinCode}
                        showTitle={false}
                    />
                    {errors.pinCode && <Text style={styles.errorText}>{errors.pinCode}</Text>}
                </View>

                {/* Urgency selector */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Urgency</Text>
                    <View style={styles.urgencyRow}>
                        <TouchableOpacity
                            style={[styles.urgencyOption, urgency === 'normal' && styles.urgencySelected]}
                            onPress={() => setUrgency('normal')}
                        >
                            <Clock size={18} color={urgency === 'normal' ? colors.primary : colors.textSecondary} />
                            <Text style={[styles.urgencyLabel, urgency === 'normal' && styles.urgencyLabelSelected]}>
                                Normal
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.urgencyOption, urgency === 'urgent' && styles.urgencyUrgentSelected]}
                            onPress={() => setUrgency('urgent')}
                        >
                            <AlertTriangle size={18} color={urgency === 'urgent' ? colors.error : colors.textSecondary} />
                            <Text style={[styles.urgencyLabel, urgency === 'urgent' && styles.urgencyLabelUrgent]}>
                                Urgent
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Photo upload */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Photos (optional, max {MAX_PHOTOS})</Text>

                    {/* Photo preview grid */}
                    {photos.length > 0 && (
                        <View style={styles.photoGrid}>
                            {photos.map((uri, index) => (
                                <View key={index} style={styles.photoPreviewContainer}>
                                    <Image source={{ uri }} style={styles.photoPreview} />
                                    <TouchableOpacity
                                        style={styles.photoRemoveBtn}
                                        onPress={() => removePhoto(index)}
                                    >
                                        <X size={14} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Add photo button */}
                    {photos.length < MAX_PHOTOS && (
                        <TouchableOpacity style={styles.photoUpload} onPress={handlePickPhotos}>
                            <ImagePlus size={24} color={colors.primary} />
                            <Text style={styles.photoUploadText}>
                                {photos.length === 0 ? 'Tap to add photos of the issue' : 'Add more photos'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Submit */}
                <Button
                    title={uploading ? 'Uploading photos...' : 'Submit Request'}
                    onPress={handleSubmit}
                    loading={isPending || uploading}
                    style={styles.submitButton}
                />
            </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
        paddingBottom: spacing['3xl'],
    },
    typeBadge: {
        alignSelf: 'flex-start',
        backgroundColor: colors.primarySurface,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        borderRadius: radii.full,
        marginBottom: spacing.xl,
    },
    typeBadgeText: {
        ...typography.label,
        color: colors.primary,
    },
    fieldContainer: {
        marginBottom: spacing.lg,
    },
    label: {
        ...typography.label,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    textArea: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        padding: spacing.md,
        height: 100,
        fontSize: 15,
        color: colors.textPrimary,
    },
    inputError: {
        borderColor: colors.error,
    },
    errorText: {
        ...typography.small,
        color: colors.error,
        marginTop: spacing.xs,
    },
    urgencyRow: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    urgencyOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: radii.md,
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    urgencySelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    urgencyUrgentSelected: {
        borderColor: colors.error,
        backgroundColor: colors.errorLight,
    },
    urgencyLabel: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
    },
    urgencyLabelSelected: {
        color: colors.primary,
    },
    urgencyLabelUrgent: {
        color: colors.error,
    },
    photoUpload: {
        borderWidth: 1.5,
        borderColor: colors.primary,
        borderStyle: 'dashed',
        borderRadius: radii.md,
        paddingVertical: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.primarySurface,
    },
    photoUploadText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '500',
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    photoPreviewContainer: {
        width: 80,
        height: 80,
        borderRadius: radii.md,
        overflow: 'hidden',
        position: 'relative',
    },
    photoPreview: {
        width: '100%',
        height: '100%',
        borderRadius: radii.md,
    },
    photoRemoveBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitButton: {
        marginTop: spacing.md,
    },
});

