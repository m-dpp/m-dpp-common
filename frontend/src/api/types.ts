/** Wire types for the endpoints the shared screens use. App-agnostic. */

export interface Organisation {
  id: string;
  name: string;
  attrs: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  "@id"?: string;
}

export interface OrganisationCreate {
  name: string;
  attrs?: Record<string, unknown> | null;
}

export interface OrganisationUpdate {
  name?: string;
  /** Merge patch: a key set to null is removed. */
  attrs?: Record<string, unknown>;
  active?: boolean;
}

export interface Role {
  name: string;
  label: string;
  description: string;
  active: boolean;
  sort_order: number;
}

export interface RoleCreate {
  name: string;
  label?: string;
  description?: string;
}

export interface RoleUpdate {
  label?: string;
  description?: string;
  active?: boolean;
}

export interface OrganisationRole {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  organisation_gln: string | null;
  role_name: string;
}

export interface SubjectMembership {
  id: string;
  organisation: { id: string; name: string } | null;
  is_org_admin: boolean;
  /** The organisation's roles — what this subject holds WHEN acting for it. */
  roles: string[];
}

export interface Subject {
  id: string;
  sub: string;
  email: string | null;
  display_name: string | null;
  /** Every organisation this subject may act for. */
  memberships: SubjectMembership[];
  /** @deprecated the FIRST membership, for callers written when there was at
   *  most one. With several there is no single answer — use `memberships`. */
  membership: SubjectMembership | null;
  /** Every role held in SOME organisation, for display only. Authority is
   *  always one organisation's at a time, never this union. */
  roles: string[];
}

export interface SubjectCreate {
  sub: string;
  email?: string | null;
  display_name?: string | null;
}

export interface Membership {
  id: string;
  subject_id: string;
  organisation_id: string;
  is_org_admin: boolean;
  sub: string | null;
  organisation_name: string | null;
}

export type ResourceAction = "list" | "read" | "create" | "update" | "delete";

export interface Principal {
  sub: string | null;
  anonymous: boolean;
  reason: string | null;
  subject: { id: string; sub: string; email: string | null; display_name: string | null } | null;
  /** The organisation currently being acted for. `key` is the cross-service
   *  name — each app issues its own ids, so only the key means the same thing
   *  to both. */
  organisation: { id: string; key: string | null; name: string } | null;
  /** …and whether this membership may administer it. */
  is_org_admin: boolean;
  /** Every organisation this subject may act for. Offered as choices; confers
   *  nothing by itself. */
  organisations: { id: string; key: string | null; name: string; is_org_admin: boolean }[];
  roles: string[];
  /** @deprecated compat: roles[0] */
  role: string;
  /** resource type → action → allowed (union over the principal's roles). */
  permissions: Record<string, Record<ResourceAction, boolean>>;
}

export type AttrOrigin = "discovered" | "manual";

export interface RbacAttribute {
  id: string;
  entity_type: string;
  attr_key: string;
  origin: AttrOrigin;
  description: string;
}

export interface AttrPermission {
  id: string;
  entity_type: string;
  attr_key: string;
  role_name: string;
  can_read: boolean;
  can_write: boolean;
}

export interface ResourcePermission {
  id: string;
  resource_type: string;
  role_name: string;
  can_list: boolean;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface SyncAttrsResult {
  discovered: number;
  registered: number;
  inserted: number;
}
