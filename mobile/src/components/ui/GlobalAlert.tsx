import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    Dimensions,
    TouchableWithoutFeedback,
    Easing,
    ActivityIndicator,
} from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { CheckCircle2, AlertCircle, Info, XCircle, X } from 'lucide-react-native';

const { width } = Dimensions.get('window');

export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface AlertOptions {
    title: string;
    message: string;
    type?: AlertType;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    showCloseIcon?: boolean;
    cancellable?: boolean;
    loading?: boolean;
}

// Global reference to the alert instance so it can be called anywhere
let alertInstance: any = null;

/**
 * Premium Global Alert Dialog
 * Usage:
 * GlobalAlert.show({
 *   title: 'Payment Successful',
 *   message: 'Your service request has been confirmed.',
 *   type: 'success',
 *   onConfirm: () => console.log('Confirmed'),
 * });
 */
export class GlobalAlert {
    static show(options: AlertOptions) {
        if (alertInstance) {
            alertInstance.show(options);
        }
    }

    static hide() {
        if (alertInstance) {
            alertInstance.hide();
        }
    }
}

export const GlobalAlertProvider = () => {
    const [visible, setVisible] = useState(false);
    const [options, setOptions] = useState<AlertOptions | null>(null);

    // Animation values
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.9)).current;
    const translateY = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        // Register the instance
        alertInstance = {
            show: (newOptions: AlertOptions) => {
                setOptions({
                    type: 'info', // default
                    showCloseIcon: true,
                    cancellable: true,
                    confirmText: 'Okay',
                    ...newOptions,
                });
                setVisible(true);

                // Entrance animation
                Animated.parallel([
                    Animated.timing(opacity, {
                        toValue: 1,
                        duration: 200,
                        useNativeDriver: true,
                        easing: Easing.out(Easing.ease),
                    }),
                    Animated.spring(scale, {
                        toValue: 1,
                        friction: 7,
                        tension: 40,
                        useNativeDriver: true,
                    }),
                    Animated.spring(translateY, {
                        toValue: 0,
                        friction: 7,
                        tension: 40,
                        useNativeDriver: true,
                    }),
                ]).start();
            },
            hide: () => {
                // Exit animation
                Animated.parallel([
                    Animated.timing(opacity, {
                        toValue: 0,
                        duration: 150,
                        useNativeDriver: true,
                    }),
                    Animated.timing(scale, {
                        toValue: 0.95,
                        duration: 150,
                        useNativeDriver: true,
                    }),
                ]).start(() => {
                    setVisible(false);
                    setOptions(null);
                });
            },
        };

        return () => {
            alertInstance = null;
        };
    }, [opacity, scale, translateY]);

    const handleConfirm = useCallback(() => {
        if (options?.onConfirm) {
            options.onConfirm();
        }
        GlobalAlert.hide();
    }, [options]);

    const handleCancel = useCallback(() => {
        if (options?.onCancel) {
            options.onCancel();
        }
        GlobalAlert.hide();
    }, [options]);

    const handleBackdropPress = useCallback(() => {
        if (options?.cancellable) {
            handleCancel();
        }
    }, [options, handleCancel]);

    if (!visible || !options) return null;

    const getIcon = () => {
        if (options.loading) {
            return (
                <View style={styles.loadingWrapper}>
                    <Animated.Image 
                        source={require('../../../assets/icon.png')} // App icon inside the loader
                        style={[styles.loadingIcon, { opacity: 0.5 }]} 
                    />
                    <View style={styles.spinnerContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                </View>
            );
        }

        const size = 36;
        switch (options.type) {
            case 'success':
                return <CheckCircle2 color={colors.success} size={size} strokeWidth={2.5} />;
            case 'error':
                return <XCircle color={colors.error} size={size} strokeWidth={2.5} />;
            case 'warning':
                return <AlertCircle color={colors.warning} size={size} strokeWidth={2.5} />;
            case 'info':
            default:
                return <Info color={colors.info} size={size} strokeWidth={2.5} />;
        }
    };

    const getIconBackgroundColor = () => {
        if (options.loading) return 'transparent';
        switch (options.type) {
            case 'success':
                return colors.successLight + '40'; // Extra transparent
            case 'error':
                return colors.errorLight + '40';
            case 'warning':
                return colors.warningLight + '40';
            case 'info':
            default:
                return colors.infoLight + '40';
        }
    };

    const getIconBorderColor = () => {
        if (options.loading) return 'transparent';
        switch (options.type) {
            case 'success': return colors.success;
            case 'error': return colors.error;
            case 'warning': return colors.warning;
            case 'info':
            default: return colors.info;
        }
    };

    const hasCancelButton = !!options.onCancel || !!options.cancelText;
    const isError = options.type === 'error';

    return (
        <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
            <TouchableWithoutFeedback onPress={handleBackdropPress}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <Animated.View
                            style={[
                                styles.alertContainer,
                                {
                                    opacity,
                                    transform: [{ scale }, { translateY }],
                                },
                            ]}
                        >
                            {/* Close Icon (Top Right) */}
                            {options.showCloseIcon && options.cancellable && (
                                <TouchableOpacity
                                    style={styles.closeButton}
                                    onPress={handleCancel}
                                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                                >
                                    <X color={colors.textSecondary} size={20} />
                                </TouchableOpacity>
                            )}

                            {/* Header Icon */}
                            <View style={[
                                styles.iconContainer, 
                                { 
                                    backgroundColor: getIconBackgroundColor(),
                                    borderColor: getIconBorderColor(),
                                    borderWidth: options.loading ? 0 : 2
                                }
                            ]}>
                                {getIcon()}
                            </View>

                            {/* Content */}
                            <Text style={styles.title}>{options.title}</Text>
                            <Text style={styles.message}>{options.message}</Text>

                            {/* Actions */}
                            {!options.loading && (
                                <View style={[styles.actions, hasCancelButton && styles.actionsRow]}>
                                    {hasCancelButton && (
                                        <TouchableOpacity
                                            style={[styles.button, styles.cancelButton, { flex: 1, marginRight: spacing.sm }]}
                                            onPress={handleCancel}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={styles.cancelButtonText}>{options.cancelText || 'Cancel'}</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity
                                        style={[
                                            styles.button,
                                            styles.confirmButton,
                                            hasCancelButton && { flex: 1, marginLeft: spacing.sm },
                                            isError && { backgroundColor: colors.error }
                                        ]}
                                        onPress={handleConfirm}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.confirmButtonText, isError && { color: colors.textInverse }]}>{options.confirmText || 'Okay'}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </Animated.View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: colors.scrim,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    alertContainer: {
        width: width - spacing.xl * 2,
        maxWidth: 400,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        alignItems: 'center',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.25,
        shadowRadius: 32,
        elevation: 12,
        borderWidth: 1,
        borderColor: colors.border + '60', // Subtle border
    },
    closeButton: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        padding: 8,
        backgroundColor: colors.surface,
        borderRadius: 20,
    },
    iconContainer: {
        width: 72,
        height: 72,
        borderRadius: 36,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
    },
    loadingWrapper: {
        width: 72,
        height: 72,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingIcon: {
        width: 32,
        height: 32,
        position: 'absolute',
        borderRadius: 8,
    },
    spinnerContainer: {
        position: 'absolute',
    },
    title: {
        ...typography.h3,
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: spacing.sm,
    },
    message: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.xl,
        lineHeight: 22,
    },
    actions: {
        width: '100%',
    },
    actionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    button: {
        height: 52,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
    },
    confirmButton: {
        backgroundColor: colors.primary,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    cancelButton: {
        backgroundColor: 'transparent',
        borderWidth: 0,
    },
    confirmButtonText: {
        ...typography.h4,
        fontSize: 16,
        color: colors.textInverse,
    },
    cancelButtonText: {
        ...typography.h4,
        fontSize: 16,
        color: colors.textSecondary,
    },
});
