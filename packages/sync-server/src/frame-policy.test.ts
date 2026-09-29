import { expectTypeOf, it } from 'vitest';
import type {
  AuthorizeFrame,
  CreateSyncServerOptions,
  FrameAuthorizationContext,
  FramePolicy,
  MessageDispatchOptions,
  ServerOpContext,
} from './index';

it('exports the guarded frame and dispatch contracts', () => {
  expectTypeOf<CreateSyncServerOptions['framePolicy']>().toEqualTypeOf<FramePolicy | undefined>();
  expectTypeOf<FramePolicy['authorize']>().toEqualTypeOf<AuthorizeFrame | undefined>();
  expectTypeOf<FrameAuthorizationContext['message']>().toEqualTypeOf<string>();
  expectTypeOf<FrameAuthorizationContext['direction']>().toEqualTypeOf<'inbound' | 'outbound'>();
  expectTypeOf<FrameAuthorizationContext['signal']>().toEqualTypeOf<AbortSignal>();
  expectTypeOf<MessageDispatchOptions['beforeProcess']>().toEqualTypeOf<
    () => boolean | Promise<boolean>
  >();
  expectTypeOf<ServerOpContext['deadlineAt']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<ServerOpContext['signal']>().toEqualTypeOf<AbortSignal | undefined>();
});
