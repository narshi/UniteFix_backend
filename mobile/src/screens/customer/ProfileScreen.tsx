/**
 * Profile Screen — View/Edit profile + Logout
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
    User,
    Mail,
    Phone,
    MapPin,
    LogOut,
    ChevronRight,
    Shield,
    Edit3,
    Save,
    Navigation,
    MessageCircle,
    Globe,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../../stores/languageStore';
import { Trash2 } from 'lucide-react-native';
import * as Location from 'expo-location';
import { apiClient } from '../../api/client';
import { useProfile, useUpdateProfile, usePublicConfig } from '../../hooks/useCustomerData';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

export function ProfileScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const navigation = useNavigation<any>();
    const { data: profile, isLoading } = useProfile();
    const { mutate: updateProfile, isPending: saving } = useUpdateProfile();
    const { logout, user } = useAuthStore();
    const { data: publicConfig } = usePublicConfig();
    const { t, i18n } = useTranslation();
    const { language, setLanguage } = useLanguageStore();
    
    const whatsappNumber = publicConfig?.whatsappNumber || '919448850679';

    const [editing, setEditing] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [homeAddress, setHomeAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [fetchingLocation, setFetchingLocation] = useState(false);

    useEffect(() => {
        if (profile) {
            setUsername(profile.username ? String(profile.username) : '');
            setEmail(profile.email ? String(profile.email) : '');
            setPhone(profile.phone ? String(profile.phone) : '');
            setHomeAddress(profile.homeAddress ? String(profile.homeAddress) : '');
            setPinCode(profile.pinCode ? String(profile.pinCode) : '');
        }
    }, [profile]);

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
            {
                onSuccess: () => {
                    setEditing(false);
                    Alert.alert('Saved', 'Profile updated successfully.');
                },
            }
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
                if (addr.postalCode) {
                    setPinCode(addr.postalCode);
                }
            }
        } catch (error) {
            console.error('Error fetching location:', error);
            Alert.alert('Error', 'Could not fetch your current location.');
        } finally {
            setFetchingLocation(false);
        }
    };

    const handleLogout = () => {
        Alert.alert('Log Out', 'Are you sure you want to log out?', [
            { text: 'Cancel' },
            {
                text: 'Log Out',
                style: 'destructive',
                onPress: () => logout(),
            },
        ]);
    };

    const handleDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This will permanently delete your account and all associated data after 30 days. This action cannot be undone.\n\nAre you sure you want to proceed?',
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

    const toggleLanguage = () => {
        const newLang = language === 'en' ? 'kn' : 'en';
        setLanguage(newLang);
        // Note: i18n instance automatically syncs via the store subscription in i18n/index.ts
    };

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    const displayName = profile?.username || user?.username || 'User';

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContent }]}
            showsVerticalScrollIndicator={false}
        >
            {/* Profile header */}
            <View style={[styles.profileHeader, { paddingTop: headerTop }]}>
                <View style={styles.avatarLarge}>
                    <Text style={styles.avatarLargeText}>
                        {displayName.charAt(0).toUpperCase()}
                    </Text>
                </View>
                <Text style={styles.displayName}>{displayName}</Text>
                <Text style={styles.roleBadge}>
                    {profile?.role === 'serviceman' ? `🔧 ${t('profile.employee')}` : `👤 ${t('profile.customer')}`}
                </Text>
                {!editing && (
                    <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                        <Edit3 size={16} color={colors.primary} />
                        <Text style={styles.editBtnText}>{t('profile.edit_profile')}</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Info / Edit sections */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('profile.personal_info')}</Text>

                {editing ? (
                    <View style={styles.editForm}>
                        <Input
                            label={t('profile.full_name')}
                            value={username}
                            onChangeText={setUsername}
                            icon={<User size={18} color={colors.textSecondary} />}
                        />
                        <Input
                            label={t('profile.email')}
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            icon={<Mail size={18} color={colors.textSecondary} />}
                        />
                        <Input
                            label={t('profile.phone_readonly')}
                            value={phone}
                            editable={false}
                            style={{ color: colors.textSecondary }}
                            icon={<Phone size={18} color={colors.textSecondary} />}
                        />
                        <View style={{ position: 'relative' }}>
                            <Input
                                label={t('profile.address')}
                                value={homeAddress}
                                onChangeText={setHomeAddress}
                                icon={<MapPin size={18} color={colors.textSecondary} />}
                            />
                            <TouchableOpacity 
                                style={{ position: 'absolute', right: 10, top: 38, padding: 5 }} 
                                onPress={handleFetchLocation}
                                disabled={fetchingLocation}
                            >
                                {fetchingLocation ? (
                                    <ActivityIndicator size="small" color={colors.primary} />
                                ) : (
                                    <Navigation size={20} color={colors.primary} />
                                )}
                            </TouchableOpacity>
                        </View>
                        <Input
                            label={t('profile.pin_code')}
                            value={pinCode}
                            onChangeText={setPinCode}
                            keyboardType="number-pad"
                            maxLength={6}
                        />
                        <View style={styles.editActions}>
                            <TouchableOpacity style={styles.cancelEditBtn} onPress={() => setEditing(false)}>
                                <Text style={styles.cancelEditText}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <View style={{ flex: 1 }}>
                                <Button title={t('common.save')} onPress={handleSave} loading={saving} fullWidth={true} />
                            </View>
                        </View>
                    </View>
                ) : (
                    <View style={styles.infoList}>
                        <InfoRow icon={User} label={t('profile.name')} value={displayName} />
                        <InfoRow icon={Mail} label={t('profile.email')} value={profile?.email || 'Not set'} />
                        <InfoRow icon={Phone} label={t('profile.phone')} value={profile?.phone || 'Not set'} />
                        <InfoRow icon={MapPin} label={t('profile.address')} value={profile?.homeAddress || 'Not set'} />
                        <InfoRow icon={Shield} label={t('profile.pin_code')} value={profile?.pinCode || 'Not set'} />
                    </View>
                )}
            </View>

            {/* Account section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('profile.settings')}</Text>
                
                <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.divider }]} onPress={toggleLanguage}>
                    <View style={styles.menuLeft}>
                        <Globe size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>{t('profile.language')} ({language === 'en' ? 'English' : 'ಕನ್ನಡ'})</Text>
                    </View>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t('profile.select_language', 'Tap to change')}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.divider }]} onPress={() => {
                    Linking.openURL(`whatsapp://send?phone=+${whatsappNumber}&text=Hello UniteFix Support, I need help.`).catch(() => {
                        Alert.alert('Error', 'Make sure WhatsApp is installed on your device');
                    });
                }}>
                    <View style={styles.menuLeft}>
                        <MessageCircle size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>{t('profile.support', 'Help & Support')}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                {profile?.role === 'serviceman' && (
                    <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.divider }]} activeOpacity={0.7}>
                        <View style={styles.menuLeft}>
                            <Shield size={20} color={colors.primary} />
                            <Text style={styles.menuLabel}>{t('profile.switch_to_partner')}</Text>
                        </View>
                        <ChevronRight size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Legal')}>
                    <View style={styles.menuLeft}>
                        <Shield size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>Legal & Policies</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
                    <View style={styles.menuLeft}>
                        <LogOut size={20} color={colors.error} />
                        <Text style={[styles.menuLabel, { color: colors.error }]}>{t('profile.logout', 'Log Out')}</Text>
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
            <View style={styles.infoContent}>
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
        alignItems: 'center',
        paddingBottom: spacing.xl,
        backgroundColor: colors.background,
        borderBottomLeftRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'],
        ...shadows.sm,
    },
    avatarLarge: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.md,
        borderWidth: 3, borderColor: 'rgba(79, 70, 229, 0.2)',
    },
    avatarLargeText: { fontSize: 30, fontWeight: '700', color: colors.textInverse },
    displayName: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
    roleBadge: {
        ...typography.caption, color: colors.textSecondary,
        backgroundColor: colors.surface, paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md, borderRadius: radii.full,
    },
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
    editForm: {},
    editActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
    cancelEditBtn: {
        paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
        borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    },
    cancelEditText: { ...typography.bodyMedium, color: colors.textSecondary },
    saveBtn: { flex: 1 },
    infoList: {},
    infoRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    infoIconWrap: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center',
        marginRight: spacing.md,
    },
    infoContent: { flex: 1 },
    infoLabel: { ...typography.small, color: colors.textSecondary },
    infoValue: { ...typography.bodyMedium, color: colors.textPrimary, marginTop: 1 },
    menuItem: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: spacing.md,
    },
    menuLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    menuLabel: { ...typography.bodyMedium, color: colors.textPrimary },
});
