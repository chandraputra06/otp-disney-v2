
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
const OTP_MAX_AGE_MS = 15 * 60 * 1000;

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

  const [nowMs, setNowMs] = useState(() => Date.now());

  const lastPhone = useRef('');
  const inFlight = useRef(false);
  const countdownRef = useRef(REFRESH_SECONDS);

  // Perbarui waktu untuk memastikan kode yang
  // sudah lewat 15 menit otomatis tidak bisa disalin.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

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
        'Kode tidak dapat disalin secara otomatis.'
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

      // Hindari dua request berjalan bersamaan.
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
              'Sesi login berakhir. Silakan login kembali.'
            );
          }

          throw new Error(
            data?.message ??
              `Permintaan gagal. HTTP ${response.status}.`
          );
        }

        const otpResult = data as OtpResult;

        // Respons tidak pernah mengambil last_otp_code
        // dari riwayat untuk ditampilkan sebagai aktif.
        setResult(otpResult);
        setNowMs(Date.now());

        countdownRef.current = REFRESH_SECONDS;
        setSecs(REFRESH_SECONDS);
      } catch (err) {
        // Jika permintaan gagal, jangan biarkan kode
        // sebelumnya terus tampil di halaman.
        setResult(null);

        setError(
          err instanceof Error
            ? err.message
            : 'Gagal terhubung ke server.'
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

  // Countdown auto-refresh.
  useEffect(() => {
    if (!result || !running) return;

    const interval = window.setInterval(() => {
      if (document.hidden) return;

      // Jangan mengirim request ketika Gmail
      // masih sedang diperiksa.
      if (inFlight.current) return;

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

  const receivedAtMs = result?.received_at
    ? new Date(result.received_at).getTime()
    : NaN;

  const ageMs = nowMs - receivedAtMs;

  const isExpired =
    result?.status === 'success' &&
    Number.isFinite(ageMs) &&
    ageMs >= OTP_MAX_AGE_MS;

  const isRecent =
    Number.isFinite(ageMs) &&
    ageMs >= -60_000 &&
    ageMs < OTP_MAX_AGE_MS;

  // Hanya tampilkan kode hasil pemeriksaan Gmail
  // yang sukses dan masih berada dalam masa berlaku.
  const code =
    result?.status === 'success' && isRecent
      ? result.otp_code
      : null;

  const timeIso = result?.received_at ?? null;

  const chip = result
    ? chipStyle(result.status)
    : null;

  const statusLabel = isExpired
    ? 'Kode Kedaluwarsa'
    : result?.status_label ?? '';

  return (
    <main className="otp-wrap">
      <div className="otp-container">

        {/* HEADER */}
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

        {/* FORM NOMOR HANDPHONE */}
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
                const value = event.target.value;
                setPhone(value);

                // Hapus hasil lama ketika nomor diganti.
                if (
                  value.replace(/\D+/g, '') !==
                  lastPhone.current
                ) {
                  setResult(null);
                  setError(null);
                  setRunning(false);
                }
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

        {/* HASIL OTP */}
        {result && chip && (
          <div className="otp-panel">

            <div className="otp-toprow">
              <span
                className="otp-chip"
                style={{
                  background: isExpired
                    ? '#fee2e2'
                    : chip.bg,
                  color: isExpired
                    ? '#b91c1c'
                    : chip.fg,
                }}
              >
                <i
                  className={`fa-solid ${
                    isExpired
                      ? 'fa-clock'
                      : chip.icon
                  }`}
                />

                {statusLabel}
              </span>

              {timeIso && (
                <span className="otp-fresh">
                  <i className="fa-solid fa-circle" />
                  Diterima{' '}
                  {witaTimeShort(timeIso)} WITA
                </span>
              )}
            </div>

            {/* KODE OTP */}
            <button
              className="otp-codebox"
              disabled={!code}
              onClick={() => {
                void copyCode(code);
              }}
            >
              <p className="cap">
                {code
                  ? 'KODE EMAIL TERBARU · KETUK UNTUK SALIN'
                  : 'KODE TERBARU BELUM TERSEDIA'}
              </p>

              <p className="code">
                {code ?? '—'}
              </p>

              <span className="hint">
                <i
                  className={`fa-solid ${
                    code
                      ? 'fa-copy'
                      : 'fa-clock'
                  }`}
                />

                {code
                  ? 'Salin kode'
                  : 'Tidak ada kode aktif'}
              </span>
            </button>

            {/* DETAIL OTP */}
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

            {isExpired ? (
              <p className="otp-msg">
                Kode dari email terakhir sudah melewati
                15 menit. Silakan minta kode baru melalui
                Disney+.
              </p>
            ) : (
              result.message && (
                <p className="otp-msg">
                  {result.message}
                </p>
              )
            )}

            {/* AUTO REFRESH */}
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

        {/* EMPTY STATE */}
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

      {/* TOAST COPY */}
      <div
        className={`otp-toast ${
          toast ? 'show' : ''
        }`}
      >
        <i className="fa-solid fa-check" />
        Kode tersalin
      </div>

      {/* FULLSCREEN LOADING */}
      {loading && (
        <LoadingScreen
          title="Mencari kode terbaru"
          description="Menghubungkan Gmail dan memeriksa email verifikasi..."
        />
      )}
    </main>
  );
}
