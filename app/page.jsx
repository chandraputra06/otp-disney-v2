import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/auth';
import OtpApp from '@/components/OtpApp';

export const dynamic = 'force-dynamic';
export default async function Home() {
  if (!await getAdminUser()) redirect('/login');
  return <OtpApp />;
}
