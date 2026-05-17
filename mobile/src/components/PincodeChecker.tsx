/**
 * Pincode Checker Component — Verify serviceability in an area
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { MapPin, CheckCircle2, XCircle, Search } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, radii, shadows } from '../theme/spacing';
import { apiClient } from '../api/client';

interface Props {
    onVerified?: (pincode: string) => void;
    initialPincode?: string;
    showTitle?: boolean;
}

export function PincodeChecker({ onVerified, initialPincode = '', showTitle = true }: Props) {
    const [pincode, setPincode] = useState(initialPincode);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'available' | 'unavailable'>('idle');
    const [message, setMessage] = useState('');

    const checkPincode = async () => {
        if (pincode.length !== 6) {
            setMessage('Please enter a valid 6-digit pincode');
            setStatus('unavailable');
            return;
        }

        setLoading(true);
        setStatus('idle');
        setMessage('');

        try {
            // Check if service is available in this pincode
            const res = await apiClient.get(`/api/customer/check-serviceability?pincode=${pincode}`);
            
            // Check both properties for compatibility
            const isAvailable = res.data?.available || res.data?.serviceable;

            if (isAvailable) {
                setStatus('available');
                setMessage('Great! We provide service in your area.');
                onVerified?.(pincode);
            } else {
                setStatus('unavailable');
                setMessage(res.data?.message || 'Sorry, we don\'t provide service here yet.');
            }
        } catch (error) {
            setStatus('unavailable');
            setMessage('Could not verify serviceability. Please try again later.');
            console.error('[PincodeChecker] Error:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            {showTitle && <Text style={styles.title}>Check Serviceability</Text>}

            <View style={styles.inputRow}>
                <View style={styles.inputWrap}>
                    <MapPin size={18} color={colors.textSecondary} style={styles.icon} />
                    <TextInput
                        style={styles.input}
                        placeholder="Enter 6-digit pincode"
                        keyboardType="number-pad"
                        maxLength={6}
                        value={pincode}
                        onChangeText={(val) => {
                            setPincode(val);
                            if (status !== 'idle') setStatus('idle');
                        }}
                    />
                </View>
                <TouchableOpacity
                    style={[styles.checkBtn, pincode.length !== 6 && styles.disabledBtn]}
                    onPress={checkPincode}
                    disabled={loading || pincode.length !== 6}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.checkBtnText}>Check</Text>
                    )}
                </TouchableOpacity>
            </View>

            {status !== 'idle' && (
                <View style={[styles.messageRow, status === 'available' ? styles.successBg : styles.errorBg]}>
                    {status === 'available' ? (
                        <CheckCircle2 size={16} color={colors.success} />
                    ) : (
                        <XCircle size={16} color={colors.error} />
                    )}
                    <Text style={[styles.messageText, { color: status === 'available' ? colors.success : colors.error }]}>
                        {message}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.lg,
        ...shadows.sm,
        marginBottom: spacing.md,
    },
    title: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
        marginBottom: spacing.md,
    },
    inputRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    inputWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        height: 48,
        borderWidth: 1,
        borderColor: colors.divider,
    },
    icon: {
        marginRight: spacing.sm,
    },
    input: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
    },
    checkBtn: {
        backgroundColor: colors.primary,
        borderRadius: radii.md,
        paddingHorizontal: spacing.lg,
        justifyContent: 'center',
        alignItems: 'center',
        height: 48,
    },
    disabledBtn: {
        backgroundColor: colors.textDisabled,
    },
    checkBtnText: {
        ...typography.bodyMedium,
        color: '#fff',
    },
    messageRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.md,
        padding: spacing.sm,
        borderRadius: radii.md,
    },
    successBg: {
        backgroundColor: colors.successLight,
    },
    errorBg: {
        backgroundColor: colors.errorLight,
    },
    messageText: {
        ...typography.caption,
        fontWeight: '600',
    },
});
