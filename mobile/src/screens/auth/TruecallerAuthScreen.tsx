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
  PermissionsAndroid,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation.types';
import { useTruecallerAuth, truecallerEmitter } from '../../hooks/useTruecallerAuth';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { Phone, Shield, ChevronLeft, CheckCircle, AlertCircle, User as UserIcon, Mail } from 'lucide-react-native';

type Props = NativeStackScreenProps<AuthStackParamList, 'TruecallerAuth'>;

const TC_GREEN = '#0095FF';
const TC_GREEN_DARK = '#0077CC';

// Drop Call Flow States
type FallbackStep = 'phone' | 'waiting_call' | 'profile_details' | 'verifying' | 'email_otp' | 'otp_verify';

export function TruecallerAuthScreen({ navigation, route }: Props) {
  const { role } = route.params;
  const { 
    isAvailable, 
    isLoading: tcLoading, 
    getAuthorizationCode, 
    requestVerification, 
    verifyMissedCall, 
    setTheme,
    error: hookError 
  } = useTruecallerAuth();
  const loginWithTruecaller = useAuthStore((s) => s.loginWithTruecaller);

  // States
  const [showManualInput, setShowManualInput] = useState(false);
  const [fallbackStep, setFallbackStep] = useState<FallbackStep>('phone');
  
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState(false);

  // Email OTP fallback state
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Initialize Theme and Animations
  useEffect(() => {
    // Set Truecaller Theme based on app color scheme
    setTheme(colors.isDark ? 'dark' : 'light');

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [setTheme]);

  // Listen to Truecaller Drop Call Native Events
  useEffect(() => {
    if (!truecallerEmitter) return;

    const successSub = truecallerEmitter.addListener('TruecallerVerificationEvent', async (event) => {
      if (__DEV__) console.log('[TC_EVENT_SUCCESS]', event);
      
      // TYPE_MISSED_CALL_INITIATED (Code 3)
      if (event.requestCode === 3) {
        // Switch to waiting UI immediately
        setFallbackStep('waiting_call');
        if (event.ttl) {
          setCountdown(Number(event.ttl));
        } else {
          setCountdown(30); // Default 30s if TTL missing
        }
      }
      
      // TYPE_MISSED_CALL_RECEIVED (Code 4)
      if (event.requestCode === 4) {
        if (__DEV__) console.log('[TC_EVENT] Missed call detected!');
        setFallbackStep('profile_details');
        setIsAuthenticating(false);
      }

      // TYPE_VERIFICATION_COMPLETE (Code 1) or TYPE_PROFILE_VERIFIED_BEFORE (Code 5)
      if (event.requestCode === 1 || event.requestCode === 5) {
        if (event.accessToken) {
          await handleDropCallBackendVerify(event.accessToken);
        }
      }
    });

    const errorSub = truecallerEmitter.addListener('TruecallerVerificationError', (event) => {
      console.error('[TC_ERROR]', event.error);
      setAuthError(event.error || 'Verification failed. Please try again.');
      setIsAuthenticating(false);
      setFallbackStep('phone');
    });

    return () => {
      successSub.remove();
      errorSub.remove();
    };
  }, []);

  // Auto-show manual input if Truecaller not available
  useEffect(() => {
    if (!tcLoading && !isAvailable) {
      const timer = setTimeout(() => setShowManualInput(true), 800);
      return () => clearTimeout(timer);
    }
  }, [isAvailable, tcLoading]);

  // Countdown Timer logic — when it hits 0, fall back to email OTP
  useEffect(() => {
    if (countdown === null || countdown <= 0 || fallbackStep !== 'waiting_call') return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c && c > 1) return c - 1;
        return 0;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown, fallbackStep]);

  // When countdown expires → automatically switch to email OTP fallback
  useEffect(() => {
    if (countdown === 0 && fallbackStep === 'waiting_call') {
      setFallbackStep('email_otp');
      setAuthError('Missed call not detected. Please verify via email OTP instead.');
      setIsAuthenticating(false);
    }
  }, [countdown, fallbackStep]);

  // Helpers
  const isValidIndianPhone = (num: string) => /^[6-9]\d{9}$/.test(num.replace(/[\s\-()]/g, ''));

  /**
   * Request Runtime Permissions strictly required for Drop Call
   */
  const requestDropCallPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
        PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS,
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      ]);

      return (
        granted[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED &&
        (granted[PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS] === PermissionsAndroid.RESULTS.GRANTED || 
         granted[PermissionsAndroid.PERMISSIONS.CALL_PHONE] === PermissionsAndroid.RESULTS.GRANTED)
      );
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  /**
   * 1. OAUTH FLOW (For Truecaller App Users)
   */
  const handleTruecallerAuth = async () => {
    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const result = await getAuthorizationCode();

      if (!result) {
        setShowManualInput(true);
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
        await loginWithTruecaller(data);
      } else {
        setAuthError(data.message || 'Verification failed');
      }
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'Authentication failed');
      setShowManualInput(true);
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 2. DROP CALL FLOW: Start Verification
   */
  const handleStartDropCall = async () => {
    if (!isValidIndianPhone(phone)) {
      setAuthError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    const hasPermissions = await requestDropCallPermissions();
    if (!hasPermissions) {
      setAuthError('Phone permissions are required to verify the missed call securely.');
      setIsAuthenticating(false);
      return;
    }

    try {
      // Normalize number
      const normalized = phone.replace(/[^0-9]/g, '');
      await requestVerification(normalized, 'IN');
      // The Native UI will emit events handled in useEffect
    } catch (err: any) {
      setAuthError(err.message || 'Failed to start verification');
      setIsAuthenticating(false);
    }
  };

  /**
   * 3. DROP CALL FLOW: Submit Name
   */
  const handleSubmitProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setAuthError('Please enter your full name');
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      await verifyMissedCall(firstName.trim(), lastName.trim());
      setFallbackStep('verifying');
      // Wait for TYPE_VERIFICATION_COMPLETE
    } catch (err: any) {
      setAuthError(err.message || 'Profile verification failed');
      setIsAuthenticating(false);
    }
  };

  /**
   * 4. DROP CALL FLOW: Backend Validation
   */
  const handleDropCallBackendVerify = async (accessToken: string) => {
    setIsAuthenticating(true);
    try {
      const { data } = await authApi.verifyDropCall({ accessToken, role });
      if (data.success) {
        setAuthSuccess(true);
        await loginWithTruecaller(data);
      } else {
        // Drop call failed — fall through to email OTP
        setAuthError('Call verification failed. Please use email OTP instead.');
        setFallbackStep('email_otp');
      }
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'Call verification failed. Please use email OTP.');
      setFallbackStep('email_otp');
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 5. EMAIL OTP FALLBACK: Request OTP
   * Calls POST /api/auth/fallback/request-otp
   */
  const handleRequestEmailOtp = async () => {
    if (!phone || !email.includes('@')) {
      setAuthError('Please enter a valid phone number and email address');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const normalized = phone.replace(/[^0-9]/g, '');
      await authApi.requestFallbackOtp({ phone: normalized, email: email.trim().toLowerCase() });
      setOtpSent(true);
      setFallbackStep('otp_verify');
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 6. EMAIL OTP FALLBACK: Verify OTP and login
   * Calls POST /api/auth/fallback/verify-otp
   */
  const handleVerifyEmailOtp = async () => {
    if (!otp || otp.length < 4) {
      setAuthError('Please enter the OTP sent to your email');
      return;
    }
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const normalized = phone.replace(/[^0-9]/g, '');
      const { data } = await authApi.verifyFallbackOtp({
        phone: normalized,
        email: email.trim().toLowerCase(),
        code: otp,
        role,
      });
      if (data.success) {
        setAuthSuccess(true);
        await loginWithTruecaller(data);
      } else {
        setAuthError(data.message || 'Invalid OTP. Please try again.');
      }
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'OTP verification failed.');
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
        keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          
          <Pressable
            style={styles.backButton}
            onPress={() => {
              if (showManualInput && fallbackStep !== 'phone') {
                setFallbackStep('phone');
                setAuthError(null);
              } else {
                navigation.goBack();
              }
            }}
            hitSlop={12}
          >
            <ChevronLeft size={24} color={colors.textPrimary} />
          </Pressable>

          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.shieldContainer}>
              <Shield size={32} color={colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Verify Your Identity</Text>
            <Text style={styles.subtitle}>
              Signing up as <Text style={styles.roleHighlight}>{roleLabel}</Text>
            </Text>
          </Animated.View>

          {authSuccess && (
            <View style={styles.successContainer}>
              <CheckCircle size={48} color={colors.success} />
              <Text style={styles.successText}>Verified Successfully!</Text>
              <Text style={styles.successSubtext}>Setting up your account...</Text>
            </View>
          )}

          {isAuthenticating && !authSuccess && fallbackStep !== 'waiting_call' && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Verifying your identity...</Text>
            </View>
          )}

          {!isAuthenticating && !authSuccess && (
            <View style={styles.actionsContainer}>
              
              {/* OAUTH FLOW */}
              {isAvailable && !showManualInput && (
                <Pressable style={styles.truecallerButton} onPress={handleTruecallerAuth}>
                  <View style={styles.tcIconContainer}>
                    <Phone size={22} color="#FFFFFF" strokeWidth={2.5} />
                  </View>
                  <Text style={styles.truecallerButtonText}>Continue with Truecaller</Text>
                </Pressable>
              )}

              {isAvailable && !showManualInput && (
                <Pressable
                  style={styles.manualTriggerBtn}
                  onPress={() => { setShowManualInput(true); setFallbackStep('email_otp'); }}
                >
                  <Mail size={16} color={colors.textPrimary} />
                  <Text style={styles.manualTriggerText}>Verify with Email OTP</Text>
                </Pressable>
              )}

              {/* DROP CALL FLOW */}
              {showManualInput && (
                <View style={styles.manualContainer}>
                  {fallbackStep === 'phone' && (
                    <>
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
                      <Text style={styles.hintText}>We will place a missed call to verify this number.</Text>
                      <Pressable
                        style={[styles.submitButton, !isValidIndianPhone(phone) && styles.submitButtonDisabled]}
                        onPress={handleStartDropCall}
                        disabled={!isValidIndianPhone(phone)}
                      >
                        <Text style={styles.submitButtonText}>Verify Number</Text>
                      </Pressable>
                    </>
                  )}

                  {fallbackStep === 'waiting_call' && (
                    <View style={styles.waitingContainer}>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={styles.waitingTitle}>Waiting for missed call...</Text>
                      <Text style={styles.waitingSubtext}>
                        Please do not answer the call. We will automatically detect it.
                      </Text>
                      {countdown !== null && (
                        <Text style={styles.countdownText}>Time remaining: {countdown}s</Text>
                      )}
                    </View>
                  )}

                  {fallbackStep === 'profile_details' && (
                    <>
                      <View style={styles.infoBox}>
                        <CheckCircle size={18} color={colors.success} />
                        <Text style={styles.infoText}>Missed call successfully intercepted!</Text>
                      </View>

                      <Text style={styles.inputLabel}>First Name</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}><UserIcon size={20} color={colors.textSecondary} /></View>
                        <TextInput
                          style={styles.input}
                          value={firstName}
                          onChangeText={setFirstName}
                          placeholder="E.g. Rahul"
                        />
                      </View>

                      <Text style={styles.inputLabel}>Last Name</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}><UserIcon size={20} color={colors.textSecondary} /></View>
                        <TextInput
                          style={styles.input}
                          value={lastName}
                          onChangeText={setLastName}
                          placeholder="E.g. Sharma"
                        />
                      </View>

                      <Pressable
                        style={[styles.submitButton, (!firstName || !lastName) && styles.submitButtonDisabled]}
                        onPress={handleSubmitProfile}
                        disabled={!firstName || !lastName}
                      >
                        <Text style={styles.submitButtonText}>Complete Verification</Text>
                      </Pressable>
                    </>
                  )}

                  {/* EMAIL OTP FALLBACK — Step 1: Collect phone + email */}
                  {fallbackStep === 'email_otp' && (
                    <>
                      <View style={styles.emailOtpHeader}>
                        <Mail size={28} color={colors.primary} />
                        <Text style={styles.emailOtpTitle}>Verify via Email OTP</Text>
                        <Text style={styles.emailOtpSubtitle}>
                          Enter your phone number and email. We'll send a one-time code.
                        </Text>
                      </View>

                      <Text style={styles.inputLabel}>Mobile Number</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}><Phone size={20} color={colors.textSecondary} /></View>
                        <TextInput
                          style={styles.input}
                          value={phone}
                          onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '')); setAuthError(null); }}
                          placeholder="10-digit mobile number"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="phone-pad"
                          maxLength={10}
                        />
                      </View>

                      <Text style={styles.inputLabel}>Email Address</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}><Mail size={20} color={colors.textSecondary} /></View>
                        <TextInput
                          style={styles.input}
                          value={email}
                          onChangeText={(t) => { setEmail(t.trim()); setAuthError(null); }}
                          placeholder="your@email.com"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoComplete="email"
                        />
                      </View>

                      <Pressable
                        style={[
                          styles.submitButton,
                          (!isValidIndianPhone(phone) || !email.includes('@')) && styles.submitButtonDisabled,
                        ]}
                        onPress={handleRequestEmailOtp}
                        disabled={!isValidIndianPhone(phone) || !email.includes('@') || isAuthenticating}
                      >
                        {isAuthenticating
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.submitButtonText}>Send OTP</Text>
                        }
                      </Pressable>
                    </>
                  )}

                  {/* EMAIL OTP FALLBACK — Step 2: Enter OTP */}
                  {fallbackStep === 'otp_verify' && (
                    <>
                      <View style={styles.emailOtpHeader}>
                        <CheckCircle size={28} color={colors.success} />
                        <Text style={styles.emailOtpTitle}>Enter OTP</Text>
                        <Text style={styles.emailOtpSubtitle}>
                          A 6-digit code was sent to{'\n'}<Text style={styles.emailHighlight}>{email}</Text>
                        </Text>
                      </View>

                      <Text style={styles.inputLabel}>One-Time Password</Text>
                      <View style={styles.inputWrapper}>
                        <View style={styles.inputIcon}><Shield size={20} color={colors.textSecondary} /></View>
                        <TextInput
                          style={styles.input}
                          value={otp}
                          onChangeText={(t) => { setOtp(t.replace(/[^0-9]/g, '')); setAuthError(null); }}
                          placeholder="Enter 6-digit OTP"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="number-pad"
                          maxLength={6}
                          autoFocus
                        />
                      </View>

                      <Pressable
                        style={[styles.submitButton, otp.length < 4 && styles.submitButtonDisabled]}
                        onPress={handleVerifyEmailOtp}
                        disabled={otp.length < 4 || isAuthenticating}
                      >
                        {isAuthenticating
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.submitButtonText}>Verify OTP</Text>
                        }
                      </Pressable>

                      <Pressable
                        style={styles.resendBtn}
                        onPress={() => { setFallbackStep('email_otp'); setOtp(''); setAuthError(null); }}
                      >
                        <Text style={styles.resendText}>Didn't receive it? Resend OTP</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}


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
            <Text style={styles.securityText}>Protected by Truecaller Security</Text>
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
  waitingContainer: { alignItems: 'center', padding: 24, backgroundColor: colors.surfaceElevated, borderRadius: 16, gap: 12 },
  waitingTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.textPrimary },
  waitingSubtext: { fontSize: fontSizes.sm, color: colors.textSecondary, textAlign: 'center' },
  countdownText: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.primary, marginTop: 8 },
  infoBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.successLight, borderRadius: 12, padding: 14, gap: 10 },
  infoText: { flex: 1, fontSize: fontSizes.sm, color: colors.success },
  // (manualTriggerBtn is defined above at line ~641)
  // Email OTP fallback styles
  emailOtpHeader: { alignItems: 'center', gap: 8, paddingVertical: 16, backgroundColor: colors.primarySurface, borderRadius: 16, paddingHorizontal: 16, marginBottom: 8 },
  emailOtpTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.bold, color: colors.textPrimary },
  emailOtpSubtitle: { fontSize: fontSizes.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emailHighlight: { fontWeight: fontWeights.semibold, color: colors.primary },
  resendBtn: { alignItems: 'center', paddingVertical: 12 },
  resendText: { fontSize: fontSizes.sm, color: colors.primary, fontWeight: fontWeights.medium },
});
