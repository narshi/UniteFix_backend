/**
 * Reading an edition. The app asks for a signed reader link (it expires in 30
 * minutes, and counts the read for the paper) and shows UniteFix's reader in a
 * WebView: every page, drawn as you scroll, with zoom.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { useQueryClient } from '@tanstack/react-query';
import { Share2, RotateCw } from 'lucide-react-native';
import { apiClient, API_BASE_URL } from '../../api/client';
import { ScreenHeader } from '../../components/ui';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { newsDay, shareEdition, NEWS_RED } from './newsKit';

type Opened = { url: string; edition: { id: number; paper: string; editionDate: string; title: string; headline: string | null; pageCount: number; shareUrl: string } };

export function NewsReaderScreen({ navigation, route }: any) {
    const editionId: number = route.params?.editionId;
    const qc = useQueryClient();
    const [opened, setOpened] = useState<Opened | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pages, setPages] = useState<{ page: number; of: number } | null>(null);
    const [webFailed, setWebFailed] = useState(false);

    const open = useCallback(async () => {
        setError(null); setWebFailed(false); setOpened(null);
        try {
            const r = await apiClient.post(`/api/news/editions/${editionId}/open`, {});
            setOpened(r.data.data);
            void qc.invalidateQueries({ queryKey: ['news', 'feed'] });
        } catch (e: any) {
            const status = e?.response?.status;
            setError(status === 410 || status === 404 ? 'This edition is no longer available. Papers keep their editions for a few days.' : 'Could not open the edition. Check your connection and try again.');
        }
    }, [editionId, qc]);
    useEffect(() => { void open(); }, [open]);

    const paper = opened?.edition.paper ?? route.params?.paper ?? 'Newspaper';
    const date = opened?.edition.editionDate ?? route.params?.date;
    const title = date ? `${paper} · ${newsDay(date)}` : paper;
    const share = opened ? (
        <TouchableOpacity onPress={() => shareEdition(opened.edition)} accessibilityRole="button" accessibilityLabel="Share this edition" style={s.iconBtn}><Share2 size={20} color="#fff" /></TouchableOpacity>
    ) : undefined;

    const onMessage = (ev: { nativeEvent: { data: string } }) => {
        try {
            const m = JSON.parse(ev.nativeEvent.data);
            if (m.type === 'pages') setPages({ page: 1, of: m.pages });
            if (m.type === 'page') setPages(p => (p ? { ...p, page: m.page } : p));
        } catch { /* not ours */ }
    };

    return (
        <View style={s.screen}>
            <ScreenHeader title={title} onBack={() => navigation.goBack()} rightAction={share} />
            {pages && pages.of > 1 ? <Text style={s.pageLine} accessibilityLiveRegion="polite">Page {pages.page} of {pages.of}</Text> : null}
            {error || webFailed ? (
                <View style={s.center}>
                    <Text style={s.msg}>{error ?? 'The reader could not load. Check your connection and try again.'}</Text>
                    {!error?.startsWith('This edition') && (
                        <TouchableOpacity onPress={open} style={s.retry} accessibilityRole="button"><RotateCw size={16} color="#fff" /><Text style={s.retryText}>Try again</Text></TouchableOpacity>
                    )}
                </View>
            ) : !opened ? (
                <View style={s.center}><ActivityIndicator color="#fff" /><Text style={s.msgSoft}>Opening the paper…</Text></View>
            ) : (
                <WebView
                    source={{ uri: `${API_BASE_URL}${opened.url}` }}
                    style={s.web}
                    originWhitelist={['https://*', 'http://*']}
                    onMessage={onMessage}
                    onError={() => setWebFailed(true)}
                    onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setWebFailed(true); }}
                    startInLoadingState
                    renderLoading={() => <View style={[StyleSheet.absoluteFill, s.center]}><ActivityIndicator color="#fff" /></View>}
                    setSupportMultipleWindows={false}
                    allowsBackForwardNavigationGestures={false}
                    pullToRefreshEnabled={false}
                    javaScriptEnabled
                    domStorageEnabled
                    onShouldStartLoadWithRequest={(req) => {
                        // Stay on the reader; anything else (a link printed in the paper) opens in the browser.
                        if (req.url.startsWith(API_BASE_URL) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
                        void Linking.openURL(req.url).catch(() => undefined);
                        return false;
                    }}
                />
            )}
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#3A3631' },
    web: { flex: 1, backgroundColor: '#3A3631' },
    iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: NEWS_RED, borderRadius: radii.full },
    pageLine: { ...typography.small, color: '#E8E2D6', textAlign: 'center', paddingBottom: spacing.xs, backgroundColor: '#3A3631' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: '#3A3631' },
    msg: { ...typography.body, color: '#fff', textAlign: 'center' },
    msgSoft: { ...typography.caption, color: '#D6CFC2' },
    retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: NEWS_RED, paddingHorizontal: spacing.lg, minHeight: 44, borderRadius: radii.full },
    retryText: { ...typography.button, color: '#fff' },
});
