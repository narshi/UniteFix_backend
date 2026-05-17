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
} from 'lucide-react-native';
import * as Location from 'expo-location';
import { useProfile, useUpdateProfile } from '../../hooks/useCustomerData';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

export function ProfileScreen() {
    const { data: profile, isLoading } = useProfile();
    const { mutate: updateProfile, isPending: saving } = useUpdateProfile();
    const { logout, user } = useAuthStore();

    const [editing, setEditing] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [homeAddress, setHomeAddress] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [fetchingLocation, setFetchingLocation] = useState(false);

    useEffect(() => {
        if (profile) {
            setUsername(profile.username || '');
            setEmail(profile.email || '');
            setPhone(profile.phone || '');
            setHomeAddress(profile.homeAddress || '');
            setPinCode(profile.pinCode || '');
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
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
        >
            {/* Profile header */}
            <View style={styles.profileHeader}>
                <View style={styles.avatarLarge}>
                    <Text style={styles.avatarLargeText}>
                        {displayName.charAt(0).toUpperCase()}
                    </Text>
                </View>
                <Text style={styles.displayName}>{displayName}</Text>
                <Text style={styles.roleBadge}>
                    {profile?.role === 'serviceman' ? '🔧 Employee' : '👤 Customer'}
                </Text>
                {!editing && (
                    <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                        <Edit3 size={16} color={colors.primary} />
                        <Text style={styles.editBtnText}>Edit Profile</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Info / Edit sections */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Personal Information</Text>

                {editing ? (
                    <View style={styles.editForm}>
                        <Input
                            label="Full Name"
                            value={username}
                            onChangeText={setUsername}
                            icon={<User size={18} color={colors.textSecondary} />}
                        />
                        <Input
                            label="Email"
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            icon={<Mail size={18} color={colors.textSecondary} />}
                        />
                        <Input
                            label="Phone (Read-only)"
                            value={phone}
                            editable={false}
                            style={{ color: colors.textSecondary }}
                            icon={<Phone size={18} color={colors.textSecondary} />}
                        />
                        <View style={{ position: 'relative' }}>
                            <Input
                                label="Address"
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
                            label="Pin Code"
                            value={pinCode}
                            onChangeText={setPinCode}
                            keyboardType="number-pad"
                            maxLength={6}
                        />
                        <View style={styles.editActions}>
                            <TouchableOpacity style={styles.cancelEditBtn} onPress={() => setEditing(false)}>
                                <Text style={styles.cancelEditText}>Cancel</Text>
                            </TouchableOpacity>
                            <Button title="Save Changes" onPress={handleSave} loading={saving} style={styles.saveBtn} />
                        </View>
                    </View>
                ) : (
                    <View style={styles.infoList}>
                        <InfoRow icon={User} label="Name" value={displayName} />
                        <InfoRow icon={Mail} label="Email" value={profile?.email || 'Not set'} />
                        <InfoRow icon={Phone} label="Phone" value={profile?.phone || 'Not set'} />
                        <InfoRow icon={MapPin} label="Address" value={profile?.homeAddress || 'Not set'} />
                        <InfoRow icon={Shield} label="Pin Code" value={profile?.pinCode || 'Not set'} />
                    </View>
                )}
            </View>

            {/* Account section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account</Text>
                
                <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.divider }]} onPress={() => {
                    Linking.openURL('whatsapp://send?phone=+910000000000&text=Hello UniteFix Support, I need help.').catch(() => {
                        Alert.alert('Error', 'Make sure WhatsApp is installed on your device');
                    });
                }}>
                    <View style={styles.menuLeft}>
                        <MessageCircle size={20} color={colors.primary} />
                        <Text style={styles.menuLabel}>Help & Support (WhatsApp)</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
                    <View style={styles.menuLeft}>
                        <LogOut size={20} color={colors.error} />
                        <Text style={[styles.menuLabel, { color: colors.error }]}>Log Out</Text>
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
    scrollContent: { paddingBottom: spacing['3xl'] },
    profileHeader: {
        alignItems: 'center',
        paddingTop: 60,
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
    },
    avatarLargeText: { fontSize: 32, fontWeight: '700', color: colors.textInverse },
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
    menuLabel: { ...typography.bodyMedium },
});
