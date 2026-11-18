import '@fontsource-variable/nunito';
import './globals.css';

export const metadata = {
  title: 'Orinimo — A little pop, a little movie magic',
  description: 'Teman movie night kamu. Ambil kode OTP Disney+ dari akun yang sesuai dengan mudah.',
  robots: { index: false, follow: false },
  icons: { icon: '/brand/logo.webp' },
};

export default function RootLayout({ children }) {
  return <html lang="id"><body><a href="#main" className="skip-link">Lewati ke konten utama</a>{children}</body></html>;
}
