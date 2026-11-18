export function isAdminUser(user, env = process.env) {
  if (!user?.id) return false;
  const emails = (env.ADMIN_EMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return user.app_metadata?.role === 'admin' || Boolean(user.email && emails.includes(user.email.toLowerCase()));
}
