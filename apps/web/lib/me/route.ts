import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { redirectBack } from '../adminRoute';
import { safeNextPath } from '../authNext';
import { ServerEnvError } from '../env';
import { jsonError, jsonOk, parseFormOrJsonBody } from '../http';
import { getServiceClient, type ServiceClient } from '../supabase';
import { requestCookieJar } from '../supabaseAuth';
import { type MeAuthResult, type MeIdentity, resolveMe } from './identity';

/**
 * Everything `/api/me/*` has in common, mirroring `lib/adminRoute.ts` step for step: the
 * service-role client, the session, then the zod parse — in that order, so an unauthenticated
 * caller learns nothing about the payload we expect.
 *
 * The one difference is who gets in. This gate resolves the session and **does not require a
 * linked player**: `/api/me/link` is the route for exactly that visitor. Each handler decides
 * for itself whether `context.me.player` being `null` is a refusal, and `/api/me/role-tonight`
 * says so in a sentence a friend can act on.
 *
 * Successes and refusals are the JSON envelope for the page's `fetch` (M3.20: the tonight page
 * never navigates) and a 303 back to the page for a plain HTML form, which is the degraded
 * no-JavaScript path and the only reason `redirectTo` exists.
 *
 * Cross-site forgery: the session cookies `@supabase/ssr` writes are `SameSite=Lax`, which a
 * browser does not attach to a cross-site POST, so a form on someone else's page arrives here
 * with no session and gets a 401 — the same reasoning as `/api/admin/*`.
 */

export interface MeContext {
  client: ServiceClient;
  /** Who the session says this is. Never a puuid out of the request body. */
  me: MeIdentity;
  request: Request;
  /** True when the body came from an HTML form rather than JSON. */
  form: boolean;
  /** Where a form post is sent back to: the body's `redirectTo` when it is one of ours. */
  redirectTo: string;
  respond<S extends z.ZodType>(schema: S, value: z.input<S>, notice: string): NextResponse;
  fail(status: number, error: string): NextResponse;
}

export type MeHandler<T> = (input: T, context: MeContext) => Promise<NextResponse>;

export interface MeRouteOptions {
  /** Where a browser form post lands when the body names nothing. The tonight page. */
  redirectTo?: string;
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: (() => ServiceClient) | undefined;
  /** Injection point for tests: the whole session step. */
  authorize?: ((request: Request, client: ServiceClient) => Promise<MeAuthResult>) | undefined;
}

/** A body that may carry the no-JavaScript path's destination. */
interface MaybeRedirect {
  redirectTo?: string | undefined;
}

export function withViewerAuth<S extends z.ZodType>(
  schema: S,
  handle: MeHandler<z.output<S>>,
  options: MeRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const fallback = options.redirectTo ?? '/';

  return async (request) => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`me route: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      const auth = options.authorize
        ? await options.authorize(request, client)
        : await resolveMe(requestCookieJar(request), client);
      if (!auth.ok) return jsonError(auth.status, auth.error);

      const body = await parseFormOrJsonBody(request, schema);
      if (!body.ok) {
        if (body.form) return redirectBack(request, fallback, { error: 'that form was not valid' });
        return body.response;
      }

      // Re-validated rather than trusted from the body: `safeNextPath` is the same check the
      // sign-in round trip uses, and a body must never be able to redirect a friend off-site.
      const redirectTo = safeNextPath((body.data as MaybeRedirect).redirectTo) ?? fallback;

      const context: MeContext = {
        client,
        me: auth.me,
        request,
        form: body.form,
        redirectTo,
        respond: (responseSchema, value, notice) =>
          body.form ? redirectBack(request, redirectTo, { notice }) : jsonOk(responseSchema, value),
        fail: (status, error) =>
          body.form ? redirectBack(request, redirectTo, { error }) : jsonError(status, error),
      };

      return await handle(body.data, context);
    } catch (error) {
      // Our bug or the database being down. Never leak the message.
      console.error('me route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
