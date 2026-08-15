/**
 * Legal Screen — In-app Terms of Service & Privacy Policy viewer
 * 
 * Opens the UniteFix legal documents within the app using the system browser.
 * Play Store requires a live, accessible Privacy Policy before app approval.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink, FileText, Shield, Scale } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fontSizes, fontWeights } from '../theme/typography';

const LEGAL_DOCS = [
  {
    id: 'terms',
    title: 'Terms of Service',
    description: 'Rules and conditions for using UniteFix services including booking, payments, and dispute resolution.',
    url: 'https://unitefix.com/assets/terms-and-conditions.pdf',
    icon: Scale,
    iconColor: colors.primary,
    iconBg: colors.primarySurface,
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    description: 'How we collect, use, and protect your personal data including location, phone number, and payment information.',
    url: 'https://unitefix.com/privacy-policy.html',
    icon: Shield,
    iconColor: '#10B981',
    iconBg: '#ECFDF5',
  },
  {
    id: 'refund',
    title: 'Refund & Cancellation Policy',
    description: 'Guidelines for cancelling service requests and our refund process for payments and deposits.',
    url: 'https://unitefix.com/refund-policy.html',
    icon: FileText,
    iconColor: '#F59E0B',
    iconBg: '#FFFBEB',
  },
];

interface LegalScreenProps {
  navigation?: any;
}

export function LegalScreen({ navigation }: LegalScreenProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const openDocument = useCallback(async (docId: string, url: string) => {
    setLoading(docId);
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        if (__DEV__) console.warn('[Legal] Cannot open URL:', url);
      }
    } catch (err) {
      if (__DEV__) console.error('[Legal] Error opening URL:', err);
    } finally {
      setLoading(null);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        {navigation && (
          <Pressable
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            android_ripple={{ color: colors.primaryLight, borderless: true }}
          >
            <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2} />
          </Pressable>
        )}
        <Text style={styles.headerTitle}>Legal & Policies</Text>
      </View>

      {/* Introduction */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introCard}>
          <Shield size={32} color={colors.primary} strokeWidth={1.5} />
          <Text style={styles.introTitle}>Your Rights Matter</Text>
          <Text style={styles.introDescription}>
            Tap on any document below to read the full legal terms. These policies explain how UniteFix protects your data and your rights as a user.
          </Text>
        </View>

        {/* Document Cards */}
        {LEGAL_DOCS.map((doc) => {
          const Icon = doc.icon;
          const isLoading = loading === doc.id;

          return (
            <Pressable
              key={doc.id}
              style={styles.docCard}
              onPress={() => openDocument(doc.id, doc.url)}
              android_ripple={{ color: colors.primaryLight }}
            >
              <View style={[styles.docIcon, { backgroundColor: doc.iconBg }]}>
                <Icon size={24} color={doc.iconColor} strokeWidth={2} />
              </View>
              <View style={styles.docContent}>
                <Text style={styles.docTitle}>{doc.title}</Text>
                <Text style={styles.docDescription}>{doc.description}</Text>
              </View>
              <View style={styles.docAction}>
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <ExternalLink size={18} color={colors.textSecondary} strokeWidth={2} />
                )}
              </View>
            </Pressable>
          );
        })}

        {/* Contact Info */}
        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>Have Questions?</Text>
          <Text style={styles.contactDescription}>
            If you have any concerns about our policies or your data, please contact us at:
          </Text>
          <Pressable onPress={() => Linking.openURL('mailto:support@unitefix.com')}>
            <Text style={styles.contactEmail}>support@unitefix.com</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          © {new Date().getFullYear()} UniteFix. All rights reserved.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  headerTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  introCard: {
    backgroundColor: colors.primarySurface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  introTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 8,
  },
  introDescription: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: fontSizes.sm * 1.6,
  },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  docIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  docContent: {
    flex: 1,
    marginRight: 8,
  },
  docTitle: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  docDescription: {
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    lineHeight: fontSizes.xs * 1.5,
  },
  docAction: {
    width: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactTitle: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  contactDescription: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: fontSizes.sm * 1.5,
    marginBottom: 8,
  },
  contactEmail: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  footer: {
    fontSize: fontSizes.xs,
    color: colors.textDisabled,
    textAlign: 'center',
    marginTop: 24,
  },
});
