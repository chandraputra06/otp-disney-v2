'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Header, Footer, Guide } from './Brand';
import Mascot from './Mascot';
import Icon from './Icon';
import { liveRequest, useOtp } from './useOtp';
import { phoneVariants } from '@/lib/phone';

function timeWita(iso) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function makeDemoRequest(scenario) {
  const timestamp = Date.now();

  return async (_phone, previous, signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 700);

      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Dibatalkan'));
      }, { once: true });
    });

    if (scenario === 'waiting') {
      return {
        status: 'not_found',
        status_label: 'Belum menemukan email yang cocok',
        message: 'Belum ada email kode untuk akun contoh ini.',
        retry_after: 5,
      };
    }

    if (scenario === 'error') {
      return {
        status: 'fetch_error',
        status_label: 'Koneksi belum berhasil',
        message: 'Ini contoh tampilan saat koneksi ke email bermasalah.',
        retry_after: 10,
      };
    }

    if (scenario === 'expired') {
      return {
        status: 'expired',
        status_label: 'Kodenya sudah kedaluwarsa',
        message: 'Minta kode baru di Disney+, lalu cek kembali di sini.',
        retry_after: 5,
      };
    }

    return {
      status: previous === 'demo-message' ? 'unchanged' : 'success',
      status_label: previous ? 'Masih kode yang sama' : 'Kode siap dipakai!',
      message: 'Kode simulasi untuk pratinjau. Bukan kode Disney+ asli.',
      otp_code: '246810',
      message_id: 'demo-message',
      received_at: new Date(timestamp - 45_000).toISOString(),
      expires_at: new Date(timestamp + 14 * 60_000).toISOString(),
      account_label: 'Akun contoh',
      retry_after: 5,
    };
  };
}

export default function OtpApp({ demo = false }) {
  const [phone, setPhone] = useState('');
  const [validation, setValidation] = useState('');
  const [scenario, setScenario] = useState('success');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const request = useMemo(
    () => demo ? makeDemoRequest(scenario) : liveRequest,
    [demo, scenario]
  );

  const otp = useOtp(request);
  const expired = otp.result?.expires_at && otp.now >= Date.parse(otp.result.expires_at);
  const code = !expired ? otp.result?.otp_code : null;
  const good = Boolean(code && ['success', 'unchanged'].includes(otp.result?.status));

  const failed = [
    'fetch_error',
    'reconnect_required',
    'account_mismatch',
    'recipient_spelling',
    'setup_required',
    'session_expired',
    'account_not_found',
    'account_ambiguous',
    'parse_failed',
  ].includes(otp.result?.status);

  const mood = otp.busy ? 'thinking'
    : validation || failed ? 'error'
    : good ? 'success'
    : otp.result ? 'thinking'
    : 'hello';

  const remaining = Math.max(
    0,
    Math.floor((Date.parse(otp.result?.expires_at || '') - otp.now) / 1000)
  );

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function updatePhone(value) {
    setPhone(value);
    setValidation('');
    setToast('');
    otp.reset();
  }

  function submit(event) {
    event.preventDefault();
    setToast('');

    if (!phoneVariants(phone).length) {
      setValidation('Isi nomor terdaftar, 10–15 digit, ya.');
      return;
    }

    setValidation('');
    otp.run(phone);
  }

  async function copyCode() {
    if (!good || Date.now() >= Date.parse(otp.result.expires_at)) return;

    try {
      await navigator.clipboard.writeText(code);
      setToast('Pop! Kode berhasil disalin.');
    } catch {
      setToast('Belum bisa menyalin. Pilih keenam angka lalu salin manual, ya.');
    }

    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }

  return (
    <div className="site-shell">
      <Header demo={demo} />

      {demo && (
        <aside className="demo-banner">
          <strong>Pratinjau UI · data simulasi</strong>
          <label htmlFor="demo-state">Coba status:</label>
          <select
            id="demo-state"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value);
              otp.reset();
            }}
          >
            <option value="success">Berhasil</option>
            <option value="waiting">Menunggu email</option>
            <option value="error">Koneksi gagal</option>
            <option value="expired">Kedaluwarsa</option>
          </select>
          <span>Tidak terhubung ke Gmail.</span>
        </aside>
      )}

      <main id="main">
        <section className="hero">
          <div className="hero-story">
            <span className="eyebrow">
              <span className="mini-ticket">ADMIT ONE</span>YOUR TICKET TO MOVIE NIGHT
            </span>
            <h1>
              Ambil kode.<br />
              <span>Mulai ceritamu.</span><span className="heading-star">✳︎</span>
            </h1>
            <p className="hero-description">
              Nggak perlu bolak-balik buka email.<br />
              Biar Orinimo bantu, kamu tinggal menikmati.
            </p>
            <Mascot mood={mood} />
          </div>

          <div className="ticket-column">
            <div className="ticket-overline">
              <span />A LITTLE CODE. A BIG MOVIE NIGHT.<span />
            </div>

            <section className="ticket-card">
              <div className="ticket-stripe" />

              <div className="ticket-main">
                <div className="card-title-row">
                  <span className="card-kicker"><Icon name="play" size={15} />DISNEY+ OTP</span>
                  <span className="private-badge"><Icon name="lock" size={12} />Khusus akunmu</span>
                </div>

                <h2>Pop! Cari kodenya.</h2>
                <p className="card-description">Masukkan nomor yang terdaftar di Orinimo.</p>

                <form onSubmit={submit} className="main-form otp-form">
                  <label htmlFor="phone">Nomor terdaftar</label>
                  <div className={'input-wrap' + (validation ? ' invalid' : '')}>
                    <Icon name="phone" />
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="Contoh: 0812 3456 7890"
                      value={phone}
                      maxLength={40}
                      onChange={(event) => updatePhone(event.target.value)}
                      aria-invalid={Boolean(validation)}
                      aria-describedby={validation ? 'phone-error' : 'phone-hint'}
                    />
                  </div>

                  <span className="input-hint" id="phone-hint">
                    Bisa pakai 08, +62, atau kode negara lainnya.
                  </span>

                  {validation && (
                    <p className="form-error" id="phone-error" role="alert">{validation}</p>
                  )}

                  <button type="submit" className="primary-button" disabled={otp.busy || !otp.online}>
                    {otp.busy ? 'Lagi cari kodenya…' : 'Ambil kode OTP'}
                    <Icon name={otp.busy ? 'refresh' : 'arrow'} className={otp.busy ? 'spin' : ''} />
                  </button>
                </form>

                <div className="result-area" aria-busy={otp.busy}>
                  {otp.busy ? (
                    <div className="empty-result searching">
                      <span className="loading-dots"><i /><i /><i /></span>
                      <h3>Sebentar, popcorn lagi bekerja.</h3>
                      <p>Memeriksa email terbaru untuk nomor ini.</p>
                    </div>
                  ) : !otp.result ? (
                    <div className="empty-result">
                      <span className="empty-icon"><Icon name="mail" size={24} /><i>✦</i></span>
                      <h3>Kode kamu akan muncul di sini.</h3>
                      <p>Sudah minta kode dari Disney+?<br />Masukkan nomormu, lalu klik tombol di atas.</p>
                    </div>
                  ) : (
                    <div className={'result-content ' + (good ? 'result-success' : failed ? 'result-error' : 'result-waiting')}>
                      <div className="result-heading" role="status">
                        <span className="result-dot" />
                        {expired
                          ? 'Kodenya sudah kedaluwarsa'
                          : otp.result.status_label || 'Belum berhasil terhubung'}
                      </div>

                      {good && (
                        <>
                          <div className="otp-digits" aria-label={'Kode OTP ' + code}>
                            {code.split('').map((digit, index) => <span key={index}>{digit}</span>)}
                          </div>
                          <button type="button" className="copy-button" onClick={copyCode}>
                            <Icon name="copy" size={17} />Salin kode
                          </button>
                          <div className="code-details">
                            <span>
                              <Icon name="clock" size={13} />
                              Diterima {timeWita(otp.result.received_at)} WITA
                            </span>
                            <span>
                              Berlaku {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                            </span>
                          </div>
                        </>
                      )}

                      {!good && (
                        <div className="status-illustration">
                          <Icon name={failed ? 'help' : 'clock'} size={29} />
                        </div>
                      )}

                      {otp.result.status === 'parse_failed' && otp.result.received_at && (
                        <p className="code-details">
                          <Icon name="clock" size={13} />
                          Email diterima {timeWita(otp.result.received_at)} WITA
                        </p>
                      )}

                      <p className="result-message">
                        {expired
                          ? 'Minta kode baru di Disney+, lalu cek kembali.'
                          : otp.result.message}
                      </p>

                      {otp.result.status === 'session_expired' && (
                        <a className="text-link" href="/login">
                          Masuk kembali <Icon name="arrow" size={16} />
                        </a>
                      )}

                      {(
                        ['setup_required', 'reconnect_required', 'account_mismatch', 'recipient_spelling']
                          .includes(otp.result.status) ||
                        otp.result.search_detail === 'recipient'
                      ) && (
                        <a className="text-link" href="/admin">
                          Buka Kelola akun <Icon name="arrow" size={16} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="ticket-tear"><span /></div>
              <div className="otp-stub">
                <div>
                  <Icon name="refresh" size={17} />
                  <span>
                    <strong>Cek otomatis</strong>
                    <small>
                      {!otp.online ? 'Offline · pemeriksaan dijeda'
                        : !otp.foreground ? 'Dijeda saat tab tidak aktif'
                        : otp.busy ? 'Sedang memeriksa email'
                        : !otp.result ? 'Dimulai setelah pencarian'
                        : otp.automatic ? 'Cek lagi dalam ' + otp.seconds + ' detik'
                        : 'Dijeda · aktifkan untuk melanjutkan'}
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={otp.automatic}
                  aria-label="Cek OTP otomatis"
                  className={'toggle-switch' + (otp.automatic ? ' is-on' : '')}
                  onClick={otp.toggleAutomatic}
                >
                  <span />
                </button>
              </div>
            </section>

            <p className="under-ticket">
              <Icon name="shield" size={14} />Kode diambil hanya dari email akun yang sesuai.
            </p>
            {otp.result && <p className="poll-note">Pemeriksaan otomatis berjalan maksimal 2 menit.</p>}
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <span>POP. COPY. PLAY.</span><span>✳︎</span>
          <span>LET THE GOOD TIMES ROLL</span><span>✳︎</span>
          <span>PASS THE POPCORN</span><span>✳︎</span>
          <span>POP. COPY. PLAY.</span>
        </div>

        <Guide />

        <section className="faq">
          <h2>Masih ada yang bikin penasaran?</h2>

          <details>
            <summary>Kodenya belum muncul, harus bagaimana?<span>+</span></summary>
            <p>
              Jika email sudah ada di Gmail, buka panah detail di bawah nama pengirim.
              Cocokkan alamat To (Kepada) dengan Email Disney untuk nomor itu di Kelola akun,
              termasuk titik dan tanda tambah.
            </p>
          </details>

          <details>
            <summary>Kenapa kode masih sama?<span>+</span></summary>
            <p>
              Artinya belum ada email OTP yang lebih baru. Minta kode baru dari Disney+ jika
              kode sebelumnya ditolak. Kalau beberapa orang menggunakan satu akun Disney
              bersamaan, kode terbaru bisa menggantikan kode sebelumnya.
            </p>
          </details>

          <details>
            <summary>Berapa lama kode bisa digunakan?<span>+</span></summary>
            <p>
              Contoh email Disney+ menyebut masa berlaku 15 menit. Orinimo menghitungnya
              dari waktu email diterima dan menyembunyikan kode yang sudah habis masa berlakunya.
            </p>
          </details>
        </section>
      </main>

      <Footer />

      {toast && (
        <div className="toast" role="status"><Icon name="copy" size={18} />{toast}</div>
      )}
    </div>
  );
}