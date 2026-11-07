/**
 * Customer Home, the cards below the header:
 *   SectionHeader    — "Home Services   View All →"
 *   ServicePhotoCard — a photo, a round icon badge and the name (four in a row)
 *   MoreCard         — a photo, an icon chip, a title, a short line and a go button (three in a row)
 *
 * Photos live in assets/home (see CREDITS.md there). Cards rise in one after another.
 *
 * Sizes are exact pixels worked out from the screen width (cardWidth). A photo
 * sized by width:'100%' + aspectRatio takes the image file's own height on
 * Android, which stretched the cards into tall strips.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Animated, Easing, ImageSourcePropType } from 'react-native';
import { ArrowRight, ChevronRight, LucideIcon } from 'lucide-react-native';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const shadow = { shadowColor: '#14243B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 };

function Rise({ index, style, children }: { index: number; style?: any; children: React.ReactNode }) {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(v, { toValue: 1, duration: 380, delay: 60 + index * 55, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [v, index]);
    return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{children}</Animated.View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>{title}</Text>
            {!!action && !!onAction && (
                <Pressable onPress={onAction} hitSlop={10} style={({ pressed }) => [styles.sectionAction, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`${action} ${title}`}>
                    <Text style={styles.sectionActionText} maxFontSizeMultiplier={1.3}>{action}</Text>
                    <ArrowRight size={17} color={brand.orange} strokeWidth={2.6} />
                </Pressable>
            )}
        </View>
    );
}

/** The width of each of `count` cards in a row that spans `rowWidth`, `gap` apart. */
export function cardWidth(rowWidth: number, count: number, gap: number) {
    return Math.floor((rowWidth - gap * (count - 1)) / count);
}

export function ServicePhotoCard({ index, width, label, photo, fallback, Icon, onPress }: { index: number; width: number; label: string; photo: ImageSourcePropType; fallback?: ImageSourcePropType; Icon: LucideIcon; onPress: () => void }) {
    const [failed, setFailed] = useState(false);
    return (
        <Rise index={index} style={{ width }}>
            <Pressable onPress={onPress} style={({ pressed }) => [styles.serviceCard, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
                <View>
                    <Image source={failed && fallback ? fallback : photo} onError={() => setFailed(true)} style={{ width: width - 2, height: Math.round(width * 0.92) }} resizeMode="cover" />
                    <View style={styles.serviceBadge}><Icon size={15} color={brand.orange} strokeWidth={2.4} /></View>
                </View>
                <Text style={styles.serviceLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.2}>{label}</Text>
            </Pressable>
        </Rise>
    );
}

/** Four grey cards the size of the real ones, while Home's cards load. */
export function ServicePhotoCardSkeleton({ width }: { width: number }) {
    return (
        <View style={[styles.serviceCard, { width, opacity: 0.6 }]}>
            <View style={{ width: width - 2, height: Math.round(width * 0.92), backgroundColor: brand.cardBorder }} />
            <View style={{ height: 14, marginHorizontal: 10, marginTop: 16, marginBottom: 12, borderRadius: 7, backgroundColor: brand.cardBorder }} />
        </View>
    );
}

/** `soon`: a "Coming soon" label instead of the go button (the tap explains). */
export function MoreCard({ index, width, title, line, photo, Icon, onPress, soon }: { index: number; width: number; title: string; line: string; photo: ImageSourcePropType; Icon: LucideIcon; onPress: () => void; soon?: string }) {
    return (
        <Rise index={index} style={{ width }}>
            <Pressable onPress={onPress} style={({ pressed }) => [styles.moreCard, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${title}. ${soon ?? line}`}>
                <View>
                    <Image source={photo} style={[{ width: width - 2, height: Math.round(width * 0.74) }, soon ? styles.photoSoon : null]} resizeMode="cover" />
                    <View style={styles.moreChip}><Icon size={15} color={brand.orange} strokeWidth={2.4} /></View>
                    {soon
                        ? <View style={styles.soon}><Text style={styles.soonText} numberOfLines={1} maxFontSizeMultiplier={1.1}>{soon}</Text></View>
                        : <View style={styles.moreGo}><ChevronRight size={14} color={brand.white} strokeWidth={3} /></View>}
                </View>
                {/* Titles may take two lines on narrow phones; the row keeps the cards one height. */}
                <View style={styles.moreBody}>
                    <Text style={styles.moreTitle} numberOfLines={2} maxFontSizeMultiplier={1.2}>{title}</Text>
                    <Text style={styles.moreLine} numberOfLines={2} maxFontSizeMultiplier={1.2}>{line}</Text>
                </View>
            </Pressable>
        </Rise>
    );
}

const styles = StyleSheet.create({
    pressed: { transform: [{ scale: 0.96 }], opacity: 0.92 },

    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    sectionTitle: { fontSize: 20, fontWeight: '800', color: brand.text, letterSpacing: -0.3 },
    sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    sectionActionText: { fontSize: 14, fontWeight: '700', color: brand.orange },

    serviceCard: { backgroundColor: brand.white, borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, overflow: 'hidden', ...shadow },
    serviceBadge: { position: 'absolute', left: 6, bottom: -13, width: 28, height: 28, borderRadius: 14, backgroundColor: brand.white, alignItems: 'center', justifyContent: 'center', ...shadow },
    serviceLabel: { fontSize: 12.5, fontWeight: '800', color: brand.text, textAlign: 'center', paddingHorizontal: 2, paddingTop: 16, paddingBottom: 10 },

    moreCard: { flex: 1, backgroundColor: brand.white, borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, overflow: 'hidden', ...shadow },
    photoSoon: { opacity: 0.82 },
    soon: { position: 'absolute', right: 6, bottom: -10, backgroundColor: brand.navy, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 2, borderColor: brand.white },
    soonText: { fontSize: 9.5, fontWeight: '800', color: brand.white, letterSpacing: 0.3 },
    moreChip: { position: 'absolute', left: 7, top: 7, width: 28, height: 28, borderRadius: 14, backgroundColor: brand.white, alignItems: 'center', justifyContent: 'center', ...shadow },
    moreBody: { paddingHorizontal: 9, paddingTop: 12, paddingBottom: 11 },
    moreTitle: { fontSize: 13.5, lineHeight: 17, fontWeight: '800', color: brand.text },
    moreLine: { fontSize: 11, lineHeight: 15, color: brand.textSecondary, marginTop: 3 },
    moreGo: { position: 'absolute', right: 8, bottom: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: brand.orange, borderWidth: 2, borderColor: brand.white, alignItems: 'center', justifyContent: 'center' },
});
