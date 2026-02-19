/**
 * Location Repository
 * Extracted from storage.ts — districts + serviceable pincodes
 */

import { db } from "../db";
import {
    districts, serviceablePincodes,
    type District, type InsertDistrict,
    type ServiceablePincode, type InsertServiceablePincode,
} from "@shared/schema";
import { eq, and, or, count } from "drizzle-orm";

// ==================== DISTRICTS ====================

export async function getAllDistricts(): Promise<District[]> {
    return await db.select().from(districts);
}

export async function getDistrict(id: number): Promise<District | undefined> {
    const [district] = await db.select().from(districts).where(eq(districts.id, id));
    return district;
}

export async function createDistrict(district: InsertDistrict): Promise<District> {
    const [result] = await db.insert(districts).values(district).returning();
    return result;
}

export async function toggleDistrictStatus(id: number, isActive: boolean): Promise<District> {
    const [result] = await db
        .update(districts)
        .set({ isActive })
        .where(eq(districts.id, id))
        .returning();
    return result;
}

export async function deleteDistrict(id: number): Promise<void> {
    const district = await getDistrict(id);
    if (!district) throw new Error("District not found");

    if (district.name === 'Uttara Kannada') {
        throw new Error("Cannot delete default district 'Uttara Kannada'");
    }

    await db.delete(serviceablePincodes).where(
        or(
            eq(serviceablePincodes.districtId, id),
            eq(serviceablePincodes.district, district.name)
        )
    );

    await db.delete(districts).where(eq(districts.id, id));
}

export async function ensureDefaultDistrict(): Promise<void> {
    const existing = await db.query.districts.findFirst({
        where: (districts, { eq }) => eq(districts.name, 'Uttara Kannada')
    });

    if (!existing) {
        await createDistrict({
            name: 'Uttara Kannada',
            state: 'Karnataka',
            pincodePrefix: '581',
            isActive: true
        });
        console.log('Default district "Uttara Kannada" created.');
    }
}

// ==================== SERVICEABLE PINCODES ====================

export async function createServiceablePincode(pincode: InsertServiceablePincode): Promise<ServiceablePincode> {
    let districtId: number | undefined;

    if (pincode.district) {
        const districtRecord = await db.query.districts.findFirst({
            where: eq(districts.name, pincode.district)
        });

        if (districtRecord) {
            districtId = districtRecord.id;
            if (districtRecord.pincodePrefix && !pincode.pincode.startsWith(districtRecord.pincodePrefix)) {
                throw new Error(`Validation Error: Pincode must start with ${districtRecord.pincodePrefix} for ${pincode.district} region.`);
            }
        }
    }

    const [result] = await db
        .insert(serviceablePincodes)
        .values({ ...pincode, districtId })
        .returning();
    return result;
}

export async function getServiceablePincode(pincode: string): Promise<ServiceablePincode | undefined> {
    const [result] = await db
        .select()
        .from(serviceablePincodes)
        .where(eq(serviceablePincodes.pincode, pincode));
    return result || undefined;
}

export async function getAllServiceablePincodes(): Promise<ServiceablePincode[]> {
    return await db.select().from(serviceablePincodes);
}

export async function togglePincodeStatus(pincode: string, explicitStatus?: boolean): Promise<ServiceablePincode | undefined> {
    const existing = await getServiceablePincode(pincode);
    if (!existing) return undefined;

    const newStatus = explicitStatus !== undefined ? explicitStatus : !existing.isActive;

    const [result] = await db
        .update(serviceablePincodes)
        .set({ isActive: newStatus })
        .where(eq(serviceablePincodes.pincode, pincode))
        .returning();
    return result || undefined;
}

export async function isPincodeServiceable(pincode: string): Promise<boolean> {
    const [result] = await db
        .select({ count: count() })
        .from(serviceablePincodes)
        .where(and(eq(serviceablePincodes.pincode, pincode), eq(serviceablePincodes.isActive, true)));

    if (result.count > 0) return true;

    // Fallback: Accept all 581xxx pincodes (Uttara Kannada region)
    if (pincode.startsWith('581')) return true;

    return false;
}
