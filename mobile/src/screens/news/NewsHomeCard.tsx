/**
 * Newspapers on the Home screen: today's front pages of the papers the
 * customer follows, or an invitation to pick their local papers. Hidden until
 * at least one paper is live on UniteFix.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, ChevronRight } from 'lucide-react-native';
import { apiClient } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { newsDay, NEWS_INK, NEWS_PAPER, NEWS_RED } from './newsKit';
import type { FeedItem } from './NewsScreen';

export function NewsHomeCard({ navigation }: { navigation: any }) {
    const papers = useQuery<{ papers: Array<{ id: number; following: boolean }> }>({ queryKey: ['news', 'papers'], queryFn: async () => (await apiClient.get('/api/news/papers')).data.data, staleTime: 5 * 60_000 });
    const followed = (papers.data?.papers ?? []).some(p => p.following);
    const feed = useQuery<FeedItem[]>({ queryKey: ['news', 'feed'], queryFn: async () => (await apiClient.get('/api/news/feed')).data.data, enabled: followed, staleTime: 60_000 });
    if (!papers.data?.papers.length) return null;
    const items = (feed.data ?? []).slice(0, 8);

    if (!followed || !items.length) {
        return (
            <TouchableOpacity style={s.invite} onPress={() => navigation.navigate('News', { tab: followed ? 'today' : 'all' })} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.inviteIcon}><Newspaper size={20} color={NEWS_RED} strokeWidth={2.2} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.inviteTitle}>Newspapers</Text>
                    <Text style={s.inviteSub}>{followed ? 'Your papers\' new editions will appear here' : 'Read your local papers free, every morning'}</Text>
                </View>
                <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
        );
    }

    return (
        <View style={s.box}>
            <TouchableOpacity style={s.head} onPress={() => navigation.navigate('News')} accessibilityRole="button" accessibilityLabel="All newspapers">
                <Text style={s.title}>Today's papers</Text>
                <View style={s.more}><Text style={s.moreText}>All</Text><ChevronRight size={16} color={NEWS_RED} /></View>
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
                {items.map(e => (
                    <TouchableOpacity key={e.id} style={s.page} onPress={() => navigation.navigate('NewsReader', { editionId: e.id, paper: e.paper, date: e.editionDate })}
                        accessibilityRole="button" accessibilityLabel={`${e.paper}, ${newsDay(e.editionDate)}`}>
                        <View style={s.thumb}>
                            {e.previewUrl ? <Image source={{ uri: e.previewUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" /> : <Newspaper size={28} color={colors.textTertiary} />}
                            {!e.read && <View style={s.dot} />}
                        </View>
                        <Text style={s.paper} numberOfLines={1}>{e.paper}</Text>
                        <Text style={s.day} numberOfLines={1}>{newsDay(e.editionDate)}{e.title !== 'Main edition' ? ` · ${e.title}` : ''}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    invite: { flexDirection: 'row', alignItems: 'center', backgroundColor: NEWS_PAPER, borderRadius: radii.lg, padding: spacing.base, marginBottom: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: '#E6DECD' },
    inviteIcon: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    inviteTitle: { ...typography.bodySemibold, color: NEWS_INK },
    inviteSub: { ...typography.caption, color: colors.textSecondary },
    box: { backgroundColor: NEWS_PAPER, borderRadius: radii.lg, paddingVertical: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: '#E6DECD' },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, minHeight: 32 },
    title: { ...typography.bodySemibold, color: NEWS_INK },
    more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    moreText: { ...typography.captionMedium, color: NEWS_RED },
    row: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, gap: spacing.md },
    page: { width: 104 },
    thumb: { width: 104, height: 128, borderRadius: radii.sm, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', ...shadows.xs },
    dot: { position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: NEWS_RED, borderWidth: 2, borderColor: '#fff' },
    paper: { ...typography.captionMedium, color: NEWS_INK, marginTop: 6 },
    day: { ...typography.small, color: colors.textSecondary },
});
