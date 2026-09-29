import { expect, it } from 'vitest';
import type {
  AuthorityMutation,
  AuthorityFrame,
  AuthorityCursor,
  AuthorityCheckpointManifest,
} from './index';
import { parseAuthorityFrame, classifyAuthorityCursor } from './index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ReadonlyKey<T, K extends keyof T> = Equal<Pick<T, K>, Readonly<Pick<T, K>>>;
type Kind = AuthorityMutation['kind'];
const allowedKinds: Equal<
  Kind,
  | 'upsert'
  | 'remove'
  | 'clear'
  | 'layer-upsert'
  | 'layer-remove'
  | 'fog-meta'
  | 'fog-patch'
  | 'extension'
> = true;
const cursorReadonly: ReadonlyKey<AuthorityCursor, 'revision'> = true;
const manifestReadonly: ReadonlyKey<AuthorityCheckpointManifest, 'extensions'> = true;
const frameReadonly: ReadonlyKey<Extract<AuthorityFrame, { kind: 'changes' }>, 'mutations'> = true;
const tilesReadonly: Equal<
  Extract<AuthorityMutation, { kind: 'fog-patch' }>['tiles'],
  readonly Extract<AuthorityMutation, { kind: 'fog-patch' }>['tiles'][number][]
> = true;
const nestedReadonly: ReadonlyKey<
  Extract<AuthorityMutation, { kind: 'upsert' }>['element']['position'],
  'x'
> = true;

it('exports the intentional readonly authority surface', () => {
  expect([
    allowedKinds,
    cursorReadonly,
    manifestReadonly,
    frameReadonly,
    tilesReadonly,
    nestedReadonly,
  ]).toEqual(Array(6).fill(true));
  expect(
    parseAuthorityFrame(
      '{"protocol":"authority:1","kind":"upgrade-required","required":"authority:1"}',
    ),
  ).not.toBeNull();
  expect(
    classifyAuthorityCursor(
      { generation: 'g', streamId: 's', revision: 0 },
      { generation: 'g', streamId: 's', revision: 1 },
    ),
  ).toBe('next');
});
