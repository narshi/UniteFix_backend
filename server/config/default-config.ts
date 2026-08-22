/**
 * PHASE 2: Default Platform Configuration
 * 
 * Logically separated into two categories:
 * - BUSINESS_CONFIG: Financial rules, fees, commissions
 * - OPERATIONAL_CONFIG: System limits, distances, feature flags
 */

export interface ConfigItem {
    key: string;
    value: string;
    valueType: 'string' | 'number' | 'boolean' | 'json';
    category: 'BUSINESS_CONFIG' | 'OPERATIONAL_CONFIG';
    description: string;
    isEditable?: boolean;
}

export const DEFAULT_PLATFORM_CONFIG: ConfigItem[] = [
    // ========== BUSINESS_CONFIG ==========
    // Financial rules, commissions, fees
    {
        key: 'BUSINESS_CONFIG.BASE_SERVICE_FEE',
        value: '99',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Base booking fee in INR (AI_CONTEXT §3.B.1)',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.PLATFORM_COMMISSION_PERCENTAGE',
        value: '15',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: '@DEPRECATED — Use UNITEFIX_FEE_PERCENT instead. Platform commission as percentage of subtotal (AI_CONTEXT §3.C)',
        isEditable: false, // Locked: edits should go to UNITEFIX_FEE_PERCENT
    },
    {
        key: 'BUSINESS_CONFIG.MIN_WALLET_REDEMPTION',
        value: '500',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Minimum wallet balance for redemption in INR',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.WALLET_HOLD_DAYS',
        value: '7',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Days to hold partner earnings before release',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.GST_PERCENTAGE',
        value: '18',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'GST percentage on taxable amount (AI_CONTEXT §3.C)',
        isEditable: false,
    },
    {
        key: 'BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT',
        value: '12',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'UniteFix platform fee percentage (fixed-price catalog model — carved out of the service price)',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.DISCOUNT_PERCENT',
        value: '0',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Promotional discount % off the service price. Comes out of the platform fee — the technician earning is held at the undiscounted level. Frozen into each booking at creation, so changing it never alters an existing bill.',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.DISCOUNT_LABEL',
        value: '',
        valueType: 'string',
        category: 'BUSINESS_CONFIG',
        description: 'Why the discount is being given, e.g. "Monsoon Offer". Shown to the customer in the app and printed beside the discount line on the invoice. Frozen per booking, so a reprinted invoice names the offer that actually applied.',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.CANCELLATION_FEE',
        value: '150',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Cancellation fee in INR charged when customer cancels after assignment',
        isEditable: true,
    },

    // ========== OPERATIONAL_CONFIG ==========
    // System limits, distances, feature flags
    {
        key: 'OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE',
        value: '200',
        valueType: 'number',
        category: 'OPERATIONAL_CONFIG',
        description: 'Maximum distance in meters for REACHED geo-fence (AI_CONTEXT §4.4)',
        isEditable: true,
    },
    {
        key: 'OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS',
        value: '4',
        valueType: 'number',
        category: 'OPERATIONAL_CONFIG',
        description: 'Hours before unaccepted assignment auto-reverts to CREATED (AI_CONTEXT §3.F)',
        isEditable: true,
    },
    {
        key: 'OPERATIONAL_CONFIG.MAX_PHOTOS_PER_REQUEST',
        value: '5',
        valueType: 'number',
        category: 'OPERATIONAL_CONFIG',
        description: 'Maximum photos allowed per service request',
        isEditable: true,
    },
    {
        key: 'OPERATIONAL_CONFIG.INVENTORY_OWNER_PARTNER_ID',
        value: 'UNITEFIX_PLATFORM',
        valueType: 'string',
        category: 'OPERATIONAL_CONFIG',
        description: 'Virtual partner ID for platform-owned inventory',
        isEditable: false, // This should never be changed
    },
    {
        key: 'OPERATIONAL_CONFIG.ENABLE_AUTO_ASSIGNMENT',
        value: 'false',
        valueType: 'boolean',
        category: 'OPERATIONAL_CONFIG',
        description: 'Enable automatic partner assignment based on proximity',
        isEditable: true,
    },
];
