import { notFound } from 'next/navigation';
import OtpApp from '@/components/OtpApp';

export const dynamic = 'force-dynamic';
export default function DemoPage() {
  // Visual QA only. This route is absent in production and never bypasses API auth.
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL) notFound();
  return <OtpApp demo />;
}
