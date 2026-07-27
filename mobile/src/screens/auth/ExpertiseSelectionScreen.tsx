/**
 * ExpertiseSelectionScreen — Mandatory skills step for new technicians.
 *
 * Final step of the onboarding stack (technicians only). The user must select at
 * least one expertise category; multi-select plus "Others" free text.
 *
 * Flow: OnboardingProfile → OnboardingLocation → ExpertiseSelection
 *       → RootNavigator switches to the partner app / pending-verification screen
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { Check, ChevronLeft, Briefcase, Plus, X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../api/client';
import { useScreenInsets } from '../../theme/layout';
import { useNavigation } from '@react-navigation/native';

interface ServiceCategory {
  id: number;
  name: string;
  icon: string | null;
  isActive: boolean;
}

export function ExpertiseSelectionScreen() {
  const { bottomBar: bottomPad } = useScreenInsets();
  // The session already exists by the time this screen renders — it is the last
  // step of the onboarding stack, not a deferred-login gate, so the normal
  // apiClient interceptor supplies the token.
  const refreshOnboardingStatus = useAuthStore((s) => s.refreshOnboardingStatus);
  const navigation = useNavigation<any>();

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showOthers, setShowOthers] = useState(false);
  const [othersText, setOthersText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setIsLoading(true);
      // Public endpoint — no auth needed
      const { data } = await apiClient.get('/api/services/categories');
      if (data?.success && Array.isArray(data.data)) {
        // Extract unique category names from the response
        const cats: ServiceCategory[] = data.data.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          isActive: cat.isActive,
        }));
        setCategories(cats);
      }
    } catch (err: any) {
      console.warn('[EXPERTISE] Failed to fetch categories:', err?.message);
      // Fallback to common categories
      setCategories([
        { id: 1, name: 'Electrician', icon: 'Zap', isActive: true },
        { id: 2, name: 'Plumber', icon: 'Droplets', isActive: true },
        { id: 3, name: 'Carpenter', icon: 'Hammer', isActive: true },
        { id: 4, name: 'AC Repair', icon: 'Wind', isActive: true },
        { id: 5, name: 'Appliance Repair', icon: 'Wrench', isActive: true },
        { id: 6, name: 'Painter', icon: 'Paintbrush', isActive: true },
        { id: 7, name: 'Cleaning', icon: 'Sparkles', isActive: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCategory = (name: string) => {
    setSelectedCategories((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
    setError(null);
  };

  const toggleOthers = () => {
    setShowOthers(!showOthers);
    if (showOthers) {
      setOthersText('');
    }
    setError(null);
  };

  const getSelectedServices = (): string[] => {
    const services = [...selectedCategories];
    if (showOthers && othersText.trim()) {
      services.push(othersText.trim());
    }
    return services;
  };

  const handleContinue = async () => {
    const services = getSelectedServices();
    if (services.length === 0) {
      setError('Please select at least one area of expertise');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await apiClient.patch('/api/partner/profile/expertise', { services });

      // Skills are the last mandatory step: once the server reports onboarding
      // complete, RootNavigator swaps this stack for the partner app (or the
      // pending-verification screen).
      await refreshOnboardingStatus();
    } catch (err: any) {
      console.error('[EXPERTISE] Save failed:', err?.message);
      // Skills are mandatory, so a failed save must not silently pass — keep the
      // user here and let them retry rather than dropping them into the app
      // with an empty skill list that blocks job assignment.
      setError(
        err?.response?.data?.message ||
        'Could not save your expertise. Please check your connection and try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = getSelectedServices().length;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back Button — hidden when this is the resumed entry point, since
              there is no earlier onboarding screen to return to. */}
          {navigation.canGoBack() && (
            <Pressable
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              hitSlop={12}
            >
              <ChevronLeft size={24} color={colors.textPrimary} />
            </Pressable>
          )}

          {/* Header */}
          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Image
              source={require('../../../assets/icon_trimmed.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.title}>What's Your Expertise?</Text>
            <Text style={styles.subtitle}>
              Select the services you're skilled in.{'\n'}You can always update this later.
            </Text>
          </Animated.View>

          {/* Loading */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading categories...</Text>
            </View>
          ) : (
            <>
              {/* Category Chips Grid */}
              <View style={styles.chipsContainer}>
                {categories.map((cat) => {
                  const isSelected = selectedCategories.includes(cat.name);
                  return (
                    <Pressable
                      key={cat.id}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => toggleCategory(cat.name)}
                    >
                      {isSelected && (
                        <Check size={16} color={colors.textInverse} strokeWidth={3} />
                      )}
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* Others Chip */}
                <Pressable
                  style={[styles.chip, styles.chipOthers, showOthers && styles.chipSelected]}
                  onPress={toggleOthers}
                >
                  {showOthers ? (
                    <X size={16} color={colors.textInverse} strokeWidth={3} />
                  ) : (
                    <Plus size={16} color={colors.primary} strokeWidth={2.5} />
                  )}
                  <Text style={[styles.chipText, styles.chipOthersText, showOthers && styles.chipTextSelected]}>
                    Others
                  </Text>
                </Pressable>
              </View>

              {/* Others Text Input */}
              {showOthers && (
                <Animated.View style={styles.othersInputContainer}>
                  <Text style={styles.othersLabel}>Specify your expertise</Text>
                  <View style={styles.othersInputWrapper}>
                    <Briefcase size={18} color={colors.textSecondary} />
                    <TextInput
                      style={styles.othersInput}
                      value={othersText}
                      onChangeText={(t) => { setOthersText(t); setError(null); }}
                      placeholder="e.g., Solar Panel Installation"
                      placeholderTextColor={colors.textDisabled}
                      autoFocus
                      returnKeyType="done"
                    />
                  </View>
                </Animated.View>
              )}

              {/* Selected Count */}
              {selectedCount > 0 && (
                <View style={styles.selectedInfo}>
                  <Briefcase size={16} color={colors.primary} />
                  <Text style={styles.selectedText}>
                    {selectedCount} {selectedCount === 1 ? 'expertise' : 'expertises'} selected
                  </Text>
                </View>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Bottom CTA */}
        {!isLoading && (
          <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
            <Pressable
              style={[styles.continueButton, selectedCount === 0 && styles.continueButtonDisabled]}
              onPress={handleContinue}
              disabled={selectedCount === 0 || isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.continueButtonText}>
                  Continue{selectedCount > 0 ? ` (${selectedCount})` : ''}
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
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 120 },
  backButton: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.surface, justifyContent: 'center',
    alignItems: 'center', marginTop: 8,
  },
  header: { alignItems: 'center', marginTop: 16, marginBottom: 28 },
  logoImage: { width: 64, height: 64, borderRadius: 16, marginBottom: 16 },
  title: {
    fontSize: fontSizes.xl, fontWeight: fontWeights.bold,
    color: colors.textPrimary, marginBottom: 8, textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSizes.sm, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 40,
  },
  loadingText: { fontSize: fontSizes.sm, color: colors.textSecondary },
  chipsContainer: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
  chipOthers: {
    borderStyle: 'dashed' as any, borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  chipText: {
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium,
    color: colors.textPrimary,
  },
  chipTextSelected: { color: colors.textInverse },
  chipOthersText: { color: colors.primary },
  othersInputContainer: {
    marginBottom: 16, backgroundColor: colors.surface,
    borderRadius: 14, padding: 16, borderWidth: 1,
    borderColor: colors.border,
  },
  othersLabel: {
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium,
    color: colors.textPrimary, marginBottom: 8,
  },
  othersInputWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: colors.borderFocused,
    borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.surfaceElevated,
  },
  othersInput: {
    flex: 1, paddingVertical: 14, fontSize: fontSizes.md,
    fontWeight: fontWeights.medium, color: colors.textPrimary,
  },
  selectedInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: colors.primarySurface, borderRadius: 12,
    marginBottom: 12,
  },
  selectedText: {
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold,
    color: colors.primary,
  },
  errorContainer: {
    backgroundColor: colors.errorLight, borderRadius: 12,
    padding: 14, marginTop: 8,
  },
  errorText: { fontSize: fontSizes.sm, color: colors.error, textAlign: 'center' },
  bottomBar: {
    paddingHorizontal: 24, paddingTop: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  continueButton: {
    backgroundColor: colors.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  continueButtonDisabled: { backgroundColor: colors.textDisabled },
  continueButtonText: {
    fontSize: fontSizes.md, fontWeight: fontWeights.semibold,
    color: colors.textInverse,
  },
});
