// The permission catalog is fixed by the product: code must know what each one means, because
// a handler somewhere checks it. Customers compose roles FROM this list but cannot extend it.
export const PERMISSIONS = [
  'invoice:create',
  'invoice:read',
  'invoice:read:own',
  'invoice:approve',
  'role:manage',
  'member:manage',
  'delegation:manage',
  'audit:read',
] as const

export type Permission = (typeof PERMISSIONS)[number]
