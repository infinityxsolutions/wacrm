import { NextResponse } from 'next/server'
import { getT } from '@/lib/i18n/translate'
import { EmailError, EmailNotConfiguredError } from './email.types'

const t = getT('Api')

/** Map an email failure to an HTTP response with a stable `code`; null for anything else. */
export function emailErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof EmailError) {
    return NextResponse.json({ error: t(`email.errors.${err.code}`), code: err.code }, { status: err.status })
  }
  if (err instanceof EmailNotConfiguredError) {
    return NextResponse.json({ error: t('email.errors.notConfigured'), code: 'email_not_configured' }, { status: 503 })
  }
  return null
}
