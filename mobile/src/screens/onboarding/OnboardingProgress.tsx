/**
 * Step indicator for the mandatory onboarding flow.
 * Technicians have a third step (skills); customers finish after location.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

export type OnboardingStepKey = 'profile' | 'location' | 'skills';

interface Props {
    current: OnboardingStepKey;
    isTechnician: boolean;
}

const LABELS: Record<OnboardingStepKey, string> = {
    profile: 'Profile',
    location: 'Location',
    skills: 'Skills',
};

export function OnboardingProgress({ current, isTechnician }: Props) {
    const steps: OnboardingStepKey[] = isTechnician
        ? ['profile', 'location', 'skills']
        : ['profile', 'location'];

    const currentIndex = steps.indexOf(current);

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                {steps.map((step, index) => {
                    const isDone = index < currentIndex;
                    const isActive = index === currentIndex;
                    return (
                        <React.Fragment key={step}>
                            <View style={styles.stepWrap}>
                                <View
                                    style={[
                                        styles.dot,
                                        isDone && styles.dotDone,
                                        isActive && styles.dotActive,
                                    ]}
                                >
                                    {isDone ? (
                                        <Check size={12} color={colors.textInverse} strokeWidth={3} />
                                    ) : (
                                        <Text style={[styles.dotText, isActive && styles.dotTextActive]}>
                                            {index + 1}
                                        </Text>
                                    )}
                                </View>
                                <Text style={[styles.label, isActive && styles.labelActive]}>
                                    {LABELS[step]}
                                </Text>
                            </View>
                            {index < steps.length - 1 && (
                                <View style={[styles.line, index < currentIndex && styles.lineDone]} />
                            )}
                        </React.Fragment>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { paddingTop: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center' },
    stepWrap: { alignItems: 'center', gap: spacing.xs },
    dot: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    dotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotDone: { backgroundColor: colors.success, borderColor: colors.success },
    dotText: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
    dotTextActive: { color: colors.textInverse },
    label: { ...typography.small, color: colors.textSecondary },
    labelActive: { color: colors.textPrimary, fontWeight: '700' },
    line: {
        flex: 1,
        height: 2,
        backgroundColor: colors.border,
        marginHorizontal: spacing.sm,
        marginBottom: spacing.base,
        borderRadius: radii.full,
    },
    lineDone: { backgroundColor: colors.success },
});
