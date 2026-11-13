
'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  formatWita,
  witaTimeShort,
} from '@/lib/time';

import LoadingScreen from './LoadingScreen';

const REFRESH_SECONDS = 5;

type OtpStatus =
  | 'success'
  | 'unchanged'
  | 'cooldown'
  | 'not_found'
  | 'parse_failed'
  | 'fetch_error';

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

function chipStyle(status: OtpStatus) {
  switch (status) {
    case 'success':
      return {
        bg: '#dcfce7',
        fg: '#15803d',
        icon: 'fa-circle-check',
      };

    case 'unchanged':
      return {
        bg: '#f3f4f6',
        fg: '#4b5563',
        icon: 'fa-clock',
      };

    case 'cooldown':
      return {
        bg: '#dbeafe',
        fg: '#1d4ed8',
        icon: 'fa-clock',
      };

    case 'not_found':
      return {
        bg: '#fef9c3',
        fg: '#a16207',
        icon: 'fa-envelope',
      };

    case 'parse_failed':
      return {
        bg: '#ffedd5',
        fg: '#c2410c',
        icon: 'fa-triangle-exclamation',
      };

    default:
      return {
        bg: '#fee2e2',
        fg: '#b91c1c',
        icon: 'fa-circle-xmark',
      };
  }
}

export default function OtpApp() {
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(
    null
  );

  const [result, setResult] = useState<OtpResult | null>(
    null
  );

  const [secs, setSecs] = useState(REFRESH_SECONDS);
  const [running, setRunning] = useState(true);
  const [toast, setToast] = useState(false);

  const lastPhone = useRef('');
  const inFlight = useRef(false);
  const countdownRef = useRef(REFRESH_SECONDS);

  const showToast = () => {
    setToast(true);

    window.setTimeout(() => {
      setToast(false);
    }, 1600);
  };

  const copyCode = async (code: string | null) => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      showToast();
    } catch {
      setError(
        'Gagal menyalin kode. Silakan salin secara manual.'
      );
    }
  };

  const fetchOtp = useCallback(
    async (input: string, silent = false) => {
      const number = input.replace(/\D+/g, '');

      if (!/^[0-9]{10,15}$/.test(number)) {
        if (!silent) {
          setError(
            'Nomor handphone harus berisi 10 sampai 15 digit.'
          );
        }
        return;
      }

      // Jangan menjalankan dua request bersamaan.
      if (inFlight.current) return;

      inFlight.current = true;
      lastPhone.current = number;

      setError(null);

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setResult(null);
        setRunning(true);
      }

      try {
        const response = await fetch('/api/otp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          cache: 'no-store',
          body: JSON.stringify({
            phone_number: number,
          }),
        });

        const data = await response
          .json()
          .catch(() => null);

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              'Sesi login diperlukan. Silakan masuk melalui halaman login.'
            );
          }

          throw new Error(
            data?.message ??
              `Permintaan gagal (HTTP ${response.status}).`
          );
        }

        setResult(data as OtpResult);

        // Reset countdown setelah respons.
        countdownRef.current = REFRESH_SECONDS;
        setSecs(REFRESH_SECONDS);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Gagal menghubungi server.'
        );
      } finally {
        inFlight.current = false;

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    []
  );

  // Countdown otomatis.
  useEffect(() => {
    if (!result || !running) return;

    const interval = window.setInterval(() => {
      // Hindari polling saat tab tidak aktif.
      if (document.hidden) return;

      if (countdownRef.current <= 1) {
        countdownRef.current = REFRESH_SECONDS;
        setSecs(REFRESH_SECONDS);

        if (lastPhone.current) {
          void fetchOtp(lastPhone.current, true);
        }
      } else {
        countdownRef.current -= 1;
        setSecs(countdownRef.current);
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [result, running, fetchOtp]);

  // Kode yang sedang ditampilkan.
  const code =
    result?.otp_code ??
    result?.last_otp_code ??
    null;

  const isFallback =
    Boolean(result) &&
    !result?.otp_code &&
    Boolean(result?.last_otp_code);

  const timeIso = isFallback
    ? result?.last_received_at
    : result?.received_at;

  const chip = result
    ? chipStyle(result.status)
    : null;

  return (
    <main className="otp-wrap">
      <div className="otp-container">
        <div className="otp-head">
          <span className="otp-pill">
            <span className="dot" />
            Disney OTP · Orinimo
          </span>

          <h1>Cek OTP Disney</h1>

          <p>
            Masukkan nomor handphone untuk mengambil
            OTP terbaru.
          </p>
        </div>

        <div className="otp-card">
          <p className="field-label">
            Nomor handphone
          </p>

          <div className="otp-inrow">
            <input
              className="field-input"
              inputMode="numeric"
              placeholder="Masukkan nomor handphone"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void fetchOtp(phone.trim());
                }
              }}
            />

            <button
              className="btn-primary"
              disabled={loading || refreshing}
              onClick={() => {
                void fetchOtp(phone.trim());
              }}
            >
              <i
                className={
                  loading
                    ? 'fa-solid fa-spinner spin'
                    : 'fa-solid fa-magnifying-glass'
                }
              />

              {loading
                ? 'Memproses...'
                : 'Ambil OTP'}
            </button>
          </div>

          {error && (
            <p className="field-err">
              {error}
            </p>
          )}

          {refreshing && (
            <span className="otp-refreshing">
              <i className="fa-solid fa-spinner spin" />
              Memeriksa email terbaru...
            </span>
          )}
        </div>

        {result && chip && (
          <div className="otp-panel">
            <div className="otp-toprow">
              <span
                className="otp-chip"
                style={{
                  background: chip.bg,
                  color: chip.fg,
                }}
              >
                <i
                  className={`fa-solid ${chip.icon}`}
                />

                {result.status_label}
              </span>

              {timeIso && (
                <span className="otp-fresh">
                  <i className="fa-solid fa-circle" />

                  Diterima{' '}
                  {witaTimeShort(timeIso)} WITA
                </span>
              )}
            </div>

            <button
              className="otp-codebox"
              disabled={!code}
              onClick={() => {
                void copyCode(code);
              }}
            >
              <p className="cap">
                {isFallback
                  ? 'OTP TERAKHIR · KETUK UNTUK SALIN'
                  : 'KODE OTP · KETUK UNTUK SALIN'}
              </p>

              <p className="code">
                {code ?? '—'}
              </p>

              <span className="hint">
                <i className="fa-solid fa-copy" />
                {code ? 'Salin kode' : 'Tidak ada kode'}
              </span>
            </button>

            <div className="otp-timerow">
              <span className="lbl">
                <i className="fa-solid fa-phone" />
                {result.phone_number}
              </span>

              <span className="val">
                {timeIso
                  ? `${formatWita(timeIso)} WITA`
                  : '—'}
              </span>
            </div>

            {result.message && (
              <p className="otp-msg">
                {result.message}
              </p>
            )}

            <div className="otp-refreshrow">
              <div className="otp-bar-track">
                <div
                  className="otp-bar"
                  style={{
                    width: `${
                      (secs / REFRESH_SECONDS) * 100
                    }%`,
                  }}
                />
              </div>

              <span className="otp-count">
                {running
                  ? `Segarkan ${secs} dtk`
                  : 'Dijeda'}
              </span>

              <button
                className="otp-toggle"
                aria-label={
                  running
                    ? 'Jeda auto-refresh'
                    : 'Lanjutkan auto-refresh'
                }
                onClick={() => {
                  setRunning((current) => !current);
                }}
              >
                <i
                  className={`fa-solid ${
                    running
                      ? 'fa-pause'
                      : 'fa-play'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {!result && (
          <div className="otp-empty">
            <div className="ic">
              <i className="fa-solid fa-shield-halved" />
            </div>

            <h3>Belum ada hasil OTP</h3>

            <p>
              Masukkan nomor handphone lalu tekan
              Ambil OTP.
            </p>
          </div>
        )}
      </div>

      <div
        className={`otp-toast ${
          toast ? 'show' : ''
        }`}
      >
        <i className="fa-solid fa-check" />
        Kode tersalin
      </div>

      {/* Loading fullscreen hanya saat pencarian manual */}
      {loading && (
        <LoadingScreen
          title="Mencari kode terbaru"
          description="Menghubungkan Gmail dan memeriksa email verifikasi..."
        />
      )}
    </main>
  );
}
