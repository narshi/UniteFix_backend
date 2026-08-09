import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LucideIcons from 'lucide-react-native';
const { AlertCircle, ArrowLeft, Search, ChevronRight, ChevronDown, Inbox, X } = LucideIcons;
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomerTabParamList, HomeStackParamList } from '../../types/navigation.types';
import { useAllServices } from '../../hooks/useCustomerData';
import { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { ServiceCard } from '../../components/services/ServiceCard';
import { getCategoryIcon } from '../../utils/serviceIcons';

type NavigationProp = NativeStackNavigationProp<HomeStackParamList & CustomerTabParamList>;

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

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                {isSearchActive ? (
                    <View style={styles.searchHeaderRow}>
                        <TouchableOpacity onPress={() => { setIsSearchActive(false); setSearchQuery(''); }} style={styles.backButton}>
                            <ArrowLeft size={24} color={colors.textPrimary} />
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
                            <ArrowLeft size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <View>
                            <Text style={styles.headerTitle}>All Services</Text>
                            <Text style={styles.headerSubtitle}>{categories.reduce((acc, cat) => acc + (cat.items?.length || 0), 0)} options</Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity style={styles.headerAction} onPress={() => setIsSearchActive(true)}>
                            <Search size={20} color={colors.textPrimary} />
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
                            return (
                                <TouchableOpacity
                                    key={category.id}
                                    style={[
                                        styles.sidebarItem,
                                        isSelected && styles.sidebarItemSelected
                                    ]}
                                    onPress={() => setSelectedCategoryId(category.id)}
                                >
                                    <View style={[
                                        styles.sidebarIconContainer,
                                        isSelected && styles.sidebarIconContainerSelected
                                    ]}>
                                        {(() => {
                                            // Unique Lucide glyph per category — the seeded
                                            // icon URLs are duplicated stock photos, so remote
                                            // images are deliberately not rendered here.
                                            const CategoryIcon = getCategoryIcon(category);
                                            return <CategoryIcon size={24} color={isSelected ? colors.primary : colors.textSecondary} />;
                                        })()}
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
                        {selectedCategory && !isSearchActive && (
                            <View style={styles.categoryHeaderSection}>
                                <View style={styles.categoryTitleRow}>
                                    <View style={styles.categoryTitleAccent} />
                                    <Text style={styles.categoryHeaderTitle}>
                                        {selectedCategory.name}
                                    </Text>
                                </View>
                                <View style={styles.categoryCountBadge}>
                                    <Text style={styles.categoryCountText}>{itemsToDisplay.length} services available</Text>
                                </View>
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

                        <View style={styles.servicesGrid}>
                            {itemsToDisplay.length > 0 ? itemsToDisplay.map((service) => (
                                <View key={service.id} style={styles.serviceCardWrapper}>
                                    <ServiceCard
                                        service={service}
                                        onPress={() => handleServicePress(service)}
                                    />
                                </View>
                            )) : (
                                <View style={styles.emptyState}>
                                    <Inbox size={40} color={colors.textDisabled} />
                                    <Text style={styles.emptyStateText}>No services available</Text>
                                </View>
                            )}
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
        backgroundColor: colors.surfaceElevated,
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
        padding: spacing.md,
        backgroundColor: colors.surfaceElevated,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        ...shadows.sm,
        zIndex: 10,
    },
    backButton: {
        padding: spacing.sm,
        marginRight: spacing.sm,
    },
    headerTitle: {
        ...typography.h3,
        color: colors.textPrimary,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    headerAction: {
        padding: spacing.sm,
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
        backgroundColor: colors.surface,
        borderRadius: radii.full,
        paddingHorizontal: spacing.md,
        height: 40,
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
        width: 85,
        backgroundColor: colors.surfaceElevated,
        borderRightWidth: 1,
        borderRightColor: colors.border,
    },
    sidebarItem: {
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        position: 'relative',
    },
    sidebarItemSelected: {
        backgroundColor: 'transparent',
    },
    sidebarIconContainer: {
        width: 56,
        height: 56,
        borderRadius: radii.xl,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xs,
        overflow: 'hidden',
    },
    sidebarIconContainerSelected: {
        backgroundColor: colors.primaryLight + '15',
        borderWidth: 1.5,
        borderColor: colors.primaryLight + '60',
    },
    sidebarText: {
        ...typography.small,
        color: colors.textSecondary,
        textAlign: 'center',
        fontSize: 10,
        fontWeight: '500',
    },
    sidebarTextSelected: {
        color: colors.textPrimary,
        fontWeight: '800',
    },
    rightContent: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    rightContentScroll: {
        padding: spacing.lg,
    },
    categoryHeaderSection: {
        marginBottom: spacing.xl,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.sm,
    },
    categoryTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    categoryTitleAccent: {
        width: 4,
        height: 20,
        backgroundColor: colors.primary,
        borderRadius: radii.full,
    },
    categoryHeaderTitle: {
        ...typography.h3,
        color: colors.textPrimary,
        fontWeight: '800',
    },
    categoryCountBadge: {
        backgroundColor: colors.primarySurface,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.primaryLight,
    },
    categoryCountText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    subTabRow: {
        gap: spacing.sm,
        paddingBottom: spacing.md,
    },
    subTab: {
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.sm,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
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
    serviceCardWrapper: {
        width: '48%',
        marginBottom: spacing.md,
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
});
