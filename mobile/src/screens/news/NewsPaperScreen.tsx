/**
 * A newspaper: its masthead, follow, and the editions readers can open (the
 * last 3 days, or 30 when the paper keeps an archive). Opened from the
 * papers list, or from the paper's follow link — which follows it for you.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Share2, Newspaper, ChevronRight, BellRing } from 'lucide-react-native';
import { apiClient } from '../../api/client';
import { ScreenHeader, EmptyState } from '../../components/ui';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { FollowButton, useFollow, type FeedItem } from './NewsScreen';
import { newsDay, sharePaper, NEWS_INK, NEWS_PAPER, NEWS_RED } from './newsKit';

type Paper = {
    id: number; code: string | null; name: string; languageLabel: string; city: string | null; frequency: string; description: string | null; logoUrl: string | null;
    followers: number; following: boolean; keepsDays: number; shareUrl: string | null; editions: FeedItem[];
};

export function NewsPaperScreen({ navigation, route }: any) {
    const { scrollBottom } = useScreenInsets();
    const paperId: number = route.params?.paperId;
    const followFromLink: boolean = !!route.params?.followFromLink;
    const { toggle, busy } = useFollow();
    const q = useQuery<Paper>({ queryKey: ['news', 'paper', paperId], queryFn: async () => (await apiClient.get(`/api/news/papers/${paperId}`)).data.data, enabled: !!paperId });
    const [joined, setJoined] = useState(false);
    const autoFollowed = useRef(false);
    const p = q.data;

    // Opened from the paper's follow link: that tap was the reader asking to follow.
    useEffect(() => {
        if (!p || !followFromLink || autoFollowed.current) return;
        autoFollowed.current = true;
        if (!p.following) toggle(p.id, true, 'link').then(() => setJoined(true)).catch(() => undefined);
    }, [p, followFromLink]);

    const share = p?.shareUrl ? (
        <TouchableOpacity onPress={() => sharePaper(p)} accessibilityRole="button" accessibilityLabel="Share this paper" style={s.iconBtn}><Share2 size={20} color={NEWS_INK} /></TouchableOpacity>
    ) : undefined;

    if (q.isError) return (
        <View style={s.screen}>
            <ScreenHeader title="Newspaper" onBack={() => navigation.goBack()} />
            <EmptyState icon={<Newspaper size={40} color={colors.textTertiary} />} title="This paper is not available" description="It may have stopped publishing on UniteFix." actionLabel="See all papers" onAction={() => navigation.replace('News', { tab: 'all' })} />
        </View>
    );
    if (!p) return (
        <View style={s.screen}>
            <ScreenHeader title="Newspaper" onBack={() => navigation.goBack()} />
            <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={NEWS_RED} />
        </View>
    );

    return (
        <View style={s.screen}>
            <ScreenHeader title={p.name} onBack={() => navigation.goBack()} rightAction={share} />
            <ScrollView contentContainerStyle={[s.content, { paddingBottom: scrollBottom }]} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
                <View style={s.mast}>
                    {p.logoUrl ? <Image source={{ uri: p.logoUrl }} style={s.logo} contentFit="contain" accessibilityLabel={`${p.name} masthead`} /> : null}
                    <Text style={s.name}>{p.name}</Text>
                    <Text style={s.mastMeta}>{[p.languageLabel, p.city, p.frequency].filter(Boolean).join('  ·  ')}</Text>
                    {p.description ? <Text style={s.desc}>{p.description}</Text> : null}
                    <View style={s.followRow}>
                        <FollowButton following={p.following} busy={busy === p.id} onPress={() => toggle(p.id, !p.following)} />
                        <Text style={s.followers}>{p.followers.toLocaleString('en-IN')} {p.followers === 1 ? 'reader follows' : 'readers follow'}</Text>
                    </View>
                    {joined && <View style={s.joined}><BellRing size={16} color={NEWS_RED} /><Text style={s.joinedText}>You follow {p.name}. We'll tell you when each new edition is out.</Text></View>}
                </View>

                <Text style={s.section}>Editions</Text>
                {!p.editions.length ? <Text style={s.none}>No edition in the last {p.keepsDays} days.</Text> : p.editions.map(e => (
                    <TouchableOpacity key={e.id} style={s.edition} onPress={() => navigation.navigate('NewsReader', { editionId: e.id, paper: p.name, date: e.editionDate })} accessibilityRole="button" accessibilityLabel={`${newsDay(e.editionDate)}${e.title !== 'Main edition' ? `, ${e.title}` : ''}`}>
                        <View style={s.thumb}>{e.previewUrl ? <Image source={{ uri: e.previewUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" /> : <Newspaper size={24} color={colors.textTertiary} />}</View>
                        <View style={s.edBody}>
                            <Text style={s.edDay}>{newsDay(e.editionDate)}{e.title !== 'Main edition' ? ` · ${e.title}` : ''}</Text>
                            {e.headline ? <Text style={s.edHead} numberOfLines={2}>{e.headline}</Text> : null}
                            <Text style={s.edMeta}>{e.pageCount} pages</Text>
                        </View>
                        <ChevronRight size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                ))}
                <Text style={s.keeps}>{p.name} keeps the last {p.keepsDays} days of editions on UniteFix.</Text>
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: NEWS_PAPER },
    content: { padding: spacing.base, gap: spacing.md },
    iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    mast: { backgroundColor: '#fff', borderRadius: radii.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, borderTopWidth: 3, borderTopColor: NEWS_INK, ...shadows.sm },
    logo: { width: '100%', height: 64 },
    name: { ...typography.h3, color: NEWS_INK, textAlign: 'center' },
    mastMeta: { ...typography.small, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
    desc: { ...typography.body, color: '#3D372F', textAlign: 'center' },
    followRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap', justifyContent: 'center', marginTop: spacing.xs },
    followers: { ...typography.caption, color: colors.textSecondary },
    joined: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: '#FBECEA', padding: spacing.md, borderRadius: radii.md, alignSelf: 'stretch' },
    joinedText: { ...typography.caption, color: NEWS_INK, flex: 1 },
    section: { ...typography.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.sm },
    none: { ...typography.body, color: colors.textSecondary },
    edition: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#fff', borderRadius: radii.lg, padding: spacing.sm, paddingRight: spacing.md, ...shadows.xs },
    thumb: { width: 64, height: 76, borderRadius: radii.sm, backgroundColor: '#F1EEE7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    edBody: { flex: 1, minWidth: 0, gap: 2 },
    edDay: { ...typography.bodySemibold, color: NEWS_INK },
    edHead: { ...typography.caption, color: '#3D372F' },
    edMeta: { ...typography.small, color: colors.textTertiary },
    keeps: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
});
