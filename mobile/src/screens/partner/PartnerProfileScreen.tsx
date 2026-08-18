/**
 * Partner Profile Screen — Profile info + verification status + logout
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Linking,
    Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
    User, Mail, Phone, MapPin, LogOut, ChevronRight,
    Shield, Edit3, CheckCircle, Navigation, MessageCircle, Trash2, Globe, Briefcase
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../../stores/languageStore';
import * as Location from 'expo-location';
import { useProfile, useUpdateProfile, usePublicConfig, usePartnerProfile, useUpdateUpiId, queryKeys } from '../../hooks/useCustomerData';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { apiClient } from '../../api/client';
import { useScreenInsets } from '../../theme/layout';

export function PartnerProfileScreen() {
    const queryClient = useQueryClient();
    const { headerTop, tabContent } = useScreenInsets();
    const navigation = useNavigation<any>();
    const { data: profile, isLoading } = useProfile();
    const { data: partnerProfile, isLoading: isPartnerLoading } = usePartnerProfile();
    const { mutate: updateProfile, isPending: saving } = useUpdateProfile();
    const { mutate: updateUpiId, isPending: savingUpi } = useUpdateUpiId();
    const { logout, user } = useAuthStore();
    const { data: publicConfig } = usePublicConfig();
    const { t } = useTranslation();
    const { language, setLanguage } = useLanguageStore();
    
    const whatsappNumber = publicConfig?.whatsappNumber || '919448850679';

    const [editing, setEditing] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [homeAddress, setHomeAddress] = useState('');
    // The expert app never offered a pin code field, so experts had no way to
    // supply the one value serviceability and dispatch are decided on.
    const [pinCode, setPinCode] = useState('');
    const [upiId, setUpiId] = useState('');
    const [fetchingLocation, setFetchingLocation] = useState(false);
    // PHASE 3: Online/offline toggle (Task 3.4)
    const [isOnline, setIsOnline] = useState(user?.isOnline ?? false);
    const [togglingOnline, setTogglingOnline] = useState(false);

    useEffect(() => {
        if (profile) {
            setUsername(profile.username ? String(profile.username) : '');
            setEmail(profile.email ? String(profile.email) : '');
            setPhone(profile.phone ? String(profile.phone) : '');
            setHomeAddress(profile.homeAddress ? String(profile.homeAddress) : '');
            setPinCode(profile.pinCode ? String(profile.pinCode) : '');
        }
    }, [profile]);

    useEffect(() => {
        if (partnerProfile) {
            const fetchedUpiId = (partnerProfile as any)?.data?.upiId || (partnerProfile as any)?.upiId;
            setUpiId(fetchedUpiId ? String(fetchedUpiId) : '');

            // isOnline was seeded from the auth store, which is only written at
            // login and then persisted to SecureStore. On relaunch the switch
            // showed login-time state rather than the database, so a partner the
            // server still considers online could see the toggle sitting at OFF.
            const fetchedIsOnline =
                (partnerProfile as any)?.data?.isOnline ?? (partnerProfile as any)?.isOnline;
            if (typeof fetchedIsOnline === 'boolean') {
                setIsOnline(fetchedIsOnline);
            }
        }
    }, [partnerProfile]);

    const handleSave = () => {
        // Basic validation
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Alert.alert('Validation Error', 'Please enter a valid email address.');
            return;
        }

        if (pinCode && !/^\d{6}$/.test(pinCode)) {
            Alert.alert('Validation Error', 'Pin code must be exactly 6 digits.');
            return;
        }

        updateProfile(
            { username, email, homeAddress, pinCode },
            { onSuccess: () => { setEditing(false); Alert.alert('Saved', 'Profile updated.'); } },
        );
    };

    const handleFetchLocation = async () => {
        try {
            setFetchingLocation(true);
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Permission to access location was denied');
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            const geocode = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            });

            if (geocode && geocode.length > 0) {
                const addr = geocode[0];
                const addressString = `${addr.name ? addr.name + ', ' : ''}${addr.street ? addr.street + ', ' : ''}${addr.city ? addr.city + ', ' : ''}${addr.region || ''}`.replace(/,\s*$/, "");
                setHomeAddress(addressString);
                // Filled from the same lookup — leaving it blank was the whole
                // reason experts ended up with an address but no pin code.
                if (addr.postalCode) setPinCode(String(addr.postalCode));
            }
        } catch (error) {
            console.error('Error fetching location:', error);
            Alert.alert('Error', 'Could not fetch your current location.');
        } finally {
            setFetchingLocation(false);
        }
    };

    const handleLogout = () => {
        Alert.alert('Log Out', 'Are you sure?', [
            { text: 'Cancel' },
            { text: 'Log Out', style: 'destructive', onPress: () => logout() },
        ]);
    };

    const handleDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This will permanently delete your partner account and all associated data after 30 days. This action cannot be undone.\n\nAre you sure you want to proceed?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete My Account',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiClient.delete('/api/client/account', { data: { confirmDelete: true } });
                            Alert.alert('Account Scheduled for Deletion', 'Your account will be deleted within 30 days. You will now be logged out.');
                            await logout();
                        } catch (err: any) {
                            Alert.alert('Error', err?.response?.data?.message || 'Failed to delete account. Please try again.');
                        }
                    },
                },
            ]
        );
    };

    // PHASE 3: Online/offline toggle handler (Task 3.4)
    const handleToggleOnline = async (value: boolean) => {
        setTogglingOnline(true);
        try {
            const { data } = await apiClient.patch('/api/partner/availability', { isOnline: value });
            if (data?.success) {
                setIsOnline(data.data.isOnline);
                // Keep the cached employee row in step with the new availability.
                queryClient.invalidateQueries({ queryKey: queryKeys.partnerProfile });
            }
        } catch (err: any) {
            const msg = err?.response?.data?.message || 'Failed to update availability';
            Alert.alert('Error', msg);
        } finally {
            setTogglingOnline(false);
        }
    };

    const toggleLanguage = () => {
        const newLang = language === 'en' ? 'kn' : 'en';
        setLanguage(newLang);
    };

    if (isLoading || isPartnerLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    const displayName = profile?.username || user?.username || 'Employee';

    return (
        <ScrollView style={styles.container} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContent }]} showsVerticalScrollIndicator={false}>
            {/* Profile header */}
            <View style={[styles.profileHeader, { paddingTop: headerTop }]}>
                <View style={styles.avatarLarge}>
                    <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.displayName}>{displayName}</Text>
                <View style={styles.rolePill}>
                    <Text style={styles.roleText}>🔧 Employee / Technician</Text>
                </View>

                {/* Verification status */}
                <View style={[styles.verifyBadge, profile?.isVerified ? styles.verifiedBg : styles.unverifiedBg]}>
                    {profile?.isVerified ? (
                        <>
                            <CheckCircle size={14} color={colors.success} />
                            <Text style={styles.verifiedText}>Verified</Text>
                        </>
                    ) : (
                        <>
                            <Shield size={14} color={colors.warning} />
                            <Text style={styles.unverifiedText}>Verification Pending</Text>
                        </>
                    )}
                </View>

                {/* PHASE 3: Online/Offline Toggle (Task 3.4) */}
                <View style={styles.onlineToggle}>
                    <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.success : colors.textDisabled }]} />
                    <Text style={styles.onlineLabel}>{isOnline ? 'Online' : 'Offline'}</Text>
                    <Switch
                        value={isOnline}
                        onValueChange={handleToggleOnline}
                        disabled={togglingOnline}
                        trackColor={{ false: colors.border, true: colors.successLight }}
                        thumbColor={isOnline ? colors.success : colors.textSecondary}
                    />
                </View>

                {!editing && (
                    <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                        <Edit3 size={16} color={colors.primary} />
                        <Text style={styles.editBtnText}>Edit Profile</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Info */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Personal Information</Text>

                {editing ? (
                    <View>
                        <Input label="Full Name" value={username} onChangeText={setUsername} icon={<User size={18} color={colors.textSecondary} />} />
                        <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" icon={<Mail size={18} color={colors.textSecondary} />} />
                        <Input label="Phone (Read-only)" value={phone} editable={false} style={{ color: colors.textSecondary }} icon={<Phone size={18} color={colors.textSecondary} />} />
                        {/* "Base location", not "address": for an expert this is
                            where they work FROM, and it decides which jobs reach
                            them - not somewhere a technician is sent. */}
                        <Input
                            label="Address (Base Location)"
                            value={homeAddress}
                            onChangeText={setHomeAddress} 
                            icon={<MapPin size={18} color={colors.textSecondary} />} 
                            rightElement={
                                <TouchableOpacity
                                    onPress={handleFetchLocation}
                                    disabled={fetchingLocation}
                                    style={{ padding: 4 }}
                                >
                                    {fetchingLocation ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <Navigation size={20} color={colors.primary} />
                                    )}
                                </TouchableOpacity>
                            }
                        />
                        <Input
                            label="Pin Code (Base Location)"
                            value={pinCode}
                            onChangeText={(t: string) => setPinCode(t.replace(/\D/g, '').slice(0, 6))}
                            keyboardType="number-pad"
                            maxLength={6}
                            placeholder="6 digits"
                            icon={<Shield size={18} color={colors.textSecondary} />}
                        />
                        <View style={styles.editActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <View style={{ flex: 1 }}>
                                <Button title="Save" onPress={handleSave} loading={saving} fullWidth={true} />
                            </View>
                        </View>
                    </View>
                ) : (
                    <View>
                        <InfoRow icon={User} label="Name" value={displayName} />
                        <InfoRow icon={Mail} label="Email" value={profile?.email || 'Not set'} />
                        <InfoRow icon={Phone} label="Phone" value={profile?.phone || 'Not set'} />
                        <InfoRow icon={MapPin} label="Address (Base Location)" value={profile?.homeAddress || 'Not set'} />
                        <InfoRow icon={Shield} label="Pin Code (Base Location)" value={profile?.pinCode || 'Not set'} />
                    </View>
                )}
            </View>

            {/* Payout Details */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payout Details (UPI)</Text>
                
                {editing ? (
                    <View>
                        <Input 
                            label="UPI ID" 
                            value={upiId} 
                            onChangeText={setUpiId} 
                            placeholder={(partnerProfile as any)?.upiId || (partnerProfile as any)?.data?.upiId || "e.g. 9876543210@ybl"}
                            autoCapitalize="none"
                        />
                        <View style={styles.editActions}>
                            <View style={{ flex: 1 }}>
                                <Button 
                                    title="Save UPI ID" 
                                    onPress={() => {
                                        updateUpiId(
                                            { upiId }, 
                                            { onSuccess: () => { 
                                                setEditing(false);
                                                Alert.alert('Saved', 'UPI ID updated successfully.');
                                            }}
                                        );
                                    }} 
                                    loading={savingUpi} 
                                    fullWidth={true} 
                                />
                            </View>
                        </View>
                    </View>
                ) : (
                    <View>
                        <InfoRow icon={CheckCircle} label="UPI ID" value={(partnerProfile as any)?.upiId || (partnerProfile as any)?.data?.upiId || 'Not set'} />
                    </View>
                )}
            </View>

            {/* Help & Support & Settings */}
            <View style={styles.section}>
                <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.divider }]} onPress={toggleLanguage}>
                    <View style={styles.menuLeft}>
                        <Globe size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>{t('profile.language', 'Language')} ({language === 'en' ? 'English' : 'ಕನ್ನಡ'})</Text>
                    </View>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t('profile.select_language', 'Tap to change')}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={() => {
                    Linking.openURL(`whatsapp://send?phone=+${whatsappNumber}&text=Hello UniteFix Support, I need help.`).catch(() => {
                        Alert.alert('Error', 'Make sure WhatsApp is installed on your device');
                    });
                }}>
                    <View style={styles.menuLeft}>
                        <MessageCircle size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>Help (WhatsApp)</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>
            </View>

            {/* Skills / Expertise */}
            <View style={[styles.section, { marginTop: spacing.md }]}>
                <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('ManageExpertise')}>
                    <View style={styles.menuLeft}>
                        <Briefcase size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>
                            Manage Skills
                            {(() => {
                                const s = (partnerProfile as any)?.data?.services ?? (partnerProfile as any)?.services;
                                return Array.isArray(s) && s.length > 0 ? ` (${s.length})` : '';
                            })()}
                        </Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>
            </View>

            {/* Account Actions */}
            <View style={[styles.section, { marginTop: spacing.md }]}>
                <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Legal')}>
                    <View style={styles.menuLeft}>
                        <Shield size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>Legal & Policies</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuItem, { borderTopWidth: 1, borderTopColor: colors.divider }]} onPress={handleLogout}>
                    <View style={styles.menuLeft}>
                        <LogOut size={20} color={colors.error} />
                        <Text style={[styles.menuLabel, { color: colors.error }]}>Log Out</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuItem, { borderTopWidth: 1, borderTopColor: colors.divider }]} onPress={handleDeleteAccount}>
                    <View style={styles.menuLeft}>
                        <Trash2 size={20} color={colors.error} />
                        <Text style={[styles.menuLabel, { color: colors.error }]}>Delete Account</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
                <Icon size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue}>{value}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    scrollContent: {},
    profileHeader: {
        alignItems: 'center', paddingBottom: spacing.xl,
        backgroundColor: colors.background, borderBottomLeftRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'], ...shadows.sm,
    },
    avatarLarge: {
        width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
        justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
    },
    avatarText: { fontSize: 32, fontWeight: '700', color: colors.textInverse },
    displayName: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
    rolePill: {
        backgroundColor: colors.surface, paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md, borderRadius: radii.full,
    },
    roleText: { ...typography.caption, color: colors.textSecondary },
    verifyBadge: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
        borderRadius: radii.full, marginTop: spacing.md,
    },
    verifiedBg: { backgroundColor: colors.successLight },
    unverifiedBg: { backgroundColor: colors.warningLight },
    verifiedText: { ...typography.small, color: colors.success, fontWeight: '600' },
    unverifiedText: { ...typography.small, color: colors.warning, fontWeight: '600' },
    onlineToggle: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginTop: spacing.md, paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md, backgroundColor: colors.surface,
        borderRadius: radii.full,
    },
    onlineDot: {
        width: 10, height: 10, borderRadius: 5,
    },
    onlineLabel: { ...typography.bodyMedium, flex: 1 },
    editBtn: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
        borderRadius: radii.full, borderWidth: 1, borderColor: colors.primary,
    },
    editBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    section: {
        marginTop: spacing.xl, marginHorizontal: spacing.xl,
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, ...shadows.sm,
    },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    editActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
    cancelBtn: {
        paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
        borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    },
    cancelText: { ...typography.bodyMedium, color: colors.textSecondary },
    infoRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    infoIconWrap: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySurface,
        justifyContent: 'center', alignItems: 'center', marginRight: spacing.md,
    },
    infoLabel: { ...typography.small, color: colors.textSecondary },
    infoValue: { ...typography.bodyMedium, color: colors.textPrimary, marginTop: 1 },
    menuItem: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md,
    },
    menuLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    menuLabel: { ...typography.bodyMedium, color: colors.textPrimary, flexShrink: 1 },
});
