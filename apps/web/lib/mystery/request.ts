import { mysteryVisitorIdSchema } from '@customs/db/schemas';
import { isVisitorId, MYSTERY_VISITOR_COOKIE } from './visitor';

export function visitorFromRequest(request: Request, bodyId?: string): string | null {
  const cookie = cookieValue(request.headers.get('cookie'), MYSTERY_VISITOR_COOKIE);
  if (isVisitorId(cookie)) return cookie;
  const query = new URL(request.url).searchParams.get('anonymousVisitorId');
  const candidate = bodyId ?? query;
  const parsed = mysteryVisitorIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return rest.join('=');
  }
  return null;
}

export function withMysteryCookie(response: Response, visitorId: string | null): Response {
  if (visitorId === null || !isVisitorId(visitorId)) return response;
  response.headers.append(
    'Set-Cookie',
    `${MYSTERY_VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=${60 * 60 * 24 * 400}; SameSite=Lax; HttpOnly`,
  );
  return response;
}
