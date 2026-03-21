/**
 * Service Request Form — Create a new service request
 * User selects service type, provides description, address, and optional photos
 */

import React, { useState } from 'react';
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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Camera, MapPin, Clock, AlertTriangle } from 'lucide-react-native';
import { useCreateServiceRequest } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { PincodeChecker } from '../../components/PincodeChecker';

type Props = NativeStackScreenProps<any, 'ServiceRequest'>;

export function ServiceRequestScreen({ navigation, route }: Props) {
    const serviceType = route.params?.serviceType || '';
    const serviceName = route.params?.serviceName || 'Service';

    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { mutate: createRequest, isPending } = useCreateServiceRequest();

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!description.trim()) newErrors.description = 'Please describe the issue';
        if (!address.trim()) newErrors.address = 'Address is required';
        if (!pinCode.trim()) newErrors.pinCode = 'Pin code is required';
        else if (pinCode.length !== 6) newErrors.pinCode = 'Enter a valid 6-digit pin code';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) return;

        createRequest(
            {
                serviceType,
                description,
                address,
                pinCode,
                urgency,
            },
            {
                onSuccess: () => {
                    Alert.alert(
                        'Request Submitted! ✅',
                        'Your service request has been created. We will assign a technician soon.',
                        [{ text: 'OK', onPress: () => navigation.goBack() }]
                    );
                },
            }
        );
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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

                {/* Photo upload placeholder */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Photos (optional)</Text>
                    <TouchableOpacity style={styles.photoUpload}>
                        <Camera size={24} color={colors.textSecondary} />
                        <Text style={styles.photoUploadText}>Tap to add photos</Text>
                    </TouchableOpacity>
                </View>

                {/* Submit */}
                <Button
                    title="Submit Request"
                    onPress={handleSubmit}
                    loading={isPending}
                    style={styles.submitButton}
                />
            </ScrollView>
        </KeyboardAvoidingView>
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
        paddingTop: 50,
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
        borderColor: colors.border,
        borderStyle: 'dashed',
        borderRadius: radii.md,
        paddingVertical: spacing['2xl'],
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    photoUploadText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    submitButton: {
        marginTop: spacing.md,
    },
});
