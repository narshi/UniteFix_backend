/**
 * ManageExpertiseScreen — lets a technician edit the services they can do,
 * from their profile. Same searchable sub-category picker as onboarding, but
 * pre-loaded with their current skills and saving back to the profile.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, Search, Plus, X } from 'lucide-react-native';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { usePartnerProfile, queryKeys } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { useScreenInsets } from '../../theme/layout';

interface ServiceOption { id: number; name: string; categoryName: string; }

export function ManageExpertiseScreen() {
  const { bottomBar: bottomPad } = useScreenInsets();
  const navigation = useNavigation<any>();
  const qc = useQueryClient();
  const { data: partnerProfile } = usePartnerProfile();

  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [customText, setCustomText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Preload the technician's current skills once the profile is available.
  useEffect(() => {
    if (seeded) return;
    const current: string[] | undefined =
      (partnerProfile as any)?.services ?? (partnerProfile as any)?.data?.services;
    if (Array.isArray(current)) {
      setSelected(current.filter((s) => typeof s === 'string'));
      setSeeded(true);
    }
  }, [partnerProfile, seeded]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiClient.get('/api/services/categories');
        if (data?.success && Array.isArray(data.data)) {
          const flat: ServiceOption[] = [];
          for (const cat of data.data) {
            for (const item of cat.items || []) {
              flat.push({ id: item.id, name: item.name, categoryName: cat.name });
            }
          }
          flat.sort((a, b) => a.name.localeCompare(b.name));
          setOptions(flat);
        }
      } catch {
        // leave list empty; the technician can still add custom skills
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.categoryName.toLowerCase().includes(q));
  }, [query, options]);

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));

  const addCustom = () => {
    const value = customText.trim();
    if (value && !selected.includes(value)) setSelected((prev) => [...prev, value]);
    setCustomText('');
  };

  const handleSave = async () => {
    if (selected.length === 0) {
      Alert.alert('No skills selected', 'Select at least one service you can do.');
      return;
    }
    setIsSaving(true);
    try {
      await apiClient.patch('/api/partner/profile/expertise', { services: selected });
      qc.invalidateQueries({ queryKey: queryKeys.partnerProfile });
      Alert.alert('Saved', 'Your skills have been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error', getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const renderRow = ({ item }: { item: ServiceOption }) => {
    const isSelected = selected.includes(item.name);
    return (
      <Pressable style={[styles.row, isSelected && styles.rowSelected]} onPress={() => toggle(item.name)}>
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={12}>
            <ChevronLeft size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Manage Your Skills</Text>
          <Text style={styles.subtitle}>Search and select every service you can handle.</Text>
        </View>

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
            <Pressable onPress={() => setQuery('')} hitSlop={10}><X size={18} color={colors.textSecondary} /></Pressable>
          )}
        </View>

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
                    onChangeText={setCustomText}
                    placeholder="e.g. Solar Panel Installation"
                    placeholderTextColor={colors.textDisabled}
                    returnKeyType="done"
                    onSubmitEditing={addCustom}
                  />
                  <Pressable style={[styles.addBtn, !customText.trim() && styles.addBtnDisabled]} onPress={addCustom} disabled={!customText.trim()}>
                    <Plus size={18} color={colors.textInverse} strokeWidth={2.5} />
                  </Pressable>
                </View>
              </View>
            }
          />
        )}

        {!isLoading && (
          <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
            <Pressable
              style={[styles.saveButton, selected.length === 0 && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={selected.length === 0 || isSaving}
            >
              {isSaving ? <ActivityIndicator color={colors.textInverse} /> : (
                <Text style={styles.saveButtonText}>Save Skills ({selected.length})</Text>
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
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: fontSizes.sm, color: colors.textSecondary, lineHeight: 20 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginBottom: 12, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: fontSizes.md, color: colors.textPrimary },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, marginBottom: 10 },
  selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primary },
  selectedChipText: { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, color: colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: fontSizes.sm, color: colors.textSecondary },
  listContent: { paddingHorizontal: 24, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  rowTextWrap: { flex: 1, marginRight: 12 },
  rowName: { fontSize: fontSizes.md, fontWeight: fontWeights.medium, color: colors.textPrimary },
  rowNameSelected: { color: colors.primary, fontWeight: fontWeights.semibold },
  rowCategory: { fontSize: fontSizes.xs, color: colors.textSecondary, marginTop: 2 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyWrap: { alignItems: 'center', paddingVertical: 24, gap: 4 },
  emptyText: { fontSize: fontSizes.sm, color: colors.textSecondary },
  emptyHint: { fontSize: fontSizes.xs, color: colors.textDisabled },
  customWrap: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.divider },
  customLabel: { fontSize: fontSizes.sm, fontWeight: fontWeights.medium, color: colors.textPrimary, marginBottom: 8 },
  customInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, fontSize: fontSizes.md, color: colors.textPrimary, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  addBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { backgroundColor: colors.textDisabled },
  bottomBar: { paddingHorizontal: 24, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.divider },
  saveButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: colors.textDisabled },
  saveButtonText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textInverse },
});
