import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LucideIcons from 'lucide-react-native';
const { AlertCircle, ArrowLeft, Search, Grid, ChevronRight, ChevronDown, Inbox } = LucideIcons;
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomerTabParamList, HomeStackParamList } from '../../types/navigation.types';
import { useAllServices } from '../../hooks/useCustomerData';
import { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { ServiceCard } from '../../components/services/ServiceCard';

type NavigationProp = NativeStackNavigationProp<HomeStackParamList & CustomerTabParamList>;

export const AllServicesScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { data: categories, isLoading, error } = useAllServices();
    
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

    // Set first category as default when loaded
    useEffect(() => {
        if (categories && categories.length > 0 && selectedCategoryId === null) {
            setSelectedCategoryId(categories[0].id);
        }
    }, [categories]);

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

        navigation.navigate('ServiceRequest', { serviceType: service.name });
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
    const items = selectedCategory?.items || [];

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <ArrowLeft size={24} color={colors.textPrimary} />
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>All Services</Text>
                    <Text style={styles.headerSubtitle}>{categories.reduce((acc, cat) => acc + (cat.items?.length || 0), 0)} options</Text>
                </View>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={styles.headerAction}>
                    <Search size={20} color={colors.textPrimary} />
                </TouchableOpacity>
            </View>

            <View style={styles.mainContent}>
                {/* Left Sidebar - Categories */}
                <View style={styles.sidebar}>
                    <ScrollView showsVerticalScrollIndicator={false}>
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
                                            const IconName = (category.icon as keyof typeof LucideIcons) || 'Grid';
                                            const CategoryIcon = (LucideIcons[IconName] as any) || Grid;
                                            return <CategoryIcon size={22} color={isSelected ? colors.primary : colors.textSecondary} />;
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
                                    {isSelected && <View style={styles.activeIndicator} />}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Right Content - Services Grid */}
                <View style={styles.rightContent}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rightContentScroll}>
                        {selectedCategory && (
                            <View style={styles.categoryHeaderSection}>
                                <Text style={styles.categoryHeaderTitle}>
                                    <Text style={{ fontWeight: 'bold', color: colors.textPrimary }}>{items.length} items</Text> in {selectedCategory.name}
                                </Text>
                            </View>
                        )}

                        <View style={styles.servicesGrid}>
                            {items.length > 0 ? items.map((service) => (
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
        borderBottomWidth: 1,
        borderBottomColor: colors.border + '50',
        position: 'relative',
    },
    sidebarItemSelected: {
        backgroundColor: colors.primaryLight + '10',
    },
    sidebarIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xs,
    },
    sidebarIconContainerSelected: {
        backgroundColor: colors.surfaceElevated,
        ...shadows.sm,
    },
    sidebarText: {
        ...typography.small,
        color: colors.textSecondary,
        textAlign: 'center',
        fontSize: 10,
    },
    sidebarTextSelected: {
        color: colors.primary,
        fontWeight: 'bold',
    },
    activeIndicator: {
        position: 'absolute',
        left: 0,
        top: '20%',
        bottom: '20%',
        width: 4,
        backgroundColor: colors.primary,
        borderTopRightRadius: radii.sm,
        borderBottomRightRadius: radii.sm,
    },
    rightContent: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    rightContentScroll: {
        padding: spacing.md,
    },
    categoryHeaderSection: {
        marginBottom: spacing.md,
    },
    categoryHeaderTitle: {
        ...typography.body,
        color: colors.textSecondary,
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
