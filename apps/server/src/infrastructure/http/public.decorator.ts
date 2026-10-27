/**
 * Route-level authentication exemption. Marking a controller class or a
 * handler @Public() tells the auth domain's SessionGuard to skip the
 * session check; every unmarked Nest route requires a valid session once
 * authentication is enabled. Lives in the neutral HTTP contract area (not
 * the auth domain) so any domain can opt out without a cross-domain import.
 */

import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "toby:is-public";

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
