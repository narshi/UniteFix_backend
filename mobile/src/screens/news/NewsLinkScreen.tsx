/**
 * Where a newspaper link from WhatsApp or a QR code lands: a shared edition
 * opens straight in the reader; a paper's follow link opens the paper and
 * follows it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Newspaper } from 'lucide-react-native';
import { apiClient } from '../../api/client';
import { ScreenHeader, EmptyState } from '../../components/ui';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { NEWS_PAPER, NEWS_RED } from './newsKit';

export function NewsLinkScreen({ navigation, route }: any) {
    const token: string | undefined = route.params?.token;
    const code: string | undefined = route.params?.code;
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let on = true;
        (async () => {
            try {
                if (token) {
                    const e = (await apiClient.get(`/api/news/e/${encodeURIComponent(token)}`)).data.data;
                    if (!on) return;
                    if (e.available) navigation.replace('NewsReader', { editionId: e.id, paper: e.paper, date: e.editionDate });
                    else {
                        const p = (await apiClient.get(`/api/public/news/p/${encodeURIComponent(e.paperCode)}`)).data.data;
                        if (on) navigation.replace('NewsPaper', { paperId: p.id });
                    }
                } else if (code) {
                    const p = (await apiClient.get(`/api/public/news/p/${encodeURIComponent(code)}`)).data.data;
                    if (on) navigation.replace('NewsPaper', { paperId: p.id, followFromLink: true });
                } else setFailed(true);
            } catch { if (on) setFailed(true); }
        })();
        return () => { on = false; };
    }, [token, code]);

    return (
        <View style={s.screen}>
            <ScreenHeader title="Newspaper" onBack={() => navigation.goBack()} />
            {failed ? (
                <EmptyState icon={<Newspaper size={40} color={colors.textTertiary} />} title="This link is not valid any more" description="The paper may no longer be on UniteFix. Find your local papers here."
                    actionLabel="See all papers" onAction={() => navigation.replace('News', { tab: 'all' })} />
            ) : (
                <View style={s.center}><ActivityIndicator color={NEWS_RED} /><Text style={s.text}>Opening…</Text></View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: NEWS_PAPER },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    text: { ...typography.caption, color: colors.textSecondary },
});
