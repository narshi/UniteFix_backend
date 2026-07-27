import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated } from 'react-native';
import * as LucideIcons from 'lucide-react-native';
import { colors, typography, spacing, radii, shadows } from '../../theme';

type AlertButton = {
    text?: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
};

type AlertOptions = {
    cancelable?: boolean;
    onDismiss?: () => void;
};

type AlertState = {
    visible: boolean;
    title: string;
    message: string;
    buttons: AlertButton[];
    options?: AlertOptions;
};

// --- SINGLETON SERVICE ---
let alertListener: ((state: AlertState) => void) | null = null;

export const PremiumAlertService = {
    show: (title: string, message?: string | any, buttons?: AlertButton[], options?: AlertOptions) => {
        
        // --- Parse Message (Fix Razorpay / Object errors) ---
        let parsedMessage = '';
        if (typeof message === 'string') {
            parsedMessage = message;
        } else if (message) {
            try {
                // If it's an object, check if it has a common error property
                if (message.description) parsedMessage = message.description;
                else if (message.message) parsedMessage = message.message;
                else if (message.error) parsedMessage = typeof message.error === 'string' ? message.error : JSON.stringify(message.error);
                else parsedMessage = JSON.stringify(message, null, 2);
            } catch(e) {
                parsedMessage = String(message);
            }
        }
        
        // Default OK button if none provided
        const finalButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];

        if (alertListener) {
            alertListener({
                visible: true,
                title,
                message: parsedMessage,
                buttons: finalButtons,
                options
            });
        }
    },
    hide: () => {
        if (alertListener) {
            alertListener({ visible: false, title: '', message: '', buttons: [] });
        }
    }
};

// --- REACT COMPONENT ---
export const PremiumAlertProvider = () => {
    const [state, setState] = useState<AlertState>({
        visible: false,
        title: '',
        message: '',
        buttons: []
    });

    const [scaleAnim] = useState(new Animated.Value(0.8));
    const [fadeAnim] = useState(new Animated.Value(0));

    useEffect(() => {
        alertListener = setState;
        return () => {
            alertListener = null;
        };
    }, []);

    useEffect(() => {
        if (state.visible) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    bounciness: 12,
                    speed: 20
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 150,
                    useNativeDriver: true
                })
            ]).start();
        } else {
            scaleAnim.setValue(0.8);
            fadeAnim.setValue(0);
        }
    }, [state.visible]);

    /**
     * @param notifyDismiss mirrors the platform Alert contract — `onDismiss` fires
     * only when the dialog is dismissed WITHOUT a button press (back button /
     * tap-outside), never in addition to a button's own onPress handler.
     */
    const handleClose = (notifyDismiss = false) => {
        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 0.8,
                duration: 100,
                useNativeDriver: true
            }),
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 100,
                useNativeDriver: true
            })
        ]).start(() => {
            const onDismiss = state.options?.onDismiss;
            PremiumAlertService.hide();
            if (notifyDismiss && onDismiss) {
                onDismiss();
            }
        });
    };

    const handleButtonPress = (btn: AlertButton) => {
        handleClose(false);
        if (btn.onPress) {
            // small delay to let animation finish before executing logic
            setTimeout(() => {
                btn.onPress!();
            }, 100);
        }
    };

    if (!state.visible && (fadeAnim as any)._value === 0) return null;

    // Determine Icon and Color based on Title Keywords
    const titleLower = state.title.toLowerCase();
    let IconComponent: any = LucideIcons.Info;
    let iconColor: string = colors.primary;
    let iconBg: string = colors.primaryLight + '20';

    if (titleLower.includes('error') || titleLower.includes('fail') || titleLower.includes('invalid') || titleLower.includes('denied') || titleLower.includes('required')) {
        IconComponent = LucideIcons.AlertCircle;
        iconColor = colors.error;
        iconBg = colors.errorLight + '20';
    } else if (titleLower.includes('success') || titleLower.includes('saved') || titleLower.includes('placed') || titleLower.includes('created') || titleLower.includes('done')) {
        IconComponent = LucideIcons.CheckCircle;
        iconColor = colors.success;
        iconBg = colors.successLight + '20';
    } else if (titleLower.includes('warning') || titleLower.includes('sure') || titleLower.includes('delete') || titleLower.includes('logout') || titleLower.includes('log out')) {
        IconComponent = LucideIcons.AlertTriangle;
        iconColor = colors.warning;
        iconBg = colors.warningLight + '20';
    }

    return (
        <Modal
            transparent
            statusBarTranslucent
            visible={state.visible}
            animationType="none"
            onRequestClose={() => {
                if (state.options?.cancelable) {
                    handleClose(true);
                }
            }}
        >
            <View style={styles.overlay}>
                <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
                <Animated.View style={[styles.dialogContainer, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
                    
                    <View style={[styles.iconWrapper, { backgroundColor: iconBg }]}>
                        <IconComponent size={28} color={iconColor} strokeWidth={2.5} />
                    </View>

                    <Text style={styles.titleText}>{state.title}</Text>
                    {!!state.message && (
                        <Text style={styles.messageText}>{state.message}</Text>
                    )}

                    {/* 1–2 buttons sit side by side; 3+ stack vertically.
                        Previously every button in a 3+ set got width:'100%' inside a
                        row container, so they overflowed the dialog and rendered
                        off-screen. */}
                    <View style={[
                        styles.buttonContainer,
                        state.buttons.length > 2 && styles.buttonContainerStacked,
                    ]}>
                        {state.buttons.map((btn, index) => {
                            const isDestructive = btn.style === 'destructive';
                            const isCancel = btn.style === 'cancel';

                            const buttonStyle = state.buttons.length === 2
                                ? styles.buttonFlex
                                : styles.buttonFull;

                            return (
                                <TouchableOpacity
                                    key={index}
                                    style={[
                                        styles.button,
                                        buttonStyle,
                                        isDestructive && styles.buttonDestructive,
                                        isCancel && styles.buttonCancel
                                    ]}
                                    onPress={() => handleButtonPress(btn)}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.buttonText,
                                            isDestructive && styles.buttonTextDestructive,
                                            isCancel && styles.buttonTextCancel
                                        ]}
                                    >
                                        {btn.text || 'OK'}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
        zIndex: 9999,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    dialogContainer: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii['2xl'],
        padding: spacing.xl,
        width: '100%',
        maxWidth: 340,
        alignItems: 'center',
        ...shadows.xl,
    },
    iconWrapper: {
        width: 60,
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.lg,
    },
    titleText: {
        ...typography.h3,
        fontWeight: 'bold',
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: spacing.sm,
    },
    messageText: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.xl,
        lineHeight: 22,
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        gap: spacing.md,
        justifyContent: 'center',
    },
    buttonContainerStacked: {
        flexDirection: 'column',
    },
    button: {
        backgroundColor: colors.primary,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonFlex: {
        flex: 1,
    },
    buttonFull: {
        width: '100%',
    },
    buttonCancel: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    buttonDestructive: {
        backgroundColor: colors.error,
    },
    buttonText: {
        ...typography.button,
        color: colors.textInverse,
        fontWeight: 'bold',
    },
    buttonTextCancel: {
        color: colors.textPrimary,
    },
    buttonTextDestructive: {
        color: colors.textInverse,
    }
});
