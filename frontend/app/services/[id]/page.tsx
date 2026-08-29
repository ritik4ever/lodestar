'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ServiceEntry } from '@/lib/types';
import { fetchServiceById } from '@/lib/contract';
import ServiceCard from '@/components/ServiceCard';
import { serviceDetailStrings } from './strings';

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [service, setService] = useState<ServiceEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      setError(serviceDetailStrings.error.invalidServiceId);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setService(null);

    try {
      const data = await fetchServiceById(numericId);
      setService(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(serviceDetailStrings.error.failedToLoadService);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="card p-8 h-64 animate-pulse bg-border/40 mb-6" />
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <p className="text-error text-sm mb-4">{error ?? serviceDetailStrings.error.serviceNotFound}</p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Link href="/registry" className="btn-secondary px-5 py-2.5 text-sm">
            {serviceDetailStrings.errorActions.backToRegistry}
          </Link>
          <button
            onClick={() => router.refresh()}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            {serviceDetailStrings.errorActions.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link
        href="/registry"
        className="text-sm text-secondary hover:text-primary transition-colors mb-8 inline-block"
      >
        {serviceDetailStrings.navigation.allServices}
      </Link>

      <ServiceCard service={service} />
    </div>
  );
}

