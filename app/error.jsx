'use client';
export default function ErrorPage({ reset }) {
  return <main className="loading-page" id="main"><img src="/brand/error.webp" width="160" height="160" alt="" /><h1>Ups, belum berhasil.</h1><p>Halaman belum dapat dimuat. Coba lagi sebentar.</p><button className="primary-button" onClick={reset}>Coba lagi</button></main>;
}
