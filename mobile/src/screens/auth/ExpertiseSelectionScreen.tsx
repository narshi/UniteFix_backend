/**
 * ExpertiseSelectionScreen — Mandatory skills step for new technicians.
 *
 * Final step of the onboarding stack (technicians only). The user searches the
 * full list of services (sub-categories) and multi-selects the ones they can do,
 * plus any custom skills. Selecting sub-categories — not just top-level
 * categories — is what lets assignment match a partner to a booking, because a
 * booking stores the service (sub-category) name in serviceType.
 *
 * Flow: OnboardingProfile → OnboardingLocation → ExpertiseSelection
 *       → RootNavigator switches to the partner app / pending-verification screen
 */

import React, { useState, useEffect, useMemo } from 'react';
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

interface ServiceOption {
  id: number;
  name: string;         // service / sub-category name (what gets saved)
  categoryName: string; // parent category, shown as a subtitle for context
}

// Used only if the catalog request fails — a flat list of common services so the
// screen is never empty. These are sub-categories, not top-level categories.
const FALLBACK_OPTIONS: ServiceOption[] = [
  { id: -1, name: 'Fan Installation & Repair', categoryName: 'Electrician' },
  { id: -2, name: 'Wiring & Rewiring', categoryName: 'Electrician' },
  { id: -3, name: 'Switchboard & Socket Repair', categoryName: 'Electrician' },
  { id: -4, name: 'Inverter & Stabilizer', categoryName: 'Electrician' },
  { id: -5, name: 'Tap & Pipe Repair', categoryName: 'Plumber' },
  { id: -6, name: 'Toilet & Flush Repair', categoryName: 'Plumber' },
  { id: -7, name: 'Water Motor & Tank', categoryName: 'Plumber' },
  { id: -8, name: 'AC Service & Repair', categoryName: 'AC & Appliance' },
  { id: -9, name: 'Refrigerator Repair', categoryName: 'AC & Appliance' },
  { id: -10, name: 'Washing Machine Repair', categoryName: 'AC & Appliance' },
  { id: -11, name: 'Furniture Repair', categoryName: 'Carpenter' },
  { id: -12, name: 'Door & Lock Repair', categoryName: 'Carpenter' },
  { id: -13, name: 'Interior Painting', categoryName: 'Painter' },
];

export function ExpertiseSelectionScreen() {
  const { bottomBar: bottomPad } = useScreenInsets();
  // The session already exists by the time this screen renders — it is the last
  // step of the onboarding stack, so the normal apiClient interceptor supplies
  // the token.
  const refreshOnboardingStatus = useAuthStore((s) => s.refreshOnboardingStatus);
  const navigation = useNavigation<any>();

  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [customText, setCustomText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      setIsLoading(true);
      // Public endpoint — returns categories, each with its services in `items`.
      const { data } = await apiClient.get('/api/services/categories');
      if (data?.success && Array.isArray(data.data)) {
        const flat: ServiceOption[] = [];
        for (const cat of data.data) {
          for (const item of cat.items || []) {
            flat.push({ id: item.id, name: item.name, categoryName: cat.name });
          }
        }
        // Alphabetical within the whole list keeps search results predictable.
        flat.sort((a, b) => a.name.localeCompare(b.name));
        setOptions(flat.length > 0 ? flat : FALLBACK_OPTIONS);
      } else {
        setOptions(FALLBACK_OPTIONS);
      }
    } catch (err: any) {
      console.warn('[EXPERTISE] Failed to fetch services:', err?.message);
      setOptions(FALLBACK_OPTIONS);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.categoryName.toLowerCase().includes(q)
    );
  }, [query, options]);

  const toggle = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
    setError(null);
  };

  const addCustom = () => {
    const value = customText.trim();
    if (!value) return;
    if (!selected.includes(value)) {
      setSelected((prev) => [...prev, value]);
    }
    setCustomText('');
    setError(null);
  };

  const handleContinue = async () => {
    if (selected.length === 0) {
      setError('Please select at least one skill');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.patch('/api/partner/profile/expertise', { services: selected });
      // Skills are the last mandatory step: once the server reports onboarding
      // complete, RootNavigator swaps this stack for the partner app (or the
      // pending-verification screen).
      await refreshOnboardingStatus();
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

  const renderRow = ({ item }: { item: ServiceOption }) => {
    const isSelected = selected.includes(item.name);
    return (
      <Pressable
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => toggle(item.name)}
      >
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowName, isSelected && styles.rowNameSelected]}>{item.name}</Text>
          <Text style={styles.rowCategory}>{item.categoryName}</Text>
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
          <Text style={styles.title}>What can you do?</Text>
          <Text style={styles.subtitle}>
            Search and select every service you can handle. Pick as many as apply.
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search services (e.g. fan, wiring, AC)"
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
            <Text style={styles.loadingText}>Loading services…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No services match “{query}”.</Text>
                <Text style={styles.emptyHint}>Add it as a custom skill below.</Text>
              </View>
            }
            ListFooterComponent={
              <View style={styles.customWrap}>
                <Text style={styles.customLabel}>Can't find it? Add a custom skill</Text>
                <View style={styles.customInputRow}>
                  <TextInput
                    style={styles.customInput}
                    value={customText}
                    onChangeText={(t) => { setCustomText(t); setError(null); }}
                    placeholder="e.g. Solar Panel Installation"
                    placeholderTextColor={colors.textDisabled}
                    returnKeyType="done"
                    onSubmitEditing={addCustom}
                  />
                  <Pressable
                    style={[styles.addBtn, !customText.trim() && styles.addBtnDisabled]}
                    onPress={addCustom}
                    disabled={!customText.trim()}
                  >
                    <Plus size={18} color={colors.textInverse} strokeWidth={2.5} />
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
  listContent: { paddingHorizontal: 24, paddingBottom: 24 },
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
