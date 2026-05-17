import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import * as LucideIcons from 'lucide-react-native';
const { Grid, Wrench } = LucideIcons;
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { ServiceItem } from '../../api/customer.api';

interface ServiceCardProps {
    service?: ServiceItem;
    isMoreCard?: boolean;
    onPress: () => void;
    style?: ViewStyle;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({ service, isMoreCard, onPress, style }) => {
    
    if (isMoreCard) {
        return (
            <TouchableOpacity 
                style={[styles.card, styles.moreCard, style]} 
                onPress={onPress}
                activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, styles.moreIconContainer]}>
                    <Grid size={24} color={colors.primary} />
                </View>
                <Text style={styles.title}>More Services</Text>
                <Text style={styles.subtitle}>25+ Categories</Text>
            </TouchableOpacity>
        );
    }

    if (!service) return null;

    const renderStatusBadge = () => {
        if (service.status === 'COMING_SOON') {
            return (
                <View style={styles.badgeComingSoon}>
                    <Text style={styles.badgeText}>Soon</Text>
                </View>
            );
        }
        return null;
    };

    return (
        <TouchableOpacity 
            style={[styles.card, style]} 
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={styles.iconContainer}>
                {(() => {
                    const IconName = (service.icon as keyof typeof LucideIcons) || 'Wrench';
                    const ServiceIcon = (LucideIcons[IconName] as any) || Wrench;
                    return <ServiceIcon size={24} color={colors.primary} />;
                })()}
            </View>
            <Text style={styles.title} numberOfLines={2}>
                {service.name}
            </Text>
            {service.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                    {service.subtitle}
                </Text>
            ) : null}
            {renderStatusBadge()}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 120,
        ...shadows.sm,
        position: 'relative',
        overflow: 'hidden',
    },
    moreCard: {
        backgroundColor: colors.primaryLight + '20', // 20% opacity
        borderWidth: 1,
        borderColor: colors.primaryLight,
        borderStyle: 'dashed',
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primaryLight + '30',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.sm,
    },
    moreIconContainer: {
        backgroundColor: colors.primaryLight + '50',
    },
    title: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: 2,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    badgeComingSoon: {
        position: 'absolute',
        top: spacing.sm,
        right: spacing.sm,
        backgroundColor: colors.warningLight,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radii.sm,
    },
    badgeText: {
        ...typography.caption,
        fontSize: 10,
        color: colors.warning,
        fontWeight: 'bold',
    },
});
