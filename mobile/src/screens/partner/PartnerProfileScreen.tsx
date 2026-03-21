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
} from 'react-native';
import {
    User, Mail, Phone, MapPin, LogOut, ChevronRight,
    Shield, Edit3, CheckCircle,
} from 'lucide-react-native';
import { useProfile, useUpdateProfile } from '../../hooks/useCustomerData';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

export function PartnerProfileScreen() {
    const { data: profile, isLoading } = useProfile();
    const { mutate: updateProfile, isPending: saving } = useUpdateProfile();
    const { logout, user } = useAuthStore();

    const [editing, setEditing] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');

    useEffect(() => {
        if (profile) {
            setUsername(profile.username || '');
            setEmail(profile.email || '');
            setPhone(profile.phone || '');
            setAddress(profile.address || '');
        }
    }, [profile]);

    const handleSave = () => {
        updateProfile(
            { username, email, phone, address },
            { onSuccess: () => { setEditing(false); Alert.alert('Saved', 'Profile updated.'); } },
        );
    };

    const handleLogout = () => {
        Alert.alert('Log Out', 'Are you sure?', [
            { text: 'Cancel' },
            { text: 'Log Out', style: 'destructive', onPress: () => logout() },
        ]);
    };

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    const displayName = profile?.username || user?.username || 'Employee';

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Profile header */}
            <View style={styles.profileHeader}>
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
                        <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon={<Phone size={18} color={colors.textSecondary} />} />
                        <Input label="Address" value={address} onChangeText={setAddress} icon={<MapPin size={18} color={colors.textSecondary} />} />
                        <View style={styles.editActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <Button title="Save" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
                        </View>
                    </View>
                ) : (
                    <View>
                        <InfoRow icon={User} label="Name" value={displayName} />
                        <InfoRow icon={Mail} label="Email" value={profile?.email || 'Not set'} />
                        <InfoRow icon={Phone} label="Phone" value={profile?.phone || 'Not set'} />
                        <InfoRow icon={MapPin} label="Address" value={profile?.address || 'Not set'} />
                    </View>
                )}
            </View>

            {/* Logout */}
            <View style={styles.section}>
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
    scrollContent: { paddingBottom: spacing['3xl'] },
    profileHeader: {
        alignItems: 'center', paddingTop: 60, paddingBottom: spacing.xl,
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
    menuLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    menuLabel: { ...typography.bodyMedium },
});
