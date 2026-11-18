'use client';
import { useState } from 'react';
import Icon from './Icon';

export default function Mascot({ mood = 'hello', login = false }) {
  const [popped, setPopped] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const bubble = popped ? 'Pop! Jangan lupa popcorn-nya 🍿' : ({
    hello: login ? 'Psst… movie night awaits!' : 'Aku bantu cariin kodenya, ya!',
    thinking: 'Sebentar, aku cek dulu…',
    success: 'Yeay! Saatnya movie time!',
    error: 'Ups! Kita coba lagi, ya?',
  }[mood]);
  return <div className={'mascot-scene mood-' + mood}
    onPointerMove={(event) => {
      if (event.pointerType === 'touch') return;
      const rect = event.currentTarget.getBoundingClientRect();
      setTilt({ x: (event.clientX - rect.left - rect.width / 2) / 55, y: (event.clientY - rect.top - rect.height / 2) / 70 });
    }}
    onPointerLeave={() => { setTilt({ x: 0, y: 0 }); setPopped(false); }}>
    <div className="mascot-halo" />
    <span className="doodle doodle-one"><Icon name="sparkle" size={36} /></span>
    <span className="doodle doodle-two">✳︎</span>
    <span className="doodle doodle-three">✦</span>
    <div className="speech-bubble">{bubble}</div>
    <button type="button" className={'mascot-button' + (popped ? ' popped' : '')} onClick={() => setPopped(!popped)} aria-label="Sapa maskot Orinimo" style={{ '--tilt-x': tilt.x + 'deg', '--tilt-y': -tilt.y + 'deg' }}>
      <img src={'/brand/' + mood + '.webp'} width="430" height="430" alt="Maskot popcorn Orinimo" fetchPriority="high" />
    </button>
    <span className="mascot-caption"><span />YOUR LITTLE MOVIE BUDDY<span /></span>
  </div>;
}
