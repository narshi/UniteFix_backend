/**
 * Service Request Form — Create a new service request
 * User selects service type, provides description, address, and optional photos
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    Alert,
    TextInput,
    Image,
    ActivityIndicator,
    ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Camera, MapPin, Clock, AlertTriangle, X, ImagePlus } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useBookingDraftStore } from '../../stores/bookingDraft.store';
import { useCreateServiceRequest, usePublicConfig, useServiceQuote, useProviderOptions } from '../../hooks/useCustomerData';
import { ProviderChooser, type ProviderChoice } from '../../components/customer/ProviderChooser';
import { usePartnerRef } from '../../services/partnerLinks';
import { bandOf, bandColorOf, BAND_META } from '../../utils/serviceBands';

/** The next 7 days (IST) for a consultation, as YYYY-MM-DD with a short label. */
function nextDays(): Array<{ date: string; label: string }> {
    const out: Array<{ date: string; label: string }> = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() + 330 * 60_000 + i * 86_400_000);
        const date = d.toISOString().slice(0, 10);
        const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        out.push({ date, label });
    }
    return out;
}
/** Call slots, with the hour each starts (to hide ones already past today). */
const CALL_SLOTS: Array<{ slot: string; startHour: number }> = [
    { slot: '9 – 10 AM', startHour: 9 }, { slot: '10 – 11 AM', startHour: 10 }, { slot: '11 AM – 12 PM', startHour: 11 },
    { slot: '12 – 1 PM', startHour: 12 }, { slot: '2 – 3 PM', startHour: 14 }, { slot: '3 – 4 PM', startHour: 15 },
    { slot: '4 – 5 PM', startHour: 16 }, { slot: '5 – 6 PM', startHour: 17 }, { slot: '6 – 7 PM', startHour: 18 },
];
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { customerApi } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';
import { SavedAddress } from '../../api/customer.api';
import { applyDiscount } from '../../utils/discount';

type Props = NativeStackScreenProps<any, 'ServiceRequest'>;

const MAX_PHOTOS = 5;

export function ServiceRequestScreen({ navigation, route }: Props) {
    const { 
        description, setDescription, 
        urgency, setUrgency, 
        photos, setPhotos, 
        clearDraft,
        serviceType: draftServiceType,
        serviceName: draftServiceName,
        serviceId: draftServiceId,
        basePrice: draftBasePrice,
        bookingFee: draftBookingFee,
        band: draftBand,
        setServiceContext
    } = useBookingDraftStore();

    // If coming fresh from HomeScreen, read params and persist to store.
    // Otherwise, fall back to the store (so navigation back from SavedAddresses doesn't wipe them)
    const serviceType = route.params?.serviceType || draftServiceType || '';
    const serviceName = route.params?.serviceName || draftServiceName || serviceType || 'Service';
    const serviceId = (route.params?.serviceId as number | undefined) || draftServiceId;
    const catalogBasePrice = Number(route.params?.basePrice ?? draftBasePrice ?? 0);
    // The service's category fee travels with it (and survives the trip to the
    // address picker through the draft store, like basePrice).
    const paramFee = route.params?.bookingFee;
    const categoryBookingFee: number | undefined =
        typeof paramFee === 'number' ? paramFee : draftBookingFee;

    useEffect(() => {
        if (route.params?.serviceType) {
            setServiceContext(serviceType, serviceName, serviceId, catalogBasePrice, typeof paramFee === 'number' ? paramFee : undefined, route.params?.band);
        }
    }, [route.params?.serviceType]);

    /**
     * Abandon the draft when the user leaves this screen for good.
     *
     * The description, urgency and photos live in a zustand store rather than
     * local state on purpose: stepping out to Saved Addresses or the map picker
     * must not wipe a half-written request. The cost was that nothing cleared it
     * on the way OUT either - clearDraft() ran only after a successful booking -
     * so backing out and opening any service again showed the previous
     * description and photos still attached.
     *
     * 'beforeRemove' is the right signal precisely because it distinguishes the
     * two: it fires when this screen is actually removed from the stack (back
     * gesture, goBack, the reset after a successful booking) and NOT when it is
     * merely covered by a screen pushed on top of it. A focus/blur listener
     * would have cleared the draft on the way to Saved Addresses, which is the
     * bug this store was introduced to fix.
     */
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', () => {
            clearDraft();
        });
        return unsubscribe;
    }, [navigation, clearDraft]);

    // How this service books: a visit, an inspection (fee, then a quote) or a phone consultation.
    const band = bandOf({ band: route.params?.band ?? draftBand });
    const isInspect = band === 'inspect_quote';
    const isConsult = band === 'consultation';
    const accent = bandColorOf({ band });
    const days = React.useMemo(nextDays, []);
    const [consultDate, setConsultDate] = useState<string | null>(null);
    const [consultSlot, setConsultSlot] = useState<string | null>(null);
    const nowHourIst = new Date(Date.now() + 330 * 60_000).getUTCHours();
    const slotsFor = (date: string | null) => CALL_SLOTS.filter(x => date !== days[0].date || x.startHour > nowHourIst);

    const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
    const [uploading, setUploading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null);

    // Read selected address from navigation params if returning from SavedAddressesScreen
    useEffect(() => {
        if (route.params?.selectedAddress) {
            setSelectedAddress(route.params.selectedAddress);
            setErrors((prev) => ({ ...prev, address: '' }));
        }
    }, [route.params?.selectedAddress]);

    const { mutate: createRequest, isPending } = useCreateServiceRequest();

    // Who does the job: UniteFix picks (default), a partner near the address,
    // or a nearby UniteFix expert. Same price either way.
    const [chooserMode, setChooserMode] = useState<'unitefix' | 'nearby'>('unitefix');
    const [choice, setChoice] = useState<ProviderChoice>({ type: 'unitefix' });
    // A partner's link or code (remembered from the link, or typed in the chooser).
    const partnerCode = usePartnerRef(s => s.code);
    const setPartnerCode = usePartnerRef(s => s.setCode);
    const { data: providerOptions, isLoading: optionsLoading } = useProviderOptions(serviceId, selectedAddress, partnerCode);
    // The partner a code named is chosen for the customer once per code (they can still change it).
    const autoPickedFor = React.useRef<string | null>(null);
    useEffect(() => {
        const inv = providerOptions?.invited;
        const p = providerOptions?.partners.find(x => x.viaCode);
        if (!inv?.available || !p || autoPickedFor.current === inv.code) return;
        autoPickedFor.current = inv.code;
        setChooserMode('unitefix');
        setChoice({ type: 'partner', id: p.id, name: p.name, code: inv.code });
    }, [providerOptions]);
    useEffect(() => {
        if (!providerOptions) return;
        // A new address can change who is available: drop a choice that no longer is.
        if (choice.type === 'partner' && !providerOptions.partners.some(p => p.id === choice.id)) setChoice({ type: 'unitefix' });
        if (choice.type === 'expert' && !providerOptions.experts.some(e => e.id === choice.id)) {
            const first = providerOptions.experts[0];
            setChoice(chooserMode === 'nearby' && first ? { type: 'expert', id: first.id, name: first.name } : { type: 'unitefix' });
        }
        // "Nearby" opened while the list was still loading: start on the nearest.
        if (chooserMode === 'nearby' && choice.type === 'unitefix' && providerOptions.experts[0]) {
            const first = providerOptions.experts[0];
            setChoice({ type: 'expert', id: first.id, name: first.name });
        }
    }, [providerOptions]);
    const chosenName = choice.type === 'unitefix' ? null : choice.name;
    const { data: publicConfig } = usePublicConfig();

    // In a UniteFix partner's territory the price can be the partner's own,
    // and the customer is told who will do the work. The price shown here is
    // the one sent back as quotedUnitPrice, so the server charges what was shown.
    const { data: quote } = useServiceQuote(catalogBasePrice > 0 ? serviceId : undefined, selectedAddress?.pinCode);
    const basePrice = quote?.unitPrice ?? catalogBasePrice;

    // Category fee first — it is what the server will charge. The app-wide
    // fee only for a service from an older server that did not send one.
    const knownFee: number | undefined = categoryBookingFee ?? publicConfig?.bookingFee;
    const feeKnown = typeof knownFee === 'number' && Number.isFinite(knownFee);
    const bookingFee = feeKnown ? (knownFee as number) : 0;
    const isFixedPrice = basePrice > 0;

    // The server bills from the pricing snapshot, which already has the discount
    // carved in. Quoting the raw catalog price here meant showing one number and
    // charging another.
    // Units this booking covers — 2 ACs, 4 cameras, 3 fan points.
    // Capped at 50 to match the CHECK constraint on service_requests.quantity;
    // the server clamps independently, this is only so the stepper cannot ask
    // for something the server will refuse.
    const MAX_QUANTITY = 50;
    const [quantity, setQuantity] = useState(1);

    const discount = applyDiscount(basePrice * quantity, publicConfig);
    const payable = discount.payable;
    // The booking fee is per VISIT, not per unit — one trip services two ACs.
    // It must not scale with quantity here, or the app would quote a number the
    // server never charges.
    const finalAfterBooking = Math.max(0, payable - bookingFee);
    // A category with a 0 booking fee: a priced service is paid in full now,
    // nothing after (parts aside). The server decides; this only explains it.
    const prepaidInFull = isFixedPrice && bookingFee === 0;
    const payNow = prepaidInFull ? payable : bookingFee;

    // Get device GPS location on mount for geofence support
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({});
                    setDeviceLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
                }
            } catch (e) {
                // Location is optional — geofence will skip if not available
            }
        })();
    }, []);

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!description.trim()) newErrors.description = 'Please describe the issue';
        if (isConsult) {
            if (!consultDate || !consultSlot) newErrors.slot = 'Choose a day and a time for the call';
        } else if (!selectedAddress) newErrors.address = 'Please select an address';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const launchCamera = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsEditing: true,
        });
        if (!result.canceled && result.assets[0]) {
            setPhotos((prev) => [...prev, result.assets[0].uri]);
        }
    };

    const launchGallery = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'Gallery permission is required to select photos.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsMultipleSelection: true,
            selectionLimit: MAX_PHOTOS - photos.length,
        });
        if (!result.canceled && result.assets.length > 0) {
            const newUris = result.assets.map((a) => a.uri);
            setPhotos((prev) => [...prev, ...newUris].slice(0, MAX_PHOTOS));
        }
    };

    const handlePickPhotos = () => {
        if (photos.length >= MAX_PHOTOS) {
            Alert.alert('Limit Reached', `You can add up to ${MAX_PHOTOS} photos.`);
            return;
        }

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Camera', 'Gallery'],
                    cancelButtonIndex: 0,
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) launchCamera();
                    else if (buttonIndex === 2) launchGallery();
                }
            );
        } else {
            Alert.alert(
                'Add Photo',
                'Tap outside to cancel',
                [
                    { text: 'Gallery', onPress: launchGallery },
                    { text: 'Camera', onPress: launchCamera },
                ],
                { cancelable: true }
            );
        }
    };

    const removePhoto = (index: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = () => {
        if (!validate()) return;
        if (!feeKnown) {
            Alert.alert('One moment', 'Still loading the booking price. Please try again in a second.');
            return;
        }

        // Confirm booking fee before proceeding. For a fixed-price service, show the
        // full split so the customer knows the total and what's left to pay later.
        // Naming the offer matters as much as the number — "you save ₹80" reads
        // as arbitrary, "you save ₹80 — Monsoon Offer" reads as a reason.
        const savingLine = discount.active
            ? `\n\nYou save ₹${discount.saving}${discount.label ? ` — ${discount.label}` : ''}.`
            : '';
        const confirmMessage = prepaidInFull
            ? `Total for ${serviceName}: ₹${payable}.${savingLine}\n\nPay the full ₹${payable} now to book. Nothing more is due after the service, unless parts are needed.`
            : isFixedPrice
            ? `Total for ${serviceName}: ₹${payable}.${savingLine}\n\nPay ₹${bookingFee} now to book, and ₹${finalAfterBooking} after the service is completed.`
            : `A booking fee of ₹${bookingFee} will be charged to confirm your ${serviceName} request. This amount will be adjusted in your final bill.`;
        const bandLine = isInspect
            ? `\n\nThis books an inspection. The expert sends you a quote in the app; go ahead and the ₹${bookingFee} counts towards the bill, or decline and it pays for their visit.`
            : isConsult ? `\n\nThe expert calls you on ${days.find(d => d.date === consultDate)?.label ?? consultDate}, ${consultSlot}.` : '';
        const whoLine = choice.type === 'partner'
            ? `\n\n${choice.name} will do this job.`
            : choice.type === 'expert'
            ? `\n\nWe will send it to ${choice.name} to accept.`
            : '';
        Alert.alert(
            'Confirm Booking',
            confirmMessage + bandLine + whoLine,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: `Pay ₹${payNow} & Book`,
                    onPress: async () => {
                        try {
                            // Upload photos to Cloudinary first (if any)
                            let photoUrls: string[] = [];
                            if (photos.length > 0) {
                                setUploading(true);
                                try {
                                    photoUrls = await customerApi.uploadImages(photos, 'service_photos');
                                } catch (uploadErr) {
                                    Alert.alert('Upload Failed', 'Could not upload photos. Your request will be created without images.');
                                    photoUrls = [];
                                } finally {
                                    setUploading(false);
                                }
                            }

                            createRequest(
                                {
                                    serviceType,
                                    description,
                                    address: selectedAddress?.address ?? '',
                                    pinCode: selectedAddress?.pinCode || '000000',
                                    photos: photoUrls,
                                    urgency,
                                    ...(selectedAddress ? { customerLocation: `POINT(${selectedAddress.long} ${selectedAddress.lat})` } : {}),
                                    ...(isConsult ? { preferredDate: consultDate ?? undefined, preferredTimeSlot: consultSlot ?? undefined } : {}),
                                    catalogServiceId: serviceId,
                                    quantity,
                                    ...(isFixedPrice ? { quotedUnitPrice: basePrice } : {}),
                                    provider: choice.type === 'unitefix' ? { type: 'unitefix' }
                                        : choice.type === 'partner' ? { type: 'partner', id: choice.id, ...(choice.code ? { code: choice.code } : {}) }
                                        : { type: 'expert', id: choice.id },
                                },
                                {
                                    onSuccess: async (response: any) => {
                                        clearDraft();
                                        const nextStep = choice.type === 'partner'
                                            ? `${choice.name} will assign their technician shortly.`
                                            : choice.type === 'expert'
                                            ? `We have sent it to ${choice.name} to accept.`
                                            : 'We will assign a service expert soon.';
                                        const paymentData = response?.data?.payment;

                                        if (paymentData?.razorpayOrderId && paymentData?.razorpayKeyId) {
                                            // Open Razorpay native checkout
                                            try {
                                                const paymentResponse = await openRazorpayCheckout({
                                                    razorpayOrderId: paymentData.razorpayOrderId,
                                                    razorpayKeyId: paymentData.razorpayKeyId,
                                                    amount: paymentData.amount,
                                                    description: `₹${paymentData.amount} Booking Fee — ${serviceName}`,
                                                });

                                                // Verify payment on backend
                                                await customerApi.verifyPayment(paymentResponse);

                                                Alert.alert(
                                                    'Booking Confirmed! ✅',
                                                    prepaidInFull
                                                        ? `Your ₹${paymentData.amount ?? payNow} payment is received — the service is fully paid. ${nextStep}`
                                                        : `Your ₹${bookingFee} booking fee has been paid. ${nextStep}`,
                                                    [{ text: 'OK', onPress: () => navigation.reset({
                                                        index: 0,
                                                        routes: [{
                                                            name: 'CustomerTabs',
                                                            state: { routes: [{ name: 'BookingsTab' }] }
                                                        }]
                                                    }) }]
                                                );
                                            } catch (err: any) {
                                                handleRazorpayError(err);
                                                
                                                // User backed out of payment — silently delete the draft booking
                                                try {
                                                    await customerApi.cancelServiceRequest(response.data.data.id);
                                                } catch(cancelErr) {
                                                    console.warn('Failed to cleanup unpaid booking', cancelErr);
                                                }

                                                Alert.alert(
                                                    'Payment Cancelled',
                                                    'Your booking was not created because the payment was cancelled. Please try again.',
                                                    [{ text: 'OK' }]
                                                );
                                            }
                                        } else {
                                            // No payment required (Razorpay not configured / dev mode)
                                            Alert.alert(
                                                'Request Submitted! ✅',
                                                `Your service request has been created. ${nextStep}`,
                                                [{ text: 'OK', onPress: () => navigation.reset({
                                                    index: 0,
                                                    routes: [{
                                                        name: 'CustomerTabs',
                                                        state: { routes: [{ name: 'BookingsTab' }] }
                                                    }]
                                                }) }]
                                            );
                                        }
                                    },
                                }
                            );
                        } catch (error) {
                            setUploading(false);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Book {serviceName}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Service type badge */}
                <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>📋 {serviceName}</Text>
                </View>

                {/* Fixed-price summary */}
                {isFixedPrice && (
                    <View style={styles.priceCard}>
                        {/* Stepper first, then the total it produces — the number
                            has to visibly answer the control above it. */}
                        <View style={styles.qtyRow}>
                            <View>
                                <Text style={styles.priceLabel}>Quantity</Text>
                                <Text style={styles.qtyUnitNote}>₹{basePrice} each</Text>
                            </View>
                            <View style={styles.stepper}>
                                <TouchableOpacity
                                    style={[styles.stepperBtn, quantity <= 1 && styles.stepperBtnDisabled]}
                                    onPress={() => setQuantity(q => Math.max(1, q - 1))}
                                    disabled={quantity <= 1}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Text style={[styles.stepperSign, quantity <= 1 && styles.stepperSignDisabled]}>−</Text>
                                </TouchableOpacity>
                                <Text style={styles.stepperValue}>{quantity}</Text>
                                <TouchableOpacity
                                    style={[styles.stepperBtn, quantity >= MAX_QUANTITY && styles.stepperBtnDisabled]}
                                    onPress={() => setQuantity(q => Math.min(MAX_QUANTITY, q + 1))}
                                    disabled={quantity >= MAX_QUANTITY}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Text style={[styles.stepperSign, quantity >= MAX_QUANTITY && styles.stepperSignDisabled]}>+</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        <View style={styles.priceDivider} />
                        <View style={styles.priceRow}>
                            <Text style={styles.priceLabel}>Total price</Text>
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={styles.priceTotal}>₹{basePrice * quantity}</Text>
                                {quantity > 1 && (
                                    <Text style={styles.qtyUnitNote}>{quantity} × ₹{basePrice}</Text>
                                )}
                            </View>
                        </View>
                        <View style={styles.priceDivider} />
                        <View style={styles.priceRow}>
                            <Text style={styles.priceSubLabel}>{prepaidInFull ? 'Pay now (full amount)' : 'Pay now to book'}</Text>
                            <Text style={styles.priceSubValue}>₹{payNow}</Text>
                        </View>
                        {!prepaidInFull && (
                            <View style={styles.priceRow}>
                                <Text style={styles.priceSubLabel}>Pay after service</Text>
                                <Text style={styles.priceSubValue}>₹{finalAfterBooking}</Text>
                            </View>
                        )}
                        <Text style={styles.priceNote}>Inclusive of all taxes.</Text>
                        {quote?.servicedBy && (
                            <Text style={styles.priceNote}>{quote.servicedBy.note}</Text>
                        )}
                    </View>
                )}

                {/* How this booking works (inspection or consultation) */}
                {(isInspect || isConsult) && (
                    <View style={[styles.bandCard, { borderColor: accent }]}>
                        <Text style={[styles.bandCardKicker, { color: accent }]}>{BAND_META[band].label}</Text>
                        <Text style={styles.bandCardText}>
                            {isInspect
                                ? `Pay ₹${bookingFee} to book an inspection. The expert looks at the job and sends you a quote here. Approve it and the ₹${bookingFee} counts towards your bill; decline it and it pays for their visit.`
                                : 'No visit: pick a day and time and the expert calls you on your registered number. Pay the consultation fee now; anything more is billed after the call.'}
                        </Text>
                    </View>
                )}

                {/* Description */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Describe the issue *</Text>
                    <TextInput
                        style={[styles.textArea, errors.description && styles.inputError]}
                        placeholder="Tell us what's wrong — the more detail, the better."
                        value={description}
                        onChangeText={setDescription}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        placeholderTextColor={colors.textDisabled}
                    />
                    {errors.description && <Text style={styles.errorText}>{errors.description}</Text>}
                </View>

                {/* Consultation: when to call */}
                {isConsult && (
                    <View style={styles.fieldContainer}>
                        <Text style={styles.label}>When should the expert call? *</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                            {days.map(d => (
                                <TouchableOpacity key={d.date} onPress={() => { setConsultDate(d.date); if (consultSlot && !slotsFor(d.date).some(x => x.slot === consultSlot)) setConsultSlot(null); setErrors(p => ({ ...p, slot: '' })); }}
                                    style={[styles.chip, consultDate === d.date && { borderColor: accent, backgroundColor: `${accent}1A` }]} accessibilityRole="radio" accessibilityState={{ selected: consultDate === d.date }}>
                                    <Text style={[styles.chipText, consultDate === d.date && { color: accent }]}>{d.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        {!!consultDate && (
                            <View style={styles.slotGrid}>
                                {slotsFor(consultDate).map(x => (
                                    <TouchableOpacity key={x.slot} onPress={() => { setConsultSlot(x.slot); setErrors(p => ({ ...p, slot: '' })); }}
                                        style={[styles.chip, consultSlot === x.slot && { borderColor: accent, backgroundColor: `${accent}1A` }]} accessibilityRole="radio" accessibilityState={{ selected: consultSlot === x.slot }}>
                                        <Text style={[styles.chipText, consultSlot === x.slot && { color: accent }]}>{x.slot}</Text>
                                    </TouchableOpacity>
                                ))}
                                {!slotsFor(consultDate).length && <Text style={styles.errorText}>No times left today. Pick another day.</Text>}
                            </View>
                        )}
                        {!!errors.slot && <Text style={styles.errorText}>{errors.slot}</Text>}
                    </View>
                )}

                {/* Address Selection (not needed for a phone consultation) */}
                {!isConsult && (
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Service Address *</Text>
                    <TouchableOpacity 
                        style={[styles.addressSelector, errors.address && styles.inputError]}
                        onPress={() => navigation.navigate('SavedAddresses', { fromCheckout: true })}
                    >
                        <MapPin size={20} color={colors.primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            {selectedAddress ? (
                                <>
                                    <Text style={{ fontSize: 16, fontWeight: '500', color: colors.textPrimary }}>{selectedAddress.label}</Text>
                                    <Text style={{ fontSize: 14, color: colors.textSecondary }} numberOfLines={2}>{selectedAddress.address}</Text>
                                </>
                            ) : (
                                <Text style={{ fontSize: 16, color: colors.textSecondary }}>Select Address</Text>
                            )}
                        </View>
                    </TouchableOpacity>
                    {errors.address && <Text style={styles.errorText}>{errors.address}</Text>}
                </View>
                )}

                {/* Who does the job (a visit or an inspection; a consultation is UniteFix's to arrange) */}
                {!isConsult && (
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Who should do it?</Text>
                    <ProviderChooser
                        options={providerOptions}
                        loading={!!selectedAddress && optionsLoading}
                        hasAddress={!!selectedAddress}
                        value={choice}
                        onChange={setChoice}
                        mode={chooserMode}
                        onModeChange={setChooserMode}
                        partnerCode={partnerCode}
                        onApplyCode={setPartnerCode}
                    />
                    {!!chosenName && <Text style={styles.chosenNote}>Chosen: {chosenName}</Text>}
                </View>
                )}

                {/* Urgency selector */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Urgency</Text>
                    <View style={styles.urgencyRow}>
                        <TouchableOpacity
                            style={[styles.urgencyOption, urgency === 'normal' && styles.urgencySelected]}
                            onPress={() => setUrgency('normal')}
                        >
                            <Clock size={18} color={urgency === 'normal' ? colors.primary : colors.textSecondary} />
                            <Text style={[styles.urgencyLabel, urgency === 'normal' && styles.urgencyLabelSelected]}>
                                Normal
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.urgencyOption, urgency === 'urgent' && styles.urgencyUrgentSelected]}
                            onPress={() => setUrgency('urgent')}
                        >
                            <AlertTriangle size={18} color={urgency === 'urgent' ? colors.error : colors.textSecondary} />
                            <Text style={[styles.urgencyLabel, urgency === 'urgent' && styles.urgencyLabelUrgent]}>
                                Urgent
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Photo upload */}
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Photos (optional, max {MAX_PHOTOS})</Text>

                    {/* Photo preview grid */}
                    {photos.length > 0 && (
                        <View style={styles.photoGrid}>
                            {photos.map((uri, index) => (
                                <View key={index} style={styles.photoPreviewContainer}>
                                    <Image source={{ uri }} style={styles.photoPreview} />
                                    <TouchableOpacity
                                        style={styles.photoRemoveBtn}
                                        onPress={() => removePhoto(index)}
                                    >
                                        <X size={14} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Add photo button */}
                    {photos.length < MAX_PHOTOS && (
                        <TouchableOpacity style={styles.photoUpload} onPress={handlePickPhotos}>
                            <ImagePlus size={24} color={colors.primary} />
                            <Text style={styles.photoUploadText}>
                                {photos.length === 0 ? 'Tap to add photos of the issue' : 'Add more photos'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Submit */}
                <Button
                    title={uploading ? 'Uploading photos...' : !feeKnown ? 'Loading price…' : isInspect ? `${BAND_META.inspect_quote.cta} · ₹${bookingFee}` : isConsult ? BAND_META.consultation.cta : 'Submit Request'}
                    onPress={handleSubmit}
                    loading={isPending || uploading}
                    disabled={!feeKnown}
                    style={styles.submitButton}
                />
            </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.background,
    },
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
        paddingBottom: 120, // Increased padding to prevent camera button clipping
    },
    typeBadge: {
        alignSelf: 'flex-start',
        backgroundColor: colors.primarySurface,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        borderRadius: radii.full,
        marginBottom: spacing.xl,
    },
    typeBadgeText: {
        ...typography.label,
        color: colors.primary,
    },
    priceCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        marginBottom: spacing.xl,
    },
    priceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 2,
    },
    priceLabel: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    priceTotal: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    priceDivider: {
        height: 1,
        backgroundColor: colors.divider,
        marginVertical: spacing.sm,
    },
    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    qtyUnitNote: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
    chosenNote: { ...typography.caption, color: colors.primary, marginTop: spacing.sm, fontWeight: '600' },
    bandCard: { borderWidth: 1.5, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surfaceElevated, gap: spacing.xs },
    bandCardKicker: { ...typography.small, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
    bandCardText: { ...typography.caption, color: colors.textSecondary },
    chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
    slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.background },
    chipText: { ...typography.captionMedium, color: colors.textPrimary },
    stepperBtn: {
        width: 36, height: 36, borderRadius: radii.full,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.primarySurface,
        borderWidth: 1, borderColor: colors.primaryLight,
    },
    stepperBtnDisabled: { backgroundColor: colors.surface, borderColor: colors.border },
    stepperSign: { ...typography.h3, color: colors.primary, lineHeight: 24 },
    stepperSignDisabled: { color: colors.textDisabled },
    stepperValue: { ...typography.h3, color: colors.textPrimary, minWidth: 24, textAlign: 'center' },
    priceSubLabel: {
        ...typography.body,
        color: colors.textSecondary,
    },
    priceSubValue: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    priceNote: {
        ...typography.small,
        color: colors.textDisabled,
        marginTop: spacing.sm,
    },
    fieldContainer: {
        marginBottom: spacing.lg,
    },
    label: {
        ...typography.label,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    textArea: {
        backgroundColor: colors.background,
        borderRadius: radii.md,
        padding: spacing.md,
        ...typography.body,
        color: colors.textPrimary,
        borderWidth: 1,
        borderColor: colors.border,
        minHeight: 100,
    },
    addressSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        padding: spacing.md,
    },
    inputError: {
        borderColor: colors.error,
    },
    errorText: {
        ...typography.small,
        color: colors.error,
        marginTop: spacing.xs,
    },
    urgencyRow: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    urgencyOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: radii.md,
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    urgencySelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    urgencyUrgentSelected: {
        borderColor: colors.error,
        backgroundColor: colors.errorLight,
    },
    urgencyLabel: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
    },
    urgencyLabelSelected: {
        color: colors.primary,
    },
    urgencyLabelUrgent: {
        color: colors.error,
    },
    photoUpload: {
        borderWidth: 1.5,
        borderColor: colors.primary,
        borderStyle: 'dashed',
        borderRadius: radii.md,
        paddingVertical: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.primarySurface,
    },
    photoUploadText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '500',
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    photoPreviewContainer: {
        width: 80,
        height: 80,
        borderRadius: radii.md,
        overflow: 'hidden',
        position: 'relative',
    },
    photoPreview: {
        width: '100%',
        height: '100%',
        borderRadius: radii.md,
    },
    photoRemoveBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitButton: {
        marginTop: spacing.md,
    },
});

