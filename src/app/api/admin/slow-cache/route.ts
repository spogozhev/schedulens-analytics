import { NextResponse } from 'next/server'
import { clearSlowCache, slowCacheSize } from '@/lib/slow-cache'

export const dynamic = 'force-dynamic'

/**
 * Drop the server's in-process slow-query cache (src/lib/slow-cache.ts).
 * Called automatically by the import scripts after the dataset changes;
 * also usable manually, e.g.:
 *   curl -X DELETE http://localhost:3000/api/admin/slow-cache
 *
 * Optional auth: when SLOW_CACHE_TOKEN is set, the request must carry the
 * same value in the x-cache-token header.
 */

/** Number of cached entries currently held (quick health/stats peek). */
export async function GET(request: Request) {
  const expected = process.env.SLOW_CACHE_TOKEN
  if (expected && request.headers.get('x-cache-token') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ entries: slowCacheSize() })
}

export async function DELETE(request: Request) {
  const expected = process.env.SLOW_CACHE_TOKEN
  if (expected && request.headers.get('x-cache-token') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dropped = clearSlowCache()
  return NextResponse.json({ dropped })
}
