/**
 * Employee Pending Screen — Shown after employee signup
 * while waiting for admin document verification approval.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { Clock, FileText, LogOut } from 'lucide-react-native';
import { useAuthStore } from '../../stores/auth.store';

export function EmployeePendingScreen() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Clock size={48} color={colors.warning} strokeWidth={1.5} />
        </View>

        <Text style={styles.title}>Verification Pending</Text>
        <Text style={styles.subtitle}>
          Your account is being reviewed by our team. This usually takes 24-48 hours.
        </Text>

        <View style={styles.stepsContainer}>
          <View style={styles.step}>
            <View style={[styles.stepDot, styles.stepDotComplete]} />
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Phone Verified</Text>
              <Text style={styles.stepDesc}>Identity confirmed via Truecaller</Text>
            </View>
          </View>

          <View style={styles.stepLine} />

          <View style={styles.step}>
            <View style={[styles.stepDot, styles.stepDotPending]} />
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Document Verification</Text>
              <Text style={styles.stepDesc}>Upload Aadhaar & PAN for review</Text>
            </View>
          </View>

          <View style={styles.stepLine} />

          <View style={styles.step}>
            <View style={styles.stepDot} />
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Admin Approval</Text>
              <Text style={styles.stepDesc}>Our team will verify your documents</Text>
            </View>
          </View>
        </View>

        <Pressable style={styles.logoutButton} onPress={logout}>
          <LogOut size={18} color={colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: fontSizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: fontSizes.base * 1.6,
    marginBottom: 40,
    paddingHorizontal: 16,
  },
  stepsContainer: {
    width: '100%',
    paddingHorizontal: 16,
    marginBottom: 40,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginTop: 2,
  },
  stepDotComplete: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  stepDotPending: {
    borderColor: colors.warning,
    backgroundColor: colors.warningLight,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
  stepLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.border,
    marginLeft: 11,
    marginVertical: 4,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.errorLight,
    backgroundColor: colors.errorLight,
  },
  logoutText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: colors.error,
  },
});
