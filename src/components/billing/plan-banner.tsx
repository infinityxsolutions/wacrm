'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Clock, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { trialDaysLeft } from '@/lib/billing/entitlements';
import { useBilling } from './use-billing';

const WARN_DAYS = 3;

/**
 * Dashboard-wide notice: the account is read-only (plan ended or
 * suspended), or the free trial ends within a few days. Renders nothing
 * otherwise, and nothing while loading or if billing info is unavailable.
 */
export function PlanBanner() {
  const t = useTranslations('BillingUi');
  const { entitlements } = useBilling();
  if (!entitlements || entitlements.is_comped) return null;

  if (!entitlements.writable) {
    return (
      <Alert variant="destructive" className="mb-4">
        <TriangleAlert />
        <AlertTitle>
          {entitlements.status === 'suspended' ? t('suspendedTitle') : t('readOnlyTitle')}
        </AlertTitle>
        <AlertDescription>
          {t('readOnlyDesc')}{' '}
          <Link href="/settings?tab=billing" className="font-medium underline">
            {t('openBilling')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const days = trialDaysLeft(entitlements);
  if (entitlements.status === 'trialing' && days <= WARN_DAYS) {
    return (
      <Alert className="mb-4">
        <Clock />
        <AlertTitle>{t('trialEndingTitle', { days })}</AlertTitle>
        <AlertDescription>
          {t('trialEndingDesc')}{' '}
          <Link href="/settings?tab=billing" className="font-medium underline">
            {t('openBilling')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
