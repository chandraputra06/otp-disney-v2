'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(null);
    setLoading(true);
    const supabase = createSupabaseBrowser(); // dibuat saat diklik, bukan saat build
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErr('Email atau password salah.');
      return;
    }
    router.push('/admin');
    router.refresh();
  };

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Masuk Admin</h1>
        <p className="auth-sub">Orinimo · Disney OTP</p>

        <label className="field-label">Email</label>
        <input
          className="field-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <label className="field-label" style={{ marginTop: 12 }}>Password</label>
        <input
          className="field-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        {err && <p className="field-err">{err}</p>}

        <button className="btn-primary" style={{ width: '100%', marginTop: 16, height: 44 }} onClick={submit} disabled={loading}>
          {loading ? 'Memproses…' : 'Masuk'}
        </button>
      </div>
    </main>
  );
}