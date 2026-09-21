"""The platform-wide definitions both apps seed from — §4.5's first safeguard.

Roles and their default permissions live in **each app's own tables** (the
per-app data rule: no shared database, no runtime call between services). That
means the two copies can drift. This module makes the *starting* state
impossible to diverge by typo: both apps import these definitions rather than
retyping them.

It does **not** make them synchronised. A platform admin who changes a role in
one app must repeat it in the other — a conscious choice for a small consortium
tool, not an oversight. The second safeguard makes drift *visible*:
``permissions_checksum`` is shown on each app's "About this installation"
screen, so opening both side by side reveals a divergence immediately.

If drift ever becomes a real problem, the direction is a single authoritative
source, not more manual discipline.
"""

from __future__ import annotations

import hashlib
import json

# ── the five permission shapes every policy is built from ────────────────
NONE = dict(can_list=False, can_read=False, can_create=False, can_update=False, can_delete=False)
READ = dict(can_list=True, can_read=True, can_create=False, can_update=False, can_delete=False)
READ_UPDATE = dict(can_list=True, can_read=True, can_create=False, can_update=True, can_delete=False)
WRITE = dict(can_list=True, can_read=True, can_create=True, can_update=True, can_delete=False)
FULL = dict(can_list=True, can_read=True, can_create=True, can_update=True, can_delete=True)

#: Resource types **m-dpp-identity** gates. They are what was always common to
#: every app — identities, organisations, and the access-control surface itself —
#: and they now exist in one service instead of three copies.
COMMON_RESOURCE_TYPES: list[str] = ["organisations", "rbac", "subjects"]

#: What an APP still gates from this shared definition. Only `rbac`: an app keeps
#: its own attribute and resource matrices (its entity types differ from every
#: other service's), but who may *change* those matrices is a platform decision
#: and must read the same everywhere. `organisations` and `subjects` are not an
#: app's to gate any more — it holds neither table.
APP_RESOURCE_TYPES: list[str] = ["rbac"]

#: What each role may do with the resources every app shares.
#:
#: `rbac` is the platform's policy surface: only `platform_admin` may change it,
#: and `administrator` may only read it — an operator that could edit the
#: matrices could widen what `public` sees of its own data, which is exactly the
#: thing tenancy is meant to prevent.
#:
#: `organisations` is "shared in existence, private in detail": every role may
#: LIST and READ them — an operator must find a laboratory, a lab must see who
#: requested a test — but **only `platform_admin` may change one**. Creating an
#: organisation and editing its record are the same kind of act: they decide who
#: exists in this system and what they are called, which is platform governance
#: rather than tenant business.
#:
#: This is stricter than an earlier draft that let each organisation's
#: `org_admin` edit its own record. That per-row exception was never
#: implemented, so nothing loses a capability it had — but two consequences are
#: real and deliberate:
#:
#:   * a **laboratory cannot maintain its own** `lab_results_endpoint`, which
#:     lives in its organisation's attrs. The platform operator maintains it.
#:   * an **economic operator cannot correct its own** name or GLN.
#:
#: Both are recoverable by asking an administrator, which is the trade for
#: nobody being able to quietly rename themselves.
COMMON_RESOURCE_DEFAULTS: dict[str, dict] = {
    "platform_admin":            {"organisations": FULL, "rbac": FULL, "subjects": FULL},
    "administrator":             {"organisations": READ, "rbac": READ, "subjects": FULL},
    "public":                    {"organisations": READ, "rbac": NONE, "subjects": NONE},
    "end_user_professional":     {"organisations": READ, "rbac": NONE, "subjects": NONE},
    "recycler":                  {"organisations": READ, "rbac": NONE, "subjects": NONE},
    "supply_chain_professional": {"organisations": READ, "rbac": NONE, "subjects": NONE},
    "authority":                 {"organisations": READ, "rbac": READ, "subjects": NONE},
    "economic_operator":         {"organisations": READ, "rbac": NONE, "subjects": NONE},
    "laboratory":                {"organisations": READ, "rbac": NONE, "subjects": NONE},
}


def merge_resource_defaults(*layers: dict[str, dict]) -> dict[str, dict]:
    """Combine the shared defaults with an app's own, per role.

    Later layers win per resource type, so an app adds its entities without
    restating the shared ones — and cannot silently drop them either.
    """
    out: dict[str, dict] = {}
    for layer in layers:
        for role, per_resource in layer.items():
            out.setdefault(role, {}).update(per_resource)
    return out


def permissions_checksum(resource_types: list[str], resource_defaults: dict[str, dict]) -> str:
    """A short, stable digest of ONE app's whole policy.

    Useful for noticing that an installation's policy changed, but **not** for
    comparing two apps: each covers its own entities (`products` here,
    `declarations` there), so the digests are meant to differ. To compare apps,
    use `platform_definition_checksum`.

    Order-independent by construction, so formatting or reordering the table
    does not read as a change.
    """
    canonical = {
        "resource_types": sorted(resource_types),
        "defaults": {
            role: {rt: {k: bool(v) for k, v in sorted(perms.items())}
                   for rt, perms in sorted(per_resource.items())}
            for role, per_resource in sorted(resource_defaults.items())
        },
    }
    blob = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def platform_definition_checksum(
    role_names: list[str], resource_defaults: dict[str, dict]
) -> str:
    """The digest that is **comparable between apps** — §4.5's second safeguard.

    Covers only what is platform-wide: the role list, and the permissions on the
    resource types every app has (`organisations`, `rbac`, `subjects`). An app's
    own entities are excluded precisely because they differ by design, and a
    digest that always differed would tell a reader nothing.

    Two apps showing the same value agree on the platform definitions. Different
    values mean someone changed a role or a permission in one and not the other,
    which is exactly the drift manual syncing is expected to produce eventually.
    """
    shared = {
        role: {rt: perms for rt, perms in per_resource.items() if rt in COMMON_RESOURCE_TYPES}
        for role, per_resource in resource_defaults.items()
    }
    canonical = {
        "roles": sorted(role_names),
        "resource_types": sorted(COMMON_RESOURCE_TYPES),
        "defaults": {
            role: {rt: {k: bool(v) for k, v in sorted(perms.items())}
                   for rt, perms in sorted(per_resource.items())}
            for role, per_resource in sorted(shared.items())
        },
    }
    blob = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def resource_defaults_for(
    resource_types: list[str], defaults: dict[str, dict] | None = None
) -> dict[str, dict]:
    """The slice of a defaults table covering just these resource types.

    An app takes ``resource_defaults_for(APP_RESOURCE_TYPES)`` and layers its own
    entities on top, rather than retyping who may touch ``rbac``. Restating it
    per app is exactly the copying this round exists to stop — and the one that
    would matter most if it drifted, since it decides who may widen everyone
    else's access.
    """
    table = COMMON_RESOURCE_DEFAULTS if defaults is None else defaults
    wanted = set(resource_types)
    return {
        role: {rt: perms for rt, perms in per_resource.items() if rt in wanted}
        for role, per_resource in table.items()
    }
