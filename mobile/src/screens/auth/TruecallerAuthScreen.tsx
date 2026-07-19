import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation.types';
import { useTruecallerAuth } from '../../hooks/useTruecallerAuth';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import auth from '@react-native-firebase/auth';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { Phone, Shield, ChevronLeft, CheckCircle, AlertCircle, Mail } from 'lucide-react-native';

type Props = NativeStackScreenProps<AuthStackParamList, 'TruecallerAuth'>;

const TC_GREEN = '#0095FF';

type OtpStep = 'phone' | 'otp';

export function TruecallerAuthScreen({ navigation, route }: Props) {
  const { role } = route.params;
  const {
    isAvailable,
    isLoading: tcLoading,
    getAuthorizationCode,
    setTheme,
    error: hookError,
  } = useTruecallerAuth();
  const loginWithTruecaller = useAuthStore((s) => s.loginWithTruecaller);

  /**
   * Route new employees to ExpertiseSelection before completing login.
   * Returning users and customers go straight through.
   */
  const handleAuthSuccess = async (data: any) => {
    if (data.isNewUser && role === 'serviceman') {
      // Navigate to expertise selection — login deferred until after selection
      navigation.replace('ExpertiseSelection', { authData: data });
    } else {
      await loginWithTruecaller(data);
    }
  };

  // UI state
  const [showOtpFlow, setShowOtpFlow] = useState(false);
  const [otpStep, setOtpStep] = useState<OtpStep>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState(false);

  // Firebase confirmation ref
  const confirmationRef = useRef<any>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    setTheme('light');
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [setTheme]);

  // Auto-show OTP flow if Truecaller not available
  useEffect(() => {
    if (!tcLoading && !isAvailable) {
      const timer = setTimeout(() => setShowOtpFlow(true), 800);
      return () => clearTimeout(timer);
    }
  }, [isAvailable, tcLoading]);

  // Listen for Firebase auto-verification (Android specific)
  useEffect(() => {
    const subscriber = auth().onAuthStateChanged(async (user) => {
      // If we have a user and we are in the middle of authenticating (e.g. OTP step)
      if (user && otpStep === 'otp') {
        try {
          setIsAuthenticating(true);
          const idToken = await user.getIdToken();
          const normalized = phone.replace(/[^0-9]/g, '');

          const { data } = await authApi.firebaseVerify({
            idToken,
            phone: normalized,
            role,
          });

          if (data.success) {
            setAuthSuccess(true);
            await handleAuthSuccess(data);
          } else {
            setAuthError(data.message || 'Auto-verification failed');
          }
        } catch (err: any) {
          if (__DEV__) console.error('[Firebase Auto-Verify]', err);
          setAuthError(err?.response?.data?.message || err.message || 'Auto-verification failed');
        } finally {
          setIsAuthenticating(false);
        }
      }
    });
    return subscriber; // unsubscribe on unmount
  }, [otpStep, phone, role]);

  const isValidIndianPhone = (num: string) => /^[6-9]\d{9}$/.test(num.replace(/[\s\-()]/g, ''));

  /**
   * 1. TRUECALLER 1-TAP AUTH
   */
  const handleTruecallerAuth = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const result = await getAuthorizationCode();
      if (!result) {
        setShowOtpFlow(true);
        setIsAuthenticating(false);
        return;
      }
      const { data } = await authApi.truecallerVerify({
        authorizationCode: result.authorizationCode,
        codeVerifier: result.codeVerifier,
        role,
      });
      if (data.success) {
        setAuthSuccess(true);
        await handleAuthSuccess(data);
      } else {
        setAuthError(data.message || 'Verification failed');
      }
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'Authentication failed');
      setShowOtpFlow(true);
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 2. FIREBASE PHONE OTP — Send OTP
   */
  const handleSendOtp = async () => {
    if (!isValidIndianPhone(phone)) {
      setAuthError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const fullPhone = '+91' + phone.replace(/[^0-9]/g, '');
      const confirmation = await auth().signInWithPhoneNumber(fullPhone);
      confirmationRef.current = confirmation;
      setOtpStep('otp');
    } catch (err: any) {
      if (__DEV__) console.error('[Firebase OTP]', err);
      setAuthError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 3. FIREBASE PHONE OTP — Verify OTP
   */
  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      setAuthError('Please enter the 6-digit OTP');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const userCredential = await confirmationRef.current.confirm(otp);
      const idToken = await userCredential.user.getIdToken();
      const normalized = phone.replace(/[^0-9]/g, '');

      const { data } = await authApi.firebaseVerify({
        idToken,
        phone: normalized,
        role,
      });

      if (data.success) {
        setAuthSuccess(true);
        await handleAuthSuccess(data);
      } else {
        setAuthError(data.message || 'Verification failed');
      }
    } catch (err: any) {
      if (err.code === 'auth/invalid-verification-code') {
        setAuthError('Invalid OTP. Please check and try again.');
      } else {
        setAuthError(err?.response?.data?.message || err.message || 'OTP verification failed');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const roleLabel = role === 'serviceman' ? 'Service Expert' : 'Customer';

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
          {/* Back Button */}
          <Pressable
            style={styles.backButton}
            onPress={() => {
              if (showOtpFlow && otpStep === 'otp') {
                setOtpStep('phone');
                setOtp('');
                setAuthError(null);
              } else if (showOtpFlow && isAvailable) {
                setShowOtpFlow(false);
                setAuthError(null);
              } else {
                navigation.goBack();
              }
            }}
            hitSlop={12}
          >
            <ChevronLeft size={24} color={colors.textPrimary} />
          </Pressable>

          {/* Header */}
          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Image
              source={require('../../../assets/icon_trimmed.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.title}>Verify Your Identity</Text>
            <Text style={styles.subtitle}>
              Signing up as <Text style={styles.roleHighlight}>{roleLabel}</Text>
            </Text>
          </Animated.View>

          {/* SUCCESS */}
          {authSuccess && (
            <View style={styles.successContainer}>
              <CheckCircle size={48} color={colors.success} />
              <Text style={styles.successText}>Verified Successfully!</Text>
              <Text style={styles.successSubtext}>Setting up your account...</Text>
            </View>
          )}

          {/* LOADING */}
          {isAuthenticating && !authSuccess && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>
                {otpStep === 'otp' ? 'Verifying OTP...' : 'Verifying your identity...'}
              </Text>
            </View>
          )}

          {/* MAIN CONTENT */}
          {!isAuthenticating && !authSuccess && (
            <View style={styles.actionsContainer}>

              {/* === TRUECALLER BUTTON === */}
              {isAvailable && !showOtpFlow && (
                <Pressable style={styles.truecallerButton} onPress={handleTruecallerAuth}>
                  <View style={styles.tcIconContainer}>
                    <Phone size={22} color="#FFFFFF" strokeWidth={2.5} />
                  </View>
                  <Text style={styles.truecallerButtonText}>Continue with Truecaller</Text>
                </Pressable>
              )}

              {/* === "Or verify with OTP" link === */}
              {isAvailable && !showOtpFlow && (
                <Pressable
                  style={styles.manualTriggerBtn}
                  onPress={() => { setShowOtpFlow(true); setAuthError(null); }}
                >
                  <Mail size={16} color={colors.textPrimary} />
                  <Text style={styles.manualTriggerText}>Verify with OTP</Text>
                </Pressable>
              )}

              {/* === FIREBASE OTP FLOW === */}
              {showOtpFlow && (
                <View style={styles.manualContainer}>

                  {/* Step 1: Phone Input */}
                  {otpStep === 'phone' && (
                    <>
                      <View style={styles.otpHeader}>
                        <Phone size={28} color={colors.primary} />
                        <Text style={styles.otpTitle}>Verify via OTP</Text>
                        <Text style={styles.otpSubtitle}>
                          We'll send a one-time code to your mobile number.
                        </Text>
                      </View>

                      <Text style={styles.inputLabel}>Mobile Number</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}>
                          <Phone size={20} color={colors.textSecondary} />
                        </View>
                        <TextInput
                          style={styles.input}
                          value={phone}
                          onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '')); setAuthError(null); }}
                          placeholder="Enter 10-digit number"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="phone-pad"
                          maxLength={10}
                          autoFocus={!isAvailable}
                        />
                      </View>
                      <Text style={styles.hintText}>An SMS with a 6-digit code will be sent.</Text>
                      <Pressable
                        style={[styles.submitButton, !isValidIndianPhone(phone) && styles.submitButtonDisabled]}
                        onPress={handleSendOtp}
                        disabled={!isValidIndianPhone(phone)}
                      >
                        <Text style={styles.submitButtonText}>Send OTP</Text>
                      </Pressable>
                    </>
                  )}

                  {/* Step 2: OTP Input */}
                  {otpStep === 'otp' && (
                    <>
                      <View style={styles.otpHeader}>
                        <Shield size={28} color={colors.primary} />
                        <Text style={styles.otpTitle}>Enter OTP</Text>
                        <Text style={styles.otpSubtitle}>
                          A 6-digit code was sent to{'\n'}
                          <Text style={styles.phoneHighlight}>+91 {phone}</Text>
                        </Text>
                      </View>

                      <Text style={styles.inputLabel}>Verification Code</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}>
                          <Shield size={20} color={colors.textSecondary} />
                        </View>
                        <TextInput
                          style={[styles.input, { letterSpacing: 4, fontSize: fontSizes.xl }]}
                          value={otp}
                          onChangeText={(t) => { setOtp(t.replace(/[^0-9]/g, '')); setAuthError(null); }}
                          placeholder="000000"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="number-pad"
                          maxLength={6}
                          autoFocus
                        />
                      </View>

                      <Pressable
                        style={[styles.submitButton, otp.length < 6 && styles.submitButtonDisabled]}
                        onPress={handleVerifyOtp}
                        disabled={otp.length < 6}
                      >
                        <Text style={styles.submitButtonText}>Verify & Login</Text>
                      </Pressable>

                      <Pressable
                        style={styles.resendBtn}
                        onPress={() => { setOtpStep('phone'); setOtp(''); setAuthError(null); }}
                      >
                        <Text style={styles.resendText}>Didn't receive it? Resend OTP</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}

              {/* ERROR */}
              {(authError || hookError) && (
                <View style={styles.errorContainer}>
                  <AlertCircle size={16} color={colors.error} />
                  <Text style={styles.errorText}>{authError || hookError}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.securityNote}>
            <Shield size={14} color={colors.textDisabled} />
            <Text style={styles.securityText}>Protected by Truecaller & Firebase Security</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 120 },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  header: { alignItems: 'center', marginTop: 20, marginBottom: 32 },
  shieldContainer: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  logoImage: { width: 72, height: 72, borderRadius: 18, marginBottom: 20 },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: fontSizes.base, color: colors.textSecondary },
  roleHighlight: { fontWeight: fontWeights.semibold, color: colors.primary },
  actionsContainer: { flex: 1, justifyContent: 'center', gap: 16 },
  truecallerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: TC_GREEN, borderRadius: 14, paddingVertical: 16, gap: 12 },
  tcIconContainer: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  truecallerButtonText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: '#FFFFFF' },
  manualTriggerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 8 },
  manualTriggerText: { fontSize: fontSizes.sm, fontWeight: fontWeights.medium, color: colors.textPrimary },
  manualContainer: { gap: 16 },
  otpHeader: { alignItems: 'center', gap: 8, paddingVertical: 16, backgroundColor: colors.primarySurface, borderRadius: 16, paddingHorizontal: 16, marginBottom: 8 },
  otpTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.bold, color: colors.textPrimary },
  otpSubtitle: { fontSize: fontSizes.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  phoneHighlight: { fontWeight: fontWeights.semibold, color: colors.primary },
  inputLabel: { fontSize: fontSizes.sm, fontWeight: fontWeights.medium, color: colors.textPrimary, marginBottom: -8 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, paddingVertical: 16, paddingRight: 16, fontSize: fontSizes.md, fontWeight: fontWeights.medium, color: colors.textPrimary },
  submitButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitButtonDisabled: { backgroundColor: colors.textDisabled },
  submitButtonText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textInverse },
  hintText: { fontSize: fontSizes.xs, color: colors.textSecondary, textAlign: 'center', marginTop: -4 },
  errorContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.errorLight, borderRadius: 12, padding: 14, gap: 10, marginTop: 8 },
  errorText: { flex: 1, fontSize: fontSizes.sm, color: colors.error },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  successText: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.success },
  successSubtext: { fontSize: fontSizes.base, color: colors.textSecondary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textPrimary },
  securityNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 16 },
  securityText: { fontSize: fontSizes.xs, color: colors.textDisabled },
  resendBtn: { alignItems: 'center', paddingVertical: 12 },
  resendText: { fontSize: fontSizes.sm, color: colors.primary, fontWeight: fontWeights.medium },
});
