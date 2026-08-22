import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LucideIcons from 'lucide-react-native';
const { AlertCircle, ArrowLeft, ArrowRight, Search, Users, ShieldCheck, Clock, Headphones, Inbox, X } = LucideIcons;
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomerTabParamList, HomeStackParamList } from '../../types/navigation.types';
import { useAllServices } from '../../hooks/useCustomerData';
import { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { getCategoryIcon, getServiceIcon } from '../../utils/serviceIcons';

type NavigationProp = NativeStackNavigationProp<HomeStackParamList & CustomerTabParamList>;

// Banner copy per category; anything unmapped gets the generic line.
const CATEGORY_TAGLINES: Record<string, string> = {
    'IT & Security': 'Installation & repair by certified service experts',
    'Appliances & Utilities': 'Keep your home running smoothly',
    'Repairs & Maintenance': 'Quick fixes by skilled professionals',
    'Professional & Property': 'Consultants & experts you can trust',
    'Transport & Logistics': 'Moving, machinery & vehicle care',
    'Events, Travel & Lifestyle': 'Plan, book & celebrate with ease',
    'Specialized Services': 'Niche experts for every need',
};
const DEFAULT_TAGLINE = 'On-demand professionals at your doorstep';

const TRUST_BADGES = [
    { icon: ShieldCheck, color: colors.success, title: 'Verified Experts', caption: 'Background verified professionals' },
    { icon: Clock, color: colors.warning, title: 'On-time Service', caption: 'Punctual visits you can rely on' },
    { icon: Headphones, color: colors.info, title: '24/7 Support', caption: "We're here to help you" },
] as const;

// Map categories to the local 3D icon PNGs
const CATEGORY_3D_ICONS: Record<string, any> = {
    'IT & Security': require('../../assets/icons3d/3dicons-shield-dynamic-color.png'),
    'Appliances & Utilities': require('../../assets/icons3d/3dicons-flash-front-color.png'),
    'Repairs & Maintenance': require('../../assets/icons3d/3dicons-tools-dynamic-color.png'),
    'Professional & Property': require('../../assets/icons3d/3dicons-suitecase-iso-color.png'),
    'Transport & Logistics': require('../../assets/icons3d/3dicons-suitecase-iso-color.png'), // Fallback
    'Events, Travel & Lifestyle': require('../../assets/icons3d/3dicons-trophy-iso-color.png'),
    'Specialized Services': require('../../assets/icons3d/3dicons-star-iso-color.png'),
    'Technology Services': require('../../assets/icons3d/3dicons-shield-dynamic-color.png'),
    'Home Services': require('../../assets/icons3d/3dicons-tools-dynamic-color.png'),
    'Repair Services': require('../../assets/icons3d/3dicons-tools-dynamic-color.png'),
};

/** Design-spec service card: white card, rounded box icon, title, subtitle + arrow chip. */
const ServiceTile = ({ service, onPress }: { service: ServiceItem; onPress: () => void }) => {
    const Icon = getServiceIcon(service);
    return (
        <TouchableOpacity
            style={[styles.serviceTile, service.status !== 'ACTIVE' && styles.serviceTileDisabled]}
            onPress={onPress}
            activeOpacity={0.75}
        >
            <View style={styles.serviceTileIconBox}>
                <Icon size={24} color={colors.primary} strokeWidth={2.0} />
            </View>
            <Text style={styles.serviceTileTitle} numberOfLines={2}>{service.name}</Text>
            <View style={styles.serviceTileFooter}>
                <Text style={styles.serviceTileSubtitle} numberOfLines={2}>
                    {service.subtitle || 'Professional service'}
                </Text>
                <View style={styles.serviceTileArrow}>
                    <ArrowRight size={14} color={colors.primary} strokeWidth={2.5} />
                </View>
            </View>
            {service.status === 'COMING_SOON' && (
                <View style={styles.badgeComingSoon}>
                    <Text style={styles.badgeText}>Soon</Text>
                </View>
            )}
        </TouchableOpacity>
    );
};

export const AllServicesScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { data: categories, isLoading, error } = useAllServices();

    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchActive, setIsSearchActive] = useState(false);

    // Set first category as default when loaded
    useEffect(() => {
        if (categories && categories.length > 0 && selectedCategoryId === null) {
            setSelectedCategoryId(categories[0].id);
        }
    }, [categories]);

    // Reset the sub-tab whenever the category changes.
    useEffect(() => { setSelectedSubCategory(null); }, [selectedCategoryId]);

    // Sub-categories (horizontal tabs) for the selected category. Computed here —
    // above the loading/error early returns — so the hook count is stable across
    // renders (a hook after an early return crashes with "rendered more hooks").
    const subCategories = useMemo(() => {
        const cat = categories?.find(c => c.id === selectedCategoryId) || categories?.[0];
        const set = new Set<string>();
        (cat?.items || []).forEach((it: any) => { if (it.subCategory) set.add(it.subCategory); });
        return Array.from(set).sort();
    }, [categories, selectedCategoryId]);

    const handleServicePress = (service: ServiceItem) => {
        if (service.status === 'COMING_SOON') {
            Alert.alert(
                "Coming Soon",
                "🚀 This service is launching soon in your area. Stay tuned!",
                [{ text: "OK" }]
            );
            return;
        }

        if (service.status === 'MAINTENANCE') {
            Alert.alert(
                "Under Maintenance",
                "This service is temporarily under maintenance. Please try again later.",
                [{ text: "OK" }]
            );
            return;
        }

        navigation.navigate('ServiceRequest', {
            serviceType: service.name,
            serviceName: service.name,
            serviceId: service.id,
            basePrice: service.basePrice ?? 0,
        });
    };

    if (isLoading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </SafeAreaView>
        );
    }

    if (error || !categories) {
        return (
            <SafeAreaView style={styles.errorContainer}>
                <AlertCircle size={48} color={colors.error} />
                <Text style={styles.errorText}>Failed to load services</Text>
            </SafeAreaView>
        );
    }

    const selectedCategory = categories.find(c => c.id === selectedCategoryId) || categories[0];
    const categoryItems = selectedCategory?.items || [];

    const subFilteredItems = selectedSubCategory
        ? categoryItems.filter((it: any) => it.subCategory === selectedSubCategory)
        : categoryItems;

    // Search logic: filter across ALL categories if searching
    const allServices = categories.flatMap(c => c.items || []);
    const searchResults = searchQuery.trim() === ''
        ? categoryItems
        : allServices.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.subtitle?.toLowerCase().includes(searchQuery.toLowerCase()));

    const itemsToDisplay = isSearchActive && searchQuery.trim() !== '' ? searchResults : subFilteredItems;

    const BannerIcon = selectedCategory ? getCategoryIcon(selectedCategory) : null;

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                {isSearchActive ? (
                    <View style={styles.searchHeaderRow}>
                        <TouchableOpacity onPress={() => { setIsSearchActive(false); setSearchQuery(''); }} style={styles.backButton}>
                            <ArrowLeft size={22} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={styles.searchInputContainer}>
                            <Search size={18} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />
                            <TextInput
                                autoFocus
                                style={styles.searchInput}
                                placeholder="Search all services..."
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholderTextColor={colors.textDisabled}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <X size={18} color={colors.textSecondary} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                ) : (
                    <>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2.4} />
                        </TouchableOpacity>
                        <View>
                            <Text style={styles.headerTitle}>All Services</Text>
                            <Text style={styles.headerSubtitle}>{categories.reduce((acc, cat) => acc + (cat.items?.length || 0), 0)} options</Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity style={styles.headerAction} onPress={() => setIsSearchActive(true)}>
                            <Search size={20} color={colors.textPrimary} strokeWidth={2.4} />
                        </TouchableOpacity>
                    </>
                )}
            </View>

            <View style={styles.mainContent}>
                {/* Left Sidebar - Categories */}
                <View style={styles.sidebar}>
                    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                        {categories.map((category) => {
                            const isSelected = category.id === selectedCategoryId;
                            const CategoryIcon = getCategoryIcon(category);
                            return (
                                <TouchableOpacity
                                    key={category.id}
                                    style={styles.sidebarItem}
                                    onPress={() => setSelectedCategoryId(category.id)}
                                    activeOpacity={0.7}
                                >
                                    {isSelected && <View style={styles.sidebarActiveBar} />}
                                    <View style={[
                                        styles.sidebarIconContainer,
                                        isSelected && styles.sidebarIconContainerSelected
                                    ]}>
                                        {CATEGORY_3D_ICONS[category.name] ? (
                                            <Image 
                                                source={CATEGORY_3D_ICONS[category.name]} 
                                                style={{ width: 34, height: 34, opacity: isSelected ? 1 : 0.6 }} 
                                                resizeMode="contain"
                                            />
                                        ) : (
                                            <CategoryIcon
                                                size={24}
                                                color={isSelected ? colors.primary : colors.textSecondary}
                                                strokeWidth={isSelected ? 2.4 : 2}
                                            />
                                        )}
                                    </View>
                                    <Text
                                        style={[
                                            styles.sidebarText,
                                            isSelected && styles.sidebarTextSelected
                                        ]}
                                        numberOfLines={2}
                                    >
                                        {category.name}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Right Content - Services Grid */}
                <View style={styles.rightContent}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rightContentScroll} keyboardShouldPersistTaps="handled">
                        {/* Category banner */}
                        {selectedCategory && !isSearchActive && (
                            <View style={styles.categoryBanner}>
                                <View style={styles.categoryBannerText}>
                                    <Text style={styles.categoryBannerTitle}>{selectedCategory.name}</Text>
                                    <Text style={styles.categoryBannerSubtitle} numberOfLines={2}>
                                        {CATEGORY_TAGLINES[selectedCategory.name] || DEFAULT_TAGLINE}
                                    </Text>
                                    <View style={styles.categoryBannerPill}>
                                        <Users size={14} color={colors.primary} strokeWidth={2.4} />
                                        <Text style={styles.categoryBannerPillText}>{itemsToDisplay.length} services available</Text>
                                    </View>
                                </View>
                                {BannerIcon && !CATEGORY_3D_ICONS[selectedCategory.name] && (
                                    <View style={styles.categoryBannerArt}>
                                        <BannerIcon size={44} color={colors.primary} strokeWidth={1.8} />
                                    </View>
                                )}
                                {CATEGORY_3D_ICONS[selectedCategory.name] && (
                                    <View style={styles.categoryBannerArt3D}>
                                        <Image 
                                            source={CATEGORY_3D_ICONS[selectedCategory.name]} 
                                            style={{ width: 130, height: 130 }} 
                                            resizeMode="contain"
                                        />
                                    </View>
                                )}
                            </View>
                        )}

                        {isSearchActive && searchQuery.trim() !== '' && (
                            <View style={styles.searchResultHeader}>
                                <Text style={styles.searchResultText}>Found {itemsToDisplay.length} results for "{searchQuery}"</Text>
                            </View>
                        )}

                        {/* Sub-category tabs (horizontal, scrollable) */}
                        {!isSearchActive && subCategories.length > 0 && (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.subTabRow}
                            >
                                {['All', ...subCategories].map((tab) => {
                                    const active = tab === 'All' ? !selectedSubCategory : selectedSubCategory === tab;
                                    return (
                                        <TouchableOpacity
                                            key={tab}
                                            style={[styles.subTab, active && styles.subTabActive]}
                                            onPress={() => setSelectedSubCategory(tab === 'All' ? null : tab)}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{tab}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {!isSearchActive && (
                            <Text style={styles.servicesHeading}>Services ({itemsToDisplay.length})</Text>
                        )}

                        <View style={styles.servicesGrid}>
                            {itemsToDisplay.length > 0 ? itemsToDisplay.map((service) => (
                                <ServiceTile
                                    key={service.id}
                                    service={service}
                                    onPress={() => handleServicePress(service)}
                                />
                            )) : (
                                <View style={styles.emptyState}>
                                    <Inbox size={40} color={colors.textDisabled} />
                                    <Text style={styles.emptyStateText}>No services available</Text>
                                </View>
                            )}
                        </View>
                        
                        {/* Trust footer (Moved here to align with right content and prevent sidebar overlap) */}
                        <View style={styles.trustBar}>
                            {TRUST_BADGES.map((badge, index) => {
                                const BadgeIcon = badge.icon;
                                return (
                                    <React.Fragment key={badge.title}>
                                        {index > 0 && <View style={styles.trustDivider} />}
                                        <View style={styles.trustItem}>
                                            <BadgeIcon size={20} color={badge.color} strokeWidth={2.2} />
                                            <View style={styles.trustTextWrap}>
                                                <Text style={styles.trustTitle} numberOfLines={1}>{badge.title}</Text>
                                                <Text style={styles.trustCaption} numberOfLines={2}>{badge.caption}</Text>
                                            </View>
                                        </View>
                                    </React.Fragment>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: spacing.xl,
    },
    errorText: {
        ...typography.h3,
        color: colors.textSecondary,
        marginTop: spacing.md,
        textAlign: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        backgroundColor: colors.surface,
        zIndex: 10,
    },
    backButton: {
        width: 46,
        height: 46,
        borderRadius: radii.xl,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.md,
        ...shadows.sm,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.textPrimary,
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    headerAction: {
        width: 46,
        height: 46,
        borderRadius: radii.full,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.sm,
    },
    searchHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.full,
        paddingHorizontal: spacing.md,
        height: 44,
        borderWidth: 1,
        borderColor: colors.border,
    },
    searchInput: {
        flex: 1,
        ...typography.bodyMedium,
        color: colors.textPrimary,
        height: '100%',
    },
    searchResultHeader: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        marginBottom: spacing.md,
    },
    searchResultText: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
    },
    mainContent: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.surface,
    },
    sidebar: {
        width: 80,
        backgroundColor: colors.surfaceElevated,
        borderTopRightRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'],
        paddingVertical: spacing.sm,
        ...shadows.xs,
        shadowOpacity: 0.04,
        marginRight: spacing.sm,
    },
    sidebarItem: {
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: 0,
        position: 'relative',
        width: '100%',
    },
    sidebarActiveBar: {
        position: 'absolute',
        left: 0,
        top: '50%',
        marginTop: -20,
        width: 3,
        height: 40,
        backgroundColor: colors.primary,
        borderTopRightRadius: radii.full,
        borderBottomRightRadius: radii.full,
    },
    sidebarIconContainer: {
        width: 50,
        height: 50,
        borderRadius: radii.xl,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
    },
    sidebarIconContainerSelected: {
        backgroundColor: colors.primarySurface,
    },
    sidebarText: {
        color: colors.textSecondary,
        textAlign: 'center',
        fontSize: 10.5,
        lineHeight: 13,
        fontWeight: '500',
        paddingHorizontal: 4,
    },
    sidebarTextSelected: {
        color: colors.primary,
        fontWeight: '700',
    },
    rightContent: {
        flex: 1,
    },
    rightContentScroll: {
        padding: spacing.base,
        paddingBottom: spacing.xl,
    },
    categoryBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primarySurface,
        borderRadius: radii['2xl'],
        padding: spacing.lg,
        marginBottom: spacing.lg,
        overflow: 'hidden',
    },
    categoryBannerText: {
        flex: 1,
        paddingRight: spacing.sm,
    },
    categoryBannerTitle: {
        fontSize: 20,
        fontWeight: '800',
        lineHeight: 26,
        letterSpacing: -0.3,
        color: colors.textPrimary,
    },
    categoryBannerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    categoryBannerPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.full,
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        marginTop: spacing.md,
        ...shadows.xs,
    },
    categoryBannerPillText: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.primary,
    },
    categoryBannerArt: {
        width: 84,
        height: 84,
        borderRadius: radii['2xl'],
        backgroundColor: 'rgba(255, 255, 255, 0.65)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    categoryBannerArt3D: {
        width: 130,
        height: 130,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -20, // Pull it slightly off-edge for depth
        marginTop: -15, // Let it break the bounds slightly
        marginBottom: -15,
    },
    servicesHeading: {
        ...typography.h3,
        fontSize: 15, // Adjusted to match mockup size
        fontWeight: '700',
        color: colors.textPrimary,
        marginBottom: spacing.md,
        letterSpacing: -0.2,
    },
    subTabRow: {
        gap: spacing.sm,
        paddingBottom: spacing.md,
    },
    subTab: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceElevated,
    },
    subTabActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    subTabText: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    subTabTextActive: {
        color: colors.textInverse,
    },
    servicesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    serviceTile: {
        width: '47.5%', // Slightly reduced to prevent edge overlap on smaller phones
        minHeight: 165,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 20,
        padding: 12,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: 'rgba(226, 232, 240, 0.6)', // Lighter border
        position: 'relative',
        ...shadows.sm,
        shadowOpacity: 0.05,
        elevation: 2,
    },
    serviceTileDisabled: {
        opacity: 0.75,
    },
    serviceTileIconBox: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    serviceTileTitle: {
        fontSize: 13.5,
        fontWeight: '700',
        lineHeight: 18,
        letterSpacing: -0.1,
        color: colors.textPrimary,
        marginBottom: 4,
    },
    serviceTileFooter: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginTop: 'auto',
    },
    serviceTileSubtitle: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 14,
        color: colors.textSecondary,
        marginRight: 6,
    },
    serviceTileArrow: {
        width: 28,
        height: 28,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeComingSoon: {
        position: 'absolute',
        top: spacing.sm,
        right: spacing.sm,
        backgroundColor: colors.warningLight,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.warning,
    },
    badgeText: {
        ...typography.caption,
        fontSize: 9,
        color: colors.warningDark,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    emptyState: {
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing['2xl'],
    },
    emptyStateText: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.md,
    },
    trustBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii['2xl'],
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        ...shadows.md,
    },
    trustItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    trustTextWrap: {
        flexShrink: 1,
    },
    trustTitle: {
        fontSize: 11,
        fontWeight: '800',
        color: colors.textPrimary,
    },
    trustCaption: {
        fontSize: 9,
        lineHeight: 12,
        color: colors.textSecondary,
    },
    trustDivider: {
        width: 1,
        height: 34,
        backgroundColor: colors.divider,
    },
});
