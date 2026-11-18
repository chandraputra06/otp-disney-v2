'use client';
import { useFormStatus } from 'react-dom';
export default function SaveButton({ children = 'Simpan' }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="primary-button" disabled={pending}>{pending ? 'Menyimpan…' : children}</button>;
}
