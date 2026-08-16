/**
 * Error Boundary — Global crash handler for React component tree
 * Catches rendering errors and shows a friendly fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, radii, shadows } from '../theme/spacing';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        // Logged unconditionally so `adb logcat -s ReactNativeJS` picks it up on a
        // release build, which is the only way to read it off a real device.
        console.error(
            '[ErrorBoundary] Caught error:',
            error?.message ?? String(error),
            '\n',
            errorInfo?.componentStack ?? '(no component stack)',
        );
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <View style={styles.container}>
                    <View style={styles.content}>
                        <View style={styles.iconCircle}>
                            <AlertTriangle size={32} color={colors.error} />
                        </View>

                        <Text style={styles.title}>Something went wrong</Text>
                        <Text style={styles.subtitle}>
                            The app encountered an unexpected error. Please try again.
                        </Text>

                        <TouchableOpacity style={styles.retryButton} onPress={this.handleReset}>
                            <RefreshCw size={18} color={colors.textInverse} />
                            <Text style={styles.retryText}>Try Again</Text>
                        </TouchableOpacity>

                        {/*
                          * Shown in RELEASE builds too, not just __DEV__.
                          *
                          * This screen is the only trace a crash leaves — there is no crash
                          * reporter wired up — and gating the message behind __DEV__ meant a
                          * user hitting this could report nothing beyond "it crashed", which
                          * is not enough to find the cause. The text is selectable so it can
                          * be copied or screenshotted straight into a bug report.
                          */}
                        {this.state.error && (
                            <ScrollView style={styles.debugCard} contentContainerStyle={styles.debugContent}>
                                <Text style={styles.debugTitle}>Error details</Text>
                                <Text style={styles.debugText} selectable>
                                    {this.state.error.toString()}
                                </Text>
                                {this.state.errorInfo?.componentStack && (
                                    <Text style={styles.debugText} selectable>
                                        {this.state.errorInfo.componentStack.trim().slice(0, 800)}
                                    </Text>
                                )}
                            </ScrollView>
                        )}
                    </View>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1, backgroundColor: colors.background,
        justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: spacing.xl,
    },
    content: { alignItems: 'center', width: '100%' },
    iconCircle: {
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: colors.errorLight, justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.xl,
    },
    title: {
        ...typography.h2, color: colors.textPrimary,
        textAlign: 'center', marginBottom: spacing.sm,
    },
    subtitle: {
        ...typography.body, color: colors.textSecondary,
        textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl,
    },
    retryButton: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.primary, paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl, borderRadius: radii.lg,
        ...shadows.md,
    },
    retryText: { ...typography.bodyMedium, color: colors.textInverse },
    debugCard: {
        marginTop: spacing.xl, width: '100%', maxHeight: 200,
        backgroundColor: colors.surface, borderRadius: radii.md,
    },
    debugContent: { padding: spacing.md },
    debugTitle: { ...typography.bodyMedium, color: colors.error, marginBottom: spacing.sm },
    debugText: { ...typography.small, color: colors.textSecondary, fontFamily: 'monospace' },
});
