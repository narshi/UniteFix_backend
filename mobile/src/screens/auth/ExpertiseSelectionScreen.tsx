/**
 * ExpertiseSelectionScreen — mandatory trade step for new service experts.
 *
 * Final step of the onboarding stack (technicians only). The expert ticks the
 * trades they work in — Electrician, CCTV Technician, Plumber — from the
 * admin-curated `technician_types` list, and at least one is required. The
 * server enforces that too (PATCH /api/partner/profile/expertise rejects an
 * empty array), so it cannot be skipped by a client that misbehaves.
 *
 * This list is deliberately NOT the service catalogue. The catalogue describes
 * what a customer buys ("Cartridge Replacement", "Footage Backup"); this
 * describes what the expert does, in the words they would use about themselves.
 * An expert whose trade is missing adds it here and it becomes a real
 * technician type for an admin to curate.
 *
 * Selections are stored on employees.services and shown to admins on the
 * assignment queue as context when they pick someone for a booking.
 *
 * Flow: OnboardingProfile → OnboardingLocation → ExpertiseSelection
 *       → RootNavigator switches to the partner app / pending-verification screen
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { Check, ChevronLeft, Search, Plus, X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../api/client';
import { useScreenInsets } from '../../theme/layout';
import { useNavigation } from '@react-navigation/native';
import {
  sanitizeTradeName,
  hasDisallowedTradeChars,
  validateTradeName,
  nameKey,
} from '../../utils/nameInput';

interface TradeOption {
  id: number;
  name: string;                // the trade name, which is what gets saved
  description?: string | null; // optional hint, shown underneath
}

/**
 * Shown only if the request fails, so signup is never blocked by a network
 * blip. These mirror the seeded technician_types rather than inventing trades:
 * the previous fallback listed granular services like "Fan Installation &
 * Repair" that existed nowhere in the catalogue, so an expert who hit it during
 * an outage ended up with skills no booking could ever match.
 */
const FALLBACK_OPTIONS: TradeOption[] = [
  { id: -1, name: 'Computer Technician' },
  { id: -2, name: 'Printer Technician' },
  { id: -3, name: 'CCTV Technician' },
  { id: -4, name: 'Biometric Device Technician' },
  { id: -5, name: 'UPS & Battery Technician' },
  { id: -6, name: 'Solar Technician' },
  { id: -7, name: 'Water Purifier Technician' },
  { id: -8, name: 'Networking & Internet Technician' },
  { id: -9, name: 'Electrician' },
  { id: -10, name: 'Plumber' },
  { id: -11, name: 'Carpenter' },
  { id: -12, name: 'Painter' },
  { id: -13, name: 'AC Technician' },
  { id: -14, name: 'Appliance Repair Technician' },
];

export function ExpertiseSelectionScreen() {
  const { bottomBar: bottomPad } = useScreenInsets();
  // The session already exists by the time this screen renders — it is the last
  // step of the onboarding stack, so the normal apiClient interceptor supplies
  // the token.
  const refreshOnboardingStatus = useAuthStore((s) => s.refreshOnboardingStatus);
  const navigation = useNavigation<any>();

  const [options, setOptions] = useState<TradeOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [customText, setCustomText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<TradeOption>>(null);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setIsLoading(true);
      // Public endpoint — the admin-curated trade list, already ordered by
      // sortOrder then name, so it is rendered in the order it arrives rather
      // than re-sorted alphabetically here.
      const { data } = await apiClient.get('/api/technician-types');
      const list: TradeOption[] = Array.isArray(data?.data) ? data.data : [];
      setOptions(list.length > 0 ? list : FALLBACK_OPTIONS);
    } catch (err: any) {
      console.warn('[EXPERTISE] Failed to fetch technician types:', err?.message);
      setOptions(FALLBACK_OPTIONS);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q)
    );
  }, [query, options]);

  const toggle = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
    setError(null);
  };

  /**
   * Adds a trade the expert could not find.
   *
   * Sent to the server rather than kept as local free text, so it becomes a real
   * technician type an admin can rename, adopt or remove — and so the next
   * expert with the same trade finds it already listed. The server dedupes
   * case-insensitively, so "electrician" resolves to an existing "Electrician"
   * instead of creating a near-duplicate.
   */
  const addCustom = async () => {
    const value = customText.trim();
    if (!value || isAddingCustom) return;

    const lengthError = validateTradeName(value);
    if (lengthError) {
      setError(lengthError);
      return;
    }

    const key = nameKey(value);

    // Already ticked — say so instead of silently doing nothing, which read as
    // a broken button.
    if (selected.some((s) => nameKey(s) === key)) {
      setError(`You have already added "${value}".`);
      return;
    }

    // Already in the curated list — tick it rather than asking the server to
    // create a duplicate. The server dedupes case-insensitively too, but this
    // way the expert sees the existing entry get selected, and a search that
    // simply missed the row (different spacing, different case) still works.
    const existing = options.find((o) => nameKey(o.name) === key);
    if (existing) {
      setSelected((prev) => [...prev, existing.name]);
      setCustomText('');
      setQuery('');
      setError(null);
      return;
    }

    setIsAddingCustom(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/api/technician-types/suggest', { name: value });
      const created = data?.data;
      const name: string = created?.name ?? value;

      // Show it in the list immediately so the tick is visible, not just chipped.
      // The server may return a canonical spelling ("electrician" -> "Electrician"),
      // so dedupe on the returned name, not the typed one.
      setOptions((prev) =>
        prev.some((o) => nameKey(o.name) === nameKey(name))
          ? prev
          : [...prev, { id: created?.id ?? -Date.now(), name }],
      );
      setSelected((prev) =>
        prev.some((s) => nameKey(s) === nameKey(name)) ? prev : [...prev, name],
      );
      setCustomText('');
      setQuery('');
    } catch (err: any) {
      // Offline or rejected — keep it locally so signup is not blocked. The
      // name still saves onto the profile; it just is not in the shared list.
      setSelected((prev) =>
        prev.some((s) => nameKey(s) === key) ? prev : [...prev, value],
      );
      setCustomText('');
      console.warn('[EXPERTISE] Could not register trade:', err?.message);
    } finally {
      setIsAddingCustom(false);
    }
  };

  const handleContinue = async () => {
    if (selected.length === 0) {
      setError('Please tick at least one trade to continue');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.patch('/api/partner/profile/expertise', { services: selected });

      // Trades now come before location, so ask the server what is still
      // outstanding rather than assuming. This screen is reached both during
      // signup (location still pending) and when an expert returns to finish an
      // interrupted one (location already supplied).
      await refreshOnboardingStatus();
      const pending = useAuthStore.getState().user?.pendingOnboardingSteps ?? [];

      if (pending.includes('location')) {
        navigation.navigate('OnboardingLocation');
      } else {
        navigation.navigate('ExpertCodeOfConduct');
      }
    } catch (err: any) {
      console.error('[EXPERTISE] Save failed:', err?.message);
      setError(
        err?.response?.data?.message ||
        'Could not save your skills. Please check your connection and try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const renderRow = ({ item }: { item: TradeOption }) => {
    const isSelected = selected.includes(item.name);
    return (
      <Pressable
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => toggle(item.name)}
      >
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowName, isSelected && styles.rowNameSelected]}>{item.name}</Text>
          {!!item.description && <Text style={styles.rowCategory}>{item.description}</Text>}
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Check size={15} color={colors.textInverse} strokeWidth={3} />}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          {navigation.canGoBack() && (
            <Pressable style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={12}>
              <ChevronLeft size={24} color={colors.textPrimary} />
            </Pressable>
          )}
          <Text style={styles.title}>What kind of work do you do?</Text>
          <Text style={styles.subtitle}>
            Tick every trade you work in. At least one is required — pick as many as apply.
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search trades (e.g. electrician, CCTV)"
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <X size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Selected chips */}
        {selected.length > 0 && (
          <View style={styles.chipsRow}>
            {selected.map((name) => (
              <Pressable key={name} style={styles.selectedChip} onPress={() => toggle(name)}>
                <Text style={styles.selectedChipText} numberOfLines={1}>{name}</Text>
                <X size={13} color={colors.primary} strokeWidth={2.5} />
              </Pressable>
            ))}
          </View>
        )}

        {/* List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading trades…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // Without flex:1 the list sizes itself to its content inside the
            // flex column, overflows the screen and cannot be scrolled — which
            // is why the trades below the fold were unreachable.
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No trades match “{query}”.</Text>
                <Text style={styles.emptyHint}>Add it below — it becomes available to other experts too.</Text>
              </View>
            }
            ListFooterComponent={
              <View style={styles.customWrap}>
                <Text style={styles.customLabel}>Can't find your trade? Add it</Text>
                <View style={styles.customInputRow}>
                  <TextInput
                    style={styles.customInput}
                    value={customText}
                    onChangeText={(t) => {
                      setCustomText(sanitizeTradeName(t));
                      setError(hasDisallowedTradeChars(t)
                        ? 'A trade name cannot contain numbers.'
                        : null);
                    }}
                    // This input is the last thing in the list, so the keyboard
                    // opens straight over it. Scrolling to the end once the
                    // keyboard has begun animating lifts it into view.
                    onFocus={() => {
                      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
                    }}
                    placeholder="e.g. Welder"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={addCustom}
                  />
                  <Pressable
                    style={[styles.addBtn, (!customText.trim() || isAddingCustom) && styles.addBtnDisabled]}
                    onPress={addCustom}
                    disabled={!customText.trim() || isAddingCustom}
                  >
                    {isAddingCustom
                      ? <ActivityIndicator size="small" color={colors.textInverse} />
                      : <Plus size={18} color={colors.textInverse} strokeWidth={2.5} />}
                  </Pressable>
                </View>
              </View>
            }
          />
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Bottom CTA */}
        {!isLoading && (
          <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
            <Pressable
              style={[styles.continueButton, selected.length === 0 && styles.continueButtonDisabled]}
              onPress={handleContinue}
              disabled={selected.length === 0 || isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.continueButtonText}>
                  Continue{selected.length > 0 ? ` (${selected.length})` : ''}
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
  backButton: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.surface, justifyContent: 'center',
    alignItems: 'center', marginBottom: 12,
  },
  title: {
    fontSize: fontSizes.xl, fontWeight: fontWeights.bold,
    color: colors.textPrimary, marginBottom: 6,
  },
  subtitle: {
    fontSize: fontSizes.sm, color: colors.textSecondary, lineHeight: 20,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 24, marginBottom: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 12,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: fontSizes.md, color: colors.textPrimary,
  },
  chipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 24, marginBottom: 10,
  },
  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, backgroundColor: colors.primarySurface,
    borderWidth: 1, borderColor: colors.primary,
  },
  selectedChipText: {
    fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, color: colors.primary,
  },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  loadingText: { fontSize: fontSizes.sm, color: colors.textSecondary },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  rowTextWrap: { flex: 1, marginRight: 12 },
  rowName: {
    fontSize: fontSizes.md, fontWeight: fontWeights.medium, color: colors.textPrimary,
  },
  rowNameSelected: { color: colors.primary, fontWeight: fontWeights.semibold },
  rowCategory: {
    fontSize: fontSizes.xs, color: colors.textSecondary, marginTop: 2,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 1.5, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyWrap: { alignItems: 'center', paddingVertical: 24, gap: 4 },
  emptyText: { fontSize: fontSizes.sm, color: colors.textSecondary },
  emptyHint: { fontSize: fontSizes.xs, color: colors.textDisabled },
  customWrap: {
    marginTop: 8, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  customLabel: {
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium,
    color: colors.textPrimary, marginBottom: 8,
  },
  customInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 14,
    fontSize: fontSizes.md, color: colors.textPrimary,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 12,
    backgroundColor: colors.surface,
  },
  addBtn: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  addBtnDisabled: { backgroundColor: colors.textDisabled },
  errorContainer: {
    backgroundColor: colors.errorLight, borderRadius: 12,
    padding: 12, marginHorizontal: 24, marginBottom: 8,
  },
  errorText: { fontSize: fontSizes.sm, color: colors.error, textAlign: 'center' },
  bottomBar: {
    paddingHorizontal: 24, paddingTop: 10,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  continueButton: {
    backgroundColor: colors.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  continueButtonDisabled: { backgroundColor: colors.textDisabled },
  continueButtonText: {
    fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textInverse,
  },
});
