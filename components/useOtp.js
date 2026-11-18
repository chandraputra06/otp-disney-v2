'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export async function liveRequest(phone, previousMessageId, signal) {
  const response = await fetch('/api/otp', {
    method: 'POST',
    cache: 'no-store',
    signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phone,
      previous_message_id: previousMessageId,
    }),
  });

  const data = await response.json();

  if (response.status === 401) {
    return {
      status: 'session_expired',
      status_label: 'Sesi sudah berakhir',
      message: data.message,
    };
  }

  if (!response.ok && response.status !== 429) {
    throw new Error(data.message || 'Belum bisa terhubung. Coba lagi sebentar.');
  }

  return data;
}

const STOP_STATUSES = new Set([
  'account_not_found',
  'account_ambiguous',
  'setup_required',
  'reconnect_required',
  'account_mismatch',
  'recipient_spelling',
  'session_expired',
]);

export function useOtp(request = liveRequest) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(true);
  const [activePhone, setActivePhone] = useState('');
  const [now, setNow] = useState(0);
  const [nextCheck, setNextCheck] = useState(0);
  const [foreground, setForeground] = useState(true);
  const [online, setOnline] = useState(true);

  const controller = useRef(null);
  const generation = useRef(0);
  const latestId = useRef(null);
  const phoneRef = useRef('');
  const startedAt = useRef(0);
  const failures = useRef(0);

  useEffect(() => {
    setNow(Date.now());

    const visibility = () => {
      setForeground(document.visibilityState === 'visible');
      setNow(Date.now());
    };

    const connectivity = () => setOnline(navigator.onLine);

    visibility();
    connectivity();

    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);

    const ticker = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(ticker);
      controller.current?.abort();
      generation.current += 1;

      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
    };
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    phoneRef.current = '';
    latestId.current = null;
    failures.current = 0;
    startedAt.current = 0;

    setActivePhone('');
    setResult(null);
    setBusy(false);
    setNextCheck(0);
    setAutomatic(true);
  }, []);

  const run = useCallback(async (phone, manual = true) => {
    controller.current?.abort();

    const id = ++generation.current;
    const pending = new AbortController();
    controller.current = pending;

    const timeout = setTimeout(() => pending.abort(), 45_000);

    if (phoneRef.current !== phone) latestId.current = null;

    if (manual) {
      startedAt.current = Date.now();
      failures.current = 0;
    }

    phoneRef.current = phone;
    setActivePhone(phone);
    setBusy(true);
    setResult(null);

    try {
      const data = await request(phone, latestId.current, pending.signal);
      if (id !== generation.current) return;

      if (data.message_id) latestId.current = data.message_id;

      if (data.status === 'fetch_error') failures.current += 1;
      else failures.current = 0;

      setResult(data);

      if (STOP_STATUSES.has(data.status) || failures.current >= 3) {
        setAutomatic(false);
      }

      const delay = Math.max(
        5,
        Number(data.retry_after) || (data.status === 'fetch_error' ? 10 : 5)
      );

      setNextCheck(Date.now() + delay * 1000);
    } catch (error) {
      if (id !== generation.current) return;

      failures.current += 1;

      setResult({
        status: 'fetch_error',
        status_label: 'Koneksi belum berhasil',
        message: pending.signal.aborted
          ? 'Pemeriksaan terlalu lama. Coba lagi, ya.'
          : error.message,
      });

      setNextCheck(Date.now() + 10_000);
      if (failures.current >= 3) setAutomatic(false);
    } finally {
      clearTimeout(timeout);

      if (id === generation.current) {
        setBusy(false);
        controller.current = null;
        setNow(Date.now());
      }
    }
  }, [request]);

  useEffect(() => {
    if (
      !automatic || !result || busy || !foreground || !online ||
      !activePhone || STOP_STATUSES.has(result.status)
    ) {
      return;
    }

    if (Date.now() - startedAt.current >= 120_000) {
      setAutomatic(false);
      return;
    }

    const timer = setTimeout(
      () => run(activePhone, false),
      Math.max(0, nextCheck - Date.now())
    );

    return () => clearTimeout(timer);
  }, [automatic, result, busy, foreground, online, activePhone, nextCheck, run]);

  const toggleAutomatic = () => {
    if (!automatic) {
      startedAt.current = Date.now();
      failures.current = 0;
      setNextCheck(Date.now() + 5_000);
    }

    setAutomatic((value) => !value);
  };

  return {
    result,
    busy,
    automatic,
    activePhone,
    now,
    foreground,
    online,
    run,
    reset,
    toggleAutomatic,
    seconds: Math.max(0, Math.ceil((nextCheck - now) / 1000)),
  };
}