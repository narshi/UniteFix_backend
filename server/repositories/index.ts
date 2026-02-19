/**
 * Domain Repositories — Barrel Export
 * 
 * Re-exports all domain repository modules for clean imports:
 *   import { UserRepo, PartnerRepo } from './repositories';
 * 
 * The DatabaseStorage class in storage.ts continues to serve as the 
 * backward-compatible facade used by existing routes.
 */

import * as UserRepo from './user.repository';
import * as PartnerRepo from './partner.repository';
import * as OrderRepo from './order.repository';
import * as ProductRepo from './product.repository';
import * as LocationRepo from './location.repository';
import * as NotificationRepo from './notification.repository';

export {
    UserRepo,
    PartnerRepo,
    OrderRepo,
    ProductRepo,
    LocationRepo,
    NotificationRepo,
};
