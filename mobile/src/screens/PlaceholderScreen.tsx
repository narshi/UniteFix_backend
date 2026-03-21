/**
 * Placeholder screen — used during development for unimplemented tabs
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

export function PlaceholderScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.emoji}>🚧</Text>
            <Text style={styles.text}>Coming Soon</Text>
            <Text style={styles.subtext}>This screen is under construction</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    emoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    text: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    subtext: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 8,
    },
});
