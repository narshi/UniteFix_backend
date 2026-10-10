/**
 * Newspapers — the reader's local papers.
 *
 *   Today        the latest editions of the papers you follow
 *   All papers   every paper on UniteFix, by language; follow the ones you read
 *
 * Reading is free. Following a paper means a notification when each new
 * edition comes out.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Newspaper, Search, Check, Plus, BookOpen } from 'lucide-react-native';
import { apiClient } from '../../api/client';
import { ScreenHeader, EmptyState } from '../../components/ui';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { newsDay, NEWS_INK, NEWS_PAPER, NEWS_RED } from './newsKit';

export type FeedItem = { id: number; paperId: number; paper: string; logoUrl: string | null; language: string; editionDate: string; title: string; headline: string | null; pageCount: number; previewUrl: string | null; shareUrl: string; read?: boolean };
type PaperCard = { id: number; name: string; language: string; languageLabel: string; city: string | null; frequency: string; description: string | null; logoUrl: string | null; followers: number; following: boolean; latest: FeedItem | null };

export function useFollow() {
    const qc = useQueryClient();
    const [busy, setBusy] = useState<number | null>(null);
    const toggle = async (paperId: number, on: boolean, source = 'app') => {
        setBusy(paperId);
        try {
            await apiClient.post(`/api/news/papers/${paperId}/follow`, { on, source });
            await Promise.all([qc.invalidateQueries({ queryKey: ['news'] })]);
        } finally { setBusy(null); }
    };
    return { toggle, busy };
}

export function FollowButton({ following, busy, onPress, compact }: { following: boolean; busy: boolean; onPress: () => void; compact?: boolean }) {
    return (
        <TouchableOpacity onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: following, busy }}
            style={[s.follow, following ? s.following : s.notFollowing, compact && s.followCompact]}>
            {busy ? <ActivityIndicator size="small" color={following ? NEWS_INK : '#fff'} />
                : <>{following ? <Check size={15} color={NEWS_INK} /> : <Plus size={15} color="#fff" />}<Text style={[s.followText, { color: following ? NEWS_INK : '#fff' }]}>{following ? 'Following' : 'Follow'}</Text></>}
        </TouchableOpacity>
    );
}

export function NewsScreen({ navigation, route }: any) {
    const { scrollBottom } = useScreenInsets();
    const [tab, setTab] = useState<'today' | 'all'>(route?.params?.tab ?? 'today');
    const [lang, setLang] = useState<string | null>(null);
    const [q, setQ] = useState('');
    const { toggle, busy } = useFollow();
    const feed = useQuery<FeedItem[]>({ queryKey: ['news', 'feed'], queryFn: async () => (await apiClient.get('/api/news/feed')).data.data });
    const papers = useQuery<{ papers: PaperCard[] }>({ queryKey: ['news', 'papers'], queryFn: async () => (await apiClient.get('/api/news/papers')).data.data });
    const all = papers.data?.papers ?? [];
    const langs = useMemo(() => Array.from(new Map(all.map(p => [p.language, p.languageLabel])).entries()), [all]);
    const shown = all.filter(p => (!lang || p.language === lang) && (!q.trim() || `${p.name} ${p.city ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
    const following = all.filter(p => p.following).length;
    const openEdition = (e: FeedItem) => navigation.navigate('NewsReader', { editionId: e.id, paper: e.paper, date: e.editionDate });
    const refreshing = feed.isRefetching || papers.isRefetching;
    const refresh = () => { void feed.refetch(); void papers.refetch(); };

    const header = (
        <View style={s.tabs} accessibilityRole="tablist">
            {([['today', 'Today'], ['all', 'All papers']] as const).map(([k, label]) => (
                <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
                    <Text style={[s.tabText, tab === k && s.tabTextOn]}>{label}{k === 'all' && following ? `  ·  ${following} followed` : ''}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );

    return (
        <View style={s.screen}>
            <ScreenHeader title="Newspapers" onBack={() => navigation.goBack()} />
            {header}
            {tab === 'today' ? (
                <FlatList
                    data={feed.data ?? []}
                    keyExtractor={e => String(e.id)}
                    contentContainerStyle={[s.list, { paddingBottom: scrollBottom }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
                    ListEmptyComponent={feed.isLoading ? <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={NEWS_RED} /> : (
                        <EmptyState icon={<Newspaper size={40} color={colors.textTertiary} />} title={following ? 'No new editions yet' : 'Follow your local papers'}
                            description={following ? 'New editions of the papers you follow appear here the moment they come out.' : 'Read them free, and get a notification the moment each new edition comes out.'}
                            actionLabel={following ? undefined : 'Choose papers'} onAction={following ? undefined : () => setTab('all')} />
                    )}
                    renderItem={({ item: e }) => (
                        <TouchableOpacity style={s.edition} onPress={() => openEdition(e)} accessibilityRole="button" accessibilityLabel={`${e.paper}, ${newsDay(e.editionDate)}${e.title !== 'Main edition' ? `, ${e.title}` : ''}`}>
                            <View style={s.previewBox}>
                                {e.previewUrl ? <Image source={{ uri: e.previewUrl }} style={s.preview} contentFit="cover" contentPosition="top" transition={150} /> : <Newspaper size={36} color={colors.textTertiary} />}
                                {!e.read && <View style={s.newBadge}><Text style={s.newBadgeText}>NEW</Text></View>}
                            </View>
                            <View style={s.editionBody}>
                                <Text style={s.paperName} numberOfLines={1}>{e.paper}</Text>
                                <Text style={s.meta} numberOfLines={1}>{newsDay(e.editionDate)}{e.title !== 'Main edition' ? ` · ${e.title}` : ''} · {e.pageCount} pages</Text>
                                {e.headline ? <Text style={s.headline} numberOfLines={2}>{e.headline}</Text> : null}
                                <View style={s.readRow}><BookOpen size={14} color={NEWS_RED} /><Text style={s.readText}>{e.read ? 'Read again' : 'Read now'}</Text></View>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={p => String(p.id)}
                    contentContainerStyle={[s.list, { paddingBottom: scrollBottom }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={
                        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                            <View style={s.search}><Search size={16} color={colors.textTertiary} />
                                <TextInput value={q} onChangeText={setQ} placeholder="Search by paper or town" placeholderTextColor={colors.textTertiary} style={s.searchInput} returnKeyType="search" accessibilityLabel="Search papers" />
                            </View>
                            {langs.length > 1 && (
                                <View style={s.chips}>
                                    {[[null, 'All'] as const, ...langs].map(([v, label]) => (
                                        <TouchableOpacity key={v ?? 'all'} onPress={() => setLang(v)} style={[s.chip, lang === v && s.chipOn]} accessibilityState={{ selected: lang === v }}>
                                            <Text style={[s.chipText, lang === v && s.chipTextOn]}>{label}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                        </View>
                    }
                    ListEmptyComponent={papers.isLoading ? <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={NEWS_RED} /> : (
                        <EmptyState icon={<Newspaper size={40} color={colors.textTertiary} />} title={all.length ? 'No paper matches' : 'Papers are joining soon'} description={all.length ? 'Try another name or town.' : 'Local newspapers are coming to UniteFix. Check back soon.'} />
                    )}
                    renderItem={({ item: p }) => (
                        <TouchableOpacity style={s.paper} onPress={() => navigation.navigate('NewsPaper', { paperId: p.id })} accessibilityRole="button" accessibilityLabel={p.name}>
                            <View style={s.logoBox}>{p.logoUrl ? <Image source={{ uri: p.logoUrl }} style={s.logo} contentFit="contain" /> : <Text style={s.logoLetter}>{p.name.slice(0, 1)}</Text>}</View>
                            <View style={s.paperBody}>
                                <Text style={s.paperName} numberOfLines={2}>{p.name}</Text>
                                <Text style={s.meta} numberOfLines={1}>{p.languageLabel}{p.city ? ` · ${p.city}` : ''}</Text>
                                <Text style={s.metaSmall} numberOfLines={1}>{p.latest ? `Latest: ${newsDay(p.latest.editionDate)}` : 'No edition yet'}{p.followers >= 10 ? ` · ${p.followers.toLocaleString('en-IN')} readers` : ''}</Text>
                            </View>
                            <FollowButton compact following={p.following} busy={busy === p.id} onPress={() => toggle(p.id, !p.following)} />
                        </TouchableOpacity>
                    )}
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: NEWS_PAPER },
    tabs: { flexDirection: 'row', marginHorizontal: spacing.base, marginTop: spacing.sm, marginBottom: spacing.xs, backgroundColor: '#EAE4D6', borderRadius: radii.full, padding: 3 },
    tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.full, paddingHorizontal: spacing.sm },
    tabOn: { backgroundColor: '#fff', ...shadows.xs },
    tabText: { ...typography.captionMedium, color: colors.textSecondary },
    tabTextOn: { color: NEWS_INK, fontWeight: '700' },
    list: { padding: spacing.base, gap: spacing.md, flexGrow: 1 },
    edition: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: radii.lg, overflow: 'hidden', ...shadows.sm },
    previewBox: { width: 108, minHeight: 132, backgroundColor: '#F1EEE7', alignItems: 'center', justifyContent: 'center' },
    preview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    newBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: NEWS_RED, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
    newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
    editionBody: { flex: 1, minWidth: 0, padding: spacing.md, gap: 3 },
    paperName: { ...typography.bodySemibold, color: NEWS_INK },
    meta: { ...typography.caption, color: colors.textSecondary },
    metaSmall: { ...typography.small, color: colors.textTertiary },
    headline: { ...typography.body, color: NEWS_INK, marginTop: 2 },
    readRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 'auto', paddingTop: spacing.xs },
    readText: { ...typography.captionMedium, color: NEWS_RED },
    paper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#fff', borderRadius: radii.lg, padding: spacing.md, ...shadows.xs },
    logoBox: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: '#F1EEE7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
    logo: { width: 52, height: 52 },
    logoLetter: { fontSize: 24, fontWeight: '800', color: NEWS_INK },
    paperBody: { flex: 1, minWidth: 0, gap: 2 },
    follow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 40, minWidth: 104, paddingHorizontal: spacing.md, borderRadius: radii.full, flexShrink: 0 },
    followCompact: { minWidth: 96 },
    notFollowing: { backgroundColor: NEWS_RED },
    following: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#CFC6B4' },
    followText: { ...typography.captionMedium, fontWeight: '700' },
    search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#fff', borderRadius: radii.md, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: '#E3DCCD' },
    searchInput: { flex: 1, minHeight: 44, ...typography.body, color: NEWS_INK },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, minHeight: 34, justifyContent: 'center', borderRadius: radii.full, borderWidth: 1, borderColor: '#D8D0BF', backgroundColor: '#fff' },
    chipOn: { backgroundColor: NEWS_INK, borderColor: NEWS_INK },
    chipText: { ...typography.caption, color: NEWS_INK },
    chipTextOn: { color: '#fff', fontWeight: '700' },
});
