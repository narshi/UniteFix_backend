/**
 * Coming Soon Overlay — Displayed on all product/shop screens
 * Product ordering is halted per AI_CONTEXT.md §3.K
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShoppingBag, Clock } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useTranslation } from 'react-i18next';

export function ComingSoonOverlay() {
    const { t } = useTranslation();
    return (
        <View style={styles.container}>
            <View style={styles.iconContainer}>
                <View style={styles.iconCircle}>
                    <ShoppingBag size={48} color={colors.primary} />
                </View>
                <View style={styles.clockBadge}>
                    <Clock size={18} color={colors.textInverse} />
                </View>
            </View>

            <Text style={styles.title}>{t('shop.coming_soon')}</Text>
            <Text style={styles.subtitle}>
                {t('shop.subtitle1')}{'\n'}
                {t('shop.subtitle2')}
            </Text>

            <View style={styles.featureCard}>
                <Text style={styles.featureTitle}>{t('shop.whats_coming')}</Text>
                <Text style={styles.featureItem}>{t('shop.item1')}</Text>
                <Text style={styles.featureItem}>{t('shop.item2')}</Text>
                <Text style={styles.featureItem}>{t('shop.item3')}</Text>
            </View>

            <View style={styles.serviceBanner}>
                <Text style={styles.bannerText}>
                    {t('shop.banner')}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing['2xl'],
    },
    iconContainer: {
        position: 'relative',
        marginBottom: spacing.xl,
    },
    iconCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    clockBadge: {
        position: 'absolute',
        bottom: 0,
        right: -4,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.warning,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: colors.surface,
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: spacing.xl,
    },
    featureCard: {
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.xl,
        width: '100%',
        marginBottom: spacing.xl,
        borderWidth: 1,
        borderColor: colors.border,
    },
    featureTitle: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
        fontWeight: '700',
        marginBottom: spacing.md,
    },
    featureItem: {
        ...typography.body,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
        lineHeight: 24,
    },
    serviceBanner: {
        backgroundColor: colors.primarySurface,
        borderRadius: radii.lg,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        width: '100%',
    },
    bannerText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
        textAlign: 'center',
    },
});
