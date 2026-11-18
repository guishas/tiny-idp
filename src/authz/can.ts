import type { Permission } from '@/authz/permissions'
import type { Org } from '@/store'

// The answer says not just yes or no but WHY, because the audit log (Milestone 5) must record
// whether an action was allowed by the user's own role or on behalf of someone else.
export type Decision =
  | { allowed: false }
  | { allowed: true; via: 'role'; roleId: string }
  | { allowed: true; via: 'delegation'; delegationId: string; delegatorId: string }

// The permissions a user holds through their own role in this org. Empty for non-members.
function rolePermissions(org: Org, userId: string): readonly Permission[] {
  const roleId = org.members.get(userId)

  return (roleId && org.roles.get(roleId)?.permissions) || []
}

// Does the user hold ALL of these permissions through their own role? Delegated permissions do
// not count: this is the ceiling for granting anything to anyone (anti-escalation) and the reason
// a delegation cannot be passed on.
export function holdsAll(org: Org, userId: string, permissions: readonly Permission[]) {
  const held = rolePermissions(org, userId)

  return permissions.every((permission) => held.includes(permission))
}

// The single place where "is this allowed?" is decided. Deny by default: unless a role or an
// active delegation explicitly grants the permission, the answer is no.
export function can(org: Org, userId: string, permission: Permission, now = Date.now()): Decision {
  const roleId = org.members.get(userId)
  if (roleId && holdsAll(org, userId, [permission])) {
    return { allowed: true, via: 'role', roleId }
  }

  for (const delegation of org.delegations.values()) {
    if (delegation.granteeId !== userId) continue
    if (delegation.revokedAt !== undefined || delegation.expiresAt <= now) continue
    if (!delegation.permissions.includes(permission)) continue

    // Evaluated at decision time: if the grantor lost the permission since, the delegation
    // stops working immediately, with no cleanup job involved.
    if (holdsAll(org, delegation.grantorId, [permission])) {
      return {
        allowed: true,
        via: 'delegation',
        delegationId: delegation.id,
        delegatorId: delegation.grantorId,
      }
    }
  }

  return { allowed: false }
}
