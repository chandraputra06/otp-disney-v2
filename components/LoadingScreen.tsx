
'use client';

interface LoadingScreenProps {
  title?: string;
  description?: string;
}

export default function LoadingScreen({
  title = 'Menyiapkan halaman',
  description = 'Mohon tunggu sebentar...',
}: LoadingScreenProps) {
  return (
    <div
      className="orinimo-loading"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="orinimo-loading-content">
        <div className="orinimo-loading-icon">
          <div className="orinimo-loading-ring" />
          <div className="orinimo-loading-ring-inner" />

          <span className="orinimo-loading-letter">
            O
          </span>
        </div>

        <div className="orinimo-loading-brand">
          ORINIMO
        </div>

        <h2 className="orinimo-loading-title">
          {title}
        </h2>

        <p className="orinimo-loading-description">
          {description}
        </p>

        <div className="orinimo-loading-track">
          <div className="orinimo-loading-progress" />
        </div>

        <div className="orinimo-loading-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
