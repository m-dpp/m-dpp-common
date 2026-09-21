/** Wire types for the endpoints the shared screens use. App-agnostic.
 *
 * Organisations, subjects, memberships and roles are served by
 * **m-dpp-identity** — one row per organisation, one id, system-wide. The
 * `external_key` that used to sit on `Organisation` is gone with the problem it
 * solved: each app no longer issues its own id for the same company, so there
 * is nothing left to reconcile. */

export interface Organisation {
  id: string;
  name: string;
  /** The platform organisation. Exactly one, it governs the installation and
   *  owns nothing — it cannot be a product's operator or a test's laboratory,
   *  and cannot be deleted. */
  is_platform: boolean;
  /** Active role names. An organisation's NATURE is its roles — there is no type
   *  column, a lab is simply an organisation holding `laboratory` — so they
   *  travel with it rather than needing a second request per row. */
  roles: string[];
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
  organisation: { id: string; name: string; is_platform?: boolean } | null;
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
  /** The organisation currently being acted for. Its `id` is issued by
   *  m-dpp-identity and means the same thing to every service. */
  organisation: { id: string; name: string; is_platform: boolean } | null;
  /** …and whether this membership may administer it. */
  is_org_admin: boolean;
  /** Every organisation this subject may act for. Offered as choices; confers
   *  nothing by itself. */
  organisations: { id: string; name: string; is_org_admin: boolean; is_platform: boolean }[];
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


// ── identity-only shapes ────────────────────────────────────────────────

/** Where a laboratory publishes its results, and whether it is in service.
 *  Stored in the organisation's `attrs`, but first-class on the wire because
 *  m-dpp-app's `/refresh` depends on exactly these two keys. */
export interface LabConfig {
  organisation_id: string;
  name: string;
  lab_results_endpoint: string | null;
  lab_active: boolean;
}

/** A public key an organisation signs with. Rotated, never replaced: a revoked
 *  key is still listed, so a signature made before the revocation stays
 *  verifiable. */
export interface OrganisationKey {
  id: string;
  organisation_id: string;
  kid: string;
  public_key: string;
  algorithm: string;
  revoked_at: string | null;
  created_at: string;
}

export interface OrganisationKeyCreate {
  kid: string;
  public_key: string;
  algorithm?: string;
}

/** One entry in the identity audit trail. `detail` carries names AS THEY WERE,
 *  because the rows it would otherwise join to may be gone. */
export interface IdentityEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  actor_sub: string | null;
  organisation_id: string | null;
  subject_id: string | null;
  detail: Record<string, unknown>;
}

/** What the identity installation is running. */
export interface IdentityAbout {
  service: string;
  resource_types: string[];
  gln_pedantic: boolean;
  /** False means the trusted-service endpoints are closed — the likeliest cause
   *  of "everything resolves to public" in an app. */
  service_token_configured: boolean;
  platform_organisation: { id: string; name: string } | null;
  roles: { name: string; label: string | null; description: string; active: boolean }[];
}
