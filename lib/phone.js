export function phoneVariants(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[\d\s()-]+$/.test(value.trim())) return [];
  const digits = value.replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits)) return [];
  const variants = [digits];
  if (digits.startsWith('08')) variants.push('62' + digits.slice(1));
  if (digits.startsWith('628')) variants.push('0' + digits.slice(2));
  return [...new Set(variants)];
}

export function canonicalPhone(value) {
  const variants = phoneVariants(value);
  if (!variants.length) return null;
  return variants.find((phone) => phone.startsWith('628')) || variants[0];
}
