'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { getListing } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { ListingDetail } from '@/components/ListingDetail';

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id));
  const { data, error, isLoading, mutate } = useSWR(['listing', id], () => getListing(id), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  return (
    <div className="flex flex-col gap-5">
      <Link href="/listings" className="w-fit text-sm text-indigo-600 hover:underline">
        ← Back to listings
      </Link>

      {isLoading && <p className="animate-pulse text-sm text-slate-400">Loading…</p>}

      {error && (
        <div data-testid="error-state" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error instanceof ApiError && error.status === 404
            ? 'This listing no longer exists.'
            : error instanceof Error
              ? error.message
              : 'Could not load this listing.'}
        </div>
      )}

      {data && <ListingDetail detail={data} mutate={mutate} />}
    </div>
  );
}
