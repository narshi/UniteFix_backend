/**
 * PHASE 2: Configuration Service
 * 
 * Provides type-safe access to platform configuration with caching.
 * Configurations are stored in database and cached in-memory for performance.
 */

import { storage } from '../storage';

export class ConfigService {
    private cache: Map<string, any> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Get a configuration value with type safety
     * @param key Configuration key (e.g., 'BUSINESS_CONFIG.BASE_SERVICE_FEE')
     * @param defaultValue Default value if config not found
     * @returns Typed configuration value
     */
    async get<T = any>(key: string, defaultValue?: T): Promise<T> {
        // Check cache first
        if (this.isCacheValid(key)) {
            return this.cache.get(key) as T;
        }

        // Fetch from database
        try {
            const config = await storage.getPlatformConfig(key);

            if (!config) {
                return defaultValue as T;
            }

            // Parse value based on type
            const parsed = this.parseConfigValue(config.value, config.valueType);

            // Cache the value
            this.setCacheValue(key, parsed);

            return parsed as T;
        } catch (error) {
            console.error(`Error fetching config ${key}:`, error);
            return defaultValue as T;
        }
    }

    /**
     * Get all configurations in a category
     * @param category 'BUSINESS_CONFIG' or 'OPERATIONAL_CONFIG'
     */
    async getByCategory(category: 'BUSINESS_CONFIG' | 'OPERATIONAL_CONFIG'): Promise<Record<string, any>> {
        const configs = await storage.getPlatformConfigByCategory(category);
        const result: Record<string, any> = {};

        for (const config of configs) {
            const parsed = this.parseConfigValue(config.value, config.valueType);
            result[config.key] = parsed;
        }

        return result;
    }

    /**
     * Set a configuration value (admin only)
     * @param key Configuration key
     * @param value New value
     * @param updatedBy Admin user ID
     */
    async set(key: string, value: any, updatedBy: number): Promise<void> {
        await storage.updatePlatformConfig(key, String(value), updatedBy);
        this.invalidate(key);
    }

    /**
     * Invalidate cache for a specific key or all keys
     */
    invalidate(key?: string): void {
        if (key) {
            this.cache.delete(key);
            this.cacheExpiry.delete(key);
        } else {
            this.cache.clear();
            this.cacheExpiry.clear();
        }
    }

    /**
     * Parse configuration value based on type
     */
    private parseConfigValue(value: string, type: string): any {
        switch (type) {
            case 'number':
                return parseFloat(value);
            case 'boolean':
                return value === 'true' || value === '1';
            case 'json':
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            case 'string':
            default:
                return value;
        }
    }

    /**
     * Check if cached value is still valid
     */
    private isCacheValid(key: string): boolean {
        if (!this.cache.has(key)) {
            return false;
        }

        const expiry = this.cacheExpiry.get(key);
        if (!expiry || Date.now() > expiry) {
            this.cache.delete(key);
            this.cacheExpiry.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Set value in cache with expiry
     */
    private setCacheValue(key: string, value: any): void {
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL_MS);
    }
}

// Singleton instance
export const configService = new ConfigService();
