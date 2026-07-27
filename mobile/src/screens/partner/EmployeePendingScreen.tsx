/**
 * PHASE 3: Employee Pending Verification Screen
 *
 * Displayed when a partner/serviceman has logged in but their
 * documentVerificationStatus is NOT 'verified'.
 *
 * Features:
 * - Shows verification status (pending / rejected / suspended)
 * - Pull-to-refresh to re-check verification status
 * - WhatsApp support deep link
 * - Logout option
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  Linking,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Clock, ShieldCheck, ShieldX, MessageCircle, LogOut, RefreshCw } from 'lucide-react-native';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import { apiClient } from '../../api/client';
import { usePublicConfig } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';

interface StatusConfig {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  bgColor: string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  pending: {
    icon: <Clock size={56} color={colors.warning} />,
    title: 'Verification In Progress',
    subtitle:
      "Your documents are being reviewed by our team. This usually takes 24-48 hours. You will receive a notification once verified.",
    color: colors.warning,
    bgColor: colors.warningLight,
  },
  rejected: {
    icon: <ShieldX size={56} color={colors.error} />,
    title: 'Verification Rejected',
    subtitle:
      'Unfortunately, your documents could not be verified. Please contact our support team for more details and to re-submit.',
    color: colors.error,
    bgColor: colors.errorLight,
  },
  suspended: {
    icon: <ShieldX size={56} color={colors.error} />,
    title: 'Account Suspended',
    subtitle:
      'Your partner account has been suspended. Please contact support for further assistance.',
    color: colors.error,
    bgColor: colors.errorLight,
  },
};

export function EmployeePendingScreen() {
  const { user, updateUser, logout } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const { data: publicConfig } = usePublicConfig();
  const whatsappNumber = publicConfig?.whatsappNumber || '919448850679';

  const status = user?.documentVerificationStatus || 'pending';
  const config = STATUS_MAP[status] || STATUS_MAP.pending;

  /**
   * Task 3.5: Pull-to-refresh — re-fetches employee profile from backend
   * to check if documentVerificationStatus has changed.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await apiClient.get('/api/partner/verification-status');
      if (data?.success && data?.data) {
        updateUser({
          documentVerificationStatus: data.data.documentVerificationStatus,
          isOnline: data.data.isOnline,
        });
        setLastChecked(new Date());
      }
    } catch (err) {
      console.warn('[PENDING] Failed to refresh status:', err);
    } finally {
      setRefreshing(false);
    }
  }, [updateUser]);

  const openWhatsApp = () => {
    const message = encodeURIComponent(
      `Hi, I need help with my UniteFix partner verification. My phone: ${user?.phone || 'N/A'}`
    );
    Linking.openURL(`https://wa.me/${whatsappNumber}?text=${message}`);
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Status Badge */}
        <View style={[styles.statusBadge, { backgroundColor: config.bgColor }]}>
          <View style={styles.iconContainer}>{config.icon}</View>
          <Text style={[styles.statusTitle, { color: config.color }]}>{config.title}</Text>
          <Text style={styles.statusSubtitle}>{config.subtitle}</Text>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What happens next?</Text>
          <View style={styles.step}>
            <View style={[styles.stepDot, { backgroundColor: colors.success }]} />
            <Text style={styles.stepText}>Our team reviews your uploaded documents</Text>
          </View>
          <View style={styles.step}>
            <View style={[styles.stepDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.stepText}>You will receive a push notification on approval</Text>
          </View>
          <View style={styles.step}>
            <View style={[styles.stepDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.stepText}>Start accepting service requests immediately</Text>
          </View>
        </View>

        {/* Pull Hint */}
        <View style={styles.pullHint}>
          <RefreshCw size={16} color={colors.textSecondary} />
          <Text style={styles.pullHintText}>Pull down to check for status updates</Text>
        </View>

        {lastChecked && (
          <Text style={styles.lastCheckedText}>
            Last checked: {lastChecked.toLocaleTimeString()}
          </Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.whatsappButton]}
            onPress={openWhatsApp}
            activeOpacity={0.8}
          >
            <MessageCircle size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Contact Support</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.logoutButton]}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <LogOut size={20} color={colors.error} />
            <Text style={[styles.actionButtonText, { color: colors.error }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    alignItems: 'center',
  },
  statusBadge: {
    width: '100%',
    borderRadius: 20,
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    marginBottom: 20,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  statusSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  infoCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 16,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  stepText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  pullHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  pullHintText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  lastCheckedText: {
    fontSize: 12,
    color: colors.textDisabled,
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
    marginTop: 'auto',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  whatsappButton: {
    backgroundColor: '#25D366',
  },
  logoutButton: {
    backgroundColor: colors.errorLight,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
