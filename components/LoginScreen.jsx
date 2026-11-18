'use client';
import { useActionState, useState } from 'react';
import { loginAction } from '@/app/login/actions';
import { Header, Footer, Guide } from './Brand';
import Icon from './Icon';
import Mascot from './Mascot';

export default function LoginScreen() {
  const [state, action, pending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState(false);
  return <div className="site-shell"><Header login />
    <main id="main">
      <section className="hero login-hero">
        <div className="hero-story">
          <span className="eyebrow"><span className="mini-ticket">ADMIT ONE</span>A LITTLE POP. A LOT OF FUN.</span>
          <h1>Masuk dulu,<br /><span>film kemudian.</span><span className="heading-star">✳︎</span></h1>
          <p className="hero-description">Movie night nggak perlu ribet.<br />Satu tempat kecil untuk kode dan cerita seru.</p>
          <Mascot mood={pending ? 'thinking' : state?.error ? 'error' : focus ? 'thinking' : 'hello'} login />
        </div>
        <div className="ticket-column">
          <div className="ticket-overline"><span />YOUR NEXT STORY STARTS HERE<span /></div>
          <section className="ticket-card">
            <div className="ticket-stripe" />
            <div className="ticket-main">
              <span className="card-kicker"><Icon name="sparkle" size={17} />WELCOME TO THE GOOD TIMES</span>
              <h2>Hai, selamat datang!<span className="small-wave">✦</span></h2>
              <p className="card-description">Masuk ke akunmu. Biar Orinimo urus kodenya.</p>
              <form action={action} className="main-form">
                <label htmlFor="email">Email admin</label>
                <div className="input-wrap"><Icon name="mail" /><input name="email" id="email" type="email" autoComplete="username" placeholder="nama@email.com" required maxLength={254} /></div>
                <label htmlFor="password">Kata sandi</label>
                <div className="input-wrap"><Icon name="lock" /><input name="password" id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Masukkan kata sandimu" required maxLength={256} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} /><button type="button" className="icon-button" aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? 'hidden' : 'eye'} size={19} /></button></div>
                {state?.error && <p className="form-error" role="alert">{state.error}</p>}
                <button className="primary-button" disabled={pending}>{pending ? 'Sedang masuk…' : 'Yuk, masuk'}<Icon name={pending ? 'refresh' : 'arrow'} className={pending ? 'spin' : ''} /></button>
              </form>
              <div className="privacy-note"><Icon name="shield" size={17} /><span>Akses khusus akun admin Orinimo.</span></div>
            </div>
            <div className="ticket-tear"><span /></div>
            <div className="ticket-stub"><span className="stub-icon">🍿</span><div><strong>Good movies. Great company.</strong><span>Kamu siapkan popcorn, kami siapkan kodenya.</span></div><span className="barcode" aria-hidden="true" /></div>
          </section>
          <p className="under-ticket">Punya masalah akses? Hubungi admin Orinimo.</p>
        </div>
      </section>
      <div className="marquee" aria-hidden="true"><span>POP. COPY. PLAY.</span><span>✳︎</span><span>LET THE GOOD TIMES ROLL</span><span>✳︎</span><span>PASS THE POPCORN</span><span>✳︎</span><span>POP. COPY. PLAY.</span></div>
      <Guide login />
    </main><Footer />
  </div>;
}
