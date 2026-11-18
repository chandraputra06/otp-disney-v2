import { getAdminUser } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createOtpRepository } from '@/lib/otp-repository';
import { fetchOtpForPhone } from '@/lib/otp-service';
import { fetchLatestDisneyOtp } from '@/lib/google';
import { handleOtpRequest } from '@/lib/otp-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  return handleOtpRequest(request, {
    authenticate: getAdminUser,
    fetchOtp: (phone, previousMessageId) => fetchOtpForPhone(phone, {
      previousMessageId, repo: createOtpRepository(createSupabaseAdmin()), readGmail: fetchLatestDisneyOtp,
    }),
  });
}
