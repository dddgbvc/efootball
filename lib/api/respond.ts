import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AuthorizationError } from '@/lib/permissions';

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  VALIDATION_FAILED: 422,
};

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(code: string, message?: string, status = 400) {
  return NextResponse.json({ ok: false, error: code, message: message ?? code }, { status });
}

/**
 * Single error boundary for every route handler: domain errors keep their
 * meaning, validation failures come back as field messages, and anything
 * unexpected becomes a 500 without leaking internals to the client.
 */
export function handleRouteError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return fail(error.code, error.message, STATUS_BY_CODE[error.code] ?? 400);
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: 'VALIDATION_FAILED',
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 422 },
    );
  }

  console.error('[route-error]', error);

  // The one internal failure worth naming: the server could not reach the
  // database to check who the caller is. Left generic, it reads as "something
  // broke"; named, it points straight at the missing service-role key.
  if (error instanceof Error && error.message.startsWith('PERMISSION_LOOKUP_FAILED')) {
    return fail(
      'PERMISSION_LOOKUP_FAILED',
      'تعذّر التحقق من صلاحيتك — إعداد الخادم ناقص. راجع SUPABASE_SERVICE_ROLE_KEY.',
      500,
    );
  }

  return fail('INTERNAL_ERROR', 'حدث خطأ غير متوقع', 500);
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AuthorizationError('VALIDATION_FAILED', 'صيغة الطلب غير صالحة');
  }
  return schema.parse(raw);
}
