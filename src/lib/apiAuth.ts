import crypto from 'crypto';
import { NextResponse } from 'next/server';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function configuredApiKeys() {
  return [
    process.env.DRIFT_API_KEY,
    process.env.DRIFT_API_KEYS,
  ]
    .filter(Boolean)
    .flatMap((value) => value!.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function isApiAuthRequired(apiKeys: string[]) {
  return apiKeys.length > 0 || process.env.DRIFT_API_AUTH === 'required';
}

function extractApiKey(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim();
  }

  return request.headers.get('x-api-key')?.trim() || null;
}

function tokensMatch(candidate: string, expected: string) {
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

export function requireApiAuth(request: Request) {
  const apiKeys = configuredApiKeys();
  if (!isApiAuthRequired(apiKeys)) {
    return null;
  }

  if (apiKeys.length === 0) {
    return NextResponse.json(
      { error: 'API authentication is required, but no DRIFT_API_KEY is configured.' },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  const apiKey = extractApiKey(request);
  if (apiKey && apiKeys.some((expected) => tokensMatch(apiKey, expected))) {
    return null;
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: {
        ...NO_STORE_HEADERS,
        'WWW-Authenticate': 'Bearer realm="DRIFT API"',
      },
    }
  );
}
