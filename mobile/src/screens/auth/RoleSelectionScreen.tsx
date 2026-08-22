/**
 * Role Selection Screen — Premium onboarding experience
 * 
 * First screen in auth flow. User picks their account type
 * before any authentication happens. Role determines:
 * - Onboarding branch (customer vs employee)
 * - Backend authorization scope
 * - Post-signup workflows (employee → admin approval)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Dimensions,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation.types';
import { colors } from '../../theme/colors';
import { typography, fontSizes, fontWeights } from '../../theme/typography';
import { Wrench, User, ChevronRight, Shield } from 'lucide-react-native';

const { width } = Dimensions.get('window');

type Props = NativeStackScreenProps<AuthStackParamList, 'RoleSelection'>;

interface RoleOption {
  id: 'user' | 'serviceman';
  title: string;
  subtitle: string;
  description: string;
  icon: typeof User;
  gradient: string[];
  badge?: string;
}

const ROLES: RoleOption[] = [
  {
    id: 'user',
    title: 'Customer',
    subtitle: 'Book services & shop products',
    description: 'Get expert repair services at your doorstep. Book service experts, track jobs, and shop quality products.',
    icon: User,
    gradient: [colors.primary, colors.primaryDark],
  },
  {
    id: 'serviceman',
    title: 'Service Expert',
    subtitle: 'Join our team & earn',
    description: 'Use your skills to serve customers. Manage jobs, track earnings, and grow your career with UniteFix.',
    icon: Wrench,
    gradient: ['#FF6B35', '#E55100'],
    badge: 'Earn ₹25k+/month',
  },
];

export function RoleSelectionScreen({ navigation, route }: Props) {
  // Only reached during signup — login skips this and takes the role from the
  // server, since an existing account's role is not the client's to choose.
  const mode = route.params?.mode ?? 'signup';
  const [selectedRole, setSelectedRole] = useState<'user' | 'serviceman' | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const cardAnims = useRef(ROLES.map(() => new Animated.Value(0))).current;
  const buttonScale = useRef(new Animated.Value(0.95)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animations
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();

    // Stagger card entrance
    cardAnims.forEach((anim, index) => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 500,
        delay: 300 + index * 150,
        useNativeDriver: true,
      }).start();
    });
  }, []);

  useEffect(() => {
    if (selectedRole) {
      Animated.parallel([
        Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.timing(buttonOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [selectedRole]);

  const handleContinue = () => {
    if (!selectedRole) return;
    navigation.navigate('TruecallerAuth', { role: selectedRole, mode });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {/* Header */}
      <Animated.View
        style={[
          styles.header,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.logoContainer}>
          <Image
            source={require('../../../assets/icon_trimmed.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.title}>Welcome to UniteFix</Text>
        <Text style={styles.subtitle}>How would you like to use the app?</Text>
      </Animated.View>

      {/* Role Cards */}
      <View style={styles.cardsContainer}>
        {ROLES.map((role, index) => {
          const isSelected = selectedRole === role.id;
          const Icon = role.icon;

          return (
            <Animated.View
              key={role.id}
              style={{
                opacity: cardAnims[index],
                transform: [
                  {
                    translateY: cardAnims[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [40, 0],
                    }),
                  },
                ],
              }}
            >
              <Pressable
                style={[
                  styles.card,
                  isSelected && styles.cardSelected,
                  isSelected && { borderColor: role.id === 'user' ? colors.primary : '#FF6B35' },
                ]}
                onPress={() => setSelectedRole(role.id)}
                android_ripple={{ color: colors.primaryLight }}
              >
                {/* Selection indicator */}
                <View
                  style={[
                    styles.radioOuter,
                    isSelected && {
                      borderColor: role.id === 'user' ? colors.primary : '#FF6B35',
                    },
                  ]}
                >
                  {isSelected && (
                    <View
                      style={[
                        styles.radioInner,
                        {
                          backgroundColor:
                            role.id === 'user' ? colors.primary : '#FF6B35',
                        },
                      ]}
                    />
                  )}
                </View>

                {/* Icon */}
                <View
                  style={[
                    styles.iconContainer,
                    {
                      backgroundColor:
                        role.id === 'user'
                          ? colors.primarySurface
                          : '#FFF3E0',
                    },
                  ]}
                >
                  <Icon
                    size={28}
                    color={role.id === 'user' ? colors.primary : '#FF6B35'}
                    strokeWidth={2}
                  />
                </View>

                {/* Content */}
                <View style={styles.cardContent}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{role.title}</Text>
                    {role.badge && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{role.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardSubtitle}>{role.subtitle}</Text>
                  <Text style={styles.cardDescription}>{role.description}</Text>
                </View>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      {/* Continue Button */}
      <Animated.View
        style={[
          styles.bottomContainer,
          {
            opacity: buttonOpacity,
            transform: [{ scale: buttonScale }],
          },
        ]}
      >
        <Pressable
          style={[
            styles.continueButton,
            !selectedRole && styles.continueButtonDisabled,
            selectedRole === 'serviceman' && { backgroundColor: '#FF6B35' },
          ]}
          onPress={handleContinue}
          disabled={!selectedRole}
        >
          <Text style={styles.continueText}>
            Continue as {selectedRole === 'serviceman' ? 'Service Expert' : 'Customer'}
          </Text>
          <ChevronRight size={20} color={colors.textInverse} strokeWidth={2.5} />
        </Pressable>
      </Animated.View>

      {/* Footer */}
      <Text style={styles.footerText}>
        By continuing, you agree to our{' '}
        <Text
          style={styles.footerLink}
          onPress={() => navigation.navigate('Legal')}
        >
          Terms of Service & Privacy Policy
        </Text>
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  title: {
    fontSize: fontSizes['2xl'],
    fontWeight: fontWeights.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: fontSizes.base,
    color: colors.textSecondary,
  },
  cardsContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSelected: {
    borderWidth: 2,
    shadowOpacity: 0.12,
    elevation: 4,
    backgroundColor: '#FAFCFF',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    marginRight: 14,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 8,
  },
  cardTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
  },
  badge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: '#E65100',
  },
  cardSubtitle: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: fontSizes.sm * 1.5,
  },
  bottomContainer: {
    paddingBottom: 8,
  },
  continueButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonDisabled: {
    backgroundColor: colors.textDisabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueText: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.textInverse,
  },
  footerText: {
    fontSize: fontSizes.xs,
    color: colors.textDisabled,
    textAlign: 'center',
    paddingVertical: 16,
  },
  footerLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
