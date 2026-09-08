import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { ensureBootstrapAdmin } from './bootstrapAdmin';
import {
  authenticateCompanion,
  type CompanionIdentity,
  supabaseTokenLookup,
  supabaseTokenTouch,
} from './companionAuth';
import { ServerEnvError } from './env';
import { jsonError, parseJsonBody } from './http';
import { getServiceClient, type ServiceClient } from './supabase';

/**
 * Everything `/api/companion/*` has in common: the service-role client, the bearer token check
 * and the zod parse of the body, in that order. A helper rather than Next middleware so it can
 * be unit tested and so the identity is a typed argument instead of a header the handler has
 * to re-read.
 *
 * Auth runs before the body is parsed: an unauthenticated caller learns nothing about the
 * shape we expect.
 */

export interface CompanionContext {
  client: ServiceClient;
  /** Who the token says this is. Never who the payload claims to be. */
  identity: CompanionIdentity;
  /**
   * The request itself, for the handlers that need its origin (M3.1: the tonight-page link in
   * a Discord embed, when `NEXT_PUBLIC_SITE_URL` is unset). Nothing about identity is ever
   * read from it — the token decides that, above.
   */
  request: Request;
}

export type CompanionHandler<T> = (input: T, context: CompanionContext) => Promise<NextResponse>;

export interface CompanionRouteDeps {
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: () => ServiceClient;
}

export function withCompanionAuth<S extends z.ZodType>(
  schema: S,
  handle: CompanionHandler<z.output<S>>,
  deps: CompanionRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  return withCompanionIdentity(async (request, context) => {
    const body = await parseJsonBody(request, schema);
    if (!body.ok) {
      return body.response;
    }
    return handle(body.data, context);
  }, deps);
}

export type CompanionRequestHandler = (request: Request, context: CompanionContext) => Promise<NextResponse>;

/**
 * The same thing without a body: the client, the bootstrap admin and the bearer token check,
 * then the handler. `GET /api/companion/me` is the only user today — a route that reads
 * nothing but the token cannot have a request schema to parse.
 */
export function withCompanionIdentity(
  handle: CompanionRequestHandler,
  deps: CompanionRouteDeps = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    let client: ServiceClient;
    try {
      client = deps.getClient ? deps.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`companion route: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      await ensureBootstrapAdmin(client);

      const auth = await authenticateCompanion({
        authorization: request.headers.get('authorization'),
        lookup: supabaseTokenLookup(client),
        touch: supabaseTokenTouch(client),
      });
      if (!auth.ok) {
        return jsonError(auth.status, auth.error);
      }

      return await handle(request, { client, identity: auth.identity, request });
    } catch (error) {
      // A thrown error here is our bug or the database being down. Never leak the message.
      console.error('companion route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
