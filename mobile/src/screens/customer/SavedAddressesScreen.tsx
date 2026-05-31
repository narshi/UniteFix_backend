import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { ArrowLeft, MapPin, Plus, Trash2 } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { customerApi, SavedAddress } from '../../api/customer.api';
import { Button } from '../../components/ui/Button';

type ParamList = {
    SavedAddresses: { fromCheckout?: boolean };
};

export function SavedAddressesScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<RouteProp<ParamList, 'SavedAddresses'>>();
    const fromCheckout = route.params?.fromCheckout;

    const [addresses, setAddresses] = useState<SavedAddress[]>([]);
    const [loading, setLoading] = useState(true);

    const loadAddresses = async () => {
        try {
            setLoading(true);
            const res = await customerApi.getProfile();
            setAddresses(res.data.data.savedAddresses || []);
        } catch (error) {
            console.error("Failed to load addresses", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            loadAddresses();
        });
        return unsubscribe;
    }, [navigation]);

    const handleDelete = async (index: number) => {
        Alert.alert('Delete Address', 'Are you sure you want to delete this address?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    const newAddresses = addresses.filter((_, i) => i !== index);
                    setAddresses(newAddresses);
                    await customerApi.updateProfile({ savedAddresses: newAddresses });
                }
            }
        ]);
    };

    const handleSelect = (address: SavedAddress) => {
        if (fromCheckout) {
            // Need to pass the selected address back to the previous screen (ServiceRequestScreen)
            navigation.navigate({
                name: 'ServiceRequest',
                params: { selectedAddress: address },
                merge: true,
            });
        }
    };

    const renderItem = ({ item, index }: { item: SavedAddress, index: number }) => (
        <TouchableOpacity 
            style={styles.addressCard} 
            onPress={() => handleSelect(item)}
            disabled={!fromCheckout}
        >
            <View style={styles.cardLeft}>
                <View style={styles.iconContainer}>
                    <MapPin size={24} color={colors.primary} />
                </View>
                <View style={styles.cardContent}>
                    <Text style={styles.label}>{item.label}</Text>
                    <Text style={styles.addressText} numberOfLines={2}>{item.address}</Text>
                </View>
            </View>
            {!fromCheckout && (
                <TouchableOpacity onPress={() => handleDelete(index)} style={styles.deleteBtn}>
                    <Trash2 size={20} color={colors.error} />
                </TouchableOpacity>
            )}
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={24} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{fromCheckout ? 'Select Address' : 'Saved Addresses'}</Text>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={addresses}
                    keyExtractor={(item, index) => index.toString()}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <MapPin size={64} color={colors.textDisabled} />
                            <Text style={styles.emptyTitle}>No saved addresses</Text>
                            <Text style={styles.emptyDesc}>Add an address to make booking easier.</Text>
                        </View>
                    }
                />
            )}

            <View style={styles.footer}>
                <Button 
                    title="Add New Address"
                    onPress={() => navigation.navigate('MapAddressPicker')}
                    icon={<Plus size={20} color="#fff" />}
                    fullWidth
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        paddingTop: 50,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginLeft: 16 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: 16, paddingBottom: 100 },
    addressCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface,
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primaryLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    cardContent: { flex: 1 },
    label: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
    addressText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
    deleteBtn: { padding: 8 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 16, marginBottom: 8 },
    emptyDesc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        paddingBottom: 32,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    }
});
