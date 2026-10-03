import { createAuthorityCapabilities, type SyncCapabilities } from '@fieldnotes/sync';
import { snapshotAuthContext } from './auth-context';
import type { Connection } from './sync-hub';
import type {
  AuthorityIdentity,
  AuthorityOptions,
  AuthorityReadContext,
  AuthorityRoomDefinition,
} from './authority-types';

const printable = /^[\x21-\x7e]{1,128}$/;
const reservedAuthorityMutationKinds: readonly string[] = [
  'upsert',
  'remove',
  'clear',
  'layer-upsert',
  'layer-remove',
  'fog-meta',
  'fog-patch',
  'extension',
];

function validIdentity(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  if (Buffer.byteLength(value, 'utf8') > 1024) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function pinAuthorityDefinition(
  definition: AuthorityRoomDefinition,
): AuthorityRoomDefinition {
  if (
    !definition ||
    !printable.test(definition.id) ||
    !Array.isArray(definition.extensions) ||
    definition.extensions.length > 256 ||
    typeof definition.project !== 'function' ||
    typeof definition.canReadOwnerId !== 'function'
  )
    throw new TypeError('Invalid authority definition');
  const keys = new Set<string>();
  const kinds = new Set<string>();
  const extensions = definition.extensions.map((extension) => {
    const requirement = extension.requirement;
    if (
      !requirement ||
      !printable.test(requirement.key) ||
      !printable.test(requirement.pluginName) ||
      !Number.isSafeInteger(requirement.version) ||
      requirement.version < 1 ||
      typeof requirement.validate !== 'function' ||
      !Array.isArray(extension.extensionKinds) ||
      (extension.legacyKinds !== undefined && !Array.isArray(extension.legacyKinds)) ||
      typeof extension.prepare !== 'function' ||
      typeof extension.changes !== 'function' ||
      keys.has(requirement.key)
    )
      throw new TypeError('Invalid authority extension');
    keys.add(requirement.key);
    const extensionKinds = extension.extensionKinds.map((kind: string) => {
      if (!printable.test(kind) || reservedAuthorityMutationKinds.includes(kind) || kinds.has(kind))
        throw new TypeError('Invalid authority extension');
      kinds.add(kind);
      return kind;
    });
    const legacyKinds = extension.legacyKinds?.map((kind: 'fog-meta' | 'fog-patch') => {
      if ((kind !== 'fog-meta' && kind !== 'fog-patch') || kinds.has(kind))
        throw new TypeError('Invalid authority extension');
      kinds.add(kind);
      return kind;
    });
    return Object.freeze({
      ...extension,
      requirement: Object.freeze({ ...requirement }),
      extensionKinds: Object.freeze(extensionKinds),
      ...(legacyKinds === undefined ? {} : { legacyKinds: Object.freeze(legacyKinds) }),
    });
  });
  if (kinds.size > 256) throw new TypeError('Invalid authority extension');
  return Object.freeze({ ...definition, extensions: Object.freeze(extensions) });
}

export function authorityExtensionCapabilityKinds(
  extensions: readonly AuthorityRoomDefinition['extensions'][number][],
): readonly string[] {
  return Object.freeze(
    extensions
      .flatMap((extension) => [...extension.extensionKinds, ...(extension.legacyKinds ?? [])])
      .sort(),
  );
}

export function resolveAuthorityDefinition(
  options: AuthorityOptions,
  room: string,
): AuthorityRoomDefinition | null {
  const definition = options.resolveRoom(room);
  return definition === null ? null : pinAuthorityDefinition(definition);
}

export function resolveAuthorityIdentity(
  options: AuthorityOptions,
  connection: Connection,
): AuthorityIdentity {
  const claim = Object.freeze({
    id: connection.id,
    room: connection.room,
    userId: connection.userId,
    role: connection.role,
    authContext: snapshotAuthContext(connection.authContext),
    expiresAt: connection.expiresAt,
  });
  const result = options.resolveIdentity(claim);
  if (!result || !validIdentity(result.actorId) || !validIdentity(result.ownershipId))
    throw new TypeError('Invalid authority identity');
  return Object.freeze({ actorId: result.actorId, ownershipId: result.ownershipId });
}

export function authorityReadContext(
  connection: Connection,
  identity: AuthorityIdentity,
  definitionId: string,
  signal: AbortSignal,
  deadlineAt = Math.min(Date.now() + 5000, connection.expiresAt ?? Infinity),
): AuthorityReadContext {
  const duration = Math.max(0, deadlineAt - Date.now());
  const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(duration)]);
  return Object.freeze({
    room: connection.room,
    connectionId: connection.id,
    actorId: identity.actorId,
    ownershipId: identity.ownershipId,
    definitionId,
    ...(connection.userId === undefined ? {} : { userId: connection.userId }),
    ...(connection.role === undefined ? {} : { role: connection.role }),
    ...(connection.authContext === undefined ? {} : { authContext: connection.authContext }),
    ...(connection.expiresAt === undefined ? {} : { expiresAt: connection.expiresAt }),
    deadlineAt,
    signal: operationSignal,
  });
}

export function authorityCapabilitiesMatch(
  capabilities: SyncCapabilities,
  definition: AuthorityRoomDefinition,
): boolean {
  if (capabilities.authority !== 1) return false;
  const expected = createAuthorityCapabilities(
    authorityExtensionCapabilityKinds(definition.extensions),
    definition.extensions.map((extension) => extension.requirement),
  );
  return (
    JSON.stringify(capabilities.authorityExtensions ?? []) ===
      JSON.stringify(expected.authorityExtensions ?? []) &&
    JSON.stringify(capabilities.extensionKinds) === JSON.stringify(expected.extensionKinds)
  );
}
