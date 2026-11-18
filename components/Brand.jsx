import Icon from './Icon';

export function Header({ login = false, demo = false }) {
  return <header className="site-header">
    <a className="brand" href={demo ? '/demo' : '/'} aria-label="Orinimo beranda">
      <img src="/brand/logo.webp" width="56" height="56" alt="" />
      <span><strong>orinimo<span className="brand-dot">.</span></strong><small>YOUR MOVIE NIGHT BUDDY</small></span>
    </a>
    <nav aria-label="Navigasi utama">
      <a className="guide-link" href="#panduan"><Icon name="help" size={17} />Cara pakai</a>
      {!login && <a className="nav-pill" href="/admin"><Icon name="settings" size={17} />Kelola akun</a>}
      {login && <span className="nav-pill"><span className="tiny-dot" />DISNEY+ OTP</span>}
    </nav>
  </header>;
}

export function Footer() {
  return <footer className="site-footer"><span>Made with a little pop & a lot of love.</span><span>© {new Date().getFullYear()} Orinimo <span className="footer-dot">•</span> Let the good times roll.</span></footer>;
}

export function Guide({ login = false }) {
  return <section className="guide" id="panduan" aria-labelledby="guide-title">
    <div className="guide-heading"><span className="eyebrow">LESS WAITING, MORE WATCHING</span><h2 id="guide-title">Tiga langkah. Lalu, play!</h2></div>
    <div className="steps">
      <article><span className="step-number">01</span><div><h3>{login ? 'Masuk ke Orinimo' : 'Minta kode Disney+'}</h3><p>{login ? 'Gunakan akun admin yang sudah terdaftar.' : 'Minta kode login melalui aplikasi atau situs Disney+.'}</p></div></article>
      <article><span className="step-number">02</span><div><h3>{login ? 'Cari nomor terdaftar' : 'Masukkan nomormu'}</h3><p>{login ? 'Minta OTP dari Disney+, lalu cek nomor akunmu.' : 'Orinimo akan memeriksa email akun yang sesuai.'}</p></div></article>
      <article><span className="step-number">03</span><div><h3>Salin. Tempel. Nonton!</h3><p>Gunakan kode terbaru sebelum masa berlakunya habis.</p></div></article>
    </div>
  </section>;
}
