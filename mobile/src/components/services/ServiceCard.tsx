import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import * as LucideIcons from 'lucide-react-native';
const { Grid, ChevronRight } = LucideIcons;
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { ServiceItem } from '../../api/customer.api';
import { getServiceIcon } from '../../utils/serviceIcons';

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
            style={[styles.card, service.status !== 'ACTIVE' && styles.cardDisabled, style]} 
            onPress={onPress}
            activeOpacity={0.7}
        >
            {(() => {
                // Always a tinted Lucide glyph — the seeded bannerImage/icon
                // photo URLs are duplicated across categories, so remote
                // images are deliberately not rendered here.
                const ServiceIcon = getServiceIcon(service);
                return (
                    <View style={styles.iconContainer}>
                        <ServiceIcon size={24} color={colors.primary} strokeWidth={2.5} />
                    </View>
                );
            })()}
            <Text style={styles.title} numberOfLines={2}>
                {service.name}
            </Text>
            {service.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                    {service.subtitle}
                </Text>
            ) : null}
            {renderStatusBadge()}
            
            {service.status === 'ACTIVE' && (
                <View style={styles.chevronWrap}>
                    <ChevronRight size={14} color={colors.primaryLight} strokeWidth={3} />
                </View>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.xl,
        padding: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 140,
        ...shadows.md,
        position: 'relative',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.divider,
    },
    cardDisabled: {
        opacity: 0.8,
        backgroundColor: colors.background,
    },
    cardAccent: {
        position: 'absolute',
        left: 0,
        top: '20%',
        bottom: '20%',
        width: 3,
        borderTopRightRadius: radii.sm,
        borderBottomRightRadius: radii.sm,
    },
    moreCard: {
        backgroundColor: colors.primaryLight + '20', // 20% opacity
        borderWidth: 1,
        borderColor: colors.primaryLight,
        borderStyle: 'dashed',
    },
    iconContainer: {
        width: 52,
        height: 52,
        borderRadius: radii.lg,
        backgroundColor: colors.primaryLight + '15',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.primaryLight + '30',
        overflow: 'hidden',
    },
    moreIconContainer: {
        backgroundColor: colors.primaryLight + '50',
    },
    title: {
        ...typography.bodyMedium,
        fontWeight: '700',
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: 2,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: 2,
    },
    badgeComingSoon: {
        position: 'absolute',
        top: spacing.sm,
        right: spacing.sm,
        backgroundColor: colors.warningLight,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.warning,
    },
    badgeText: {
        ...typography.caption,
        fontSize: 9,
        color: colors.warningDark,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    chevronWrap: {
        position: 'absolute',
        bottom: spacing.sm,
        right: spacing.sm,
        opacity: 0.7,
    },
});
