/**
 * Splash Screen — Welcome + Role Selection (User/Employee)
 * Matches Figma: Blue logo, "Welcome", "Select your preferred choice", User/Employee cards
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    StatusBar,
    Image,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Wrench, User, Users } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

export function SplashScreen({ navigation }: Props) {
    const { selectedRole, setSelectedRole } = useAuthStore();

    const handleContinue = () => {
        navigation.navigate('Login');
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

            {/* Logo */}
            <View style={styles.logoContainer}>
                <View style={styles.logoIcon}>
                    <Wrench size={32} color={colors.textInverse} />
                </View>
            </View>

            {/* Welcome text */}
            <Text style={styles.title}>Welcome</Text>
            <Text style={styles.subtitle}>Select your preferred choice</Text>

            {/* Role selection cards */}
            <View style={styles.roleContainer}>
                <TouchableOpacity
                    style={[
                        styles.roleCard,
                        selectedRole === 'user' && styles.roleCardSelected,
                    ]}
                    onPress={() => setSelectedRole('user')}
                    activeOpacity={0.8}
                >
                    <View style={styles.roleAvatar}>
                        <User size={40} color={colors.primary} />
                    </View>
                    <View style={styles.radioRow}>
                        <View
                            style={[
                                styles.radio,
                                selectedRole === 'user' && styles.radioSelected,
                            ]}
                        >
                            {selectedRole === 'user' && <View style={styles.radioInner} />}
                        </View>
                        <Text style={styles.roleLabel}>User</Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.roleCard,
                        selectedRole === 'serviceman' && styles.roleCardSelected,
                    ]}
                    onPress={() => setSelectedRole('serviceman')}
                    activeOpacity={0.8}
                >
                    <View style={styles.roleAvatar}>
                        <Users size={40} color={colors.primary} />
                    </View>
                    <View style={styles.radioRow}>
                        <View
                            style={[
                                styles.radio,
                                selectedRole === 'serviceman' && styles.radioSelected,
                            ]}
                        >
                            {selectedRole === 'serviceman' && (
                                <View style={styles.radioInner} />
                            )}
                        </View>
                        <Text style={styles.roleLabel}>Employee</Text>
                    </View>
                </TouchableOpacity>
            </View>

            {/* Continue button */}
            <View style={styles.buttonContainer}>
                <Button title="Continue" onPress={handleContinue} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        paddingTop: 80,
        paddingHorizontal: spacing.xl,
    },
    logoContainer: {
        marginBottom: spacing.lg,
    },
    logoIcon: {
        width: 64,
        height: 64,
        borderRadius: radii.lg,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing['2xl'],
    },
    roleContainer: {
        flexDirection: 'row',
        gap: spacing.lg,
        marginBottom: spacing['3xl'],
    },
    roleCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.base,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    roleCardSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    roleAvatar: {
        width: 80,
        height: 80,
        borderRadius: radii.full,
        backgroundColor: colors.primaryLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    radioRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    radio: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioSelected: {
        borderColor: colors.primary,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.primary,
    },
    roleLabel: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    buttonContainer: {
        width: '100%',
        position: 'absolute',
        bottom: 60,
        paddingHorizontal: spacing.xl,
    },
});
