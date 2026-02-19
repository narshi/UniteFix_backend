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
        value: '250',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Base booking fee in INR',
        isEditable: true,
    },
    {
        key: 'BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE',
        value: '50',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Partner share of service fee (%)',
        isEditable: true,
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
        key: 'BUSINESS_CONFIG.CANCELLATION_FEE_PERCENTAGE',
        value: '20',
        valueType: 'number',
        category: 'BUSINESS_CONFIG',
        description: 'Cancellation fee as percentage of booking fee',
        isEditable: true,
    },

    // ========== OPERATIONAL_CONFIG ==========
    // System limits, distances, feature flags
    {
        key: 'OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE',
        value: '500',
        valueType: 'number',
        category: 'OPERATIONAL_CONFIG',
        description: 'Maximum distance in meters for service start geo-fence',
        isEditable: true,
    },
    {
        key: 'OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS',
        value: '24',
        valueType: 'number',
        category: 'OPERATIONAL_CONFIG',
        description: 'Hours before unaccepted assignment expires',
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
