import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import * as LucideIcons from 'lucide-react-native';
const { Grid, ArrowRight } = LucideIcons;
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
            activeOpacity={0.75}
        >
            <View style={styles.iconContainer}>
                {(() => {
                    const ServiceIcon = getServiceIcon(service);
                    return <ServiceIcon size={24} color={colors.primary} strokeWidth={2.0} />;
                })()}
            </View>
            
            <Text style={styles.title} numberOfLines={2}>
                {service.name}
            </Text>
            
            <View style={styles.footer}>
                <Text style={styles.subtitle} numberOfLines={2}>
                    {service.subtitle || 'Professional service'}
                </Text>
                {service.status === 'ACTIVE' && (
                    <View style={styles.arrowWrap}>
                        <ArrowRight size={14} color={colors.primary} strokeWidth={2.5} />
                    </View>
                )}
            </View>
            
            {renderStatusBadge()}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        width: '100%',
        minHeight: 165,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 20,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(226, 232, 240, 0.6)',
        position: 'relative',
        ...shadows.sm,
        shadowOpacity: 0.05,
        elevation: 2,
    },
    cardDisabled: {
        opacity: 0.75,
    },
    moreCard: {
        backgroundColor: colors.primaryLight + '20', // 20% opacity
        borderWidth: 1,
        borderColor: colors.primaryLight,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconContainer: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    moreIconContainer: {
        backgroundColor: colors.primaryLight + '50',
    },
    title: {
        fontSize: 13.5,
        fontWeight: '700',
        lineHeight: 18,
        letterSpacing: -0.1,
        color: colors.textPrimary,
        marginBottom: 4,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginTop: 'auto',
    },
    subtitle: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 14,
        color: colors.textSecondary,
        marginRight: 6,
    },
    arrowWrap: {
        width: 28,
        height: 28,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
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
});
