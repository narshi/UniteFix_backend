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
import { Phone, Shield, ChevronLeft, CheckCircle, AlertCircle, Mail, User } from 'lucide-react-native';

type Props = NativeStackScreenProps<AuthStackParamList, 'TruecallerAuth'>;

const TC_GREEN = '#0095FF';

type OtpStep = 'phone' | 'otp' | 'profile';

export function TruecallerAuthScreen({ navigation, route }: Props) {
  const { role, mode } = route.params;
  const isSignup = mode === 'signup';
  const {
    isAvailable,
    isLoading: tcLoading,
    getAuthorizationCode,
    setTheme,
    error: hookError,
  } = useTruecallerAuth();
  const loginWithTruecaller = useAuthStore((s) => s.loginWithTruecaller);

  /**
   * Complete the session immediately. Onboarding is no longer sequenced from
   * here: RootNavigator renders the onboarding stack whenever the account still
   * has outstanding steps, so a signup that is interrupted resumes correctly
   * instead of stranding a half-created account outside the app.
   */
  const handleAuthSuccess = async (data: any) => {
    await loginWithTruecaller(data);
  };

  /**
   * Maps the server's explicit login/signup rejections, and Firebase's own
   * error codes, to copy a user can act on.
   *
   * Firebase throws its own English strings ("The SMS code has expired. Please
   * re-send the verification code to try again.") which are both alarming and
   * often wrong from the user's point of view — session-expired usually means
   * Android already auto-verified, not that they were slow. Map the codes we
   * can actually act on and keep the rest generic.
   */
  const describeAuthFailure = (err: any): string => {
    const payload = err?.response?.data;
    if (payload?.code === 'ACCOUNT_NOT_FOUND') {
      return 'No UniteFix account found for this number. Please create an account first.';
    }

    switch (err?.code) {
      case 'auth/invalid-verification-code':
        return 'That code does not match. Please check the SMS and try again.';
      case 'auth/session-expired':
      case 'auth/code-expired':
        return 'That code has timed out. Tap Resend to get a new one.';
      case 'auth/too-many-requests':
        return 'Too many attempts from this device. Wait a few minutes, or continue with Truecaller.';
      case 'auth/invalid-phone-number':
        return 'That phone number does not look right. Please check and try again.';
      case 'auth/network-request-failed':
        return 'Network problem. Check your connection and try again.';
      case 'auth/quota-exceeded':
        return 'Verification is temporarily unavailable. Please try again shortly.';
      default:
        return payload?.message || err?.message || 'Authentication failed';
    }
  };

  // UI state
  const [showOtpFlow, setShowOtpFlow] = useState(false);
  const [otpStep, setOtpStep] = useState<OtpStep>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tempToken, setTempToken] = useState(''); // Store token for profile submission
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState(false);
  /** Seconds until Resend is allowed again. See startResendCooldown. */
  const [resendIn, setResendIn] = useState(0);

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

  /**
   * Exchanges a signed-in Firebase user for a UniteFix session.
   *
   * SINGLE ENTRY POINT, ON PURPOSE. Android can verify a number without the
   * user ever typing the code, so a sign-in can arrive from the auto-verify
   * listener OR from confirm(otp). Previously both called this independently:
   * the listener consumed the session first, then confirm(otp) threw
   * auth/session-expired and the user was told their correct code had expired.
   *
   * The ref latch means whichever arrives first wins and the other is a no-op.
   * It is a ref rather than state because both callers can fire within the same
   * tick, before React would have re-rendered.
   */
  const completedRef = useRef(false);

  /**
   * Android auto-verification (instant verification / SMS auto-retrieval).
   *
   * Only acts on sign-ins that happen AFTER we asked for a code in this attempt.
   * Firebase persists currentUser across app launches and onAuthStateChanged
   * fires immediately on subscribe, so without the `awaitingVerification` guard
   * this fired with a previous session — sometimes for a different phone number
   * entirely — the moment the OTP step mounted.
   */
  const awaitingVerification = useRef(false);


  const exchangeFirebaseUser = async (user: any, source: 'auto' | 'manual') => {
    if (completedRef.current) return;
    completedRef.current = true;

    try {
      setIsAuthenticating(true);
      const idToken = await user.getIdToken();
      const normalized = phone.replace(/[^0-9]/g, '');

      const { data } = await authApi.firebaseVerify({
        idToken,
        phone: normalized,
        role,
        mode,
      });

      if (data.requiresProfile) {
        // Still mid-flow — the profile step reuses this token.
        awaitingVerification.current = false;
        setTempToken(idToken);
        setOtpStep('profile');
      } else if (data.success) {
        awaitingVerification.current = false;
        setAuthSuccess(true);
        await handleAuthSuccess(data);

        // We hold our own JWT now, so the Firebase session has served its
        // purpose. Leaving it signed in is exactly what made the next attempt
        // fire the auto-verify listener with a stale user.
        try {
          await auth().signOut();
        } catch {
          // Nothing depends on this succeeding.
        }
      } else {
        completedRef.current = false; // let them retry
        setAuthError(data.message || 'Verification failed');
      }
    } catch (err: any) {
      completedRef.current = false;
      if (__DEV__) console.error(`[Firebase ${source}]`, err);
      setAuthError(describeAuthFailure(err));
    } finally {
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    const subscriber = auth().onAuthStateChanged((user) => {
      if (!user) return;
      if (!awaitingVerification.current) return;
      void exchangeFirebaseUser(user, 'auto');
    });
    return subscriber; // unsubscribe on unmount
  }, [phone, role, mode]);

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
        mode,
      });
      if (data.success) {
        setAuthSuccess(true);
        await handleAuthSuccess(data);
      } else {
        setAuthError(data.message || 'Verification failed');
      }
    } catch (err: any) {
      const message = describeAuthFailure(err);
      setAuthError(message);
      // An unregistered number on login is a dead end here — sending the user
      // to the OTP form would just fail the same way.
      if (err?.response?.data?.code !== 'ACCOUNT_NOT_FOUND') {
        setShowOtpFlow(true);
      }
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
      const normalized = phone.replace(/[^0-9]/g, '');

      // On login, confirm the number is registered before spending an SMS —
      // otherwise the user waits for a code only to be rejected after entering it.
      if (!isSignup) {
        const { data: check } = await authApi.checkPhone({ phone: normalized });
        if (check?.success && check.exists === false) {
          setAuthError('No UniteFix account found for this number. Please create an account first.');
          return;
        }
      }

      // Clear any leftover Firebase session before asking for a new code.
      // Firebase persists currentUser indefinitely, and a stale one both fires
      // the auto-verify listener spuriously and lets instant verification
      // short-circuit the SMS for a number the user may no longer be using.
      try {
        if (auth().currentUser) await auth().signOut();
      } catch {
        // Not being signed in is the desired state anyway.
      }

      completedRef.current = false;
      awaitingVerification.current = true;

      const fullPhone = '+91' + normalized;
      const confirmation = await auth().signInWithPhoneNumber(fullPhone);
      confirmationRef.current = confirmation;
      setOtpStep('otp');
      startResendCooldown();
    } catch (err: any) {
      awaitingVerification.current = false;
      if (__DEV__) console.error('[Firebase OTP]', err);
      setAuthError(describeAuthFailure(err));
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * Resend cooldown.
   *
   * Firebase throttles per number and per device, and every re-send counts
   * toward that. Without a cooldown a user tapping resend after each failure
   * reached auth/too-many-requests in about three attempts, which is what was
   * being read as "the app blocked me".
   */
  const startResendCooldown = () => setResendIn(45);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const handleResendOtp = async () => {
    if (resendIn > 0 || isAuthenticating) return;
    setOtp('');
    setAuthError(null);
    await handleSendOtp();
  };

  /**
   * 3. FIREBASE PHONE OTP — Verify OTP
   */
  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      setAuthError('Please enter the 6-digit OTP');
      return;
    }
    // The auto-verify listener may already be mid-exchange.
    if (completedRef.current) return;

    setIsAuthenticating(true);
    setAuthError(null);
    try {
      if (!confirmationRef.current) {
        setAuthError('That code has timed out. Tap Resend to get a new one.');
        return;
      }

      const userCredential = await confirmationRef.current.confirm(otp);
      await exchangeFirebaseUser(userCredential.user, 'manual');
    } catch (err: any) {
      // THE "CORRECT CODE SAYS EXPIRED" CASE.
      //
      // On Android, Firebase can verify the number on its own and consume the
      // confirmation. The user's genuinely-correct code then fails with
      // session-expired, because there is no session left to spend — not
      // because they were slow. If a Firebase user actually exists at this
      // point, verification DID succeed, so carry on with it instead of
      // showing an error and sending them round the loop again.
      const alreadyVerified =
        (err?.code === 'auth/session-expired' || err?.code === 'auth/code-expired') &&
        auth().currentUser;

      if (alreadyVerified) {
        if (__DEV__) console.log('[Firebase] Auto-verified; using existing session');
        await exchangeFirebaseUser(auth().currentUser, 'manual');
        return;
      }

      if (__DEV__) console.error('[Firebase confirm]', err);
      setAuthError(describeAuthFailure(err));
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * 4. COMPLETE PROFILE (FOR NEW USERS)
   */
  const handleCompleteProfile = async () => {
    if (!name.trim() || !email.trim()) {
      setAuthError('Name and email are required');
      return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('Please enter a valid email');
      return;
    }

    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const normalized = phone.replace(/[^0-9]/g, '');
      // We pass the tempToken, phone, role, and now Name and Email back to firebaseVerify
      // Since it's a POST request with body, we use authApi.firebaseVerify again
      const { data } = await authApi.firebaseVerify({
        idToken: tempToken,
        phone: normalized,
        role,
        mode,
        firstName: name,
        email: email,
      });

      if (data.success && !data.requiresProfile) {
        setAuthSuccess(true);
        await handleAuthSuccess(data);
      } else {
        setAuthError(data.message || 'Profile creation failed');
      }
    } catch (err: any) {
      setAuthError(err?.response?.data?.message || err.message || 'Profile creation failed');
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
            <Text style={styles.title}>{isSignup ? 'Create Your Account' : 'Welcome Back'}</Text>
            <Text style={styles.subtitle}>
              {isSignup ? (
                <>Signing up as <Text style={styles.roleHighlight}>{roleLabel}</Text></>
              ) : (
                'Log in with your registered mobile number'
              )}
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
                  <Text style={styles.truecallerButtonText}>
                    {isSignup ? 'Sign up with Truecaller' : 'Log in with Truecaller'}
                  </Text>
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
                        <Text style={styles.submitButtonText}>
                          {isSignup ? 'Verify & Continue' : 'Verify & Log In'}
                        </Text>
                      </Pressable>

                      {/* Resend is throttled: every request counts toward
                          Firebase's per-number limit, and hammering it is what
                          used to get people locked out. */}
                      <Pressable
                        style={styles.resendBtn}
                        onPress={handleResendOtp}
                        disabled={resendIn > 0 || isAuthenticating}
                      >
                        <Text style={[styles.resendText, resendIn > 0 && styles.resendTextDisabled]}>
                          {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.resendBtn}
                        onPress={() => {
                          setOtpStep('phone');
                          setOtp('');
                          setAuthError(null);
                          // Leaving this attempt behind: stop the listener acting
                          // on a sign-in for the number they just abandoned.
                          awaitingVerification.current = false;
                          completedRef.current = false;
                          confirmationRef.current = null;
                        }}
                      >
                        <Text style={styles.resendText}>Change Number</Text>
                      </Pressable>
                    </>
                  )}

                  {/* Step 3: Profile Input for New Users */}
                  {otpStep === 'profile' && (
                    <>
                      <View style={styles.otpHeader}>
                        <User size={28} color={colors.primary} />
                        <Text style={styles.otpTitle}>Complete Profile</Text>
                        <Text style={styles.otpSubtitle}>
                          Please provide your details to finish registration.
                        </Text>
                      </View>

                      <Text style={styles.inputLabel}>Full Name *</Text>
                      <View style={styles.inputWrapper}>
                        <TextInput
                          style={styles.input}
                          value={name}
                          onChangeText={(t) => { setName(t); setAuthError(null); }}
                          placeholder="John Doe"
                          placeholderTextColor={colors.textDisabled}
                        />
                      </View>

                      <Text style={[styles.inputLabel, { marginTop: 16 }]}>Email Address *</Text>
                      <View style={styles.inputWrapper}>
                        <TextInput
                          style={styles.input}
                          value={email}
                          onChangeText={(t) => { setEmail(t); setAuthError(null); }}
                          placeholder="john@example.com"
                          placeholderTextColor={colors.textDisabled}
                          keyboardType="email-address"
                          autoCapitalize="none"
                        />
                      </View>

                      <Pressable
                        style={[styles.submitButton, (!name.trim() || !email.trim()) && styles.submitButtonDisabled]}
                        onPress={handleCompleteProfile}
                        disabled={!name.trim() || !email.trim()}
                      >
                        <Text style={styles.submitButtonText}>Complete Signup</Text>
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
  resendTextDisabled: { color: colors.textDisabled },
});
