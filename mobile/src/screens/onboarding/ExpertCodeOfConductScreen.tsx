import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Check, ShieldCheck, ChevronLeft, UserCheck, AlertTriangle, Lock } from 'lucide-react-native';
import { useAuthStore } from '../../stores/auth.store';
import { useScreenInsets } from '../../theme/layout';
import { useNavigation } from '@react-navigation/native';

export function ExpertCodeOfConductScreen() {
  const { bottomBar: bottomPad } = useScreenInsets();
  const navigation = useNavigation<any>();
  const refreshOnboardingStatus = useAuthStore((s) => s.refreshOnboardingStatus);

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    if (isBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    if (!isAccepted) return;
    setIsSaving(true);
    try {
      // For now, this acts as the final step. We trigger the onboarding status refresh
      // which will unmount the OnboardingStack and drop them into the Partner Tabs.
      // (Optionally, this can be hooked up to an API endpoint later: /api/partner/accept-tos)
      await refreshOnboardingStatus();
    } catch (err: any) {
      console.error('[CODE OF CONDUCT] Save failed:', err?.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {navigation.canGoBack() && (
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={12}>
            <ChevronLeft size={24} color={colors.textPrimary} />
          </Pressable>
        )}
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Code of Conduct</Text>
          <Text style={styles.subtitle}>
            Please read and agree to our community standards to start receiving service requests.
          </Text>
        </View>
      </View>

      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <UserCheck size={24} color={colors.primary} />
            <Text style={styles.policyTitle}>1. Professionalism & Respect</Text>
          </View>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Be polite & respectful:</Text> Introduce yourself clearly and maintain a clean appearance.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Honesty is key:</Text> Never misrepresent services, prices, or work performed.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Zero tolerance for harassment:</Text> Do not engage in discriminatory, abusive, or intimidating behavior.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Maintain boundaries:</Text> Keep conversations strictly related to the service.</Text>
        </View>

        <View style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <ShieldCheck size={24} color={colors.primary} />
            <Text style={styles.policyTitle}>2. Safety First</Text>
          </View>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Follow procedures:</Text> Always use required safety equipment (PPE) and follow company rules.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Stay alert:</Text> Report any accidents, threats, damage, or unsafe conditions immediately.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>No substance use:</Text> Do not smoke, drink alcohol, or use intoxicating substances while working.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Safe driving:</Text> Adhere to traffic laws; never speed or use a phone while driving.</Text>
        </View>

        <View style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <Lock size={24} color={colors.primary} />
            <Text style={styles.policyTitle}>3. Privacy & Property</Text>
          </View>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Protect customer property:</Text> Handle belongings carefully and ask permission before moving items.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Respect privacy:</Text> Never touch personal belongings unnecessarily or enter restricted areas.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Confidentiality:</Text> Never disclose customer addresses, phone numbers, or payment details.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>No photography:</Text> Do not photograph customers or their private areas without explicit authorization.</Text>
        </View>

        <View style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <AlertTriangle size={24} color={colors.primary} />
            <Text style={styles.policyTitle}>4. Integrity & Compliance</Text>
          </View>
          <Text style={styles.policyText}>• <Text style={styles.bold}>No unauthorized work:</Text> Perform only the assigned or approved services.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Report mistakes:</Text> Immediately report accidental damage or errors rather than hiding them.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Clean workspace:</Text> Always clean up tools, packaging, and waste before leaving the premises.</Text>
          <Text style={styles.policyText}>• <Text style={styles.bold}>Accurate records:</Text> Record arrival times, materials used, and get customer confirmation honestly.</Text>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Safety is our priority. If you feel a location or working condition presents a serious risk, stop work, move to a safe location, and notify your supervisor.
          </Text>
        </View>
      </ScrollView>

      {/* Action Footer */}
      <View style={[styles.bottomBar, { paddingBottom: bottomPad || spacing.lg }]}>
        <Pressable 
          style={styles.checkboxRow} 
          onPress={() => setIsAccepted(!isAccepted)}
        >
          <View style={[styles.checkbox, isAccepted && styles.checkboxActive]}>
            {isAccepted && <Check size={16} color={colors.textInverse} strokeWidth={3} />}
          </View>
          <Text style={styles.checkboxText}>
            I have read and agree to follow the UniteFix Expert Code of Conduct.
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.acceptButton, 
            (!isAccepted || !hasScrolledToBottom) && styles.acceptButtonDisabled
          ]}
          onPress={handleAccept}
          disabled={!isAccepted || !hasScrolledToBottom || isSaving}
        >
          <Text style={styles.acceptButtonText}>
            {!hasScrolledToBottom ? 'Scroll to read all terms' : 'I Agree & Start Working'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.surface 
  },
  header: { 
    flexDirection: 'row',
    paddingHorizontal: spacing.xl, 
    paddingTop: spacing.md, 
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
    zIndex: 10,
    ...shadows.xs,
  },
  backButton: {
    width: 40, 
    height: 40, 
    borderRadius: radii.md,
    backgroundColor: colors.background,
    justifyContent: 'center', 
    alignItems: 'center',
    marginRight: spacing.md,
    marginTop: 4,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    ...typography.h2,
    fontSize: 24,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  scrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  policyCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  policyTitle: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  policyText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    paddingLeft: spacing.sm,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  footerNote: {
    backgroundColor: colors.primaryLight + '15',
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginTop: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  footerNoteText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  bottomBar: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    ...shadows.md,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textDisabled,
    marginRight: spacing.md,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 22,
  },
  acceptButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonDisabled: {
    backgroundColor: colors.border,
  },
  acceptButtonText: {
    ...typography.button,
    color: colors.textInverse,
    fontSize: 16,
  }
});
