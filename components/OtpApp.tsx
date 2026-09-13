'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatWita, witaTimeShort } from '@/lib/time';

const REFRESH_SECONDS = 15; // auto-refresh; dipasangkan dgn cache 12 dtk di backend

type OtpStatus = 'success' | 'cooldown' | 'not_found' | 'parse_failed' | 'fetch_error';

interface OtpResult {
  status: OtpStatus;
  status_label: string;
  phone_number: string;
  message: string;
  otp_code: string | null;
  received_at: string | null;
  last_otp_code: string | null;
  last_received_at: string | null;
}

const chipStyle = (s: OtpStatus): { bg: string; fg: string; icon: string } => {
  switch (s) {
    case 'success':   return { bg: '#dcfce7', fg: '#15803d', icon: 'fa-circle-check' };
    case 'cooldown':  return { bg: '#dbeafe', fg: '#1d4ed8', icon: 'fa-clock' };
    case 'not_found': return { bg: '#fef9c3', fg: '#a16207', icon: 'fa-envelope' };
    case 'parse_failed': return { bg: '#ffedd5', fg: '#c2410c', icon: 'fa-triangle-exclamation' };
    default:          return { bg: '#fee2e2', fg: '#b91c1c', icon: 'fa-circle-xmark' };
  }
};

export default function OtpApp() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OtpResult | null>(null);
  const [secs, setSecs] = useState(REFRESH_SECONDS);
  const [running, setRunning] = useState(true);
  const [toast, setToast] = useState(false);

  const lastPhone = useRef('');
  const runningRef = useRef(true);
  useEffect(() => { runningRef.current = running; }, [running]);

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 1300);
  };

  useEffect(() => {
    if (!loading) {
      setLoadingProgress(0);
      return;
    }

    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(Math.round((elapsed / 2800) * 100), 96);
      setLoadingProgress(progress);
    }, 40);

    return () => clearInterval(id);
  }, [loading]);

  const copyCode = (code: string | null) => {
    if (!code) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(showToast).catch(showToast);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta); showToast();
    }
  };

  const fetchOtp = useCallback(async (num: string, silent = false) => {
    if (!num) return;
    lastPhone.current = num;
    setError(null);
    if (!silent) {
      setLoading(true);
      setLoadingProgress(0);
    }
    try {
      const res = await fetch('/api/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone_number: num }),
      });
      if (res.status === 422) {
        const j = await res.json();
        setError(j.message || 'Nomor tidak valid.');
        return;
      }
      if (res.status === 429) {
        setError('Terlalu sering. Tunggu sebentar lalu coba lagi.');
        return;
      }
      if (!res.ok) throw new Error('http ' + res.status);
      const data: OtpResult = await res.json();
      setResult(data);
      setSecs(REFRESH_SECONDS);
    } catch {
      setError('Gagal terhubung ke server. Coba lagi.');
    } finally {
      if (!silent) {
        setLoading(false);
        setLoadingProgress(0);
      }
    }
  }, []);

  // countdown auto-refresh
  useEffect(() => {
    if (!result) return;
    const id = setInterval(() => {
      if (!runningRef.current) return;
      setSecs((s) => {
        if (s <= 1) {
          if (lastPhone.current) void fetchOtp(lastPhone.current, true);
          return REFRESH_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [result, fetchOtp]);

  const code = result?.otp_code || result?.last_otp_code || '—';
  const isFallback = !!result && !result.otp_code && !!result.last_otp_code;
  const timeIso = result?.received_at || result?.last_received_at || null;
  const chip = result ? chipStyle(result.status) : null;

  return (
    <main className="otp-wrap">
      <div className="otp-container">
        <div className="otp-head">
          <div className="otp-brand">
            <div className="otp-logo-wrap">
              <Image src="/logo-orinimo.png" alt="Orinimo logo" width={72} height={72} priority />
            </div>
          </div>
          <span className="otp-pill"><span className="dot" />Disney OTP · Orinimo</span>
          <h1>Cek OTP Disney</h1>
          <p>Masukkan nomor handphone untuk mengambil OTP terbaru.</p>
        </div>

        <div className={`otp-card ${loading ? 'is-loading' : ''}`}>
          <p className="field-label">Nomor handphone</p>
          <div className="otp-inrow">
            <input
              className="field-input"
              inputMode="numeric"
              placeholder="Contoh: 886529367891"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchOtp(phone.trim())}
              disabled={loading}
            />
            <button className="btn-primary" onClick={() => fetchOtp(phone.trim())} disabled={loading}>
              <i className={loading ? 'fa-solid fa-spinner spin' : 'fa-solid fa-magnifying-glass'} />
              {loading ? 'Memproses…' : 'Ambil OTP'}
            </button>
          </div>
          {loading && (
            <div className="otp-loading-cover" role="status" aria-live="polite" aria-busy="true">
              <div className="otp-loading-stage" style={{ ['--fill' as string]: `${loadingProgress}%` }}>
                <div className="loading-fill" />
                <div className="loading-ring" />
                <div className="loading-logo-wrap">
                  <Image src="/logo-orinimo.png" alt="Orinimo logo" width={72} height={72} priority />
                </div>
              </div>
            </div>
          )}
          {error && <p className="field-err">{error}</p>}
        </div>

        {result && chip && (
          <div className={`otp-panel ${loading ? 'is-loading-overlay' : ''}`}>
            <div className="otp-toprow">
              <span className="otp-chip" style={{ background: chip.bg, color: chip.fg }}>
                <i className={`fa-solid ${chip.icon}`} />{result.status_label}
              </span>
              {timeIso && (
                <span className="otp-fresh">
                  <i className="fa-solid fa-circle" />Diterima {witaTimeShort(timeIso)} WITA
                </span>
              )}
            </div>

            <button className="otp-codebox" onClick={() => copyCode(code === '—' ? null : code)}>
              <p className="cap">{isFallback ? 'OTP TERAKHIR · KETUK UNTUK SALIN' : 'KODE OTP · KETUK UNTUK SALIN'}</p>
              <p className="code">{code}</p>
              <span className="hint"><i className="fa-solid fa-copy" />Salin kode</span>
            </button>

            <div className="otp-timerow">
              <span className="lbl"><i className="fa-solid fa-phone" /> {result.phone_number}</span>
              <span className="val">{timeIso ? `${formatWita(timeIso)} WITA` : '—'}</span>
            </div>

            {result.message && <p className="otp-msg">{result.message}</p>}

            <div className="otp-refreshrow">
              <div className="otp-bar-track">
                <div className="otp-bar" style={{ width: `${(secs / REFRESH_SECONDS) * 100}%` }} />
              </div>
              <span className="otp-count">{running ? `Segarkan ${secs} dtk` : 'Dijeda'}</span>
              <button className="otp-toggle" aria-label="Jeda auto-refresh" onClick={() => setRunning((r) => !r)}>
                <i className={`fa-solid ${running ? 'fa-pause' : 'fa-play'}`} />
              </button>
            </div>

            {loading && (
              <div className="otp-panel-overlay" role="status" aria-live="polite" aria-busy="true">
                <div className="otp-loading-stage" style={{ ['--fill' as string]: `${loadingProgress}%` }}>
                  <div className="loading-fill" />
                  <div className="loading-ring" />
                  <div className="loading-logo-wrap">
                    <Image src="/logo-orinimo.png" alt="Orinimo logo" width={72} height={72} priority />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && (
          <div className="otp-empty">
            <div className="ic"><i className="fa-solid fa-shield-halved" /></div>
            <h3>Belum ada hasil OTP</h3>
            <p>Masukkan nomor handphone lalu tekan Ambil OTP.</p>
          </div>
        )}
      </div>

      <div className={`otp-toast ${toast ? 'show' : ''}`}>
        <i className="fa-solid fa-check" /> Kode tersalin
      </div>
    </main>
  );
}
